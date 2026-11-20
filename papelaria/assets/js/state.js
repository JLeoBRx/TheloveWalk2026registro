/*
 * Estado do projeto: valores padrão, predefinições de tamanho, paletas e papéis.
 */
(function () {
  "use strict";
  const P = window.P;

  P.CARD_PRESETS = {
    "15x21": { label: "15 × 21 cm (padrão brasileiro)", w: 150, h: 210, clearance: 10 },
    a5: { label: "A5 — 14,8 × 21 cm", w: 148, h: 210, clearance: 10 },
    "5x7": { label: '5 × 7" — 12,7 × 17,8 cm (envelope A7)', w: 127, h: 178, clearance: 8 },
    "14x14": { label: "Quadrado 14 × 14 cm", w: 140, h: 140, clearance: 8 },
    "10x15": { label: "10 × 15 cm (envelope cabe em A4)", w: 100, h: 150, clearance: 6 },
    custom: { label: "Personalizado", w: null, h: null, clearance: null },
  };

  /* Papéis em mm (retrato). */
  P.PAPERS = {
    A4: { label: "A4 — 210 × 297 mm", w: 210, h: 297 },
    letter: { label: "Carta — 216 × 279 mm", w: 215.9, h: 279.4 },
    legal: { label: "Ofício — 216 × 356 mm", w: 215.9, h: 355.6 },
    A3: { label: "A3 — 297 × 420 mm", w: 297, h: 420 },
    tabloid: { label: "Tabloide — 279 × 432 mm", w: 279.4, h: 431.8 },
    SRA3: { label: "SRA3 — 320 × 450 mm (gráfica digital)", w: 320, h: 450 },
    superA3: { label: "Super A3 — 330 × 483 mm", w: 329, h: 483 },
  };
  P.PAPER_ORDER = ["A4", "letter", "legal", "A3", "tabloid", "SRA3", "superA3"];

  P.PALETTES = {
    real: { label: "Marinho Real", navy: "#0A1733", royal: "#1D48A8", light: "#9CC3EE" },
    safira: { label: "Safira Noturna", navy: "#060D24", royal: "#2A3F9E", light: "#B7C9F2" },
    imperial: { label: "Azul Imperial", navy: "#0C1F4F", royal: "#2F62D2", light: "#A9D2F6" },
    oceano: { label: "Oceano Profundo", navy: "#04182A", royal: "#135C91", light: "#A2D6E8" },
    cobalto: { label: "Cobalto", navy: "#0B1640", royal: "#1F3FBF", light: "#C4D7FF" },
  };

  P.GOLDS = {
    classico: { label: "Ouro clássico", goldDark: "#8A672B", gold: "#C9A24D", goldLight: "#F6E3A1" },
    champagne: { label: "Champagne", goldDark: "#8B7350", gold: "#CBB085", goldLight: "#F5E9CF" },
    antigo: { label: "Ouro velho", goldDark: "#6F5222", gold: "#AE8A3E", goldLight: "#E6CF8C" },
    rose: { label: "Ouro rosé", goldDark: "#8A5646", gold: "#C98E79", goldLight: "#F4D6C8" },
    prata: { label: "Prata", goldDark: "#6B727D", gold: "#B4BBC5", goldLight: "#F2F4F7" },
  };

  P.defaults = function () {
    return {
      version: 1,
      card: {
        preset: "15x21",
        width: 150,
        height: 210,
        background: "pearl", // pearl | blue
        frame: "classic", // classic | deco | fine
        showMonogram: true,
        titleGold: true,
        signatureGold: true,
        dateStyle: "block", // block | line
        titleScale: 1,
        textScale: 1,
      },
      text: {
        eyebrow: "Com a bênção de Deus e de seus pais",
        title: "Helena & Rafael",
        subtitle: "convidam para a celebração do seu casamento",
        message:
          "Será uma alegria imensa compartilhar com você o início desta nova história. Sua presença tornará este dia ainda mais especial.",
        date: "2026-09-12",
        time: "19:30",
        dateText: "",
        venue: "Espaço Jardim Imperial",
        address: "Av. das Palmeiras, 1200 — Jardim Europa\nSão Paulo · SP",
        info: "Traje passeio completo\nConfirme sua presença até 15 de agosto",
        signatureLead: "Com carinho,",
        signature: "Helena & Rafael",
      },
      envelope: {
        recipientLabel: "Para",
        recipient: "",
        sender: "Helena & Rafael · 12 de setembro de 2026",
        flapStyle: "v", // v | curve | straight
        flapDepth: 0.58, // profundidade da aba superior (fração da altura)
        sideWidth: 0.12, // largura das abas laterais (fração da largura)
        clearance: 10, // folga total (mm) em cada dimensão
        overlap: 10, // sobreposição entre aba superior e aba inferior (mm)
        frontFrame: true,
        flapBorders: true,
        frontOrnament: true,
        pattern: "lattice", // none | lattice | pinstripe | dots
        patternOpacity: 0.07,
      },
      seal: {
        initials: "H&R",
        style: "wax", // wax | medallion
        ring: "Helena · Rafael · MMXXVI",
        diameter: 30,
      },
      colors: {
        palette: "real",
        navy: "#0A1733",
        royal: "#1D48A8",
        light: "#9CC3EE",
        goldTone: "classico",
        goldDark: "#8A672B",
        gold: "#C9A24D",
        goldLight: "#F6E3A1",
        gradient: "radial", // radial | linear
        angle: 135,
        pearl: "#FBF8F1",
        cardText: "#13244A",
        cardAccent: "#2A4C94",
      },
      fonts: {
        title: "great-vibes",
        caps: "cinzel",
        text: "cormorant-garamond",
        signature: "pinyon-script",
        monogram: "cinzel",
      },
      print: {
        envPaper: "auto", // auto | fit | chave de P.PAPERS
        cardPaper: "fit", // fit | exact | chave de P.PAPERS
        cardUp: "max", // max | one
        bleed: 3,
        minMargin: 5,
        cutLines: true,
        foldLines: true,
        glue: true,
        safe: false,
        marks: true,
        legend: true,
        cutColor: "silver", // silver | magenta | black | gold
        ficha: true,
        dieline: true,
        foil: false,
      },
      view: {
        guides: true,
        exportAction: "download", // download | open
      },
    };
  };

  /* Tamanho do envelope fechado a partir do convite (o convite entra deitado). */
  P.envelopeSize = function (state) {
    const cw = +state.card.width, ch = +state.card.height;
    const c = +state.envelope.clearance;
    return { W: Math.max(cw, ch) + c, H: Math.min(cw, ch) + c };
  };
})();
