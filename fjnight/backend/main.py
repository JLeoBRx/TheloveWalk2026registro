"""FJ Night — A Noite da Herança · servidor do álbum oficial.

Execute a partir da pasta `fjnight/`:
    uvicorn backend.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import hashlib
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import db, faces, jobs, routes_admin, routes_faces, routes_public
from .config import settings
from .security import SECURITY_HEADERS

FRONTEND = settings.frontend_dir
ASSETS = FRONTEND / "assets"


def _asset_version() -> str:
    digest = hashlib.sha1()
    for path in sorted(ASSETS.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(ASSETS).as_posix().encode())
            digest.update(str(path.stat().st_size).encode())
            digest.update(str(int(path.stat().st_mtime)).encode())
    return digest.hexdigest()[:10]


ASSET_VERSION = _asset_version()


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    faces.enforce_retention()
    if settings.index_on_startup and not jobs.prebuilt_index_is_current():
        jobs.start_background(include_faces=True)
        print("[inicio] indexação em segundo plano iniciada", flush=True)
    else:
        print("[inicio] índice pré-construído em uso", flush=True)
    yield


docs = os.getenv("ENABLE_API_DOCS", "").lower() in {"1", "true"}
app = FastAPI(
    title="FJ Night — A Noite da Herança",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if docs else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if docs else None,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-Admin-Token"],
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    return response


class CachedStatic(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            query = scope.get("query_string", b"").decode()
            versioned = f"v={ASSET_VERSION}" in query
            response.headers["Cache-Control"] = (
                "public, max-age=31536000, immutable" if versioned else "public, max-age=3600"
            )
        return response


app.include_router(routes_public.router)
app.include_router(routes_faces.router)
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
    response = _page("admin.html")
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response


@app.get("/robots.txt", include_in_schema=False)
def robots() -> PlainTextResponse:
    return PlainTextResponse("User-agent: *\nDisallow: /admin\nDisallow: /api/\n")


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> FileResponse:
    return FileResponse(Path(ASSETS / "img" / "favicon.svg"), media_type="image/svg+xml")
