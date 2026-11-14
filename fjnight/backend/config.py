"""Configuração central da FJ Night — A Noite da Herança.

Todos os valores podem ser definidos por variáveis de ambiente (ou pelo arquivo
`.env` na pasta `fjnight/`). As informações do evento ficam em
`config/event.json`, para que possam ser editadas sem alterar código.
"""
from __future__ import annotations

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


@dataclass(frozen=True)
class Settings:
    # Pastas
    photo_dir: Path = field(default_factory=lambda: _path("PHOTO_DIR", APP_ROOT / "fotos"))
    data_dir: Path = field(default_factory=lambda: _path("DATA_DIR", APP_ROOT / "data"))
    models_dir: Path = field(default_factory=lambda: _path("MODELS_DIR", APP_ROOT / "models"))
    frontend_dir: Path = field(default_factory=lambda: APP_ROOT / "frontend")
    config_dir: Path = field(default_factory=lambda: _path("CONFIG_DIR", APP_ROOT / "config"))

    # Segurança
    admin_token: str = field(default_factory=lambda: os.getenv("ADMIN_TOKEN", "").strip())
    cors_origins: tuple[str, ...] = field(default_factory=lambda: tuple(
        s.strip() for s in os.getenv("CORS_ORIGINS", "").split(",") if s.strip()
    ))

    # Imagens
    max_image_pixels: int = field(default_factory=lambda: _int("MAX_IMAGE_PIXELS", 60_000_000))
    thumb_size: int = field(default_factory=lambda: _int("THUMB_SIZE", 720))
    display_size: int = field(default_factory=lambda: _int("DISPLAY_SIZE", 2048))
    downloads_default: bool = field(default_factory=lambda: _bool("DOWNLOADS_DEFAULT", True))

    # Reconhecimento facial
    face_search_enabled: bool = field(default_factory=lambda: _bool("FACE_SEARCH_ENABLED", True))
    face_match_threshold: float = field(default_factory=lambda: _float("FACE_MATCH_THRESHOLD", 0.40))
    face_optout_threshold: float = field(default_factory=lambda: _float("FACE_OPTOUT_THRESHOLD", 0.36))
    face_detect_score: float = field(default_factory=lambda: _float("FACE_DETECT_SCORE", 0.80))
    face_min_size_index: int = field(default_factory=lambda: _int("FACE_MIN_SIZE_INDEX", 28))
    face_min_size_query: int = field(default_factory=lambda: _int("FACE_MIN_SIZE_QUERY", 60))
    face_retention_days: int = field(default_factory=lambda: _int("FACE_DATA_RETENTION_DAYS", 90))
    face_data_key: str = field(default_factory=lambda: os.getenv("FACE_DATA_KEY", "").strip())
    face_max_results: int = field(default_factory=lambda: _int("FACE_MAX_RESULTS", 300))
    max_upload_bytes: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 12) * 1024 * 1024)
    search_rate_limit: int = field(default_factory=lambda: _int("FACE_SEARCH_RATE_LIMIT", 10))
    search_rate_window: int = field(default_factory=lambda: _int("FACE_SEARCH_RATE_WINDOW_SECONDS", 600))

    # Indexação automática ao iniciar (útil quando não há etapa de build)
    index_on_startup: bool = field(default_factory=lambda: _bool("INDEX_ON_STARTUP", True))

    @property
    def admin_configured(self) -> bool:
        token = self.admin_token
        return len(token) >= 24 and "troque" not in token.lower()

    @property
    def thumbs_dir(self) -> Path:
        return self.data_dir / "derivados" / "miniaturas"

    @property
    def display_dir(self) -> Path:
        return self.data_dir / "derivados" / "exibicao"

    @property
    def raw_jpeg_dir(self) -> Path:
        return self.data_dir / "derivados" / "raw-jpeg"

    @property
    def catalog_db(self) -> Path:
        return self.data_dir / "catalogo.sqlite3"

    @property
    def biometric_dir(self) -> Path:
        return self.data_dir / "biometria"

    @property
    def faces_db(self) -> Path:
        return self.biometric_dir / "faces.sqlite3"


settings = Settings()


# ---------------------------------------------------------------------------
# Informações do evento (config/event.json)
# ---------------------------------------------------------------------------
DEFAULT_EVENT = {
    "name": "FJ Night",
    "theme": "A Noite da Herança",
    "date": "2026-11-13",
    "date_label": "13 de novembro",
    "time": "23h",
    "address": "Av. Wild José de Souza, 175 — Centro",
    "map_url": "",
    "institution": "Jesus Cristo é o Senhor",
    "institution_brand": "Universal",
    "broadcast": "Com transmissão para todo o Brasil",
    "privacy_contact": "",
    "controller": "",
}


def load_event() -> dict:
    data = dict(DEFAULT_EVENT)
    path = settings.config_dir / "event.json"
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                data.update({k: v for k, v in loaded.items() if isinstance(v, str)})
        except (OSError, json.JSONDecodeError) as exc:  # configuração inválida não derruba o site
            print(f"[config] event.json ignorado: {type(exc).__name__}", flush=True)
    return data


def event_date() -> date:
    try:
        return date.fromisoformat(load_event()["date"])
    except (KeyError, ValueError):
        return date.fromisoformat(DEFAULT_EVENT["date"])


def face_data_expires_at() -> datetime:
    """Data a partir da qual todo dado biométrico é apagado e a busca é desligada."""
    override = os.getenv("FACE_DATA_EXPIRES_AT", "").strip()
    if override:
        try:
            parsed = datetime.fromisoformat(override)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    start = datetime.combine(event_date(), datetime.min.time(), tzinfo=timezone.utc)
    return start + timedelta(days=settings.face_retention_days)


for _dir in (settings.photo_dir, settings.data_dir, settings.thumbs_dir, settings.display_dir,
             settings.raw_jpeg_dir, settings.biometric_dir):
    _dir.mkdir(parents=True, exist_ok=True)
try:
    os.chmod(settings.biometric_dir, 0o700)
except OSError:
    pass
