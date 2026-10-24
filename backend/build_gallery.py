"""Build the complete gallery index and thumbnails as part of the Render deploy artifact."""
import json
import os

from backend.main import DATA_DIR, db, index_photos


def main() -> None:
    result = index_photos()
    with db() as connection:
        indexed_photos = connection.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
    if result["found"] > 0 and indexed_photos == 0:
        raise SystemExit("Gallery build failed: photo files were found but none could be indexed.")
    marker = DATA_DIR / ".gallery-index-ready.json"
    temporary = DATA_DIR / ".gallery-index-ready.json.tmp"
    temporary.write_text(json.dumps({
        "version": 1,
        "source_files": int(result["found"]),
        "indexed_photos": int(indexed_photos),
        "errors": int(result["errors"]),
    }, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, marker)
    print(
        "[gallery-build] ready: "
        f"{indexed_photos} photos, {result['found']} source files, "
        f"{result['errors']} errors",
        flush=True,
    )


if __name__ == "__main__":
    main()
