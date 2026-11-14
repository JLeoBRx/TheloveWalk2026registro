"""Configuração central da FJU Night — A Noite da Herança.

Valores vêm de variáveis de ambiente (ou do arquivo `.env` em `fjnight/`).
Textos públicos ficam em `config/`: `event.json` (evento), `privacy.json`
(controlador, contato e bases legais — nunca inventados pelo sistema) e
`playlist.json` (trilha sonora).
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

APP_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(APP_ROOT / ".env")


def _path(name: str, default: Path) -> Path:
    raw = os.getenv(name, "").strip()
    value = Path(raw).expanduser() if raw else default
    return (value if value.is_absolute() else APP_ROOT / value).resolve()


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "sim", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _str(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _database_url(data_dir: Path) -> str:
    url = _str("DATABASE_URL")
    if not url:
        return f"sqlite:///{data_dir / 'fjnight.sqlite3'}"
    # Render/Heroku fornecem "postgres://"; o SQLAlchemy exige o driver explícito.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@dataclass(frozen=True)
class Settings:
    app_env: str = field(default_factory=lambda: _str("APP_ENV", "development").lower())

    # Pastas locais
    photo_dir: Path = field(default_factory=lambda: _path("PHOTO_DIR", APP_ROOT / "fotos"))
    data_dir: Path = field(default_factory=lambda: _path("DATA_DIR", APP_ROOT / "data"))
    models_dir: Path = field(default_factory=lambda: _path("MODELS_DIR", APP_ROOT / "models"))
    frontend_dir: Path = field(default_factory=lambda: APP_ROOT / "frontend")
    config_dir: Path = field(default_factory=lambda: _path("CONFIG_DIR", APP_ROOT / "config"))

    # Banco durável (PostgreSQL em produção)
    database_url: str = field(default_factory=lambda: _database_url(_path("DATA_DIR", APP_ROOT / "data")))
    # Afirmação explícita de que um SQLite está num disco persistente (ex.: disco do Render).
    sqlite_is_durable: bool = field(default_factory=lambda: _bool("SQLITE_ON_PERSISTENT_DISK", False))

    # Armazenamento das fotos: "local" (pasta fotos/) ou "r2" (Cloudflare R2)
    storage_backend: str = field(default_factory=lambda: _str("STORAGE_BACKEND", "r2" if _str("R2_BUCKET") else "local").lower())
    r2_account_id: str = field(default_factory=lambda: _str("R2_ACCOUNT_ID"))
    r2_access_key_id: str = field(default_factory=lambda: _str("R2_ACCESS_KEY_ID"))
    r2_secret_access_key: str = field(default_factory=lambda: _str("R2_SECRET_ACCESS_KEY"))
    r2_bucket: str = field(default_factory=lambda: _str("R2_BUCKET"))
    r2_endpoint: str = field(default_factory=lambda: _str("R2_ENDPOINT"))
    r2_originals_prefix: str = field(default_factory=lambda: _str("R2_ORIGINALS_PREFIX", "originais/"))
    r2_derivatives_prefix: str = field(default_factory=lambda: _str("R2_DERIVATIVES_PREFIX", "derivados/"))
    r2_download_ttl: int = field(default_factory=lambda: _int("R2_DOWNLOAD_URL_TTL_SECONDS", 300))

    # Administração e segurança
    admin_token: str = field(default_factory=lambda: _str("ADMIN_TOKEN"))
    session_idle_minutes: int = field(default_factory=lambda: _int("ADMIN_SESSION_IDLE_MINUTES", 30))
    session_max_hours: int = field(default_factory=lambda: _int("ADMIN_SESSION_MAX_HOURS", 8))
    login_max_failures: int = field(default_factory=lambda: _int("ADMIN_LOGIN_MAX_FAILURES", 5))
    login_lockout_minutes: int = field(default_factory=lambda: _int("ADMIN_LOGIN_LOCKOUT_MINUTES", 15))
    # Quantos proxies reversos confiáveis existem antes da aplicação (Render = 1).
    trusted_proxy_hops: int = field(default_factory=lambda: _int("TRUSTED_PROXY_HOPS", 0))
    # Alternativa: cabeçalho que a borda (ex.: Cloudflare) sempre sobrescreve, como cf-connecting-ip.
    client_ip_header: str = field(default_factory=lambda: _str("CLIENT_IP_HEADER").lower())
    cors_origins: tuple[str, ...] = field(default_factory=lambda: tuple(
        s.strip() for s in os.getenv("CORS_ORIGINS", "").split(",") if s.strip()
    ))

    # Imagens
    max_image_pixels: int = field(default_factory=lambda: _int("MAX_IMAGE_PIXELS", 60_000_000))
    thumb_size: int = field(default_factory=lambda: _int("THUMB_SIZE", 720))
    display_size: int = field(default_factory=lambda: _int("DISPLAY_SIZE", 2048))
    downloads_default: bool = field(default_factory=lambda: _bool("DOWNLOADS_DEFAULT", True))
    raw_original_downloads: bool = field(default_factory=lambda: _bool("RAW_ORIGINAL_DOWNLOADS", True))
    new_photos_require_review: bool = field(default_factory=lambda: _bool("NEW_PHOTOS_REQUIRE_REVIEW", False))

    # Reconhecimento facial — DESLIGADO por padrão. Ligar a variável não basta:
    # é preciso também o registro de autorização feito no painel (ver faces.authorization()).
    face_search_enabled: bool = field(default_factory=lambda: _bool("FACE_SEARCH_ENABLED", False))
    face_match_threshold: float = field(default_factory=lambda: _float("FACE_MATCH_THRESHOLD", 0.40))
    face_high_margin: float = field(default_factory=lambda: _float("FACE_HIGH_CONFIDENCE_MARGIN", 0.12))
    face_optout_threshold: float = field(default_factory=lambda: _float("FACE_OPTOUT_THRESHOLD", 0.36))
    face_detect_score: float = field(default_factory=lambda: _float("FACE_DETECT_SCORE", 0.80))
    face_min_size_index: int = field(default_factory=lambda: _int("FACE_MIN_SIZE_INDEX", 28))
    face_min_size_query: int = field(default_factory=lambda: _int("FACE_MIN_SIZE_QUERY", 60))
    face_retention_days: int = field(default_factory=lambda: _int("FACE_DATA_RETENTION_DAYS", 90))
    face_data_key: str = field(default_factory=lambda: _str("FACE_DATA_KEY"))
    face_max_results: int = field(default_factory=lambda: _int("FACE_MAX_RESULTS", 300))
    max_upload_bytes: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 12) * 1024 * 1024)
    search_rate_limit: int = field(default_factory=lambda: _int("FACE_SEARCH_RATE_LIMIT", 10))
    search_rate_window: int = field(default_factory=lambda: _int("FACE_SEARCH_RATE_WINDOW_SECONDS", 600))

    index_on_startup: bool = field(default_factory=lambda: _bool("INDEX_ON_STARTUP", True))

    @property
    def production(self) -> bool:
        return self.app_env == "production"

    @property
    def admin_configured(self) -> bool:
        token = self.admin_token
        return len(token) >= 24 and "troque" not in token.lower()

    @property
    def database_kind(self) -> str:
        return "postgresql" if self.database_url.startswith("postgresql") else "sqlite"

    @property
    def durable_storage(self) -> bool:
        """Decisões administrativas só são aceitas quando o banco sobrevive a deploys."""
        if self.database_kind == "postgresql":
            return True
        if self.sqlite_is_durable:
            return True
        # Em desenvolvimento o SQLite local é o próprio disco da máquina.
        return not self.production

    # Caminhos locais (efêmeros no Render Free: cache e índice reconstruíveis)
    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def derivatives_dir(self) -> Path:
        return self.data_dir / "derivados"

    @property
    def biometric_dir(self) -> Path:
        return self.data_dir / "biometria"

    @property
    def faces_db(self) -> Path:
        return self.biometric_dir / "indice-facial.sqlite3"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"


settings = Settings()


# ---------------------------------------------------------------------------
# Textos públicos versionados
# ---------------------------------------------------------------------------
DEFAULT_EVENT = {
    "name": "FJU Night",
    "theme": "A Noite da Herança",
    "date": "2026-11-13",
    "date_label": "13 de novembro",
    "time": "23h",
    "address": "Av. Wild José de Souza, 175 — Centro",
    "map_url": "",
    "institution": "Jesus Cristo é o Senhor",
    "institution_brand": "Universal",
    "broadcast": "Com transmissão para todo o Brasil",
}

PRIVACY_FIELDS = (
    "controller", "controller_document", "contact", "dpo", "requests_channel", "response_time",
    "legal_basis_publication", "legal_basis_face_index", "legal_basis_face_search", "attendees_notice",
)
# Campos sem os quais a busca facial não pode ser autorizada.
PRIVACY_REQUIRED_FOR_FACES = (
    "controller", "contact", "requests_channel", "legal_basis_face_index",
    "legal_basis_face_search", "attendees_notice",
)


def _read_json(name: str) -> dict:
    path = settings.config_dir / name
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:  # configuração inválida não derruba o site
        print(f"[config] {name} ignorado: {type(exc).__name__}", flush=True)
        return {}


def load_event() -> dict:
    data = dict(DEFAULT_EVENT)
    data.update({k: v.strip() for k, v in _read_json("event.json").items() if isinstance(v, str)})
    return data


def load_privacy() -> dict:
    raw = _read_json("privacy.json")
    return {k: raw[k].strip() if isinstance(raw.get(k), str) else "" for k in PRIVACY_FIELDS}


def privacy_fingerprint() -> str:
    """Impressão digital do texto de privacidade: a autorização vale só para esta versão."""
    canonical = json.dumps(load_privacy(), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def event_date() -> date:
    try:
        return date.fromisoformat(load_event()["date"])
    except (KeyError, ValueError):
        return date.fromisoformat(DEFAULT_EVENT["date"])


def face_data_expires_at() -> datetime:
    """Data a partir da qual todo dado biométrico é apagado e a busca é desligada."""
    override = _str("FACE_DATA_EXPIRES_AT")
    if override:
        try:
            parsed = datetime.fromisoformat(override)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    start = datetime.combine(event_date(), datetime.min.time(), tzinfo=timezone.utc)
    return start + timedelta(days=settings.face_retention_days)


def ensure_dirs() -> None:
    for d in (settings.data_dir, settings.cache_dir, settings.derivatives_dir, settings.biometric_dir,
              settings.tmp_dir):
        d.mkdir(parents=True, exist_ok=True)
    if settings.storage_backend == "local":
        settings.photo_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(settings.biometric_dir, 0o700)
    except OSError:
        pass


ensure_dirs()
