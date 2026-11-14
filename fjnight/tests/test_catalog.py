"""Catálogo, sincronização incremental, galeria e mídia."""
import io

import pytest
from PIL import Image

from backend import catalog, storage
from backend.config import settings
from support import (client, fetch_download, jpeg, put_original, read_original, remove_original, reset_everything, simulate_new_deploy,
                     sync, admin_client)


@pytest.fixture(autouse=True)
def fresh():
    reset_everything()
    put_original("01 - Chegada/a.jpg", jpeg((200, 120, 40), taken="2026:11:13 23:10:00"))
    put_original("01 - Chegada/b.jpg", jpeg((40, 60, 90), size=(1000, 1500), taken="2026:11:13 23:05:00"))
    put_original("02 - Louvor/c.jpg", jpeg((90, 30, 10), size=(1200, 900), orientation=6))
    put_original("02 - Louvor/copia-de-a.jpg", jpeg((200, 120, 40), taken="2026:11:13 23:10:00"))
    put_original("02 - Louvor/quebrada.jpg", b"isto nao e uma imagem")
    put_original("LEIA-ME.md", b"instrucoes")
    yield


def test_initial_sync_counts_duplicates_and_errors():
    result = sync()["catalog"]
    assert result["processed"] == 3
    assert result["duplicates"] == 1 and result["errors"] == 1
    kinds = {i["rel_path"]: i["kind"] for i in catalog.issues()}
    assert kinds == {"02 - Louvor/copia-de-a.jpg": "duplicate", "02 - Louvor/quebrada.jpg": "error"}
    assert client().get("/api/status").json()["photos"] == 3


def test_incremental_sync_does_not_reprocess():
    sync()
    again = sync()["catalog"]
    assert again["processed"] == 0 and again["unchanged"] == 3


def test_order_categories_and_exif_date():
    sync()
    c = client()
    items = c.get("/api/photos").json()["items"]
    names = [i["thumb"] for i in items]
    assert len(names) == 3
    chegada = [i for i in items if i["category"] == "01 - Chegada"]
    assert [i["taken_at"] for i in chegada] == ["2026-11-13T23:05:00", "2026-11-13T23:10:00"]
    labels = [x["label"] for x in c.get("/api/event").json()["categories"]]
    assert labels == ["Chegada", "Louvor"]


def test_exif_orientation_is_applied():
    sync()
    item = client().get("/api/photos", params={"category": "02 - Louvor"}).json()["items"][0]
    assert (item["w"], item["h"]) == (900, 1200)


def test_pagination_and_etag():
    for i in range(7):
        put_original(f"03 - Mais/foto-{i}.jpg", jpeg((10 + i * 20, 50, 60)))
    sync()
    c = client()
    first = c.get("/api/photos?offset=0&limit=4").json()
    second = c.get("/api/photos?offset=4&limit=4").json()
    third = c.get("/api/photos?offset=8&limit=4").json()
    assert first["total"] == 10 and first["next_offset"] == 4 and third["next_offset"] is None
    ids = [p["id"] for p in first["items"] + second["items"] + third["items"]]
    assert len(ids) == len(set(ids)) == 10
    r = c.get("/api/photos?limit=4")
    assert c.get("/api/photos?limit=4", headers={"If-None-Match": r.headers["etag"]}).status_code == 304


def test_derivatives_and_original_download_are_byte_identical():
    sync()
    c = client()
    item = next(i for i in c.get("/api/photos").json()["items"] if i["taken_at"] == "2026-11-13T23:10:00")
    thumb = c.get(item["thumb"])
    assert thumb.status_code == 200 and "immutable" in thumb.headers["cache-control"]
    assert max(Image.open(io.BytesIO(thumb.content)).size) <= settings.thumb_size
    display = c.get(item["display"])
    assert max(Image.open(io.BytesIO(display.content)).size) <= settings.display_size
    if storage.store().kind == "local":
        assert "attachment" in c.get(item["download"]).headers["content-disposition"]
    body, _ = fetch_download(c, item["download"])
    assert body == read_original("01 - Chegada/a.jpg")


def test_rename_keeps_identity_and_rules():
    sync()
    c, h = admin_client()
    pid = next(i for i in c.get("/api/photos").json()["items"] if i["category"] == "02 - Louvor")["id"]
    assert c.patch(f"/api/admin/photos/{pid}", headers=h, json={"downloadable": False}).status_code == 200
    data = read_original("02 - Louvor/c.jpg")
    remove_original("02 - Louvor/c.jpg")
    put_original("04 - Novo/c-renomeada.jpg", data)
    result = sync()["catalog"]
    assert result["renamed"] == 1 and result["processed"] == 0
    item = c.get(f"/api/photos/{pid}").json()
    assert item["category"] == "04 - Novo" and item["download"] is None


def test_changed_content_becomes_new_photo_and_path_rule_still_applies():
    sync()
    c, h = admin_client()
    old = next(i for i in c.get("/api/photos").json()["items"] if i["category"] == "02 - Louvor")["id"]
    c.patch(f"/api/admin/photos/{old}", headers=h, json={"face_search": False})
    put_original("02 - Louvor/c.jpg", jpeg((5, 200, 5), size=(800, 600)))
    sync()
    assert c.get(f"/api/photos/{old}").status_code == 404
    new = next(r for r in catalog.all_rows()[0] if r["rel_path"] == "02 - Louvor/c.jpg")
    assert catalog.get_photo(new["id"])[1].face_search is False   # decisão pelo caminho continua valendo


def test_removed_photo_keeps_its_rules_when_it_comes_back():
    sync()
    c, h = admin_client()
    pid = next(i for i in c.get("/api/photos").json()["items"] if i["category"] == "02 - Louvor")["id"]
    c.patch(f"/api/admin/photos/{pid}", headers=h, json={"hidden": True, "reason": "Pedido de remoção"})
    data = read_original("02 - Louvor/c.jpg")
    remove_original("02 - Louvor/c.jpg")
    assert sync()["catalog"]["removed"] == 1
    put_original("05 - Reenvio/mesma-foto.jpg", data)   # a mesma foto volta com outro nome
    sync()
    assert catalog.get_photo(pid) is None                  # continua oculta, sem revisão
    assert catalog.get_photo(pid, include_hidden=True)[1].reason == "Pedido de remoção"
    assert client().get(f"/media/thumb/{pid}.webp").status_code == 404


def test_sync_never_deletes_rules():
    sync()
    c, h = admin_client()
    for item in c.get("/api/photos").json()["items"]:
        c.patch(f"/api/admin/photos/{item['id']}", headers=h, json={"downloadable": False})
    for rel in ("01 - Chegada/a.jpg", "01 - Chegada/b.jpg", "02 - Louvor/c.jpg"):
        remove_original(rel)
    sync()
    assert len(catalog.export_rules()) == 3


def test_rules_file_patterns_hide_photos():
    import json
    sync()
    (settings.config_dir / "photo-rules.json").write_text(json.dumps({"ocultas": ["02 - Louvor/*"]}), encoding="utf-8")
    assert client().get("/api/photos").json()["total"] == 2


def test_review_mode_holds_new_photos_until_published():
    from support import set_setting
    set_setting("new_photos_require_review", True)
    sync()
    c, h = admin_client()
    assert c.get("/api/photos").json()["total"] == 0
    r = c.post("/api/admin/photos/publish-pending", headers=h, json={"confirm": True})
    assert r.json()["published"] == 3
    assert c.get("/api/photos").json()["total"] == 3


def test_invalid_ids_are_rejected():
    sync()
    c = client()
    assert c.get("/media/thumb/../../etc.webp").status_code == 404
    assert c.get("/media/download/naoexiste").status_code == 404
    assert c.get("/api/photos/" + "0" * 24).status_code == 404


def test_new_deploy_rebuilds_derivatives_and_keeps_catalog():
    sync()
    before = {i["id"] for i in client().get("/api/photos").json()["items"]}
    result = simulate_new_deploy()["catalog"]
    after = {i["id"] for i in client().get("/api/photos").json()["items"]}
    assert before == after
    if storage.store().kind == "r2":
        assert result["processed"] == 0    # derivados ficam no R2: nada a refazer
    item = client().get("/api/photos").json()["items"][0]
    assert client().get(item["thumb"]).status_code == 200


def test_empty_gallery_is_served():
    c = client()
    assert c.get("/api/photos").json()["total"] == 0
    assert c.get("/").status_code == 200


def test_default_single_album_ignores_subfolders():
    from support import set_setting
    set_setting("categories_from_folders", False)
    try:
        sync()
        c = client()
        items = c.get("/api/photos").json()["items"]
        assert len(items) == 3 and {i["category"] for i in items} == {""}
        assert c.get("/api/event").json()["categories"] == [{"id": "", "label": "Outras", "count": 3}]
        # ordem pelo horário da foto, não pela pasta
        dated = [i["taken_at"] for i in items if i["taken_at"]]
        assert dated == sorted(dated)
    finally:
        set_setting("categories_from_folders", True)
    sync()   # voltar a ativar as pastas reclassifica sem reprocessar imagens
    assert {i["category"] for i in client().get("/api/photos").json()["items"]} == {"01 - Chegada", "02 - Louvor"}
