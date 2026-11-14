"""API pública do álbum e entrega das imagens."""
from __future__ import annotations

import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse

from . import catalog, faces, imaging, jobs
from .config import face_data_expires_at, load_event, settings

router = APIRouter()

# Cache da lista pública (recalculada só quando catálogo ou regras mudam)
_cache_lock = threading.Lock()
_cache: dict[tuple, tuple[list, dict]] = {}


def _rules_mtime() -> float:
    try:
        return catalog.rules_path().stat().st_mtime
    except OSError:
        return 0.0


def visible(category: str | None) -> tuple[str, list, dict]:
    version = catalog.catalog_version()
    key = (version, _rules_mtime(), category)
    with _cache_lock:
        hit = _cache.get(key)
    if hit is None:
        hit = catalog.visible_rows(category)
        with _cache_lock:
            if len(_cache) > 64:
                _cache.clear()
            _cache[key] = hit
    return f"{version}.{int(key[1])}", hit[0], hit[1]


def _etag(request: Request, tag: str, payload: dict, max_age: int = 15) -> Response:
    etag = f'W/"{tag}"'
    headers = {"ETag": etag, "Cache-Control": f"public, max-age={max_age}, stale-while-revalidate=60"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(payload, headers=headers)


@router.get("/api/status")
def status() -> dict:
    available, reason = faces.search_available()
    _, rows, _ = visible(None)
    return {
        "status": "ok",
        "service": "FJ Night — A Noite da Herança",
        "photos": len(rows),
        "indexing": {k: jobs.STATUS[k] for k in ("running", "phase", "done", "total")},
        "face_search": {"available": available, "reason": reason},
    }


@router.get("/api/event")
def event(request: Request) -> Response:
    version, rows, _ = visible(None)
    available, reason = faces.search_available()
    payload = {
        "event": load_event(),
        "photos_total": len(rows),
        "categories": catalog.categories(),
        "catalog_version": version,
        "indexing": jobs.STATUS["running"],
        "face_search": {
            "available": available,
            "reason": reason,
            "expires_at": face_data_expires_at().date().isoformat(),
            "retention_days": settings.face_retention_days,
        },
    }
    return _etag(request, f"ev-{version}-{available}-{jobs.STATUS['running']}", payload, max_age=10)


@router.get("/api/photos")
def photos(
    request: Request,
    offset: int = Query(0, ge=0, le=1_000_000),
    limit: int = Query(60, ge=1, le=120),
    category: str | None = Query(None, max_length=120),
) -> Response:
    category = category or None
    version, rows, effs = visible(category)
    page = rows[offset: offset + limit]
    items = [catalog.public_payload(r, effs[r["id"]]) for r in page]
    for i, item in enumerate(items):
        item["position"] = offset + i
    nxt = offset + len(items)
    payload = {
        "items": items,
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "next_offset": nxt if nxt < len(rows) else None,
        "category": category,
        "version": version,
    }
    return _etag(request, f"p-{version}-{category}-{offset}-{limit}", payload)


@router.get("/api/photos/{pid}")
def photo(pid: str) -> dict:
    found = catalog.get_photo(pid)
    if not found:
        raise HTTPException(404, detail="photo_not_found")
    row, eff = found
    _, rows, _ = visible(None)
    payload = catalog.public_payload(row, eff)
    payload["position"] = next((i for i, r in enumerate(rows) if r["id"] == pid), None)
    payload["total"] = len(rows)
    return payload


@router.get("/api/categories")
def categories() -> dict:
    return {"categories": catalog.categories()}


# ---------------------------------------------------------------------------
# Mídia
# ---------------------------------------------------------------------------
IMMUTABLE = "public, max-age=31536000, immutable"


def _media_headers(request: Request, version: str) -> dict:
    fresh = request.query_params.get("v") == version
    return {"Cache-Control": IMMUTABLE if fresh else "public, max-age=3600", "X-Content-Type-Options": "nosniff"}


def _visible_photo(pid: str) -> tuple[dict, catalog.Effective]:
    if len(pid) != 20 or not pid.isalnum():
        raise HTTPException(404, detail="photo_not_found")
    found = catalog.get_photo(pid)
    if not found:
        raise HTTPException(404, detail="photo_not_found")
    return found


@router.get("/media/thumb/{pid}.webp")
def thumb(pid: str, request: Request) -> FileResponse:
    row, _ = _visible_photo(pid)
    path, _ = catalog.derivative_paths(pid)
    if not path.is_file():
        raise HTTPException(404, detail="thumbnail_not_ready")
    return FileResponse(path, media_type="image/webp", headers=_media_headers(request, row["version"]))


@router.get("/media/display/{pid}.webp")
def display(pid: str, request: Request) -> FileResponse:
    row, _ = _visible_photo(pid)
    _, path = catalog.derivative_paths(pid)
    if not path.is_file():
        raise HTTPException(404, detail="image_not_ready")
    return FileResponse(path, media_type="image/webp", headers=_media_headers(request, row["version"]))


def _download_name(filename: str, suffix: str | None = None) -> str:
    stem, ext = Path(filename).stem, suffix or Path(filename).suffix.lower()
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in stem).strip("-") or "foto"
    return f"FJNight-A-Noite-da-Heranca_{safe}{ext}"


@router.get("/media/download/{pid}")
def download(pid: str) -> FileResponse:
    row, eff = _visible_photo(pid)
    if not eff.downloadable:
        raise HTTPException(403, detail="download_not_allowed")
    source = (settings.photo_dir / row["rel_path"]).resolve()
    if settings.photo_dir not in source.parents or not source.is_file():
        raise HTTPException(404, detail="photo_not_found")
    headers = {"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"}
    if imaging.is_raw(source):
        cached = settings.raw_jpeg_dir / f"{pid}.jpg"
        if not cached.is_file():
            extracted = imaging.extract_raw_jpeg(source)
            if extracted is None:
                # Sem JPEG embutido: entrega a versão de exibição em alta qualidade.
                _, display_path = catalog.derivative_paths(pid)
                return FileResponse(display_path, media_type="image/webp", headers=headers,
                                    filename=_download_name(row["filename"], ".webp"))
            tmp = cached.with_suffix(".tmp")
            tmp.write_bytes(extracted[0])
            tmp.replace(cached)
        return FileResponse(cached, media_type="image/jpeg", headers=headers,
                            filename=_download_name(row["filename"], ".jpg"))
    return FileResponse(source, headers=headers, filename=_download_name(row["filename"]))
