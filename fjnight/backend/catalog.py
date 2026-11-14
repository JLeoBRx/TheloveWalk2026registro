"""Catálogo de fotografias: varredura incremental, regras editoriais e consultas."""
from __future__ import annotations

import fnmatch
import hashlib
import json
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import db, imaging
from .config import settings

IGNORED_NAMES = {"leia-me.md", "readme.md", ".gitkeep", "thumbs.db", ".ds_store"}
RULE_KEYS = ("ocultas", "sem_download", "sem_busca_facial")
_rules_lock = threading.Lock()
_rules_cache: tuple[float, dict[str, list[str]]] | None = None


def photo_id(rel: str) -> str:
    return hashlib.sha256(rel.encode("utf-8")).hexdigest()[:20]


def category_of(rel: str) -> str:
    parts = Path(rel).parts
    return parts[0] if len(parts) > 1 else ""


def category_label(name: str) -> str:
    """'01 - Louvor' -> 'Louvor' (o prefixo numérico serve só para ordenar)."""
    label = re.sub(r"^\s*\d+\s*[-_.)]?\s*", "", name).strip()
    return label or name


# ---------------------------------------------------------------------------
# Regras versionadas (config/photo-rules.json)
# ---------------------------------------------------------------------------
def rules_path() -> Path:
    return settings.config_dir / "photo-rules.json"


def load_rules() -> dict[str, list[str]]:
    global _rules_cache
    path = rules_path()
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return {k: [] for k in RULE_KEYS}
    with _rules_lock:
        if _rules_cache and _rules_cache[0] == mtime:
            return _rules_cache[1]
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[catalogo] photo-rules.json inválido: {exc}", flush=True)
            raw = {}
        rules = {k: [str(x) for x in raw.get(k, []) if isinstance(x, str)] for k in RULE_KEYS}
        _rules_cache = (mtime, rules)
        return rules


def _matches(rel: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(rel, p) or rel == p for p in patterns)


@dataclass
class Effective:
    hidden: bool
    downloadable: bool
    face_search: bool


def effective_settings(rel: str, row_settings: dict | None, rules: dict[str, list[str]] | None = None) -> Effective:
    rules = rules if rules is not None else load_rules()
    hidden = _matches(rel, rules["ocultas"])
    downloadable = settings.downloads_default and not _matches(rel, rules["sem_download"])
    face_search = not _matches(rel, rules["sem_busca_facial"])
    if row_settings:
        if row_settings.get("hidden") is not None:
            hidden = bool(row_settings["hidden"])
        if row_settings.get("downloadable") is not None:
            downloadable = bool(row_settings["downloadable"])
        if row_settings.get("face_search") is not None:
            face_search = bool(row_settings["face_search"])
    return Effective(hidden, downloadable, face_search)


# ---------------------------------------------------------------------------
# Indexação
# ---------------------------------------------------------------------------
def list_source_files() -> list[Path]:
    root = settings.photo_dir
    files: list[Path] = []
    for path in root.rglob("*"):
        rel_parts = path.relative_to(root).parts
        if any(part.startswith(".") for part in rel_parts):
            continue
        if path.name.lower() in IGNORED_NAMES or path.is_symlink() or not path.is_file():
            continue
        if path.suffix.lower() in imaging.SUPPORTED_EXTENSIONS:
            files.append(path)
    return sorted(files)


def derivative_paths(pid: str) -> tuple[Path, Path]:
    return settings.thumbs_dir / f"{pid}.webp", settings.display_dir / f"{pid}.webp"


def _bump_version(conn) -> str:
    version = hashlib.sha1(f"{time.time_ns()}".encode()).hexdigest()[:12]
    db.set_meta(conn, "catalog_version", version)
    return version


def catalog_version() -> str:
    with db.catalog() as c:
        return db.get_meta(c, "catalog_version", "0")


def index_catalog(progress: Callable[[int, int, str], None] | None = None) -> dict:
    files = list_source_files()
    total = len(files)
    processed = skipped = errors = 0
    found: set[str] = set()
    root = settings.photo_dir
    with db.catalog() as c:
        known = {r["rel_path"]: r for r in c.execute("SELECT id, rel_path, file_size, mtime FROM photos")}
    for position, source in enumerate(files, start=1):
        rel = source.relative_to(root).as_posix()
        try:
            resolved = source.resolve(strict=True)
            if root not in resolved.parents:
                raise imaging.ImageError("arquivo fora da pasta de fotos")
            found.add(rel)
            stat = resolved.stat()
            pid = photo_id(rel)
            thumb, display = derivative_paths(pid)
            old = known.get(rel)
            if (old and old["file_size"] == stat.st_size and abs(old["mtime"] - stat.st_mtime) < 0.01
                    and thumb.is_file() and display.is_file()):
                skipped += 1
                continue
            loaded = imaging.load(resolved, settings.display_size)
            imaging.save_webp(loaded.image, display, settings.display_size, 84)
            imaging.save_webp(loaded.image, thumb, settings.thumb_size, 76)
            version = hashlib.sha1(f"{rel}|{stat.st_size}|{stat.st_mtime}".encode()).hexdigest()[:10]
            category = category_of(rel)
            sort_key = f"{category.lower()}|{loaded.taken_at or '9999'}|{source.name.lower()}"
            w, h = loaded.full_size
            with db.catalog() as c:
                c.execute(
                    """INSERT INTO photos(id, rel_path, filename, category, file_size, mtime, width, height,
                         taken_at, sort_key, color, is_raw, version, indexed_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET rel_path=excluded.rel_path, filename=excluded.filename,
                         category=excluded.category, file_size=excluded.file_size, mtime=excluded.mtime,
                         width=excluded.width, height=excluded.height, taken_at=excluded.taken_at,
                         sort_key=excluded.sort_key, color=excluded.color, is_raw=excluded.is_raw,
                         version=excluded.version, indexed_at=excluded.indexed_at""",
                    (pid, rel, source.name, category, stat.st_size, stat.st_mtime, int(w), int(h),
                     loaded.taken_at, sort_key, imaging.average_color(loaded.image),
                     int(imaging.is_raw(source)), version, time.time()),
                )
            (settings.raw_jpeg_dir / f"{pid}.jpg").unlink(missing_ok=True)
            processed += 1
        except Exception as exc:
            errors += 1
            print(f"[catalogo] {rel}: {type(exc).__name__}: {exc}", flush=True)
        finally:
            if progress:
                progress(position, total, rel)

    removed = 0
    with db.catalog() as c:
        for rel, row in known.items():
            if rel not in found:
                c.execute("DELETE FROM photos WHERE id=?", (row["id"],))
                for path in (*derivative_paths(row["id"]), settings.raw_jpeg_dir / f"{row['id']}.jpg"):
                    path.unlink(missing_ok=True)
                removed += 1
        if processed or removed or db.get_meta(c, "catalog_version", "") == "":
            _bump_version(c)
    return {"found": total, "processed": processed, "unchanged": skipped, "removed": removed, "errors": errors}


# ---------------------------------------------------------------------------
# Consultas
# ---------------------------------------------------------------------------
def _settings_map(conn) -> dict[str, dict]:
    return {r["rel_path"]: dict(r) for r in conn.execute("SELECT * FROM photo_settings")}


def public_payload(row, eff: Effective) -> dict:
    pid, v = row["id"], row["version"]
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
    }


def visible_rows(category: str | None = None) -> tuple[list, dict[str, Effective]]:
    """Linhas públicas (não ocultas) na ordem do álbum, com as permissões efetivas."""
    rules = load_rules()
    with db.catalog() as c:
        smap = _settings_map(c)
        if category is None:
            rows = c.execute("SELECT * FROM photos ORDER BY sort_key, filename").fetchall()
        else:
            rows = c.execute("SELECT * FROM photos WHERE category=? ORDER BY sort_key, filename", (category,)).fetchall()
    out, effs = [], {}
    for row in rows:
        eff = effective_settings(row["rel_path"], smap.get(row["rel_path"]), rules)
        if not eff.hidden:
            out.append(row)
            effs[row["id"]] = eff
    return out, effs


def categories() -> list[dict]:
    rows, _ = visible_rows()
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["category"]] = counts.get(row["category"], 0) + 1
    return [
        {"id": name, "label": category_label(name) if name else "Outras", "count": n}
        for name, n in sorted(counts.items(), key=lambda kv: (kv[0] == "", kv[0].lower()))
    ]


def get_photo(pid: str, include_hidden: bool = False) -> tuple[dict, Effective] | None:
    with db.catalog() as c:
        row = c.execute("SELECT * FROM photos WHERE id=?", (pid,)).fetchone()
        if not row:
            return None
        srow = c.execute("SELECT * FROM photo_settings WHERE rel_path=?", (row["rel_path"],)).fetchone()
    eff = effective_settings(row["rel_path"], dict(srow) if srow else None)
    if eff.hidden and not include_hidden:
        return None
    return dict(row), eff


def update_settings(pid: str, **changes: bool | None) -> Effective | None:
    allowed = {k: v for k, v in changes.items() if k in {"hidden", "downloadable", "face_search"}}
    with db.catalog() as c:
        row = c.execute("SELECT rel_path FROM photos WHERE id=?", (pid,)).fetchone()
        if not row:
            return None
        current = c.execute("SELECT * FROM photo_settings WHERE rel_path=?", (row["rel_path"],)).fetchone()
        merged = {"hidden": None, "downloadable": None, "face_search": None}
        if current:
            merged.update({k: current[k] for k in merged})
        for key, value in allowed.items():
            merged[key] = None if value is None else int(bool(value))
        c.execute(
            """INSERT INTO photo_settings(rel_path, hidden, downloadable, face_search, updated_at)
               VALUES(?,?,?,?,?) ON CONFLICT(rel_path) DO UPDATE SET hidden=excluded.hidden,
               downloadable=excluded.downloadable, face_search=excluded.face_search, updated_at=excluded.updated_at""",
            (row["rel_path"], merged["hidden"], merged["downloadable"], merged["face_search"], time.time()),
        )
        _bump_version(c)
        return effective_settings(row["rel_path"], merged)


def export_rules() -> dict:
    """Gera um photo-rules.json com as decisões atuais (arquivo + painel)."""
    rules = load_rules()
    with db.catalog() as c:
        smap = _settings_map(c)
        rels = [r["rel_path"] for r in c.execute("SELECT rel_path FROM photos ORDER BY rel_path")]
    out = {k: [] for k in RULE_KEYS}
    for rel in rels:
        eff = effective_settings(rel, smap.get(rel), rules)
        if eff.hidden:
            out["ocultas"].append(rel)
        if not eff.downloadable and settings.downloads_default:
            out["sem_download"].append(rel)
        if not eff.face_search:
            out["sem_busca_facial"].append(rel)
    return {"_leia_me": "Copie este arquivo para fjnight/config/photo-rules.json e faça commit.", **out}
