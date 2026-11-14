"""Leitura de fotografias (JPEG/PNG/WebP/RAW) e geração de versões otimizadas.

Os originais nunca são alterados. Para cada fotografia são criadas:
- miniatura WebP (mosaico);
- versão de exibição WebP (visualização ampliada);
- para RAW, o JPEG em resolução total embutido pela câmera (download), extraído
  sem recompressão.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from .config import settings

try:  # rawpy é opcional: sem ele, arquivos RAW são ignorados com aviso.
    import rawpy
except ImportError:  # pragma: no cover
    rawpy = None

STANDARD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
RAW_EXTENSIONS = {
    ".3fr", ".arw", ".cr2", ".cr3", ".crw", ".dcr", ".dng", ".erf", ".iiq", ".kdc",
    ".mef", ".mos", ".mrw", ".nef", ".nrw", ".orf", ".pef", ".raf", ".raw", ".rw2",
    ".rwl", ".sr2", ".srf", ".srw", ".x3f",
}
SUPPORTED_EXTENSIONS = STANDARD_EXTENSIONS | RAW_EXTENSIONS

Image.MAX_IMAGE_PIXELS = settings.max_image_pixels

# Orientação do LibRaw (raw.sizes.flip) -> transposição do Pillow
_FLIP_TO_TRANSPOSE = {
    3: Image.Transpose.ROTATE_180,
    5: Image.Transpose.ROTATE_90,
    6: Image.Transpose.ROTATE_270,
}


class ImageError(ValueError):
    """Arquivo ilegível, corrompido ou fora dos limites."""


def is_raw(path: Path) -> bool:
    return path.suffix.lower() in RAW_EXTENSIONS


@dataclass
class LoadedImage:
    image: Image.Image          # RGB, orientado, possivelmente reduzido
    full_size: tuple[int, int]  # dimensões do original já orientado
    taken_at: str | None        # ISO 8601 (sem fuso) quando disponível


def _exif_datetime(img: Image.Image) -> str | None:
    try:
        exif = img.getexif()
        raw = exif.get_ifd(0x8769).get(36867) or exif.get(306)
        if not raw:
            return None
        return datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S").isoformat()
    except Exception:
        return None


def _oriented_size(img: Image.Image) -> tuple[int, int]:
    try:
        orientation = img.getexif().get(274, 1)
    except Exception:
        orientation = 1
    w, h = img.size
    return (h, w) if orientation in (5, 6, 7, 8) else (w, h)


def _load_standard(path: Path, target: int) -> LoadedImage:
    try:
        with Image.open(path) as src:
            if src.format not in {"JPEG", "PNG", "WEBP", "MPO"}:
                raise ImageError(f"formato não suportado: {src.format}")
            if src.width * src.height > settings.max_image_pixels:
                raise ImageError("imagem excede o limite de pixels")
            full_size = _oriented_size(src)
            taken_at = _exif_datetime(src)
            if src.format in {"JPEG", "MPO"}:
                # Decodificação reduzida via DCT: muito mais rápida para fotos grandes.
                src.draft("RGB", (target, target))
            img = ImageOps.exif_transpose(src)
            img = img.convert("RGB") if img.mode != "RGB" else img.copy()
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ImageError(f"arquivo de imagem inválido ({type(exc).__name__})") from exc
    img.thumbnail((target, target), Image.Resampling.LANCZOS)
    return LoadedImage(img, full_size, taken_at)


def _raw_taken_at(path: Path) -> str | None:
    try:  # A maioria dos RAW é TIFF/EXIF: o Pillow lê os metadados sem revelar.
        with Image.open(path) as tif:
            return _exif_datetime(tif)
    except Exception:
        return None


def extract_raw_jpeg(path: Path) -> tuple[bytes, tuple[int, int]] | None:
    """Retorna o JPEG embutido pela câmera (bytes originais) e seu tamanho orientado."""
    if rawpy is None:
        return None
    try:
        with rawpy.imread(str(path)) as raw:
            thumb = raw.extract_thumb()
            if thumb.format != rawpy.ThumbFormat.JPEG:
                return None
            with Image.open(io.BytesIO(thumb.data)) as im:
                size = _oriented_size(im)
            return bytes(thumb.data), size
    except Exception:
        return None


def _load_raw(path: Path, target: int) -> LoadedImage:
    if rawpy is None:
        raise ImageError("suporte a RAW indisponível (instale rawpy)")
    taken_at = _raw_taken_at(path)
    try:
        with rawpy.imread(str(path)) as raw:
            if raw.sizes.width * raw.sizes.height > settings.max_image_pixels:
                raise ImageError("RAW excede o limite de pixels")
            flip = raw.sizes.flip
            img: Image.Image | None = None
            full_size: tuple[int, int] | None = None
            try:
                thumb = raw.extract_thumb()
                if thumb.format == rawpy.ThumbFormat.JPEG:
                    with Image.open(io.BytesIO(thumb.data)) as emb:
                        has_orientation = emb.getexif().get(274, 1) != 1
                        full_size = _oriented_size(emb)
                        emb.draft("RGB", (target, target))
                        candidate = ImageOps.exif_transpose(emb).convert("RGB")
                    if not has_orientation and flip in _FLIP_TO_TRANSPOSE:
                        candidate = candidate.transpose(_FLIP_TO_TRANSPOSE[flip])
                        full_size = (full_size[1], full_size[0]) if flip in (5, 6) else full_size
                    if min(candidate.size) >= 640:
                        img = candidate
                elif thumb.format == rawpy.ThumbFormat.BITMAP:
                    candidate = Image.fromarray(thumb.data).convert("RGB")
                    if min(candidate.size) >= 640:
                        img = candidate
                        full_size = candidate.size
            except (rawpy.LibRawNoThumbnailError, rawpy.LibRawUnsupportedThumbnailError,
                    UnidentifiedImageError, OSError):
                img = None
            if img is None:
                # Sem prévia utilizável: revela o sensor (mais lento) já com orientação.
                rgb = raw.postprocess(use_camera_wb=True, output_bps=8, half_size=True)
                img = Image.fromarray(rgb).convert("RGB")
                full_size = (img.width * 2, img.height * 2)
    except ImageError:
        raise
    except Exception as exc:
        raise ImageError(f"não foi possível ler o RAW ({type(exc).__name__})") from exc
    img.thumbnail((target, target), Image.Resampling.LANCZOS)
    return LoadedImage(img, full_size or img.size, taken_at)


def load(path: Path, target: int | None = None) -> LoadedImage:
    target = target or settings.display_size
    return _load_raw(path, target) if is_raw(path) else _load_standard(path, target)


def average_color(img: Image.Image) -> str:
    """Cor média escurecida, usada como fundo enquanto a miniatura carrega."""
    r, g, b = img.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))[:3]
    return "#{:02x}{:02x}{:02x}".format(int(r * 0.55), int(g * 0.5), int(b * 0.45))


def save_webp(img: Image.Image, out: Path, max_side: int, quality: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    copy = img.copy()
    copy.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    tmp = out.with_suffix(".tmp")
    copy.save(tmp, "WEBP", quality=quality, method=4)
    tmp.replace(out)


def decode_upload(data: bytes, max_side: int = 1600) -> Image.Image:
    """Decodifica uma imagem enviada pelo visitante, apenas em memória."""
    if not data:
        raise ImageError("arquivo vazio")
    try:
        with Image.open(io.BytesIO(data)) as src:
            if src.format not in {"JPEG", "PNG", "WEBP", "MPO"}:
                raise ImageError("formato não suportado")
            if src.width * src.height > 40_000_000:
                raise ImageError("imagem grande demais")
            if src.format in {"JPEG", "MPO"}:
                src.draft("RGB", (max_side, max_side))
            img = ImageOps.exif_transpose(src).convert("RGB")
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError) as exc:
        raise ImageError("não foi possível ler a imagem") from exc
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return img
