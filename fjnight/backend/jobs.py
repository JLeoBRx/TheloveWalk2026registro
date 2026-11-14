"""Execução da indexação (catálogo + rostos) em segundo plano, com progresso."""
from __future__ import annotations

import json
import threading
import time
from typing import Callable

from . import catalog, faces
from .config import settings

READY_MARKER = settings.data_dir / ".indice-pronto.json"
_lock = threading.Lock()
STATUS: dict = {
    "running": False, "phase": "idle", "done": 0, "total": 0, "errors": 0,
    "started_at": None, "finished_at": None, "last_result": None, "last_error": None,
}


# Gancho opcional (usado pelo build para imprimir o progresso no log)
on_progress: Callable[[], None] | None = None


def _progress(phase: str):
    def report(done: int, total: int, _item: str) -> None:
        STATUS.update({"phase": phase, "done": done, "total": total})
        if on_progress:
            on_progress()
    return report


def run_pipeline(include_faces: bool = True) -> dict:
    """Executa a sincronização completa no thread atual."""
    if not _lock.acquire(blocking=False):
        raise RuntimeError("index_already_running")
    try:
        STATUS.update({"running": True, "phase": "catalog", "done": 0, "total": 0, "errors": 0,
                       "started_at": time.time(), "finished_at": None, "last_error": None})
        result = {"catalog": catalog.index_catalog(_progress("catalog"))}
        STATUS["errors"] = result["catalog"]["errors"]
        if include_faces:
            STATUS.update({"phase": "faces", "done": 0, "total": 0})
            result["faces"] = faces.index_faces(_progress("faces"))
            STATUS["errors"] += int(result["faces"].get("errors", 0))
        STATUS["last_result"] = result
        return result
    except Exception as exc:
        STATUS["last_error"] = type(exc).__name__
        raise
    finally:
        STATUS.update({"running": False, "phase": "idle", "finished_at": time.time()})
        _lock.release()


def start_background(include_faces: bool = True) -> bool:
    if STATUS["running"]:
        return False

    def worker() -> None:
        try:
            result = run_pipeline(include_faces)
            print(f"[indice] concluído: {json.dumps(result, ensure_ascii=False)}", flush=True)
        except RuntimeError:
            pass
        except Exception as exc:
            print(f"[indice] falhou: {type(exc).__name__}: {exc}", flush=True)

    threading.Thread(target=worker, name="fjnight-index", daemon=True).start()
    return True


def write_ready_marker(result: dict) -> None:
    tmp = READY_MARKER.with_suffix(".tmp")
    tmp.write_text(json.dumps({
        "version": 1,
        "built_at": time.time(),
        "source_files": len(catalog.list_source_files()),
        "result": result,
    }, ensure_ascii=False), encoding="utf-8")
    tmp.replace(READY_MARKER)


def prebuilt_index_is_current() -> bool:
    """True quando o build já indexou exatamente os arquivos presentes."""
    try:
        meta = json.loads(READY_MARKER.read_text(encoding="utf-8"))
        return meta.get("version") == 1 and int(meta.get("source_files", -1)) == len(catalog.list_source_files())
    except (OSError, ValueError, json.JSONDecodeError):
        return False
