"""Constrói o índice completo (miniaturas + índice facial) durante o deploy.

Uso (na pasta fjnight/):
    python -m backend.build            # catálogo + rostos
    python -m backend.build --sem-rostos
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from . import db, faces, jobs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sem-rostos", action="store_true", help="não gera o índice facial")
    args = parser.parse_args()

    db.init()
    started = time.time()
    last = [0.0]

    def tick() -> None:
        if time.time() - last[0] > 5:
            last[0] = time.time()
            s = jobs.STATUS
            print(f"[build] {s['phase']}: {s['done']}/{s['total']}", flush=True)

    jobs.on_progress = tick
    result = jobs.run_pipeline(include_faces=not args.sem_rostos)
    cat = result["catalog"]
    if cat["found"] > 0 and cat["processed"] + cat["unchanged"] == 0:
        print("[build] nenhuma foto pôde ser processada", file=sys.stderr)
        return 1
    jobs.write_ready_marker(result)
    print(f"[build] concluído em {time.time() - started:.0f}s: {json.dumps(result, ensure_ascii=False)}", flush=True)
    if not args.sem_rostos and result.get("faces", {}).get("status") == "models_unavailable":
        print("[build] AVISO: modelos faciais ausentes — rode `python -m models.download_models`.", flush=True)
    stats = faces.index_stats()
    print(f"[build] índice facial: {stats['photos_indexed']} fotos, {stats['faces_indexed']} rostos", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
