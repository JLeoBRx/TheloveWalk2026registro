"""Busca de fotografias por reconhecimento facial (selfie do próprio visitante)."""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import catalog, faces, imaging
from .config import face_data_expires_at, settings
from .security import RateLimiter, client_key

router = APIRouter()
CONSENT_VERSION = "2026-11-v1"
limiter = RateLimiter(settings.search_rate_limit, settings.search_rate_window)
NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def _error(code: str, status: int, **extra) -> JSONResponse:
    return JSONResponse({"status": "error", "code": code, **extra}, status_code=status, headers=NO_STORE)


@router.get("/api/faces/status")
def face_status() -> JSONResponse:
    available, reason = faces.search_available()
    return JSONResponse({
        "available": available,
        "reason": reason,
        "consent_version": CONSENT_VERSION,
        "expires_at": face_data_expires_at().date().isoformat(),
        "max_upload_mb": settings.max_upload_bytes // (1024 * 1024),
    }, headers=NO_STORE)


def _run_search(data: bytes, face_index: int | None) -> dict:
    img = imaging.decode_upload(data, max_side=1600)
    try:
        bgr, detected = faces.analyze_query(img)
        if len(detected) > 1 and face_index is None:
            return {"status": "choose_face", "faces": faces.public_boxes(detected[:12], img.size)}
        index = face_index or 0
        if index < 0 or index >= len(detected):
            raise faces.FaceSearchError("invalid_face_index", 400)
        vec = faces.engine.embed(bgr, detected[index])
        ranked = faces.search(vec)
        del vec, bgr
    finally:
        img.close()
    if not ranked:
        return {"status": "ok", "total": 0, "items": []}
    threshold = settings.face_match_threshold
    items = []
    for pid, sim in ranked:
        found = catalog.get_photo(pid)
        if not found:
            continue
        row, eff = found
        item = catalog.public_payload(row, eff)
        # Somente uma faixa qualitativa; a pontuação exata não é exposta.
        item["match"] = "alta" if sim >= threshold + 0.12 else "provavel"
        items.append(item)
    return {"status": "ok", "total": len(items), "items": items}


@router.post("/api/faces/search")
async def face_search(
    request: Request,
    image: UploadFile = File(...),
    consent: str = Form(...),
    consent_version: str = Form(""),
    face: int | None = Form(None),
) -> JSONResponse:
    available, reason = faces.search_available()
    if not available:
        return _error(f"face_search_{reason}", 410 if reason == "expired" else 503)
    if consent.strip().lower() != "true" or consent_version != CONSENT_VERSION:
        return _error("consent_required", 400)
    wait = limiter.check(client_key(request))
    if wait:
        return JSONResponse({"status": "error", "code": "too_many_searches", "retry_after": wait},
                            status_code=429, headers={**NO_STORE, "Retry-After": str(wait)})
    data = await image.read(settings.max_upload_bytes + 1)
    await image.close()
    if len(data) > settings.max_upload_bytes:
        return _error("file_too_large", 413)
    try:
        result = await run_in_threadpool(_run_search, data, face)
    except imaging.ImageError:
        return _error("invalid_image", 400)
    except faces.FaceSearchError as exc:
        return _error(exc.code, exc.status)
    except HTTPException:
        raise
    except Exception as exc:  # nunca registra conteúdo da imagem
        print(f"[busca-facial] falha: {type(exc).__name__}", flush=True)
        return _error("face_search_failed", 500)
    finally:
        del data
    return JSONResponse(result, headers=NO_STORE)
