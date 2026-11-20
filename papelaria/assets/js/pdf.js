/*
 * Exportação em PDF vetorial, em milímetros e escala 100%.
 * Cada folha (SVG em mm) vira uma página com exatamente o tamanho do papel.
 * O PDF pede ao leitor "sem ajuste de escala" (PrintScaling = None) e as páginas de
 * convite com tamanho ajustado recebem TrimBox/BleedBox para a gráfica.
 */
(function () {
  "use strict";
  const P = window.P;

  function holder() {
    let h = document.getElementById("pdf-render-holder");
    if (!h) {
      h = document.createElement("div");
      h.id = "pdf-render-holder";
      h.style.cssText = "position:fixed;left:-10000px;top:0;width:10px;height:10px;overflow:hidden;opacity:0;pointer-events:none";
      document.body.appendChild(h);
    }
    return h;
  }

  function setBoxes(doc, sheet) {
    if (!sheet.trims || sheet.trims.length !== 1 || sheet.paperKey !== "fit") return;
    const t = sheet.trims[0];
    const k = doc.internal.scaleFactor;
    const pc = doc.internal.getCurrentPageInfo().pageContext;
    const box = (x, y, w, h) => ({ bottomLeftX: x * k, bottomLeftY: (sheet.h - y - h) * k, topRightX: (x + w) * k, topRightY: (sheet.h - y) * k });
    pc.trimBox = box(t.x, t.y, t.w, t.h);
    const b = sheet.bleed || 0;
    pc.bleedBox = box(t.x - b, t.y - b, t.w + 2 * b, t.h + 2 * b);
  }

  async function addPage(doc, sheet, first) {
    const orient = sheet.w > sheet.h ? "l" : "p";
    if (!first) doc.addPage([sheet.w, sheet.h], orient);
    const parsed = new DOMParser().parseFromString(sheet.svg, "image/svg+xml").documentElement;
    const el = document.importNode(parsed, true);
    const h = holder();
    h.appendChild(el);
    try {
      await doc.svg(el, { x: 0, y: 0, width: sheet.w, height: sheet.h });
    } finally {
      h.removeChild(el);
    }
    setBoxes(doc, sheet);
  }

  function sheetsFor(kind, state) {
    const S = P.sheets;
    const pages = [];
    const env = () => S.envelopeSheet(state, "art");
    const card = () => S.cardSheet(state, "art");
    if (kind === "envelope") pages.push(env());
    else if (kind === "card") pages.push(card());
    else {
      const e = env(), c = card();
      pages.push(e, c);
      if (state.print.dieline) pages.push(S.envelopeSheet(state, "dieline"));
      if (state.print.foil) pages.push(S.envelopeSheet(state, "foil"), S.cardSheet(state, "foil"));
      if (state.print.ficha) pages.push(S.ficha(state, e, c));
    }
    const err = pages.find((p) => p.error);
    if (err) throw new Error(err.error);
    return pages;
  }

  function filename(kind, state) {
    const { W, H } = P.envelopeSize(state);
    const cw = state.card.width, ch = state.card.height;
    const slug = String(state.text.title || "papelaria")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/&/g, "e")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 40) || "papelaria";
    if (kind === "envelope") return `${slug}_envelope-planificado_${Math.round(W)}x${Math.round(H)}mm.pdf`;
    if (kind === "card") return `${slug}_convite_${Math.round(cw)}x${Math.round(ch)}mm.pdf`;
    return `${slug}_papelaria-completa_producao.pdf`;
  }

  async function build(kind, state, onProgress) {
    const pages = sheetsFor(kind, state);
    const first = pages[0];
    const doc = new window.jspdf.jsPDF({
      unit: "mm",
      format: [first.w, first.h],
      orientation: first.w > first.h ? "l" : "p",
      compress: true,
      putOnlyUsedFonts: true,
    });
    const titles = { envelope: "Envelope planificado", card: "Convite", all: "Papelaria completa — produção" };
    doc.setProperties({
      title: `${titles[kind]} — ${String(state.text.title || "").replace(/\n/g, " ")}`,
      subject: "Arquivo de impressão em tamanho real (escala 100%), medidas em milímetros",
      creator: "Editor de Papelaria (HTML/JS local)",
      keywords: "envelope, convite, faca, sangria, escala 100%",
    });
    if (doc.viewerPreferences) doc.viewerPreferences({ PrintScaling: "None", PickTrayByPDFSize: true });
    for (let i = 0; i < pages.length; i++) {
      if (onProgress) onProgress(i + 1, pages.length);
      await addPage(doc, pages[i], i === 0);
    }
    return { doc, pages, filename: filename(kind, state) };
  }

  /* Gera o PDF e devolve { blob, filename, pages }; quem chama decide como salvar. */
  async function exportPdf(kind, state, opts) {
    const o = opts || {};
    const res = await build(kind, state, o.onProgress);
    return { blob: res.doc.output("blob"), filename: res.filename, pages: res.pages };
  }

  P.pdf = { build, exportPdf, sheetsFor };
})();
