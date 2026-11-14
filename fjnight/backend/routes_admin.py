"""Área administrativa: sessão, sincronização, curadoria, busca facial, playlist e configurações.

Toda rota exige sessão válida (cookie HttpOnly) e, para alterações, o cabeçalho
X-CSRF-Token. Toda operação que altera dados é registrada no histórico.
"""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import catalog, durable, faces, imaging, jobs, playlist, security
from .config import face_data_expires_at, load_privacy, privacy_fingerprint, settings
from .security import ALLOWED_IMAGE_TYPES, admin_required, client_ip, login_guard, require_durable
from .storage import store

public = APIRouter(prefix="/api/admin")
router = APIRouter(prefix="/api/admin", dependencies=[Depends(admin_required)])
NO_STORE = {"Cache-Control": "no-store"}
CONFIG_FORMAT = "fjunight-configuracao"


def _json(payload, status: int = 200) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers=NO_STORE)


# ---------------------------------------------------------------------------
# Sessão
# ---------------------------------------------------------------------------
class LoginBody(BaseModel):
    token: str = Field(max_length=500)


@public.post("/login")
async def login(body: LoginBody, request: Request) -> JSONResponse:
    if not settings.admin_configured:
        raise HTTPException(503, detail="admin_not_configured")
    ip = client_ip(request)
    wait = login_guard.blocked_for(ip)
    if wait:
        return _json({"detail": "too_many_login_attempts", "retry_after": wait}, 429)
    if not security.check_admin_token(body.token):
        login_guard.failure(ip)
        await asyncio.sleep(0.5)
        durable.audit("login", ok=False)
        raise HTTPException(401, detail="admin_unauthorized")
    login_guard.success(ip)
    token, session = security.create_session()
    durable.audit("login", ok=True)
    response = _json({"csrf": session.csrf, "expires_at": session.expires_at,
                      "idle_minutes": settings.session_idle_minutes})
    security.set_session_cookie(response, token, request)
    return response


@router.get("/session")
def session_info(request: Request) -> JSONResponse:
    s = request.state.admin
    return _json({"csrf": s.csrf, "expires_at": s.expires_at, "idle_expires_at": s.idle_expires_at,
                  "idle_minutes": settings.session_idle_minutes})


@router.post("/logout")
def logout(request: Request) -> JSONResponse:
    security.destroy_session(request)
    durable.audit("logout")
    response = _json({"status": "logged_out"})
    security.clear_session_cookie(response)
    return response


@router.post("/sessions/revoke-all")
def revoke_all_sessions() -> JSONResponse:
    security.destroy_all_sessions()
    durable.audit("sessions_revoked")
    response = _json({"status": "all_sessions_revoked"})
    security.clear_session_cookie(response)
    return response


# ---------------------------------------------------------------------------
# Situação e histórico
# ---------------------------------------------------------------------------
@router.get("/status")
def admin_status() -> JSONResponse:
    rows, effs = catalog.all_rows()
    visible = [r for r in rows if not effs[r["id"]].hidden]
    pending_review = sum(1 for r in rows if effs[r["id"]].reason == catalog.REVIEW_REASON and effs[r["id"]].hidden)
    try:
        storage_health = store().health()
    except Exception as exc:
        storage_health = {"ok": False, "kind": settings.storage_backend, "error": type(exc).__name__}
    auth = faces.authorization_status()
    return _json({
        "catalog": {
            "indexed": len(rows), "public": len(visible), "hidden": len(rows) - len(visible),
            "pending_review": pending_review, "raw": sum(1 for r in rows if r["is_raw"]),
            "no_download": sum(1 for r in visible if not effs[r["id"]].downloadable),
            "no_face_search": sum(1 for r in visible if not effs[r["id"]].face_search),
            "issues": len(catalog.issues()), "categories": catalog.categories(),
            "last_sync": durable.kv_get_json("last_sync"),
        },
        "persistence": {
            "database": durable.health(),
            "storage": storage_health,
            "production": settings.production,
            "admin_writes_allowed": settings.durable_storage,
        },
        "faces": {
            **auth,
            "search": dict(zip(("available", "reason"), faces.search_state())),
            "key": faces.key_status(),
            "local_index": faces.local_stats(),
            "optouts": len(faces.list_optouts()) if settings.durable_storage or not settings.production else 0,
            "threshold": settings.face_match_threshold,
            "retention_receipt": durable.kv_get_json("retention_receipt"),
        },
        "job": jobs.STATUS,
        "review_mode": settings.new_photos_require_review,
    })


@router.get("/history")
def history(limit: int = Query(50, ge=1, le=200)) -> JSONResponse:
    return _json({"items": durable.recent_audit(limit)})


# ---------------------------------------------------------------------------
# Sincronização e catálogo
# ---------------------------------------------------------------------------
class Confirm(BaseModel):
    confirm: bool = False


@router.post("/sync", status_code=202)
def sync(body: Confirm) -> JSONResponse:
    if not body.confirm:
        raise HTTPException(400, detail="confirmation_required")
    if not jobs.start_background(trigger="painel"):
        raise HTTPException(409, detail="index_already_running")
    return _json({"status": "started"}, 202)


@router.get("/issues")
def list_issues() -> JSONResponse:
    return _json({"items": catalog.issues()})


@router.get("/photos")
def list_photos(
    offset: int = Query(0, ge=0),
    limit: int = Query(48, ge=1, le=200),
    category: str | None = Query(None, max_length=255),
    q: str | None = Query(None, max_length=255),
    only: str | None = Query(None, pattern="^(hidden|pending|no_download|no_face_search)$"),
) -> JSONResponse:
    rows, effs = catalog.all_rows()
    items = []
    for row in rows:
        eff = effs[row["id"]]
        if category is not None and row["category"] != category:
            continue
        if q and q.lower() not in row["rel_path"].lower():
            continue
        if (only == "hidden" and not eff.hidden) or (only == "no_download" and eff.downloadable) \
                or (only == "no_face_search" and eff.face_search) \
                or (only == "pending" and eff.reason != catalog.REVIEW_REASON):
            continue
        items.append({"id": row["id"], "rel_path": row["rel_path"], "category": row["category"],
                      "w": row["width"], "h": row["height"], "is_raw": bool(row["is_raw"]),
                      "taken_at": row["taken_at"], "hidden": eff.hidden, "downloadable": eff.downloadable,
                      "face_search": eff.face_search, "reason": eff.reason,
                      "thumb": f"/api/admin/photos/{row['id']}/thumb"})
    return _json({"items": items[offset: offset + limit], "total": len(items), "offset": offset, "limit": limit})


@router.get("/photos/{pid}/thumb")
def admin_thumb(pid: str) -> Response:
    found = catalog.get_photo(pid, include_hidden=True)
    if not found:
        raise HTTPException(404, detail="photo_not_found")
    row, _ = found
    response = store().derivative_response(catalog.keys_for(pid, row["version"])["thumb"], "image/webp",
                                           immutable=False)
    response.headers["Cache-Control"] = "private, max-age=600"
    return response


class PhotoPatch(BaseModel):
    hidden: bool | None = None
    downloadable: bool | None = None
    face_search: bool | None = None
    reason: str | None = Field(None, max_length=500)


@router.patch("/photos/{pid}")
def patch_photo(pid: str, body: PhotoPatch) -> JSONResponse:
    require_durable()
    changes = body.model_dump(exclude_unset=True)
    reason = changes.pop("reason", None)
    if not changes:
        raise HTTPException(400, detail="no_changes")
    eff = catalog.update_rule(pid, changes, reason)
    if eff is None:
        raise HTTPException(404, detail="photo_not_found")
    durable.audit("photo_rule", photo=pid, **changes)
    if "face_search" in changes or "hidden" in changes:
        jobs.start_background(trigger="regra-de-foto")   # atualiza o índice facial, se autorizado
    return _json({"id": pid, "hidden": eff.hidden, "downloadable": eff.downloadable,
                  "face_search": eff.face_search, "reason": eff.reason})


@router.post("/photos/publish-pending")
def publish_pending(body: Confirm) -> JSONResponse:
    require_durable()
    if not body.confirm:
        raise HTTPException(400, detail="confirmation_required")
    count = catalog.publish_pending()
    durable.audit("publish_pending", published=count)
    return _json({"published": count})


# ---------------------------------------------------------------------------
# Busca facial: autorização, oposição, índice
# ---------------------------------------------------------------------------
@router.get("/faces/authorization")
def authorization() -> JSONResponse:
    return _json({
        **faces.authorization_status(),
        "checklist": faces.CHECKLIST,
        "privacy": load_privacy(),
        "privacy_fingerprint": privacy_fingerprint()[:12],
        "history": faces.authorization_history(),
    })


class AuthorizeBody(BaseModel):
    confirmed_by: str = Field(max_length=200)
    role: str = Field(max_length=200)
    checklist: dict[str, bool]


@router.post("/faces/authorize")
def authorize(body: AuthorizeBody) -> JSONResponse:
    require_durable()
    try:
        status = faces.authorize(body.confirmed_by, body.role, body.checklist)
    except faces.FaceSearchError as exc:
        durable.audit("face_authorize", ok=False, error=exc.code)
        raise HTTPException(exc.status, detail=exc.code)
    durable.audit("face_authorize", confirmed_by=body.confirmed_by, role=body.role)
    jobs.start_background(trigger="autorizacao")
    return _json(status)


class RevokeBody(BaseModel):
    confirm: str = ""
    by: str = Field("", max_length=200)
    reason: str = Field("", max_length=500)


@router.post("/faces/revoke")
def revoke(body: RevokeBody) -> JSONResponse:
    require_durable()
    if body.confirm != "REVOGAR":
        raise HTTPException(400, detail="confirmation_required")
    faces.revoke(body.by, body.reason)
    durable.audit("face_revoke", by=body.by, reason=body.reason)
    return _json(faces.authorization_status())


@router.post("/faces/optout")
async def optout(request: Request, face: int | None = Query(None, ge=0, le=50)) -> JSONResponse:
    """Registra a oposição de uma pessoa a partir de uma foto do rosto dela (não armazenada)."""
    require_durable()
    if request.headers.get("x-confirm") != "true":
        raise HTTPException(400, detail="confirmation_required")
    data = await security.read_limited_body(request, settings.max_upload_bytes, ALLOWED_IMAGE_TYPES)

    def work() -> dict:
        img = imaging.decode_upload(data, max_side=1600)
        try:
            bgr, detected = faces.analyze_query(img)
            if len(detected) > 1 and face is None:
                return {"status": "choose_face", "faces": faces.public_boxes(detected[:12], img.size)}
            idx = face or 0
            if not 0 <= idx < len(detected):
                raise faces.FaceSearchError("invalid_face_index", 400)
            return {"status": "registered", **faces.register_optout(faces.engine.embed(bgr, detected[idx]))}
        finally:
            img.close()

    try:
        result = await run_in_threadpool(work)
    except imaging.ImageError:
        raise HTTPException(400, detail="invalid_image")
    except faces.FaceSearchError as exc:
        raise HTTPException(exc.status, detail=exc.code)
    finally:
        del data
    if result["status"] == "registered":
        durable.audit("optout_registered", protocol=result["protocol"], faces_removed=result["faces_removed"])
    return _json(result)


@router.get("/faces/optouts")
def optouts() -> JSONResponse:
    return _json({"items": faces.list_optouts()})


class ConfirmText(BaseModel):
    confirm: str = ""
    include_optouts: bool = False


@router.delete("/faces/optouts/{protocol}")
def delete_optout(protocol: str, body: ConfirmText) -> JSONResponse:
    require_durable()
    if body.confirm != "REMOVER":
        raise HTTPException(400, detail="confirmation_required")
    if not faces.delete_optout(protocol):
        raise HTTPException(404, detail="optout_not_found")
    durable.audit("optout_removed", protocol=protocol)
    jobs.start_background(trigger="oposicao-removida")
    return _json({"status": "removed"})


@router.post("/faces/reindex", status_code=202)
def reindex(body: Confirm) -> JSONResponse:
    if not body.confirm:
        raise HTTPException(400, detail="confirmation_required")
    if jobs.STATUS["running"]:
        raise HTTPException(409, detail="index_already_running")
    if not faces.authorization_status()["authorized"]:
        raise HTTPException(409, detail="face_search_not_authorized")
    faces.purge_local_index()
    jobs.start_background(trigger="reconstrucao-facial")
    durable.audit("face_reindex")
    return _json({"status": "started"}, 202)


@router.delete("/faces")
def purge(body: ConfirmText) -> JSONResponse:
    if body.confirm != "APAGAR":
        raise HTTPException(400, detail="confirmation_required")
    if jobs.STATUS["running"]:
        raise HTTPException(409, detail="index_already_running")
    result = faces.purge_local_index()
    optouts_deleted = 0
    if body.include_optouts:
        require_durable()
        faces.revoke("painel", "Exclusão total dos dados faciais")
        for item in faces.list_optouts():
            optouts_deleted += int(faces.delete_optout(item["protocol"]))
    durable.audit("face_purge", include_optouts=body.include_optouts, optouts_deleted=optouts_deleted,
                  faces_deleted=result["faces_indexed"], file_removed=result["file_removed"])
    return _json({"status": "purged", **result, "optouts_deleted": optouts_deleted,
                  "local_index": faces.local_stats()})


# ---------------------------------------------------------------------------
# Playlist
# ---------------------------------------------------------------------------
class PlaylistBody(BaseModel):
    tracks: list[dict]


@router.get("/playlist")
def get_playlist() -> JSONResponse:
    return _json({"tracks": playlist.tracks()})


@router.put("/playlist")
def put_playlist(body: PlaylistBody) -> JSONResponse:
    require_durable()
    try:
        tracks = playlist.save(body.tracks)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    durable.audit("playlist_saved", tracks=len(tracks))
    return _json({"tracks": tracks})


# ---------------------------------------------------------------------------
# Exportar e restaurar configurações editoriais (sem biometria e sem segredos)
# ---------------------------------------------------------------------------
@router.get("/config/export")
def export_config() -> JSONResponse:
    payload = {
        "formato": CONFIG_FORMAT, "versao": 2, "exportado_em": time.time(),
        "regras_por_arquivo": catalog.export_rules(),
        "playlist": playlist.tracks(),
    }
    durable.audit("config_exported", rules=len(payload["regras_por_arquivo"]))
    return JSONResponse(payload, headers={**NO_STORE,
                                          "Content-Disposition": 'attachment; filename="fjunight-configuracao.json"'})


class ImportBody(BaseModel):
    formato: str
    versao: int
    regras_por_arquivo: list = []
    playlist: list | None = None


@router.post("/config/import")
def import_config(body: ImportBody, dry_run: bool = Query(True)) -> JSONResponse:
    require_durable()
    if body.formato != CONFIG_FORMAT or body.versao != 2:
        raise HTTPException(400, detail="config_format_invalid")
    rules = [r for r in (catalog._clean_rule(e) for e in body.regras_por_arquivo) if r and r.get("sha256") and r.get("rel_path")]
    try:
        tracks = playlist.validate(body.playlist) if body.playlist is not None else None
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    summary = {"rules": len(rules), "rules_ignored": len(body.regras_por_arquivo) - len(rules),
               "playlist_tracks": None if tracks is None else len(tracks)}
    if dry_run:
        return _json({"dry_run": True, **summary})
    catalog.import_rules(rules)
    if tracks is not None:
        playlist.save(tracks)
    durable.audit("config_restored", **summary)
    jobs.start_background(trigger="restauracao")
    return _json({"dry_run": False, **summary})
