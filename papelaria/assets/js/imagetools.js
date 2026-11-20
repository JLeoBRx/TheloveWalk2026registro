/*
 * Imagem enviada pelo usuário (logotipo, símbolo, brasão):
 *  1. detecta o fundo pela cor das bordas (ou pela transparência do PNG);
 *  2. remove o fundo com borda suave;
 *  3. no modo "metal", contorna a forma e gera um caminho vetorial liso, que
 *     recebe o dourado e o relevo como os demais símbolos;
 *  4. no modo "cores originais", gera um PNG transparente recortado.
 * Tudo roda no navegador, sem enviar a imagem para nenhum servidor.
 */
(function () {
  "use strict";
  const P = window.P;

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Não foi possível abrir esta imagem. Use PNG, JPG, WEBP ou SVG."));
      img.src = url;
    });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
      fr.readAsDataURL(file);
    });
  }

  function draw(img, maxSide) {
    let w = img.naturalWidth || img.width || 512;
    let h = img.naturalHeight || img.height || 512;
    const k = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    return { canvas, g, w, h };
  }

  /*
   * Normaliza o arquivo enviado: no máximo 900 px no maior lado, guardado como
   * PNG (se tiver transparência) ou JPEG. Esta é a "fonte" que fica no projeto.
   */
  async function ingest(file) {
    if (!file || !/^image\//.test(file.type || "") && !/\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || ""))
      throw new Error("Envie uma imagem PNG, JPG, WEBP ou SVG.");
    if (file.size > 15 * 1024 * 1024) throw new Error("Imagem grande demais (máximo 15 MB).");
    const url = await readFile(file);
    const img = await loadImage(url);
    const { canvas, g, w, h } = draw(img, 900);
    const data = g.getImageData(0, 0, w, h).data;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) transparent++;
    const hasAlpha = transparent > (w * h) / 200;
    const src = hasAlpha ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92);
    return { name: file.name || "imagem", src };
  }

  /* Cor de fundo provável: a mais frequente nas bordas. */
  function borderInfo(data, w, h) {
    const bins = new Map();
    let transparent = 0, total = 0;
    const visit = (x, y) => {
      const i = (y * w + x) * 4;
      total++;
      if (data[i + 3] < 40) {
        transparent++;
        return;
      }
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      let b = bins.get(key);
      if (!b) bins.set(key, (b = { n: 0, r: 0, g: 0, b: 0 }));
      b.n++;
      b.r += data[i];
      b.g += data[i + 1];
      b.b += data[i + 2];
    };
    for (let x = 0; x < w; x++) {
      visit(x, 0);
      visit(x, h - 1);
    }
    for (let y = 1; y < h - 1; y++) {
      visit(0, y);
      visit(w - 1, y);
    }
    let best = null;
    for (const b of bins.values()) if (!best || b.n > best.n) best = b;
    const bg = best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
    return { bg, transparentFrac: transparent / Math.max(1, total) };
  }

  /*
   * Máscara da figura (0 = fundo, 1 = figura), com borda suave.
   * tol (5–95): quanto maior, mais tons parecidos com o fundo são removidos.
   * connected: remove só o fundo ligado às bordas (mantém áreas internas claras).
   */
  function buildMask(data, w, h, tol, connected) {
    const n = w * h;
    const mask = new Float32Array(n);
    const info = borderInfo(data, w, h);
    if (info.transparentFrac > 0.25) {
      for (let p = 0; p < n; p++) mask[p] = data[p * 4 + 3] / 255;
      return { mask, bg: null, alpha: true };
    }
    const [br, bgc, bb] = info.bg;
    const t0 = 8 + tol * 2.1;
    const t1 = t0 + 34;
    const dist = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      const dr = data[i] - br, dg = data[i + 1] - bgc, db = data[i + 2] - bb;
      dist[p] = Math.sqrt(dr * dr + dg * dg + db * db);
    }
    const soft = (d) => P.clamp((d - t0) / (t1 - t0), 0, 1);
    if (!connected) {
      for (let p = 0; p < n; p++) mask[p] = soft(dist[p]) * (data[p * 4 + 3] / 255);
      return { mask, bg: info.bg, alpha: false };
    }
    // preenchimento a partir das bordas: só o fundo conectado sai
    const seen = new Uint8Array(n);
    const stack = [];
    const push = (p) => {
      if (!seen[p] && dist[p] <= t1) {
        seen[p] = 1;
        stack.push(p);
      }
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p / w) | 0;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    for (let p = 0; p < n; p++) mask[p] = (seen[p] ? soft(dist[p]) : 1) * (data[p * 4 + 3] / 255);
    return { mask, bg: info.bg, alpha: false };
  }

  function blur3(mask, w, h) {
    const out = new Float32Array(mask.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) {
              s += mask[yy * w + xx];
              c++;
            }
          }
        out[y * w + x] = s / c;
      }
    return out;
  }

  function bbox(mask, w, h, thr) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (mask[y * w + x] >= thr) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return null;
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /* ---------- contorno vetorial ---------- */

  /* Laços fechados ao redor dos pixels da figura (figura sempre à direita). */
  function loops(mask, w, h, thr) {
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= thr;
    const W1 = w + 1;
    const next = new Map();
    const add = (x1, y1, x2, y2) => {
      const a = y1 * W1 + x1;
      let arr = next.get(a);
      if (!arr) next.set(a, (arr = []));
      arr.push(y2 * W1 + x2);
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) continue;
        if (!inside(x, y - 1)) add(x, y, x + 1, y);
        if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!inside(x - 1, y)) add(x, y + 1, x, y);
      }
    const out = [];
    const xy = (id) => [id % W1, (id / W1) | 0];
    for (const start of Array.from(next.keys())) {
      while (next.has(start)) {
        const loop = [];
        let cur = start, pd = null;
        let guard = 0;
        do {
          const arr = next.get(cur);
          let pick = 0;
          if (arr.length > 1 && pd) {
            const [cx, cy] = xy(cur);
            let best = -2;
            arr.forEach((b, i) => {
              const [bx, by] = xy(b);
              const dx = bx - cx, dy = by - cy;
              const cr = pd[0] * dy - pd[1] * dx; // > 0: vira à direita
              if (cr > best) {
                best = cr;
                pick = i;
              }
            });
          }
          const nb = arr.splice(pick, 1)[0];
          if (!arr.length) next.delete(cur);
          const [cx, cy] = xy(cur), [nx, ny] = xy(nb);
          pd = [nx - cx, ny - cy];
          loop.push([cx, cy]);
          cur = nb;
        } while (cur !== start && next.has(cur) && ++guard < 4e6);
        if (loop.length >= 4) out.push(loop);
      }
    }
    return out;
  }

  function area(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      s += p[0] * q[1] - q[0] * p[1];
    }
    return s / 2;
  }

  /* Ramer–Douglas–Peucker em polígono fechado. */
  function simplify(pts, eps) {
    if (pts.length < 5) return pts;
    const distSeg = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = dx * dx + dy * dy || 1e-9;
      const t = P.clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1);
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    const rdp = (arr) => {
      const keep = new Uint8Array(arr.length);
      keep[0] = keep[arr.length - 1] = 1;
      const stack = [[0, arr.length - 1]];
      while (stack.length) {
        const [i0, i1] = stack.pop();
        let md = 0, mi = -1;
        for (let i = i0 + 1; i < i1; i++) {
          const d = distSeg(arr[i], arr[i0], arr[i1]);
          if (d > md) {
            md = d;
            mi = i;
          }
        }
        if (md > eps && mi > 0) {
          keep[mi] = 1;
          stack.push([i0, mi], [mi, i1]);
        }
      }
      return arr.filter((_, i) => keep[i]);
    };
    // divide no ponto mais distante do primeiro para tratar o laço fechado
    let far = 0, fd = -1;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    const a = rdp(pts.slice(0, far + 1));
    const b = rdp(pts.slice(far).concat([pts[0]]));
    return a.slice(0, -1).concat(b.slice(0, -1));
  }

  /* Caminho liso: cantos agudos ficam vivos, o resto vira curva. */
  function smoothPath(pts, f) {
    const n = pts.length;
    const R = (v) => P.n(v, 2);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const corner = pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const v1 = [p[0] - a[0], p[1] - a[1]], v2 = [b[0] - p[0], b[1] - p[1]];
      const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2 || 1);
      return cos < 0.45 && Math.min(l1, l2) > 2.5; // vira mais que ~63° entre segmentos longos
    });
    const entry = (i) => (corner[i] ? pts[i] : mid(pts[(i - 1 + n) % n], pts[i]));
    const exit = (i) => (corner[i] ? pts[i] : mid(pts[i], pts[(i + 1) % n]));
    const T = (p) => `${R(f(p)[0])} ${R(f(p)[1])}`;
    let d = `M${T(entry(0))}`;
    for (let i = 0; i < n; i++) {
      if (corner[i]) d += `L${T(pts[i])}`;
      else d += `Q${T(pts[i])} ${T(exit(i))}`;
      const e = entry((i + 1) % n), x = exit(i);
      if (Math.hypot(e[0] - x[0], e[1] - x[1]) > 1e-6) d += `L${T(e)}`;
    }
    return d + "Z";
  }

  function vectorize(mask, w, h, crop) {
    const thr = 0.5;
    const ls = loops(mask, w, h, thr);
    const minArea = Math.max(6, crop.w * crop.h * 0.00012);
    let d = "";
    let kept = 0;
    for (const loop of ls) {
      // pontos médios das arestas: diagonais suaves em vez de "escadinha"
      const mids = loop.map((p, i) => {
        const q = loop[(i + 1) % loop.length];
        return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      });
      if (Math.abs(area(mids)) < minArea) continue;
      const simple = simplify(mids, 0.7);
      if (simple.length < 3) continue;
      d += smoothPath(simple, (p) => [p[0] - crop.x0, p[1] - crop.y0]);
      kept++;
    }
    return { d, count: kept };
  }

  /*
   * Processa a fonte guardada no projeto.
   * look: "metal" (vetor dourado) | "original" (PNG transparente)
   */
  async function process(src, look, tol) {
    const img = await loadImage(src);
    const { g, w, h } = draw(img, look === "original" ? 900 : 640);
    const data = g.getImageData(0, 0, w, h).data;
    const t = P.clamp(+tol || 30, 5, 95);
    const res = { look, tol: t };
    if (look === "original") {
      const { mask } = buildMask(data, w, h, t, true);
      const box = bbox(mask, w, h, 0.08);
      if (!box) throw new Error("Não sobrou nada depois de remover o fundo. Diminua a remoção do fundo.");
      const pad = 2;
      const x0 = Math.max(0, box.x0 - pad), y0 = Math.max(0, box.y0 - pad);
      const cw = Math.min(w, box.x1 + pad + 1) - x0, chh = Math.min(h, box.y1 + pad + 1) - y0;
      const out = document.createElement("canvas");
      out.width = cw;
      out.height = chh;
      const og = out.getContext("2d");
      const id = og.createImageData(cw, chh);
      for (let y = 0; y < chh; y++)
        for (let x = 0; x < cw; x++) {
          const si = ((y + y0) * w + (x + x0)) * 4, di = (y * cw + x) * 4;
          id.data[di] = data[si];
          id.data[di + 1] = data[si + 1];
          id.data[di + 2] = data[si + 2];
          id.data[di + 3] = Math.round(mask[(y + y0) * w + (x + x0)] * 255);
        }
      og.putImageData(id, 0, 0);
      res.png = out.toDataURL("image/png");
      res.pw = cw;
      res.ph = chh;
      return res;
    }
    let { mask } = buildMask(data, w, h, t, false);
    mask = blur3(mask, w, h);
    const box = bbox(mask, w, h, 0.5);
    if (!box) throw new Error("Não sobrou nada depois de remover o fundo. Diminua a remoção do fundo.");
    const crop = { x0: box.x0 - 1, y0: box.y0 - 1, w: box.w + 2, h: box.h + 2 };
    const v = vectorize(mask, w, h, crop);
    if (!v.d) throw new Error("Não foi possível contornar a imagem. Tente outra imagem ou ajuste a remoção do fundo.");
    res.d = v.d;
    res.vw = crop.w;
    res.vh = crop.h;
    res.shapes = v.count;
    return res;
  }

  P.imagetools = { ingest, process, loadImage };
})();
