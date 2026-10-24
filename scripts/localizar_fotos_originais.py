#!/usr/bin/env python3
"""Match whole-image perceptual hashes to original repo photos, not faces."""
import io, json, math, shutil
from pathlib import Path
import numpy as np
import rawpy
from PIL import Image, ImageOps
from scipy.fftpack import dct

ROOT = Path(__file__).resolve().parents[1]
PHOTO_DIR = ROOT / "colocar as fotos aqui"
REFS_FILE = ROOT / "scripts" / "reference_hashes.json"
DEST = ROOT / "fotosdopastor e a dona"
SUPPORTED = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".cr2", ".arw", ".nef", ".dng"}

def image_from_source(path):
    if path.suffix.lower() not in {".cr2", ".arw", ".nef", ".dng"}:
        with Image.open(path) as im:
            return ImageOps.exif_transpose(im).convert("RGB").copy()
    with rawpy.imread(str(path)) as raw:
        thumb = raw.extract_thumb()
        if thumb.format == rawpy.ThumbFormat.JPEG:
            with Image.open(io.BytesIO(thumb.data)) as im:
                return ImageOps.exif_transpose(im).convert("RGB").copy()
        return Image.fromarray(raw.postprocess(half_size=True, output_bps=8,
                                               no_auto_bright=True, use_camera_wb=True))

def make_hashes(image):
    image = ImageOps.exif_transpose(image).convert("RGB")
    width, height = image.size
    gray = np.asarray(image.convert("L").resize((32, 32), Image.Resampling.LANCZOS), dtype=np.float32)
    transformed = dct(dct(gray, axis=0, norm="ortho"), axis=1, norm="ortho")
    low = transformed[:8, :8].flatten()
    median = np.median(low[1:])
    p_bits = low > median
    p_hash = f"{sum(int(bit) << (63-i) for i, bit in enumerate(p_bits)):016x}"
    small = np.asarray(image.convert("L").resize((9, 8), Image.Resampling.LANCZOS))
    d_bits = (small[:, 1:] > small[:, :-1]).flatten()
    d_hash = f"{sum(int(bit) << (63-i) for i, bit in enumerate(d_bits)):016x}"
    return {"phash": p_hash, "dhash": d_hash, "w": width, "h": height}

def dist(a, b):
    return (int(a, 16) ^ int(b, 16)).bit_count()

def inspect(path):
    try:
        h = make_hashes(image_from_source(path))
        h["path"] = path
        return h
    except Exception as exc:
        print(f"[skip] {path.name}: {type(exc).__name__}: {exc}")
        return None

def score(ref, cand):
    pd = dist(ref["phash"], cand["phash"])
    dd = dist(ref["dhash"], cand["dhash"])
    ref_ratio = ref["w"] / max(1, ref["h"])
    cand_ratio = cand["w"] / max(1, cand["h"])
    aspect_delta = abs(math.log(max(0.001, cand_ratio) / max(0.001, ref_ratio)))
    return pd + 0.28 * dd + 2.5 * min(aspect_delta, 1.5), pd, dd, aspect_delta

def main():
    refs = json.loads(REFS_FILE.read_text(encoding="utf-8"))
    source_files = sorted(p for p in PHOTO_DIR.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED)
    print(f"[match] references={len(refs)} source_files={len(source_files)}")
    candidates = []
    for i, path in enumerate(source_files, 1):
        result = inspect(path)
        if result:
            candidates.append(result)
        if i % 50 == 0 or i == len(source_files):
            print(f"[scan] {i}/{len(source_files)} files examined; usable={len(candidates)}")

    DEST.mkdir(parents=True, exist_ok=True)
    copied, rows = {}, []
    for ref in refs:
        ranked = []
        for cand in candidates:
            value, pd, dd, ad = score(ref, cand)
            ranked.append((value, pd, dd, ad, cand))
        ranked.sort(key=lambda x: (x[0], x[1], x[2]))
        if not ranked:
            rows.append((ref["name"], None, None, None, "sem candidatos"))
            continue
        best_score, best_p, best_d, best_ad, best = ranked[0]
        if best_p > 8 or best_d > 20 or best_ad > 0.48:
            rows.append((ref["name"], None, best_p, best_d, "sem correspondência suficientemente confiável"))
            print(f"[unmatched] {ref['name']}: best pHash={best_p}, dHash={best_d}")
            continue
        group = [x for x in ranked if x[1] <= min(8, best_p + 2)
                 and x[2] <= best_d + 5
                 and x[3] <= max(0.10, best_ad + 0.06)
                 and x[0] <= best_score + 2.0]
        if not group:
            group = [ranked[0]]
        chosen_names = []
        for value, pd, dd, ad, cand in group:
            source = cand["path"]
            destination = DEST / source.name
            if not destination.exists():
                shutil.copy2(source, destination)
            copied[source.as_posix()] = {"phash_distance": pd, "dhash_distance": dd,
                                          "score": round(value, 2), "reference": ref["name"]}
            chosen_names.append(f"{source.name} (pHash {pd}; dHash {dd})")
        rows.append((ref["name"], "; ".join(chosen_names), best_p, best_d, "correspondência encontrada"))
        print(f"[match] {ref['name']} -> {', '.join(x[4]['path'].name for x in group)} (p={best_p}, d={best_d})")

    report = ["# Relatório de correspondência de fotos originais", "",
              f"Referências analisadas: {len(refs)}",
              f"Arquivos originais examinados: {len(source_files)}",
              f"Arquivos originais copiados: {len(copied)}", "",
              "Correspondências calculadas por hashes perceptuais da imagem inteira; não foi usado reconhecimento facial.", "",
              "| Foto de referência | Original encontrado | Distância pHash | Distância dHash | Resultado |",
              "|---|---|---:|---:|---|"]
    for reference, matched, pd, dd, status in rows:
        reference = reference.replace("|", "\\|")
        matched = (matched or "—").replace("|", "\\|")
        report.append(f"| {reference} | {matched} | {pd if pd is not None else '—'} | {dd if dd is not None else '—'} | {status} |")
    (DEST / "RELATORIO_DE_CORRESPONDENCIA.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    matched_refs = sum(1 for row in rows if row[1])
    print(f"[done] copied={len(copied)} references_matched={matched_refs}/{len(refs)}")
    if not copied:
        raise SystemExit("Nenhuma correspondência confiável encontrada; nenhum original foi copiado.")

if __name__ == "__main__":
    main()
