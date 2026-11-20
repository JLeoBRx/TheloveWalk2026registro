/*
 * Motor tipográfico: converte texto em curvas (contornos vetoriais) com opentype.js.
 *
 * Por que curvas? É o padrão de fechamento de arquivo para gráfica: o PDF não depende
 * de fontes instaladas, o espaçamento é idêntico ao da prévia e os dourados em degradê
 * podem ser aplicados às letras.
 *
 * Todas as medidas aqui são em milímetros (tamanho de fonte inclusive).
 */
(function () {
  "use strict";
  const P = window.P;
  const FONTS = window.PAPELARIA_FONTS;
  const cache = {};

  const FALLBACK = {
    regular: [],
    italic: ["regular"],
    medium: ["regular"],
    semibold: ["medium", "regular"],
    light: ["regular"],
    mediumItalic: ["italic", "regular"],
  };

  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  function resolve(family, variant) {
    const fam = FONTS.catalog[family] ? family : "cormorant-garamond";
    const v = variant || "regular";
    const tries = [v].concat(FALLBACK[v] || ["regular"]);
    for (const t of tries) if (FONTS.data[`${fam}/${t}`]) return `${fam}/${t}`;
    return `${fam}/${FONTS.catalog[fam].variants[0]}`;
  }

  function font(family, variant) {
    const key = resolve(family, variant);
    if (!cache[key]) cache[key] = opentype.parse(b64ToBuffer(FONTS.data[key]));
    return cache[key];
  }

  function prep(text, sp) {
    let t = String(text == null ? "" : text);
    if (sp.upper) t = t.toLocaleUpperCase("pt-BR");
    return t;
  }

  /* Posiciona os glifos de uma linha (com kerning, ligaduras e espaçamento entre letras). */
  function shape(text, sp) {
    const f = font(sp.font, sp.variant);
    const t = prep(text, sp);
    const size = sp.size;
    const items = [];
    const tracking = sp.tracking || 0;
    const end = f.forEachGlyph(t, 0, 0, size, { kerning: true, letterSpacing: tracking }, (g, x) =>
      items.push({ g, x })
    );
    const width = items.length ? end - tracking * size : 0;
    return { font: f, items, width, size, text: t };
  }

  function width(text, sp) {
    return shape(text, sp).width;
  }

  /* Contorno da linha com a linha de base em y. align: start | middle | end. */
  function line(text, x, y, sp, align) {
    const sh = shape(text, sp);
    let x0 = x;
    if (align === "middle") x0 = x - sh.width / 2;
    else if (align === "end") x0 = x - sh.width;
    const path = new opentype.Path();
    for (const it of sh.items) path.extend(it.g.getPath(x0 + it.x, y, sh.size));
    return { d: path.toPathData(3), width: sh.width, x0, path };
  }

  /* Métricas em mm, positivas: cap = altura das maiúsculas, asc/desc pela fonte. */
  const metricCache = {};
  function metrics(sp) {
    const key = resolve(sp.font, sp.variant);
    if (!metricCache[key]) {
      const f = font(sp.font, sp.variant);
      const os2 = f.tables.os2 || {};
      let cap = os2.sCapHeight;
      if (!cap) {
        const bb = f.charToGlyph("H").getBoundingBox();
        cap = bb.y2;
      }
      let xh = os2.sxHeight;
      if (!xh) xh = f.charToGlyph("x").getBoundingBox().y2;
      metricCache[key] = {
        cap: cap / f.unitsPerEm,
        xh: xh / f.unitsPerEm,
        asc: f.ascender / f.unitsPerEm,
        desc: -f.descender / f.unitsPerEm,
      };
    }
    const m = metricCache[key];
    return { cap: m.cap * sp.size, xh: m.xh * sp.size, asc: m.asc * sp.size, desc: m.desc * sp.size };
  }

  /* Caixa real de tinta (bounding box) de uma linha, relativa à linha de base em y=0. */
  function ink(text, sp) {
    const r = line(text, 0, 0, sp, "start");
    const bb = r.path.getBoundingBox();
    if (!isFinite(bb.x1)) return { x1: 0, y1: 0, x2: 0, y2: 0, width: r.width };
    return { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2, width: r.width };
  }

  /* Quebra de linhas por largura. balance=true equilibra as linhas (texto centralizado). */
  function wrapParagraph(par, sp, maxW) {
    const words = par.split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = cur + " " + words[i];
      if (width(test, sp) <= maxW) cur = test;
      else {
        lines.push(cur);
        cur = words[i];
      }
    }
    lines.push(cur);
    return lines;
  }
  function wrap(text, sp, maxW, balance) {
    const out = [];
    for (const par of String(text || "").split(/\r?\n/)) {
      let lines = wrapParagraph(par, sp, maxW);
      if (balance && lines.length > 1) {
        const n = lines.length;
        let lo = maxW * 0.4, hi = maxW;
        for (let k = 0; k < 14; k++) {
          const mid = (lo + hi) / 2;
          if (wrapParagraph(par, sp, mid).length <= n) hi = mid;
          else lo = mid;
        }
        lines = wrapParagraph(par, sp, hi);
      }
      out.push(...lines);
    }
    return out;
  }

  /*
   * Texto em círculo (anel do selo). Os glifos ficam em pé, lidos no sentido horário,
   * centrados no ângulo `center` (0 = topo). r = raio da linha de base.
   */
  function ring(text, cx, cy, r, sp, center) {
    const sh = shape(text, sp);
    const path = new opentype.Path();
    const c0 = center || 0;
    for (const it of sh.items) {
      const adv = (it.g.advanceWidth || 0) * (sh.size / sh.font.unitsPerEm);
      const s = it.x + adv / 2 - sh.width / 2;
      const phi = c0 + s / r;
      const cos = Math.cos(phi), sin = Math.sin(phi);
      const px = cx + r * sin, py = cy - r * cos;
      const gp = it.g.getPath(-adv / 2, 0, sh.size);
      const tf = (u, v) => [px + u * cos - v * sin, py + u * sin + v * cos];
      for (const cmd of gp.commands) {
        const o = { type: cmd.type };
        if (cmd.x !== undefined) [o.x, o.y] = tf(cmd.x, cmd.y);
        if (cmd.x1 !== undefined) [o.x1, o.y1] = tf(cmd.x1, cmd.y1);
        if (cmd.x2 !== undefined) [o.x2, o.y2] = tf(cmd.x2, cmd.y2);
        path.commands.push(o);
      }
    }
    return { d: path.toPathData(3), span: sh.width / r };
  }

  function families(cats) {
    return Object.entries(FONTS.catalog)
      .filter(([, f]) => !cats || cats.includes(f.cat))
      .map(([id, f]) => ({ id, name: f.name, cat: f.cat }));
  }

  /* Registra as fontes no navegador para a própria interface (botões de escolha de fonte). */
  function registerUiFonts() {
    if (!window.FontFace || !document.fonts) return Promise.resolve();
    const jobs = [];
    for (const [key, b64] of Object.entries(FONTS.data)) {
      const [fam, variant] = key.split("/");
      const name = FONTS.catalog[fam].name;
      const weight = { light: "300", regular: "400", medium: "500", semibold: "600", italic: "400", mediumItalic: "500" }[variant] || "400";
      const style = /italic/i.test(variant) ? "italic" : "normal";
      try {
        const ff = new FontFace(name, b64ToBuffer(b64), { weight, style });
        document.fonts.add(ff);
        jobs.push(ff.load().catch(() => null));
      } catch (e) {
        /* ignora: a interface usa fonte do sistema */
      }
    }
    return Promise.all(jobs);
  }

  P.type = { font, shape, width, line, metrics, ink, wrap, ring, families, registerUiFonts };
  P.pt = (v) => v * P.PT;
})();
