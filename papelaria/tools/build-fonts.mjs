// Gera assets/fonts/fonts-data.js com as fontes embutidas em base64.
//
// As fontes ficam dentro de um arquivo .js (e não como .woff soltos) para que o
// editor funcione abrindo o index.html direto do disco (file://), onde o
// navegador bloqueia fetch() de arquivos locais.
//
// Uso (a partir da pasta papelaria/):
//   npm install --prefix /tmp/fontes @fontsource/great-vibes @fontsource/pinyon-script \
//     @fontsource/parisienne @fontsource/alex-brush @fontsource/allura @fontsource/cinzel \
//     @fontsource/marcellus @fontsource/playfair-display @fontsource/bodoni-moda \
//     @fontsource/cormorant-garamond @fontsource/eb-garamond @fontsource/montserrat \
//     @fontsource/josefin-sans
//   node tools/build-fonts.mjs /tmp/fontes/node_modules/@fontsource
//
// Todas as fontes são licenciadas pela SIL Open Font License 1.1.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) {
  console.error("Informe a pasta @fontsource: node tools/build-fonts.mjs <node_modules/@fontsource>");
  process.exit(1);
}

// cat: script (caligráfica), caps (maiúsculas de destaque), serif (texto), sans (apoio)
const FAMILIES = {
  "great-vibes": { name: "Great Vibes", cat: "script", v: { regular: "400-normal" } },
  "pinyon-script": { name: "Pinyon Script", cat: "script", v: { regular: "400-normal" } },
  "parisienne": { name: "Parisienne", cat: "script", v: { regular: "400-normal" } },
  "alex-brush": { name: "Alex Brush", cat: "script", v: { regular: "400-normal" } },
  "allura": { name: "Allura", cat: "script", v: { regular: "400-normal" } },
  "cinzel": { name: "Cinzel", cat: "caps", v: { regular: "400-normal", semibold: "600-normal" } },
  "marcellus": { name: "Marcellus", cat: "caps", v: { regular: "400-normal" } },
  "playfair-display": {
    name: "Playfair Display", cat: "serif",
    v: { regular: "400-normal", italic: "400-italic", semibold: "600-normal" },
  },
  "bodoni-moda": {
    name: "Bodoni Moda", cat: "serif",
    v: { regular: "400-normal", italic: "400-italic", semibold: "600-normal" },
  },
  "cormorant-garamond": {
    name: "Cormorant Garamond", cat: "serif",
    v: {
      regular: "400-normal", medium: "500-normal", semibold: "600-normal",
      italic: "400-italic", mediumItalic: "500-italic",
    },
  },
  "eb-garamond": {
    name: "EB Garamond", cat: "serif",
    v: { regular: "400-normal", italic: "400-italic", semibold: "600-normal" },
  },
  "montserrat": {
    name: "Montserrat", cat: "sans",
    v: { light: "300-normal", regular: "400-normal", semibold: "600-normal" },
  },
  "josefin-sans": {
    name: "Josefin Sans", cat: "sans",
    v: { light: "300-normal", regular: "400-normal", semibold: "600-normal" },
  },
};

const catalog = {};
const data = {};
let licenses = "";
let bytes = 0;

for (const [id, fam] of Object.entries(FAMILIES)) {
  catalog[id] = { name: fam.name, cat: fam.cat, variants: Object.keys(fam.v) };
  for (const [variant, file] of Object.entries(fam.v)) {
    const p = path.join(src, id, "files", `${id}-latin-${file}.woff`);
    const buf = fs.readFileSync(p);
    bytes += buf.length;
    data[`${id}/${variant}`] = buf.toString("base64");
  }
  const lic = fs.readFileSync(path.join(src, id, "LICENSE"), "utf8");
  licenses += `==== ${fam.name} ====\n\n${lic.trim()}\n\n`;
}

const out = path.join(here, "..", "assets", "fonts");
fs.mkdirSync(out, { recursive: true });
const js =
  "/* Fontes embutidas (subconjunto latino, WOFF em base64). Gerado por tools/build-fonts.mjs. */\n" +
  "/* Licença: SIL Open Font License 1.1 — ver assets/fonts/LICENSES-OFL.txt */\n" +
  "window.PAPELARIA_FONTS = " +
  JSON.stringify({ catalog, data }) +
  ";\n";
fs.writeFileSync(path.join(out, "fonts-data.js"), js);
fs.writeFileSync(path.join(out, "LICENSES-OFL.txt"), licenses);
console.log(`ok: ${Object.keys(data).length} arquivos, ${(bytes / 1024).toFixed(0)} KB de fontes`);
