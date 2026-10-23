"""The Love Walk 2026 photo-album API. No facial recognition or biometric processing."""
from __future__ import annotations
import hashlib
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
PHOTO_DIR = Path(os.getenv("PHOTO_DIR", ROOT / "frontend" / "images" / "gallery")).resolve()
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data")).resolve()
THUMB_DIR = DATA_DIR / "thumbnails"
DB_PATH = Path(os.getenv("DB_PATH", DATA_DIR / "the_love_walk.sqlite3")).resolve()
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "").strip()
ADMIN_OK = len(ADMIN_TOKEN) >= 32 and "troque-por" not in ADMIN_TOKEN.lower()
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "40000000"))
for path in (PHOTO_DIR, DATA_DIR, THUMB_DIR):
    path.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="The Love Walk 2026 Photo Album API", version="2.0.0")
origins = [s.strip() for s in os.getenv("CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",") if s.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET","POST","DELETE","OPTIONS"], allow_headers=["Content-Type","X-Admin-Token"])

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
    return parent if parent!="." else "A caminhada"

def create_thumb(src: Path, out: Path) -> tuple[int,int]:
    try:
        with Image.open(src) as im:
            if im.format not in {"JPEG","PNG","WEBP"}:
                raise ValueError("Formato de imagem não suportado.")
            if im.width*im.height>MAX_PIXELS:
                raise ValueError("Imagem excede o limite de pixels.")
            im=ImageOps.exif_transpose(im).convert("RGB")
            dimensions=im.size
            im.thumbnail((800,800),Image.Resampling.LANCZOS)
            out.parent.mkdir(parents=True,exist_ok=True)
            im.save(out,"WEBP",quality=86,method=6)
            return dimensions
    except (UnidentifiedImageError,OSError) as e:
        raise ValueError("Arquivo de imagem inválido.") from e

def payload(row: sqlite3.Row) -> dict:
    return {"id":row["id"],"url":f"/media/{row['id']}","src":f"/media/{row['id']}",
            "thumb":f"/thumb/{row['id']}","category":row["category"],"caption":row["caption"],
            "alt":row["caption"],"width":row["width"],"height":row["height"]}

def index_photos() -> dict:
    files=sorted(p for p in PHOTO_DIR.rglob("*") if p.is_file() and p.suffix.lower() in EXTENSIONS)
    found:set[str]=set()
    processed=skipped=errors=0
    for source in files:
        try:
            if source.is_symlink():
                errors+=1
                continue
            source=source.resolve(strict=True)
            if PHOTO_DIR not in source.parents:
                errors+=1
                continue
            rel=source.relative_to(PHOTO_DIR).as_posix()
            found.add(rel)
            stat=source.stat()
            pid=id_for(rel)
            with db() as c:
                old=c.execute("SELECT file_size,mtime,thumb_filename FROM photos WHERE id=?",(pid,)).fetchone()
                thumb=(THUMB_DIR/old["thumb_filename"]) if old else None
                if old and old["file_size"]==stat.st_size and abs(old["mtime"]-stat.st_mtime)<0.01 and thumb and thumb.is_file():
                    skipped+=1
                    continue
            width,height=create_thumb(source,THUMB_DIR/(pid+".webp"))
            caption=source.stem.replace("_"," ").replace("-"," ").strip() or "The Love Walk 2026"
            with db() as c:
                c.execute("""INSERT INTO photos VALUES(?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET relative_path=excluded.relative_path,filename=excluded.filename,
                  category=excluded.category,caption=excluded.caption,thumb_filename=excluded.thumb_filename,
                  file_size=excluded.file_size,mtime=excluded.mtime,width=excluded.width,height=excluded.height,indexed_at=excluded.indexed_at""",
                  (pid,rel,source.name,category_for(rel),caption,pid+".webp",stat.st_size,stat.st_mtime,width,height,time.time()))
            processed+=1
        except Exception as e:
            errors+=1
            print(f"[album-index] {source.name}: {type(e).__name__}: {e}")
    with db() as c:
        for row in c.execute("SELECT id,relative_path,thumb_filename FROM photos").fetchall():
            if row["relative_path"] not in found:
                c.execute("DELETE FROM photos WHERE id=?",(row["id"],))
                (THUMB_DIR/row["thumb_filename"]).unlink(missing_ok=True)
    return {"found":len(files),"processed":processed,"skipped_unchanged":skipped,"errors":errors}

@app.get("/api/health")
def health():
    with db() as c:
        count=c.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
    return {"status":"ok","service":"The Love Walk 2026 Photo Album API","photos_indexed":count,"admin_configured":ADMIN_OK}

@app.get("/api/photos")
def list_photos(offset:int=Query(0,ge=0),limit:int=Query(36,ge=1,le=1000),category:str|None=Query(None,max_length=80)):
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

@app.get("/media/{photo_id}")
def media(photo_id:str):
    with db() as c:
        row=c.execute("SELECT relative_path,filename FROM photos WHERE id=?",(photo_id,)).fetchone()
    if not row:
        raise HTTPException(404,detail="photo_not_found")
    path=(PHOTO_DIR/row["relative_path"]).resolve()
    if PHOTO_DIR not in path.parents or path.suffix.lower() not in EXTENSIONS or not path.is_file():
        raise HTTPException(404,detail="photo_not_found")
    return FileResponse(path,filename=row["filename"],headers={"Cache-Control":"public, max-age=86400","X-Content-Type-Options":"nosniff"})

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
