"""Armazenamento dos arquivos de fotografia.

- Originais: nunca são alterados. Ficam na pasta `fotos/` (modo local) ou no
  Cloudflare R2 sob `R2_ORIGINALS_PREFIX` (modo r2).
- Derivados (miniatura, exibição e o JPEG da câmera para RAW): gerados pela
  sincronização. No modo r2 ficam no próprio bucket (sobrevivem a deploys) e são
  copiados para um cache local sob demanda.

Downloads de originais no R2 usam URLs assinadas de curta duração, emitidas só
depois de a aplicação conferir que a foto é pública e autorizada.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException
from fastapi.responses import FileResponse, RedirectResponse, Response

from .config import settings

IGNORED_NAMES = {"leia-me.md", "readme.md", ".gitkeep", "thumbs.db", ".ds_store", "desktop.ini"}
IMMUTABLE = "public, max-age=31536000, immutable"


@dataclass(frozen=True)
class SourceObject:
    rel_path: str
    size: int
    sig: str  # muda sempre que o arquivo muda


def _valid_rel(rel: str) -> bool:
    parts = rel.split("/")
    return bool(rel) and not rel.startswith("/") and all(p and p not in (".", "..") and not p.startswith(".") for p in parts)


def _atomic_write(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".tmp-")
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    os.replace(tmp, target)


class LocalStore:
    kind = "local"

    def __init__(self) -> None:
        self.root = settings.photo_dir
        self.derived = settings.derivatives_dir

    # ---- originais ----
    def list_originals(self, extensions: set[str]) -> list[SourceObject]:
        out = []
        for path in self.root.rglob("*"):
            rel = path.relative_to(self.root).as_posix()
            if not _valid_rel(rel) or path.name.lower() in IGNORED_NAMES:
                continue
            if path.is_symlink() or not path.is_file() or path.suffix.lower() not in extensions:
                continue
            st = path.stat()
            out.append(SourceObject(rel, st.st_size, f"{st.st_size}:{int(st.st_mtime)}"))
        return sorted(out, key=lambda o: o.rel_path)

    def _original_path(self, rel: str) -> Path:
        if not _valid_rel(rel):
            raise FileNotFoundError(rel)
        path = (self.root / rel).resolve()
        if self.root not in path.parents or not path.is_file():
            raise FileNotFoundError(rel)
        return path

    @contextmanager
    def original_file(self, rel: str) -> Iterator[Path]:
        yield self._original_path(rel)

    def original_response(self, rel: str, download_name: str, media_type: str | None = None) -> Response:
        try:
            path = self._original_path(rel)
        except FileNotFoundError:
            raise HTTPException(404, detail="photo_not_found")
        return FileResponse(path, filename=download_name, media_type=media_type,
                            headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})

    # ---- derivados ----
    def _derived_path(self, key: str) -> Path:
        path = (self.derived / key).resolve()
        if self.derived not in path.parents:
            raise ValueError("chave inválida")
        return path

    def put_derivative(self, key: str, data: bytes, content_type: str) -> None:
        _atomic_write(self._derived_path(key), data)

    def has_derivative(self, key: str) -> bool:
        return self._derived_path(key).is_file()

    def derivative_keys(self) -> set[str]:
        if not self.derived.is_dir():
            return set()
        return {p.relative_to(self.derived).as_posix() for p in self.derived.rglob("*") if p.is_file()}

    def derivative_path(self, key: str) -> Path:
        path = self._derived_path(key)
        if not path.is_file():
            raise FileNotFoundError(key)
        return path

    def derivative_response(self, key: str, content_type: str, immutable: bool,
                            download_name: str | None = None) -> Response:
        path = self._derived_path(key)
        if not path.is_file():
            raise HTTPException(404, detail="image_not_ready")
        cache = IMMUTABLE if immutable else "public, max-age=3600"
        if download_name:
            cache = "private, max-age=3600"
        return FileResponse(path, media_type=content_type, filename=download_name,
                            headers={"Cache-Control": cache, "X-Content-Type-Options": "nosniff"})

    def delete_derivative(self, key: str) -> None:
        self._derived_path(key).unlink(missing_ok=True)

    def health(self) -> dict:
        return {"ok": self.root.is_dir(), "kind": self.kind, "originals": str(self.root.name)}


class R2Store:
    kind = "r2"

    def __init__(self) -> None:
        import boto3
        from botocore.config import Config

        if not (settings.r2_bucket and settings.r2_access_key_id and settings.r2_secret_access_key
                and (settings.r2_account_id or settings.r2_endpoint)):
            raise RuntimeError("Configuração do R2 incompleta: defina R2_ACCOUNT_ID (ou R2_ENDPOINT), "
                               "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET.")
        endpoint = settings.r2_endpoint or f"https://{settings.r2_account_id}.r2.cloudflarestorage.com"
        self.bucket = settings.r2_bucket
        self.prefix = settings.r2_originals_prefix
        self.dprefix = settings.r2_derivatives_prefix
        self.cache = settings.cache_dir / "r2"
        self.client = boto3.client(
            "s3", endpoint_url=endpoint,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name=os.getenv("R2_REGION", "auto"),
            config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"},
                          connect_timeout=10, read_timeout=120),
        )
        self._cache_lock = threading.Lock()

    def list_originals(self, extensions: set[str]) -> list[SourceObject]:
        out = []
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=self.prefix):
            for obj in page.get("Contents", []):
                rel = obj["Key"][len(self.prefix):]
                name = rel.rsplit("/", 1)[-1]
                if not _valid_rel(rel) or name.lower() in IGNORED_NAMES:
                    continue
                if Path(name).suffix.lower() not in extensions:
                    continue
                out.append(SourceObject(rel, int(obj["Size"]), f"{obj['Size']}:{obj['ETag'].strip(chr(34))}"))
        return sorted(out, key=lambda o: o.rel_path)

    @contextmanager
    def original_file(self, rel: str) -> Iterator[Path]:
        if not _valid_rel(rel):
            raise FileNotFoundError(rel)
        settings.tmp_dir.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=settings.tmp_dir, suffix=Path(rel).suffix)
        os.close(fd)
        try:
            self.client.download_file(self.bucket, self.prefix + rel, tmp)
            yield Path(tmp)
        finally:
            Path(tmp).unlink(missing_ok=True)

    def original_response(self, rel: str, download_name: str, media_type: str | None = None) -> Response:
        if not _valid_rel(rel):
            raise HTTPException(404, detail="photo_not_found")
        params = {"Bucket": self.bucket, "Key": self.prefix + rel,
                  "ResponseContentDisposition": f'attachment; filename="{download_name}"'}
        if media_type:
            params["ResponseContentType"] = media_type
        url = self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=settings.r2_download_ttl)
        return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})

    def put_derivative(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=self.dprefix + key, Body=data,
                               ContentType=content_type, CacheControl=IMMUTABLE)
        _atomic_write(self.cache / key, data)

    def has_derivative(self, key: str) -> bool:
        if (self.cache / key).is_file():
            return True
        try:
            self.client.head_object(Bucket=self.bucket, Key=self.dprefix + key)
            return True
        except Exception:
            return False

    def derivative_keys(self) -> set[str]:
        keys = set()
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=self.dprefix):
            for obj in page.get("Contents", []):
                keys.add(obj["Key"][len(self.dprefix):])
        return keys

    def _cached(self, key: str) -> Path:
        path = (self.cache / key).resolve()
        if self.cache.resolve() not in path.parents:
            raise HTTPException(404, detail="image_not_ready")
        if not path.is_file():
            try:
                obj = self.client.get_object(Bucket=self.bucket, Key=self.dprefix + key)
            except Exception:
                raise HTTPException(404, detail="image_not_ready")
            with self._cache_lock:
                _atomic_write(path, obj["Body"].read())
        return path

    def derivative_path(self, key: str) -> Path:
        try:
            return self._cached(key)
        except HTTPException:
            raise FileNotFoundError(key)

    def derivative_response(self, key: str, content_type: str, immutable: bool,
                            download_name: str | None = None) -> Response:
        path = self._cached(key)
        cache = "private, max-age=3600" if download_name else (IMMUTABLE if immutable else "public, max-age=3600")
        return FileResponse(path, media_type=content_type, filename=download_name,
                            headers={"Cache-Control": cache, "X-Content-Type-Options": "nosniff"})

    def delete_derivative(self, key: str) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=self.dprefix + key)
        finally:
            (self.cache / key).unlink(missing_ok=True)

    def health(self) -> dict:
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return {"ok": True, "kind": self.kind, "bucket": self.bucket}
        except Exception as exc:
            return {"ok": False, "kind": self.kind, "bucket": self.bucket, "error": type(exc).__name__}

    def put_original(self, rel: str, data: bytes) -> None:
        """Usado por ferramentas e testes para enviar originais ao bucket."""
        self.client.put_object(Bucket=self.bucket, Key=self.prefix + rel, Body=data)

    def delete_original(self, rel: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self.prefix + rel)


_store: LocalStore | R2Store | None = None
_store_lock = threading.Lock()


def store() -> LocalStore | R2Store:
    global _store
    with _store_lock:
        if _store is None:
            _store = R2Store() if settings.storage_backend == "r2" else LocalStore()
        return _store


def reset_store() -> None:
    global _store
    with _store_lock:
        _store = None


def clear_local_cache() -> None:
    """Simula a perda do disco efêmero (testes) ou libera espaço."""
    shutil.rmtree(settings.cache_dir, ignore_errors=True)
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
