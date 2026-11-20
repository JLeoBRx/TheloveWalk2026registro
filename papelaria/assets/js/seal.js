/*
 * Selo dourado (lacre ou medalhão) com monograma personalizável.
 * Desenhado centrado em (0, 0); o raio nominal é diâmetro/2.
 */
(function () {
  "use strict";
  const P = window.P;
  const T = () => P.type;

  /* Monta o monograma: "H&R" vira H e R em maiúsculas com um & caligráfico entre elas. */
  function monogramParts(state, initials) {
    const raw = String(initials || "").trim();
    const m = raw.match(/^(\S{1,2})\s*(&|\+|·)\s*(\S{1,2})$/) || raw.match(/^(\S{1,2})\s+(e)\s+(\S{1,2})$/i);
    const caps = { font: state.fonts.monogram, variant: "regular", size: 10, upper: true };
    const amp = { font: state.fonts.title, variant: "regular", size: 7.4 };
    if (m) {
      const joiner = m[2].toLowerCase() === "e" ? "&" : m[2];
      return [
        { text: m[1], sp: caps },
        { text: joiner === "&" ? "&" : joiner, sp: joiner === "&" ? amp : caps, amp: true },
        { text: m[3], sp: caps },
      ];
    }
    return [{ text: raw || "·", sp: caps }];
  }

  /* Devolve { d, w, h } do monograma ajustado para caber em maxW × maxH, centrado em (0,0). */
  function monogram(state, initials, maxW, maxH) {
    const parts = monogramParts(state, initials);
    const base = parts.map((p) => ({ p, ink: T().ink(p.text, p.sp) }));
    const cap = T().metrics(parts[0].sp).cap;
    const gap = 0.6;
    let total = 0;
    base.forEach((b, i) => {
      total += b.ink.x2 - b.ink.x1 + (i ? gap : 0);
    });
    // altura de referência: maiúsculas (o & pode subir/descer um pouco)
    let top = 0, bottom = 0;
    for (const b of base) {
      top = Math.min(top, b.p.amp ? -cap * 0.95 : b.ink.y1);
      bottom = Math.max(bottom, b.p.amp ? 0 : b.ink.y2);
    }
    const hRef = Math.max(cap, bottom - top);
    const k = Math.min(maxW / total, maxH / hRef);
    // reconstrói no tamanho final
    let x = -(total * k) / 2;
    const ds = [];
    base.forEach((b, i) => {
      if (i) x += gap * k;
      const sp = Object.assign({}, b.p.sp, { size: b.p.sp.size * k });
      const ink = { x1: b.ink.x1 * k, x2: b.ink.x2 * k };
      const baseline = (cap * k) / 2 + (b.p.amp ? cap * k * 0.06 : 0);
      ds.push(T().line(b.p.text, x - ink.x1, baseline, sp, "start").d);
      x += ink.x2 - ink.x1;
    });
    return { d: ds.join(""), w: total * k, h: hRef * k, cap: cap * k };
  }

  function circle(cx, cy, r, attrs) {
    return `<circle cx="${P.n(cx)}" cy="${P.n(cy)}" r="${P.n(r)}" ${attrs}/>`;
  }

  /* Borda irregular de lacre (cera). */
  function waxOutline(R) {
    const pts = [];
    const N = 180;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const f =
        0.55 * Math.sin(7 * t + 0.6) + 0.3 * Math.sin(11 * t + 2.1) + 0.25 * Math.sin(17 * t + 4.0) + 0.2 * Math.sin(3 * t + 1.2);
      const r = R * (0.955 + 0.032 * f);
      pts.push([r * Math.sin(t), -r * Math.cos(t)]);
    }
    return pts;
  }

  /* Paleta do selo: o metal escolhido ou o lacre colorido (cera). */
  function palette(st) {
    const c = st.colors;
    if (c.sealMode === "wax" && P.color.valid(c.waxColor)) {
      const w = c.waxColor;
      return { goldDark: P.color.mix(w, "#000000", 0.42), gold: w, goldLight: P.color.mix(w, "#FFFFFF", 0.42), wax: true };
    }
    return { goldDark: c.goldDark, gold: c.gold, goldLight: c.goldLight, wax: false };
  }

  function relief(ctx, d, R, tone) {
    const c = palette(ctx.state);
    if (ctx.foil) return `<path d="${d}" fill="#FFFFFF"/>`;
    const shadow = P.color.darken(c.goldDark, 0.35);
    const hi = P.color.lighten(c.goldLight, 0.35);
    const face = ctx.gold(-R * 0.6, -R * 0.6, R * 0.6, R * 0.6, tone, c);
    return (
      `<path d="${d}" fill="${shadow}" transform="translate(0.22 0.28)"/>` +
      `<path d="${d}" fill="${hi}" transform="translate(-0.14 -0.18)"/>` +
      `<path d="${d}" fill="${face}"/>`
    );
  }

  /*
   * Desenha o selo. opts.foil já vem do ctx. Retorna string SVG centrada em (0,0).
   */
  function render(ctx, diameter) {
    const st = ctx.state;
    const s = st.seal;
    const c = palette(st);
    const R = diameter / 2;
    const ringText = String(s.ring || "").trim();
    let out = "";

    if (s.style === "medallion") {
      const body = ctx.foil
        ? "#000000"
        : ctx.radial(
            [[0, c.goldLight], [0.45, c.gold], [0.85, c.goldDark], [1, P.color.darken(c.goldDark, 0.25)]],
            -R * 0.35, -R * 0.4, R * 1.5
          );
      out += circle(0, 0, R, `fill="${body}"`);
      // contas na borda
      const rb = R * 0.9;
      const nb = Math.max(24, Math.floor((2 * Math.PI * rb) / 1.15));
      const bead = ctx.foil ? "#FFFFFF" : P.color.lighten(c.goldLight, 0.2);
      for (let i = 0; i < nb; i++) {
        const t = (i / nb) * Math.PI * 2;
        out += circle(rb * Math.sin(t), -rb * Math.cos(t), Math.min(0.34, R * 0.024), `fill="${bead}"`);
      }
      const line = ctx.foil ? "#FFFFFF" : P.color.darken(c.goldDark, 0.15);
      out += circle(0, 0, R * 0.82, `fill="none" stroke="${line}" stroke-width="0.32"`);
      out += circle(0, 0, R * 0.785, `fill="none" stroke="${line}" stroke-width="0.12"`);
      let innerR = R * 0.74;
      if (ringText) {
        const sp = { font: st.fonts.caps, variant: "regular", size: R * 0.13, tracking: 0.14, upper: true };
        const cap = T().metrics(sp).cap;
        const rr = R * 0.66 - cap / 2;
        const rg = T().ring(ringText, 0, 0, rr, sp, 0);
        const txt = ctx.foil ? "#FFFFFF" : P.color.darken(c.goldDark, 0.3);
        out += `<path d="${rg.d}" fill="${txt}"/>`;
        innerR = R * 0.54;
        out += circle(0, 0, innerR, `fill="none" stroke="${line}" stroke-width="0.18"`);
      }
      const mono = monogram(st, s.initials, innerR * 1.45, innerR * 0.95);
      out += relief(ctx, mono.d, R, "deep");
      return out;
    }

    // ---- lacre de cera dourada ----
    const blob = waxOutline(R);
    const body = ctx.foil
      ? "#000000"
      : ctx.radial(
          [[0, c.goldLight], [0.3, c.gold], [0.72, c.goldDark], [1, P.color.darken(c.goldDark, 0.3)]],
          -R * 0.3, -R * 0.38, R * 1.45, -R * 0.42, -R * 0.5
        );
    out += `<path d="${P.geo.d(blob)}" fill="${body}"/>`;
    // disco prensado (rebaixo do carimbo)
    const rd = R * 0.79;
    if (ctx.foil) {
      out += circle(0, 0, rd, `fill="none" stroke="#FFFFFF" stroke-width="0.35"`);
    } else {
      const disc = ctx.linear(
        [[0, P.color.darken(c.goldDark, 0.1)], [0.45, c.gold], [1, c.goldLight]],
        -rd * 0.7, -rd * 0.7, rd * 0.7, rd * 0.7
      );
      out += circle(0, 0, rd, `fill="${disc}"`);
      out += circle(0.16, 0.2, rd, `fill="none" stroke="${P.color.lighten(c.goldLight, 0.3)}" stroke-width="0.32"`);
      out += circle(-0.12, -0.14, rd, `fill="none" stroke="${P.color.darken(c.goldDark, 0.35)}" stroke-width="0.3"`);
    }
    let innerR = rd * 0.86;
    if (ringText) {
      const sp = { font: st.fonts.caps, variant: "regular", size: R * 0.12, tracking: 0.16, upper: true };
      const cap = T().metrics(sp).cap;
      const rr = rd * 0.83 - cap / 2;
      const rg = T().ring(ringText, 0, 0, rr, sp, 0);
      out += relief(ctx, rg.d, R, "deep");
      // pontilhado no restante do anel
      const gapStart = rg.span / 2 + 0.16;
      const free = Math.PI * 2 - rg.span - 0.32;
      if (free > 0.3) {
        const nd = Math.max(3, Math.floor((free * (rd * 0.83)) / 1.2));
        for (let i = 0; i <= nd; i++) {
          const t = gapStart + (free * i) / nd;
          const dot = ctx.foil ? "#FFFFFF" : P.color.darken(c.goldDark, 0.2);
          out += circle(rd * 0.83 * Math.sin(t), -rd * 0.83 * Math.cos(t), 0.22, `fill="${dot}"`);
        }
      }
      innerR = rd * 0.66;
      const ln = ctx.foil ? "#FFFFFF" : P.color.darken(c.goldDark, 0.2);
      out += circle(0, 0, innerR, `fill="none" stroke="${ln}" stroke-width="0.16"`);
    }
    const mono = monogram(st, s.initials, innerR * 1.42, innerR * 0.92);
    out += relief(ctx, mono.d, R, "deep");
    return out;
  }

  P.seal = { render, monogram, palette };
})();
