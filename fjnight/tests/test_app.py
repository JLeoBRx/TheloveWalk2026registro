"""Testes do álbum FJ Night: catálogo, mídia, administração e busca facial."""
import io
import os
import shutil
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend import catalog, db, faces, jobs
from backend.config import settings
from backend.main import app
from backend.routes_faces import CONSENT_VERSION

REPO = Path(__file__).resolve().parents[2]
SAMPLES = REPO / "colocar as fotos aqui"
ADMIN = {"X-Admin-Token": os.environ["ADMIN_TOKEN"]}
client = TestClient(app)


def write_jpeg(path: Path, size=(1600, 1067), color=(120, 80, 40), orientation: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", size, color)
    exif = Image.Exif()
    if orientation:
        exif[274] = orientation
    exif[0x0132] = "2026:11:13 23:30:00"
    img.save(path, "JPEG", quality=90, exif=exif)


def jpeg_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def sync() -> dict:
    return jobs.run_pipeline(include_faces=True)


@pytest.fixture(scope="module", autouse=True)
def gallery():
    db.init()
    write_jpeg(settings.photo_dir / "01 - Chegada" / "a.jpg", color=(200, 120, 40))
    write_jpeg(settings.photo_dir / "01 - Chegada" / "b.jpg", size=(1000, 1500), color=(40, 60, 90))
    write_jpeg(settings.photo_dir / "02 - Louvor" / "c.jpg", size=(1200, 900), orientation=6)
    (settings.photo_dir / "02 - Louvor" / "quebrada.jpg").write_bytes(b"isto nao e uma imagem")
    (settings.photo_dir / "LEIA-ME.md").write_text("instrucoes", encoding="utf-8")
    result = sync()
    assert result["catalog"]["processed"] == 3
    assert result["catalog"]["errors"] == 1
    yield


def test_status_and_event():
    status = client.get("/api/status").json()
    assert status["status"] == "ok" and status["photos"] == 3
    event = client.get("/api/event").json()
    assert event["event"]["theme"] == "A Noite da Herança"
    assert event["event"]["date_label"] == "13 de novembro"
    assert event["photos_total"] == 3
    labels = [c["label"] for c in event["categories"]]
    assert labels == ["Chegada", "Louvor"]


def test_photos_are_paginated_ordered_and_categorized():
    first = client.get("/api/photos?offset=0&limit=2").json()
    assert first["total"] == 3 and len(first["items"]) == 2 and first["next_offset"] == 2
    second = client.get("/api/photos?offset=2&limit=2").json()
    assert second["next_offset"] is None
    ids = [p["id"] for p in first["items"] + second["items"]]
    assert len(set(ids)) == 3
    only = client.get("/api/photos", params={"category": "02 - Louvor"}).json()
    assert only["total"] == 1 and only["items"][0]["category_label"] == "Louvor"


def test_exif_orientation_is_applied_to_dimensions():
    item = client.get("/api/photos", params={"category": "02 - Louvor"}).json()["items"][0]
    assert (item["w"], item["h"]) == (900, 1200)  # orientação 6 = retrato


def test_etag_allows_cache_revalidation():
    r = client.get("/api/photos?limit=5")
    again = client.get("/api/photos?limit=5", headers={"If-None-Match": r.headers["etag"]})
    assert again.status_code == 304


def test_media_derivatives_and_original_download():
    item = client.get("/api/photos?limit=1").json()["items"][0]
    thumb = client.get(item["thumb"])
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/webp"
    assert "immutable" in thumb.headers["cache-control"]
    assert max(Image.open(io.BytesIO(thumb.content)).size) <= settings.thumb_size
    display = client.get(item["display"])
    assert max(Image.open(io.BytesIO(display.content)).size) <= settings.display_size
    original = client.get(item["download"])
    assert original.status_code == 200
    assert "attachment" in original.headers["content-disposition"]
    source = next(settings.photo_dir.rglob("a.jpg"))
    assert original.content == source.read_bytes()  # original preservado byte a byte


def test_invalid_ids_and_traversal_are_rejected():
    assert client.get("/media/thumb/../../etc.webp").status_code == 404
    assert client.get("/media/download/naoexiste").status_code == 404
    assert client.get("/api/photos/0123456789abcdef0123").status_code == 404


def test_security_headers():
    r = client.get("/")
    assert r.status_code == 200
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
    assert "A Noite da Herança" in r.text
    assert client.get("/privacidade").status_code == 200
    assert client.get("/admin").headers["x-robots-tag"].startswith("noindex")


def test_admin_requires_token():
    assert client.get("/api/admin/status").status_code == 401
    assert client.get("/api/admin/status", headers={"X-Admin-Token": "errado"}).status_code == 401
    assert client.get("/api/admin/status", headers=ADMIN).status_code == 200


def test_hide_and_block_download_survive_reindex():
    pid = client.get("/api/photos?limit=1").json()["items"][0]["id"]
    r = client.patch(f"/api/admin/photos/{pid}", headers=ADMIN, json={"downloadable": False})
    assert r.json()["downloadable"] is False
    assert client.get(f"/media/download/{pid}").status_code == 403
    item = client.get(f"/api/photos/{pid}").json()
    assert item["download"] is None

    client.patch(f"/api/admin/photos/{pid}", headers=ADMIN, json={"hidden": True})
    while jobs.STATUS["running"]:
        time.sleep(0.1)
    sync()  # reindexação não pode reexibir a foto
    assert client.get("/api/photos").json()["total"] == 2
    assert client.get(f"/media/thumb/{pid}.webp").status_code == 404
    exported = client.get("/api/admin/rules/export", headers=ADMIN).json()
    assert len(exported["ocultas"]) == 1 and len(exported["sem_download"]) == 1

    client.patch(f"/api/admin/photos/{pid}", headers=ADMIN, json={"hidden": False, "downloadable": True})
    while jobs.STATUS["running"]:
        time.sleep(0.1)
    assert client.get("/api/photos").json()["total"] == 3


def test_rules_file_hides_photos():
    rules = settings.config_dir / "photo-rules.json"
    rules.write_text('{"ocultas": ["02 - Louvor/*"], "sem_download": [], "sem_busca_facial": []}', encoding="utf-8")
    try:
        assert client.get("/api/photos").json()["total"] == 2
    finally:
        rules.unlink()
        time.sleep(0.01)
    assert client.get("/api/photos").json()["total"] == 3


def test_removed_files_leave_the_catalog():
    extra = settings.photo_dir / "01 - Chegada" / "temporaria.jpg"
    write_jpeg(extra)
    sync()
    assert client.get("/api/photos").json()["total"] == 4
    extra.unlink()
    sync()
    assert client.get("/api/photos").json()["total"] == 3


# ---------------------------------------------------------------------------
# Busca facial
# ---------------------------------------------------------------------------
def search(data: bytes, consent="true", version=CONSENT_VERSION, **extra):
    form = {"consent": consent, "consent_version": version, **{k: str(v) for k, v in extra.items()}}
    return client.post("/api/faces/search", data=form, files={"image": ("selfie.jpg", data, "image/jpeg")})


def test_face_search_requires_explicit_consent():
    img = jpeg_bytes(Image.new("RGB", (400, 400), (90, 60, 40)))
    assert search(img, consent="false").json()["code"] == "consent_required"
    assert search(img, version="antiga").json()["code"] == "consent_required"


def test_face_search_validates_input():
    r = search(b"nada")
    assert r.status_code == 400 and r.json()["code"] == "invalid_image"
    r = search(jpeg_bytes(Image.new("RGB", (640, 480), (90, 60, 40))))
    assert r.status_code == 422 and r.json()["code"] == "no_face_detected"
    assert r.headers["cache-control"] == "no-store"


def test_upload_size_limit():
    original = settings.max_upload_bytes
    object.__setattr__(settings, "max_upload_bytes", 1000)
    try:
        r = search(b"x" * 2000)
        assert r.status_code == 413 and r.json()["code"] == "file_too_large"
    finally:
        object.__setattr__(settings, "max_upload_bytes", original)


def test_embeddings_are_encrypted_at_rest():
    vec = np.random.default_rng(1).normal(size=128).astype(np.float32)
    vec /= np.linalg.norm(vec)
    nonce, blob = faces._seal(vec, faces._aad_face("x" * 20))
    assert vec.tobytes() not in blob
    assert np.allclose(faces._open(nonce, blob, faces._aad_face("x" * 20)), vec)
    with pytest.raises(Exception):
        faces._open(nonce, blob, faces._aad_face("y" * 20))  # vínculo à foto (AAD)


def test_rate_limit():
    from backend.security import RateLimiter
    limiter = RateLimiter(2, 60)
    assert limiter.check("a") is None and limiter.check("a") is None
    assert limiter.check("a") > 0
    assert limiter.check("b") is None


real_faces = pytest.mark.skipif(
    not (SAMPLES / "5109842039846669551.jpg").is_file() or not faces.engine.available(),
    reason="fotos de amostra ou modelos faciais ausentes",
)


@pytest.fixture(scope="module")
def real_gallery():
    target = settings.photo_dir / "03 - Amostra real"
    target.mkdir(parents=True, exist_ok=True)
    for name in ("5109842039846669551.jpg", "IMG_0042.CR2", "5109842039846669507.jpg"):
        shutil.copy2(SAMPLES / name, target / name)
    sync()
    yield target
    shutil.rmtree(target)
    sync()


def selfie_from(path: Path) -> bytes:
    """Recorta o rosto principal da foto, simulando uma selfie."""
    img = Image.open(path).convert("RGB")
    found = faces.engine.detect(faces.to_bgr(img), score=0.8, min_size=28)
    x, y, w, h = [int(v) for v in found[0][:4]]
    m = int(max(w, h) * 0.9)
    return jpeg_bytes(img.crop((max(0, x - m), max(0, y - m), x + w + m, y + h + m)))


def ids_for(names: list[str]) -> dict[str, str]:
    return {n: catalog.photo_id(f"03 - Amostra real/{n}") for n in names}


@real_faces
def test_real_face_is_found_across_photos_including_raw(real_gallery):
    stats = faces.index_stats()
    assert stats["faces_indexed"] > 3
    ids = ids_for(["5109842039846669551.jpg", "IMG_0042.CR2", "5109842039846669507.jpg"])
    r = search(selfie_from(real_gallery / "5109842039846669551.jpg"))
    assert r.status_code == 200, r.text
    found = {item["id"] for item in r.json()["items"]}
    assert ids["5109842039846669551.jpg"] in found
    assert ids["IMG_0042.CR2"] in found           # a mesma pessoa numa foto de grupo (RAW)
    assert ids["5109842039846669507.jpg"] not in found
    # Nenhum dado facial é exposto na resposta
    body = r.text
    assert "embedding" not in body and "score" not in body


@real_faces
def test_raw_download_is_full_resolution_jpeg(real_gallery):
    pid = ids_for(["IMG_0042.CR2"])["IMG_0042.CR2"]
    r = client.get(f"/media/download/{pid}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert max(Image.open(io.BytesIO(r.content)).size) >= 5000


@real_faces
def test_multiple_faces_ask_the_visitor_to_choose(real_gallery):
    img = Image.open(settings.display_dir / f"{ids_for(['IMG_0042.CR2'])['IMG_0042.CR2']}.webp").convert("RGB")
    r = search(jpeg_bytes(img))
    data = r.json()
    assert data["status"] == "choose_face" and len(data["faces"]) >= 2
    assert all(0 <= f["x"] <= 1 and 0 <= f["w"] <= 1 for f in data["faces"])
    chosen = search(jpeg_bytes(img), face=0)
    assert chosen.json()["status"] == "ok"


@real_faces
def test_optout_blocks_the_person(real_gallery):
    selfie = selfie_from(real_gallery / "5109842039846669551.jpg")
    r = client.post("/api/admin/faces/optout", headers=ADMIN, data={"confirm": "true"},
                    files={"image": ("p.jpg", selfie, "image/jpeg")})
    assert r.status_code == 200 and r.json()["faces_removed"] >= 2
    assert search(selfie).json()["total"] == 0
    sync()  # reindexar não traz o rosto de volta
    assert search(selfie).json()["total"] == 0
    faces.purge_all(include_optouts=True)
    sync()
    assert search(selfie).json()["total"] >= 2


def test_retention_expiry_disables_search_and_erases_data(monkeypatch):
    import backend.faces as faces_module
    monkeypatch.setattr(faces_module, "expired", lambda: True)
    assert faces.enforce_retention() is True
    assert faces.index_stats()["faces_indexed"] == 0
    r = search(jpeg_bytes(Image.new("RGB", (300, 300))))
    assert r.status_code == 410 and r.json()["code"] == "face_search_expired"
    assert faces.index_faces()["status"] == "expired"
    (settings.biometric_dir / ".expirado").unlink(missing_ok=True)


def test_admin_purge_requires_typed_confirmation():
    r = client.request("DELETE", "/api/admin/faces", headers=ADMIN, json={"confirm": "sim"})
    assert r.status_code == 400
    r = client.request("DELETE", "/api/admin/faces", headers=ADMIN, json={"confirm": "APAGAR"})
    assert r.status_code == 200 and r.json()["faces_indexed"] == 0
