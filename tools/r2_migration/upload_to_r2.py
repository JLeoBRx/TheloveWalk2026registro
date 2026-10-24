#!/usr/bin/env python3
"""Upload photo originals and web previews to Cloudflare R2."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import boto3
import rawpy
from botocore.config import Config
from dotenv import load_dotenv
from PIL import Image, ImageOps, UnidentifiedImageError

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env.r2")
STANDARD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
RAW_EXTENSIONS = {
    ".3fr", ".arw", ".bay", ".cap", ".cr2", ".cr3", ".crw", ".dcs", ".dcr",
    ".dng", ".drf", ".eip", ".erf", ".fff", ".iiq", ".k25", ".kdc", ".mef",
    ".mos", ".mrw", ".nef", ".nrw", ".obm", ".orf", ".pef", ".ptx", ".pxn",
    ".qtk", ".raf", ".raw", ".rdc", ".rw2", ".rwl", ".sr2", ".srf", ".srw", ".sti", ".x3f"
}
IMAGE_EXTENSIONS = STANDARD_EXTENSIONS | RAW_EXTENSIONS
MAX_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "40000000"))
MAX_RAW_PIXELS = int(os.getenv("MAX_RAW_IMAGE_PIXELS", "60000000"))

def id_for(relative_path: str) -> str:
    return hashlib.sha256(relative_path.encode("utf-8")).hexdigest()[:20]

def category_for(relative_path: str) -> str:
    parent = PurePosixPath(relative_path).parent.name
    return parent if parent not in {"", "."} else "A caminhada"

def pick_folder() -> Path:
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="Selecione a pasta com as fotos JPG e CR2")
        root.destroy()
        if selected:
            return Path(selected).expanduser().resolve()
    except Exception:
        pass
    raise RuntimeError("Não foi possível abrir a janela. Passe o caminho da pasta como argumento.")

def create_previews(source: Path) -> tuple[bytes, bytes, int, int]:
    is_raw = source.suffix.lower() in RAW_EXTENSIONS
    if is_raw:
        with rawpy.imread(str(source)) as raw:
            width, height = int(raw.sizes.width), int(raw.sizes.height)
            if width * height > MAX_RAW_PIXELS:
                raise ValueError(f"RAW excede o limite de {MAX_RAW_PIXELS:,} pixels.")
            image = None
            try:
                embedded = raw.extract_thumb()
                if embedded.format == rawpy.ThumbFormat.JPEG:
                    with Image.open(io.BytesIO(embedded.data)) as im:
                        im.load()
                        candidate = ImageOps.exif_transpose(im).convert("RGB")
                elif embedded.format == rawpy.ThumbFormat.BITMAP:
                    candidate = Image.fromarray(embedded.data).convert("RGB")
                else:
                    candidate = None
                if candidate is not None and min(candidate.size) >= 640:
                    image = candidate
            except (rawpy.LibRawNoThumbnailError, rawpy.LibRawUnsupportedThumbnailError,
                    UnidentifiedImageError, OSError, ValueError):
                image = None
            if image is None:
                image = Image.fromarray(raw.postprocess(use_camera_wb=True, output_bps=8, half_size=True)).convert("RGB")
    else:
        with Image.open(source) as im:
            if im.width * im.height > MAX_PIXELS:
                raise ValueError(f"Imagem excede o limite de {MAX_PIXELS:,} pixels.")
            oriented = ImageOps.exif_transpose(im)
            width, height = oriented.size
            image = oriented.convert("RGB")

    image.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
    preview_buffer = io.BytesIO()
    image.save(preview_buffer, "JPEG", quality=88, optimize=True, progressive=True)
    preview = preview_buffer.getvalue()
    image.thumbnail((800, 800), Image.Resampling.LANCZOS)
    thumb_buffer = io.BytesIO()
    image.save(thumb_buffer, "WEBP", quality=86, method=6)
    return preview, thumb_buffer.getvalue(), width, height

def main() -> int:
    parser = argparse.ArgumentParser(description="Enviar as fotos para o Cloudflare R2.")
    parser.add_argument("folder", nargs="?", help="Pasta local com as imagens; se omitida, abre uma janela.")
    parser.add_argument("--prefix", default=os.getenv("R2_PREFIX", "the-love-walk-2026").strip("/"))
    args = parser.parse_args()

    account_id = os.getenv("R2_ACCOUNT_ID", "").strip()
    endpoint = os.getenv("R2_ENDPOINT_URL", "").strip().rstrip("/")
    if not endpoint and account_id:
        endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    bucket = os.getenv("R2_BUCKET", "").strip()
    access_key = os.getenv("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY", "").strip()
    if not (endpoint and bucket and access_key and secret_key):
        print("ERRO: preencha .env.r2 com R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY.")
        print("Não envie as chaves secretas por chat nem as coloque no GitHub.")
        return 2

    folder = Path(args.folder).expanduser().resolve() if args.folder else pick_folder()
    if not folder.is_dir():
        print(f"ERRO: pasta não encontrada: {folder}")
        return 2

    prefix = args.prefix.strip("/")
    originals = f"{prefix}/originals" if prefix else "originals"
    previews = f"{prefix}/previews" if prefix else "previews"
    thumbs = f"{prefix}/thumbnails" if prefix else "thumbnails"
    manifest_key = f"{prefix}/manifest.json" if prefix else "manifest.json"

    s3 = boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=access_key,
                      aws_secret_access_key=secret_key, region_name="auto",
                      config=Config(signature_version="s3v4", retries={"max_attempts": 5}))
    try:
        s3.head_bucket(Bucket=bucket)
    except Exception as exc:
        print(f"ERRO ao acessar bucket {bucket!r}: {exc}")
        print("Confira o endpoint, o nome do bucket e a permissão Object Read & Write.")
        return 2

    sources = sorted(p for p in folder.rglob("*") if p.is_file() and not p.is_symlink() and p.suffix.lower() in IMAGE_EXTENSIONS)
    if not sources:
        print("Nenhuma imagem JPG/PNG/WebP/RAW foi encontrada.")
        return 2
    print(f"Pasta: {folder}\nBucket: {bucket}\nImagens: {len(sources)}")
    print("O manifesto só será publicado depois que todos os arquivos forem enviados.")
    photos, errors = [], []
    total_bytes = 0

    for index, source in enumerate(sources, 1):
        rel = source.relative_to(folder).as_posix()
        photo_id = id_for(rel)
        is_raw = source.suffix.lower() in RAW_EXTENSIONS
        original_key = f"{originals}/{rel}"
        preview_key = f"{previews}/{photo_id}.jpg"
        thumb_key = f"{thumbs}/{photo_id}.webp"
        print(f"[{index}/{len(sources)}] {source.name}: gerando prévias...", flush=True)
        try:
            preview_bytes, thumb_bytes, width, height = create_previews(source)
            content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
            if is_raw:
                content_type = "application/octet-stream"
            s3.upload_file(str(source), bucket, original_key, ExtraArgs={
                "ContentType": content_type, "CacheControl": "public, max-age=31536000, immutable"
            })
            s3.put_object(Bucket=bucket, Key=preview_key, Body=preview_bytes, ContentType="image/jpeg",
                          CacheControl="public, max-age=31536000, immutable")
            s3.put_object(Bucket=bucket, Key=thumb_key, Body=thumb_bytes, ContentType="image/webp",
                          CacheControl="public, max-age=31536000, immutable")
            stat = source.stat()
            photos.append({
                "id": photo_id, "relative_path": rel, "filename": source.name,
                "original_key": original_key, "preview_key": preview_key, "thumb_key": thumb_key,
                "category": category_for(rel),
                "caption": source.stem.replace("_", " ").replace("-", " ").strip() or "The Love Walk 2026",
                "width": width, "height": height, "file_size": stat.st_size,
                "mtime": stat.st_mtime, "is_raw": is_raw,
            })
            total_bytes += stat.st_size
            print("    OK", flush=True)
        except Exception as exc:
            errors.append({"file": rel, "error": f"{type(exc).__name__}: {exc}"})
            print(f"    ERRO: {type(exc).__name__}: {exc}", flush=True)

    if errors:
        (HERE / "r2_upload_errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n{len(errors)} arquivo(s) falharam. O manifesto NÃO foi atualizado.")
        print(f"Confira {HERE / 'r2_upload_errors.json'} e execute novamente.")
        return 1

    manifest = {"version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
                "prefix": prefix, "photo_count": len(photos), "photos": photos}
    body = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    try:
        s3.put_object(Bucket=bucket, Key=manifest_key, Body=body, ContentType="application/json",
                      CacheControl="no-cache, no-store, must-revalidate")
    except Exception as exc:
        print(f"ERRO publicando manifesto: {exc}")
        return 1

    print("\nMIGRAÇÃO CONCLUÍDA")
    print(f"Fotos no manifesto: {len(photos)}")
    print(f"Originais enviados: {total_bytes / (1024 ** 3):.2f} GiB")
    print(f"Manifesto: {manifest_key}")
    print("Agora configure as mesmas variáveis no Render e confirme as fotos no site.")
    print("Não remova as cópias locais ou do GitHub antes de verificar a galeria.")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nEnvio interrompido. O manifesto anterior continua publicado.")
        raise SystemExit(130)
