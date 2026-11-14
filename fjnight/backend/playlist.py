"""Playlist da FJU Night: independente da Love Walk.

Fonte: banco durável (editada no painel) ou, se vazia, config/playlist.json.
Aceita vídeos ou playlists do YouTube (ex.: do canal oficial da FJU); nada é baixado ou hospedado.
"""
from __future__ import annotations

import json
import re
import time
from urllib.parse import parse_qs, urlparse

from . import durable
from .config import settings

YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
YOUTUBE_LIST = re.compile(r"^(PL|OL|UU|FL|LL)[A-Za-z0-9_-]{10,62}$")
MAX_TRACKS = 40


def parse_youtube_id(value: str) -> str | None:
    """Aceita o ID ou links youtube.com/watch?v=, youtu.be/, /embed/, /shorts/."""
    value = (value or "").strip()
    if YOUTUBE_ID.fullmatch(value):
        return value
    try:
        url = urlparse(value)
    except ValueError:
        return None
    host = (url.hostname or "").lower()
    candidate = None
    if host in {"youtu.be", "www.youtu.be"}:
        candidate = url.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        if url.path == "/watch":
            candidate = (parse_qs(url.query).get("v") or [None])[0]
        else:
            parts = [p for p in url.path.split("/") if p]
            if len(parts) >= 2 and parts[0] in {"embed", "shorts", "live", "v"}:
                candidate = parts[1]
    return candidate if candidate and YOUTUBE_ID.fullmatch(candidate) else None


def parse_youtube_list(value: str) -> str | None:
    """Aceita o ID de uma playlist (PL...) ou um link youtube.com/playlist?list=..."""
    value = (value or "").strip()
    if YOUTUBE_LIST.fullmatch(value):
        return value
    try:
        url = urlparse(value)
    except ValueError:
        return None
    host = (url.hostname or "").lower()
    if not (host.endswith("youtube.com") or host.endswith("youtube-nocookie.com")):
        return None
    if url.path not in ("/playlist", "/embed/videoseries"):
        return None  # links de vídeo dentro de uma playlist valem como vídeo único
    candidate = (parse_qs(url.query).get("list") or [None])[0]
    return candidate if candidate and YOUTUBE_LIST.fullmatch(candidate) else None


def validate(entries: list) -> list[dict]:
    if not isinstance(entries, list):
        raise ValueError("playlist_invalid")
    out = []
    for e in entries[:MAX_TRACKS]:
        if not isinstance(e, dict):
            raise ValueError("playlist_invalid")
        raw = str(e.get("youtube_id") or e.get("list_id") or e.get("url") or "")
        vid = parse_youtube_id(raw)
        lst = None if vid else parse_youtube_list(raw)
        title = str(e.get("title") or "").strip()[:120]
        if not (vid or lst) or not title:
            raise ValueError("playlist_track_invalid")
        item = {"title": title, "artist": str(e.get("artist") or "").strip()[:120]}
        item.update({"youtube_id": vid} if vid else {"list_id": lst})
        out.append(item)
    return out


def _file_tracks() -> list[dict]:
    path = settings.config_dir / "playlist.json"
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return validate(data.get("tracks", []) if isinstance(data, dict) else data)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[playlist] config/playlist.json ignorado: {exc}", flush=True)
        return []


def tracks() -> list[dict]:
    stored = durable.kv_get_json("playlist")
    if isinstance(stored, dict) and isinstance(stored.get("tracks"), list):
        return stored["tracks"]
    return _file_tracks()


def version() -> str:
    stored = durable.kv_get_json("playlist")
    return str(stored.get("updated_at", "0")) if isinstance(stored, dict) else "file"


def save(entries: list) -> list[dict]:
    cleaned = validate(entries)
    durable.kv_set_json("playlist", {"tracks": cleaned, "updated_at": time.time()})
    return cleaned
