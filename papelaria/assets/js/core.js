/*
 * Núcleo: utilitários, cores e o contexto de desenho SVG.
 *
 * Toda a papelaria é desenhada em SVG com unidades em MILÍMETROS (viewBox em mm).
 * O mesmo SVG alimenta a prévia na tela e a exportação em PDF, então o que se vê
 * no editor é exatamente o que vai para a gráfica.
 */
(function () {
  "use strict";
  const P = (window.P = window.P || {});

  P.PT = 25.4 / 72; // milímetros por ponto tipográfico

  P.n = function (v, d) {
    const k = Math.pow(10, d == null ? 3 : d);
    const r = Math.round(v * k) / k;
    return Object.is(r, -0) ? "0" : String(r);
  };

  P.esc = function (s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  };

  P.clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  P.mmLabel = function (v, d) {
    return P.n(v, d == null ? 1 : d).replace(".", ",");
  };

  /* ---------- cores ---------- */
  function hexToRgb(hex) {
    let h = String(hex || "#000").trim().replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const v = parseInt(h.slice(0, 6), 16) || 0;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function rgbToHex(rgb) {
    return "#" + rgb.map((c) => P.clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("");
  }
  function toHsl(hex) {
    const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function fromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = P.clamp(s, 0, 1);
    l = P.clamp(l, 0, 1);
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgbToHex(rgb.map((v) => (v + m) * 255));
  }
  P.color = {
    hexToRgb,
    rgbToHex,
    toHsl,
    fromHsl,
    mix(a, b, t) {
      const x = hexToRgb(a), y = hexToRgb(b);
      return rgbToHex(x.map((c, i) => c + (y[i] - c) * t));
    },
    lighten(a, t) { return P.color.mix(a, "#ffffff", t); },
    darken(a, t) { return P.color.mix(a, "#000000", t); },
    luminance(a) {
      const [r, g, b] = hexToRgb(a).map((c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    },
    /* Fundo escuro pede texto e filetes claros. */
    isDark(a) { return P.color.luminance(a) < 0.3; },
    valid(a) { return /^#[0-9a-fA-F]{6}$/.test(String(a || "")); },
  };

  /*
   * Contexto de desenho.
   *  mode = "art"      arte final colorida
   *         "foil"     arquivo de hot stamping: só os elementos dourados, em preto 100%
   *         "dieline"  faca: apenas linhas técnicas sobre fundo branco
   *  prefix garante IDs únicos quando vários SVGs convivem na mesma página.
   */
  let ctxCounter = 0;
  class Ctx {
    constructor(state, mode, prefix) {
      this.state = state;
      this.mode = mode || "art";
      this.prefix = (prefix || "p") + (++ctxCounter).toString(36);
      this.defs = [];
      this.seq = 0;
      this.goldCache = {};
    }
    get art() { return this.mode === "art"; }
    get foil() { return this.mode === "foil"; }
    get die() { return this.mode === "dieline"; }
    uid(name) { return `${this.prefix}-${name || "d"}${++this.seq}`; }
    def(s) { this.defs.push(s); }

    linear(stops, x1, y1, x2, y2) {
      const id = this.uid("lg");
      this.def(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${P.n(x1)}" y1="${P.n(y1)}" x2="${P.n(x2)}" y2="${P.n(y2)}">` +
          stops.map(([o, c]) => `<stop offset="${P.n(o, 4)}" stop-color="${c}"/>`).join("") +
          `</linearGradient>`
      );
      return `url(#${id})`;
    }
    radial(stops, cx, cy, r, fx, fy) {
      const id = this.uid("rg");
      const f = fx != null ? ` fx="${P.n(fx)}" fy="${P.n(fy)}"` : "";
      this.def(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${P.n(cx)}" cy="${P.n(cy)}" r="${P.n(r)}"${f}>` +
          stops.map(([o, c]) => `<stop offset="${P.n(o, 4)}" stop-color="${c}"/>`).join("") +
          `</radialGradient>`
      );
      return `url(#${id})`;
    }

    /* Dourado metálico: degradê com várias paradas que simula o brilho do metal.
       No modo hot stamping vira preto chapado (área que recebe o filme). */
    gold(x1, y1, x2, y2, tone, pal) {
      if (this.foil) return "#000000";
      const c = pal || this.state.colors;
      const d = c.goldDark, m = c.gold, l = c.goldLight;
      const stops =
        tone === "deep"
          ? [[0, P.color.darken(d, 0.12)], [0.35, d], [0.6, m], [1, d]]
          : !this.dark
          ? [
              // sobre papel claro: sem os brilhos mais claros, para manter contraste
              [0, P.color.darken(d, 0.08)],
              [0.2, m],
              [0.4, P.color.mix(m, l, 0.45)],
              [0.55, m],
              [0.75, d],
              [1, P.color.mix(d, m, 0.6)],
            ]
          : [
              [0, d],
              [0.18, m],
              [0.38, l],
              [0.5, m],
              [0.68, d],
              [0.84, m],
              [1, P.color.mix(m, l, 0.55)],
            ];
      return this.linear(stops, x1, y1, x2, y2);
    }
    /* Dourado sólido (para filetes muito finos, onde degradê não aparece). */
    goldFlat() {
      return this.foil ? "#000000" : this.state.colors.gold;
    }
    /* Cor dos filetes dourados (contornos). Leitores de PDF não aplicam degradê em
       contornos, então os filetes usam um dourado sólido ajustado ao fundo. */
    goldLine() {
      if (this.foil) return "#000000";
      const c = this.state.colors;
      return this.dark ? P.color.mix(c.gold, c.goldLight, 0.18) : P.color.mix(c.gold, c.goldDark, 0.22);
    }
    defsSvg() {
      return this.defs.length ? `<defs>${this.defs.join("")}</defs>` : "";
    }
  }
  P.Ctx = Ctx;

  /*
   * Paradas de degradê ao longo de uma curva suave (sem "degraus" visíveis entre
   * as paradas). ease(t) dá a fração de b misturada em a; n = número de paradas.
   */
  P.smoothStops = function (a, b, ease, n) {
    const k = n || 9;
    const out = [];
    for (let i = 0; i < k; i++) {
      const t = i / (k - 1);
      out.push([t, P.color.mix(a, b, ease(t))]);
    }
    return out;
  };
  P.ease = {
    smooth: (t) => t * t * (3 - 2 * t),
    out: (t) => 1 - Math.pow(1 - t, 1.7),
  };

  P.svgDoc = function (w, h, body, ctx, extra) {
    const attrs = extra || "";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${P.n(w)}mm" height="${P.n(h)}mm" ` +
      `viewBox="0 0 ${P.n(w)} ${P.n(h)}" ${attrs}>` +
      (ctx ? ctx.defsSvg() : "") +
      body +
      `</svg>`
    );
  };

  P.deepClone = (o) => JSON.parse(JSON.stringify(o));

  P.get = function (obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  };
  P.set = function (obj, path, value) {
    const keys = path.split(".");
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null || typeof o[keys[i]] !== "object") o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
  };

  /* Mescla profunda: preenche campos ausentes de um projeto salvo com os padrões atuais. */
  P.mergeDefaults = function (defaults, saved) {
    if (saved == null || typeof saved !== "object" || Array.isArray(saved)) return P.deepClone(defaults);
    const out = {};
    for (const k of Object.keys(defaults)) {
      const dv = defaults[k], sv = saved[k];
      if (dv && typeof dv === "object" && !Array.isArray(dv)) out[k] = P.mergeDefaults(dv, sv);
      else out[k] = sv === undefined || typeof sv !== typeof dv ? dv : sv;
    }
    return out;
  };
})();
