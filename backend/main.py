"""The Love Walk 2026 API: gallery and opt-in face search.
Before public deployment, complete LGPD review, consent/notice, retention, and access-control review.
"""
from __future__ import annotations
import hashlib, io, json, os, secrets, sqlite3, threading, time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
PHOTO_DIR = Path(os.getenv("PHOTO_DIR", ROOT / "frontend" / "images" / "gallery")).resolve()
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data")).resolve()
THUMB_DIR = DATA_DIR / "thumbnails"
DB_PATH = Path(os.getenv("DB_PATH", DATA_DIR / "the_love_walk.sqlite3")).resolve()
MODELS_DIR = Path(os.getenv("MODELS_DIR", ROOT / "models")).resolve()
YUNET = Path(os.getenv("YUNET_MODEL", MODELS_DIR / "face_detection_yunet_2023mar.onnx"))
SFACE = Path(os.getenv("SFACE_MODEL", MODELS_DIR / "face_recognition_sface_2021dec.onnx"))
MAX_UPLOAD = int(os.getenv("MAX_UPLOAD_BYTES", "8388608"))
MAX_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "24000000"))
MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.363"))
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "").strip()
ADMIN_OK = len(ADMIN_TOKEN) >= 32 and "troque-por" not in ADMIN_TOKEN.lower()
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MIMES = {"image/jpeg", "image/png", "image/webp"}
for p in (PHOTO_DIR, DATA_DIR, THUMB_DIR, MODELS_DIR):
    p.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="The Love Walk 2026 API", version="1.0.0")
origins = [s.strip() for s in os.getenv("CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",") if s.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                   allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
                   allow_headers=["Content-Type", "X-Admin-Token"])

def connect():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=20)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA busy_timeout=20000")
    if os.name == "posix":
        try:
            os.chmod(DB_PATH, 0o600)
            for suffix in ("-wal", "-shm"):
                side = Path(str(DB_PATH) + suffix)
                if side.exists(): os.chmod(side, 0o600)
        except OSError: pass
    return c

@contextmanager
def db():
    c = connect()
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
        CREATE TABLE IF NOT EXISTS face_embeddings(
          id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
          face_number INTEGER NOT NULL, bbox_json TEXT NOT NULL, embedding BLOB NOT NULL,
          UNIQUE(photo_id,face_number));
        CREATE INDEX IF NOT EXISTS idx_faces_photo ON face_embeddings(photo_id);
        CREATE INDEX IF NOT EXISTS idx_photos_category ON photos(category);
        """)
init_db()

class FaceEngine:
    """Lazy YuNet + SFace model adapter. Query selfies are handled in memory only."""
    def __init__(self):
        self.detector = None
        self.recognizer = None
        self.lock = threading.RLock()
    def ensure_loaded(self):
        with self.lock:
            if self.detector is not None and self.recognizer is not None: return
            missing = [p.name for p in (YUNET, SFACE) if not p.is_file()]
            if missing: raise HTTPException(503, detail="models_missing")
            try:
                self.detector = cv2.FaceDetectorYN.create(str(YUNET), "", (320, 320), 0.6, 0.3, 5000)
                self.recognizer = cv2.FaceRecognizerSF.create(str(SFACE), "")
            except Exception as e:
                self.detector = self.recognizer = None
                raise HTTPException(503, detail="models_load_failed") from e
    @staticmethod
    def decode(raw: bytes):
        if not raw or len(raw) > MAX_UPLOAD:
            raise HTTPException(413 if raw else 400, detail="too_large" if raw else "invalid_image")
        try:
            with Image.open(io.BytesIO(raw)) as im:
                if im.format not in {"JPEG", "PNG", "WEBP"}: raise HTTPException(400, detail="invalid_image")
                if im.width * im.height > MAX_PIXELS: raise HTTPException(413, detail="too_large")
                im = ImageOps.exif_transpose(im).convert("RGB")
                return cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)
        except HTTPException: raise
        except (UnidentifiedImageError, OSError, ValueError) as e:
            raise HTTPException(400, detail="invalid_image") from e
    def faces(self, image):
        with self.lock:
            self.ensure_loaded()
            h, w = image.shape[:2]
            self.detector.setInputSize((int(w), int(h)))
            _, rows = self.detector.detect(image)
            out = []
            if rows is None: return out
            for row in rows:
                crop = self.recognizer.alignCrop(image, row)
                v = self.recognizer.feature(crop).reshape(-1).astype(np.float32)
                norm = float(np.linalg.norm(v))
                if norm > 1e-8:
                    out.append({"bbox": [float(q) for q in row[:4]], "embedding": v / norm})
            return out
engine = FaceEngine()

def admin_required(token: str | None = Header(default=None, alias="X-Admin-Token")):
    if not ADMIN_OK: raise HTTPException(503, detail="admin_not_configured")
    if not token or not secrets.compare_digest(token, ADMIN_TOKEN):
        raise HTTPException(401, detail="admin_unauthorized")

def safe_source(rel: str):
    p = (PHOTO_DIR / rel).resolve()
    if PHOTO_DIR not in p.parents or p.suffix.lower() not in EXTENSIONS:
        raise HTTPException(404, detail="photo_not_found")
    return p

def id_for(rel: str): return hashlib.sha256(rel.encode()).hexdigest()[:20]
def category_for(rel: str):
    parent = Path(rel).parent.name
    return parent if parent != "." else "A caminhada"

def create_thumb(src: Path, out: Path):
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        size = im.size
        im.thumbnail((640, 640), Image.Resampling.LANCZOS)
        out.parent.mkdir(parents=True, exist_ok=True)
        im.save(out, "WEBP", quality=83, method=6)
        return size

def index_photos():
    engine.ensure_loaded()
    files = sorted(p for p in PHOTO_DIR.rglob("*") if p.is_file() and p.suffix.lower() in EXTENSIONS)
    found, processed, skipped, errors, faces_count = set(), 0, 0, 0, 0
    for source in files:
        try:
            if source.is_symlink(): errors += 1; continue
            source = source.resolve(strict=True)
            if PHOTO_DIR not in source.parents: errors += 1; continue
            rel = source.relative_to(PHOTO_DIR).as_posix()
            found.add(rel)
            st = source.stat(); pid = id_for(rel)
            with db() as c:
                old = c.execute("SELECT file_size,mtime,thumb_filename FROM photos WHERE id=?", (pid,)).fetchone()
                if old and old["file_size"] == st.st_size and abs(old["mtime"]-st.st_mtime) < .01 and (THUMB_DIR/old["thumb_filename"]).is_file():
                    skipped += 1; continue
            raw = source.read_bytes()
            img = engine.decode(raw)
            h,w = img.shape[:2]
            thumb = f"{pid}.webp"; dims = create_thumb(source, THUMB_DIR/thumb)
            fcs = engine.faces(img)
            caption = source.stem.replace("_"," ").replace("-"," ").strip() or "The Love Walk 2026"
            with db() as c:
                c.execute("""INSERT INTO photos VALUES(?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET relative_path=excluded.relative_path,filename=excluded.filename,
                  category=excluded.category,caption=excluded.caption,thumb_filename=excluded.thumb_filename,
                  file_size=excluded.file_size,mtime=excluded.mtime,width=excluded.width,height=excluded.height,indexed_at=excluded.indexed_at""",
                  (pid,rel,source.name,category_for(rel),caption,thumb,st.st_size,st.st_mtime,dims[0],dims[1],time.time()))
                c.execute("DELETE FROM face_embeddings WHERE photo_id=?", (pid,))
                c.executemany("INSERT INTO face_embeddings(photo_id,face_number,bbox_json,embedding) VALUES(?,?,?,?)",
                    [(pid,i,json.dumps(f["bbox"]),f["embedding"].astype(np.float32).tobytes()) for i,f in enumerate(fcs)])
            processed += 1; faces_count += len(fcs)
        except Exception as e:
            errors += 1
            print(f"[index] {source.name}: {type(e).__name__}: {getattr(e,'detail',str(e))}")
    with db() as c:
        for row in c.execute("SELECT id,relative_path,thumb_filename FROM photos").fetchall():
            if row["relative_path"] not in found:
                c.execute("DELETE FROM photos WHERE id=?", (row["id"],))
                (THUMB_DIR/row["thumb_filename"]).unlink(missing_ok=True)
    return {"found":len(files),"processed":processed,"skipped_unchanged":skipped,"faces_indexed":faces_count,"errors":errors}

def payload(row):
    return {"id":row["id"],"url":f"/media/{row['id']}","src":f"/media/{row['id']}",
            "thumb":f"/thumb/{row['id']}","category":row["category"],"caption":row["caption"],
            "alt":row["caption"],"width":row["width"],"height":row["height"]}

RATE = {}
def limit_search(request):
    ip = request.client.host if request.client else "unknown"; now=time.monotonic()
    recent=[t for t in RATE.get(ip,[]) if now-t<60]
    if len(recent)>=12: raise HTTPException(429, detail="rate_limited")
    recent.append(now); RATE[ip]=recent

@app.get("/api/health")
def health():
    with db() as c:
        n=c.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
        f=c.execute("SELECT COUNT(*) FROM face_embeddings").fetchone()[0]
    return {"status":"ok","service":"The Love Walk 2026 API","photos_indexed":n,"faces_indexed":f,
            "models_ready":YUNET.is_file() and SFACE.is_file(),"admin_configured":ADMIN_OK}

@app.get("/api/photos")
def list_photos(offset:int=Query(0,ge=0),limit:int=Query(36,ge=1,le=1000),category:str|None=Query(None,max_length=80)):
    with db() as c:
        total=c.execute("SELECT COUNT(*) FROM photos WHERE (? IS NULL OR category=?)",(category,category)).fetchone()[0]
        rows=c.execute("SELECT * FROM photos WHERE (? IS NULL OR category=?) ORDER BY indexed_at DESC,filename COLLATE NOCASE LIMIT ? OFFSET ?",
                       (category,category,limit,offset)).fetchall()
        cats=[r[0] for r in c.execute("SELECT DISTINCT category FROM photos ORDER BY category COLLATE NOCASE").fetchall()]
    return {"photos":[payload(r) for r in rows],"results":[payload(r) for r in rows],"total":total,"count":total,"categories":cats,"offset":offset,"limit":limit}

@app.get("/api/gallery")
def gallery(page:int=Query(1,ge=1),page_size:int=Query(24,ge=1,le=60),category:str|None=Query(None,max_length=80)):
    d=list_photos(offset=(page-1)*page_size,limit=page_size,category=category)
    return {"results":d["photos"],"total":d["total"],"count":d["total"],"categories":d["categories"],"page":page,"page_size":page_size}

@app.post("/api/search")
async def search_faces(request:Request,consent:str=Form(...),file:UploadFile=File(...)):
    limit_search(request)
    if consent.lower() not in {"true","yes","1"}: raise HTTPException(400,detail="consent_required")
    if file.content_type not in MIMES: raise HTTPException(400,detail="invalid_image")
    raw=await file.read(MAX_UPLOAD+1); await file.close()
    if len(raw)>MAX_UPLOAD: raise HTTPException(413,detail="too_large")
    img=engine.decode(raw); qfaces=await run_in_threadpool(engine.faces,img)
    del img,raw
    if not qfaces: raise HTTPException(422,detail="no_face")
    multiple=len(qfaces)>1; q=max(qfaces,key=lambda f:f["bbox"][2]*f["bbox"][3])["embedding"]
    best={}
    with db() as c:
        rows=c.execute("SELECT photo_id,embedding FROM face_embeddings").fetchall()
        for row in rows:
            v=np.frombuffer(row["embedding"],dtype=np.float32)
            if v.shape==q.shape:
                score=float(np.dot(q,v))
                if score>=MATCH_THRESHOLD and score>best.get(row["photo_id"],-1): best[row["photo_id"]]=score
        ordered=sorted(best.items(),key=lambda kv:kv[1],reverse=True)[:100]
        results=[]
        for pid,_score in ordered:
            row=c.execute("SELECT * FROM photos WHERE id=?",(pid,)).fetchone()
            if row: results.append(payload(row))
    return {"count":len(results),"results":results,"multiple_faces":multiple}

@app.post("/api/admin/index",dependencies=[Depends(admin_required)])
async def admin_index(request:Request):
    try: body=await request.json()
    except Exception as e: raise HTTPException(400,detail="confirmation_required") from e
    if body.get("confirm_authorized_photos") is not True: raise HTTPException(400,detail="confirmation_required")
    return {"status":"completed",**await run_in_threadpool(index_photos)}

@app.delete("/api/admin/photos/{photo_id}",dependencies=[Depends(admin_required)])
def admin_remove_photo(photo_id:str):
    with db() as c:
        row=c.execute("SELECT thumb_filename FROM photos WHERE id=?",(photo_id,)).fetchone()
        if not row: raise HTTPException(404,detail="photo_not_found")
        c.execute("DELETE FROM photos WHERE id=?",(photo_id,))
    (THUMB_DIR/row["thumb_filename"]).unlink(missing_ok=True)
    return {"status":"removed_from_index","photo_id":photo_id,"source_file_deleted":False}

@app.post("/api/admin/purge-facial-data",dependencies=[Depends(admin_required)])
async def admin_purge(request:Request):
    try: body=await request.json()
    except Exception as e: raise HTTPException(400,detail="confirmation_required") from e
    if body.get("confirm_purge_facial_data") is not True: raise HTTPException(400,detail="confirmation_required")
    with db() as c: c.execute("DELETE FROM face_embeddings")
    return {"status":"facial_data_purged","photos_remain_in_gallery":True}

@app.get("/media/{photo_id}")
def media(photo_id:str):
    with db() as c: row=c.execute("SELECT relative_path,filename FROM photos WHERE id=?",(photo_id,)).fetchone()
    if not row: raise HTTPException(404,detail="photo_not_found")
    path=safe_source(row["relative_path"])
    if not path.is_file(): raise HTTPException(404,detail="photo_not_found")
    return FileResponse(path,filename=row["filename"],headers={"Cache-Control":"public, max-age=86400","X-Content-Type-Options":"nosniff"})

@app.get("/thumb/{photo_id}")
def thumb(photo_id:str):
    with db() as c: row=c.execute("SELECT thumb_filename FROM photos WHERE id=?",(photo_id,)).fetchone()
    if not row: raise HTTPException(404,detail="thumbnail_not_found")
    path=(THUMB_DIR/row["thumb_filename"]).resolve()
    if THUMB_DIR not in path.parents or not path.is_file(): raise HTTPException(404,detail="thumbnail_not_found")
    return FileResponse(path,media_type="image/webp",headers={"Cache-Control":"public, max-age=604800","X-Content-Type-Options":"nosniff"})

# The public frontend is mounted last so it cannot shadow API paths.
if ROOT.joinpath("index.html").is_file():
    @app.get("/")
    def index(): return FileResponse(ROOT/"index.html")
elif ROOT.joinpath("frontend","index.html").is_file():
    @app.get("/")
    def index(): return FileResponse(ROOT/"frontend"/"index.html")
if ROOT.joinpath("admin.html").is_file():
    @app.get("/admin.html")
    def admin(): return FileResponse(ROOT/"admin.html")
elif ROOT.joinpath("frontend","admin.html").is_file():
    @app.get("/admin.html")
    def admin(): return FileResponse(ROOT/"frontend"/"admin.html")
# Optional static assets only; image files are deliberately not exposed by directory mount.
