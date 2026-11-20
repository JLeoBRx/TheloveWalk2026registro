from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_papelaria_editor_is_served_on_the_same_site():
    page = client.get("/papelaria/")
    assert page.status_code == 200
    assert "Ateliê de Papelaria" in page.text
    assert page.headers["content-type"].startswith("text/html")


def test_papelaria_without_trailing_slash_redirects():
    response = client.get("/papelaria", follow_redirects=False)
    assert response.status_code == 308
    assert response.headers["location"] == "/papelaria/"


def test_papelaria_assets_are_served():
    for path in (
        "/papelaria/assets/css/editor.css",
        "/papelaria/assets/js/app.js",
        "/papelaria/assets/js/vendor/jspdf.umd.min.js",
        "/papelaria/assets/fonts/fonts-data.js",
    ):
        response = client.get(path)
        assert response.status_code == 200, path
    assert client.get("/papelaria/assets/js/nao-existe.js").status_code == 404
