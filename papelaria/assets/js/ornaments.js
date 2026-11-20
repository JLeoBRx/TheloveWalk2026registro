/*
 * Ornamentos vetoriais: divisores (losango, arabesco, pontos, filete), coroa de
 * louros e o selo de monograma usado no convite e na frente do envelope.
 * Tudo em mm; as linhas finas usam dourado sólido (ctx.goldLine) e os
 * preenchimentos usam o degradê metálico (ctx.gold).
 */
(function () {
  "use strict";
  const P = window.P;

  function diamond(cx, cy, r) {
    return `M${P.n(cx)} ${P.n(cy - r)}L${P.n(cx + r * 0.72)} ${P.n(cy)}L${P.n(cx)} ${P.n(cy + r)}L${P.n(cx - r * 0.72)} ${P.n(cy)}Z`;
  }

  /* Folha (lente) da base B na direção dir, comprimento L e meia-largura wh. */
  function leaf(bx, by, dx, dy, L, wh) {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const tx = bx + ux * L, ty = by + uy * L;
    const mx = bx + ux * L * 0.5, my = by + uy * L * 0.5;
    const c1x = mx + px * wh * 2, c1y = my + py * wh * 2;
    const c2x = mx - px * wh * 2, c2y = my - py * wh * 2;
    return `M${P.n(bx)} ${P.n(by)}Q${P.n(c1x)} ${P.n(c1y)} ${P.n(tx)} ${P.n(ty)}Q${P.n(c2x)} ${P.n(c2y)} ${P.n(bx)} ${P.n(by)}Z`;
  }

  /* Mapeia um caminho descrito em unidades normalizadas, espelhando quando sx < 0. */
  function mapPath(cmds, cx, cy, sx, sy) {
    let d = "";
    for (const c of cmds) {
      const [op, ...v] = c;
      d += op;
      for (let i = 0; i < v.length; i += 2) d += `${P.n(cx + v[i] * sx)} ${P.n(cy + v[i + 1] * sy)}${i + 2 < v.length ? " " : ""}`;
    }
    return d;
  }

  /* Arabesco: metade direita em unidades em que a meia-largura vale 21. */
  const FLOURISH = [
    ["M", 2.6, 0],
    ["C", 5, -2.5, 8.7, -2.5, 11.1, -0.3],
    ["C", 13.1, 1.6, 16.1, 1.9, 18.3, 0.3],
    ["C", 19.7, -0.7, 20.5, -2.1, 19.3, -2.6],
    ["C", 18.3, -3, 17.4, -2, 18.1, -1.3],
    ["M", 6.1, -1.75],
    ["C", 6.5, 0.15, 8.4, 0.7, 9.3, -0.25],
  ];

  /*
   * Divisor horizontal centrado em (cx, cy) com largura w.
   * style: diamond | flourish | dots | line | none
   */
  function divider(ctx, cx, cy, w, style) {
    if (!style || style === "none") return "";
    if (style === "symbol") return symbolDivider(ctx, cx, cy, w);
    const half = w / 2;
    const fill = ctx.gold(cx - half, cy - 2, cx + half, cy + 2);
    const line = ctx.goldLine();
    if (style === "flourish") {
      const s = half / 21;
      const sy = Math.min(s, 0.95);
      const right = mapPath(FLOURISH, cx, cy, s, sy);
      const left = mapPath(FLOURISH, cx, cy, -s, sy);
      // folhas nascendo do próprio traço
      let leaves = "";
      for (const k of [1, -1]) {
        leaves += leaf(cx + k * 11.1 * s, cy - 0.3 * sy, k * 0.9, -1.5, 2.9 * s, 0.62 * s);
        leaves += leaf(cx + k * 15.0 * s, cy + 1.28 * sy, k * 1.1, 1.15, 2.1 * s, 0.46 * s);
      }
      return (
        `<path d="${right}${left}" fill="none" stroke="${line}" stroke-width="0.26" stroke-linecap="round"/>` +
        `<path d="${leaves}${diamond(cx, cy, 1.25)}" fill="${fill}"/>` +
        `<circle cx="${P.n(cx)}" cy="${P.n(cy - 2.6 * sy)}" r="0.42" fill="${fill}"/>` +
        `<circle cx="${P.n(cx)}" cy="${P.n(cy + 2.6 * sy)}" r="0.42" fill="${fill}"/>`
      );
    }
    if (style === "dots") {
      const g = 2.4;
      return (
        `<path d="M${P.n(cx - half)} ${P.n(cy)}H${P.n(cx - 3 * g)}M${P.n(cx + 3 * g)} ${P.n(cy)}H${P.n(cx + half)}" stroke="${line}" stroke-width="0.22" fill="none"/>` +
        [-g, 0, g].map((dx, i) => `<circle cx="${P.n(cx + dx)}" cy="${P.n(cy)}" r="${i === 1 ? 0.75 : 0.5}" fill="${fill}"/>`).join("")
      );
    }
    if (style === "line") {
      return (
        `<path d="M${P.n(cx - half)} ${P.n(cy)}H${P.n(cx + half)}" stroke="${line}" stroke-width="0.2" fill="none"/>` +
        `<path d="${diamond(cx, cy, 0.9)}" fill="${fill}"/>`
      );
    }
    // losango (padrão)
    return (
      `<path d="M${P.n(cx - half)} ${P.n(cy)}H${P.n(cx - 3.2)}M${P.n(cx + 3.2)} ${P.n(cy)}H${P.n(cx + half)}" stroke="${line}" stroke-width="0.25" fill="none"/>` +
      `<path d="${diamond(cx, cy, 1.5)}${diamond(cx - 2.4, cy, 0.55)}${diamond(cx + 2.4, cy, 0.55)}" fill="${fill}"/>`
    );
  }

  /*
   * Coroa de louros: dois ramos que sobem pelos lados de um círculo de raio R e
   * deixam uma abertura no topo. Retorna { leaves, stem } (caminhos).
   */
  function laurel(cx, cy, R) {
    const pt = (t) => [cx + R * Math.sin(t), cy - R * Math.cos(t)];
    const t0 = Math.PI + 0.16, t1 = 2 * Math.PI - 0.5;
    const n = 9;
    const L = R * 0.34, wh = R * 0.075;
    let leaves = "", stem = "";
    for (const side of [1, -1]) {
      const a = pt(t0), b = pt(t1);
      const ax = cx + (a[0] - cx) * side, bx = cx + (b[0] - cx) * side;
      stem += `M${P.n(ax)} ${P.n(a[1])}A${P.n(R)} ${P.n(R)} 0 0 ${side > 0 ? 1 : 0} ${P.n(bx)} ${P.n(b[1])}`;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const t = t0 + (t1 - t0) * f;
        const [x0, y0] = pt(t);
        const x = cx + (x0 - cx) * side;
        // tangente (sentido de crescimento) e normal externa
        const tx = Math.cos(t) * side, ty = Math.sin(t);
        const nx = Math.sin(t) * side, ny = -Math.cos(t);
        const k = 1 - 0.32 * f;
        const ang = 0.72;
        const ox = tx * Math.cos(ang) + nx * Math.sin(ang), oy = ty * Math.cos(ang) + ny * Math.sin(ang);
        const ix = tx * Math.cos(ang) - nx * Math.sin(ang), iy = ty * Math.cos(ang) - ny * Math.sin(ang);
        leaves += leaf(x, y0, ox, oy, L * k, wh * k);
        if (i < n - 1) leaves += leaf(x + tx * L * 0.18, y0 + ty * L * 0.18, ix, iy, L * 0.86 * k, wh * 0.9 * k);
      }
      const [ex, ey] = pt(t1);
      const etx = Math.cos(t1) * side, ety = Math.sin(t1);
      leaves += leaf(cx + (ex - cx) * side, ey, etx, ety, L * 0.72, wh * 0.8);
    }
    return { leaves, stem };
  }

  /*
   * Monograma emoldurado. style: circle | laurel | plain.
   * D = diâmetro externo da moldura.
   */
  function badge(ctx, st, cx, cy, D, style) {
    const gFill = ctx.gold(cx - D / 2, cy - D / 2, cx + D / 2, cy + D / 2);
    const gLine = ctx.goldLine();
    let out = "";
    let inner = D;
    if (style === "laurel") {
      const lr = laurel(cx, cy, D * 0.4);
      out += `<path d="${lr.stem}" fill="none" stroke="${gLine}" stroke-width="0.22"/>`;
      out += `<path d="${lr.leaves}" fill="${gFill}"/>`;
      inner = D * 0.62;
    } else if (style !== "plain") {
      out += `<circle cx="${P.n(cx)}" cy="${P.n(cy)}" r="${P.n(D / 2)}" fill="none" stroke="${gLine}" stroke-width="0.3"/>`;
      out += `<circle cx="${P.n(cx)}" cy="${P.n(cy)}" r="${P.n(D / 2 - 1)}" fill="none" stroke="${gLine}" stroke-width="0.12"/>`;
      inner = D * 0.78;
    } else {
      inner = D * 0.95;
    }
    const em = P.emblem && P.emblem.active(st);
    if (em) {
      const box = inner * 0.66;
      out += P.emblem.svg(ctx, em, cx, cy, box, box, gFill);
    } else {
      const mono = P.seal.monogram(st, st.seal.initials, inner * 0.72, inner * 0.54);
      out += `<g transform="translate(${P.n(cx)} ${P.n(cy)})"><path d="${mono.d}" fill="${gFill}"/></g>`;
    }
    return out;
  }

  /* Divisor com o símbolo (ou as iniciais) no centro. */
  function symbolDivider(ctx, cx, cy, w, size) {
    const st = ctx.state;
    const half = w / 2, s = size || 5.6;
    const fill = ctx.gold(cx - half, cy - s, cx + half, cy + s);
    const line = ctx.goldLine();
    let out = `<path d="M${P.n(cx - half)} ${P.n(cy)}H${P.n(cx - s / 2 - 2.4)}M${P.n(cx + s / 2 + 2.4)} ${P.n(cy)}H${P.n(cx + half)}" stroke="${line}" stroke-width="0.24" fill="none"/>`;
    out += `<path d="${diamond(cx - s / 2 - 1.3, cy, 0.5)}${diamond(cx + s / 2 + 1.3, cy, 0.5)}" fill="${fill}"/>`;
    const em = P.emblem && P.emblem.active(st);
    if (em) out += P.emblem.svg(ctx, em, cx, cy, s, s, fill);
    else {
      const mono = P.seal.monogram(st, st.seal.initials, s * 1.5, s * 0.8);
      out += `<g transform="translate(${P.n(cx)} ${P.n(cy)})"><path d="${mono.d}" fill="${fill}"/></g>`;
    }
    return out;
  }

  P.orn = { diamond, leaf, divider, laurel, badge };
})();
