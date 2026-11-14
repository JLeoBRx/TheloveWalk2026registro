"""Reconhecimento facial: detecção (YuNet) e comparação (SFace) com OpenCV.

Princípios de proteção de dados aplicados aqui:
- a selfie do visitante é processada apenas em memória e descartada ao fim da
  requisição; nada dela é gravado em disco nem em log;
- os vetores faciais das fotos do evento ficam num banco separado
  (data/biometria), cifrados com AES-256-GCM, e nunca saem do servidor;
- a API pública devolve apenas fotografias já publicadas no álbum;
- todo o dado biométrico é apagado automaticamente na data de expiração;
- quem pede oposição tem o rosto excluído do índice e das buscas.
"""
from __future__ import annotations

import base64
import hashlib
import os
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image

from . import catalog, db
from .config import face_data_expires_at, settings

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None

DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_FILE = "face_recognition_sface_2021dec.onnx"
EMBEDDING_DIM = 128


class FaceSearchError(Exception):
    def __init__(self, code: str, status: int = 422, **extra):
        super().__init__(code)
        self.code, self.status, self.extra = code, status, extra


# ---------------------------------------------------------------------------
# Motor OpenCV
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
            str(self.detector_path), "", (320, 320), settings.face_detect_score, 0.3, 5000
        )
        self._recognizer = cv2.FaceRecognizerSF.create(str(self.recognizer_path), "")

    def _detect_once(self, bgr: np.ndarray, score: float) -> np.ndarray:
        h, w = bgr.shape[:2]
        self._detector.setScoreThreshold(score)
        self._detector.setInputSize((w, h))
        _, found = self._detector.detect(bgr)
        return np.zeros((0, 15), np.float32) if found is None else found

    def detect(self, bgr: np.ndarray, *, score: float, min_size: int,
               scales: tuple[int, ...] = (2048, 1024, 512)) -> np.ndarray:
        """Detecção em várias escalas: o YuNet é treinado para rostos de ~10 a ~300 px,
        então rostos muito próximos da câmera só aparecem na escala reduzida."""
        with self._lock:
            self._ensure()
            h, w = bgr.shape[:2]
            longest = max(h, w)
            merged: list[np.ndarray] = []
            used_scales = sorted({min(longest, s) for s in scales}, reverse=True)
            for side in used_scales:
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
# Cifragem dos vetores (AES-256-GCM)
# ---------------------------------------------------------------------------
_key_lock = threading.Lock()
_aes: AESGCM | None = None


def _cipher() -> AESGCM:
    global _aes
    with _key_lock:
        if _aes is None:
            secret = settings.face_data_key
            if not secret:
                key_file = settings.biometric_dir / ".chave"
                if not key_file.is_file():
                    key_file.write_text(base64.b64encode(secrets.token_bytes(32)).decode(), encoding="ascii")
                    os.chmod(key_file, 0o600)
                secret = key_file.read_text(encoding="ascii").strip()
            _aes = AESGCM(hashlib.sha256(("fjnight-faces-v1|" + secret).encode()).digest())
        return _aes


def _seal(vec: np.ndarray, aad: bytes) -> tuple[bytes, bytes]:
    nonce = secrets.token_bytes(12)
    return nonce, _cipher().encrypt(nonce, vec.astype(np.float32).tobytes(), aad)


def _open(nonce: bytes, blob: bytes, aad: bytes) -> np.ndarray:
    return np.frombuffer(_cipher().decrypt(nonce, blob, aad), dtype=np.float32)


def _aad_face(pid: str) -> bytes:
    return b"face|" + pid.encode()


_AAD_OPTOUT = b"optout"


# ---------------------------------------------------------------------------
# Retenção
# ---------------------------------------------------------------------------
def expired() -> bool:
    return datetime.now(timezone.utc) >= face_data_expires_at()


def purge_all(include_optouts: bool = False) -> None:
    """Apaga o índice facial. Com include_optouts, apaga todo o diretório biométrico."""
    global _matrix_cache, _aes
    _matrix_cache = None
    if include_optouts:
        for path in settings.biometric_dir.glob("*"):
            if path.is_file():
                path.unlink(missing_ok=True)
        with _key_lock:
            _aes = None
        db.init_faces()
        return
    with db.faces() as c:
        c.execute("DELETE FROM faces")
        c.execute("DELETE FROM face_photos")
        db.set_meta(c, "faces_version", str(time.time_ns()))
    with db.faces() as c:
        c.execute("VACUUM")


def enforce_retention() -> bool:
    """Se o prazo terminou, elimina todos os dados biométricos. Retorna True se expirado."""
    if not expired():
        return False
    marker = settings.biometric_dir / ".expirado"
    if not marker.exists():
        purge_all(include_optouts=True)
        marker.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
        print("[biometria] prazo de retenção encerrado: dados faciais eliminados", flush=True)
    return True


def search_available() -> tuple[bool, str]:
    if not settings.face_search_enabled:
        return False, "disabled"
    if expired():
        return False, "expired"
    if not engine.available():
        return False, "models_unavailable"
    return True, "ready"


# ---------------------------------------------------------------------------
# Indexação das fotos do evento
# ---------------------------------------------------------------------------
def _load_optouts() -> np.ndarray:
    with db.faces() as c:
        rows = c.execute("SELECT nonce, embedding FROM optouts").fetchall()
    vecs = [_open(r["nonce"], r["embedding"], _AAD_OPTOUT) for r in rows]
    return np.vstack(vecs) if vecs else np.zeros((0, EMBEDDING_DIM), np.float32)


def index_faces(progress: Callable[[int, int, str], None] | None = None) -> dict:
    if enforce_retention():
        return {"status": "expired"}
    if not settings.face_search_enabled:
        return {"status": "disabled"}
    if not engine.available():
        return {"status": "models_unavailable"}

    rows, effs = catalog.visible_rows()
    eligible = {r["id"]: r["version"] for r in rows if effs[r["id"]].face_search}
    with db.faces() as c:
        done = {r["photo_id"]: r["photo_version"] for r in c.execute("SELECT photo_id, photo_version FROM face_photos")}
        stale = [pid for pid, ver in done.items() if eligible.get(pid) != ver]
        for pid in stale:
            c.execute("DELETE FROM faces WHERE photo_id=?", (pid,))
            c.execute("DELETE FROM face_photos WHERE photo_id=?", (pid,))
    todo = [(pid, ver) for pid, ver in eligible.items() if done.get(pid) != ver]
    optouts = _load_optouts()
    total, faces_found, errors, excluded = len(todo), 0, 0, 0
    for position, (pid, ver) in enumerate(todo, start=1):
        try:
            _, display = catalog.derivative_paths(pid)
            with Image.open(display) as im:
                bgr = to_bgr(im)
            detected = engine.detect(bgr, score=settings.face_detect_score, min_size=settings.face_min_size_index)
            sealed = []
            for face in detected:
                vec = engine.embed(bgr, face)
                if len(optouts) and float(np.max(optouts @ vec)) >= settings.face_optout_threshold:
                    excluded += 1
                    continue
                nonce, blob = _seal(vec, _aad_face(pid))
                sealed.append((pid, float(face[14]), nonce, blob))
            with db.faces() as c:
                c.execute("DELETE FROM faces WHERE photo_id=?", (pid,))
                c.executemany("INSERT INTO faces(photo_id, score, nonce, embedding) VALUES(?,?,?,?)", sealed)
                c.execute(
                    "INSERT INTO face_photos(photo_id, photo_version, faces, indexed_at) VALUES(?,?,?,?) "
                    "ON CONFLICT(photo_id) DO UPDATE SET photo_version=excluded.photo_version, "
                    "faces=excluded.faces, indexed_at=excluded.indexed_at",
                    (pid, ver, len(sealed), time.time()),
                )
            faces_found += len(sealed)
        except Exception as exc:
            errors += 1
            print(f"[biometria] foto {pid}: {type(exc).__name__}", flush=True)
        finally:
            if progress:
                progress(position, total, pid)
    if todo or stale:
        with db.faces() as c:
            db.set_meta(c, "faces_version", str(time.time_ns()))
    return {"status": "ok", "photos_processed": total, "faces_indexed": faces_found,
            "removed": len(stale), "excluded_by_optout": excluded, "errors": errors}


def index_stats() -> dict:
    with db.faces() as c:
        photos = c.execute("SELECT COUNT(*) FROM face_photos").fetchone()[0]
        faces = c.execute("SELECT COUNT(*) FROM faces").fetchone()[0]
        optouts = c.execute("SELECT COUNT(*) FROM optouts").fetchone()[0]
    return {"photos_indexed": photos, "faces_indexed": faces, "optouts": optouts}


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
    with db.faces() as c:
        version = db.get_meta(c, "faces_version", "0")
        if _matrix_cache and _matrix_cache.version == version:
            return _matrix_cache
        rows = c.execute("SELECT photo_id, nonce, embedding FROM faces").fetchall()
    with _matrix_lock:
        vecs = [_open(r["nonce"], r["embedding"], _aad_face(r["photo_id"])) for r in rows]
        matrix = _Matrix(
            version,
            np.vstack(vecs) if vecs else np.zeros((0, EMBEDDING_DIM), np.float32),
            [r["photo_id"] for r in rows],
        )
        _matrix_cache = matrix
        return matrix


def analyze_query(img: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Detecta rostos na selfie. Retorna (imagem BGR, rostos ordenados por tamanho)."""
    bgr = to_bgr(img)
    faces = engine.detect(bgr, score=0.75, min_size=settings.face_min_size_query, scales=(1280, 640, 320))
    if len(faces) == 0:
        small = engine.detect(bgr, score=0.75, min_size=16, scales=(1280, 640))
        raise FaceSearchError("face_too_small" if len(small) else "no_face_detected")
    return bgr, faces


def public_boxes(faces: np.ndarray, size: tuple[int, int]) -> list[dict]:
    """Caixas normalizadas dos rostos da própria selfie (para o visitante escolher o seu)."""
    w, h = size
    return [{"index": i, "x": round(float(f[0]) / w, 4), "y": round(float(f[1]) / h, 4),
             "w": round(float(f[2]) / w, 4), "h": round(float(f[3]) / h, 4)} for i, f in enumerate(faces)]


def search(vec: np.ndarray) -> list[tuple[str, float]]:
    """Retorna [(photo_id, similaridade)] das fotos públicas onde o rosto aparece."""
    optouts = _load_optouts()
    if len(optouts) and float(np.max(optouts @ vec)) >= settings.face_match_threshold:
        return []  # a pessoa pediu para não ser localizada
    matrix = _matrix()
    if not len(matrix.photo_ids):
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


def register_optout(vec: np.ndarray) -> dict:
    """Registra oposição: remove o rosto do índice e impede novas localizações."""
    nonce, blob = _seal(vec, _AAD_OPTOUT)
    removed_faces, photos = 0, set()
    with db.faces() as c:
        for r in c.execute("SELECT id, photo_id, nonce, embedding FROM faces").fetchall():
            v = _open(r["nonce"], r["embedding"], _aad_face(r["photo_id"]))
            if float(v @ vec) >= settings.face_optout_threshold:
                c.execute("DELETE FROM faces WHERE id=?", (r["id"],))
                removed_faces += 1
                photos.add(r["photo_id"])
    with db.faces() as c:
        c.execute("INSERT INTO optouts(created_at, nonce, embedding) VALUES(?,?,?)", (time.time(), nonce, blob))
        db.set_meta(c, "faces_version", str(time.time_ns()))
    return {"faces_removed": removed_faces, "photos_affected": len(photos), "photo_ids": sorted(photos)}
