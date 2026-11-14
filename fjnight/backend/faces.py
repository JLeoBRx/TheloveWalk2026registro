"""Reconhecimento facial com salvaguardas da LGPD.

A busca só funciona quando TODAS as condições abaixo são verdadeiras
(ver authorization_status()):

1. FACE_SEARCH_ENABLED=true (desligado por padrão);
2. banco durável configurado (oposições não podem se perder num deploy);
3. FACE_DATA_KEY definida e igual à usada nos registros existentes;
4. config/privacy.json com controlador, contato, canal e bases legais preenchidos;
5. registro de autorização feito no painel por um responsável, vinculado à
   versão exata do texto de privacidade (mudou o texto, precisa autorizar de novo);
6. prazo de retenção não encerrado; modelos presentes.

O consentimento de quem envia uma selfie NÃO autoriza indexar as demais pessoas:
o índice das fotos do evento só é criado depois da autorização do item 5.

Dados:
- selfie: lida em memória, nunca gravada;
- índice facial das fotos: arquivo local (reconstruível), vetores cifrados com
  AES-256-GCM, nunca exposto pela API;
- oposições: banco durável, vetor cifrado (necessário para continuar bloqueando a
  pessoa), reaplicadas ao índice a cada inicialização e sincronização;
- no fim da retenção, tudo é apagado e um recibo verificável é gravado.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterator

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image
from sqlalchemy import delete, func, select, update

from . import catalog, durable
from .config import (PRIVACY_REQUIRED_FOR_FACES, face_data_expires_at, load_privacy, privacy_fingerprint,
                     settings)
from .durable import face_authorizations, face_optouts
from .storage import store

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None

DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_FILE = "face_recognition_sface_2021dec.onnx"
EMBEDDING_DIM = 128

CHECKLIST = {
    "legal_basis_reviewed": "A base legal para indexar os rostos de todas as pessoas fotografadas foi revisada "
                            "pelo controlador (com assessoria jurídica) e está descrita na política de privacidade.",
    "attendees_informed": "Os participantes foram informados do registro fotográfico e da busca facial, como "
                          "descrito na política de privacidade.",
    "privacy_page_reviewed": "A página de privacidade publicada foi revisada e identifica corretamente controlador, "
                             "contato, finalidade, retenção, direitos e canal de atendimento.",
    "optout_channel_ready": "O canal de atendimento está operacional e a equipe sabe registrar pedidos de oposição "
                            "e de remoção.",
    "selfie_consent_not_enough": "Entendo que o consentimento de quem envia uma selfie não autoriza, por si só, a "
                                 "indexação das demais pessoas fotografadas.",
}


class FaceSearchError(Exception):
    def __init__(self, code: str, status: int = 422):
        super().__init__(code)
        self.code, self.status = code, status


# ---------------------------------------------------------------------------
# Motor OpenCV (YuNet + SFace)
# ---------------------------------------------------------------------------
class FaceEngine:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._detector = None
        self._recognizer = None

    @property
    def detector_path(self) -> Path:
        return settings.models_dir / DETECTOR_FILE

    @property
    def recognizer_path(self) -> Path:
        return settings.models_dir / RECOGNIZER_FILE

    def available(self) -> bool:
        return cv2 is not None and self.detector_path.is_file() and self.recognizer_path.is_file()

    def _ensure(self) -> None:
        if self._detector is not None:
            return
        if not self.available():
            raise FaceSearchError("face_models_unavailable", 503)
        cv2.setNumThreads(max(1, min(4, os.cpu_count() or 1)))
        self._detector = cv2.FaceDetectorYN.create(
            str(self.detector_path), "", (320, 320), settings.face_detect_score, 0.3, 5000)
        self._recognizer = cv2.FaceRecognizerSF.create(str(self.recognizer_path), "")

    def _detect_once(self, bgr: np.ndarray, score: float) -> np.ndarray:
        h, w = bgr.shape[:2]
        self._detector.setScoreThreshold(score)
        self._detector.setInputSize((w, h))
        _, found = self._detector.detect(bgr)
        return np.zeros((0, 15), np.float32) if found is None else found

    def detect(self, bgr: np.ndarray, *, score: float, min_size: int,
               scales: tuple[int, ...] = (2048, 1024, 512)) -> np.ndarray:
        """Detecção em várias escalas: o YuNet foi treinado para rostos de ~10 a ~300 px,
        então rostos muito próximos da câmera só aparecem na escala reduzida."""
        with self._lock:
            self._ensure()
            h, w = bgr.shape[:2]
            longest = max(h, w)
            merged: list[np.ndarray] = []
            for side in sorted({min(longest, s) for s in scales}, reverse=True):
                factor = side / longest
                img = bgr if factor >= 0.999 else cv2.resize(
                    bgr, (max(1, round(w * factor)), max(1, round(h * factor))), interpolation=cv2.INTER_AREA)
                for row in self._detect_once(img, score):
                    full = row.copy()
                    full[:14] = row[:14] / factor
                    merged.append(full)
            faces = _nms([f for f in merged if min(f[2], f[3]) >= min_size])
            faces.sort(key=lambda f: -(f[2] * f[3]))
            return np.array(faces, dtype=np.float32).reshape(-1, 15)

    def embed(self, bgr: np.ndarray, face: np.ndarray) -> np.ndarray:
        with self._lock:
            self._ensure()
            aligned = self._recognizer.alignCrop(bgr, face)
            vec = self._recognizer.feature(aligned).astype(np.float32).reshape(-1)
        norm = float(np.linalg.norm(vec))
        if not np.isfinite(norm) or norm == 0:
            raise FaceSearchError("face_embedding_failed")
        return vec / norm


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    iw = max(0.0, min(ax2, bx2) - max(a[0], b[0]))
    ih = max(0.0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def _nms(faces: list[np.ndarray], threshold: float = 0.4) -> list[np.ndarray]:
    kept: list[np.ndarray] = []
    for face in sorted(faces, key=lambda f: -float(f[14])):
        if all(_iou(face, k) < threshold for k in kept):
            kept.append(face)
    return kept


engine = FaceEngine()


def to_bgr(img: Image.Image) -> np.ndarray:
    return np.ascontiguousarray(np.asarray(img.convert("RGB"))[:, :, ::-1])


# ---------------------------------------------------------------------------
# Chave de cifragem
# ---------------------------------------------------------------------------
_key_lock = threading.Lock()
_aes: tuple[str, AESGCM] | None = None


def _secret() -> str | None:
    if settings.face_data_key:
        return settings.face_data_key
    if settings.production:
        return None  # em produção a chave precisa vir do ambiente, nunca do disco efêmero
    key_file = settings.biometric_dir / ".chave-desenvolvimento"
    if not key_file.is_file():
        key_file.write_text(base64.b64encode(secrets.token_bytes(32)).decode(), encoding="ascii")
        os.chmod(key_file, 0o600)
    return key_file.read_text(encoding="ascii").strip()


def key_fingerprint() -> str | None:
    secret = _secret()
    if not secret:
        return None
    return hmac.new(secret.encode(), b"fjnight-key-fingerprint-v1", hashlib.sha256).hexdigest()[:16]


def _cipher() -> AESGCM:
    global _aes
    secret = _secret()
    if not secret:
        raise FaceSearchError("face_key_missing", 503)
    with _key_lock:
        if _aes is None or _aes[0] != secret:
            _aes = (secret, AESGCM(hashlib.sha256(("fjnight-faces-v1|" + secret).encode()).digest()))
        return _aes[1]


def _seal(vec: np.ndarray, aad: bytes) -> tuple[bytes, bytes]:
    nonce = secrets.token_bytes(12)
    return nonce, _cipher().encrypt(nonce, vec.astype(np.float32).tobytes(), aad)


def _open(nonce: bytes, blob: bytes, aad: bytes) -> np.ndarray:
    return np.frombuffer(_cipher().decrypt(nonce, bytes(blob), aad), dtype=np.float32)


def _aad_face(pid: str) -> bytes:
    return b"face|" + pid.encode()


_AAD_OPTOUT = b"optout|v1"


def key_status() -> dict:
    current = key_fingerprint()
    stored = durable.kv_get("face_key_fp", "")
    return {"configured": current is not None, "from_env": bool(settings.face_data_key),
            "matches": current is not None and (not stored or stored == current),
            "fingerprint": current}


def _pin_key(conn=None) -> None:
    if not durable.kv_get("face_key_fp", "", conn=conn):
        durable.kv_set("face_key_fp", key_fingerprint() or "", conn=conn)


# ---------------------------------------------------------------------------
# Autorização de ativação
# ---------------------------------------------------------------------------
def expired() -> bool:
    return datetime.now(timezone.utc) >= face_data_expires_at()


def active_authorization() -> dict | None:
    with durable.tx() as c:
        row = c.execute(select(face_authorizations).where(face_authorizations.c.revoked_at.is_(None))
                        .order_by(face_authorizations.c.id.desc())).mappings().first()
    return dict(row) if row else None


def authorization_status() -> dict:
    privacy = load_privacy()
    missing = [f for f in PRIVACY_REQUIRED_FOR_FACES if not privacy.get(f)]
    record = active_authorization()
    key = key_status()
    checks = {
        "env_enabled": settings.face_search_enabled,
        "durable_storage": settings.durable_storage,
        "key_configured": key["configured"],
        "key_matches": key["matches"],
        "privacy_complete": not missing,
        "authorized": record is not None,
        "privacy_unchanged": bool(record) and record["privacy_fp"] == privacy_fingerprint(),
        "within_retention": not expired(),
        "models_available": engine.available(),
    }
    messages = {
        "env_enabled": "FACE_SEARCH_ENABLED não está ativo no servidor.",
        "durable_storage": "Banco durável (DATABASE_URL) não configurado: oposições poderiam se perder.",
        "key_configured": "FACE_DATA_KEY não configurada.",
        "key_matches": "FACE_DATA_KEY diferente da usada nos registros existentes.",
        "privacy_complete": "Preencha em config/privacy.json: " + ", ".join(missing) + ".",
        "authorized": "Falta o registro de autorização do responsável no painel.",
        "privacy_unchanged": "O texto de privacidade mudou depois da autorização: é preciso autorizar novamente.",
        "within_retention": "O prazo de retenção terminou; a busca foi encerrada.",
        "models_available": "Modelos faciais ausentes no servidor.",
    }
    pending = [{"code": k, "message": messages[k]} for k, ok in checks.items() if not ok
               and not (k == "privacy_unchanged" and not checks["authorized"])]
    return {
        "authorized": not pending,
        "checks": checks,
        "pending": pending,
        "missing_privacy_fields": missing,
        "authorization": None if not record else {
            "id": record["id"], "created_at": record["created_at"], "confirmed_by": record["confirmed_by"],
            "role": record["role"],
        },
        "expires_at": face_data_expires_at().isoformat(),
    }


def authorize(confirmed_by: str, role: str, checklist: dict) -> dict:
    confirmed_by, role = confirmed_by.strip()[:200], role.strip()[:200]
    if not confirmed_by or not role:
        raise FaceSearchError("authorization_identity_required", 400)
    if not all(checklist.get(k) is True for k in CHECKLIST):
        raise FaceSearchError("authorization_checklist_incomplete", 400)
    status = authorization_status()
    blocking = [p for p in status["pending"] if p["code"] not in ("authorized", "privacy_unchanged", "env_enabled")]
    if blocking:
        raise FaceSearchError("authorization_prerequisites_missing", 409)
    with durable.tx() as c:
        c.execute(update(face_authorizations).where(face_authorizations.c.revoked_at.is_(None))
                  .values(revoked_at=time.time(), revoked_by=confirmed_by, revoke_reason="Substituída"))
        c.execute(face_authorizations.insert().values(
            created_at=time.time(), confirmed_by=confirmed_by, role=role, privacy_fp=privacy_fingerprint(),
            checklist=json.dumps({k: True for k in CHECKLIST}, ensure_ascii=False)))
        _pin_key(conn=c)
    return authorization_status()


def revoke(by: str, reason: str) -> None:
    with durable.tx() as c:
        c.execute(update(face_authorizations).where(face_authorizations.c.revoked_at.is_(None))
                  .values(revoked_at=time.time(), revoked_by=by.strip()[:200] or "painel",
                          revoke_reason=reason.strip()[:500] or None))
    purge_local_index()


def authorization_history() -> list[dict]:
    with durable.tx() as c:
        rows = c.execute(select(face_authorizations).order_by(face_authorizations.c.id.desc()).limit(20)).mappings()
        return [{k: r[k] for k in ("id", "created_at", "confirmed_by", "role", "revoked_at", "revoked_by",
                                   "revoke_reason")} for r in rows]


# ---------------------------------------------------------------------------
# Índice facial local (efêmero, reconstruível, cifrado)
# ---------------------------------------------------------------------------
LOCAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS faces(id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id TEXT NOT NULL,
  score REAL NOT NULL, nonce BLOB NOT NULL, embedding BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS idx_faces_photo ON faces(photo_id);
CREATE TABLE IF NOT EXISTS face_photos(photo_id TEXT PRIMARY KEY, photo_version TEXT NOT NULL,
  faces INTEGER NOT NULL, indexed_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


@contextmanager
def local() -> Iterator[sqlite3.Connection]:
    settings.biometric_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.faces_db, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(LOCAL_SCHEMA)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    try:
        os.chmod(settings.faces_db, 0o600)
    except OSError:
        pass


def _local_bump(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT INTO meta(key,value) VALUES('version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                 (str(time.time_ns()),))


def purge_local_index() -> dict:
    """Apaga o arquivo do índice facial e confirma que ele não existe mais."""
    global _matrix_cache
    _matrix_cache = None
    counts = local_stats() if settings.faces_db.exists() else {"photos_indexed": 0, "faces_indexed": 0}
    for suffix in ("", "-wal", "-shm", "-journal"):
        Path(str(settings.faces_db) + suffix).unlink(missing_ok=True)
    return {**counts, "file_removed": not settings.faces_db.exists()}


def local_stats() -> dict:
    if not settings.faces_db.exists():
        return {"photos_indexed": 0, "faces_indexed": 0}
    with local() as c:
        return {"photos_indexed": c.execute("SELECT COUNT(*) FROM face_photos").fetchone()[0],
                "faces_indexed": c.execute("SELECT COUNT(*) FROM faces").fetchone()[0]}


# ---------------------------------------------------------------------------
# Oposições (banco durável)
# ---------------------------------------------------------------------------
_optout_cache: tuple[str, np.ndarray] | None = None


def _optout_vectors() -> np.ndarray:
    global _optout_cache
    version = durable.kv_get("optouts_version", "0")
    if _optout_cache and _optout_cache[0] == version:
        return _optout_cache[1]
    with durable.tx() as c:
        rows = c.execute(select(face_optouts)).mappings().all()
    vecs = [_open(r["nonce"], r["ciphertext"], _AAD_OPTOUT) for r in rows]
    matrix = np.vstack(vecs) if vecs else np.zeros((0, EMBEDDING_DIM), np.float32)
    _optout_cache = (version, matrix)
    return matrix


def register_optout(vec: np.ndarray) -> dict:
    if not settings.durable_storage:
        raise FaceSearchError("durable_storage_required", 409)
    if not key_status()["matches"]:
        raise FaceSearchError("face_key_mismatch", 409)
    protocol = f"OP-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(3).upper()}"
    nonce, blob = _seal(vec, _AAD_OPTOUT)
    with durable.tx() as c:
        c.execute(face_optouts.insert().values(protocol=protocol, created_at=time.time(), nonce=nonce,
                                               ciphertext=blob, key_fp=key_fingerprint()))
        _pin_key(conn=c)
        catalog.bump("optouts_version", conn=c)
    applied = apply_optouts()
    return {"protocol": protocol, **applied}


def list_optouts() -> list[dict]:
    with durable.tx() as c:
        rows = c.execute(select(face_optouts.c.protocol, face_optouts.c.created_at)
                         .order_by(face_optouts.c.id.desc())).mappings()
        return [dict(r) for r in rows]


def delete_optout(protocol: str) -> bool:
    with durable.tx() as c:
        done = c.execute(delete(face_optouts).where(face_optouts.c.protocol == protocol)).rowcount > 0
        if done:
            catalog.bump("optouts_version", conn=c)
    return done


def apply_optouts() -> dict:
    """Remove do índice local todo rosto parecido com um registro de oposição."""
    if not settings.faces_db.exists():
        return {"faces_removed": 0, "photos_affected": 0, "photo_ids": []}
    optouts = _optout_vectors()
    removed, photos = 0, set()
    if len(optouts):
        with local() as c:
            for r in c.execute("SELECT id, photo_id, nonce, embedding FROM faces").fetchall():
                v = _open(r["nonce"], r["embedding"], _aad_face(r["photo_id"]))
                if float(np.max(optouts @ v)) >= settings.face_optout_threshold:
                    c.execute("DELETE FROM faces WHERE id=?", (r["id"],))
                    removed += 1
                    photos.add(r["photo_id"])
            if removed:
                _local_bump(c)
    return {"faces_removed": removed, "photos_affected": len(photos), "photo_ids": sorted(photos)}


# ---------------------------------------------------------------------------
# Retenção
# ---------------------------------------------------------------------------
def enforce_retention() -> dict | None:
    """No fim do prazo, apaga índice e oposições e grava um recibo verificável."""
    if not expired():
        return None
    receipt = durable.kv_get_json("retention_receipt")
    if receipt and receipt.get("verified") and not settings.faces_db.exists():
        return receipt
    local_result = purge_local_index()
    with durable.tx() as c:
        optouts_deleted = c.execute(delete(face_optouts)).rowcount or 0
        c.execute(update(face_authorizations).where(face_authorizations.c.revoked_at.is_(None))
                  .values(revoked_at=time.time(), revoked_by="sistema", revoke_reason="Fim do prazo de retenção"))
        catalog.bump("optouts_version", conn=c)
    with durable.tx() as c:
        remaining = c.execute(select(func.count()).select_from(face_optouts)).scalar_one()
    receipt = {
        "executed_at": time.time(),
        "expires_at": face_data_expires_at().isoformat(),
        "local_faces_deleted": local_result["faces_indexed"],
        "local_photos_deleted": local_result["photos_indexed"],
        "local_index_file_removed": local_result["file_removed"],
        "optouts_deleted": optouts_deleted,
        "optouts_remaining": remaining,
        "verified": bool(local_result["file_removed"] and remaining == 0),
    }
    durable.kv_set_json("retention_receipt", receipt)
    durable.audit("retention_purge", ok=receipt["verified"], **receipt)
    print(f"[biometria] prazo de retenção encerrado; recibo: {json.dumps(receipt)}", flush=True)
    return receipt


# ---------------------------------------------------------------------------
# Indexação das fotos do evento (somente com autorização)
# ---------------------------------------------------------------------------
def index_faces(progress: Callable[[int, int, str], None] | None = None) -> dict:
    if enforce_retention():
        return {"status": "expired"}
    status = authorization_status()
    if not status["authorized"]:
        purged = purge_local_index() if settings.faces_db.exists() else None
        return {"status": "not_authorized", "pending": [p["code"] for p in status["pending"]],
                "purged": bool(purged)}

    rows, effs = catalog.visible_rows()
    eligible = {r["id"]: r["version"] for r in rows if effs[r["id"]].face_search}
    with local() as c:
        done = {r["photo_id"]: r["photo_version"] for r in c.execute("SELECT photo_id, photo_version FROM face_photos")}
        stale = [pid for pid, ver in done.items() if eligible.get(pid) != ver]
        for pid in stale:
            c.execute("DELETE FROM faces WHERE photo_id=?", (pid,))
            c.execute("DELETE FROM face_photos WHERE photo_id=?", (pid,))
        if stale:
            _local_bump(c)
    todo = [(pid, ver) for pid, ver in eligible.items() if done.get(pid) != ver]
    optouts = _optout_vectors()
    st = store()
    total, faces_found, errors, excluded = len(todo), 0, 0, 0
    for position, (pid, ver) in enumerate(todo, start=1):
        try:
            path = st.derivative_path(catalog.keys_for(pid, ver)["display"])
            with Image.open(path) as im:
                bgr = to_bgr(im)
            sealed = []
            for face in engine.detect(bgr, score=settings.face_detect_score, min_size=settings.face_min_size_index):
                vec = engine.embed(bgr, face)
                if len(optouts) and float(np.max(optouts @ vec)) >= settings.face_optout_threshold:
                    excluded += 1
                    continue
                nonce, blob = _seal(vec, _aad_face(pid))
                sealed.append((pid, float(face[14]), nonce, blob))
            with local() as c:
                c.execute("DELETE FROM faces WHERE photo_id=?", (pid,))
                c.executemany("INSERT INTO faces(photo_id, score, nonce, embedding) VALUES(?,?,?,?)", sealed)
                c.execute("INSERT INTO face_photos(photo_id, photo_version, faces, indexed_at) VALUES(?,?,?,?) "
                          "ON CONFLICT(photo_id) DO UPDATE SET photo_version=excluded.photo_version, "
                          "faces=excluded.faces, indexed_at=excluded.indexed_at",
                          (pid, ver, len(sealed), time.time()))
                _local_bump(c)
            faces_found += len(sealed)
        except Exception as exc:
            errors += 1
            print(f"[biometria] foto {pid}: {type(exc).__name__}", flush=True)
        finally:
            if progress:
                progress(position, total, pid)
    applied = apply_optouts()
    return {"status": "ok", "photos_processed": total, "faces_indexed": faces_found, "removed": len(stale),
            "excluded_by_optout": excluded + applied["faces_removed"], "errors": errors}


# ---------------------------------------------------------------------------
# Busca
# ---------------------------------------------------------------------------
@dataclass
class _Matrix:
    version: str
    vectors: np.ndarray
    photo_ids: list[str]


_matrix_cache: _Matrix | None = None
_matrix_lock = threading.Lock()


def _matrix() -> _Matrix:
    global _matrix_cache
    with local() as c:
        row = c.execute("SELECT value FROM meta WHERE key='version'").fetchone()
        version = row["value"] if row else "0"
        if _matrix_cache and _matrix_cache.version == version:
            return _matrix_cache
        rows = c.execute("SELECT photo_id, nonce, embedding FROM faces").fetchall()
    with _matrix_lock:
        vecs = [_open(r["nonce"], r["embedding"], _aad_face(r["photo_id"])) for r in rows]
        _matrix_cache = _Matrix(version, np.vstack(vecs) if vecs else np.zeros((0, EMBEDDING_DIM), np.float32),
                                [r["photo_id"] for r in rows])
        return _matrix_cache


def search_state() -> tuple[bool, str]:
    """Disponibilidade pública da busca (sem detalhes internos)."""
    if expired():
        return False, "expired"
    if not authorization_status()["authorized"]:
        return False, "disabled"
    if not settings.faces_db.exists() or local_stats()["photos_indexed"] == 0:
        rows, effs = catalog.visible_rows()
        if any(effs[r["id"]].face_search for r in rows):
            return False, "indexing"
    return True, "ready"


def analyze_query(img: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    bgr = to_bgr(img)
    found = engine.detect(bgr, score=0.75, min_size=settings.face_min_size_query, scales=(1280, 640, 320))
    if len(found) == 0:
        small = engine.detect(bgr, score=0.75, min_size=16, scales=(1280, 640))
        raise FaceSearchError("face_too_small" if len(small) else "no_face_detected")
    return bgr, found


def public_boxes(found: np.ndarray, size: tuple[int, int]) -> list[dict]:
    """Caixas normalizadas dos rostos da própria imagem enviada (para escolher o seu)."""
    w, h = size
    return [{"index": i, "x": round(float(f[0]) / w, 4), "y": round(float(f[1]) / h, 4),
             "w": round(float(f[2]) / w, 4), "h": round(float(f[3]) / h, 4)} for i, f in enumerate(found)]


def search(vec: np.ndarray) -> list[tuple[str, float]]:
    optouts = _optout_vectors()
    if len(optouts) and float(np.max(optouts @ vec)) >= settings.face_optout_threshold:
        return []  # a pessoa pediu para não ser localizada
    matrix = _matrix()
    if not matrix.photo_ids:
        return []
    sims = matrix.vectors @ vec
    best: dict[str, float] = {}
    for idx in np.nonzero(sims >= settings.face_match_threshold)[0]:
        pid = matrix.photo_ids[int(idx)]
        best[pid] = max(best.get(pid, -1.0), float(sims[idx]))
    if not best:
        return []
    rows, effs = catalog.visible_rows()
    allowed = {r["id"] for r in rows if effs[r["id"]].face_search}
    ranked = sorted(((pid, s) for pid, s in best.items() if pid in allowed), key=lambda kv: -kv[1])
    return ranked[: settings.face_max_results]
