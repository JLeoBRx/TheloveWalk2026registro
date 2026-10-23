from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

def test_health_returns_album_state():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "photos_indexed" in data
    assert "admin_configured" in data
    assert "models_ready" not in data

def test_gallery_is_paginated_and_empty_safe():
    response = client.get("/api/gallery?page=1&page_size=24")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["results"], list)
    assert data["total"] >= len(data["results"])
    assert "categories" in data

def test_admin_fails_closed_without_token():
    response = client.post("/api/admin/index", json={"confirm_gallery_scan": True})
    assert response.status_code in {401, 503}

def test_frontend_pages_are_served():
    home = client.get("/")
    assert home.status_code == 200
    assert "Álbum de Fotografias" in home.text
    assert "Caminhada do Amor" in home.text
    assert "youtube-nocookie.com/embed/HBCcpKBPhYM" in home.text
    assert client.get("/admin.html").status_code == 200
    assert client.get("/privacy.html").status_code == 200

def test_face_search_endpoint_is_not_exposed():
    response = client.post("/api/search", data={"consent": "true"}, files={"file": ("face.jpg", b"not-an-image", "image/jpeg")})
    assert response.status_code == 404
