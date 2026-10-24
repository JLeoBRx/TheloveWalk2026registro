"""Privacy-conscious, request-scoped face search for The Love Walk album.

The uploaded reference selfie and extracted face features stay in memory for the
duration of one request. No selfie, face embedding, or identity label is stored.
"""
from __future__ import annotations

import io
import os
import threading
from pathlib import Path
from typing import Iterable

import numpy as np
import requests
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_SELFIE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000
MAX_FACE_SCORE = float(os.getenv("FACE_SEARCH_THRESHOLD", "0.40"))
MIN_DETECTION_SCORE = 0.85

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_MODEL_DIR = Path(os.getenv("DATA_DIR", str(_PROJECT_ROOT / "data"))).expanduser().resolve() / "face_models"
_DETECTOR_PATH = _MODEL_DIR / "face_detection_yunet_2023mar.onnx"
_RECOGNIZER_PATH = _MODEL_DIR / "face_recognition_sface_2021dec.onnx"

_MODEL_URLS = {
    _DETECTOR_PATH: (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    ),
    _RECOGNIZER_PATH: (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    ),
}
_MATCH_LOCK = threading.Lock()
_DETECTOR = None
_RECOGNIZER = None


class FaceSearchInputError(ValueError):
    """Safe, user-displayable input problem."""


def _ensure_model(path: Path, urls: tuple[str, ...]) -> None:
    if path.is_file() and path.stat().st_size > 100_000:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    last_error = "download failed"
    for url in urls:
        temp_path = path.with_suffix(path.suffix + ".part")
        try:
            with requests.get(url, stream=True, timeout=(20, 120), allow_redirects=True) as response:
                response.raise_for_status()
                with temp_path.open("wb") as output:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            output.write(chunk)
            size = temp_path.stat().st_size
            if size < 100_000:
                raise IOError("model download was unexpectedly small")
            with temp_path.open("rb") as downloaded:
                prefix = downloaded.read(80)
            if prefix.startswith(b"version https://git-lfs.github.com/spec/v1"):
                raise IOError("Git LFS pointer received instead of model")
            temp_path.replace(path)
            return
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            temp_path.unlink(missing_ok=True)
    raise RuntimeError(f"Não foi possível preparar o modelo de busca facial ({path.name}): {last_error}")


def _load_models():
    global _DETECTOR, _RECOGNIZER
    if _DETECTOR is not None and _RECOGNIZER is not None:
        return _DETECTOR, _RECOGNIZER
    import cv2

    _ensure_model(_DETECTOR_PATH, _MODEL_URLS[_DETECTOR_PATH])
    _ensure_model(_RECOGNIZER_PATH, _MODEL_URLS[_RECOGNIZER_PATH])
    _DETECTOR = cv2.FaceDetectorYN.create(
        str(_DETECTOR_PATH), "", (320, 320), 0.85, 0.3, 5000
    )
    _RECOGNIZER = cv2.FaceRecognizerSF.create(str(_RECOGNIZER_PATH), "")
    return _DETECTOR, _RECOGNIZER


def _decode_image(image_bytes: bytes, description: str):
    import cv2

    try:
        with Image.open(io.BytesIO(image_bytes)) as opened:
            if opened.width <= 0 or opened.height <= 0 or opened.width * opened.height > MAX_IMAGE_PIXELS:
                raise FaceSearchInputError(
                    f"{description}: imagem muito grande. Use uma imagem com até 24 megapixels."
                )
            opened.load()
            rgb = ImageOps.exif_transpose(opened).convert("RGB")
            rgb.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
            return cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2BGR)
    except FaceSearchInputError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise FaceSearchInputError(
            f"{description}: não consegui ler a imagem. Use JPG, PNG ou WebP."
        ) from exc


def _face_rows(image, detector):
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    if faces is None:
        return []
    return [face for face in faces if float(face[-1]) >= MIN_DETECTION_SCORE]


def _feature(image, face, recognizer):
    aligned = recognizer.alignCrop(image, face)
    vector = recognizer.feature(aligned)
    return vector


def find_matching_photos(
    selfie_bytes: bytes,
    rows: Iterable,
    photo_dir: Path,
    raw_preview_dir: Path,
    raw_extensions: set[str],
    threshold: float = MAX_FACE_SCORE,
) -> tuple[list[dict], int]:
    """Compare a single-face selfie to indexed photos; do not persist embeddings."""
    if not selfie_bytes:
        raise FaceSearchInputError("Escolha uma selfie antes de iniciar a busca.")
    if len(selfie_bytes) > MAX_SELFIE_BYTES:
        raise FaceSearchInputError("A selfie deve ter no máximo 8 MB.")

    import cv2

    with _MATCH_LOCK:
        detector, recognizer = _load_models()
        query_image = _decode_image(selfie_bytes, "A selfie")
        query_faces = _face_rows(query_image, detector)
        if not query_faces:
            raise FaceSearchInputError(
                "Não encontrei um rosto nítido na selfie. Tente outra foto, de frente e com boa iluminação."
            )
        if len(query_faces) > 1:
            raise FaceSearchInputError(
                "A selfie parece mostrar mais de uma pessoa. Use uma foto com apenas o seu rosto."
            )
        query_feature = _feature(query_image, query_faces[0], recognizer)

        matches: list[dict] = []
        scanned = 0
        for row in rows:
            photo_id = str(row["id"])
            relative = Path(str(row["relative_path"]))
            suffix = relative.suffix.lower()
            try:
                if suffix in raw_extensions:
                    candidate_path = (raw_preview_dir / f"{photo_id}.jpg").resolve()
                    if raw_preview_dir.resolve() not in candidate_path.parents:
                        continue
                else:
                    candidate_path = (photo_dir / relative).resolve()
                    if photo_dir.resolve() not in candidate_path.parents:
                        continue
                if not candidate_path.is_file():
                    continue
                image_bytes = candidate_path.read_bytes() if candidate_path.suffix.lower() == ".jpg" and suffix in raw_extensions else None
                if image_bytes is not None:
                    candidate_image = _decode_image(image_bytes, f"A foto {row['filename']}")
                else:
                    # Pillow thumbnailing avoids loading full-resolution camera images into OpenCV.
                    with Image.open(candidate_path) as opened:
                        if opened.width <= 0 or opened.height <= 0 or opened.width * opened.height > 60_000_000:
                            continue
                        # JPEG draft decoding can greatly reduce memory for large camera files.
                        try:
                            opened.draft("RGB", (1800, 1800))
                        except (AttributeError, OSError):
                            pass
                        opened.load()
                        rgb = ImageOps.exif_transpose(opened).convert("RGB")
                        rgb.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
                        candidate_image = cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2BGR)
                candidates = _face_rows(candidate_image, detector)
                scanned += 1
                best_score = -1.0
                for face in candidates:
                    feature = _feature(candidate_image, face, recognizer)
                    score = float(
                        recognizer.match(
                            query_feature, feature, cv2.FaceRecognizerSF_FR_COSINE
                        )
                    )
                    if score > best_score:
                        best_score = score
                if best_score >= threshold:
                    matches.append({
                        "id": photo_id,
                        "score": round(best_score, 4),
                        "filename": str(row["filename"]),
                        "category": str(row["category"]),
                        "caption": str(row["caption"]),
                        "width": int(row["width"]),
                        "height": int(row["height"]),
                        "is_raw": suffix in raw_extensions,
                    })
            except (OSError, ValueError, UnidentifiedImageError, cv2.error):
                # A bad, missing, or unsupported album image should not stop the search.
                continue
        matches.sort(key=lambda item: item["score"], reverse=True)
        return matches, scanned
