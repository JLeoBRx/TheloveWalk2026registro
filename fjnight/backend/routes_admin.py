"""Área administrativa: sincronização, curadoria das fotos e gestão dos dados faciais."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from . import catalog, db, faces, imaging, jobs
from .config import face_data_expires_at, settings
from .security import admin_required

router = APIRouter(prefix="/api/admin", dependencies=[Depends(admin_required)])
NO_STORE = {"Cache-Control": "no-store"}


class SyncRequest(BaseModel):
    confirm: bool = False
    faces: bool = True


class PhotoPatch(BaseModel):
    hidden: bool | None = None
    downloadable: bool | None = None
    face_search: bool | None = None


class PurgeRequest(BaseModel):
    confirm: str = ""
    include_optouts: bool = False


@router.get("/status")
def admin_status() -> JSONResponse:
    with db.catalog() as c:
        indexed = c.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
        raw = c.execute("SELECT COUNT(*) FROM photos WHERE is_raw=1").fetchone()[0]
    rows, effs = catalog.visible_rows()
    available, reason = faces.search_available()
    return JSONResponse({
        "catalog": {
            "source_files": len(catalog.list_source_files()),
            "indexed": indexed,
            "public": len(rows),
            "hidden": indexed - len(rows),
            "raw": raw,
            "no_download": sum(1 for e in effs.values() if not e.downloadable),
            "no_face_search": sum(1 for e in effs.values() if not e.face_search),
            "categories": catalog.categories(),
            "version": catalog.catalog_version(),
        },
        "faces": {
            "enabled": settings.face_search_enabled,
            "available": available,
            "reason": reason,
            "models_present": faces.engine.available(),
            "expires_at": face_data_expires_at().isoformat(),
            "threshold": settings.face_match_threshold,
            "encrypted_with_env_key": bool(settings.face_data_key),
            **faces.index_stats(),
        },
        "job": jobs.STATUS,
    }, headers=NO_STORE)


@router.post("/sync", status_code=202)
def sync(body: SyncRequest) -> dict:
    if not body.confirm:
        raise HTTPException(400, detail="confirmation_required")
    if not jobs.start_background(include_faces=body.faces):
        raise HTTPException(409, detail="index_already_running")
    return {"status": "started"}


@router.post("/faces/reindex", status_code=202)
def reindex_faces(body: SyncRequest) -> dict:
    if not body.confirm:
        raise HTTPException(400, detail="confirmation_required")
    if jobs.STATUS["running"]:
        raise HTTPException(409, detail="index_already_running")
    faces.purge_all(include_optouts=False)
    jobs.start_background(include_faces=True)
    return {"status": "started"}


@router.delete("/faces")
def purge_faces(body: PurgeRequest) -> dict:
    if body.confirm != "APAGAR":
        raise HTTPException(400, detail="confirmation_required")
    if jobs.STATUS["running"]:
        raise HTTPException(409, detail="index_already_running")
    faces.purge_all(include_optouts=body.include_optouts)
    return {"status": "purged", **faces.index_stats()}


@router.post("/faces/optout")
async def optout(image: UploadFile = File(...), confirm: str = Form(""), face: int | None = Form(None)) -> JSONResponse:
    """Registra o pedido de oposição de uma pessoa a partir de uma foto do rosto dela."""
    if confirm != "true":
        raise HTTPException(400, detail="confirmation_required")
    data = await image.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, detail="file_too_large")

    def work() -> dict:
        img = imaging.decode_upload(data, max_side=1600)
        bgr, detected = faces.analyze_query(img)
        if len(detected) > 1 and face is None:
            return {"status": "choose_face", "faces": faces.public_boxes(detected[:12], img.size)}
        idx = face or 0
        if not 0 <= idx < len(detected):
            raise faces.FaceSearchError("invalid_face_index", 400)
        return {"status": "registered", **faces.register_optout(faces.engine.embed(bgr, detected[idx]))}

    try:
        return JSONResponse(await run_in_threadpool(work), headers=NO_STORE)
    except imaging.ImageError:
        raise HTTPException(400, detail="invalid_image")
    except faces.FaceSearchError as exc:
        raise HTTPException(exc.status, detail=exc.code)


@router.get("/photos")
def list_photos(
    offset: int = Query(0, ge=0),
    limit: int = Query(48, ge=1, le=200),
    category: str | None = Query(None, max_length=120),
    q: str | None = Query(None, max_length=120),
    only: str | None = Query(None, pattern="^(hidden|no_download|no_face_search)$"),
) -> dict:
    rules = catalog.load_rules()
    with db.catalog() as c:
        smap = {r["rel_path"]: dict(r) for r in c.execute("SELECT * FROM photo_settings")}
        rows = c.execute("SELECT * FROM photos ORDER BY sort_key, filename").fetchall()
    items = []
    for row in rows:
        if category is not None and row["category"] != category:
            continue
        if q and q.lower() not in row["rel_path"].lower():
            continue
        eff = catalog.effective_settings(row["rel_path"], smap.get(row["rel_path"]), rules)
        if only == "hidden" and not eff.hidden:
            continue
        if only == "no_download" and eff.downloadable:
            continue
        if only == "no_face_search" and eff.face_search:
            continue
        items.append({
            "id": row["id"], "rel_path": row["rel_path"], "category": row["category"],
            "w": row["width"], "h": row["height"], "is_raw": bool(row["is_raw"]),
            "hidden": eff.hidden, "downloadable": eff.downloadable, "face_search": eff.face_search,
        })
    return {"items": items[offset: offset + limit], "total": len(items), "offset": offset, "limit": limit}


@router.get("/photos/{pid}/thumb")
def admin_thumb(pid: str) -> FileResponse:
    path, _ = catalog.derivative_paths(pid)
    if len(pid) != 20 or not pid.isalnum() or not path.is_file():
        raise HTTPException(404, detail="thumbnail_not_found")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, max-age=600"})


@router.patch("/photos/{pid}")
def patch_photo(pid: str, body: PhotoPatch) -> dict:
    changes = body.model_dump(exclude_unset=True)
    eff = catalog.update_settings(pid, **changes)
    if eff is None:
        raise HTTPException(404, detail="photo_not_found")
    if "face_search" in changes or "hidden" in changes:
        jobs.start_background(include_faces=True)  # atualiza o índice facial
    return {"id": pid, "hidden": eff.hidden, "downloadable": eff.downloadable, "face_search": eff.face_search}


@router.get("/rules/export")
def export_rules(request: Request) -> JSONResponse:
    return JSONResponse(catalog.export_rules(), headers={
        **NO_STORE, "Content-Disposition": 'attachment; filename="photo-rules.json"'})
