"""Verifica (e, se faltar, baixa) os modelos de reconhecimento facial.

Os dois modelos já acompanham o repositório. Este script confere a integridade
por SHA-256 e baixa de fontes oficiais se algum arquivo estiver ausente ou
corrompido. Uso, na pasta fjnight/:

    python -m models.download_models

Modelos:
- YuNet 2023mar (detecção) — licença MIT — OpenCV Zoo / libfacedetection.train
- SFace 2021dec (reconhecimento) — licença Apache-2.0 — OpenCV Zoo
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
MODELS = {
    "face_detection_yunet_2023mar.onnx": {
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "size": 232_589,
        "urls": [
            "https://huggingface.co/opencv/opencv_zoo/resolve/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
            "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
            # Mesmo arquivo publicado pelo autor do YuNet (commit fixo)
            "https://raw.githubusercontent.com/ShiqiYu/libfacedetection.train/dca340aa082c71081a68d17db8e58b33a58a914b/onnx/yunet_s_640_640.onnx",
        ],
    },
    "face_recognition_sface_2021dec.onnx": {
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        "size": 38_696_353,
        "urls": [
            "https://huggingface.co/opencv/opencv_zoo/resolve/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
            "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        ],
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure(name: str, spec: dict) -> bool:
    target = ROOT / name
    if target.is_file() and sha256(target) == spec["sha256"]:
        print(f"[ok] {name} íntegro")
        return True
    for url in spec["urls"]:
        tmp = target.with_suffix(".part")
        try:
            print(f"[baixando] {name} de {url.split('/')[2]}")
            with requests.get(url, stream=True, timeout=(20, 300)) as resp:
                resp.raise_for_status()
                with tmp.open("wb") as fh:
                    for chunk in resp.iter_content(1 << 20):
                        fh.write(chunk)
            if sha256(tmp) != spec["sha256"]:
                raise ValueError("SHA-256 não confere")
            tmp.replace(target)
            print(f"[ok] {name} baixado e verificado")
            return True
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            print(f"[aviso] falha em {url.split('/')[2]}: {type(exc).__name__}: {exc}")
    print(f"[erro] não foi possível obter {name}")
    return False


def main() -> int:
    ok = all([ensure(name, spec) for name, spec in MODELS.items()])
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
