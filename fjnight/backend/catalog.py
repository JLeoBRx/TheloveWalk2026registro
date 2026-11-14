"""Catálogo de fotografias, regras editoriais e consultas públicas.

Identidade da foto = SHA-256 do conteúdo do arquivo original. Assim:
- renomear ou mover uma foto mantém o mesmo id e as mesmas regras;
- o mesmo arquivo em duas pastas é detectado como duplicata;
- uma foto alterada vira um novo registro (as regras por caminho continuam valendo).

As regras editoriais vivem no banco durável e nunca são apagadas pela
sincronização — nem quando o arquivo é removido. Se a mesma foto voltar,
a decisão anterior (ex.: oculta, fora da busca facial) continua valendo até
ser revista no painel.
"""
from __future__ import annotations

import fnmatch
import hashlib
import json
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Callable

from sqlalchemy import delete, select

from . import durable, imaging
from .config import settings
from .durable import photo_issues, photo_rules, photos
from .storage import store

RULE_KEYS = ("ocultas", "sem_download", "sem_busca_facial")
RULE_FIELDS = ("hidden", "downloadable", "face_search")
DERIVATIVE_PIPELINE = "2"
REVIEW_REASON = "Aguardando revisão antes da publicação"


def derivative_version() -> str:
    raw = f"{DERIVATIVE_PIPELINE}|{settings.thumb_size}|{settings.display_size}"
    return hashlib.sha1(raw.encode()).hexdigest()[:6]


def photo_id(sha256: str) -> str:
    return sha256[:24]


def is_valid_id(pid: str) -> bool:
    return len(pid) == 24 and all(c in "0123456789abcdef" for c in pid)


def category_of(rel: str) -> str:
    parts = PurePosixPath(rel).parts
    return parts[0] if len(parts) > 1 else ""


def category_label(name: str) -> str:
    """'01 - Louvor' -> 'Louvor' (o prefixo numérico serve só para ordenar)."""
    label = re.sub(r"^\s*\d+\s*[-_.)]?\s*", "", name).strip()
    return label or name


def keys_for(pid: str, version: str) -> dict[str, str]:
    return {
        "thumb": f"miniaturas/{pid}-{version}.webp",
        "display": f"exibicao/{pid}-{version}.webp",
        "camera_jpeg": f"jpeg-camera/{pid}-{version}.jpg",
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# Regras: arquivo versionado (config/photo-rules.json) + banco durável
# ---------------------------------------------------------------------------
_file_rules_lock = threading.Lock()
_file_rules_cache: tuple[float, dict] | None = None


def rules_path() -> Path:
    return settings.config_dir / "photo-rules.json"


def rules_file_mtime() -> float:
    try:
        return rules_path().stat().st_mtime
    except OSError:
        return 0.0


def load_file_rules() -> dict:
    """Padrões (ex.: 'Bastidores/*') e regras por arquivo exportadas pelo painel."""
    global _file_rules_cache
    mtime = rules_file_mtime()
    empty = {"patterns": {k: [] for k in RULE_KEYS}, "by_sha": {}, "by_path": {}}
    if not mtime:
        return empty
    with _file_rules_lock:
        if _file_rules_cache and _file_rules_cache[0] == mtime:
            return _file_rules_cache[1]
        try:
            raw = json.loads(rules_path().read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[catalogo] photo-rules.json inválido: {exc}", flush=True)
            raw = {}
        out = {"patterns": {k: [str(x) for x in raw.get(k, []) if isinstance(x, str)] for k in RULE_KEYS},
               "by_sha": {}, "by_path": {}}
        for entry in raw.get("regras_por_arquivo", []) or []:
            rule = _clean_rule(entry)
            if rule is None:
                continue
            if rule.get("sha256"):
                out["by_sha"][rule["sha256"]] = rule
            if rule.get("rel_path"):
                out["by_path"][rule["rel_path"]] = rule
        _file_rules_cache = (mtime, out)
        return out


def _clean_rule(entry) -> dict | None:
    if not isinstance(entry, dict):
        return None
    sha = entry.get("sha256")
    rel = entry.get("rel_path")
    if sha is not None and not (isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{64}", sha)):
        return None
    if rel is not None and not isinstance(rel, str):
        return None
    if not sha and not rel:
        return None
    rule = {"sha256": sha, "rel_path": rel, "reason": str(entry.get("reason") or "")[:500] or None}
    for f in RULE_FIELDS:
        v = entry.get(f)
        rule[f] = v if isinstance(v, bool) else None
    return rule


def _matches(rel: str, patterns: list[str]) -> bool:
    return any(rel == p or fnmatch.fnmatchcase(rel, p) for p in patterns)


@dataclass
class Effective:
    hidden: bool
    downloadable: bool
    face_search: bool
    reason: str | None = None
    has_db_rule: bool = False


def _db_rules(conn) -> tuple[dict, dict]:
    by_sha, by_path = {}, {}
    for r in conn.execute(select(photo_rules)).mappings():
        rule = dict(r)
        by_sha[rule["sha256"]] = rule
        by_path.setdefault(rule["rel_path"], rule)
    return by_sha, by_path


def resolve(sha: str, rel: str, file_rules: dict, db_by_sha: dict, db_by_path: dict) -> Effective:
    pats = file_rules["patterns"]
    eff = Effective(
        hidden=_matches(rel, pats["ocultas"]),
        downloadable=settings.downloads_default and not _matches(rel, pats["sem_download"]),
        face_search=not _matches(rel, pats["sem_busca_facial"]),
    )
    layers = [file_rules["by_sha"].get(sha) or file_rules["by_path"].get(rel),
              db_by_sha.get(sha) or db_by_path.get(rel)]
    for i, rule in enumerate(layers):
        if not rule:
            continue
        for f in RULE_FIELDS:
            if rule.get(f) is not None:
                setattr(eff, f, bool(rule[f]))
        if rule.get("reason"):
            eff.reason = rule["reason"]
        if i == 1:
            eff.has_db_rule = True
    return eff


def bump(key: str, conn=None) -> None:
    durable.kv_set(key, f"{time.time_ns()}", conn=conn)


# ---------------------------------------------------------------------------
# Sincronização
# ---------------------------------------------------------------------------
def index_catalog(progress: Callable[[int, int, str], None] | None = None) -> dict:
    st = store()
    version = derivative_version()
    sources = st.list_originals(imaging.SUPPORTED_EXTENSIONS)
    present = {s.rel_path for s in sources}
    derived = st.derivative_keys()          # uma listagem, em vez de uma consulta por foto
    total = len(sources)
    stats = {"found": total, "processed": 0, "unchanged": 0, "renamed": 0, "duplicates": 0,
             "removed": 0, "errors": 0}
    with durable.tx() as c:
        rows = {r["rel_path"]: dict(r) for r in c.execute(select(photos)).mappings()}
    by_sha = {r["sha256"]: r for r in rows.values()}
    claimed: dict[str, str] = {}   # sha -> caminho que ficou com a foto nesta sincronização
    found_issues: dict[str, dict] = {}
    changed = False

    def ready(pid: str) -> bool:
        keys = keys_for(pid, version)
        return keys["thumb"] in derived and keys["display"] in derived

    for position, src in enumerate(sources, start=1):
        rel = src.rel_path
        try:
            row = rows.get(rel)
            if row and row["source_sig"] == src.sig and row["version"] == version and ready(row["id"]) \
                    and row["sha256"] not in claimed:
                claimed[row["sha256"]] = rel
                stats["unchanged"] += 1
                continue
            with st.original_file(rel) as path:
                sha = sha256_file(path)
                if sha in claimed:
                    found_issues[rel] = {"kind": "duplicate", "detail": f"Mesmo conteúdo de {claimed[sha]}", "sha256": sha}
                    stats["duplicates"] += 1
                    continue
                twin = by_sha.get(sha)
                if twin and twin["rel_path"] != rel and twin["rel_path"] in present and twin["rel_path"] < rel:
                    # A cópia que já estava no álbum continua na pasta e vem antes: esta é duplicata.
                    found_issues[rel] = {"kind": "duplicate", "detail": f"Mesmo conteúdo de {twin['rel_path']}", "sha256": sha}
                    stats["duplicates"] += 1
                    continue
                claimed[sha] = rel
                existing = twin if twin else None
                if existing and existing["version"] == version and ready(existing["id"]):
                    record = dict(existing, rel_path=rel, filename=PurePosixPath(rel).name,
                                  category=category_of(rel), source_sig=src.sig,
                                  sort_key=_sort_key(rel, existing["taken_at"]))
                    if existing["rel_path"] != rel:
                        stats["renamed"] += 1
                    else:
                        stats["unchanged"] += 1
                else:
                    record = _process(path, rel, sha, src, version)
                    derived.update(keys_for(record["id"], version).values())
                    stats["processed"] += 1
                with durable.tx() as c:
                    if row and row["sha256"] != sha:          # conteúdo alterado no mesmo caminho
                        c.execute(delete(photos).where(photos.c.id == row["id"]))
                        _delete_derivatives(row["id"], row["version"])
                    if twin and twin["rel_path"] != rel:       # renomeada ou movida
                        c.execute(delete(photos).where(photos.c.id == twin["id"]))
                    durable.upsert(c, photos, record, ["id"])
                    if settings.new_photos_require_review and not existing:
                        _ensure_review_rule(c, sha, rel)
                rows[rel] = record
                by_sha[sha] = record
                changed = True
        except Exception as exc:
            stats["errors"] += 1
            found_issues[rel] = {"kind": "error", "detail": f"{type(exc).__name__}: {str(exc)[:200]}", "sha256": None}
            print(f"[catalogo] {rel}: {type(exc).__name__}: {exc}", flush=True)
        finally:
            if progress:
                progress(position, total, rel)

    now = time.time()
    with durable.tx() as c:
        for row in c.execute(select(photos)).mappings().all():
            owner = claimed.get(row["sha256"])
            errored = row["rel_path"] in found_issues and found_issues[row["rel_path"]]["kind"] == "error"
            if row["rel_path"] in present and (owner == row["rel_path"] or (owner is None and errored)):
                continue  # foto válida (ou falha temporária de leitura: mantém a versão anterior)
            c.execute(delete(photos).where(photos.c.id == row["id"]))
            _delete_derivatives(row["id"], row["version"])
            stats["removed"] += 1
            changed = True
        c.execute(delete(photo_issues))
        for rel, issue in found_issues.items():
            c.execute(photo_issues.insert().values(rel_path=rel, kind=issue["kind"], detail=issue["detail"][:500],
                                                   sha256=issue["sha256"], seen_at=now))
        if changed or not durable.kv_get("catalog_version", "", conn=c):
            bump("catalog_version", conn=c)
        durable.kv_set("last_sync", json.dumps({"at": now, **stats}), conn=c)
    return stats


def _sort_key(rel: str, taken_at: str | None) -> str:
    return f"{category_of(rel).lower()}|{taken_at or '9999'}|{PurePosixPath(rel).name.lower()}"


def _process(path: Path, rel: str, sha: str, src, version: str) -> dict:
    loaded = imaging.load(path, settings.display_size)
    st = store()
    pid = photo_id(sha)
    keys = keys_for(pid, version)
    st.put_derivative(keys["display"], imaging.encode_webp(loaded.image, settings.display_size, 84), "image/webp")
    st.put_derivative(keys["thumb"], imaging.encode_webp(loaded.image, settings.thumb_size, 76), "image/webp")
    has_jpeg = False
    if imaging.is_raw(path):
        extracted = imaging.extract_raw_jpeg(path)
        if extracted:  # JPEG da própria câmera, sem recompressão
            st.put_derivative(keys["camera_jpeg"], extracted[0], "image/jpeg")
            has_jpeg = True
    w, h = loaded.full_size
    return {
        "id": pid, "sha256": sha, "rel_path": rel, "filename": PurePosixPath(rel).name,
        "category": category_of(rel), "source_sig": src.sig, "file_size": src.size,
        "width": int(w), "height": int(h), "taken_at": loaded.taken_at,
        "sort_key": _sort_key(rel, loaded.taken_at), "color": imaging.average_color(loaded.image),
        "is_raw": imaging.is_raw(path), "has_camera_jpeg": has_jpeg, "version": version,
        "indexed_at": time.time(),
    }


def _delete_derivatives(pid: str, version: str) -> None:
    for key in keys_for(pid, version).values():
        try:
            store().delete_derivative(key)
        except Exception:
            pass


def _ensure_review_rule(c, sha: str, rel: str) -> None:
    exists = c.execute(select(photo_rules.c.sha256).where(
        (photo_rules.c.sha256 == sha) | (photo_rules.c.rel_path == rel))).first()
    if exists:
        return
    durable.upsert(c, photo_rules, {"sha256": sha, "rel_path": rel, "hidden": True, "downloadable": None,
                                    "face_search": None, "reason": REVIEW_REASON,
                                    "updated_at": time.time()}, ["sha256"])
    bump("rules_version", conn=c)


def issues() -> list[dict]:
    with durable.tx() as c:
        return [dict(r) for r in c.execute(select(photo_issues).order_by(photo_issues.c.rel_path)).mappings()]


# ---------------------------------------------------------------------------
# Consultas públicas (com cache em memória invalidado pelas versões)
# ---------------------------------------------------------------------------
_cache_lock = threading.Lock()
_cache: dict[tuple, tuple[list[dict], dict[str, Effective]]] = {}


def versions() -> tuple[str, str, float]:
    with durable.tx() as c:
        return (durable.kv_get("catalog_version", "0", conn=c), durable.kv_get("rules_version", "0", conn=c),
                rules_file_mtime())


def version_tag() -> str:
    cat, rules, mtime = versions()
    return hashlib.sha1(f"{cat}|{rules}|{mtime}".encode()).hexdigest()[:12]


def all_rows() -> tuple[list[dict], dict[str, Effective]]:
    """Todas as fotos do catálogo com as permissões efetivas (inclui ocultas)."""
    key = versions()
    with _cache_lock:
        hit = _cache.get(key)
    if hit:
        return hit
    file_rules = load_file_rules()
    with durable.tx() as c:
        rows = [dict(r) for r in c.execute(select(photos).order_by(photos.c.sort_key, photos.c.filename)).mappings()]
        by_sha, by_path = _db_rules(c)
    effs = {r["id"]: resolve(r["sha256"], r["rel_path"], file_rules, by_sha, by_path) for r in rows}
    with _cache_lock:
        _cache.clear()
        _cache[key] = (rows, effs)
    return rows, effs


def visible_rows(category: str | None = None) -> tuple[list[dict], dict[str, Effective]]:
    rows, effs = all_rows()
    out = [r for r in rows if not effs[r["id"]].hidden and (category is None or r["category"] == category)]
    return out, effs


def categories() -> list[dict]:
    rows, _ = visible_rows()
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["category"]] = counts.get(row["category"], 0) + 1
    return [{"id": name, "label": category_label(name) if name else "Outras", "count": n}
            for name, n in sorted(counts.items(), key=lambda kv: (kv[0] == "", kv[0].lower()))]


def raw_original_allowed(row: dict, eff: Effective) -> bool:
    return bool(row["is_raw"]) and eff.downloadable and settings.raw_original_downloads


def public_payload(row: dict, eff: Effective) -> dict:
    pid, v = row["id"], row["version"]
    ext = PurePosixPath(row["filename"]).suffix.upper().lstrip(".")
    return {
        "id": pid,
        "w": row["width"],
        "h": row["height"],
        "color": row["color"],
        "category": row["category"],
        "category_label": category_label(row["category"]) if row["category"] else "",
        "taken_at": row["taken_at"],
        "thumb": f"/media/thumb/{pid}.webp?v={v}",
        "display": f"/media/display/{pid}.webp?v={v}",
        "download": f"/media/download/{pid}?v={v}" if eff.downloadable else None,
        "download_label": "JPEG da câmera" if row["is_raw"] and row["has_camera_jpeg"] else ext,
        "original": f"/media/original/{pid}?v={v}" if raw_original_allowed(row, eff) else None,
        "original_label": ext if row["is_raw"] else None,
    }


def get_photo(pid: str, include_hidden: bool = False) -> tuple[dict, Effective] | None:
    if not is_valid_id(pid):
        return None
    rows, effs = all_rows()
    for row in rows:
        if row["id"] == pid:
            eff = effs[pid]
            if eff.hidden and not include_hidden:
                return None
            return row, eff
    return None


def update_rule(pid: str, changes: dict, reason: str | None = None) -> Effective | None:
    allowed = {k: v for k, v in changes.items() if k in RULE_FIELDS}
    found = get_photo(pid, include_hidden=True)
    if not found:
        return None
    row, _ = found
    with durable.tx() as c:
        current = c.execute(select(photo_rules).where(photo_rules.c.sha256 == row["sha256"])).mappings().first()
        merged = {f: (current[f] if current else None) for f in RULE_FIELDS}
        for k, v in allowed.items():
            merged[k] = None if v is None else bool(v)
        values = {"sha256": row["sha256"], "rel_path": row["rel_path"], **merged,
                  "reason": (reason or (current["reason"] if current else None) or None),
                  "updated_at": time.time()}
        if merged.get("hidden") is False and values["reason"] == REVIEW_REASON:
            values["reason"] = None
        durable.upsert(c, photo_rules, values, ["sha256"])
        bump("rules_version", conn=c)
    return get_photo(pid, include_hidden=True)[1]


def publish_pending() -> int:
    """Publica as fotos que aguardavam revisão."""
    with durable.tx() as c:
        pending = c.execute(select(photo_rules).where(photo_rules.c.reason == REVIEW_REASON)).mappings().all()
        for rule in pending:
            values = dict(rule, hidden=False, reason=None, updated_at=time.time())
            durable.upsert(c, photo_rules, values, ["sha256"])
        if pending:
            bump("rules_version", conn=c)
    return len(pending)


# ---------------------------------------------------------------------------
# Exportar / restaurar configurações editoriais
# ---------------------------------------------------------------------------
def export_rules() -> list[dict]:
    with durable.tx() as c:
        rules = [dict(r) for r in c.execute(select(photo_rules).order_by(photo_rules.c.rel_path)).mappings()]
    return [{"sha256": r["sha256"], "rel_path": r["rel_path"], "hidden": r["hidden"],
             "downloadable": r["downloadable"], "face_search": r["face_search"], "reason": r["reason"]}
            for r in rules]


def import_rules(entries: list) -> int:
    cleaned = [r for r in (_clean_rule(e) for e in entries) if r and r.get("sha256") and r.get("rel_path")]
    with durable.tx() as c:
        for r in cleaned:
            durable.upsert(c, photo_rules, {"sha256": r["sha256"], "rel_path": r["rel_path"],
                                            "hidden": r["hidden"], "downloadable": r["downloadable"],
                                            "face_search": r["face_search"], "reason": r["reason"],
                                            "updated_at": time.time()}, ["sha256"])
        bump("rules_version", conn=c)
    return len(cleaned)
