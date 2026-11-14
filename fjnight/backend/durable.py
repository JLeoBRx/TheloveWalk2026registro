"""Banco durável: tudo que precisa sobreviver a reinicializações e novos deploys.

PostgreSQL em produção (DATABASE_URL); SQLite em desenvolvimento ou num disco
persistente. Guarda catálogo, regras editoriais, pedidos de oposição (cifrados),
autorização da busca facial, sessões administrativas, playlist e histórico.

Não guarda fotografias nem o índice facial das fotos do evento.
"""
from __future__ import annotations

import json
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

from sqlalchemy import (
    BigInteger, Boolean, Column, Float, Index, Integer, LargeBinary, MetaData, String, Table, Text,
    create_engine, event, text,
)
from sqlalchemy.engine import Connection, Engine

from .config import settings

metadata = MetaData()

photos = Table(
    "fjn_photos", metadata,
    Column("id", String(24), primary_key=True),          # sha256 do conteúdo (24 hex)
    Column("sha256", String(64), nullable=False, unique=True),
    Column("rel_path", String(1024), nullable=False, unique=True),
    Column("filename", String(512), nullable=False),
    Column("category", String(255), nullable=False, default=""),
    Column("source_sig", String(255), nullable=False),   # tamanho+data (local) ou ETag (R2)
    Column("file_size", BigInteger, nullable=False),
    Column("width", Integer, nullable=False),
    Column("height", Integer, nullable=False),
    Column("taken_at", String(32)),
    Column("sort_key", String(1400), nullable=False),
    Column("color", String(7), nullable=False, default="#1d1209"),
    Column("is_raw", Boolean, nullable=False, default=False),
    Column("has_camera_jpeg", Boolean, nullable=False, default=False),
    Column("version", String(16), nullable=False),
    Column("indexed_at", Float, nullable=False),
)
Index("ix_fjn_photos_sort", photos.c.sort_key)

# Arquivos que não entraram no catálogo (erro de leitura ou cópia duplicada).
photo_issues = Table(
    "fjn_photo_issues", metadata,
    Column("rel_path", String(1024), primary_key=True),
    Column("kind", String(16), nullable=False),          # "error" | "duplicate"
    Column("detail", String(500), nullable=False),
    Column("sha256", String(64)),
    Column("seen_at", Float, nullable=False),
)

# Decisões editoriais: valem pelo conteúdo (sha256) e pelo caminho. Uma sincronização
# nunca apaga estas linhas — nem quando o arquivo some da pasta.
photo_rules = Table(
    "fjn_photo_rules", metadata,
    Column("sha256", String(64), primary_key=True),
    Column("rel_path", String(1024), nullable=False),
    Column("hidden", Boolean),
    Column("downloadable", Boolean),
    Column("face_search", Boolean),
    Column("reason", String(500)),
    Column("updated_at", Float, nullable=False),
)
Index("ix_fjn_photo_rules_path", photo_rules.c.rel_path)

face_optouts = Table(
    "fjn_face_optouts", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("protocol", String(32), nullable=False, unique=True),
    Column("created_at", Float, nullable=False),
    Column("nonce", LargeBinary, nullable=False),
    Column("ciphertext", LargeBinary, nullable=False),
    Column("key_fp", String(16), nullable=False),
)

face_authorizations = Table(
    "fjn_face_authorizations", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("created_at", Float, nullable=False),
    Column("confirmed_by", String(200), nullable=False),
    Column("role", String(200), nullable=False),
    Column("privacy_fp", String(64), nullable=False),
    Column("checklist", Text, nullable=False),
    Column("revoked_at", Float),
    Column("revoked_by", String(200)),
    Column("revoke_reason", String(500)),
)

admin_sessions = Table(
    "fjn_admin_sessions", metadata,
    Column("id_hash", String(64), primary_key=True),
    Column("csrf", String(64), nullable=False),
    Column("created_at", Float, nullable=False),
    Column("last_seen", Float, nullable=False),
    Column("expires_at", Float, nullable=False),
)

audit_log = Table(
    "fjn_audit_log", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("at", Float, nullable=False),
    Column("action", String(64), nullable=False),
    Column("ok", Boolean, nullable=False),
    Column("detail", Text, nullable=False),
)
Index("ix_fjn_audit_at", audit_log.c.at)

kv = Table(
    "fjn_kv", metadata,
    Column("key", String(100), primary_key=True),
    Column("value", Text, nullable=False),
)

_engine: Engine | None = None
_lock = threading.Lock()


def engine() -> Engine:
    global _engine
    with _lock:
        if _engine is None:
            url = settings.database_url
            if url.startswith("sqlite"):
                eng = create_engine(url, connect_args={"timeout": 30, "check_same_thread": False})

                @event.listens_for(eng, "connect")
                def _sqlite_pragmas(dbapi, _):  # noqa: ANN001
                    cur = dbapi.cursor()
                    cur.execute("PRAGMA journal_mode=WAL")
                    cur.execute("PRAGMA busy_timeout=30000")
                    cur.close()
            else:
                eng = create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5, pool_recycle=300,
                                    connect_args={"connect_timeout": 10})
            _engine = eng
        return _engine


def reset_engine() -> None:
    """Descarta conexões (usado nos testes para simular reinicialização)."""
    global _engine
    with _lock:
        if _engine is not None:
            _engine.dispose()
        _engine = None


def init() -> None:
    metadata.create_all(engine())


@contextmanager
def tx() -> Iterator[Connection]:
    with engine().begin() as conn:
        yield conn


def upsert(conn: Connection, table: Table, values: dict, keys: list[str]) -> None:
    """INSERT ... ON CONFLICT DO UPDATE, portável entre SQLite e PostgreSQL."""
    if conn.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    stmt = insert(table).values(**values)
    update = {k: stmt.excluded[k] for k in values if k not in keys}
    conn.execute(stmt.on_conflict_do_update(index_elements=keys, set_=update) if update
                 else stmt.on_conflict_do_nothing(index_elements=keys))


def kv_get(key: str, default: str = "", conn: Connection | None = None) -> str:
    def run(c: Connection) -> str:
        row = c.execute(kv.select().where(kv.c.key == key)).first()
        return row.value if row else default
    if conn is not None:
        return run(conn)
    with tx() as c:
        return run(c)


def kv_set(key: str, value: str, conn: Connection | None = None) -> None:
    if conn is not None:
        upsert(conn, kv, {"key": key, "value": value}, ["key"])
        return
    with tx() as c:
        upsert(c, kv, {"key": key, "value": value}, ["key"])


def kv_get_json(key: str, default: Any = None) -> Any:
    raw = kv_get(key, "")
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def kv_set_json(key: str, value: Any) -> None:
    kv_set(key, json.dumps(value, ensure_ascii=False))


def audit(action: str, ok: bool = True, **detail: Any) -> None:
    """Registra uma operação administrativa. Nunca inclua dados pessoais ou segredos."""
    try:
        with tx() as c:
            c.execute(audit_log.insert().values(
                at=time.time(), action=action, ok=ok,
                detail=json.dumps(detail, ensure_ascii=False, default=str)[:4000],
            ))
    except Exception as exc:  # o histórico não pode derrubar a operação principal
        print(f"[auditoria] falha ao registrar {action}: {type(exc).__name__}", flush=True)


def recent_audit(limit: int = 50) -> list[dict]:
    with tx() as c:
        rows = c.execute(audit_log.select().order_by(audit_log.c.id.desc()).limit(limit)).fetchall()
    out = []
    for r in rows:
        try:
            detail = json.loads(r.detail)
        except json.JSONDecodeError:
            detail = {}
        out.append({"id": r.id, "at": r.at, "action": r.action, "ok": r.ok, "detail": detail})
    return out


def health() -> dict:
    """Verificação real de leitura e escrita no banco durável."""
    started = time.time()
    try:
        probe = f"{time.time_ns()}"
        with tx() as c:
            c.execute(text("SELECT 1"))
            kv_set("persistence_probe", probe, conn=c)
        ok = kv_get("persistence_probe") == probe
        return {"ok": ok, "kind": settings.database_kind, "durable": settings.durable_storage,
                "latency_ms": round((time.time() - started) * 1000)}
    except Exception as exc:
        return {"ok": False, "kind": settings.database_kind, "durable": settings.durable_storage,
                "error": type(exc).__name__}
