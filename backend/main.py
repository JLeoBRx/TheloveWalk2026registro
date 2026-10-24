"""The Love Walk 2026 photo-album API. No facial recognition or biometric processing."""
from __future__ import annotations
import hashlib
import io
import os
import secrets
import sqlite3
import time
from threading import Thread
from contextlib import contextmanager
import json
from pathlib import Path
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
import rawpy
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
PHOTO_DIR_CONFIG = Path(os.getenv("PHOTO_DIR", str(ROOT / "colocar as fotos aqui"))).expanduser()
PHOTO_DIR = (PHOTO_DIR_CONFIG if PHOTO_DIR_CONFIG.is_absolute() else ROOT / PHOTO_DIR_CONFIG).resolve()
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data")).resolve()
THUMB_DIR = DATA_DIR / "thumbnails"
RAW_PREVIEW_DIR = DATA_DIR / "raw_previews"
DB_PATH = Path(os.getenv("DB_PATH", DATA_DIR / "the_love_walk.sqlite3")).resolve()
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "").strip()
ADMIN_OK = bool(ADMIN_TOKEN) and "troque-por" not in ADMIN_TOKEN.lower()
NUMBER_BOARD_TOKEN = os.getenv("NUMBER_BOARD_TOKEN", "").strip()
NUMBER_BOARD_OK = len(NUMBER_BOARD_TOKEN) >= 32
OPERATOR_PASSWORD = os.getenv("OPERATOR_PASSWORD", "").strip()
OPERATOR_PASSWORD_OK = bool(OPERATOR_PASSWORD)
STANDARD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
RAW_EXTENSIONS = {
    ".3fr", ".arw", ".bay", ".cap", ".cr2", ".cr3", ".crw", ".dcs", ".dcr",
    ".dng", ".drf", ".eip", ".erf", ".fff", ".iiq", ".k25", ".kdc", ".mef",
    ".mos", ".mrw", ".nef", ".nrw", ".obm", ".orf", ".pef", ".ptx", ".pxn",
    ".qtk", ".raf", ".raw", ".rdc", ".rw2", ".rwl", ".sr2", ".srf", ".srw",
    ".sti", ".x3f"
}
EXTENSIONS = STANDARD_EXTENSIONS | RAW_EXTENSIONS
MAX_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "40000000"))
MAX_RAW_PIXELS = int(os.getenv("MAX_RAW_IMAGE_PIXELS", "60000000"))
for path in (PHOTO_DIR, DATA_DIR, THUMB_DIR, RAW_PREVIEW_DIR):
    path.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="The Love Walk 2026 Photo Album API", version="2.0.0")
origins = [s.strip() for s in os.getenv("CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",") if s.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET","POST","DELETE","OPTIONS"], allow_headers=["Content-Type","X-Admin-Token","X-Number-Board-Token","Authorization"])

def connect():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    c=sqlite3.connect(DB_PATH, timeout=20)
    c.row_factory=sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA busy_timeout=20000")
    return c

@contextmanager
def db():
    c=connect()
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()

def init_db():
    with db() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS photos(
          id TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE, filename TEXT NOT NULL,
          category TEXT NOT NULL, caption TEXT NOT NULL, thumb_filename TEXT NOT NULL,
          file_size INTEGER NOT NULL, mtime REAL NOT NULL, width INTEGER NOT NULL,
          height INTEGER NOT NULL, indexed_at REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_photos_category ON photos(category);
        DROP TABLE IF EXISTS face_embeddings;
        CREATE TABLE IF NOT EXISTS number_board(
          category TEXT PRIMARY KEY, drawn_json TEXT NOT NULL, last_number INTEGER,
          updated_at REAL NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        """)
init_db()

def admin_required(token: str | None = Header(default=None, alias="X-Admin-Token")):
    if not ADMIN_OK:
        raise HTTPException(503, detail="admin_not_configured")
    if not token or not secrets.compare_digest(token, ADMIN_TOKEN):
        raise HTTPException(401, detail="admin_unauthorized")

def id_for(rel: str) -> str:
    return hashlib.sha256(rel.encode("utf-8")).hexdigest()[:20]

def category_for(rel: str) -> str:
    parent=Path(rel).parent.name
    return parent if parent not in {"", "."} else "A caminhada"

def create_raw_previews(src: Path, photo_id: str) -> tuple[int,int]:
    """Create a web-sized JPEG preview and WebP thumbnail from a camera RAW file."""
    preview_path = RAW_PREVIEW_DIR / (photo_id + ".jpg")
    thumb_path = THUMB_DIR / (photo_id + ".webp")
    try:
        with rawpy.imread(str(src)) as raw:
            if raw.sizes.width * raw.sizes.height > MAX_RAW_PIXELS:
                raise ValueError(f"RAW excede o limite de {MAX_RAW_PIXELS:,} pixels.")

            # Prefer the JPEG preview embedded by the camera; it is much faster
            # than demosaicing every sensor pixel on a small hosting instance.
            im = None
            try:
                embedded = raw.extract_thumb()
                if embedded.format == rawpy.ThumbFormat.JPEG:
                    with Image.open(io.BytesIO(embedded.data)) as embedded_image:
                        embedded_image.load()
                        candidate = ImageOps.exif_transpose(embedded_image).convert("RGB")
                elif embedded.format == rawpy.ThumbFormat.BITMAP:
                    candidate = Image.fromarray(embedded.data).convert("RGB")
                else:
                    candidate = None

                if candidate is not None and min(candidate.size) >= 640:
                    im = candidate
                    print(f"[album-index] using embedded preview {src.name} {im.width}x{im.height}", flush=True)
            except (rawpy.LibRawNoThumbnailError, rawpy.LibRawUnsupportedThumbnailError,
                    UnidentifiedImageError, OSError, ValueError) as thumb_error:
                print(f"[album-index] embedded preview unavailable for {src.name}: {thumb_error}", flush=True)

            if im is None:
                print(f"[album-index] demosaicing RAW {src.name}", flush=True)
                rgb = raw.postprocess(use_camera_wb=True, output_bps=8, half_size=True)
                im = Image.fromarray(rgb).convert("RGB")

        dimensions = im.size
        im.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
        preview_path.parent.mkdir(parents=True, exist_ok=True)
        im.save(preview_path, "JPEG", quality=86, optimize=False)
        im.thumbnail((800, 800), Image.Resampling.LANCZOS)
        thumb_path.parent.mkdir(parents=True, exist_ok=True)
        im.save(thumb_path, "WEBP", quality=82, method=2)
        return dimensions
    except Exception as exc:
        preview_path.unlink(missing_ok=True)
        thumb_path.unlink(missing_ok=True)
        raise ValueError(f"Não foi possível revelar o RAW ({src.suffix.upper()}): {exc}") from exc


def create_thumb(src: Path, out: Path) -> tuple[int,int]:
    if src.suffix.lower() in RAW_EXTENSIONS:
        return create_raw_previews(src, out.stem)
    try:
        with Image.open(src) as source:
            if source.format not in {"JPEG","PNG","WEBP"}:
                raise ValueError("Formato de imagem não suportado.")
            if source.width*source.height>MAX_PIXELS:
                raise ValueError("Imagem excede o limite de pixels.")
            # Resize before RGB conversion so JPEG decoders can use draft/downsampling.
            im=ImageOps.exif_transpose(source)
            dimensions=im.size
            im.thumbnail((800,800),Image.Resampling.LANCZOS)
            im=im.convert("RGB")
            out.parent.mkdir(parents=True,exist_ok=True)
            im.save(out,"WEBP",quality=82,method=2)
            return dimensions
    except (UnidentifiedImageError,OSError) as e:
        raise ValueError("Arquivo de imagem inválido.") from e

def payload(row: sqlite3.Row) -> dict:
    is_raw = Path(row["relative_path"]).suffix.lower() in RAW_EXTENSIONS
    display_url = f"/preview/{row['id']}" if is_raw else f"/media/{row['id']}"
    return {"id":row["id"],"url":display_url,"src":display_url,
            "thumb":f"/thumb/{row['id']}","download":f"/download/{row['id']}",
            "original":f"/media/{row['id']}","is_raw":is_raw,"category":row["category"],"caption":row["caption"],
            "alt":row["caption"],"width":row["width"],"height":row["height"]}

INDEX_STATUS = {
    "running": False,
    "complete": False,
    "failed": False,
    "error": "",
    "total_files": 0,
    "processed": 0,
    "errors": 0,
}


def index_photos() -> dict:
    INDEX_STATUS.update({
        "running": True, "complete": False, "failed": False, "error": "",
        "total_files": 0, "processed": 0, "errors": 0,
    })
    processed = skipped = errors = 0
    try:
        files = sorted(p for p in PHOTO_DIR.rglob("*") if p.is_file() and p.suffix.lower() in EXTENSIONS)
        INDEX_STATUS["total_files"] = len(files)
        found: set[str] = set()
        for position, source in enumerate(files, start=1):
            try:
                if source.is_symlink():
                    errors += 1
                    continue
                source = source.resolve(strict=True)
                if PHOTO_DIR not in source.parents:
                    errors += 1
                    continue
                rel = source.relative_to(PHOTO_DIR).as_posix()
                found.add(rel)
                stat = source.stat()
                pid = id_for(rel)
                with db() as c:
                    old = c.execute("SELECT file_size,mtime,thumb_filename FROM photos WHERE id=?", (pid,)).fetchone()
                    thumb = (THUMB_DIR / old["thumb_filename"]) if old else None
                    if old and old["file_size"] == stat.st_size and abs(old["mtime"] - stat.st_mtime) < 0.01 and thumb and thumb.is_file() and (source.suffix.lower() not in RAW_EXTENSIONS or (RAW_PREVIEW_DIR / (pid + ".jpg")).is_file()):
                        skipped += 1
                        continue
                print(f"[album-index] processing {source.name}", flush=True)
                width, height = create_thumb(source, THUMB_DIR / (pid + ".webp"))
                caption = source.stem.replace("_", " ").replace("-", " ").strip() or "The Love Walk 2026"
                with db() as c:
                    c.execute("""INSERT INTO photos VALUES(?,?,?,?,?,?,?,?,?,?,?)
                      ON CONFLICT(id) DO UPDATE SET relative_path=excluded.relative_path,filename=excluded.filename,
                      category=excluded.category,caption=excluded.caption,thumb_filename=excluded.thumb_filename,
                      file_size=excluded.file_size,mtime=excluded.mtime,width=excluded.width,height=excluded.height,indexed_at=excluded.indexed_at""",
                      (pid, rel, source.name, category_for(rel), caption, pid + ".webp", stat.st_size, stat.st_mtime, width, height, time.time()))
                processed += 1
                print(f"[album-index] indexed {source.name}", flush=True)
            except Exception as e:
                errors += 1
                print(f"[album-index] {source.name}: {type(e).__name__}: {e}", flush=True)
            finally:
                INDEX_STATUS.update({"processed": position, "errors": errors})
        with db() as c:
            for row in c.execute("SELECT id,relative_path,thumb_filename FROM photos").fetchall():
                if row["relative_path"] not in found:
                    c.execute("DELETE FROM photos WHERE id=?", (row["id"],))
                    (THUMB_DIR / row["thumb_filename"]).unlink(missing_ok=True)
                    (RAW_PREVIEW_DIR / (row["id"] + ".jpg")).unlink(missing_ok=True)
        return {"found": len(files), "processed": processed, "skipped_unchanged": skipped, "errors": errors}
    except Exception as exc:
        INDEX_STATUS.update({"failed": True, "error": type(exc).__name__})
        raise
    finally:
        INDEX_STATUS.update({"running": False, "complete": not INDEX_STATUS["failed"], "errors": errors})

def _startup_index_worker():
    """Index the committed gallery without blocking application health checks."""
    try:
        print(f"[album-index-startup] begin path={PHOTO_DIR}", flush=True)
        result = index_photos()
        print(f"[album-index-startup] {json.dumps(result, ensure_ascii=False)}", flush=True)
    except Exception as exc:
        print(f"[album-index-startup] {type(exc).__name__}: {exc}", flush=True)


def _load_prebuilt_gallery_index() -> bool:
    marker = DATA_DIR / ".gallery-index-ready.json"
    if not marker.is_file():
        return False
    try:
        meta = json.loads(marker.read_text(encoding="utf-8"))
        if meta.get("version") != 1:
            return False
        files = [p for p in PHOTO_DIR.rglob("*") if p.is_file() and p.suffix.lower() in EXTENSIONS]
        if len(files) != int(meta.get("source_files", -1)):
            return False
        with db() as c:
            rows = c.execute("SELECT id, relative_path, thumb_filename FROM photos").fetchall()
        if len(rows) != int(meta.get("indexed_photos", -1)):
            return False
        for row in rows:
            thumb = (THUMB_DIR / row["thumb_filename"]).resolve()
            if THUMB_DIR not in thumb.parents or not thumb.is_file():
                return False
            if Path(row["relative_path"]).suffix.lower() in RAW_EXTENSIONS and not (RAW_PREVIEW_DIR / (row["id"] + ".jpg")).is_file():
                return False
        INDEX_STATUS.update({
            "running": False,
            "complete": True,
            "failed": False,
            "error": "",
            "total_files": len(files),
            "processed": len(files),
            "errors": int(meta.get("errors", 0)),
        })
        print(f"[album-index-startup] using prebuilt cache: {len(rows)} photos ready", flush=True)
        return True
    except Exception as exc:
        print(f"[album-index-startup] prebuilt cache check failed: {type(exc).__name__}", flush=True)
        return False


@app.on_event("startup")
def auto_index_gallery_on_startup():
    """Use the built gallery cache when available; otherwise rebuild it safely."""
    if _load_prebuilt_gallery_index():
        return
    worker = Thread(target=_startup_index_worker, name="album-startup-index", daemon=True)
    worker.start()
    print(f"[album-index-startup] scheduled path={PHOTO_DIR}", flush=True)


@app.get("/api/health")
def health():
    with db() as c:
        count = c.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
    return {
        "status": "ok",
        "service": "The Love Walk 2026 Photo Album API",
        "photos_indexed": count,
        "admin_configured": ADMIN_OK,
        "indexing": INDEX_STATUS["running"],
        "index_complete": INDEX_STATUS["complete"],
        "index_failed": INDEX_STATUS["failed"],
        "index_error": INDEX_STATUS["error"],
        "index_total_files": INDEX_STATUS["total_files"],
        "index_processed": INDEX_STATUS["processed"],
        "index_errors": INDEX_STATUS["errors"],
    }

OPERATOR_SESSIONS: dict[str, float] = {}
OPERATOR_LOGIN_ATTEMPTS: dict[str, dict[str, float | int]] = {}
OPERATOR_SESSION_SECONDS = 8 * 60 * 60

def number_board_required(
    token: str | None = Header(default=None, alias="X-Number-Board-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    if NUMBER_BOARD_OK and token and secrets.compare_digest(token, NUMBER_BOARD_TOKEN):
        return
    if authorization and authorization.lower().startswith("bearer "):
        session_token = authorization[7:].strip()
        expires_at = OPERATOR_SESSIONS.get(session_token, 0)
        if expires_at > time.time():
            return
        OPERATOR_SESSIONS.pop(session_token, None)
    if not NUMBER_BOARD_OK:
        raise HTTPException(503, detail="number_board_not_configured")
    raise HTTPException(401, detail="number_board_unauthorized")

@app.post("/api/operator-login")
async def operator_login(request: Request):
    """Verify the operator password and issue a short-lived server-side session."""
    if not OPERATOR_PASSWORD_OK:
        raise HTTPException(503, detail="operator_auth_not_configured")

    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    attempt = OPERATOR_LOGIN_ATTEMPTS.get(client_ip, {"count": 0, "blocked_until": 0.0})
    if float(attempt.get("blocked_until", 0.0)) > now:
        raise HTTPException(429, detail="too_many_login_attempts")
    if float(attempt.get("blocked_until", 0.0)) != 0.0:
        attempt = {"count": 0, "blocked_until": 0.0}

    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, detail="invalid_json") from exc
    candidate = body.get("password") if isinstance(body, dict) else None
    if not isinstance(candidate, str) or not secrets.compare_digest(candidate, OPERATOR_PASSWORD):
        count = int(attempt.get("count", 0)) + 1
        blocked_until = now + 600 if count >= 5 else 0.0
        OPERATOR_LOGIN_ATTEMPTS[client_ip] = {"count": count, "blocked_until": blocked_until}
        raise HTTPException(401, detail="operator_unauthorized")

    OPERATOR_LOGIN_ATTEMPTS.pop(client_ip, None)
    for old_token, expiry in list(OPERATOR_SESSIONS.items()):
        if expiry <= now:
            OPERATOR_SESSIONS.pop(old_token, None)
    access_token = secrets.token_urlsafe(32)
    OPERATOR_SESSIONS[access_token] = now + OPERATOR_SESSION_SECONDS
    return {"access_token": access_token, "token_type": "Bearer", "expires_in": OPERATOR_SESSION_SECONDS}

NUMBER_BOARD_CATEGORIES = ("solteiros", "casados")

@app.get("/api/number-board")
def get_number_board():
    """Public, read-only state used by the audience display."""
    with db() as c:
        rows = c.execute(
            "SELECT category, drawn_json, last_number, updated_at, version FROM number_board"
        ).fetchall()
    by_category = {row["category"]: row for row in rows}
    categories = {}
    updated_at = 0.0
    version = 0
    for category in NUMBER_BOARD_CATEGORIES:
        row = by_category.get(category)
        if row:
            try:
                drawn = json.loads(row["drawn_json"])
            except (TypeError, json.JSONDecodeError):
                drawn = []
            categories[category] = {"drawn": drawn, "last": row["last_number"], "updated_at": float(row["updated_at"]), "version": int(row["version"])}
            updated_at = max(updated_at, float(row["updated_at"]))
            version = max(version, int(row["version"]))
        else:
            categories[category] = {"drawn": [], "last": None, "updated_at": 0.0, "version": 0}
    return {"categories": categories, "updated_at": updated_at, "version": version}


@app.post("/api/number-board", dependencies=[Depends(number_board_required)])
async def update_number_board(request: Request):
    """Update both categories atomically. Only the organizer token can write."""
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, detail="invalid_json") from exc
    incoming = body.get("categories") if isinstance(body, dict) else None
    if not isinstance(incoming, dict):
        raise HTTPException(400, detail="categories_required")

    validated = {}
    for category in NUMBER_BOARD_CATEGORIES:
        state = incoming.get(category)
        if not isinstance(state, dict):
            raise HTTPException(400, detail=f"missing_category_{category}")
        drawn = state.get("drawn")
        last = state.get("last")
        if not isinstance(drawn, list) or len(drawn) > 80:
            raise HTTPException(400, detail=f"invalid_drawn_{category}")
        if any(not isinstance(n, int) or isinstance(n, bool) or n < 1 or n > 80 for n in drawn):
            raise HTTPException(400, detail=f"invalid_number_{category}")
        if len(drawn) != len(set(drawn)):
            raise HTTPException(400, detail=f"duplicate_number_{category}")
        if last is not None and (not isinstance(last, int) or isinstance(last, bool) or last not in drawn):
            raise HTTPException(400, detail=f"invalid_last_{category}")
        validated[category] = (drawn, last)

    now = time.time()
    with db() as c:
        for category, (drawn, last) in validated.items():
            row = c.execute("SELECT version FROM number_board WHERE category=?", (category,)).fetchone()
            version = int(row["version"]) + 1 if row else 1
            c.execute(
                """INSERT INTO number_board(category, drawn_json, last_number, updated_at, version)
                   VALUES(?,?,?,?,?)
                   ON CONFLICT(category) DO UPDATE SET drawn_json=excluded.drawn_json,
                     last_number=excluded.last_number, updated_at=excluded.updated_at, version=excluded.version""",
                (category, json.dumps(drawn, separators=(",", ":")), last, now, version),
            )
    return {"status": "updated", "updated_at": now}


@app.get("/api/photos")
def list_photos(offset:int=Query(0,ge=0),limit:int=Query(36,ge=1,le=1000),category:str|None=Query(None,max_length=80)):
    if not INDEX_STATUS["complete"]:
        raise HTTPException(status_code=503, detail="gallery_indexing")
    with db() as c:
        total=c.execute("SELECT COUNT(*) FROM photos WHERE (? IS NULL OR category=?)",(category,category)).fetchone()[0]
        rows=c.execute("SELECT * FROM photos WHERE (? IS NULL OR category=?) ORDER BY indexed_at DESC,filename COLLATE NOCASE LIMIT ? OFFSET ?",
                       (category,category,limit,offset)).fetchall()
        cats=[r[0] for r in c.execute("SELECT DISTINCT category FROM photos ORDER BY category COLLATE NOCASE").fetchall()]
    items=[payload(r) for r in rows]
    return {"photos":items,"results":items,"total":total,"count":total,"categories":cats,"offset":offset,"limit":limit}

@app.get("/api/gallery")
def gallery(page:int=Query(1,ge=1),page_size:int=Query(28,ge=1,le=60),category:str|None=Query(None,max_length=80)):
    d=list_photos(offset=(page-1)*page_size,limit=page_size,category=category)
    return {"results":d["photos"],"total":d["total"],"count":d["total"],"categories":d["categories"],"page":page,"page_size":page_size}

@app.post("/api/admin/index",dependencies=[Depends(admin_required)])
async def admin_index(request:Request):
    try:
        body=await request.json()
    except Exception as e:
        raise HTTPException(400,detail="confirmation_required") from e
    if body.get("confirm_gallery_scan") is not True:
        raise HTTPException(400,detail="confirmation_required")
    return {"status":"completed",**await run_in_threadpool(index_photos)}

@app.delete("/api/admin/photos/{photo_id}",dependencies=[Depends(admin_required)])
def admin_remove_photo(photo_id:str):
    with db() as c:
        row=c.execute("SELECT thumb_filename FROM photos WHERE id=?",(photo_id,)).fetchone()
        if not row:
            raise HTTPException(404,detail="photo_not_found")
        c.execute("DELETE FROM photos WHERE id=?",(photo_id,))
    (THUMB_DIR/row["thumb_filename"]).unlink(missing_ok=True)
    return {"status":"removed_from_album","photo_id":photo_id,"source_file_deleted":False}

@app.get("/preview/{photo_id}")
def raw_preview(photo_id:str):
    with db() as c:
        row=c.execute("SELECT relative_path FROM photos WHERE id=?",(photo_id,)).fetchone()
    if not row:
        raise HTTPException(404,detail="photo_not_found")
    source=(PHOTO_DIR/row["relative_path"]).resolve()
    if PHOTO_DIR not in source.parents or source.suffix.lower() not in EXTENSIONS or not source.is_file():
        raise HTTPException(404,detail="photo_not_found")
    if source.suffix.lower() not in RAW_EXTENSIONS:
        return media(photo_id)
    preview_path=RAW_PREVIEW_DIR/(photo_id+".jpg")
    if not preview_path.is_file():
        try:
            create_raw_previews(source, photo_id)
        except ValueError as exc:
            raise HTTPException(422,detail=str(exc)) from exc
    return FileResponse(preview_path,media_type="image/jpeg",headers={"Cache-Control":"public, max-age=86400","X-Content-Type-Options":"nosniff"})


@app.get("/download/{photo_id}")
def download_photo(photo_id:str):
    """Download a browser-friendly image; RAW files are delivered as JPEG previews."""
    with db() as c:
        row=c.execute("SELECT relative_path,filename FROM photos WHERE id=?",(photo_id,)).fetchone()
    if not row:
        raise HTTPException(404,detail="photo_not_found")
    source=(PHOTO_DIR/row["relative_path"]).resolve()
    if PHOTO_DIR not in source.parents or source.suffix.lower() not in EXTENSIONS or not source.is_file():
        raise HTTPException(404,detail="photo_not_found")
    headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
    if source.suffix.lower() in RAW_EXTENSIONS:
        preview_path=RAW_PREVIEW_DIR/(photo_id+".jpg")
        if not preview_path.is_file():
            try:
                create_raw_previews(source,photo_id)
            except ValueError as exc:
                raise HTTPException(422,detail=str(exc)) from exc
        return FileResponse(preview_path,filename=f"{source.stem}.jpg",media_type="image/jpeg",headers=headers)
    return FileResponse(source,filename=row["filename"],headers=headers)


@app.get("/media/{photo_id}")
def media(photo_id:str):
    with db() as c:
        row=c.execute("SELECT relative_path,filename FROM photos WHERE id=?",(photo_id,)).fetchone()
    if not row:
        raise HTTPException(404,detail="photo_not_found")
    path=(PHOTO_DIR/row["relative_path"]).resolve()
    if PHOTO_DIR not in path.parents or path.suffix.lower() not in EXTENSIONS or not path.is_file():
        raise HTTPException(404,detail="photo_not_found")
    is_raw = path.suffix.lower() in RAW_EXTENSIONS
    headers={"Cache-Control":"public, max-age=86400","X-Content-Type-Options":"nosniff"}
    return FileResponse(path,filename=row["filename"],media_type="application/octet-stream" if is_raw else None,headers=headers)

@app.get("/thumb/{photo_id}")
def thumb(photo_id:str):
    with db() as c:
        row=c.execute("SELECT thumb_filename FROM photos WHERE id=?",(photo_id,)).fetchone()
    if not row:
        raise HTTPException(404,detail="thumbnail_not_found")
    path=(THUMB_DIR/row["thumb_filename"]).resolve()
    if THUMB_DIR not in path.parents or not path.is_file():
        raise HTTPException(404,detail="thumbnail_not_found")
    return FileResponse(path,media_type="image/webp",headers={"Cache-Control":"public, max-age=604800","X-Content-Type-Options":"nosniff"})

if (ROOT/"index.html").is_file():
    @app.get("/")
    def index():
        return FileResponse(ROOT/"index.html")
if (ROOT/"admin.html").is_file():
    @app.get("/admin.html")
    def admin():
        return FileResponse(ROOT/"admin.html")
if (ROOT/"privacy.html").is_file():
    @app.get("/privacy.html")
    def privacy():
        return FileResponse(ROOT/"privacy.html")
