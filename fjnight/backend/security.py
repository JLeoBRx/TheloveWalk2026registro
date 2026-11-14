"""Segurança: sessões administrativas, CSRF, limites de requisição, IP real e cabeçalhos.

Sessões
- Login troca o ADMIN_TOKEN por uma sessão: cookie HttpOnly + SameSite=Strict
  (+ Secure em produção). O token nunca fica guardado no navegador.
- No banco fica só o SHA-256 do identificador da sessão.
- Expira por inatividade (ADMIN_SESSION_IDLE_MINUTES) e por idade máxima
  (ADMIN_SESSION_MAX_HOURS). Logout apaga a sessão no servidor.

CSRF
- Toda operação que altera dados exige o cabeçalho X-CSRF-Token da sessão e,
  quando o navegador envia Origin, que ele seja o próprio site.

IP do visitante
- Atrás de proxy (Render), só o IP acrescentado pelo proxy confiável é usado
  (TRUSTED_PROXY_HOPS); valores enviados pelo visitante em X-Forwarded-For são ignorados.
"""
from __future__ import annotations

import asyncio
import hashlib
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass

from fastapi import HTTPException, Request
from sqlalchemy import delete, select, update

from . import durable
from .config import settings
from .durable import admin_sessions

SESSION_COOKIE = "fjn_admin"
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


# ---------------------------------------------------------------------------
# IP do cliente
# ---------------------------------------------------------------------------
def client_ip(request: Request) -> str:
    direct = request.client.host if request.client else "desconhecido"
    if settings.client_ip_header:
        value = request.headers.get(settings.client_ip_header, "").strip()
        if value:
            return value
    hops = settings.trusted_proxy_hops
    if hops <= 0:
        return direct
    forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    # O proxy confiável mais próximo acrescenta o IP real no fim da lista.
    return forwarded[-hops] if len(forwarded) >= hops else direct


def network_diagnostics(request: Request) -> dict:
    """Ajuda a calibrar TRUSTED_PROXY_HOPS/CLIENT_IP_HEADER (mostrado só no painel)."""
    forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    return {
        "client_ip_seen": client_ip(request),
        "forwarded_for_entries": len(forwarded),
        "trusted_proxy_hops": settings.trusted_proxy_hops,
        "client_ip_header": settings.client_ip_header or None,
        "headers_present": [h for h in ("cf-connecting-ip", "true-client-ip", "x-real-ip") if h in request.headers],
        "https": is_https(request),
    }


def is_https(request: Request) -> bool:
    if settings.trusted_proxy_hops > 0:
        proto = request.headers.get("x-forwarded-proto", "").split(",")[-1].strip().lower()
        if proto:
            return proto == "https"
    return request.url.scheme == "https"


# ---------------------------------------------------------------------------
# Limites de requisição
# ---------------------------------------------------------------------------
class RateLimiter:
    """Janela deslizante em memória, por chave (ex.: IP)."""

    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit, self.window = limit, window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> int | None:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > 5000:
                for k in [k for k, q in self._hits.items() if not q or now - q[-1] > self.window]:
                    del self._hits[k]
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return max(1, int(self.window - (now - q[0])))
            q.append(now)
            return None


class LoginGuard:
    """Bloqueia por IP após falhas seguidas de login."""

    def __init__(self) -> None:
        self._state: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()

    def blocked_for(self, ip: str) -> int:
        with self._lock:
            fails, until = self._state.get(ip, (0, 0.0))
            return max(0, int(until - time.time()))

    def failure(self, ip: str) -> None:
        with self._lock:
            fails, until = self._state.get(ip, (0, 0.0))
            fails += 1
            until = time.time() + settings.login_lockout_minutes * 60 if fails >= settings.login_max_failures else 0.0
            self._state[ip] = (0 if until else fails, until)

    def success(self, ip: str) -> None:
        with self._lock:
            self._state.pop(ip, None)


login_guard = LoginGuard()


async def read_limited_body(request: Request, limit: int, allowed_types: set[str] | None = None) -> bytes:
    """Lê o corpo da requisição só na memória, recusando excessos sem gravar em disco."""
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if allowed_types is not None and ctype not in allowed_types:
        raise HTTPException(415, detail="unsupported_media_type")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(413, detail="file_too_large")
    buf = bytearray()
    async for chunk in request.stream():
        buf.extend(chunk)
        if len(buf) > limit:
            raise HTTPException(413, detail="file_too_large")
    return bytes(buf)


# ---------------------------------------------------------------------------
# Sessões administrativas
# ---------------------------------------------------------------------------
@dataclass
class AdminSession:
    id_hash: str
    csrf: str
    expires_at: float
    idle_expires_at: float


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def check_admin_token(candidate: str) -> bool:
    if not settings.admin_configured or not isinstance(candidate, str):
        return False
    return secrets.compare_digest(candidate.encode(), settings.admin_token.encode())


def create_session() -> tuple[str, AdminSession]:
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    now = time.time()
    expires = now + settings.session_max_hours * 3600
    with durable.tx() as c:
        c.execute(delete(admin_sessions).where(admin_sessions.c.expires_at < now))
        c.execute(admin_sessions.insert().values(id_hash=_hash(token), csrf=csrf, created_at=now,
                                                 last_seen=now, expires_at=expires))
    return token, AdminSession(_hash(token), csrf, expires, now + settings.session_idle_minutes * 60)


def load_session(request: Request, touch: bool = True) -> AdminSession | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token or len(token) > 200:
        return None
    now = time.time()
    with durable.tx() as c:
        row = c.execute(select(admin_sessions).where(admin_sessions.c.id_hash == _hash(token))).mappings().first()
        if not row:
            return None
        idle_limit = row["last_seen"] + settings.session_idle_minutes * 60
        if row["expires_at"] < now or idle_limit < now:
            c.execute(delete(admin_sessions).where(admin_sessions.c.id_hash == row["id_hash"]))
            return None
        if touch:
            c.execute(update(admin_sessions).where(admin_sessions.c.id_hash == row["id_hash"]).values(last_seen=now))
            idle_limit = now + settings.session_idle_minutes * 60
    return AdminSession(row["id_hash"], row["csrf"], row["expires_at"], idle_limit)


def destroy_session(request: Request) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with durable.tx() as c:
            c.execute(delete(admin_sessions).where(admin_sessions.c.id_hash == _hash(token)))


def destroy_all_sessions() -> None:
    with durable.tx() as c:
        c.execute(delete(admin_sessions))


def set_session_cookie(response, token: str, request: Request) -> None:
    response.set_cookie(SESSION_COOKIE, token, max_age=settings.session_max_hours * 3600, httponly=True,
                        secure=settings.production or is_https(request), samesite="strict", path="/")


def clear_session_cookie(response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def _same_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    if not origin:
        return True  # navegadores enviam Origin em POST/PATCH/DELETE; ferramentas de linha de comando não
    host = request.headers.get("host", "")
    return origin.split("://", 1)[-1] == host


async def admin_required(request: Request) -> AdminSession:
    if not settings.admin_configured:
        raise HTTPException(503, detail="admin_not_configured")
    session = load_session(request)
    if session is None:
        await asyncio.sleep(0.2)
        raise HTTPException(401, detail="admin_session_required")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        sent = request.headers.get("x-csrf-token", "")
        if not sent or not secrets.compare_digest(sent, session.csrf) or not _same_origin(request):
            raise HTTPException(403, detail="csrf_failed")
    request.state.admin = session
    return session


def require_durable() -> None:
    """Decisões administrativas permanentes exigem banco durável."""
    if not settings.durable_storage:
        raise HTTPException(409, detail="durable_storage_required")


# ---------------------------------------------------------------------------
# Cabeçalhos
# ---------------------------------------------------------------------------
YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com"

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; "
        f"font-src 'self'; script-src 'self'; connect-src 'self'; frame-src {YOUTUBE_ORIGIN}; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
    ),
}
HSTS = "max-age=31536000; includeSubDomains"
