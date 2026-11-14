"""Playlist independente, páginas e rotas públicas."""
import pytest

from backend import playlist
from support import admin_client, client, reset_everything, simulate_restart


@pytest.fixture(autouse=True)
def fresh():
    reset_everything()
    yield


@pytest.mark.parametrize("value,expected", [
    ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://evil.example/watch?v=dQw4w9WgXcQ", None),
    ("javascript:alert(1)", None),
    ("curto", None),
])
def test_youtube_id_parsing(value, expected):
    assert playlist.parse_youtube_id(value) == expected


def test_playlist_starts_empty_and_does_not_reuse_love_walk():
    c = client()
    assert c.get("/api/playlist").json()["tracks"] == []
    assert c.get("/api/event").json()["playlist"]["tracks"] == 0
    love_walk_ids = {"HBCcpKBPhYM", "m0yQOrXPVI0", "iYJf8z8kdJY", "V5HjNDEBDIs", "dZ0kyYjetnY"}
    from backend.main import FRONTEND
    for path in FRONTEND.rglob("*"):
        if path.is_file() and path.suffix in {".html", ".js"}:
            text = path.read_text(encoding="utf-8")
            assert not any(i in text for i in love_walk_ids), path


def test_admin_saves_playlist_durably_with_validation():
    c, h = admin_client()
    bad = c.put("/api/admin/playlist", headers=h, json={"tracks": [{"title": "", "url": "x"}]})
    assert bad.status_code == 400
    ok = c.put("/api/admin/playlist", headers=h, json={"tracks": [
        {"title": "Louvor de abertura", "artist": "Banda", "url": "https://youtu.be/dQw4w9WgXcQ"}]})
    assert ok.status_code == 200 and ok.json()["tracks"][0]["youtube_id"] == "dQw4w9WgXcQ"
    simulate_restart()
    tracks = client().get("/api/playlist").json()["tracks"]
    assert tracks == [{"title": "Louvor de abertura", "artist": "Banda", "youtube_id": "dQw4w9WgXcQ"}]


def test_pages_and_assets_are_served_with_versioned_cache():
    c = client()
    home = c.get("/")
    assert home.status_code == 200 and "A Noite da Herança" in home.text and "FJU" in home.text
    assert "__V__" not in home.text
    import re
    css = re.search(r'href="(/assets/css/app\.css\?v=[0-9a-f]+)"', home.text).group(1)
    r = c.get(css)
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]
    assert c.head("/").status_code == 200
    assert c.get("/privacidade").status_code == 200
    assert c.get("/admin").status_code == 200
    assert "Disallow: /admin" in c.get("/robots.txt").text
    assert c.get("/api/health").json() == {"status": "ok"}
