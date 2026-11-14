"""Autenticação, sessões, CSRF, limites, cabeçalhos e tratamento de uploads."""
import os
import tempfile
import time

import pytest
from sqlalchemy import update

from backend import durable, security
from backend.config import settings
from support import TOKEN, admin_client, client, jpeg, put_original, reset_everything, set_setting, simulate_restart, sync

ADMIN_ROUTES = [
    ("GET", "/api/admin/status"), ("GET", "/api/admin/history"), ("GET", "/api/admin/photos"),
    ("POST", "/api/admin/sync"), ("GET", "/api/admin/config/export"), ("POST", "/api/admin/faces/authorize"),
    ("DELETE", "/api/admin/faces"), ("PUT", "/api/admin/playlist"), ("POST", "/api/admin/faces/optout"),
]


@pytest.fixture(autouse=True)
def fresh():
    reset_everything()
    yield


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
def test_admin_routes_require_session(method, path):
    r = client().request(method, path, json={})
    assert r.status_code == 401


def test_old_header_token_is_not_accepted():
    r = client().get("/api/admin/status", headers={"X-Admin-Token": TOKEN})
    assert r.status_code == 401


def test_login_sets_protected_cookie_and_wrong_token_fails():
    c = client()
    assert c.post("/api/admin/login", json={"token": "errado"}).status_code == 401
    r = c.post("/api/admin/login", json={"token": TOKEN})
    assert r.status_code == 200 and r.json()["csrf"]
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert TOKEN not in r.text
    assert c.get("/api/admin/status").status_code == 200


def test_secure_cookie_in_production():
    set_setting("app_env", "production")
    set_setting("sqlite_is_durable", True)
    r = client().post("/api/admin/login", json={"token": TOKEN})
    assert "secure" in r.headers["set-cookie"].lower()


def test_login_lockout_after_failures():
    c = client()
    for _ in range(settings.login_max_failures):
        assert c.post("/api/admin/login", json={"token": "errado"}).status_code == 401
    r = c.post("/api/admin/login", json={"token": TOKEN})
    assert r.status_code == 429 and r.json()["retry_after"] > 0


def test_lockout_uses_real_ip_not_spoofed_header():
    c = client()
    for i in range(settings.login_max_failures):
        c.post("/api/admin/login", json={"token": "errado"},
               headers={"X-Forwarded-For": f"10.9.9.{i}, 200.0.0.1"})
    # O visitante troca o valor forjado, mas o IP acrescentado pelo proxy é o mesmo.
    r = c.post("/api/admin/login", json={"token": TOKEN}, headers={"X-Forwarded-For": "1.1.1.1, 200.0.0.1"})
    assert r.status_code == 429


def test_csrf_and_origin_are_enforced():
    c, h = admin_client()
    assert c.post("/api/admin/sync", json={"confirm": True}).status_code == 403
    assert c.post("/api/admin/sync", json={"confirm": True}, headers={"X-CSRF-Token": "outro"}).status_code == 403
    bad_origin = {**h, "Origin": "https://site-malicioso.example"}
    assert c.post("/api/admin/sync", json={"confirm": True}, headers=bad_origin).status_code == 403
    assert c.post("/api/admin/sync", json={"confirm": True}, headers=h).status_code == 202


def test_session_idle_expiry():
    c, _ = admin_client()
    with durable.tx() as conn:
        conn.execute(update(durable.admin_sessions).values(last_seen=time.time() - settings.session_idle_minutes * 60 - 5))
    assert c.get("/api/admin/status").status_code == 401


def test_session_absolute_expiry():
    c, _ = admin_client()
    with durable.tx() as conn:
        conn.execute(update(durable.admin_sessions).values(expires_at=time.time() - 1))
    assert c.get("/api/admin/status").status_code == 401


def test_logout_and_revoke_all():
    c, h = admin_client()
    assert c.post("/api/admin/logout", headers=h, json={}).status_code == 200
    c.cookies.clear()
    assert c.get("/api/admin/status").status_code == 401
    c1, h1 = admin_client()
    c2, _ = admin_client()
    c1.post("/api/admin/sessions/revoke-all", headers=h1, json={})
    assert c2.get("/api/admin/status").status_code == 401


def test_session_survives_server_restart():
    c, _ = admin_client()
    simulate_restart()
    assert c.get("/api/admin/status").status_code == 200


def test_security_headers():
    r = client().get("/", headers={"X-Forwarded-Proto": "https"})
    csp = r.headers["content-security-policy"]
    assert "unsafe-inline" not in csp and "default-src 'self'" in csp and "frame-src https://www.youtube-nocookie.com" in csp
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cross-origin-opener-policy"] == "same-origin"
    assert "max-age" in r.headers["strict-transport-security"]
    assert "strict-transport-security" not in client().get("/").headers
    admin = client().get("/admin")
    assert admin.headers["x-robots-tag"].startswith("noindex") and admin.headers["cache-control"] == "no-store"


def test_html_pages_have_no_inline_styles_or_scripts():
    from backend.main import FRONTEND
    for page in ("index.html", "admin.html", "privacidade.html"):
        html = (FRONTEND / page).read_text(encoding="utf-8")
        assert 'style="' not in html
        assert "<script>" not in html and "onclick=" not in html


def test_client_ip_ignores_spoofed_forwarded_for():
    from starlette.requests import Request
    scope = {"type": "http", "client": ("10.0.0.5", 1), "headers": [(b"x-forwarded-for", b"6.6.6.6, 200.1.2.3")]}
    assert security.client_ip(Request(scope)) == "200.1.2.3"


def test_face_upload_is_never_written_to_disk(monkeypatch):
    """A selfie é lida do corpo bruto na memória: nada vai para arquivos temporários."""
    from support import enable_face_search, search
    put_original("a.jpg", jpeg())
    sync()
    c, h = admin_client()
    enable_face_search(c, h)
    created = []
    real_mkstemp, real_named = tempfile.mkstemp, tempfile.NamedTemporaryFile
    monkeypatch.setattr(tempfile, "mkstemp", lambda *a, **k: created.append("mkstemp") or real_mkstemp(*a, **k))
    monkeypatch.setattr(tempfile, "NamedTemporaryFile", lambda *a, **k: created.append("named") or real_named(*a, **k))
    monkeypatch.setattr(tempfile, "SpooledTemporaryFile", lambda *a, **k: created.append("spooled"))
    before = {p for p in settings.data_dir.rglob("*")}
    big = jpeg(size=(3000, 2000)) + b"\0" * (2 * 1024 * 1024)   # > 1 MB, limite do antigo multipart
    r = search(client(), big)
    assert r.status_code in (200, 422)
    after = {p for p in settings.data_dir.rglob("*")}
    assert created == []
    assert {p for p in after - before if "biometria" not in str(p)} == set()


def test_upload_limits_and_types():
    from support import enable_face_search, search
    put_original("a.jpg", jpeg())
    sync()
    c, h = admin_client()
    enable_face_search(c, h)
    set_setting("max_upload_bytes", 1000)
    try:
        r = search(client(), b"x" * 2000)
        assert r.status_code == 413 and r.json()["code"] == "file_too_large"
    finally:
        set_setting("max_upload_bytes", 12 * 1024 * 1024)
    r = search(client(), b"<svg/>", ctype="image/svg+xml")
    assert r.status_code == 415
    r = search(client(), b"GIF89a....", ctype="image/jpeg")
    assert r.status_code == 400 and r.json()["code"] == "invalid_image"


def test_search_rate_limit_by_real_ip():
    from backend import routes_faces
    from backend.security import RateLimiter
    from support import enable_face_search, search
    put_original("a.jpg", jpeg())
    sync()
    c, h = admin_client()
    enable_face_search(c, h)
    old = routes_faces.limiter
    routes_faces.limiter = RateLimiter(2, 600)
    try:
        cl = client()
        codes = []
        for i in range(3):
            r = cl.post("/api/faces/search", content=jpeg(), headers={
                "Content-Type": "image/jpeg", "X-Consent": "true",
                "X-Consent-Version": routes_faces.CONSENT_VERSION, "X-Forwarded-For": f"9.9.9.{i}, 201.0.0.7"})
            codes.append(r.status_code)
        assert codes[-1] == 429
    finally:
        routes_faces.limiter = old


def test_no_secrets_in_public_responses():
    c = client()
    for path in ("/api/status", "/api/event", "/api/privacy", "/api/faces/status", "/api/playlist"):
        body = c.get(path).text
        assert TOKEN not in body and os.environ["FACE_DATA_KEY"] not in body and "DATABASE" not in body
