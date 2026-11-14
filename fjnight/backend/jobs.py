"""Sincronização (catálogo + índice facial) em segundo plano, com progresso e histórico."""
from __future__ import annotations

import json
import threading
import time
from typing import Callable

from . import catalog, durable, faces

_lock = threading.Lock()
STATUS: dict = {
    "running": False, "phase": "idle", "done": 0, "total": 0, "errors": 0, "trigger": None,
    "started_at": None, "finished_at": None, "last_result": None, "last_error": None,
}
on_progress: Callable[[], None] | None = None  # usado pelo build para imprimir progresso


def _progress(phase: str):
    def report(done: int, total: int, _item: str) -> None:
        STATUS.update({"phase": phase, "done": done, "total": total})
        if on_progress:
            on_progress()
    return report


def run_pipeline(trigger: str = "manual", include_faces: bool = True) -> dict:
    if not _lock.acquire(blocking=False):
        raise RuntimeError("index_already_running")
    try:
        STATUS.update({"running": True, "phase": "catalog", "done": 0, "total": 0, "errors": 0,
                       "trigger": trigger, "started_at": time.time(), "finished_at": None, "last_error": None})
        result = {"catalog": catalog.index_catalog(_progress("catalog"))}
        STATUS["errors"] = result["catalog"]["errors"]
        if include_faces:
            STATUS.update({"phase": "faces", "done": 0, "total": 0})
            result["faces"] = faces.index_faces(_progress("faces"))
            STATUS["errors"] += int(result["faces"].get("errors", 0))
        STATUS["last_result"] = result
        durable.audit("sync", ok=True, trigger=trigger, **{"catalog": result["catalog"],
                                                             "faces": result.get("faces", {}).get("status")})
        return result
    except Exception as exc:
        STATUS["last_error"] = type(exc).__name__
        durable.audit("sync", ok=False, trigger=trigger, error=type(exc).__name__)
        raise
    finally:
        STATUS.update({"running": False, "phase": "idle", "finished_at": time.time()})
        _lock.release()


def start_background(trigger: str = "manual", include_faces: bool = True) -> bool:
    if STATUS["running"]:
        return False

    def worker() -> None:
        try:
            result = run_pipeline(trigger, include_faces)
            print(f"[sincronizacao] concluída: {json.dumps(result, ensure_ascii=False, default=str)}", flush=True)
        except RuntimeError:
            pass
        except Exception as exc:
            print(f"[sincronizacao] falhou: {type(exc).__name__}: {exc}", flush=True)

    threading.Thread(target=worker, name="fjnight-sync", daemon=True).start()
    return True


def wait_idle(timeout: float = 600) -> None:
    deadline = time.time() + timeout
    while STATUS["running"] and time.time() < deadline:
        time.sleep(0.05)
