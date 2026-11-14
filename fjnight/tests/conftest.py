"""Ambiente de testes isolado.

Executa a mesma suíte em três configurações:
    pytest                                         # SQLite + pasta local
    FJN_TEST_DATABASE_URL=postgresql://... pytest  # PostgreSQL real
    FJN_TEST_R2=1 pytest                           # fotos no "R2" (servidor S3 local do moto)

O diretório DATA_DIR representa o disco efêmero do Render; o banco durável fica
fora dele, para que os testes possam apagar o disco e verificar o que sobrevive.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TMP = Path(tempfile.mkdtemp(prefix="fjnight-tests-"))
(TMP / "config").mkdir(parents=True)
(TMP / "durable").mkdir(parents=True)
for name in ("event.json", "photo-rules.json", "playlist.json", "privacy.json"):
    shutil.copy2(ROOT / "config" / name, TMP / "config" / name)

ENV = {
    "APP_ENV": "development",
    "PHOTO_DIR": str(TMP / "fotos"),
    "DATA_DIR": str(TMP / "efemero"),
    "CONFIG_DIR": str(TMP / "config"),
    "DATABASE_URL": os.environ.get("FJN_TEST_DATABASE_URL") or f"sqlite:///{TMP / 'durable' / 'fjnight.sqlite3'}",
    "ADMIN_TOKEN": "token-de-teste-com-mais-de-24-caracteres",
    "FACE_DATA_KEY": "chave-de-teste-para-cifragem",
    "FACE_SEARCH_ENABLED": "false",
    "FACE_SEARCH_RATE_LIMIT": "1000",
    "INDEX_ON_STARTUP": "false",
    "TRUSTED_PROXY_HOPS": "1",
    "ADMIN_LOGIN_MAX_FAILURES": "3",
}

MOTO_SERVER = None
if os.environ.get("FJN_TEST_R2") == "1":
    from moto.server import ThreadedMotoServer

    MOTO_SERVER = ThreadedMotoServer(ip_address="127.0.0.1", port=0)
    MOTO_SERVER.start()
    host, port = MOTO_SERVER.get_host_and_port()
    ENV.update({
        "STORAGE_BACKEND": "r2", "R2_ENDPOINT": f"http://{host}:{port}", "R2_BUCKET": "fjunight-testes",
        "R2_ACCESS_KEY_ID": "teste", "R2_SECRET_ACCESS_KEY": "teste", "R2_REGION": "us-east-1",
    })
    import boto3

    boto3.client("s3", endpoint_url=ENV["R2_ENDPOINT"], aws_access_key_id="teste", aws_secret_access_key="teste",
                 region_name="us-east-1").create_bucket(Bucket="fjunight-testes")

os.environ.update(ENV)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if os.environ.get("FJN_TEST_DATABASE_URL"):
    # Começa de um banco limpo.
    from backend import durable

    durable.metadata.drop_all(durable.engine())
