"""Busca de fotografias por reconhecimento facial (selfie do próprio visitante).

A imagem chega como corpo bruto (image/jpeg, image/png ou image/webp) e é lida
somente em memória — não há multipart, arquivo temporário ou gravação em disco.
O consentimento vai nos cabeçalhos X-Consent e X-Consent-Version.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import catalog, faces, imaging
from .config import face_data_expires_at, settings
from .security import ALLOWED_IMAGE_TYPES, RateLimiter, client_ip, read_limited_body

router = APIRouter()
CONSENT_VERSION = "2026-11-v2"
limiter = RateLimiter(settings.search_rate_limit, settings.search_rate_window)
NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def _error(code: str, status: int, **extra) -> JSONResponse:
    return JSONResponse({"status": "error", "code": code, **extra}, status_code=status, headers=NO_STORE)


@router.get("/api/faces/status")
def face_status() -> JSONResponse:
    available, reason = faces.search_state()
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
    high = settings.face_match_threshold + settings.face_high_margin
    items = []
    for pid, sim in ranked:
        found = catalog.get_photo(pid)
        if not found:
            continue
        item = catalog.public_payload(*found)
        item["match"] = "alta" if sim >= high else "provavel"   # nunca a pontuação exata
        items.append(item)
    return {"status": "ok", "total": len(items), "items": items}


@router.post("/api/faces/search")
async def face_search(request: Request, face: int | None = Query(None, ge=0, le=50)) -> JSONResponse:
    available, reason = faces.search_state()
    if not available:
        return _error(f"face_search_{reason}", 410 if reason == "expired" else 503)
    if request.headers.get("x-consent", "").lower() != "true" or \
            request.headers.get("x-consent-version", "") != CONSENT_VERSION:
        return _error("consent_required", 400)
    wait = limiter.check(client_ip(request))
    if wait:
        return JSONResponse({"status": "error", "code": "too_many_searches", "retry_after": wait},
                            status_code=429, headers={**NO_STORE, "Retry-After": str(wait)})
    try:
        data = await read_limited_body(request, settings.max_upload_bytes, ALLOWED_IMAGE_TYPES)
    except HTTPException as exc:
        return _error("file_too_large" if exc.status_code == 413 else "invalid_image", exc.status_code)
    try:
        result = await run_in_threadpool(_run_search, data, face)
    except imaging.ImageError:
        return _error("invalid_image", 400)
    except faces.FaceSearchError as exc:
        return _error(exc.code, exc.status)
    except Exception as exc:  # nunca registra conteúdo da imagem
        print(f"[busca-facial] falha: {type(exc).__name__}", flush=True)
        return _error("face_search_failed", 500)
    finally:
        del data
    return JSONResponse(result, headers=NO_STORE)
