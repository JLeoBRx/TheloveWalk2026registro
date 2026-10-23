from io import BytesIO
from PIL import Image
from fastapi.testclient import TestClient
from backend.main import app, YUNET, SFACE

client = TestClient(app)

def test_health_returns_service_state():
    r = client.get("/api/health")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok"
    assert "photos_indexed" in d and "models_ready" in d

def test_gallery_is_paginated_and_empty_safe():
    r = client.get("/api/gallery?page=1&page_size=24")
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d["results"], list)
    assert d["total"] >= len(d["results"])
    assert "categories" in d

def test_admin_fails_closed_without_token():
    r = client.post("/api/admin/index", json={"confirm_authorized_photos": True})
    assert r.status_code == 503
    assert r.json()["detail"] == "admin_not_configured"

def test_frontend_pages_are_served():
    assert client.get("/").status_code == 200
    assert "THE LOVE WALK" in client.get("/").text
    assert client.get("/admin.html").status_code == 200
    assert client.get("/privacy.html").status_code == 200

def test_search_does_not_fake_results_when_weights_missing():
    if YUNET.is_file() and SFACE.is_file():
        return
    image = Image.new("RGB", (32, 32), color=(110, 90, 130))
    buf = BytesIO()
    image.save(buf, format="JPEG")
    r = client.post("/api/search", data={"consent": "true"},
                    files={"file": ("reference.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 503
    assert r.json()["detail"] == "models_missing"
