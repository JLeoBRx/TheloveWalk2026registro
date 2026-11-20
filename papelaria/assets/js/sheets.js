/*
 * Folhas de impressão: posiciona envelope e convite no papel, com marcas de corte,
 * marcas de dobra externas, legenda técnica e régua de calibração (escala 100%).
 * Cada folha é um SVG completo em mm, pronto para virar página de PDF.
 */
(function () {
  "use strict";
  const P = window.P;
  const T = () => P.type;

  const INK = "#1F2430";
  const SANS = "montserrat";

  function sans(size, variant, extra) {
    return Object.assign({ font: SANS, variant: variant || "regular", size: P.pt(size) }, extra || {});
  }
  function text(str, x, y, sp, align, color) {
    const r = T().line(str, x, y, sp, align || "start");
    return { svg: `<path d="${r.d}" fill="${color || INK}"/>`, width: r.width };
  }

  /* Régua de calibração: 50 mm com divisões de 1 e 5 mm. */
  function ruler(x, y, len) {
    const L = len || 50;
    let d = `M${P.n(x)} ${P.n(y)}H${P.n(x + L)}`;
    for (let i = 0; i <= L; i++) {
      const h = i % 10 === 0 ? 3 : i % 5 === 0 ? 2 : 1.1;
      d += `M${P.n(x + i)} ${P.n(y)}V${P.n(y - h)}`;
    }
    let s = `<path d="${d}" stroke="${INK}" stroke-width="0.15" fill="none"/>`;
    s += text("0", x, y + 2.6, sans(5), "middle").svg;
    s += text(`${L} mm`, x + L, y + 2.6, sans(5), "middle").svg;
    s += text("escala 100% — meça com uma régua", x + L / 2, y + 2.6, sans(4.6, "light"), "middle", "#4B5563").svg;
    return s;
  }

  function cropMark(x1, y1, x2, y2) {
    return `M${P.n(x1)} ${P.n(y1)}L${P.n(x2)} ${P.n(y2)}`;
  }

  function fitPaper(candidates, needW, needH, needHLegend, margin) {
    for (const key of candidates) {
      const p = P.PAPERS[key];
      for (const [pw, ph] of [[p.w, p.h], [p.h, p.w]]) {
        if (needW + 2 * margin <= pw && needHLegend + 2 * margin <= ph) return { key, pw, ph, legend: true };
      }
    }
    for (const key of candidates) {
      const p = P.PAPERS[key];
      for (const [pw, ph] of [[p.w, p.h], [p.h, p.w]]) {
        if (needW + 2 * margin <= pw && needH + 2 * margin <= ph) return { key, pw, ph, legend: false };
      }
    }
    return null;
  }

  /* ---------------- ENVELOPE ---------------- */
  function envelopeSheet(state, mode, overrides) {
    const pr = Object.assign({}, state.print, overrides || {});
    const bleed = mode === "dieline" ? 0 : +pr.bleed || 0;
    const geo = P.envelope.geometry(state, pr.bleedArt === false ? 0 : bleed);
    const bb = mode === "dieline" ? geo.bbox : geo.bleedBox;
    // marcas de dobra: as verticais ficam acima/abaixo do molde; as horizontais ficam
    // nos recortes entre as abas (área descartada), sem exigir margem lateral extra
    const marksPad = pr.marks ? 8 : 0;
    const contentW = bb.w;
    const contentH = bb.h + 2 * marksPad;
    const legendH = pr.legend ? 19 : 0;
    const margin = +pr.minMargin || 5;
    let pw, ph, paperKey, legend = !!pr.legend;

    if (pr.envPaper === "fit") {
      pw = contentW + 2 * 10;
      ph = contentH + 2 * 10 + legendH;
      paperKey = "fit";
    } else {
      const cands = pr.envPaper === "auto" ? P.PAPER_ORDER : [pr.envPaper];
      const f = fitPaper(cands, contentW, contentH, contentH + legendH, margin);
      if (!f) {
        // sem marcas externas?
        const f2 = fitPaper(cands, bb.w, bb.h, bb.h, margin);
        if (!f2) {
          return { error: `O molde aberto (${P.mmLabel(bb.w)} × ${P.mmLabel(bb.h)} mm com sangria) não cabe em ${pr.envPaper === "auto" ? "nenhum papel da lista" : P.PAPERS[pr.envPaper].label}.`, geo };
        }
        return envelopeSheet(state, mode, Object.assign({}, overrides, { marks: false, legend: false, envPaper: f2.key, _forced: true }));
      }
      pw = f.pw; ph = f.ph; paperKey = f.key; legend = legend && f.legend;
    }

    const blockH = contentH + (legend ? legendH : 0);
    const top = Math.max(margin, (ph - blockH) / 2);
    const ox = (pw - contentW) / 2 - bb.x;
    const oy = top + marksPad - bb.y;

    const ctx = new P.Ctx(state, mode, "env");
    let body = "";
    if (mode === "art" || mode === "dieline" || mode === "foil") {
      body += `<g transform="translate(${P.n(ox)} ${P.n(oy)})">`;
      body += P.envelope.render(ctx, geo, {
        cut: mode === "dieline" ? true : mode === "foil" ? false : pr.cutLines,
        fold: mode === "dieline" ? true : mode === "foil" ? false : pr.foldLines,
        glue: mode === "dieline" ? true : mode === "foil" ? false : pr.glue,
        safe: mode === "art" ? pr.safe : false,
        cutColor: pr.cutColor,
      });
      // marcas externas de dobra (prolongamento das linhas de vinco, fora da arte)
      if (pr.marks) {
        const { W, H, s, a } = geo;
        const b = mode === "dieline" ? 0 : geo.bleed;
        const f = a / Math.hypot(s, a);
        const start = Math.max((b + 0.9) / f, b + 1.2);
        const len = Math.min(5, s + b - start - 0.5);
        let d = "";
        if (len > 1.5)
          for (const y of [0, H]) d += cropMark(-start, y, -start - len, y) + cropMark(W + start, y, W + start + len, y);
        for (const x of [0, W]) d += cropMark(x, bb.y - 2, x, bb.y - 7) + cropMark(x, bb.y1 + 2, x, bb.y1 + 7);
        body += `<path d="${d}" stroke="#000000" stroke-width="0.2" stroke-dasharray="1.2 0.8" fill="none"/>`;
      }
      body += `</g>`;
    }

    if (legend) {
      const lx = Math.max(margin, (pw - Math.max(contentW, 200)) / 2) + 2;
      const lw = pw - 2 * lx;
      const ly = top + contentH + 4;
      body += legendBlock(state, geo, { x: lx, y: ly, w: lw, mode, paperKey, pw, ph, bleed, bb });
    }

    return {
      w: pw,
      h: ph,
      paperKey,
      geo,
      legend,
      forced: !!(overrides && overrides._forced),
      svg: P.svgDoc(pw, ph, `<rect width="${P.n(pw)}" height="${P.n(ph)}" fill="#FFFFFF"/>` + body, ctx),
    };
  }

  function legendBlock(state, geo, o) {
    const { x, y, w, mode, paperKey } = o;
    const paper = paperKey === "fit" ? `folha ${P.mmLabel(o.pw)} × ${P.mmLabel(o.ph)} mm` : P.PAPERS[paperKey].label.split(" — ")[0];
    const title =
      mode === "dieline" ? "FACA DO ENVELOPE — SOMENTE LINHAS" : mode === "foil" ? "HOT STAMPING — ENVELOPE (PRETO 100% = DOURADO)" : "ENVELOPE PLANIFICADO";
    let s = `<path d="M${P.n(x)} ${P.n(y)}H${P.n(x + w)}" stroke="#C9CDD4" stroke-width="0.15"/>`;
    s += text(`${title} · ${P.mmLabel(geo.W)} × ${P.mmLabel(geo.H)} mm (fechado)`, x, y + 4.2, sans(7, "semibold", { tracking: 0.06 })).svg;
    s += text(
      `Molde aberto ${P.mmLabel(geo.bbox.w)} × ${P.mmLabel(geo.bbox.h)} mm · ${paper} · sangria ${P.mmLabel(o.bleed)} mm · imprimir em TAMANHO REAL (100%), sem “ajustar à página”`,
      x, y + 8, sans(5.6, "regular")
    ).svg;
    // amostras
    const ly = y + 13.5;
    let cx = x;
    const sample = (label, draw) => {
      s += draw(cx, ly);
      s += text(label, cx + 9, ly + 1, sans(5.6)).svg;
      cx += 9 + T().width(label, sans(5.6)) + 7;
    };
    sample("Corte (linha contínua)", (sx, sy) => `<path d="M${P.n(sx)} ${P.n(sy)}h7" stroke="#000" stroke-width="0.3"/>`);
    sample("Dobra / vinco (tracejada)", (sx, sy) => `<path d="M${P.n(sx)} ${P.n(sy)}h7" stroke="#000" stroke-width="0.25" stroke-dasharray="2.4 1.6"/>`);
    sample("Área de cola (fica oculta)", (sx, sy) => {
      const poly = [[sx, sy - 1.8], [sx + 7, sy - 1.8], [sx + 7, sy + 1.8], [sx, sy + 1.8]];
      const segs = P.geo.hatch(poly, 1.2, -45);
      return `<path d="${P.geo.d(poly)}" fill="#F1F3F6" stroke="#6B7280" stroke-width="0.15" stroke-dasharray="1 0.8"/>` +
        `<path d="${segs.map(([p, q]) => `M${P.n(p[0])} ${P.n(p[1])}L${P.n(q[0])} ${P.n(q[1])}`).join("")}" stroke="#9AA3AF" stroke-width="0.12"/>`;
    });
    sample("Marca externa de dobra", (sx, sy) => `<path d="M${P.n(sx)} ${P.n(sy)}h5" stroke="#000" stroke-width="0.2" stroke-dasharray="1.2 0.8"/>`);
    const rx = x + w - 52;
    if (rx > cx - 2) s += ruler(rx, ly + 1.2, 50);
    else s += ruler(x, ly + 7, 50);
    return s;
  }

  /* ---------------- CONVITE ---------------- */
  function cardArt(state, mode, bleed, guides) {
    const ctx = new P.Ctx(state, mode, "card");
    const r = P.card.render(ctx, { bleed, guides });
    return { ctx, svg: r.svg, overflow: r.overflow, scale: r.scale };
  }

  function cardSheet(state, mode, overrides) {
    const pr = Object.assign({}, state.print, overrides || {});
    const cw = +state.card.width, ch = +state.card.height;
    const margin = +pr.minMargin || 5;
    let b = +pr.bleed || 0;

    if (pr.cardPaper === "exact") {
      const art = cardArt(state, mode, 0, false);
      const clipId = art.ctx.uid("pg");
      art.ctx.def(`<clipPath id="${clipId}"><rect width="${P.n(cw)}" height="${P.n(ch)}"/></clipPath>`);
      return {
        w: cw, h: ch, paperKey: "exact", count: 1, overflow: art.overflow,
        trims: [{ x: 0, y: 0, w: cw, h: ch }], bleed: 0,
        svg: P.svgDoc(cw, ch, `<rect width="${P.n(cw)}" height="${P.n(ch)}" fill="#FFFFFF"/><g clip-path="url(#${clipId})">${art.svg}</g>`, art.ctx),
      };
    }

    const markOff = b + 1.5, markLen = 5;
    const zone = markOff + markLen + 1;
    let layout;
    if (pr.cardPaper === "fit") {
      const slug = 10;
      layout = { pw: cw + 2 * (b + slug), ph: ch + 2 * (b + slug), cols: 1, rows: 1, rot: false, gx: 0, gy: 0, ox: b + slug, oy: b + slug, key: "fit" };
    } else {
      const p = P.PAPERS[pr.cardPaper] || P.PAPERS.A4;
      const g = Math.max(6, 2 * b + 4);
      let best = null;
      for (const [pw, ph] of [[p.w, p.h], [p.h, p.w]]) {
        for (const rot of [false, true]) {
          const w = rot ? ch : cw, h = rot ? cw : ch;
          const availW = pw - 2 * margin - 2 * zone, availH = ph - 2 * margin - 2 * zone - 6;
          let cols = Math.floor((availW + g) / (w + g)), rows = Math.floor((availH + g) / (h + g));
          if (cols < 1 || rows < 1) continue;
          if (pr.cardUp === "one") cols = rows = 1;
          const n = cols * rows;
          if (!best || n > best.n || (n === best.n && !rot && best.rot)) best = { pw, ph, cols, rows, rot, n, w, h, g };
        }
      }
      if (!best) return { error: `O convite (${cw} × ${ch} mm) com sangria e marcas não cabe em ${p.label}.` };
      const gridW = best.cols * best.w + (best.cols - 1) * best.g;
      const gridH = best.rows * best.h + (best.rows - 1) * best.g;
      layout = {
        pw: best.pw, ph: best.ph, cols: best.cols, rows: best.rows, rot: best.rot, gx: best.g, gy: best.g,
        ox: (best.pw - gridW) / 2, oy: Math.max(margin + zone, (best.ph - gridH - 6) / 2), key: pr.cardPaper,
      };
    }

    const art = cardArt(state, mode, b, false);
    const w = layout.rot ? ch : cw, h = layout.rot ? cw : ch;
    let body = `<rect width="${P.n(layout.pw)}" height="${P.n(layout.ph)}" fill="#FFFFFF"/>`;
    const trims = [];
    const sym = art.ctx.uid("card");
    // um único desenho reaproveitado em cada posição
    art.ctx.def(`<g id="${sym}">${art.svg}</g>`);
    // recorte da sangria de cada cópia (evita invadir a vizinha)
    const clipId = art.ctx.uid("bl");
    art.ctx.def(`<clipPath id="${clipId}"><rect x="${P.n(-b)}" y="${P.n(-b)}" width="${P.n(cw + 2 * b)}" height="${P.n(ch + 2 * b)}"/></clipPath>`);
    for (let r = 0; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const x = layout.ox + c * (w + layout.gx), y = layout.oy + r * (h + layout.gy);
        trims.push({ x, y, w, h });
        const tf = layout.rot ? `translate(${P.n(x + w)} ${P.n(y)}) rotate(90)` : `translate(${P.n(x)} ${P.n(y)})`;
        body += `<g transform="${tf}"><g clip-path="url(#${clipId})"><use href="#${sym}"/></g></g>`;
      }
    }
    // marcas de corte (fora da sangria), nas bordas da grade
    let d = "";
    const gx0 = layout.ox, gy0 = layout.oy;
    const gx1 = layout.ox + layout.cols * w + (layout.cols - 1) * layout.gx;
    const gy1 = layout.oy + layout.rows * h + (layout.rows - 1) * layout.gy;
    const xs = [], ys = [];
    for (let c = 0; c < layout.cols; c++) xs.push(gx0 + c * (w + layout.gx), gx0 + c * (w + layout.gx) + w);
    for (let r = 0; r < layout.rows; r++) ys.push(gy0 + r * (h + layout.gy), gy0 + r * (h + layout.gy) + h);
    for (const x of xs) d += cropMark(x, gy0 - markOff, x, gy0 - markOff - markLen) + cropMark(x, gy1 + markOff, x, gy1 + markOff + markLen);
    for (const y of ys) d += cropMark(gx0 - markOff, y, gx0 - markOff - markLen, y) + cropMark(gx1 + markOff, y, gx1 + markOff + markLen, y);
    body += `<path d="${d}" stroke="#000000" stroke-width="0.2" fill="none"/>`;

    // informação técnica discreta na margem
    const label =
      (mode === "foil" ? "HOT STAMPING — CONVITE (preto 100% = dourado) · " : "") +
      `Convite ${P.mmLabel(cw)} × ${P.mmLabel(ch)} mm · sangria ${P.mmLabel(b)} mm · ${layout.cols * layout.rows} por folha · imprimir em tamanho real (100%)`;
    const sp = sans(layout.key === "fit" ? 4.6 : 5.4);
    const lw = T().width(label, sp);
    const ly = Math.min(layout.ph - 2.5, gy1 + markOff + markLen + (layout.key === "fit" ? 1.4 : 4));
    if (lw < layout.pw - 2 * (layout.key === "fit" ? b + 8 : margin)) body += text(label, layout.pw / 2, ly, sp, "middle", "#4B5563").svg;
    if (layout.key !== "fit" && ly + 10 < layout.ph - margin) body += ruler(layout.pw - margin - 54, ly - 1.2, 50);

    return {
      w: layout.pw, h: layout.ph, paperKey: layout.key, count: layout.cols * layout.rows, overflow: art.overflow,
      trims, bleed: b,
      svg: P.svgDoc(layout.pw, layout.ph, body, art.ctx),
    };
  }

  /* ---------------- FICHA TÉCNICA ---------------- */
  function ficha(state, envSheet, crdSheet) {
    const pw = 210, ph = 297, m = 18;
    const ctx = new P.Ctx(state, "art", "fic");
    const c = state.colors;
    const geo = P.envelope.geometry(state, 0);
    let s = `<rect width="${pw}" height="${ph}" fill="#FFFFFF"/>`;
    let y = m + 8;
    const serif = (size, variant) => ({ font: "cormorant-garamond", variant: variant || "semibold", size: P.pt(size) });
    s += text("Ficha técnica e montagem", m, y, serif(22), "start", c.navy).svg;
    y += 6.5;
    s += text(`${String(state.text.title || "").replace(/\n/g, " ")} — envelope planificado e convite`, m, y, sans(8, "light"), "start", "#4B5563").svg;
    y += 4;
    s += `<path d="M${m} ${P.n(y)}H${pw - m}" stroke="${c.gold}" stroke-width="0.35"/>`;
    y += 8;

    const env = envSheet && !envSheet.error ? envSheet : null;
    const crd = crdSheet && !crdSheet.error ? crdSheet : null;
    const specs = [
      ["Envelope fechado", `${P.mmLabel(geo.W)} × ${P.mmLabel(geo.H)} mm`],
      ["Molde aberto (faca)", `${P.mmLabel(geo.bbox.w)} × ${P.mmLabel(geo.bbox.h)} mm`],
      ["Papel do envelope", env ? (env.paperKey === "fit" ? `folha ${P.mmLabel(env.w)} × ${P.mmLabel(env.h)} mm` : P.PAPERS[env.paperKey].label) : "—"],
      ["Convite", `${P.mmLabel(+state.card.width)} × ${P.mmLabel(+state.card.height)} mm`],
      ["Folha do convite", crd ? (crd.paperKey === "fit" ? `${P.mmLabel(crd.w)} × ${P.mmLabel(crd.h)} mm (com marcas)` : crd.paperKey === "exact" ? "tamanho final, sem sangria" : `${P.PAPERS[crd.paperKey].label} · ${crd.count} por folha`) : "—"],
      ["Folga convite × envelope", `${P.mmLabel((geo.W - Math.max(+state.card.width, +state.card.height)) / 2)} mm por lado (largura) · ${P.mmLabel((geo.H - Math.min(+state.card.width, +state.card.height)) / 2)} mm (altura)`],
      ["Abas", `superior ${P.mmLabel(geo.depth)} mm · inferior ${P.mmLabel(geo.hb)} mm · laterais ${P.mmLabel(geo.s)} mm`],
      ["Sangria", `${P.mmLabel(+state.print.bleed)} mm em todas as bordas externas`],
    ];
    for (const [k, v] of specs) {
      s += text(k.toUpperCase(), m, y, sans(6, "semibold", { tracking: 0.08 }), "start", "#6B7280").svg;
      s += text(v, m + 52, y, sans(8), "start", INK).svg;
      y += 5.6;
    }
    y += 4;

    const section = (title) => {
      s += text(title, m, y, serif(13), "start", c.navy).svg;
      y += 5.5;
    };
    const para = (str, indent) => {
      const sp = sans(8, "regular");
      const lines = T().wrap(str, sp, pw - 2 * m - (indent || 0), false);
      for (const ln of lines) {
        s += text(ln, m + (indent || 0), y, sp).svg;
        y += 4.1;
      }
      y += 1.2;
    };

    section("Impressão");
    para("Imprima sempre em TAMANHO REAL (escala 100%). Na janela de impressão, desative “Ajustar à página” / “Reduzir para caber”. Confira com uma régua a barra de 50 mm impressa na legenda de cada folha.");
    para("Envelope: papel de 120 a 180 g/m² (offset, color plus ou perolado). Convite: 250 a 300 g/m² (couché fosco, perolado ou algodão). Ative “gráficos de fundo” se o programa pedir. Impressoras domésticas não imprimem até a borda: por isso o molde fica centralizado com margem e a arte tem sangria — ela é cortada fora.");
    if (state.print.foil) para("Dourado metálico real: use as páginas de HOT STAMPING deste PDF (preto 100% = área do filme dourado). Elas estão na mesma posição das artes para registro. Peça à gráfica para não imprimir o dourado simulado nas áreas com filme, se for o caso.");
    y += 1;

    section("Montagem passo a passo");
    const steps = [
      "Corte o molde pela linha contínua (estilete e régua nas retas, tesoura nas curvas). Use as marcas externas para alinhar a régua nas dobras.",
      "Vinque as linhas tracejadas com uma dobradeira (ou caneta sem tinta) e dobre todas as abas para o verso, o lado sem impressão.",
      "Dobre as duas abas laterais para dentro. Aplique cola em bastão ou fita dupla face somente nas áreas hachuradas “COLA”.",
      "Dobre a aba inferior por cima das laterais e pressione. Insira o convite deitado, com a frente voltada para a frente do envelope.",
      "Feche a aba superior: o selo dourado fica de pé no verso. Para lacrar, use um ponto de fita dupla face sob a ponta da aba ou um adesivo transparente.",
    ];
    // diagramas
    const dw = (pw - 2 * m - 3 * 6) / 4;
    const dh = 38;
    const dy = y;
    const diag = diagrams(ctx, geo, dw, dh);
    diag.forEach((d, i) => {
      const dx = m + i * (dw + 6);
      s += `<g transform="translate(${P.n(dx)} ${P.n(dy)})">${d}</g>`;
      s += text(String(i + 1), dx + 1, dy + 4, serif(12, "semibold"), "start", c.gold).svg;
    });
    y += dh + 7;
    steps.forEach((st, i) => {
      s += text(`${i + 1}.`, m, y, sans(8, "semibold"), "start", c.navy).svg;
      para(st, 6);
    });
    y += 2;
    section("Conferência antes de produzir");
    para("Imprima primeiro uma folha de prova em papel comum, monte o envelope e verifique se o convite entra com folga. Confira textos, data, horário e endereço. Faça os cortes com a folha bem apoiada e lâmina nova.");

    s += ruler(pw - m - 50, ph - m + 2, 50);
    s += text("Editor de Papelaria — arquivo vetorial em mm, textos convertidos em curvas", m, ph - m + 4.6, sans(5.4, "light"), "start", "#6B7280").svg;
    return { w: pw, h: ph, svg: P.svgDoc(pw, ph, s, ctx) };
  }

  /* Pequenos desenhos da montagem (verso do envelope visto de trás). */
  function diagrams(ctx, geo, dw, dh) {
    const c = ctx.state.colors;
    const { W, H } = geo;
    const flat = geo.bbox;
    const navy = c.navy, light = "#E9EEF7", glue = "#F6E6B8";
    let sw = 0.25;
    const out = [];
    const fit = (bw, bh) => Math.min((dw - 4) / bw, (dh - 6) / bh);
    const wrap = (inner, k, bx, by, bw, bh) =>
      `<rect x="0" y="0" width="${P.n(dw)}" height="${P.n(dh)}" rx="2" fill="#F7F8FB"/>` +
      `<g transform="translate(${P.n((dw - bw * k) / 2 - bx * k)} ${P.n((dh - bh * k) / 2 - by * k + 1)}) scale(${P.n(k, 5)})">${inner}</g>`;
    const poly = (p, fill, extra) =>
      `<path d="${P.geo.d(p)}" fill="${fill}" stroke="${navy}" stroke-width="${P.n(sw, 4)}" stroke-linejoin="round" ${extra || ""}/>`;
    const setK = (kk) => {
      sw = 0.22 / kk;
      return kk;
    };
    const fl = geo.flaps;
    const body = [[0, 0], [W, 0], [W, H], [0, H]];

    // 1: molde aberto, verso para cima
    let k = setK(fit(flat.w, flat.h));
    out.push(wrap(poly(geo.outline, light) + geo.glue.map((g) => poly(g, glue)).join(""), k, flat.x, flat.y, flat.w, flat.h));

    // 2: laterais dobradas (vista do verso: espelhada)
    const mirror = (pts) => P.geo.map(pts, (x, y) => [W - x, y]);
    const leftF = mirror(P.geo.map(fl.left, (x, y) => [-x, y]));
    const rightF = mirror(P.geo.map(fl.right, (x, y) => [2 * W - x, y]));
    const topOpen = mirror(fl.top), bottomOpen = mirror(fl.bottom);
    const glueF = geo.glue.map((g, i) => mirror(P.geo.map(g, i === 0 ? (x, y) => [-x, y] : (x, y) => [2 * W - x, y])));
    const bb2 = P.geo.bbox([body, topOpen, bottomOpen]);
    k = setK(fit(bb2.w, bb2.h));
    out.push(wrap(poly(topOpen, "#FFFFFF") + poly(bottomOpen, "#FFFFFF") + poly(body, "#FFFFFF") + poly(leftF, light) + poly(rightF, light) + glueF.map((g) => poly(g, glue)).join(""), k, bb2.x, bb2.y, bb2.w, bb2.h));

    // 3: inferior dobrada + convite
    const bottomF = mirror(P.geo.map(fl.bottom, (x, y) => [x, 2 * H - y]));
    const cw = Math.max(+ctx.state.card.width, +ctx.state.card.height), chh = Math.min(+ctx.state.card.width, +ctx.state.card.height);
    const cardR = [[(W - cw) / 2, -chh * 0.45], [(W + cw) / 2, -chh * 0.45], [(W + cw) / 2, chh * 0.55], [(W - cw) / 2, chh * 0.55]];
    const bb3 = P.geo.bbox([body, topOpen, cardR]);
    k = setK(fit(bb3.w, bb3.h));
    out.push(wrap(poly(topOpen, "#FFFFFF") + poly(cardR, "#FFFDF7", `stroke-dasharray="${P.n(1.5 / k)} ${P.n(1 / k)}"`) + poly(body, "#FFFFFF") + poly(leftF, light) + poly(rightF, light) + poly(bottomF, light), k, bb3.x, bb3.y, bb3.w, bb3.h));

    // 4: fechado com selo
    const topF = mirror(P.geo.map(fl.top, (x, y) => [x, -y]));
    k = setK(fit(W, H));
    const sx = W / 2, sy = -geo.seal.y;
    out.push(
      wrap(
        poly(body, "#FFFFFF") + poly(leftF, light) + poly(rightF, light) + poly(bottomF, light) + poly(topF, "#DCE4F2") +
          `<circle cx="${P.n(sx)}" cy="${P.n(sy)}" r="${P.n(geo.seal.r)}" fill="${c.gold}"/>`,
        k, 0, 0, W, H
      )
    );
    return out;
  }

  P.sheets = { envelopeSheet, cardSheet, ficha, ruler };
})();
