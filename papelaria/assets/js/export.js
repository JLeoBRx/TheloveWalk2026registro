/*
 * Cena "montada" (envelope fechado, aberto com forro, frente e convite) e
 * exportação de imagens PNG em alta resolução, para enviar por WhatsApp ou
 * apresentar a clientes.
 */
(function () {
  "use strict";
  const P = window.P;

  function label(txt, x, y, color) {
    const sp = { font: "montserrat", variant: "semibold", size: 3.4, tracking: 0.22, upper: true };
    return `<path d="${P.type.line(txt, x, y, sp, "middle").d}" fill="${color || "#5B6475"}"/>`;
  }

  /*
   * Monta a cena. layout: "row" (uma linha) | "grid" (2 × 2).
   * opts.background: cor de fundo (para imagens); sem ela, fundo transparente.
   */
  function mockup(state, layout, opts) {
    const o = opts || {};
    const ctx = new P.Ctx(state, "art", "mk");
    const geo = P.envelope.geometry(state, 0);
    const mk = P.envelope.mockup(ctx, geo);
    const cw = +state.card.width, ch = +state.card.height;
    const cr = P.card.render(ctx, { bleed: 0 });
    const cclip = ctx.uid("cc");
    ctx.def(`<clipPath id="${cclip}"><rect width="${P.n(cw)}" height="${P.n(ch)}"/></clipPath>`);
    const sh = ctx.uid("ms");
    ctx.def(
      `<filter id="${sh}" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="2.2" stdDeviation="3" flood-color="#0b1633" flood-opacity="0.32"/></filter>`
    );
    const { W, H } = geo;
    const D = geo.depth;
    const m = 14, gap = 20, lab = 12;
    const pieces = {
      back: { w: W, h: H, svg: mk.back, label: "Verso · fechado com o selo" },
      open: { w: W, h: H + D, oy: D, svg: mk.open, label: state.print.liner ? "Aberto · com forro" : "Aberto" },
      front: { w: W, h: H, svg: mk.front, label: "Frente do envelope" },
      card: { w: cw, h: ch, svg: `<g clip-path="url(#${cclip})">${cr.svg}</g>`, label: "Convite" },
    };
    let w, h;
    const place = [];
    if (layout === "row") {
      const order = ["back", "open", "card", "front"];
      const rowH = Math.max(...order.map((k) => pieces[k].h));
      let x = m;
      for (const k of order) {
        place.push([k, x, m + (rowH - pieces[k].h) / 2, m + rowH + 8]);
        x += pieces[k].w + gap;
      }
      w = x - gap + m;
      h = m + rowH + lab + m;
    } else {
      const c1 = W, c2 = Math.max(W, cw);
      const r1 = H, r2 = Math.max(H + D, ch);
      w = m + c1 + gap + c2 + m;
      h = m + r1 + lab + gap + r2 + lab + m;
      const y2 = m + r1 + lab + gap;
      place.push(["back", m, m, m + r1 + 8]);
      place.push(["front", m + c1 + gap + (c2 - W) / 2, m, m + r1 + 8]);
      place.push(["open", m, y2 + (r2 - (H + D)) / 2, y2 + r2 + 8]);
      place.push(["card", m + c1 + gap + (c2 - cw) / 2, y2 + (r2 - ch) / 2, y2 + r2 + 8]);
    }
    let body = "";
    if (o.background) {
      const bg = ctx.linear([[0, P.color.lighten(o.background, 0.35)], [1, o.background]], 0, 0, w * 0.4, h);
      body += `<rect width="${P.n(w)}" height="${P.n(h)}" fill="${bg}"/>`;
    }
    for (const [k, x, y, ly] of place) {
      const pc = pieces[k];
      body += `<g transform="translate(${P.n(x)} ${P.n(y + (pc.oy || 0))})"><g filter="url(#${sh})">${pc.svg}</g></g>`;
      if (o.labels !== false) body += label(pc.label, x + pc.w / 2, ly, o.labelColor);
    }
    return { w, h, svg: P.svgDoc(w, h, body, ctx) };
  }

  function sized(svg, wPx, hPx) {
    return svg.replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${wPx}" height="${hPx}"`);
  }

  /* Desenha um SVG num canvas e devolve um PNG (Blob). */
  function svgToPng(svg, wPx, hPx, background) {
    const blob = new Blob([sized(svg, wPx, hPx)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = wPx;
          canvas.height = hPx;
          const g = canvas.getContext("2d");
          if (background) {
            g.fillStyle = background;
            g.fillRect(0, 0, wPx, hPx);
          }
          g.drawImage(img, 0, 0, wPx, hPx);
          URL.revokeObjectURL(url);
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar a imagem."))), "image/png");
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Não foi possível desenhar a imagem."));
      };
      img.src = url;
    });
  }

  function slug(state) {
    return (
      String(state.text.title || "papelaria")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/&/g, "e")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .slice(0, 40) || "papelaria"
    );
  }

  /* Convite em PNG (300 dpi por padrão: 15 × 21 cm = 1772 × 2480 px). */
  async function cardPng(state, dpi) {
    const ctx = new P.Ctx(state, "art", "png");
    const cw = +state.card.width, ch = +state.card.height;
    const r = P.card.render(ctx, { bleed: 0 });
    const clip = ctx.uid("cl");
    ctx.def(`<clipPath id="${clip}"><rect width="${P.n(cw)}" height="${P.n(ch)}"/></clipPath>`);
    const svg = P.svgDoc(cw, ch, `<g clip-path="url(#${clip})">${r.svg}</g>`, ctx);
    const k = (dpi || 300) / 25.4;
    const blob = await svgToPng(svg, Math.round(cw * k), Math.round(ch * k), "#FFFFFF");
    return { blob, filename: `${slug(state)}_convite.png` };
  }

  /* Imagem de apresentação (envelope e convite montados), 2400 px de largura. */
  async function presentationPng(state) {
    const sc = mockup(state, "grid", { background: "#E4E2DC" });
    const wPx = 2400;
    const hPx = Math.round((sc.h / sc.w) * wPx);
    const blob = await svgToPng(sc.svg, wPx, hPx, "#E4E2DC");
    return { blob, filename: `${slug(state)}_apresentacao.png` };
  }

  P.scene = { mockup };
  P.exporter = { svgToPng, cardPng, presentationPng };
})();
