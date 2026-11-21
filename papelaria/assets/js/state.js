/*
 * Estado do projeto: valores padrão, tamanhos, temas de cor, metais, modelos de
 * texto por ocasião e papéis.
 */
(function () {
  "use strict";
  const P = window.P;
  const C = () => P.color;

  P.STATE_VERSION = 2;

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

  /* Metais (dourados) — sombra, médio e brilho. */
  P.GOLDS = {
    classico: { label: "Ouro", goldDark: "#8A672B", gold: "#C9A24D", goldLight: "#F6E3A1" },
    champagne: { label: "Champanhe", goldDark: "#8B7350", gold: "#CBB085", goldLight: "#F5E9CF" },
    antigo: { label: "Ouro velho", goldDark: "#6F5222", gold: "#AE8A3E", goldLight: "#E6CF8C" },
    rose: { label: "Ouro rosé", goldDark: "#8A5646", gold: "#C98E79", goldLight: "#F4D6C8" },
    cobre: { label: "Cobre", goldDark: "#6A391D", gold: "#B6713F", goldLight: "#F1C7A2" },
    prata: { label: "Prata", goldDark: "#6B727D", gold: "#B4BBC5", goldLight: "#F2F4F7" },
  };

  /* Cores de lacre (selo de cera). */
  P.WAX = {
    vermelho: { label: "Vermelho", color: "#9C1C24" },
    bordo: { label: "Bordô", color: "#5C1324" },
    marinho: { label: "Marinho", color: "#182A55" },
    verde: { label: "Verde", color: "#1E4A39" },
    preto: { label: "Preto", color: "#1C1C20" },
    rose: { label: "Rosé", color: "#C38985" },
    perola: { label: "Pérola", color: "#E7E0D4" },
  };

  /*
   * Temas: navy = bordas do envelope, royal = centro do degradê, light = detalhes
   * (filetes, textos claros). card: pearl | envelope | custom.
   */
  P.THEMES = {
    "azul-real": { label: "Azul Real", navy: "#0A1733", royal: "#1D48A8", light: "#9CC3EE", gold: "classico", card: "pearl", pearl: "#FBF8F1", cardText: "#13244A", cardAccent: "#2A4C94", liner: "#12306F" },
    safira: { label: "Safira & Prata", navy: "#070F28", royal: "#2B419F", light: "#BFD0F5", gold: "prata", card: "pearl", pearl: "#F8F9FC", cardText: "#141C3D", cardAccent: "#34489A", liner: "#1B2B6B" },
    esmeralda: { label: "Esmeralda", navy: "#032019", royal: "#0F6A4E", light: "#A9DEC6", gold: "classico", card: "pearl", pearl: "#FAF7EE", cardText: "#0F2C24", cardAccent: "#1A6B51", liner: "#0A4635" },
    marsala: { label: "Marsala", navy: "#2B0812", royal: "#7E1D30", light: "#EEC4CA", gold: "classico", card: "pearl", pearl: "#FCF7F1", cardText: "#3B0F1A", cardAccent: "#86293C", liner: "#5A1322" },
    "black-tie": { label: "Black Tie", navy: "#060607", royal: "#2E2E33", light: "#D2D2D8", gold: "classico", card: "envelope", pearl: "#FAF8F3", cardText: "#F4F1EA", cardAccent: "#DCC68E", liner: "#1A1A1D" },
    lavanda: { label: "Lavanda", navy: "#2D2354", royal: "#7664B6", light: "#DED6F7", gold: "prata", card: "pearl", pearl: "#FBFAFE", cardText: "#271F44", cardAccent: "#5C4C9A", liner: "#4A3C86" },
    terracota: { label: "Terracota", navy: "#3E170B", royal: "#B2552F", light: "#F6D0BA", gold: "champagne", card: "pearl", pearl: "#FBF4EA", cardText: "#45200F", cardAccent: "#A24D2B", liner: "#7E3519" },
    salvia: { label: "Sálvia", navy: "#273221", royal: "#768C64", light: "#E1E9D5", gold: "classico", card: "pearl", pearl: "#FAF8F0", cardText: "#26301F", cardAccent: "#56694A", liner: "#4E6040" },
    grafite: { label: "Grafite & Cobre", navy: "#131518", royal: "#474D57", light: "#D5D9DF", gold: "cobre", card: "pearl", pearl: "#F8F6F2", cardText: "#1E2126", cardAccent: "#8F5732", liner: "#2A2E34" },
    rose: { label: "Rosé", navy: "#E3B8B4", royal: "#F8E6E2", light: "#8E4C53", gold: "rose", card: "pearl", pearl: "#FFFAF7", cardText: "#4A2329", cardAccent: "#9A5560", liner: "#E9C4BF" },
    serenity: { label: "Serenity", navy: "#ABC2E5", royal: "#E5EDF9", light: "#1F3A68", gold: "prata", card: "pearl", pearl: "#FBFCFE", cardText: "#1C2B47", cardAccent: "#3A5A8F", liner: "#C6D6EF" },
    perola: { label: "Pérola & Ouro", navy: "#E6DFD2", royal: "#FDFBF7", light: "#9A8455", gold: "classico", card: "pearl", pearl: "#FFFDF9", cardText: "#2F2A22", cardAccent: "#8A7343", liner: "#EFE7D7" },
  };

  /* Cores rápidas para a "cor principal". */
  P.BASE_SWATCHES = [
    "#1D48A8", "#2B419F", "#0F6A4E", "#2F7D6D", "#7E1D30", "#A3263B", "#B2552F", "#C68A2E",
    "#768C64", "#7664B6", "#9A5560", "#D9A7A2", "#474D57", "#2E2E33", "#8FAAD3", "#E6DFD2",
  ];

  /* Modelos de texto por ocasião (não mudam data, horário e endereço). */
  P.TEMPLATES = {
    casamento: {
      label: "Casamento", hint: "noivos, cerimônia e recepção",
      eyebrow: "Com a bênção de Deus e de seus pais", title: "Helena & Rafael", subtitle: "convidam para a celebração do seu casamento",
      message: "Será uma alegria imensa compartilhar com você o início desta nova história. Sua presença tornará este dia ainda mais especial.",
      info: "Traje passeio completo\nConfirme sua presença até 15 de agosto", signatureLead: "Com carinho,", signature: "Helena & Rafael",
      sender: "Helena & Rafael · 12 de setembro de 2026", initials: "H&R", ring: "Helena · Rafael · MMXXVI",
    },
    noivado: {
      label: "Noivado", hint: "anúncio e celebração",
      eyebrow: "Com alegria, anunciamos o nosso", title: "Noivado", subtitle: "de Helena & Rafael",
      message: "Queremos celebrar este passo tão importante ao lado das pessoas que amamos. Venha brindar conosco!",
      info: "Confirme sua presença até 30 de julho", signatureLead: "Com amor,", signature: "Helena & Rafael",
      sender: "Helena & Rafael", initials: "H&R", ring: "Noivado · Helena & Rafael",
    },
    bodas: {
      label: "Bodas", hint: "renovação de votos",
      eyebrow: "Celebrando 25 anos de amor", title: "Bodas de Prata", subtitle: "de Marta & Roberto",
      message: "Vinte e cinco anos de cumplicidade, fé e família. Queremos renovar nossos votos cercados por quem faz parte desta história.",
      info: "Traje esporte fino\nConfirme sua presença até 20 de agosto", signatureLead: "Com gratidão,", signature: "Marta & Roberto",
      sender: "Marta & Roberto · Bodas de Prata", initials: "M&R", ring: "25 anos · Marta · Roberto",
    },
    quinze: {
      label: "15 anos", hint: "debutante",
      eyebrow: "Você é meu convidado especial para os meus", title: "15 Anos", subtitle: "de Isabela",
      message: "Uma noite para celebrar sonhos, amizades e uma nova fase. Sua presença vai deixar tudo ainda mais especial.",
      info: "Traje social\nConfirme sua presença até 1º de agosto", signatureLead: "Com carinho,", signature: "Isabela",
      sender: "Isabela · 15 anos", initials: "I", ring: "Isabela · quinze anos",
    },
    aniversario: {
      label: "Aniversário", hint: "festa adulta",
      eyebrow: "Venha celebrar comigo", title: "Aniversário", subtitle: "de 40 anos de Carolina",
      message: "Uma noite especial entre amigos e família para celebrar a vida, as conquistas e tudo o que ainda está por vir.",
      info: "Confirme sua presença até 5 de setembro", signatureLead: "Te espero!", signature: "Carolina",
      sender: "Carolina · 40 anos", initials: "C", ring: "Carolina · 40 anos",
    },
    batizado: {
      label: "Batizado", hint: "cerimônia religiosa",
      eyebrow: "Com alegria, convidamos para o batizado de", title: "Miguel", subtitle: "filho de Ana & Pedro",
      message: "Venha celebrar conosco este momento de fé e gratidão. Será uma bênção ter você ao nosso lado.",
      info: "Após a cerimônia, almoço em família\nConfirme sua presença até 10 de agosto", signatureLead: "Com carinho,", signature: "Ana & Pedro",
      sender: "Família Souza", initials: "M", ring: "Batizado · Miguel",
    },
    formatura: {
      label: "Formatura", hint: "colação e baile",
      eyebrow: "Temos a honra de convidar para a", title: "Formatura", subtitle: "Turma de Medicina 2026",
      message: "Depois de anos de estudo e dedicação, chegou o momento de celebrar. Sua presença é parte desta conquista.",
      info: "Traje passeio completo\nApresente este convite na entrada", signatureLead: "Com gratidão,", signature: "Lucas Almeida",
      sender: "Formatura · Medicina 2026", initials: "LA", ring: "Medicina · Turma 2026",
    },
    corporativo: {
      label: "Gala corporativa", hint: "empresas e premiações",
      eyebrow: "A diretoria tem o prazer de convidar para a", title: "Noite de Gala", subtitle: "Celebração dos 30 anos da empresa",
      message: "Uma noite para reconhecer parceiros, colaboradores e clientes que fazem parte da nossa trajetória.",
      info: "Traje black tie\nConfirmação até 10 de outubro · convite individual", signatureLead: "Atenciosamente,", signature: "Diretoria",
      sender: "Diretoria · 30 anos", initials: "G", ring: "Noite de Gala · 30 anos",
    },
    cha: {
      label: "Chá de bebê", hint: "chegada do bebê",
      eyebrow: "Com muito amor, convidamos para o", title: "Chá de Bebê", subtitle: "da Alice",
      message: "Estamos contando os dias para a chegada da nossa pequena. Venha celebrar este momento tão especial com a gente.",
      info: "Sugestão de presente: fraldas tamanho M\nConfirme sua presença até 30 de agosto", signatureLead: "Com carinho,", signature: "Júlia & Thiago",
      sender: "Júlia & Thiago · Chá da Alice", initials: "A", ring: "Alice · com amor",
    },
    especial: {
      label: "Evento especial", hint: "igreja, culto ou encontro",
      eyebrow: "Você é nosso convidado para uma", title: "Noite Especial", subtitle: "de louvor, gratidão e comunhão",
      message: "Prepare o coração para uma noite inesquecível. Traga sua família e venha celebrar conosco.",
      info: "Entrada gratuita\nChegue com 30 minutos de antecedência", signatureLead: "Com carinho,", signature: "Equipe organizadora",
      sender: "Noite Especial", initials: "NE", ring: "Noite Especial · Gratidão",
    },
  };

  /* Categorias da galeria de modelos. */
  P.TEMPLATE_GROUPS = [
    ["amor", "Casamento e amor", ["casamento", "noivado", "bodas"]],
    ["festa", "Aniversários", ["quinze", "aniversario", "cha"]],
    ["fe", "Religiosos", ["batizado", "especial"]],
    ["formal", "Formais", ["formatura", "corporativo"]],
  ];

  /*
   * Textos editáveis do convite. role = papel tipográfico (Fontes);
   * size = chave do ajuste de tamanho; tone/style = aceita cor e estilo próprios.
   */
  P.TEXT_ITEMS = [
    { key: "eyebrow", label: "Pré-título", role: "caps", size: "eyebrow", tone: true, style: true },
    { key: "title", label: "Título", role: "title", size: "title", multiline: true, gold: "card.titleGold", hint: "Enter quebra em duas linhas" },
    { key: "subtitle", label: "Subtítulo", role: "text", size: "subtitle", tone: true, style: true },
    { key: "message", label: "Mensagem", role: "text", size: "message", multiline: true, rows: 4, tone: true, style: true },
    { key: "venue", label: "Local", role: "caps", size: "venue", tone: true, style: true },
    { key: "address", label: "Endereço", role: "text", size: "venue", multiline: true, tone: true, style: true },
    { key: "info", label: "Informações", role: "caps", size: "info", multiline: true, rows: 3, tone: true, style: true },
    { key: "signatureLead", label: "Frase da assinatura", role: "text", size: "signature", tone: true, style: true },
    { key: "signature", label: "Assinatura", role: "signature", size: "signature", gold: "card.signatureGold" },
  ];
  P.FONT_ROLES = [
    ["title", "Título", "script,serif", "Helena"],
    ["caps", "Destaques em maiúsculas", "caps,serif,sans", "Convite"],
    ["text", "Texto corrido", "serif,sans", "Convite"],
    ["signature", "Assinatura", "script", "Rafael"],
    ["monogram", "Iniciais do monograma", "caps,serif", "H R"],
  ];

  P.SIZE_KEYS = [
    ["monogram", "Monograma"],
    ["eyebrow", "Pré-título"],
    ["title", "Título"],
    ["subtitle", "Subtítulo"],
    ["message", "Mensagem"],
    ["date", "Data e horário"],
    ["venue", "Local e endereço"],
    ["info", "Informações"],
    ["signature", "Assinatura"],
  ];

  P.defaults = function () {
    const sizes = {};
    for (const [k] of P.SIZE_KEYS) sizes[k] = 1;
    return {
      version: P.STATE_VERSION,
      card: {
        preset: "15x21",
        width: 150,
        height: 210,
        background: "pearl", // pearl | envelope | custom
        frame: "classic", // classic | deco | fine | none
        showMonogram: true,
        monogramStyle: "circle", // circle | laurel | plain
        divider: "diamond", // diamond | flourish | dots | line | symbol | none
        titleGold: true,
        signatureGold: true,
        dateStyle: "block", // block | line
        titleScale: 1,
        textScale: 1,
        spacing: 1,
        sizes,
        // estilo por texto: cor (text | accent | gold), estilo da letra e fonte ("" = padrão)
        tone: { eyebrow: "accent", subtitle: "text", message: "text", venue: "text", address: "text", info: "accent", signatureLead: "text" },
        style: { eyebrow: "regular", title: "regular", subtitle: "italic", message: "regular", venue: "semibold", address: "italic", info: "regular", signatureLead: "italic", signature: "regular" },
        familyOf: { eyebrow: "", title: "", subtitle: "", message: "", venue: "", address: "", info: "", signatureLead: "", signature: "" },
        // alinhamento (center | left | right), espaçamento entre letras (somado) e entrelinha (fator)
        align: { eyebrow: "center", title: "center", subtitle: "center", message: "center", venue: "center", address: "center", info: "center", signatureLead: "center", signature: "center" },
        track: { eyebrow: 0, title: 0, subtitle: 0, message: 0, venue: 0, address: 0, info: 0, signatureLead: 0, signature: 0 },
        lead: { title: 1, message: 1, address: 1, info: 1 },
      },
      text: {
        eyebrow: P.TEMPLATES.casamento.eyebrow,
        title: P.TEMPLATES.casamento.title,
        subtitle: P.TEMPLATES.casamento.subtitle,
        message: P.TEMPLATES.casamento.message,
        date: "2026-09-12",
        time: "19:30",
        dateText: "",
        venue: "Espaço Jardim Imperial",
        address: "Av. das Palmeiras, 1200 — Jardim Europa\nSão Paulo · SP",
        info: P.TEMPLATES.casamento.info,
        signatureLead: P.TEMPLATES.casamento.signatureLead,
        signature: P.TEMPLATES.casamento.signature,
        template: "casamento",
      },
      envelope: {
        recipientLabel: "Para",
        recipient: "",
        sender: P.TEMPLATES.casamento.sender,
        flapStyle: "v", // v | curve | straight
        flapDepth: 0.58,
        sideWidth: 0.12,
        clearance: 10,
        overlap: 10,
        frontFrame: true,
        flapBorders: true,
        frontOrnament: true,
        frontMonogram: false,
        pattern: "lattice", // none | lattice | pinstripe | dots
        patternOpacity: 0.07,
      },
      liner: {
        pattern: "lattice", // lattice | dots | pinstripe | solid
        color: "#12306F",
        depth: 0.4,
      },
      seal: {
        initials: P.TEMPLATES.casamento.initials,
        style: "wax", // wax | medallion
        ring: P.TEMPLATES.casamento.ring,
        diameter: 30,
        emblem: "initials", // initials | icon | upload
        icon: "cruz",
        uploadLook: "metal", // metal (dourado, vetorizado) | original (cores da imagem)
        uploadTol: 30,
      },
      // dados pesados (imagem enviada); ficam fora do histórico de desfazer
      assets: { upload: null },
      stickers: { diameter: 40 },
      colors: {
        theme: "azul-real",
        base: "#1D48A8",
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
        cardColor: "#F3EDE2",
        cardText: "#13244A",
        cardAccent: "#2A4C94",
        sealMode: "metal", // metal | wax
        waxColor: "#9C1C24",
      },
      fonts: {
        title: "great-vibes",
        caps: "cinzel",
        text: "cormorant-garamond",
        signature: "pinyon-script",
        monogram: "cinzel",
      },
      print: {
        envPaper: "auto",
        envOrient: "auto", // auto | portrait | landscape
        cardPaper: "fit",
        cardOrient: "auto",
        cardUp: "max",
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
        liner: true,
        stickers: true,
      },
      view: {
        guides: true,
        exportAction: "download",
      },
    };
  };

  /* Projetos salvos na versão 1 (somente azul) passam para a versão 2. */
  P.migrate = function (saved) {
    if (!saved || typeof saved !== "object") return saved;
    const s = JSON.parse(JSON.stringify(saved));
    if (!s.version || s.version < 2) {
      if (s.card && s.card.background === "blue") {
        s.card.background = "envelope";
        if (s.colors) {
          s.colors.cardText = "#F3F6FC";
          s.colors.cardAccent = s.colors.light || "#9CC3EE";
        }
      }
      if (s.colors) s.colors.theme = s.colors.palette === "real" ? "azul-real" : "custom";
      s.version = 2;
    }
    return s;
  };

  /* Tamanho do envelope fechado a partir do convite (o convite entra deitado). */
  P.envelopeSize = function (state) {
    const cw = +state.card.width, ch = +state.card.height;
    const c = +state.envelope.clearance;
    return { W: Math.max(cw, ch) + c, H: Math.min(cw, ch) + c };
  };

  /* Cor média do envelope e do fundo do convite (para decidir contraste). */
  P.envelopeMid = (st) => C().mix(st.colors.navy, st.colors.royal, 0.55);
  P.envelopeIsDark = (st) => C().isDark(P.envelopeMid(st));
  P.cardBg = function (st) {
    const c = st.colors;
    if (st.card.background === "envelope") return P.envelopeMid(st);
    if (st.card.background === "custom") return c.cardColor;
    return c.pearl;
  };
  P.cardIsDark = (st) => C().isDark(P.cardBg(st));

  /* Cores de texto do convite adequadas ao fundo escolhido. */
  P.autoCardText = function (st) {
    const c = st.colors;
    const [h, s] = C().toHsl(c.royal);
    if (P.cardIsDark(st)) {
      c.cardText = C().mix("#FFFFFF", c.light, 0.12);
      c.cardAccent = C().isDark(c.light) ? C().mix(c.gold, c.goldLight, 0.4) : c.light;
    } else {
      c.cardText = C().isDark(c.navy) && C().luminance(c.navy) < 0.06 ? C().mix(c.navy, c.royal, 0.18) : C().fromHsl(h, Math.min(0.55, s), 0.17);
      c.cardAccent = C().fromHsl(h, Math.min(0.62, Math.max(0.25, s)), 0.36);
    }
  };

  P.applyGold = function (st, key) {
    const g = P.GOLDS[key];
    if (!g) return;
    Object.assign(st.colors, { goldDark: g.goldDark, gold: g.gold, goldLight: g.goldLight, goldTone: key });
  };

  P.applyTheme = function (st, key) {
    const t = P.THEMES[key];
    if (!t) return;
    Object.assign(st.colors, {
      theme: key, base: t.royal, navy: t.navy, royal: t.royal, light: t.light,
      pearl: t.pearl, cardText: t.cardText, cardAccent: t.cardAccent,
    });
    P.applyGold(st, t.gold);
    st.card.background = t.card;
    st.liner.color = t.liner;
  };

  /*
   * Identidade a partir de uma única cor: bordas (tom profundo), centro (a cor),
   * detalhes (tom claro) e textos do convite. Cores claras viram envelope claro
   * com detalhes escuros.
   */
  P.deriveFromBase = function (st, hex) {
    if (!C().valid(hex)) return;
    const c = st.colors;
    const [h, s, l] = C().toHsl(hex);
    c.base = hex;
    c.theme = "custom";
    if (l > 0.72) {
      c.royal = C().fromHsl(h, s * 0.55, Math.min(0.97, l + 0.05));
      c.navy = C().fromHsl(h, s * 0.6, Math.max(0.6, l - 0.13));
      c.light = C().fromHsl(h, Math.min(0.55, s * 0.9 + 0.1), 0.3);
      st.liner.color = C().fromHsl(h, s * 0.6, Math.max(0.55, l - 0.08));
    } else {
      c.royal = C().fromHsl(h, s, P.clamp(l, 0.3, 0.52));
      c.navy = C().fromHsl(h, Math.min(1, s * 1.05), P.clamp(l * 0.36, 0.05, 0.15));
      c.light = C().fromHsl(h, Math.min(0.7, s * 0.75 + 0.05), 0.82);
      st.liner.color = C().fromHsl(h, s, P.clamp(l * 0.7, 0.18, 0.4));
    }
    P.autoCardText(st);
  };

  P.applyTemplate = function (st, key) {
    const t = P.TEMPLATES[key];
    if (!t) return;
    for (const k of ["eyebrow", "title", "subtitle", "message", "info", "signatureLead", "signature"]) st.text[k] = t[k];
    st.text.template = key;
    st.envelope.sender = t.sender;
    st.seal.initials = t.initials;
    st.seal.ring = t.ring;
  };
})();
