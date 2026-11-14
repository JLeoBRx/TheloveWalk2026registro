"""Prepara o álbum durante o deploy: cria as tabelas e gera miniaturas/versões de exibição.

Uso (na pasta fjnight/):
    python -m backend.build            # catálogo + índice facial (se autorizado)
    python -m backend.build --sem-rostos

O índice facial só é gerado se a busca estiver formalmente autorizada
(ver backend/faces.py). Sem autorização, nenhum dado biométrico é criado.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from . import catalog, durable, faces, jobs
from .config import settings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sem-rostos", action="store_true", help="não processa o índice facial")
    args = parser.parse_args()

    print(f"[build] ambiente={settings.app_env} banco={settings.database_kind} "
          f"durável={settings.durable_storage} fotos={settings.storage_backend}", flush=True)
    if settings.production and not settings.durable_storage:
        print("[build] AVISO: sem banco durável (DATABASE_URL). A galeria funciona, mas o painel não "
              "salvará decisões e a busca facial ficará desligada.", flush=True)
    try:
        durable.init()
    except Exception as exc:
        print(f"[build] ERRO: não foi possível acessar o banco ({type(exc).__name__}). "
              "Confira DATABASE_URL (use a URL externa do banco durante o build).", file=sys.stderr)
        return 2

    started = time.time()
    last = [0.0]

    def tick() -> None:
        if time.time() - last[0] > 5:
            last[0] = time.time()
            s = jobs.STATUS
            print(f"[build] {s['phase']}: {s['done']}/{s['total']}", flush=True)

    jobs.on_progress = tick
    result = jobs.run_pipeline(trigger="build", include_faces=not args.sem_rostos)
    cat = result["catalog"]
    if cat["found"] > 0 and cat["processed"] + cat["unchanged"] + cat["renamed"] == 0:
        print("[build] nenhuma foto pôde ser processada", file=sys.stderr)
        return 1
    print(f"[build] concluído em {time.time() - started:.0f}s: {json.dumps(result, ensure_ascii=False)}", flush=True)
    rows, _ = catalog.visible_rows()
    print(f"[build] fotos públicas: {len(rows)} · problemas: {len(catalog.issues())}", flush=True)
    status = faces.authorization_status()
    print(f"[build] busca facial autorizada: {status['authorized']}"
          + ("" if status["authorized"] else f" (pendências: {', '.join(p['code'] for p in status['pending'])})"),
          flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
