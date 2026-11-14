"""API pública do álbum e entrega das imagens."""
from __future__ import annotations

from pathlib import PurePosixPath

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from . import catalog, durable, faces, jobs, playlist
from .config import face_data_expires_at, load_event, load_privacy, settings
from .storage import store

router = APIRouter()


def _etag(request: Request, tag: str, payload: dict, max_age: int = 15) -> Response:
    etag = f'W/"{tag}"'
    headers = {"ETag": etag, "Cache-Control": f"public, max-age={max_age}, stale-while-revalidate=60"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(payload, headers=headers)


@router.get("/api/health")
def health() -> dict:
    """Verificação leve usada pelo Render (processo vivo)."""
    return {"status": "ok"}


@router.get("/api/status")
def status() -> dict:
    available, reason = faces.search_state()
    rows, _ = catalog.visible_rows()
    return {
        "status": "ok",
        "service": "FJU Night — A Noite da Herança",
        "photos": len(rows),
        "indexing": {k: jobs.STATUS[k] for k in ("running", "phase", "done", "total")},
        "face_search": {"available": available, "reason": reason},
    }


@router.get("/api/event")
def event(request: Request) -> Response:
    version = catalog.version_tag()
    rows, _ = catalog.visible_rows()
    available, reason = faces.search_state()
    tracks = playlist.tracks()
    payload = {
        "event": load_event(),
        "photos_total": len(rows),
        "categories": catalog.categories(),
        "catalog_version": version,
        "indexing": jobs.STATUS["running"],
        "face_search": {"available": available, "reason": reason,
                        "expires_at": face_data_expires_at().date().isoformat()},
        "playlist": {"tracks": len(tracks)},
    }
    tag = f"ev-{version}-{available}-{reason}-{jobs.STATUS['running']}-{playlist.version()}"
    return _etag(request, tag, payload, max_age=10)


@router.get("/api/privacy")
def privacy() -> dict:
    """Informações públicas da política de privacidade (preenchidas pelo controlador)."""
    status = faces.authorization_status()
    return {
        "privacy": load_privacy(),
        "event": {k: load_event()[k] for k in ("name", "theme", "date_label")},
        "face_search": {
            "authorized": status["authorized"],
            "expires_at": face_data_expires_at().date().isoformat(),
            "retention_days": settings.face_retention_days,
        },
        "retention_receipt": bool(durable.kv_get_json("retention_receipt")),
    }


@router.get("/api/playlist")
def get_playlist() -> dict:
    return {"tracks": playlist.tracks()}


@router.get("/api/photos")
def photos(
    request: Request,
    offset: int = Query(0, ge=0, le=1_000_000),
    limit: int = Query(60, ge=1, le=120),
    category: str | None = Query(None, max_length=255),
) -> Response:
    category = category or None
    version = catalog.version_tag()
    rows, effs = catalog.visible_rows(category)
    items = []
    for i, row in enumerate(rows[offset: offset + limit]):
        item = catalog.public_payload(row, effs[row["id"]])
        item["position"] = offset + i
        items.append(item)
    nxt = offset + len(items)
    payload = {"items": items, "total": len(rows), "offset": offset, "limit": limit,
               "next_offset": nxt if nxt < len(rows) else None, "category": category, "version": version}
    return _etag(request, f"p-{version}-{category}-{offset}-{limit}", payload)


@router.get("/api/photos/{pid}")
def photo(pid: str) -> dict:
    found = catalog.get_photo(pid)
    if not found:
        raise HTTPException(404, detail="photo_not_found")
    row, eff = found
    rows, _ = catalog.visible_rows()
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
def _visible(pid: str) -> tuple[dict, catalog.Effective]:
    found = catalog.get_photo(pid)
    if not found:
        raise HTTPException(404, detail="photo_not_found")
    return found


def _download_name(filename: str, suffix: str | None = None) -> str:
    stem, ext = PurePosixPath(filename).stem, suffix or PurePosixPath(filename).suffix.lower()
    safe = "".join(ch if ch.isascii() and (ch.isalnum() or ch in "-_") else "-" for ch in stem).strip("-") or "foto"
    return f"FJUNight-A-Noite-da-Heranca_{safe}{ext}"


@router.get("/media/thumb/{pid}.webp")
def thumb(pid: str, request: Request) -> Response:
    row, _ = _visible(pid)
    key = catalog.keys_for(pid, row["version"])["thumb"]
    return store().derivative_response(key, "image/webp", immutable=request.query_params.get("v") == row["version"])


@router.get("/media/display/{pid}.webp")
def display(pid: str, request: Request) -> Response:
    row, _ = _visible(pid)
    key = catalog.keys_for(pid, row["version"])["display"]
    return store().derivative_response(key, "image/webp", immutable=request.query_params.get("v") == row["version"])


@router.get("/media/download/{pid}")
def download(pid: str) -> Response:
    """Arquivo em alta qualidade: o original (JPEG/PNG/WebP) ou, para RAW, o JPEG da câmera."""
    row, eff = _visible(pid)
    if not eff.downloadable:
        raise HTTPException(403, detail="download_not_allowed")
    if row["is_raw"]:
        if row["has_camera_jpeg"]:
            key = catalog.keys_for(pid, row["version"])["camera_jpeg"]
            return store().derivative_response(key, "image/jpeg", immutable=False,
                                               download_name=_download_name(row["filename"], ".jpg"))
        return store().original_response(row["rel_path"], _download_name(row["filename"]),
                                         media_type="application/octet-stream")
    return store().original_response(row["rel_path"], _download_name(row["filename"]))


@router.get("/media/original/{pid}")
def original(pid: str) -> Response:
    """Arquivo RAW original da câmera, intacto, quando autorizado."""
    row, eff = _visible(pid)
    if not catalog.raw_original_allowed(row, eff):
        raise HTTPException(403, detail="download_not_allowed")
    return store().original_response(row["rel_path"], _download_name(row["filename"]),
                                     media_type="application/octet-stream")
