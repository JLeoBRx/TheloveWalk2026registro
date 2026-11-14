"""FJU Night — A Noite da Herança · servidor do álbum oficial.

Execute a partir da pasta `fjnight/`:
    uvicorn backend.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import hashlib
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import durable, faces, jobs, routes_admin, routes_faces, routes_public
from .config import ensure_dirs, settings
from .security import HSTS, SECURITY_HEADERS, is_https

FRONTEND = settings.frontend_dir
ASSETS = FRONTEND / "assets"


def _asset_version() -> str:
    digest = hashlib.sha1()
    for path in sorted(ASSETS.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(ASSETS).as_posix().encode())
            digest.update(hashlib.sha1(path.read_bytes()).digest())
    return digest.hexdigest()[:10]


ASSET_VERSION = _asset_version()


def _init_database(attempts: int = 5) -> None:
    for attempt in range(1, attempts + 1):
        try:
            durable.init()
            return
        except Exception as exc:
            print(f"[inicio] banco indisponível ({type(exc).__name__}), tentativa {attempt}/{attempts}", flush=True)
            if attempt == attempts:
                raise
            time.sleep(2 * attempt)


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_dirs()
    _init_database()
    if settings.production and not settings.durable_storage:
        print("[inicio] AVISO: sem banco durável — painel em modo somente leitura e busca facial desligada.",
              flush=True)
    faces.enforce_retention()
    status = faces.authorization_status()
    if not status["authorized"] and settings.faces_db.exists():
        faces.purge_local_index()      # sem autorização, nenhum índice facial permanece no servidor
    else:
        faces.apply_optouts()          # oposições do banco durável valem já no primeiro acesso
    if settings.index_on_startup:
        jobs.start_background(trigger="inicializacao")
    yield


docs = os.getenv("ENABLE_API_DOCS", "").lower() in {"1", "true"}
app = FastAPI(
    title="FJU Night — A Noite da Herança",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if docs else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if docs else None,
)

if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                       allow_methods=["GET"], allow_headers=["Content-Type"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    if is_https(request):
        response.headers.setdefault("Strict-Transport-Security", HSTS)
    if request.url.path.startswith("/api/admin") or request.url.path == "/admin":
        response.headers["Cache-Control"] = "no-store"
        response.headers.setdefault("X-Robots-Tag", "noindex, nofollow")
    return response


class CachedStatic(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            versioned = f"v={ASSET_VERSION}" in scope.get("query_string", b"").decode()
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if versioned \
                else "public, max-age=3600"
        return response


app.include_router(routes_public.router)
app.include_router(routes_faces.router)
app.include_router(routes_admin.public)
app.include_router(routes_admin.router)
app.mount("/assets", CachedStatic(directory=ASSETS), name="assets")

_html_cache: dict[str, str] = {}


def _page(name: str) -> HTMLResponse:
    if name not in _html_cache:
        _html_cache[name] = (FRONTEND / name).read_text(encoding="utf-8").replace("__V__", ASSET_VERSION)
    return HTMLResponse(_html_cache[name], headers={"Cache-Control": "no-cache"})


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
def home() -> HTMLResponse:
    return _page("index.html")


@app.api_route("/privacidade", methods=["GET", "HEAD"], include_in_schema=False)
def privacy() -> HTMLResponse:
    return _page("privacidade.html")


@app.get("/admin", include_in_schema=False)
def admin() -> HTMLResponse:
    return _page("admin.html")


@app.get("/robots.txt", include_in_schema=False)
def robots() -> PlainTextResponse:
    return PlainTextResponse("User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /media/\n")


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> FileResponse:
    return FileResponse(Path(ASSETS / "img" / "favicon.svg"), media_type="image/svg+xml")
