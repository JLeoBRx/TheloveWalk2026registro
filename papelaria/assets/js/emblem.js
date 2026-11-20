/*
 * Emblema central do selo e do monograma: as iniciais, um símbolo da galeria
 * ou a imagem enviada pelo usuário (já sem fundo).
 *
 * Símbolos e imagens vetorizadas são caminhos SVG; para encaixá-los no lugar
 * certo os pontos são transformados (escala uniforme + deslocamento) em vez de
 * usar transform="", para que os degradês dourados continuem no espaço do selo.
 */
(function () {
  "use strict";
  const P = window.P;

  /* ---------- leitura e transformação de caminhos SVG ---------- */
  const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  function parse(d) {
    const out = [];
    let i = 0, cmd = null;
    const s = String(d);
    const skip = () => {
      while (i < s.length && (s[i] === " " || s[i] === "," || s[i] === "\n" || s[i] === "\t" || s[i] === "\r")) i++;
    };
    const re = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
    const num = () => {
      skip();
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) throw new Error("caminho inválido");
      i = re.lastIndex;
      return parseFloat(m[0]);
    };
    const flag = () => {
      skip();
      const c = s[i++];
      if (c !== "0" && c !== "1") throw new Error("caminho inválido");
      return +c;
    };
    for (;;) {
      skip();
      if (i >= s.length) break;
      if (/[a-zA-Z]/.test(s[i])) cmd = s[i++];
      if (!cmd) throw new Error("caminho inválido");
      const U = cmd.toUpperCase();
      if (U === "Z") {
        out.push([cmd]);
        cmd = null;
        continue;
      }
      const a = U === "A" ? [num(), num(), num(), flag(), flag(), num(), num()] : Array.from({ length: ARITY[U] }, num);
      out.push([cmd].concat(a));
      if (cmd === "M") cmd = "L";
      else if (cmd === "m") cmd = "l";
    }
    return out;
  }

  /* Escala uniforme k e deslocamento (tx, ty), devolvendo comandos absolutos. */
  function transform(d, k, tx, ty) {
    let x = 0, y = 0, sx = 0, sy = 0, s = "";
    const X = (v) => P.n(v * k + tx, 3), Y = (v) => P.n(v * k + ty, 3);
    for (const item of parse(d)) {
      const c = item[0], a = item.slice(1);
      const rel = c !== c.toUpperCase();
      const U = c.toUpperCase();
      const ax = (v) => (rel ? x + v : v), ay = (v) => (rel ? y + v : v);
      if (U === "M" || U === "L" || U === "T") {
        const nx = ax(a[0]), ny = ay(a[1]);
        s += `${U}${X(nx)} ${Y(ny)}`;
        x = nx;
        y = ny;
        if (U === "M") {
          sx = x;
          sy = y;
        }
      } else if (U === "H") {
        const nx = ax(a[0]);
        s += `L${X(nx)} ${Y(y)}`;
        x = nx;
      } else if (U === "V") {
        const ny = ay(a[0]);
        s += `L${X(x)} ${Y(ny)}`;
        y = ny;
      } else if (U === "C") {
        s += `C${X(ax(a[0]))} ${Y(ay(a[1]))} ${X(ax(a[2]))} ${Y(ay(a[3]))} ${X(ax(a[4]))} ${Y(ay(a[5]))}`;
        x = ax(a[4]);
        y = ay(a[5]);
      } else if (U === "S" || U === "Q") {
        s += `${U}${X(ax(a[0]))} ${Y(ay(a[1]))} ${X(ax(a[2]))} ${Y(ay(a[3]))}`;
        x = ax(a[2]);
        y = ay(a[3]);
      } else if (U === "A") {
        const nx = ax(a[5]), ny = ay(a[6]);
        s += `A${P.n(a[0] * k, 3)} ${P.n(a[1] * k, 3)} ${a[2]} ${a[3]} ${a[4]} ${X(nx)} ${Y(ny)}`;
        x = nx;
        y = ny;
      } else if (U === "Z") {
        s += "Z";
        x = sx;
        y = sy;
      }
    }
    return s;
  }

  /* ---------- emblema ativo ---------- */
  function active(st) {
    const s = st.seal || {};
    if (s.emblem === "icon" && P.SYMBOLS && P.SYMBOLS[s.icon]) {
      const sym = P.SYMBOLS[s.icon];
      return { type: "path", d: sym.d, w: sym.w, h: sym.h, key: "icon:" + s.icon };
    }
    if (s.emblem === "upload" && st.assets && st.assets.upload) {
      const u = st.assets.upload;
      if (s.uploadLook === "original" && u.png) return { type: "image", href: u.png, w: u.pw, h: u.ph, key: "img" };
      if (u.d) return { type: "path", d: u.d, w: u.vw, h: u.vh, key: "upload" };
    }
    return null;
  }

  /* Encaixe dentro de uma caixa maxW × maxH centrada em (cx, cy). */
  function fit(em, cx, cy, maxW, maxH) {
    const k = Math.min(maxW / em.w, maxH / em.h);
    return { k, x: cx - (em.w * k) / 2, y: cy - (em.h * k) / 2, w: em.w * k, h: em.h * k };
  }

  /* Caminho já posicionado (cache simples por emblema, caixa e posição). */
  const cache = new Map();
  function pathAt(em, cx, cy, maxW, maxH) {
    const f = fit(em, cx, cy, maxW, maxH);
    const key = `${em.key}|${em.d.length}|${P.n(f.k, 6)}|${P.n(f.x)}|${P.n(f.y)}`;
    if (!cache.has(key)) {
      if (cache.size > 80) cache.clear();
      cache.set(key, transform(em.d, f.k, f.x, f.y));
    }
    return cache.get(key);
  }

  function image(em, cx, cy, maxW, maxH, extra) {
    const f = fit(em, cx, cy, maxW, maxH);
    return (
      `<image x="${P.n(f.x)}" y="${P.n(f.y)}" width="${P.n(f.w)}" height="${P.n(f.h)}" preserveAspectRatio="xMidYMid meet" ` +
      `href="${em.href}" xlink:href="${em.href}"${extra || ""}/>`
    );
  }

  /*
   * SVG do emblema numa caixa. paint = preenchimento dos caminhos (dourado).
   * Imagens em cores originais não entram no hot stamping.
   */
  function svg(ctx, em, cx, cy, maxW, maxH, paint) {
    if (em.type === "image") return ctx.foil ? "" : image(em, cx, cy, maxW, maxH);
    return `<path d="${pathAt(em, cx, cy, maxW, maxH)}" fill="${paint}"/>`;
  }

  P.emblem = { parse, transform, active, fit, pathAt, image, svg };
})();
