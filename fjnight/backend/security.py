"""Autenticação administrativa, limite de requisições e cabeçalhos de segurança."""
from __future__ import annotations

import secrets
import threading
import time
from collections import deque

from fastapi import Header, HTTPException, Request

from .config import settings


def admin_required(token: str | None = Header(default=None, alias="X-Admin-Token")) -> None:
    if not settings.admin_configured:
        raise HTTPException(503, detail="admin_not_configured")
    if not token or not secrets.compare_digest(token.encode(), settings.admin_token.encode()):
        time.sleep(0.4)  # desestimula tentativa e erro
        raise HTTPException(401, detail="admin_unauthorized")


class RateLimiter:
    """Janela deslizante em memória, por endereço de origem."""

    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit, self.window = limit, window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> int | None:
        """Registra uma tentativa. Retorna segundos de espera se o limite foi atingido."""
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > 5000:  # limpeza ocasional
                for k in [k for k, q in self._hits.items() if not q or now - q[-1] > self.window]:
                    del self._hits[k]
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return max(1, int(self.window - (now - q[0])))
            q.append(now)
            return None


def client_key(request: Request) -> str:
    return request.client.host if request.client else "desconhecido"


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
        "style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; "
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    ),
}
