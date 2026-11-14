"""Acesso ao SQLite do catálogo e ao banco biométrico (arquivos separados)."""
from __future__ import annotations

import os
import sqlite3
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path
from typing import Iterator

from .config import settings

CATALOG_SCHEMA = """
CREATE TABLE IF NOT EXISTS photos(
  id TEXT PRIMARY KEY,
  rel_path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  category TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mtime REAL NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  taken_at TEXT,
  sort_key TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1a1009',
  is_raw INTEGER NOT NULL DEFAULT 0,
  version TEXT NOT NULL,
  indexed_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_sort ON photos(sort_key);
CREATE INDEX IF NOT EXISTS idx_photos_category ON photos(category, sort_key);

-- Decisões editoriais por arquivo; sobrevivem a reindexações.
CREATE TABLE IF NOT EXISTS photo_settings(
  rel_path TEXT PRIMARY KEY,
  hidden INTEGER,
  downloadable INTEGER,
  face_search INTEGER,
  updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

FACES_SCHEMA = """
CREATE TABLE IF NOT EXISTS faces(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id TEXT NOT NULL,
  score REAL NOT NULL,
  nonce BLOB NOT NULL,
  embedding BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_faces_photo ON faces(photo_id);

CREATE TABLE IF NOT EXISTS face_photos(
  photo_id TEXT PRIMARY KEY,
  photo_version TEXT NOT NULL,
  faces INTEGER NOT NULL,
  indexed_at REAL NOT NULL
);

-- Pessoas que pediram para não ser localizadas (oposição — LGPD art. 18).
CREATE TABLE IF NOT EXISTS optouts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at REAL NOT NULL,
  nonce BLOB NOT NULL,
  embedding BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def _session(path: Path) -> Iterator[sqlite3.Connection]:
    conn = _connect(path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def catalog() -> AbstractContextManager[sqlite3.Connection]:
    return _session(settings.catalog_db)


def faces() -> AbstractContextManager[sqlite3.Connection]:
    return _session(settings.faces_db)


def init() -> None:
    with catalog() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(CATALOG_SCHEMA)
    init_faces()


def init_faces() -> None:
    with faces() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(FACES_SCHEMA)
    for suffix in ("", "-wal", "-shm"):
        file = Path(str(settings.faces_db) + suffix)
        if file.exists():
            try:
                os.chmod(file, 0o600)
            except OSError:
                pass


def get_meta(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
