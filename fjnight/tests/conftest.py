"""Ambiente isolado de testes: pastas temporárias para fotos, dados e biometria.

As variáveis são definidas antes de importar o backend, porque a configuração é
lida na importação.
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TMP = Path(tempfile.mkdtemp(prefix="fjnight-tests-"))
os.environ.update({
    "PHOTO_DIR": str(TMP / "fotos"),
    "DATA_DIR": str(TMP / "data"),
    "CONFIG_DIR": str(TMP / "config"),
    "ADMIN_TOKEN": "token-de-teste-com-mais-de-24-caracteres",
    "FACE_DATA_KEY": "chave-de-teste",
    "FACE_SEARCH_RATE_LIMIT": "1000",
    "INDEX_ON_STARTUP": "false",
})
(TMP / "config").mkdir(parents=True, exist_ok=True)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
