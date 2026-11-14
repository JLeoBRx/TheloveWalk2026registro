"""Busca facial, autorização de ativação, oposição, retenção e persistência entre deploys."""
import json

import numpy as np
import pytest

from backend import catalog, faces, jobs
from backend.config import settings
from support import (PRIVACY_FILLED, SAMPLES, admin_client, client, enable_face_search, jpeg, put_original,
                     remove_original, reset_everything, search, selfie_from_display, set_setting, simulate_new_deploy,
                     simulate_restart, sync, wipe_ephemeral_disk, write_privacy, CHECKLIST)

REAL = ["5109842039846669551.jpg", "IMG_0042.CR2", "5109842039846669507.jpg"]
has_samples = all((SAMPLES / n).is_file() for n in REAL) and faces.engine.available()
real_faces = pytest.mark.skipif(not has_samples, reason="fotos de amostra ou modelos ausentes")


@pytest.fixture(autouse=True)
def fresh():
    reset_everything()
    yield


def load_real():
    for name in REAL:
        put_original(f"Amostra/{name}", (SAMPLES / name).read_bytes())
    sync()
    rows = {r["rel_path"].split("/")[-1]: r for r in catalog.all_rows()[0]}
    return {n: rows[n] for n in REAL}


# ---------------------------------------------------------------------------
# Desligada por padrão
# ---------------------------------------------------------------------------
def test_face_search_is_disabled_by_default_and_no_index_is_created():
    put_original("a.jpg", jpeg())
    result = sync()
    assert result["faces"]["status"] == "not_authorized"
    assert not settings.faces_db.exists()
    c = client()
    assert c.get("/api/faces/status").json()["available"] is False
    r = search(c, jpeg())
    assert r.status_code == 503 and r.json()["code"] == "face_search_disabled"
    assert c.get("/api/event").json()["face_search"]["available"] is False


def test_env_flag_alone_does_not_enable_search():
    set_setting("face_search_enabled", True)
    put_original("a.jpg", jpeg())
    sync()
    status = faces.authorization_status()
    assert not status["authorized"]
    assert {p["code"] for p in status["pending"]} >= {"privacy_complete", "authorized"}
    assert not settings.faces_db.exists()


def test_authorization_requires_complete_privacy_and_full_checklist():
    set_setting("face_search_enabled", True)
    c, h = admin_client()
    body = {"confirmed_by": "Fulana", "role": "Controladora", "checklist": CHECKLIST}
    assert c.post("/api/admin/faces/authorize", headers=h, json=body).status_code == 409   # privacidade vazia
    write_privacy(PRIVACY_FILLED)
    partial = {**body, "checklist": {**CHECKLIST, "selfie_consent_not_enough": False}}
    assert c.post("/api/admin/faces/authorize", headers=h, json=partial).status_code == 400
    assert c.post("/api/admin/faces/authorize", headers=h, json={**body, "confirmed_by": " "}).status_code == 400
    r = c.post("/api/admin/faces/authorize", headers=h, json=body)
    assert r.status_code == 200 and r.json()["authorized"] is True


def test_changing_privacy_text_invalidates_authorization_and_purges_index():
    put_original("a.jpg", jpeg())
    sync()
    c, h = admin_client()
    enable_face_search(c, h)
    assert settings.faces_db.exists()
    write_privacy({**PRIVACY_FILLED, "legal_basis_face_index": "Outro texto"})
    assert faces.authorization_status()["checks"]["privacy_unchanged"] is False
    sync()
    assert not settings.faces_db.exists()
    assert search(client(), jpeg()).status_code == 503


def test_revoke_purges_index():
    put_original("a.jpg", jpeg())
    sync()
    c, h = admin_client()
    enable_face_search(c, h)
    assert c.post("/api/admin/faces/revoke", headers=h, json={"confirm": "nao"}).status_code == 400
    assert c.post("/api/admin/faces/revoke", headers=h, json={"confirm": "REVOGAR", "by": "Fulana"}).status_code == 200
    assert not settings.faces_db.exists()
    assert faces.authorization_status()["authorized"] is False


def test_production_requires_durable_db_and_env_key():
    set_setting("app_env", "production")
    set_setting("face_search_enabled", True)
    write_privacy(PRIVACY_FILLED)
    status = faces.authorization_status()
    assert status["checks"]["durable_storage"] is False          # SQLite sem disco persistente declarado
    set_setting("sqlite_is_durable", True)
    set_setting("face_data_key", "")
    simulate_restart()
    status = faces.authorization_status()
    assert status["checks"]["key_configured"] is False           # em produção, nunca chave gerada no disco
    set_setting("face_data_key", "chave-de-teste-para-cifragem")
    simulate_restart()


def test_non_durable_production_blocks_admin_writes_but_gallery_works():
    set_setting("app_env", "production")
    put_original("a.jpg", jpeg())
    sync()
    c, h = admin_client()
    pid = c.get("/api/photos").json()["items"][0]["id"]
    assert c.patch(f"/api/admin/photos/{pid}", headers=h, json={"hidden": True}).json()["detail"] == "durable_storage_required"
    assert c.put("/api/admin/playlist", headers=h, json={"tracks": []}).status_code == 409
    assert client().get("/api/photos").json()["total"] == 1
    status = c.get("/api/admin/status").json()
    assert status["persistence"]["admin_writes_allowed"] is False


def test_key_mismatch_blocks_search():
    put_original("a.jpg", jpeg())
    sync()
    c, h = admin_client()
    enable_face_search(c, h)
    set_setting("face_data_key", "outra-chave")
    simulate_restart()
    try:
        status = faces.authorization_status()
        assert status["checks"]["key_matches"] is False and not status["authorized"]
    finally:
        set_setting("face_data_key", "chave-de-teste-para-cifragem")
        simulate_restart()


def test_embeddings_are_encrypted_and_bound_to_photo():
    vec = np.random.default_rng(1).normal(size=128).astype(np.float32)
    vec /= np.linalg.norm(vec)
    nonce, blob = faces._seal(vec, faces._aad_face("x" * 24))
    assert vec.tobytes() not in blob
    assert np.allclose(faces._open(nonce, blob, faces._aad_face("x" * 24)), vec)
    with pytest.raises(Exception):
        faces._open(nonce, blob, faces._aad_face("y" * 24))


def test_retention_expiry_erases_everything_with_verifiable_receipt(monkeypatch):
    put_original("a.jpg", jpeg())
    sync()
    c, h = admin_client()
    enable_face_search(c, h)
    vec = np.ones(128, np.float32) / np.sqrt(128)
    faces.register_optout(vec)
    monkeypatch.setattr(faces, "expired", lambda: True)
    receipt = faces.enforce_retention()
    assert receipt["verified"] is True and receipt["optouts_deleted"] == 1 and receipt["optouts_remaining"] == 0
    assert not settings.faces_db.exists() and faces.list_optouts() == []
    r = search(client(), jpeg())
    assert r.status_code == 410 and r.json()["code"] == "face_search_expired"
    assert faces.index_faces()["status"] == "expired"
    assert not settings.faces_db.exists()
    history = c.get("/api/admin/history").json()["items"]
    assert any(item["action"] == "retention_purge" and item["ok"] for item in history)


# ---------------------------------------------------------------------------
# Rostos reais (fotos de amostra do repositório)
# ---------------------------------------------------------------------------
@real_faces
def test_real_person_found_in_group_raw_photo_and_stranger_not_returned():
    rows = load_real()
    c, h = admin_client()
    enable_face_search(c, h)
    assert faces.local_stats()["faces_indexed"] > 3
    r0 = rows["5109842039846669551.jpg"]
    r = search(client(), selfie_from_display(r0["id"], r0["version"]))
    assert r.status_code == 200, r.text
    found = {i["id"] for i in r.json()["items"]}
    assert r0["id"] in found
    assert rows["IMG_0042.CR2"]["id"] in found
    assert rows["5109842039846669507.jpg"]["id"] not in found
    assert all(set(i) >= {"id", "match"} and "score" not in i and "embedding" not in i for i in r.json()["items"])


@real_faces
def test_multiple_faces_require_choice():
    rows = load_real()
    c, h = admin_client()
    enable_face_search(c, h)
    from backend.storage import store
    from PIL import Image
    from support import jpeg_bytes
    g = rows["IMG_0042.CR2"]
    img = Image.open(store().derivative_path(catalog.keys_for(g["id"], g["version"])["display"])).convert("RGB")
    data = jpeg_bytes(img)
    r = search(client(), data).json()
    assert r["status"] == "choose_face" and len(r["faces"]) >= 2
    assert search(client(), data, face=0).json()["status"] == "ok"


@real_faces
def test_optout_survives_restart_new_deploy_and_reindex():
    rows = load_real()
    c, h = admin_client()
    enable_face_search(c, h)
    r0 = rows["5109842039846669551.jpg"]
    selfie = selfie_from_display(r0["id"], r0["version"])
    r = c.post("/api/admin/faces/optout", headers={**h, "Content-Type": "image/jpeg", "X-Confirm": "true"}, content=selfie)
    assert r.status_code == 200 and r.json()["protocol"].startswith("OP-") and r.json()["faces_removed"] >= 2
    assert search(client(), selfie).json()["total"] == 0
    simulate_restart()
    assert search(client(), selfie).json()["total"] == 0
    simulate_new_deploy()                       # disco efêmero apagado; índice refeito do zero
    assert settings.faces_db.exists()
    assert search(client(), selfie).json()["total"] == 0
    c2, h2 = admin_client()
    assert c2.post("/api/admin/faces/reindex", headers=h2, json={"confirm": True}).status_code == 202
    jobs.wait_idle()
    assert search(client(), selfie).json()["total"] == 0
    # Retirada do pedido pela própria pessoa: volta a ser localizável após nova sincronização
    protocol = c2.get("/api/admin/faces/optouts").json()["items"][0]["protocol"]
    assert c2.request("DELETE", f"/api/admin/faces/optouts/{protocol}", headers=h2, json={"confirm": "REMOVER"}).status_code == 200
    jobs.wait_idle()
    faces.purge_local_index()
    sync()
    assert search(client(), selfie).json()["total"] >= 2


@real_faces
def test_photo_excluded_from_face_search_stays_excluded_after_new_deploy():
    rows = load_real()
    c, h = admin_client()
    enable_face_search(c, h)
    group = rows["IMG_0042.CR2"]["id"]
    c.patch(f"/api/admin/photos/{group}", headers=h, json={"face_search": False})
    jobs.wait_idle()
    simulate_new_deploy()
    r0 = rows["5109842039846669551.jpg"]
    found = {i["id"] for i in search(client(), selfie_from_display(r0["id"], r0["version"])).json()["items"]}
    assert group not in found and r0["id"] in found


@real_faces
def test_deleted_photo_leaves_index():
    rows = load_real()
    c, h = admin_client()
    enable_face_search(c, h)
    r0 = rows["5109842039846669551.jpg"]
    selfie = selfie_from_display(r0["id"], r0["version"])
    remove_original("Amostra/IMG_0042.CR2")
    sync()
    found = {i["id"] for i in search(client(), selfie).json()["items"]}
    assert rows["IMG_0042.CR2"]["id"] not in found


@real_faces
def test_raw_original_and_camera_jpeg_downloads():
    rows = load_real()
    raw = rows["IMG_0042.CR2"]
    assert raw["is_raw"] and raw["has_camera_jpeg"] and raw["taken_at"] == "2026-10-24T10:10:35"
    c = client()
    item = c.get(f"/api/photos/{raw['id']}").json()
    assert item["original"] and item["original_label"] == "CR2" and item["download_label"] == "JPEG da câmera"
    from io import BytesIO
    from PIL import Image
    r = c.get(item["download"], follow_redirects=True)
    assert r.headers["content-type"] == "image/jpeg" and max(Image.open(BytesIO(r.content)).size) >= 5000
    original = c.get(item["original"], follow_redirects=True).content
    assert original == (SAMPLES / "IMG_0042.CR2").read_bytes()      # RAW intacto, byte a byte
    disp = c.get(item["display"]).content
    assert max(Image.open(BytesIO(disp)).size) == settings.display_size


def test_raw_original_respects_download_permission():
    put_original("a.jpg", jpeg())
    sync()
    c = client()
    pid = c.get("/api/photos").json()["items"][0]["id"]
    assert c.get(f"/media/original/{pid}").status_code == 403    # não é RAW


# ---------------------------------------------------------------------------
# Restauração e perda de dados
# ---------------------------------------------------------------------------
def test_export_and_restore_after_losing_rules():
    put_original("a.jpg", jpeg())
    put_original("b.jpg", jpeg((10, 10, 200)))
    sync()
    c, h = admin_client()
    ids = [i["id"] for i in c.get("/api/photos").json()["items"]]
    c.patch(f"/api/admin/photos/{ids[0]}", headers=h, json={"hidden": True})
    c.put("/api/admin/playlist", headers=h, json={"tracks": [{"title": "Faixa", "url": "https://youtu.be/abcdefghijk"}]})
    exported = c.get("/api/admin/config/export").json()
    assert "FACE_DATA_KEY" not in json.dumps(exported) and "embedding" not in json.dumps(exported)
    from backend import durable
    with durable.tx() as conn:
        conn.execute(durable.photo_rules.delete())
    durable.kv_set("rules_version", "perdido")
    assert c.get("/api/photos").json()["total"] == 2
    dry = c.post("/api/admin/config/import?dry_run=true", headers=h, json=exported).json()
    assert dry["dry_run"] and dry["rules"] == 1
    assert c.get("/api/photos").json()["total"] == 2              # simulação não altera nada
    done = c.post("/api/admin/config/import?dry_run=false", headers=h, json=exported).json()
    assert done["rules"] == 1
    assert c.get("/api/photos").json()["total"] == 1
    assert c.post("/api/admin/config/import?dry_run=true", headers=h,
                  json={"formato": "outro", "versao": 2}).status_code == 400


def test_rules_from_committed_file_survive_total_database_loss():
    put_original("a.jpg", jpeg())
    sync()
    c, h = admin_client()
    pid = c.get("/api/photos").json()["items"][0]["id"]
    c.patch(f"/api/admin/photos/{pid}", headers=h, json={"downloadable": False})
    exported = c.get("/api/admin/config/export").json()
    (settings.config_dir / "photo-rules.json").write_text(json.dumps(exported), encoding="utf-8")
    from backend import durable
    durable.metadata.drop_all(durable.engine())
    simulate_new_deploy()
    assert client().get(f"/api/photos/{pid}").json()["download"] is None


def test_audit_log_records_operations():
    put_original("a.jpg", jpeg())
    sync()
    c, h = admin_client()
    pid = c.get("/api/photos").json()["items"][0]["id"]
    c.patch(f"/api/admin/photos/{pid}", headers=h, json={"downloadable": False})
    actions = [i["action"] for i in c.get("/api/admin/history").json()["items"]]
    assert {"login", "sync", "photo_rule"} <= set(actions)
    assert all("token" not in json.dumps(i).lower() for i in c.get("/api/admin/history").json()["items"])


def test_persistence_check_reports_real_round_trip():
    c, _ = admin_client()
    p = c.get("/api/admin/status").json()["persistence"]
    assert p["database"]["ok"] is True and p["storage"]["ok"] is True


def test_privacy_page_never_invents_controller():
    c = client()
    data = c.get("/api/privacy").json()
    assert data["privacy"]["controller"] == "" and data["face_search"]["authorized"] is False
    page = c.get("/privacidade").text
    assert "a preencher" not in page.lower()
