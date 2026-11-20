/*
 * Envelope planificado (faca + arte).
 *
 * Sistema de coordenadas local, em mm: o corpo do envelope ocupa (0,0)–(W,H).
 * A aba superior fica acima (y < 0), a inferior abaixo (y > H) e as laterais à
 * esquerda (x < 0) e à direita (x > W). As abas dobram para o verso (lado sem
 * impressão); por isso a arte das abas superior e inferior é desenhada girada
 * 180°, para aparecer de pé no envelope montado.
 *
 * Ordem de montagem prevista: laterais → inferior (colada sobre as laterais) →
 * insere o convite → superior fecha com o selo.
 */
(function () {
  "use strict";
  const P = window.P;
  const G = () => P.geo;
  const T = () => P.type;

  /* Ponto da cadeia da aba superior na vertical x (menor profundidade). */
  function depthAt(chain, x) {
    let best = Infinity;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1];
      if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) {
        const t = (x - a[0]) / (b[0] - a[0]);
        const y = a[1] + (b[1] - a[1]) * t;
        best = Math.min(best, -y);
      }
    }
    return best;
  }

  function geometry(state, bleed) {
    const { W, H } = P.envelopeSize(state);
    const e = state.envelope;
    const s = P.clamp(e.sideWidth * W, 12, Math.min(45, W * 0.3));
    const depth = P.clamp(e.flapDepth * H, H * 0.3, H - 10);
    const k = P.clamp(0.016 * W, 2.5, 5);
    const overlap = P.clamp(+e.overlap || 10, 4, 30);
    let chain, radii;

    if (e.flapStyle === "curve") {
      const ds = depth * 0.7;
      const curve = G().quad([k, -ds], [W / 2, -(2 * depth - ds)], [W - k, -ds], 48);
      chain = [[0, 0]].concat(curve, [[W, 0]]);
      radii = chain.map((_, i) => (i === 1 || i === chain.length - 2 ? 5 : 0));
    } else if (e.flapStyle === "straight") {
      chain = [[0, 0], [k, -depth], [W - k, -depth], [W, 0]];
      radii = [0, 8, 8, 0];
    } else {
      const ds = depth * 0.6;
      chain = [[0, 0], [k, -ds], [W / 2, -depth], [W - k, -ds], [W, 0]];
      radii = [0, 5, 7, 5, 0];
    }
    const top = G().fillet(chain, radii, false);

    // profundidade mínima da aba superior na região central (entre as abas laterais)
    let dsEff = Infinity;
    for (let i = 0; i <= 40; i++) dsEff = Math.min(dsEff, depthAt(top, s + ((W - 2 * s) * i) / 40));
    const hb = P.clamp(H - dsEff + overlap, H * 0.35, H - 4);
    const c = P.clamp(0.4 * s, 4, Math.max(4, s - 9));
    const bottom = G().fillet([[W, H], [W - c, H + hb], [c, H + hb], [0, H]], [0, 6, 6, 0], false);

    const a = P.clamp(0.14 * H, 8, s * 1.1);
    const right = G().fillet([[W, 0], [W + s, a], [W + s, H - a], [W, H]], [0, 5, 5, 0], false);
    const left = G().fillet([[0, H], [-s, H - a], [-s, a], [0, 0]], [0, 5, 5, 0], false);

    const flaps = { top, right, bottom, left };
    const outline = G().dedupe([].concat(top, right, bottom, left), true);

    // sangria: só nas bordas externas; na dobra a aba avança 0,4 mm sob o corpo (evita frestas)
    const b = Math.max(0, +bleed || 0);
    const bleedPoly = {};
    for (const [name, poly] of Object.entries(flaps)) {
      const dists = poly.map((_, i) => (i === poly.length - 1 ? 0.4 : b));
      bleedPoly[name] = G().offset(poly, dists);
    }

    // áreas de cola: parte das laterais coberta pela aba inferior (lado impresso, fica oculta)
    const foldedBottom = G().map(bottom, (x, y) => [x, 2 * H - y]);
    const glue = [];
    const sides = [
      { poly: left, fold: (x, y) => [-x, y] },
      { poly: right, fold: (x, y) => [2 * W - x, y] },
    ];
    for (const sd of sides) {
      const folded = G().map(sd.poly, sd.fold);
      const ov = G().clip(folded, foldedBottom);
      if (ov.length >= 3 && Math.abs(G().area(ov)) > 20) {
        const ins = G().offset(ov, -2.5);
        if (Math.abs(G().area(ins)) > 8 && G().area(ins) * G().area(ov) > 0) glue.push(G().map(ins, sd.fold));
      }
    }

    const folds = [
      [[0, 0], [W, 0]],
      [[W, 0], [W, H]],
      [[0, H], [W, H]],
      [[0, 0], [0, H]],
    ];

    // posição do selo: o mais perto possível da ponta, sem invadir a margem de segurança
    const sealR = (+state.seal.diameter || 30) / 2;
    let sealT = null, bestT = depth / 2, bestD = -Infinity;
    for (let t = depth; t >= 0; t -= 0.25) {
      const dist = G().distChain([W / 2, -t], top);
      if (dist > bestD) {
        bestD = dist;
        bestT = t;
      }
      if (dist >= sealR + 3 && t >= sealR + 3) {
        sealT = t;
        break;
      }
    }
    const sealFits = sealT != null;
    const seal = { x: W / 2, y: -(sealFits ? sealT : bestT), r: sealR, fits: sealFits };

    const all = [outline].concat(Object.values(bleedPoly));
    return {
      W, H, s, depth, hb, c, a, overlap, flaps, outline, bleedPoly, glue, folds, seal,
      bbox: G().bbox([outline]),
      bleedBox: G().bbox(all),
      bleed: b,
    };
  }

  /* ---------------- arte ---------------- */

  function flapGradient(ctx, x1, y1, x2, y2) {
    const c = ctx.state.colors;
    return ctx.linear(P.smoothStops(c.navy, c.royal, (t) => 0.92 * P.ease.out(t), 8), x1, y1, x2, y2);
  }

  function bodyGradient(ctx, W, H) {
    const c = ctx.state.colors;
    if (c.gradient === "linear") {
      const a = ((+c.angle || 0) * Math.PI) / 180;
      const vx = Math.cos(a), vy = Math.sin(a);
      const L = Math.abs(W * vx) + Math.abs(H * vy);
      return ctx.linear(
        P.smoothStops(c.navy, c.royal, P.ease.smooth, 9),
        W / 2 - (vx * L) / 2, H / 2 - (vy * L) / 2, W / 2 + (vx * L) / 2, H / 2 + (vy * L) / 2
      );
    }
    const r = Math.hypot(W / 2, H * 0.56);
    return ctx.radial(P.smoothStops(c.royal, c.navy, P.ease.smooth, 10), W / 2, H * 0.44, r);
  }

  function patternLayer(ctx, geo, clipPolys) {
    const st = ctx.state.envelope;
    if (!ctx.art || st.pattern === "none") return "";
    const id = ctx.uid("pat");
    ctx.def(`<clipPath id="${id}">${clipPolys.map((p) => `<path d="${G().d(p)}"/>`).join("")}</clipPath>`);
    const bb = G().bbox(clipPolys);
    const col = ctx.state.colors.light;
    const op = P.clamp(+st.patternOpacity || 0.07, 0, 0.4);
    let lines = "";
    if (st.pattern === "lattice") {
      const step = 8;
      const span = bb.w + bb.h;
      for (let v = -span; v <= span; v += step) {
        lines += `M${P.n(bb.x + v)} ${P.n(bb.y)}l${P.n(bb.h * 0.7)} ${P.n(bb.h)}`;
        lines += `M${P.n(bb.x + v)} ${P.n(bb.y)}l${P.n(-bb.h * 0.7)} ${P.n(bb.h)}`;
      }
      return `<g clip-path="url(#${id})" opacity="${op}"><path d="${lines}" fill="none" stroke="${col}" stroke-width="0.2"/></g>`;
    }
    if (st.pattern === "pinstripe") {
      for (let x = bb.x; x <= bb.x1; x += 4) lines += `M${P.n(x)} ${P.n(bb.y)}V${P.n(bb.y1)}`;
      return `<g clip-path="url(#${id})" opacity="${op}"><path d="${lines}" fill="none" stroke="${col}" stroke-width="0.15"/></g>`;
    }
    // poá
    let dots = "";
    const step = 6;
    let row = 0;
    for (let y = bb.y; y <= bb.y1; y += step * 0.866, row++)
      for (let x = bb.x + (row % 2 ? step / 2 : 0); x <= bb.x1; x += step)
        dots += `M${P.n(x - 0.35)} ${P.n(y)}a0.35 0.35 0 1 0 0.7 0a0.35 0.35 0 1 0 -0.7 0Z`;
    return `<g clip-path="url(#${id})" opacity="${op * 1.6}"><path d="${dots}" fill="${col}"/></g>`;
  }

  /* Filete paralelo às bordas externas de uma aba (para dentro). */
  function flapBorder(poly, inset, foldGap) {
    const dists = poly.map((_, i) => (i === poly.length - 1 ? -foldGap : -inset));
    const off = G().offset(poly, dists);
    return G().d(off, false);
  }

  function fitLine(text, sp, maxW) {
    let w = T().width(text, sp);
    if (w <= maxW) return sp;
    return Object.assign({}, sp, { size: (sp.size * maxW) / w });
  }

  /* Frente (corpo): moldura, ornamento e destinatário. */
  function frontArt(ctx, geo) {
    const st = ctx.state, e = st.envelope, c = st.colors, f = st.fonts;
    const { W, H } = geo;
    let out = "";
    if (ctx.art) out += `<rect x="0" y="0" width="${P.n(W)}" height="${P.n(H)}" fill="${bodyGradient(ctx, W, H)}"/>`;
    const m = Math.max(6.5, Math.min(W, H) * 0.045);
    if (e.frontFrame) {
      if (ctx.art) {
        out += `<rect x="${P.n(m)}" y="${P.n(m)}" width="${P.n(W - 2 * m)}" height="${P.n(H - 2 * m)}" fill="none" stroke="${c.light}" stroke-width="0.22"/>`;
        out += `<rect x="${P.n(m + 1.3)}" y="${P.n(m + 1.3)}" width="${P.n(W - 2 * m - 2.6)}" height="${P.n(H - 2 * m - 2.6)}" fill="none" stroke="${c.light}" stroke-width="0.1" opacity="0.7"/>`;
      }
      if (ctx.art || ctx.foil) {
        const g = ctx.goldFlat();
        out += `<path d="${[[m, m], [W - m, m], [W - m, H - m], [m, H - m]].map(([x, y]) => P.orn.diamond(x, y, 1.7)).join("")}" fill="${g}"/>`;
      }
    }
    const cx = W / 2;
    if (ctx.art || ctx.foil) {
      const style = st.card.divider && st.card.divider !== "none" ? st.card.divider : "diamond";
      if (e.frontMonogram && String(st.seal.initials || "").trim()) {
        const D = Math.min(st.card.monogramStyle === "laurel" ? 30 : 22, H * 0.19);
        out += P.orn.badge(ctx, st, cx, H * 0.27, D, st.card.monogramStyle);
      } else if (e.frontOrnament) {
        out += P.orn.divider(ctx, cx, H * 0.3, Math.min(style === "flourish" ? 60 : 54, W * 0.27), style);
      }
    }

    // destinatário
    const label = String(e.recipientLabel || "").trim();
    const name = String(e.recipient || "").trim();
    const capsSp = { font: f.caps, variant: "regular", size: P.pt(7.2), tracking: 0.32, upper: true };
    const labelY = H * 0.47;
    if (label && ctx.art) {
      const r = T().line(label, cx, labelY, capsSp, "middle");
      out += `<path d="${r.d}" fill="${c.light}"/>`;
    }
    const lineW = Math.min(W * 0.5, 110);
    const baseY = H * 0.63;
    if (name) {
      if (ctx.art || ctx.foil) {
        const sp = fitLine(name, { font: f.title, variant: "regular", size: P.pt(24) }, lineW * 1.1);
        const r = T().line(name, cx, baseY, sp, "middle");
        out += `<path d="${r.d}" fill="${ctx.gold(cx - lineW / 2, baseY - 8, cx + lineW / 2, baseY)}"/>`;
      }
    } else if (ctx.art || ctx.foil) {
      // linha para escrever à mão
      out += `<path d="M${P.n(cx - lineW / 2)} ${P.n(baseY)}H${P.n(cx + lineW / 2)}" stroke="${ctx.goldLine()}" stroke-width="0.2"/>`;
      if (ctx.art)
        out += `<path d="M${P.n(cx - lineW / 2.6)} ${P.n(baseY + 9)}H${P.n(cx + lineW / 2.6)}" stroke="${c.light}" stroke-width="0.14" opacity="0.8"/>`;
    }
    return out;
  }

  function sideArt(ctx, geo, name) {
    const poly = geo.bleedPoly[name];
    const exact = geo.flaps[name];
    const c = ctx.state.colors;
    const { W, H, s } = geo;
    let out = "";
    if (ctx.art) {
      const fill = name === "left" ? flapGradient(ctx, 0, H / 2, -s, H / 2) : flapGradient(ctx, W, H / 2, W + s, H / 2);
      out += `<path d="${G().d(poly)}" fill="${fill}"/>`;
      if (ctx.state.envelope.flapBorders)
        out += `<path d="${flapBorder(exact, 3.4, 1.2)}" fill="none" stroke="${c.light}" stroke-width="0.18" opacity="0.85"/>`;
    }
    return out;
  }

  function bottomArt(ctx, geo) {
    const st = ctx.state, c = st.colors;
    const { W, H, hb } = geo;
    let out = "";
    if (ctx.art) {
      out += `<path d="${G().d(geo.bleedPoly.bottom)}" fill="${flapGradient(ctx, W / 2, H, W / 2, H + hb)}"/>`;
      if (st.envelope.flapBorders)
        out += `<path d="${flapBorder(geo.flaps.bottom, 3.4, 1.2)}" fill="none" stroke="${c.light}" stroke-width="0.18" opacity="0.85"/>`;
      // remetente (girado 180°: aparece de pé no verso montado)
      const sender = String(st.envelope.sender || "").trim();
      if (sender) {
        const yc = H + 11;
        const maxW = W - 2 * geo.c - 24;
        const sp = fitLine(sender, { font: st.fonts.caps, variant: "regular", size: P.pt(6.6), tracking: 0.22, upper: true }, maxW);
        const cap = T().metrics(sp).cap;
        const r = T().line(sender, W / 2, yc + cap / 2, sp, "middle");
        out += `<g transform="rotate(180 ${P.n(W / 2)} ${P.n(yc)})"><path d="${r.d}" fill="${c.light}"/></g>`;
      }
    }
    return out;
  }

  function topArt(ctx, geo) {
    const st = ctx.state, c = st.colors;
    const { W, depth } = geo;
    let out = "";
    if (ctx.art) out += `<path d="${G().d(geo.bleedPoly.top)}" fill="${flapGradient(ctx, W / 2, 0, W / 2, -depth)}"/>`;
    if (st.envelope.flapBorders && (ctx.art || ctx.foil)) {
      out += `<path d="${flapBorder(geo.flaps.top, 4.2, 1.4)}" fill="none" stroke="${ctx.goldLine()}" stroke-width="0.32"/>`;
      if (ctx.art)
        out += `<path d="${flapBorder(geo.flaps.top, 5.6, 2.6)}" fill="none" stroke="${c.light}" stroke-width="0.12" opacity="0.7"/>`;
    }
    // selo (lacre colorido não entra no arquivo de hot stamping)
    if (ctx.art || (ctx.foil && st.colors.sealMode !== "wax")) {
      const sl = geo.seal;
      out += `<g transform="translate(${P.n(sl.x)} ${P.n(sl.y)}) rotate(180)">${P.seal.render(ctx, sl.r * 2)}</g>`;
    }
    return out;
  }

  /* ---------------- linhas técnicas ---------------- */

  const CUT_COLORS = { silver: "#D3DCEA", magenta: "#EC008C", black: "#000000" };

  function technical(ctx, geo, o) {
    const st = ctx.state;
    let out = "";
    const die = ctx.die;
    const dark = ctx.dark !== false;
    const silver = dark ? CUT_COLORS.silver : "#8E99A8";
    const cutColor = die ? "#000000" : o.cutColor === "gold" ? ctx.goldLine() : o.cutColor === "silver" || !CUT_COLORS[o.cutColor] ? silver : CUT_COLORS[o.cutColor];
    const foldColor = die ? "#000000" : st.colors.light;
    const mark = dark ? "#FFFFFF" : st.colors.light;

    if (o.glue) {
      for (const gz of geo.glue) {
        const segs = G().hatch(gz, 1.6, -45);
        const hatchCol = die ? "#9AA3AF" : mark;
        out += `<path d="${G().d(gz)}" fill="${die ? "#F1F3F6" : mark}" fill-opacity="${die ? 1 : 0.08}" stroke="${hatchCol}" stroke-width="0.15" stroke-dasharray="1 0.8" stroke-opacity="${die ? 1 : 0.55}"/>`;
        out += `<path d="${segs.map(([p, q]) => `M${P.n(p[0])} ${P.n(p[1])}L${P.n(q[0])} ${P.n(q[1])}`).join("")}" stroke="${hatchCol}" stroke-width="0.12" stroke-opacity="${die ? 1 : 0.35}" fill="none"/>`;
        const cc = G().centroid(gz);
        const bb = G().bbox([gz]);
        const sp = { font: st.fonts.caps, variant: "semibold", size: P.pt(5.5), tracking: 0.3, upper: true };
        const tw = T().width("cola", sp);
        if (bb.h > tw + 4) {
          const r = T().line("cola", 0, T().metrics(sp).cap / 2, sp, "middle");
          out += `<g transform="translate(${P.n(cc[0])} ${P.n(cc[1])}) rotate(-90)"><path d="${r.d}" fill="${die ? "#4B5563" : mark}" fill-opacity="${die ? 1 : 0.6}"/></g>`;
        }
      }
    }
    if (o.safe) {
      const safeCol = "#19B5E8";
      for (const poly of Object.values(geo.flaps)) {
        const dists = poly.map((_, i) => (i === poly.length - 1 ? -2 : -3));
        out += `<path d="${G().d(G().offset(poly, dists))}" fill="none" stroke="${safeCol}" stroke-width="0.15" stroke-dasharray="0.4 0.8"/>`;
      }
      out += `<rect x="5" y="5" width="${P.n(geo.W - 10)}" height="${P.n(geo.H - 10)}" fill="none" stroke="${safeCol}" stroke-width="0.15" stroke-dasharray="0.4 0.8"/>`;
    }
    if (o.fold) {
      const d = geo.folds.map(([p, q]) => `M${P.n(p[0])} ${P.n(p[1])}L${P.n(q[0])} ${P.n(q[1])}`).join("");
      out += `<path d="${d}" fill="none" stroke="${foldColor}" stroke-width="${die ? 0.25 : 0.2}" stroke-dasharray="2.4 1.6" stroke-opacity="${die ? 1 : 0.9}"/>`;
    }
    if (o.cut) {
      out += `<path d="${G().d(geo.outline)}" fill="none" stroke="${cutColor}" stroke-width="${die ? 0.3 : 0.22}" stroke-linejoin="round"/>`;
    }
    if (die) {
      // nomes das partes, para conferência
      const sp = { font: st.fonts.caps, variant: "regular", size: P.pt(7), tracking: 0.25, upper: true };
      const lab = (txt, x, y, rot) => {
        const r = T().line(txt, 0, T().metrics(sp).cap / 2, sp, "middle");
        return `<g transform="translate(${P.n(x)} ${P.n(y)})${rot ? ` rotate(${rot})` : ""}"><path d="${r.d}" fill="#6B7280"/></g>`;
      };
      const { W, H, s, depth, hb } = geo;
      out += lab("frente do envelope", W / 2, H / 2, 0);
      out += lab("aba superior · fechamento", W / 2, -Math.min(depth * 0.45, 26), 0);
      out += lab("aba inferior", W / 2, H + Math.min(hb * 0.5, 30), 0);
      out += lab("aba lateral", -s / 2, H / 2, -90);
      out += lab("aba lateral", W + s / 2, H / 2, 90);
    }
    return out;
  }

  /*
   * Desenha o molde completo, em coordenadas locais.
   * o = { cut, fold, glue, safe, cutColor }
   */
  function render(ctx, geo, o) {
    ctx.dark = P.envelopeIsDark(ctx.state);
    let out = "";
    if (ctx.art) {
      out += sideArt(ctx, geo, "left") + sideArt(ctx, geo, "right");
      out += bottomArt(ctx, geo);
      out += topArt(ctx, geo);
      out += frontArt(ctx, geo);
      out += patternLayer(ctx, geo, Object.values(geo.bleedPoly).concat([[[0, 0], [geo.W, 0], [geo.W, geo.H], [0, geo.H]]]));
    } else if (ctx.foil) {
      out += topArt(ctx, geo) + frontArt(ctx, geo);
    }
    out += technical(ctx, geo, o);
    return out;
  }

  /* ---------------- forro interno ---------------- */

  /*
   * Forro: cobre o lado de dentro da aba superior e desce pelo corpo do envelope
   * até a profundidade escolhida. Fica 3,5 mm para dentro das bordas da aba, para
   * não aparecer quando o envelope está fechado.
   */
  function liner(state, geo) {
    const inset = 3.5;
    const top = geo.flaps.top;
    const dists = top.map((_, i) => (i === top.length - 1 ? 0 : -inset));
    const off = G().offset(top, dists);
    const Ld = P.clamp(+state.liner.depth || 0.4, 0.15, 0.75) * geo.H;
    const xL = off[0][0], xR = off[off.length - 1][0];
    const poly = off.concat([[xR, Ld], [xL, Ld]]);
    return { poly, Ld, xL, xR, depth: geo.depth - inset, bbox: G().bbox([poly]) };
  }

  /* Arte do forro dentro de clipPoly (normalmente o forro com sangria). */
  function linerArt(ctx, lg, clipPoly) {
    const st = ctx.state, L = st.liner;
    const bg = L.color || st.colors.royal;
    ctx.dark = P.color.isDark(bg);
    const id = ctx.uid("lin");
    ctx.def(`<clipPath id="${id}"><path d="${G().d(clipPoly)}"/></clipPath>`);
    const bb = G().bbox([clipPoly]);
    let out = `<path d="${G().d(clipPoly)}" fill="${bg}"/>`;
    const gl = ctx.goldLine();
    let pat = "";
    if (L.pattern === "lattice") {
      const step = 9;
      const span = bb.w + bb.h;
      let d = "";
      for (let v = -span; v <= span; v += step) {
        d += `M${P.n(bb.x + v)} ${P.n(bb.y)}l${P.n(bb.h * 0.75)} ${P.n(bb.h)}`;
        d += `M${P.n(bb.x + v)} ${P.n(bb.y)}l${P.n(-bb.h * 0.75)} ${P.n(bb.h)}`;
      }
      pat = `<path d="${d}" fill="none" stroke="${gl}" stroke-width="0.25" opacity="0.6"/>`;
    } else if (L.pattern === "dots") {
      let d = "";
      const step = 6;
      let row = 0;
      for (let y = bb.y; y <= bb.y1; y += step * 0.866, row++)
        for (let x = bb.x + (row % 2 ? step / 2 : 0); x <= bb.x1; x += step)
          d += `M${P.n(x - 0.55)} ${P.n(y)}a0.55 0.55 0 1 0 1.1 0a0.55 0.55 0 1 0 -1.1 0Z`;
      pat = `<path d="${d}" fill="${gl}" opacity="0.75"/>`;
    } else if (L.pattern === "pinstripe") {
      let d = "";
      for (let x = bb.x; x <= bb.x1; x += 4.5) d += `M${P.n(x)} ${P.n(bb.y)}V${P.n(bb.y1)}`;
      pat = `<path d="${d}" fill="none" stroke="${gl}" stroke-width="0.2" opacity="0.55"/>`;
    }
    out += `<g clip-path="url(#${id})">${pat}</g>`;
    // filete dourado acompanhando a borda da aba
    const inner = G().offset(lg.poly, lg.poly.map(() => -3));
    out += `<path d="${G().d(inner)}" fill="none" stroke="${gl}" stroke-width="0.3"/>`;
    return out;
  }

  /*
   * Prévia montada. Retorna, em coordenadas do corpo (0..W, 0..H):
   *  front  frente do envelope
   *  back   verso fechado, com o selo
   *  open   verso com a aba aberta, mostrando o forro (de y = -profundidade a H)
   */
  function mockup(ctx, geo) {
    const st = ctx.state;
    ctx.dark = P.envelopeIsDark(st);
    const { W, H } = geo;
    const clipFor = (poly) => {
      const id = ctx.uid("mk");
      ctx.def(`<clipPath id="${id}"><path d="${G().d(poly)}"/></clipPath>`);
      return `clip-path="url(#${id})"`;
    };
    const shadowId = ctx.uid("sh");
    ctx.def(
      `<filter id="${shadowId}" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="0.5" stdDeviation="0.8" flood-color="#000" flood-opacity="0.45"/></filter>`
    );
    const pat = (poly) => patternLayer(ctx, geo, [poly]);
    const flap = (name, art, transform) =>
      `<g transform="${transform}" filter="url(#${shadowId})"><g ${clipFor(geo.flaps[name])}>${art}${pat(geo.flaps[name])}</g></g>`;

    const pocket =
      flap("left", sideArt(ctx, geo, "left"), `translate(${P.n(W)} 0)`) +
      flap("right", sideArt(ctx, geo, "right"), `translate(${P.n(-W)} 0)`) +
      flap("bottom", bottomArt(ctx, geo), `rotate(180 ${P.n(W / 2)} ${P.n(H)})`);
    const back =
      `<rect x="0" y="0" width="${P.n(W)}" height="${P.n(H)}" fill="#EDEBE6"/>` +
      pocket +
      flap("top", topArt(ctx, geo), `rotate(180 ${P.n(W / 2)} 0)`);

    const bodyPoly = [[0, 0], [W, 0], [W, H], [0, H]];
    const front = `<g ${clipFor(bodyPoly)}>${frontArt(ctx, geo)}${pat(bodyPoly)}</g>`;

    // aberto: lado de dentro da aba (papel), forro e o bolso por cima
    const lg = liner(st, geo);
    const paper = "#F4F1EB";
    const inside = ctx.linear([[0, "#E4E0D8"], [1, "#F2EFE9"]], 0, 0, 0, H * 0.6);
    const lctx = ctx; // mesmo contexto: os IDs continuam únicos
    const linerSvg = linerArt(lctx, lg, lg.poly);
    ctx.dark = P.envelopeIsDark(st);
    const open =
      `<g filter="url(#${shadowId})"><path d="${G().d(geo.flaps.top)}" fill="${paper}"/></g>` +
      `<rect x="0" y="0" width="${P.n(W)}" height="${P.n(H)}" fill="${inside}"/>` +
      linerSvg +
      pocket;
    return { front, back, open, openTop: -geo.depth };
  }

  P.envelope = { geometry, render, mockup, liner, linerArt };
})();
