// Gera assets/js/symbols.js: a galeria de símbolos do selo e do monograma.
//
// Parte dos símbolos vem do Font Awesome Free 6.7.2 (ícones sob CC BY 4.0,
// https://fontawesome.com/license/free); os demais são desenhados aqui.
//
// Uso (a partir da pasta papelaria/):
//   npm install --prefix /tmp/fa @fortawesome/free-solid-svg-icons@6.7.2
//   node tools/build-symbols.mjs /tmp/fa/node_modules/@fortawesome/free-solid-svg-icons

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = process.argv[2];
if (!pkg) {
  console.error("Informe a pasta do pacote: node tools/build-symbols.mjs <node_modules/@fortawesome/free-solid-svg-icons>");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const fa = require(path.resolve(pkg));

const r = (v) => Math.round(v * 100) / 100;
const circle = (cx, cy, R, ccw) =>
  `M${r(cx - R)} ${r(cy)}A${r(R)} ${r(R)} 0 1 ${ccw ? 1 : 0} ${r(cx + R)} ${r(cy)}A${r(R)} ${r(R)} 0 1 ${ccw ? 1 : 0} ${r(cx - R)} ${r(cy)}Z`;
const poly = (pts) => "M" + pts.map(([x, y]) => `${r(x)} ${r(y)}`).join("L") + "Z";

/* Desenhos próprios ------------------------------------------------------ */

// Alianças entrelaçadas, com uma pedra na aliança da direita.
function aliancas() {
  const R = 165, ri = 128, cy = 300;
  let d = circle(235, cy, R, false) + circle(235, cy, ri, true);
  d += circle(405, cy, R, false) + circle(405, cy, ri, true);
  d += poly([[367, 34], [443, 34], [474, 66], [405, 128], [336, 66]]);
  return { w: 640, h: 512, d };
}

// Cruz com resplendor (raios em volta).
function cruzRaios(cross) {
  const [cw, ch, , , cd] = cross.icon;
  const k = 300 / ch;
  const tx = 256 - (cw * k) / 2, ty = 256 - (ch * k) / 2;
  let d = transform(cd, k, tx, ty);
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const long = i % 2 === 0;
    const r0 = 168, r1 = long ? 250 : 222, half = long ? 0.07 : 0.05;
    const p = (rad, ang) => [256 + rad * Math.sin(ang), 256 - rad * Math.cos(ang)];
    d += poly([p(r0, a - half), p(r1, a), p(r0, a + half)]);
  }
  return { w: 512, h: 512, d };
}

// Estrela de 8 pontas (estrela-guia).
function estrela8() {
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rad = i % 2 === 0 ? (i % 4 === 0 ? 250 : 190) : 82;
    pts.push([256 + rad * Math.sin(a), 256 - rad * Math.cos(a)]);
  }
  return { w: 512, h: 512, d: poly(pts) + circle(256, 256, 34, true) };
}

// Ramos de louros (coroa aberta no topo).
function louros() {
  const cx = 256, cy = 266, R = 200;
  const pt = (t) => [cx + R * Math.sin(t), cy - R * Math.cos(t)];
  const leaf = (bx, by, dx, dy, L, wh) => {
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const tx = bx + ux * L, ty = by + uy * L, mx = bx + ux * L * 0.5, my = by + uy * L * 0.5;
    return `M${r(bx)} ${r(by)}Q${r(mx + px * wh * 2)} ${r(my + py * wh * 2)} ${r(tx)} ${r(ty)}Q${r(mx - px * wh * 2)} ${r(my - py * wh * 2)} ${r(bx)} ${r(by)}Z`;
  };
  const t0 = Math.PI + 0.14, t1 = 2 * Math.PI - 0.52, n = 9, L = 78, wh = 17;
  let d = "";
  for (const side of [1, -1]) {
    // haste: faixa fina ao longo do arco
    const sw = 7;
    const steps = 40;
    const outer = [], inner = [];
    for (let i = 0; i <= steps; i++) {
      const t = t0 + ((t1 - t0) * i) / steps;
      const ox = cx + (R + sw / 2) * Math.sin(t), oy = cy - (R + sw / 2) * Math.cos(t);
      const ix = cx + (R - sw / 2) * Math.sin(t), iy = cy - (R - sw / 2) * Math.cos(t);
      outer.push([cx + (ox - cx) * side, oy]);
      inner.push([cx + (ix - cx) * side, iy]);
    }
    d += poly(outer.concat(inner.reverse()));
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const t = t0 + (t1 - t0) * f;
      const [x0, y0] = pt(t);
      const x = cx + (x0 - cx) * side;
      const tx = Math.cos(t) * side, ty = Math.sin(t);
      const nx = Math.sin(t) * side, ny = -Math.cos(t);
      const kk = 1 - 0.3 * f, ang = 0.72;
      d += leaf(x, y0, tx * Math.cos(ang) + nx * Math.sin(ang), ty * Math.cos(ang) + ny * Math.sin(ang), L * kk, wh * kk);
      if (i < n - 1) d += leaf(x + tx * 14, y0 + ty * 14, tx * Math.cos(ang) - nx * Math.sin(ang), ty * Math.cos(ang) - ny * Math.sin(ang), L * 0.86 * kk, wh * 0.9 * kk);
    }
    const [ex, ey] = pt(t1);
    d += leaf(cx + (ex - cx) * side, ey, Math.cos(t1) * side, Math.sin(t1), L * 0.75, wh * 0.85);
  }
  return { w: 512, h: 512, d };
}

/* Transformação de caminhos (escala uniforme + deslocamento) ----------------- */
function parse(d) {
  const out = [];
  let i = 0, cmd = null;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const num = () => {
    skip();
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i));
    if (!m) throw new Error("caminho inválido perto de " + d.slice(i, i + 12));
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const flag = () => { skip(); const c = d[i++]; if (c !== "0" && c !== "1") throw new Error("flag inválida"); return +c; };
  const AR = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  for (;;) {
    skip();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) cmd = d[i++];
    const U = cmd.toUpperCase();
    if (U === "Z") { out.push([cmd]); cmd = null; continue; }
    const a = U === "A" ? [num(), num(), num(), flag(), flag(), num(), num()] : Array.from({ length: AR[U] }, num);
    out.push([cmd, ...a]);
    if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
  }
  return out;
}
function transform(d, k, tx, ty) {
  let x = 0, y = 0, sx = 0, sy = 0, s = "";
  const X = (v) => r(v * k + tx), Y = (v) => r(v * k + ty);
  for (const [c, ...a] of parse(d)) {
    const rel = c !== c.toUpperCase();
    const U = c.toUpperCase();
    const ax = (v) => (rel ? x + v : v), ay = (v) => (rel ? y + v : v);
    if (U === "M" || U === "L" || U === "T") { const nx = ax(a[0]), ny = ay(a[1]); s += `${U}${X(nx)} ${Y(ny)}`; x = nx; y = ny; if (U === "M") { sx = x; sy = y; } }
    else if (U === "H") { const nx = ax(a[0]); s += `L${X(nx)} ${Y(y)}`; x = nx; }
    else if (U === "V") { const ny = ay(a[0]); s += `L${X(x)} ${Y(ny)}`; y = ny; }
    else if (U === "C") { s += `C${X(ax(a[0]))} ${Y(ay(a[1]))} ${X(ax(a[2]))} ${Y(ay(a[3]))} ${X(ax(a[4]))} ${Y(ay(a[5]))}`; x = ax(a[4]); y = ay(a[5]); }
    else if (U === "S" || U === "Q") { s += `${U}${X(ax(a[0]))} ${Y(ay(a[1]))} ${X(ax(a[2]))} ${Y(ay(a[3]))}`; x = ax(a[2]); y = ay(a[3]); }
    else if (U === "A") { const nx = ax(a[5]), ny = ay(a[6]); s += `A${r(a[0] * k)} ${r(a[1] * k)} ${a[2]} ${a[3]} ${a[4]} ${X(nx)} ${Y(ny)}`; x = nx; y = ny; }
    else if (U === "Z") { s += "Z"; x = sx; y = sy; }
  }
  return s;
}

/* Galeria ------------------------------------------------------------------- */
const FA = [
  ["cruz", "Cruz", "faCross", "fe"],
  ["pomba", "Pomba", "faDove", "fe"],
  ["biblia", "Bíblia", "faBookBible", "fe"],
  ["oracao", "Mãos em oração", "faHandsPraying", "fe"],
  ["igreja", "Igreja", "faChurch", "fe"],
  ["chama", "Chama", "faFireFlameCurved", "fe"],
  ["coroa", "Coroa", "faCrown", "fe"],
  ["ancora", "Âncora", "faAnchor", "fe"],
  ["coracao", "Coração", "faHeart", "amor"],
  ["anel", "Anel", "faRing", "amor"],
  ["diamante", "Diamante", "faGem", "amor"],
  ["infinito", "Infinito", "faInfinity", "amor"],
  ["tacas", "Taças", "faChampagneGlasses", "amor"],
  ["sino", "Sino", "faBell", "amor"],
  ["cuidado", "Mão com coração", "faHandHoldingHeart", "amor"],
  ["estrela", "Estrela", "faStar", "festa"],
  ["bolo", "Bolo", "faCakeCandles", "festa"],
  ["presente", "Presente", "faGift", "festa"],
  ["musica", "Música", "faMusic", "festa"],
  ["capelo", "Formatura", "faGraduationCap", "festa"],
  ["carrinho", "Bebê", "faBabyCarriage", "festa"],
  ["trofeu", "Troféu", "faTrophy", "festa"],
  ["broto", "Broto", "faSeedling", "natureza"],
  ["folha", "Folha", "faLeaf", "natureza"],
  ["lotus", "Flor de lótus", "faSpa", "natureza"],
  ["trevo", "Trevo", "faClover", "natureza"],
  ["arvore", "Árvore", "faTree", "natureza"],
  ["pena", "Pena", "faFeatherPointed", "natureza"],
  ["pergaminho", "Pergaminho", "faScroll", "outros"],
  ["acordo", "Aperto de mãos", "faHandshake", "outros"],
];

const out = {};
const order = [];
const custom = {
  aliancas: ["Alianças", aliancas(), "amor"],
  resplendor: ["Cruz com resplendor", cruzRaios(fa.faCross), "fe"],
  estrela8: ["Estrela-guia", estrela8(), "festa"],
  louros: ["Louros", louros(), "festa"],
};
for (const [key, label, name, cat] of FA) {
  const ic = fa[name];
  if (!ic) throw new Error("ícone não encontrado: " + name);
  const [w, h, , , d] = ic.icon;
  out[key] = { label, cat, w, h, d: Array.isArray(d) ? d.join(" ") : d, src: "fa" };
  order.push(key);
  if (key === "cruz") { out.resplendor = { label: custom.resplendor[0], cat: "fe", ...custom.resplendor[1], src: "own" }; order.push("resplendor"); }
  if (key === "coracao") { out.aliancas = { label: custom.aliancas[0], cat: "amor", ...custom.aliancas[1], src: "own" }; order.push("aliancas"); }
  if (key === "estrela") {
    out.estrela8 = { label: custom.estrela8[0], cat: "festa", ...custom.estrela8[1], src: "own" };
    out.louros = { label: custom.louros[0], cat: "festa", ...custom.louros[1], src: "own" };
    order.push("estrela8", "louros");
  }
}

const js =
  "/*\n" +
  " * Galeria de símbolos do selo e do monograma. Gerado por tools/build-symbols.mjs.\n" +
  " * Ícones marcados com src \"fa\": Font Awesome Free 6.7.2 por Fonticons, Inc.,\n" +
  " * licença CC BY 4.0 (https://fontawesome.com/license/free). Demais: desenho próprio.\n" +
  " */\n" +
  "(function () {\n" +
  "  window.P = window.P || {};\n" +
  "  window.P.SYMBOLS = " + JSON.stringify(out) + ";\n" +
  "  window.P.SYMBOL_ORDER = " + JSON.stringify(order) + ";\n" +
  "})();\n";
const dest = path.join(here, "..", "assets", "js", "symbols.js");
fs.writeFileSync(dest, js);
fs.copyFileSync(path.join(path.resolve(pkg), "LICENSE.txt"), path.join(here, "..", "assets", "js", "vendor", "LICENSE-fontawesome-free.txt"));
console.log(`ok: ${order.length} símbolos, ${(js.length / 1024).toFixed(1)} KB`);
