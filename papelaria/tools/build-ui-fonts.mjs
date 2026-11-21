// Gera assets/css/ui-fonts.css: fontes da INTERFACE do editor (não das peças
// impressas), embutidas como data URI para funcionar offline e sem piscar.
//
// Uso (a partir da pasta papelaria/):
//   npm install --prefix /tmp/fontes @fontsource-variable/manrope @fontsource/eb-garamond
//   node tools/build-ui-fonts.mjs /tmp/fontes/node_modules
//
// Manrope e EB Garamond: SIL Open Font License 1.1. (A Cormorant Garamond, usada nas
// peças impressas, tem o acento circunflexo alto e deslocado; na interface usamos a EB Garamond.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nm = process.argv[2];
if (!nm) {
  console.error("Informe a pasta node_modules: node tools/build-ui-fonts.mjs <node_modules>");
  process.exit(1);
}

const faces = [
  { family: "Manrope UI", file: "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2", weight: "200 800", style: "normal" },
  { family: "Garamond UI", file: "@fontsource/eb-garamond/files/eb-garamond-latin-500-normal.woff2", weight: "500", style: "normal" },
  { family: "Garamond UI", file: "@fontsource/eb-garamond/files/eb-garamond-latin-600-normal.woff2", weight: "600", style: "normal" },
  { family: "Garamond UI", file: "@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2", weight: "400", style: "italic" },
];

let css = "/* Fontes da interface do editor (SIL OFL 1.1). Gerado por tools/build-ui-fonts.mjs. */\n";
for (const f of faces) {
  const b64 = fs.readFileSync(path.join(nm, f.file)).toString("base64");
  css +=
    `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;` +
    `src:url(data:font/woff2;base64,${b64}) format("woff2");` +
    `unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}\n`;
}
const out = path.join(here, "..", "assets", "css", "ui-fonts.css");
fs.writeFileSync(out, css);
console.log(`ok: ${(css.length / 1024).toFixed(0)} KB`);
