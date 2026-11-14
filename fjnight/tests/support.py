"""Utilitários dos testes: fotos de exemplo, reinicialização, novo deploy, login."""
from __future__ import annotations

import io
import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from backend import catalog, durable, faces, jobs, security, storage
from backend.config import ensure_dirs, settings
from backend.main import app

TOKEN = "token-de-teste-com-mais-de-24-caracteres"
REPO = Path(__file__).resolve().parents[2]
SAMPLES = REPO / "colocar as fotos aqui"

PRIVACY_FILLED = {
    "controller": "Organização Exemplo de Teste",
    "controller_document": "",
    "contact": "privacidade@exemplo.test",
    "dpo": "",
    "requests_channel": "privacidade@exemplo.test",
    "response_time": "15 dias",
    "legal_basis_publication": "Texto de teste da base legal de publicação.",
    "legal_basis_face_index": "Texto de teste da base legal do índice facial.",
    "legal_basis_face_search": "Texto de teste da base legal da busca.",
    "attendees_notice": "Texto de teste sobre o aviso aos participantes.",
}
CHECKLIST = {k: True for k in faces.CHECKLIST}


def jpeg(color=(120, 80, 40), size=(1600, 1067), orientation: int | None = None,
         taken: str | None = "2026:11:13 23:30:00") -> bytes:
    img = Image.new("RGB", size, color)
    exif = Image.Exif()
    if orientation:
        exif[274] = orientation
    if taken:
        exif[0x0132] = taken
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90, exif=exif)
    return buf.getvalue()


def put_original(rel: str, data: bytes) -> None:
    st = storage.store()
    if st.kind == "r2":
        st.put_original(rel, data)
    else:
        path = settings.photo_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def remove_original(rel: str) -> None:
    st = storage.store()
    if st.kind == "r2":
        st.delete_original(rel)
    else:
        (settings.photo_dir / rel).unlink()


def read_original(rel: str) -> bytes:
    st = storage.store()
    with st.original_file(rel) as path:
        return path.read_bytes()


def write_privacy(values: dict) -> None:
    data = {"_leia_me": "teste", **{k: "" for k in PRIVACY_FILLED}, **values}
    (settings.config_dir / "privacy.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def set_setting(name: str, value) -> None:
    object.__setattr__(settings, name, value)


def clear_memory_caches() -> None:
    catalog._cache.clear()
    catalog._file_rules_cache = None
    faces._matrix_cache = None
    faces._optout_cache = None
    faces._aes = None


def simulate_restart() -> None:
    """Novo processo: conexões, conexões do R2 e caches em memória são descartados."""
    durable.reset_engine()
    storage.reset_store()
    clear_memory_caches()
    security.login_guard._state.clear()


def wipe_ephemeral_disk() -> None:
    """O que acontece no Render Free a cada deploy/reinício: o disco local some."""
    shutil.rmtree(settings.data_dir, ignore_errors=True)
    ensure_dirs()


def simulate_new_deploy() -> dict:
    simulate_restart()
    wipe_ephemeral_disk()
    durable.init()
    return sync()


def sync() -> dict:
    jobs.wait_idle()
    return jobs.run_pipeline(trigger="teste")


def reset_everything() -> None:
    jobs.wait_idle()
    st = storage.store()
    if st.kind == "r2":
        for obj in st.list_originals({".jpg", ".jpeg", ".png", ".webp", ".cr2", ".txt"} | set()):
            st.delete_original(obj.rel_path)
        for key in st.derivative_keys():
            st.delete_derivative(key)
    shutil.rmtree(settings.photo_dir, ignore_errors=True)
    wipe_ephemeral_disk()
    durable.metadata.drop_all(durable.engine())
    simulate_restart()
    durable.init()
    write_privacy({})
    (settings.config_dir / "photo-rules.json").write_text(
        json.dumps({"ocultas": [], "sem_download": [], "sem_busca_facial": [], "regras_por_arquivo": []}), encoding="utf-8")
    set_setting("face_search_enabled", False)
    set_setting("app_env", "development")
    set_setting("new_photos_require_review", False)
    set_setting("sqlite_is_durable", False)


def client(https: bool = False) -> TestClient:
    return TestClient(app, base_url="https://testserver" if https else "http://testserver")


def admin_client() -> tuple[TestClient, dict]:
    c = client(https=True)   # em produção o cookie é Secure e só trafega em HTTPS
    r = c.post("/api/admin/login", json={"token": TOKEN})
    assert r.status_code == 200, r.text
    return c, {"X-CSRF-Token": r.json()["csrf"]}


def enable_face_search(c: TestClient, h: dict) -> dict:
    set_setting("face_search_enabled", True)
    write_privacy(PRIVACY_FILLED)
    r = c.post("/api/admin/faces/authorize", headers=h,
               json={"confirmed_by": "Pessoa Responsável", "role": "Controlador", "checklist": CHECKLIST})
    assert r.status_code == 200, r.text
    jobs.wait_idle()
    return r.json()


def jpeg_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def selfie_from_display(pid: str, version: str) -> bytes:
    """Recorta o rosto principal de uma foto do álbum, simulando uma selfie."""
    path = storage.store().derivative_path(catalog.keys_for(pid, version)["display"])
    img = Image.open(path).convert("RGB")
    found = faces.engine.detect(faces.to_bgr(img), score=0.8, min_size=28)
    x, y, w, h = [int(v) for v in found[0][:4]]
    m = int(max(w, h) * 0.9)
    return jpeg_bytes(img.crop((max(0, x - m), max(0, y - m), x + w + m, y + h + m)))


def search(c: TestClient, data: bytes, version: str | None = None, face: int | None = None, ctype="image/jpeg"):
    from backend.routes_faces import CONSENT_VERSION

    headers = {"Content-Type": ctype, "X-Consent": "true", "X-Consent-Version": version or CONSENT_VERSION}
    url = "/api/faces/search" + (f"?face={face}" if face is not None else "")
    return c.post(url, content=data, headers=headers)


def fetch_download(c: TestClient, url: str) -> tuple[bytes, str]:
    """Segue o download como o navegador: no R2, a aplicação redireciona para uma URL assinada."""
    r = c.get(url, follow_redirects=False)
    if r.status_code in (302, 307):
        import httpx

        assert "X-Amz-Signature" in r.headers["location"]
        external = httpx.get(r.headers["location"], timeout=60)
        assert external.status_code == 200
        return external.content, external.headers.get("content-type", "")
    assert r.status_code == 200, r.text
    return r.content, r.headers.get("content-type", "")
