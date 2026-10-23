"""Baixa modelos YuNet e SFace do OpenCV Zoo.
Os pesos não são incluídos no Git; confira as licenças antes de implantar.
"""
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent
MODELS = {
    "face_detection_yunet_2023mar.onnx": [
        "https://huggingface.co/opencv/opencv_zoo/resolve/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    ],
    "face_recognition_sface_2021dec.onnx": [
        "https://huggingface.co/opencv/opencv_zoo/resolve/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    ],
}

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    for name, urls in MODELS.items():
        target = ROOT / name
        if target.exists() and target.stat().st_size > 100_000:
            print(f"[ok] {name} já existe ({target.stat().st_size:,} bytes)")
            continue
        error = None
        for url in urls:
            temp = target.with_suffix(target.suffix + ".part")
            try:
                print(f"[download] {name} de {url.split('/')[2]}")
                with requests.get(url, stream=True, timeout=(20, 180), allow_redirects=True) as response:
                    response.raise_for_status()
                    total = 0
                    with temp.open("wb") as f:
                        for block in response.iter_content(1024 * 1024):
                            if block:
                                f.write(block)
                                total += len(block)
                if total < 100_000:
                    raise RuntimeError(f"Arquivo muito pequeno ({total} bytes), possível ponteiro Git LFS")
                temp.replace(target)
                print(f"[ok] {name}: {total:,} bytes")
                error = None
                break
            except Exception as exc:
                error = exc
                temp.unlink(missing_ok=True)
                print(f"[aviso] fonte indisponível: {type(exc).__name__}")
        if error:
            raise RuntimeError(f"Não foi possível baixar {name}. Tente novamente com acesso à internet.") from error
    print("Modelos baixados. Leia as licenças dos pesos antes do uso público.")
if __name__ == "__main__":
    main()
