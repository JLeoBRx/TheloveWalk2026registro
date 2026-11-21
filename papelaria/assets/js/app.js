/*
 * Interface do Ateliê: etapas, ferramentas, campos ligados ao estado, seletor de
 * cores, edição direta na prévia, zoom, folhas de impressão, verificação de
 * produção e exportação. O desenho e a impressão ficam nos outros módulos.
 */
(function () {
  "use strict";
  const P = window.P;
  const KEY = "papelaria.projeto.v1";
  const UI_KEY = "papelaria.interface.v2";
  const RECENT_KEY = "papelaria.cores.recentes";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => P.esc(s);
  const mm = (v, d) => P.mmLabel(v, d);
  const PX_PER_MM = 96 / 25.4;
  const ZMIN = 0.08, ZMAX = 40;
  const TOOLS = ["cores", "modelos", "textos", "cartoes", "envelope", "selo", "fontes", "medidas", "impressao"];
  const STEPS = ["envelope", "card", "mockup", "extras"];

  // Dentro do visualizador do claude.ai (versão online) a página roda num quadro
  // protegido: downloads passam pela permissão "downloads" da plataforma.
  const embedded = !!(window.claude && typeof window.claude.use === "function");
  const downloadsReady = embedded ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);

  /* ---------- armazenamento ---------- */
  function store(k, v) {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch (e) {
      return false;
    }
  }
  function read(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function readJson(k, def) {
    try {
      const v = JSON.parse(read(k));
      return v == null ? def : v;
    } catch (e) {
      return def;
    }
  }
  function load() {
    try {
      const raw = read(KEY);
      if (raw) return P.mergeDefaults(P.defaults(), P.migrate(JSON.parse(raw)));
    } catch (e) {
      /* projeto salvo inválido: segue com o padrão */
    }
    return P.defaults();
  }

  let state = load();
  const ui = Object.assign({ tool: "cores", step: "envelope", extra: "liner", cardView: "card", tplCat: "all" }, readJson(UI_KEY, {}));
  if (!TOOLS.includes(ui.tool)) ui.tool = "cores";
  if (!STEPS.includes(ui.step)) ui.step = "envelope";
  if (ui.extra !== "stickers") ui.extra = "liner";
  if (ui.cardView !== "sheet") ui.cardView = "card";
  let printView = ui.tool === "impressao";
  let viewing = false;
  let ppmZoom = 0; // 0 = ajustar à área
  let current = null; // { w, h, fit, pages?, layout? }
  let busy = false;
  let app = null;
  const mq = window.matchMedia ? window.matchMedia("(max-width: 1024px)") : { matches: false };
  const saveUi = () => store(UI_KEY, JSON.stringify(ui));

  /* ---------- salvamento automático ---------- */
  let saveTimer = null, quotaWarned = false;
  function setSaveState(kind, tip) {
    const el = $("#saveState");
    if (!el) return;
    el.classList.toggle("dirty", kind === "saving");
    el.classList.toggle("warn", kind === "partial");
    el.classList.toggle("error", kind === "error");
    $("span", el).textContent = { saving: "Salvando…", saved: "Salvo", partial: "Salvo sem a imagem", error: "Não salvo" }[kind];
    if (tip) el.dataset.tip = tip;
  }
  function writeNow() {
    saveTimer = null;
    const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (store(KEY, JSON.stringify(state))) return setSaveState("saved", `Salvo neste navegador às ${time}`);
    // sem espaço para a imagem enviada: guarda o resto e avisa uma vez
    const hasUpload = !!(state.assets && state.assets.upload);
    if (store(KEY, JSON.stringify(Object.assign({}, state, { assets: { upload: null } })))) {
      if (!hasUpload) return setSaveState("saved", `Salvo neste navegador às ${time}`);
      setSaveState("partial", "A imagem enviada é grande demais para o navegador. Use Projeto › Salvar arquivo.");
      if (!quotaWarned) {
        quotaWarned = true;
        toast("A imagem é grande demais para ficar guardada no navegador. Use Projeto › Salvar arquivo para não perdê-la.", 7000);
      }
      return;
    }
    setSaveState("error", "O navegador não deixou salvar. Use Projeto › Salvar arquivo.");
  }
  function persist() {
    clearTimeout(saveTimer);
    setSaveState("saving");
    saveTimer = setTimeout(writeNow, 400);
  }
  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      writeNow();
    }
  }

  /* ---------- desfazer / refazer ---------- */
  const hist = { stack: [], i: -1, timer: null };
  // o histórico guarda tudo, menos a imagem enviada (pesada), que continua a atual
  const snapshot = () => JSON.stringify(Object.assign({}, state, { assets: undefined }));
  function pushNow() {
    const s = snapshot();
    if (s === hist.stack[hist.i]) return;
    hist.stack = hist.stack.slice(0, hist.i + 1);
    hist.stack.push(s);
    if (hist.stack.length > 150) hist.stack.shift();
    hist.i = hist.stack.length - 1;
    histButtons();
  }
  function commit() {
    clearTimeout(hist.timer);
    hist.timer = setTimeout(() => {
      hist.timer = null;
      pushNow();
    }, 350);
    histButtons();
  }
  function flush() {
    if (hist.timer) {
      clearTimeout(hist.timer);
      hist.timer = null;
      pushNow();
    }
  }
  function restore(i) {
    hist.i = i;
    const snap = JSON.parse(hist.stack[i]);
    snap.assets = state.assets;
    state = P.mergeDefaults(P.defaults(), snap);
    sync();
    render();
    persist();
    histButtons();
  }
  function undo() {
    flush();
    if (hist.i > 0) restore(hist.i - 1);
  }
  function redo() {
    flush();
    if (hist.i < hist.stack.length - 1) restore(hist.i + 1);
  }
  function histButtons() {
    const u = $("#undoBtn"), r = $("#redoBtn");
    if (u) u.disabled = !(hist.i > 0 || hist.timer);
    if (r) r.disabled = !(hist.i < hist.stack.length - 1) || !!hist.timer;
  }

  /* ---------- formatação ---------- */
  const pct = (v) => `${Math.round(v * 100)}%`;
  const FORMATS = {
    pct,
    mm: (v) => `${mm(v)} mm`,
    deg: (v) => `${Math.round(v)}°`,
    int: (v) => `${Math.round(v)}`,
    sidemm: () => `${mm(P.envelope.geometry(state, 0).s)} mm`,
    clearance: (v) => `${mm(v, 0)} mm · ${mm(v / 2)} por lado`,
    trk: (v) => (Math.abs(+v) < 0.005 ? "padrão" : `${+v > 0 ? "+" : "−"}${Math.round(Math.abs(+v) * 100)}%`),
  };

  const OPTS = {
    frame: [["classic", "Clássica"], ["deco", "Art déco"], ["fine", "Filete"], ["none", "Sem"]],
    divider: [["diamond", "Losango"], ["flourish", "Arabesco"], ["dots", "Pontos"], ["line", "Filete"], ["symbol", "Símbolo"], ["none", "Nenhum"]],
    mono: [["circle", "Círculo"], ["laurel", "Louros"], ["plain", "Simples"]],
    flap: [["v", "Em V"], ["curve", "Curva"], ["straight", "Reta"]],
    pattern: [["none", "Lisa"], ["lattice", "Losangos"], ["pinstripe", "Riscado"], ["dots", "Poá"]],
    liner: [["lattice", "Losangos"], ["dots", "Poá"], ["pinstripe", "Riscado"], ["solid", "Liso"]],
    sealstyle: [["wax", "Lacre"], ["medallion", "Medalhão"]],
  };
  const optLabel = (kind, v) => (OPTS[kind].find((o) => o[0] === v) || [v, v])[1];

  /* ---------- alterações ---------- */
  function changed() {
    sync();
    schedule();
    persist();
    commit();
  }

  function onChange(path, value) {
    P.set(state, path, value);
    if (path === "card.preset" && P.CARD_PRESETS[value] && value !== "custom") {
      const pr = P.CARD_PRESETS[value];
      state.card.width = pr.w;
      state.card.height = pr.h;
      state.envelope.clearance = pr.clearance;
    }
    if (path === "colors.navy" || path === "colors.royal" || path === "colors.light") state.colors.theme = "custom";
    if (/^colors\.gold/.test(path)) state.colors.goldTone = "custom";
    if (path === "card.background") P.autoCardText(state);
    if (path === "colors.waxColor") state.colors.sealMode = "wax";
    if (path === "seal.uploadTol") scheduleReprocess();
    changed();
  }

  const isChoice = (el) => el.classList.contains("seg") || el.classList.contains("tiles");

  function coerce(el, raw) {
    const t = el.dataset.type || el.type;
    if (t === "checkbox") return !!raw;
    if (t === "range" || t === "number") return raw === "" ? 0 : +raw;
    return raw;
  }

  function bind() {
    for (const el of $$("[data-bind]")) {
      if (el.dataset.bound) continue;
      el.dataset.bound = "1";
      const path = el.dataset.bind;
      if (isChoice(el)) {
        el.addEventListener("click", (ev) => {
          const b = ev.target.closest("button[data-value]");
          if (!b || !el.contains(b)) return;
          onChange(path, el.dataset.type === "number" ? +b.dataset.value : b.dataset.value);
        });
        continue;
      }
      const evName = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "date" || el.type === "time" ? "change" : "input";
      el.addEventListener(evName, () => {
        const v = el.type === "checkbox" ? el.checked : el.value;
        if (el.type === "range") fillRange(el);
        if (el.hasAttribute("data-custom-size")) {
          if (!(+v > 0)) return;
          state.card.preset = "custom";
        }
        onChange(path, coerce(el, v));
      });
      if (el.type === "number") {
        // ao sair do campo, limita aos valores aceitos
        el.addEventListener("change", () => {
          const lo = +el.min, hi = +el.max;
          let v = +el.value;
          if (!(v > 0)) v = +P.get(state, path) || lo;
          v = P.clamp(v, lo || v, hi || v);
          el.value = v;
          if (v !== +P.get(state, path)) onChange(path, v);
        });
      }
    }
  }

  function fillRange(el) {
    const lo = +el.min || 0, hi = +el.max || 1;
    const p = hi > lo ? ((+el.value - lo) / (hi - lo)) * 100 : 0;
    el.style.setProperty("--p", `${P.clamp(p, 0, 100)}%`);
  }

  function evalCond(expr) {
    const m = expr.match(/^([\w.]+)(!?=)(.*)$/);
    if (!m) return true;
    const v = String(P.get(state, m[1]));
    return m[2] === "=" ? v === m[3] : v !== m[3];
  }

  function syncChoice(el) {
    const v = String(P.get(state, el.dataset.bind));
    let hit = null;
    const buttons = $$("button[data-value]", el);
    for (const b of buttons) if (String(b.dataset.value) === v) hit = b;
    if (!hit && el.dataset.variantsFor) {
      // a fonte não tem o estilo pedido: mostra o que será usado de fato
      const fam = familyFor(el.dataset.variantsFor, el.dataset.role);
      const eff = P.type.resolveVariant(fam, v);
      hit = buttons.find((b) => b.dataset.value === eff) || null;
    }
    for (const b of buttons) {
      b.classList.toggle("on", b === hit);
      b.setAttribute("aria-pressed", b === hit ? "true" : "false");
    }
  }

  function sync() {
    refreshVariants();
    for (const el of $$("[data-bind]")) {
      if (isChoice(el)) {
        syncChoice(el);
        continue;
      }
      const v = P.get(state, el.dataset.bind);
      if (el.type === "checkbox") el.checked = !!v;
      else if (document.activeElement !== el || el.type === "range" || el.tagName === "SELECT") {
        const s = v == null ? "" : String(v);
        if (el.value !== s) el.value = s;
      }
      if (el.type === "range") fillRange(el);
    }
    for (const cf of $$(".cf[data-color]")) syncColor(cf);
    for (const o of $$("output[data-for]")) {
      const v = P.get(state, o.dataset.for);
      const f = FORMATS[o.dataset.format];
      o.textContent = f ? f(v) : v;
    }
    for (const el of $$("[data-show-if], [data-hide-if]")) {
      let show = el.dataset.showIf ? evalCond(el.dataset.showIf) : true;
      if (el.dataset.hideIf && evalCond(el.dataset.hideIf)) show = false;
      el.hidden = !show;
    }
    if (embedded) for (const el of $$("[data-local-only]")) el.hidden = true;
    for (const pick of $$(".fontpick")) {
      const cur = state.fonts[pick.dataset.font];
      for (const b of $$("button", pick)) b.classList.toggle("on", b.dataset.id === cur);
    }
    for (const sel of $$("select[data-role]")) {
      const o = sel.options[0];
      const name = `Padrão · ${fontName(state.fonts[sel.dataset.role])}`;
      if (o && o.textContent !== name) o.textContent = name;
    }
    for (const t of $$("#themes .theme")) t.classList.toggle("on", t.dataset.theme === state.colors.theme);
    for (const s of $$("[data-golds] .chip")) s.classList.toggle("on", s.dataset.key === state.colors.goldTone);
    for (const s of $$("#waxes .chip")) s.classList.toggle("on", s.dataset.color.toLowerCase() === String(state.colors.waxColor).toLowerCase());
    for (const s of $$("#baseSwatches button")) s.classList.toggle("on", s.dataset.base.toLowerCase() === String(state.colors.base).toLowerCase());
    for (const b of $$("#symbols button")) b.classList.toggle("on", b.dataset.icon === state.seal.icon);
    for (const b of $$("#presets .preset")) b.classList.toggle("on", b.dataset.preset === state.card.preset);
    syncTemplates();
    syncFontRoles();
    uploadUI();
    sizeInfo();
    syncSums();
    histButtons();
    const g = $("#guidesBtn");
    if (g) g.setAttribute("aria-pressed", state.view.guides ? "true" : "false");
    if (cp) syncCpop();
  }

  /* ---------- resumos ao lado do título de cada seção ---------- */
  function setSum(key, text) {
    for (const el of $$(`[data-sum="${key}"]`)) if (el.textContent !== text) el.textContent = text;
  }
  function syncSums() {
    const c = state.colors, cd = state.card, s = state.seal;
    setSum("theme", c.theme === "custom" ? "Personalizado" : (P.THEMES[c.theme] || {}).label || "");
    setSum("base", String(c.base || "").toUpperCase());
    setSum("envcolors", c.gradient === "linear" ? `Linear · ${Math.round(c.angle)}°` : "Radial");
    setSum("gold", c.goldTone === "custom" ? "Personalizado" : (P.GOLDS[c.goldTone] || {}).label || "");
    setSum("cardbg", { pearl: "Perolado", envelope: "Do envelope", custom: "Outra cor" }[cd.background] || "");
    const dp = P.dateParts(state.text);
    const dt = String(state.text.dateText || "").trim();
    setSum("date", dt ? "Por extenso" : [dp.date ? `${dp.date.day}/${String(state.text.date).slice(5, 7)}/${dp.date.year}` : "", dp.time].filter(Boolean).join(" · "));
    setSum("frame", optLabel("frame", cd.frame));
    setSum("divider", optLabel("divider", cd.divider));
    setSum("mono", cd.showMonogram ? optLabel("mono", cd.monogramStyle) : "Desligado");
    setSum("flap", optLabel("flap", state.envelope.flapStyle));
    setSum("pattern", optLabel("pattern", state.envelope.pattern));
    setSum("liner", optLabel("liner", state.liner.pattern));
    const sym = P.SYMBOLS && P.SYMBOLS[s.icon];
    setSum("emblem", s.emblem === "icon" ? (sym ? sym.label : "Símbolo") : s.emblem === "upload" ? "Imagem" : String(s.initials || "").trim() || "Iniciais");
    setSum("sealstyle", optLabel("sealstyle", s.style));
    const wax = Object.values(P.WAX).find((w) => w.color.toLowerCase() === String(c.waxColor).toLowerCase());
    setSum("sealcolor", c.sealMode === "wax" ? `Lacre · ${wax ? wax.label : String(c.waxColor).toUpperCase()}` : (P.GOLDS[c.goldTone] || { label: "Metal" }).label);
    setSum("sealsize", `${mm(s.diameter)} mm`);
    setSum("sizes", `${pct(cd.titleScale)} · ${pct(cd.textScale)}`);
    setSum("cardsize", `${mm(+cd.width)} × ${mm(+cd.height)} mm`);
    setSum("bleed", +state.print.bleed > 0 ? `${mm(state.print.bleed)} mm` : "Sem sangria");
    const pr = state.print;
    const extras = [pr.liner, pr.stickers, pr.dieline, pr.foil, pr.ficha].filter(Boolean).length;
    setSum("bundle", `${2 + extras} itens`);
    setSum("pages", `${printCount()} folhas`);
  }

  /* ---------- componentes montados por script ---------- */
  function buildSelects() {
    $("#envPaperSelect").innerHTML =
      `<option value="auto">Automático · o menor em que o molde cabe</option>` +
      P.PAPER_ORDER.map((k) => `<option value="${k}">${esc(P.PAPERS[k].label)}</option>`).join("") +
      `<option value="fit">Ajustado ao molde (arquivo para gráfica)</option>`;
    $("#cardPaperSelect").innerHTML =
      `<option value="fit">Ajustado · convite, sangria e marcas de corte</option>` +
      `<option value="exact">Tamanho final exato (papel já cortado)</option>` +
      ["A4", "letter", "A3", "SRA3"].map((k) => `<option value="${k}">${esc(P.PAPERS[k].label)} com marcas de corte</option>`).join("");
  }

  const familyFor = (key, role) => (state.card.familyOf && state.card.familyOf[key]) || state.fonts[role];
  function fontName(id) {
    const f = P.type.families().find((x) => x.id === id);
    return f ? f.name : id || "";
  }

  function buildFontPickers() {
    for (const pick of $$(".fontpick")) {
      const cats = pick.dataset.cats.split(",");
      const sample = pick.dataset.sample || "Aa";
      pick.innerHTML = P.type
        .families(cats)
        .map((f) => {
          const style = f.cat === "script" ? "font-size:23px" : f.cat === "caps" || f.cat === "sans" ? "font-size:16px;letter-spacing:.04em" : "";
          return `<button type="button" data-id="${f.id}" title="${esc(f.name)}"><b style="font-family:'${esc(f.name)}';${style}">${esc(sample)}</b><small>${esc(f.name)}</small></button>`;
        })
        .join("");
      pick.addEventListener("click", (ev) => {
        const b = ev.target.closest("button[data-id]");
        if (b) onChange(`fonts.${pick.dataset.font}`, b.dataset.id);
      });
    }
  }

  /* Fontes: um papel tipográfico por linha, com amostra no próprio texto do convite. */
  function buildFontRoles() {
    const box = $("#fontRoles");
    box.innerHTML = P.FONT_ROLES.map(
      ([key, label, cats, sample]) =>
        `<div class="role" data-role="${key}">` +
        `<button type="button" class="role-head" aria-expanded="false"><small>${esc(label)}</small><b data-role-sample></b><span class="fname"></span></button>` +
        `<div class="fontpick" data-font="${key}" data-cats="${cats}" data-sample="${esc(sample)}" hidden></div></div>`
    ).join("");
    box.addEventListener("click", (ev) => {
      const head = ev.target.closest(".role-head");
      if (!head) return;
      const role = head.parentElement;
      const open = !role.classList.contains("open");
      for (const r of $$(".role", box)) {
        const on = r === role && open;
        r.classList.toggle("open", on);
        $(".fontpick", r).hidden = !on;
        $(".role-head", r).setAttribute("aria-expanded", on ? "true" : "false");
      }
    });
  }
  function roleSample(key) {
    const t = state.text;
    const first = (s) => String(s || "").split(/\n/)[0].trim();
    let s = "";
    if (key === "title") s = first(t.title);
    else if (key === "caps") s = first(t.venue) || first(t.eyebrow);
    else if (key === "text") s = first(t.subtitle);
    else if (key === "signature") s = first(t.signature);
    else if (key === "monogram") s = String(state.seal.initials || "").trim();
    if (key === "caps") s = s.toLocaleUpperCase("pt-BR");
    if (s.length > 22) s = s.slice(0, 21).trim() + "…";
    return s || (P.FONT_ROLES.find((r) => r[0] === key) || [])[3] || "Aa";
  }
  function syncFontRoles() {
    for (const role of $$("#fontRoles .role")) {
      const key = role.dataset.role;
      const id = state.fonts[key];
      const fam = P.type.families().find((f) => f.id === id);
      const name = fam ? fam.name : id;
      const b = $("[data-role-sample]", role);
      const sample = roleSample(key);
      if (b.textContent !== sample) b.textContent = sample;
      b.style.fontFamily = `'${name}'`;
      b.style.fontSize = fam && fam.cat === "script" ? "25px" : fam && (fam.cat === "caps" || fam.cat === "sans") ? "15px" : "20px";
      b.style.letterSpacing = fam && (fam.cat === "caps" || fam.cat === "sans") ? "0.08em" : "";
      $(".fname", role).textContent = name;
    }
  }

  /* Textos: campo, e uma gaveta de estilo (fonte, estilo, cor, alinhamento, tamanho e espaçamentos). */
  const VARIANT_LABEL = { light: "Leve", regular: "Normal", medium: "Médio", semibold: "Forte", italic: "Itálico" };
  const VARIANT_ORDER = ["light", "regular", "medium", "semibold", "italic"];
  const CAT_LABEL = { script: "Caligráficas", caps: "Maiúsculas clássicas", serif: "Serifadas", sans: "Sem serifa" };

  function familyOptions(role) {
    const fams = P.type.families();
    let html = `<option value="">Padrão · ${esc(fontName(state.fonts[role]))}</option>`;
    for (const cat of ["script", "caps", "serif", "sans"]) {
      const list = fams.filter((f) => f.cat === cat);
      if (list.length) html += `<optgroup label="${CAT_LABEL[cat]}">${list.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</optgroup>`;
    }
    return html;
  }

  function textItemHtml(it) {
    const id = `f-${it.key}`;
    const field = it.multiline
      ? `<textarea id="${id}" rows="${it.rows || 2}" data-bind="text.${it.key}"></textarea>`
      : `<input type="text" id="${id}" data-bind="text.${it.key}">`;
    const shared = P.TEXT_ITEMS.filter((t) => t.size === it.size && t.key !== it.key).map((t) => t.label.toLowerCase());
    let color = "";
    if (it.gold) color = `<label class="switch"><input type="checkbox" id="fg-${it.key}" data-bind="${it.gold}"><span class="track"></span><span>Em metal (dourado)</span></label>`;
    else if (it.tone)
      color =
        `<div class="field"><span class="lbl">Cor</span><div class="seg" data-bind="card.tone.${it.key}">` +
        `<button type="button" data-value="text">Texto</button><button type="button" data-value="accent">Destaque</button><button type="button" data-value="gold">Metal</button></div></div>`;
    const lead = it.multiline
      ? `<label class="field range"><span class="lbl">Entrelinha <output data-for="card.lead.${it.key}" data-format="pct"></output></span><input type="range" id="fl-${it.key}" min="0.7" max="1.6" step="0.05" data-bind="card.lead.${it.key}"></label>`
      : "";
    return (
      `<div class="titem" data-key="${it.key}">` +
      `<div class="titem-head"><label for="${id}">${esc(it.label)}</label>${it.hint ? `<em>${esc(it.hint)}</em>` : ""}` +
      `<button type="button" class="style-btn" aria-expanded="false" aria-controls="ts-${it.key}" aria-label="Estilo de ${esc(it.label)}" data-tip="Fonte, cor, tamanho e alinhamento" data-tip-pos="bottom">Aa</button></div>` +
      field +
      `<div class="tstyle" id="ts-${it.key}" hidden>` +
      `<label class="field"><span class="lbl">Fonte</span><select id="ff-${it.key}" data-bind="card.familyOf.${it.key}" data-role="${it.role}">${familyOptions(it.role)}</select></label>` +
      `<div class="field" data-variant-field="${it.key}"><span class="lbl">Estilo</span><div class="seg" data-bind="card.style.${it.key}" data-variants-for="${it.key}" data-role="${it.role}"></div></div>` +
      color +
      `<div class="field"><span class="lbl">Alinhamento</span><div class="seg seg-icons" data-bind="card.align.${it.key}">` +
      `<button type="button" data-value="left" aria-label="À esquerda" title="À esquerda"><svg><use href="#i-al-left"/></svg></button>` +
      `<button type="button" data-value="center" aria-label="Centralizado" title="Centralizado"><svg><use href="#i-al-center"/></svg></button>` +
      `<button type="button" data-value="right" aria-label="À direita" title="À direita"><svg><use href="#i-al-right"/></svg></button></div></div>` +
      `<label class="field range"><span class="lbl">Tamanho${shared.length ? ` <em>junto com ${esc(shared.join(", "))}</em>` : ""} <output data-for="card.sizes.${it.size}" data-format="pct"></output></span>` +
      `<input type="range" id="fs-${it.key}" min="0.6" max="1.5" step="0.01" data-bind="card.sizes.${it.size}"></label>` +
      `<label class="field range"><span class="lbl">Espaço entre letras <output data-for="card.track.${it.key}" data-format="trk"></output></span><input type="range" id="ft-${it.key}" min="-0.05" max="0.4" step="0.01" data-bind="card.track.${it.key}"></label>` +
      lead +
      `</div></div>`
    );
  }

  function buildTextItems() {
    for (const box of $$(".titems[data-items]")) {
      box.innerHTML = box.dataset.items
        .split(",")
        .map((k) => P.TEXT_ITEMS.find((t) => t.key === k))
        .filter(Boolean)
        .map(textItemHtml)
        .join("");
    }
    $('[data-tool="textos"]', $("#panel")).addEventListener("click", (ev) => {
      const b = ev.target.closest(".style-btn");
      if (!b) return;
      toggleStyle($(`#${b.getAttribute("aria-controls")}`), b.getAttribute("aria-expanded") !== "true");
    });
  }
  function toggleStyle(drawer, open) {
    if (!drawer) return;
    // uma gaveta aberta por vez deixa o painel limpo
    for (const other of $$(".tstyle")) {
      const on = other === drawer && open;
      other.hidden = !on;
      const btn = $(`.style-btn[aria-controls="${other.id}"]`);
      if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
    }
  }

  /* Botões de estilo conforme as variantes que a fonte escolhida realmente tem. */
  function refreshVariants() {
    for (const seg of $$(".seg[data-variants-for]")) {
      const fam = familyFor(seg.dataset.variantsFor, seg.dataset.role);
      const vars = VARIANT_ORDER.filter((v) => P.type.variants(fam).includes(v));
      const sig = `${fam}:${vars.join(",")}`;
      if (seg.dataset.sig === sig) continue;
      seg.dataset.sig = sig;
      seg.innerHTML = vars.map((v) => `<button type="button" data-value="${v}">${VARIANT_LABEL[v]}</button>`).join("");
      const field = seg.closest("[data-variant-field]");
      if (field) field.hidden = vars.length < 2;
    }
  }

  /* Cores: temas, cor principal, metais e lacres. */
  function buildColorPickers() {
    const themes = $("#themes");
    themes.innerHTML = Object.entries(P.THEMES)
      .map(([k, t]) => {
        const g = P.GOLDS[t.gold];
        const card = t.card === "envelope" ? P.color.mix(t.navy, t.royal, 0.5) : t.pearl;
        return (
          `<button type="button" class="theme" data-theme="${k}" style="--a:${t.navy};--b:${t.royal};--c:${card};--g:${g.gold};--gl:${g.goldLight};--gd:${g.goldDark}">` +
          `<span class="mini"><span class="env"></span><span class="card"></span></span><span class="label">${esc(t.label)}</span></button>`
        );
      })
      .join("");
    themes.addEventListener("click", (ev) => {
      const b = ev.target.closest(".theme");
      if (!b) return;
      P.applyTheme(state, b.dataset.theme);
      changed();
    });
    const base = $("#baseSwatches");
    base.innerHTML = P.BASE_SWATCHES.map((c) => `<button type="button" data-base="${c}" style="background:${c}" title="${c}" aria-label="Usar a cor ${c}"></button>`).join("");
    base.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-base]");
      if (!b) return;
      P.deriveFromBase(state, b.dataset.base);
      addRecent(b.dataset.base);
      changed();
    });
    for (const box of $$("[data-golds]")) {
      box.innerHTML = Object.entries(P.GOLDS)
        .map(([k, g]) => `<button type="button" class="chip" data-key="${k}"><i style="background:linear-gradient(135deg, ${g.goldDark}, ${g.gold} 45%, ${g.goldLight} 62%, ${g.gold})"></i>${esc(g.label)}</button>`)
        .join("");
      box.addEventListener("click", (ev) => {
        const b = ev.target.closest(".chip");
        if (!b) return;
        P.applyGold(state, b.dataset.key);
        changed();
      });
    }
    const waxes = $("#waxes");
    waxes.innerHTML = Object.values(P.WAX)
      .map((w) => `<button type="button" class="chip" data-color="${w.color}"><i style="background:radial-gradient(circle at 35% 30%, ${P.color.mix(w.color, "#ffffff", 0.45)}, ${w.color} 55%, ${P.color.mix(w.color, "#000000", 0.4)})"></i>${esc(w.label)}</button>`)
      .join("");
    waxes.addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip");
      if (!b) return;
      state.colors.waxColor = b.dataset.color;
      state.colors.sealMode = "wax";
      changed();
    });
    $("#autoContrast").addEventListener("click", () => {
      P.autoCardText(state);
      changed();
      toast("Cores do texto ajustadas ao fundo do convite.", 3000);
    });
  }

  /* ---------- seletor de cores ---------- */
  const PAPERS_SUGGEST = ["#FFFFFF", "#FFFDF9", "#FBF8F1", "#FAF7EE", "#F8F6F2", "#F5F0E6", "#F3EDE2", "#EFE7D7", "#E9E2D4", "#F4F1F8", "#EEF3F9", "#F2F5EE", "#F9EFEC", "#E6DFD2", "#DCE6F2", "#2E2E33"];
  const INKS_SUGGEST = ["#13244A", "#141C3D", "#0F2C24", "#3B0F1A", "#271F44", "#45200F", "#26301F", "#1E2126", "#2F2A22", "#4A2329", "#2A4C94", "#1A6B51", "#86293C", "#8A7343", "#F4F1EA", "#FFFFFF"];
  function suggestFor(path) {
    if (/gold/i.test(path)) return Object.values(P.GOLDS).flatMap((g) => [g.goldDark, g.gold, g.goldLight]).slice(0, 16);
    if (/pearl|cardColor/.test(path)) return PAPERS_SUGGEST;
    if (/cardText|cardAccent/.test(path)) return INKS_SUGGEST;
    if (/wax/.test(path)) return Object.values(P.WAX).map((w) => w.color).concat(["#7A1E3A", "#2E4A7A", "#3E5A3A", "#6B4A2E", "#B08D57", "#8E2B2B", "#4B2E5A", "#D8C3A5", "#E9D9C4"]);
    return P.BASE_SWATCHES;
  }
  const uniqColors = (list) => {
    const seen = new Set();
    return list.filter((c) => {
      if (!P.color.valid(c)) return false;
      const k = c.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const recents = () => uniqColors(readJson(RECENT_KEY, []) || []).slice(0, 8);
  function addRecent(hex) {
    if (!P.color.valid(hex)) return;
    store(RECENT_KEY, JSON.stringify(uniqColors([hex.toUpperCase()].concat(recents())).slice(0, 8)));
  }
  function syncColor(cf) {
    const v = P.get(state, cf.dataset.color);
    if (!P.color.valid(v)) return;
    $(".sw", cf).style.background = v;
    const hx = $(".hex", cf);
    if (hx.textContent !== v.toUpperCase()) hx.textContent = v.toUpperCase();
  }

  let cp = null; // { path, btn, orig }
  const swatchHtml = (c) => `<button type="button" data-c="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="Cor ${c.toUpperCase()}"></button>`;
  function openCpop(btn) {
    if (cp && cp.btn === btn) return closeCpop();
    closeCpop();
    closeInline(true);
    const path = btn.dataset.color;
    cp = { path, btn, orig: String(P.get(state, path) || "") };
    $("#cpopTitle").textContent = btn.dataset.label || "Cor";
    const c = state.colors;
    $("#cpopProject").innerHTML = uniqColors([c.navy, c.royal, c.light, c.goldDark, c.gold, c.goldLight, c.pearl, c.cardText, c.cardAccent, state.liner.color, c.waxColor, c.cardColor]).slice(0, 16).map(swatchHtml).join("");
    const rec = recents();
    $("#cpopRecentSec").hidden = !rec.length;
    $("#cpopRecent").innerHTML = rec.map(swatchHtml).join("");
    $("#cpopSuggest").innerHTML = uniqColors(suggestFor(path)).slice(0, 16).map(swatchHtml).join("");
    $("#cpop").hidden = false;
    btn.classList.add("open");
    syncCpop();
    positionCpop();
  }
  function positionCpop() {
    if (!cp) return;
    const pop = $("#cpop");
    const r = cp.btn.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return closeCpop();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = P.clamp(r.left, 12, window.innerWidth - w - 12);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }
  function syncCpop() {
    if (!cp) return;
    const v = String(P.get(state, cp.path) || "");
    $("#cpopCur").style.background = v;
    const hex = $("#cpopHex");
    if (document.activeElement !== hex) {
      hex.value = v.toUpperCase();
      hex.classList.remove("invalid");
    }
    if (P.color.valid(v)) $("#cpopNative").value = v.toLowerCase();
    for (const b of $$("#cpop .cpop-grid button")) b.classList.toggle("on", b.dataset.c.toLowerCase() === v.toLowerCase());
  }
  function pickColor(hex, remember) {
    if (!cp || !P.color.valid(hex)) return;
    hex = hex.toUpperCase();
    if (cp.path === "colors.base") {
      P.deriveFromBase(state, hex);
      changed();
    } else onChange(cp.path, hex);
    if (remember) addRecent(hex);
  }
  function closeCpop() {
    if (!cp) return;
    const v = String(P.get(state, cp.path) || "");
    if (v.toLowerCase() !== cp.orig.toLowerCase()) addRecent(v);
    cp.btn.classList.remove("open");
    $("#cpop").hidden = true;
    cp = null;
  }
  function bindColorPopover() {
    for (const cf of $$(".cf[data-color]")) cf.addEventListener("click", () => openCpop(cf));
    $("#cpop").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-c]");
      if (b) pickColor(b.dataset.c, true);
    });
    $("#cpopClose").addEventListener("click", closeCpop);
    const hex = $("#cpopHex");
    hex.addEventListener("input", () => {
      let v = hex.value.trim();
      if (v && v[0] !== "#") v = "#" + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        hex.classList.remove("invalid");
        pickColor(v, false);
      } else hex.classList.toggle("invalid", v.length >= 7);
    });
    hex.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        closeCpop();
      }
    });
    hex.addEventListener("blur", () => {
      hex.classList.remove("invalid");
      syncCpop();
    });
    const nat = $("#cpopNative");
    nat.addEventListener("input", () => pickColor(nat.value, false));
    nat.addEventListener("change", () => addRecent(nat.value));
    document.addEventListener("pointerdown", (ev) => {
      if (cp && !ev.target.closest("#cpop") && !ev.target.closest(".cf[data-color]")) closeCpop();
    });
    $("#panelScroll").addEventListener("scroll", () => cp && positionCpop(), { passive: true });
    window.addEventListener("resize", () => cp && positionCpop());
  }

  /* ---------- modelos ---------- */
  function catOf(key) {
    const g = P.TEMPLATE_GROUPS.find((x) => x[2].includes(key));
    return g ? g[0] : "outros";
  }
  function buildTemplates() {
    const cats = $("#tplCats");
    cats.innerHTML = `<button type="button" data-cat="all">Todos</button>` + P.TEMPLATE_GROUPS.map(([k, label]) => `<button type="button" data-cat="${k}">${esc(label)}</button>`).join("");
    cats.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-cat]");
      if (!b) return;
      ui.tplCat = b.dataset.cat;
      saveUi();
      syncTemplates();
      scheduleThumbs();
    });
    const grouped = P.TEMPLATE_GROUPS.flatMap((g) => g[2]);
    const order = grouped.concat(Object.keys(P.TEMPLATES).filter((k) => !grouped.includes(k)));
    const box = $("#templates");
    box.innerHTML = order
      .map((k) => {
        const t = P.TEMPLATES[k];
        return `<button type="button" class="tpl" data-template="${k}" data-cat="${catOf(k)}"><span class="tpl-thumb"><span class="loading"></span></span><b>${esc(t.label)}</b><span class="tpl-hint">${esc(t.hint)}</span></button>`;
      })
      .join("");
    box.addEventListener("click", (ev) => {
      const b = ev.target.closest(".tpl");
      if (b) previewTemplate(b.dataset.template);
    });
  }
  function syncTemplates() {
    if (!P.TEMPLATE_GROUPS.some((g) => g[0] === ui.tplCat)) ui.tplCat = "all";
    for (const b of $$("#tplCats button")) b.classList.toggle("on", b.dataset.cat === ui.tplCat);
    for (const b of $$("#templates .tpl")) {
      b.hidden = ui.tplCat !== "all" && b.dataset.cat !== ui.tplCat;
      b.classList.toggle("on", b.dataset.template === state.text.template);
    }
  }
  function templateSvg(key) {
    const st = JSON.parse(JSON.stringify(Object.assign({}, state, { assets: null })));
    st.assets = state.assets;
    P.applyTemplate(st, key);
    const ctx = new P.Ctx(st, "art", "tp" + key.replace(/[^a-z0-9]/gi, ""));
    const cw = +st.card.width, ch = +st.card.height;
    const r = P.card.render(ctx, { bleed: 0 });
    const clip = ctx.uid("cl");
    ctx.def(`<clipPath id="${clip}"><rect width="${P.n(cw)}" height="${P.n(ch)}"/></clipPath>`);
    return { svg: P.svgDoc(cw, ch, `<g clip-path="url(#${clip})">${r.svg}</g>`, ctx), cw, ch };
  }
  const blobToDataUrl = (blob) =>
    new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  async function templateImage(key, wPx) {
    const { svg, cw, ch } = templateSvg(key);
    try {
      const blob = await P.exporter.svgToPng(svg, wPx, Math.round((wPx * ch) / cw), "#FFFFFF");
      return { url: await blobToDataUrl(blob) };
    } catch (e) {
      return { svg }; // sem conversão para imagem: usa o próprio desenho
    }
  }
  const uploadId = () => {
    const up = state.assets && state.assets.upload;
    return up ? `${(up.src || "").length}:${up.tol}:${(up.d || "").length}` : "";
  };
  const thumbSig = () => JSON.stringify([state.colors, state.fonts, state.card, state.seal, state.text.date, state.text.time, state.text.dateText, state.text.venue, state.text.address, uploadId()]);
  let thumbJob = 0, thumbTimer = null;
  function scheduleThumbs() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(renderThumbs, 450);
  }
  async function renderThumbs() {
    if (ui.tool !== "modelos") return;
    const job = ++thumbJob;
    const sig = thumbSig();
    const ratio = `${+state.card.width} / ${+state.card.height}`;
    for (const b of $$("#templates .tpl")) {
      const holder = $(".tpl-thumb", b);
      holder.style.aspectRatio = ratio;
      if (b.hidden || holder.dataset.sig === sig) continue;
      await new Promise((r) => setTimeout(r, 16));
      if (job !== thumbJob || ui.tool !== "modelos") return;
      try {
        const img = await templateImage(b.dataset.template, 300);
        if (job !== thumbJob) return;
        holder.innerHTML = img.url ? `<img alt="" src="${img.url}">` : img.svg;
        holder.dataset.sig = sig;
      } catch (e) {
        console.error(e);
      }
    }
  }
  async function previewTemplate(key) {
    const t = P.TEMPLATES[key];
    if (!t) return;
    const short = (s, n) => {
      s = String(s || "").replace(/\s*\n\s*/g, " · ");
      return s.length > n ? s.slice(0, n - 1).trim() + "…" : s;
    };
    const row = (k, v) => (String(v || "").trim() ? `<div><dt>${k}</dt><dd>${esc(short(v, 150))}</dd></div>` : "");
    const html =
      `<div class="tpl-preview"><div class="tpl-big" style="aspect-ratio:${+state.card.width} / ${+state.card.height}"><span class="loading"></span></div><dl>` +
      row("Pré-título", t.eyebrow) + row("Título", t.title) + row("Subtítulo", t.subtitle) + row("Mensagem", t.message) + row("Informações", t.info) + row("Iniciais do selo", t.initials) +
      `</dl></div><p class="note">Data, horário, local e endereço continuam como estão. Dá para desfazer depois.</p>`;
    const answer = modal({ title: `Modelo ${t.label}`, html, ok: "Aplicar modelo", wide: true });
    templateImage(key, 640).then((img) => {
      const el = $("#modalBody .tpl-big");
      if (el) el.innerHTML = img.url ? `<img alt="Prévia do modelo ${esc(t.label)}" src="${img.url}">` : img.svg;
    });
    if (!(await answer)) return;
    P.applyTemplate(state, key);
    changed();
    toast(`Modelo “${t.label}” aplicado.`, 6000, false, { label: "Desfazer", fn: undo });
  }

  function buildSizeSliders() {
    $("#sizeSliders").innerHTML = P.SIZE_KEYS.map(
      ([k, label]) =>
        `<label class="field range"><span class="lbl">${esc(label)} <output data-for="card.sizes.${k}" data-format="pct"></output></span>` +
        `<input type="range" id="sz-${k}" min="0.6" max="1.5" step="0.01" data-bind="card.sizes.${k}"></label>`
    ).join("");
    $("#resetSizes").addEventListener("click", () => {
      for (const [k] of P.SIZE_KEYS) state.card.sizes[k] = 1;
      changed();
      toast("Tamanhos de volta a 100%.", 2500);
    });
  }

  /* ---------- medidas ---------- */
  const PRESET_SHORT = {
    "15x21": ["15 × 21", "padrão"],
    a5: ["A5", "14,8 × 21"],
    "5x7": ["5 × 7 pol.", "12,7 × 17,8"],
    "14x14": ["14 × 14", "quadrado"],
    "10x15": ["10 × 15", "cabe em A4"],
    custom: ["Livre", "personalizado"],
  };
  function buildPresets() {
    const box = $("#presets");
    box.innerHTML = Object.entries(P.CARD_PRESETS)
      .map(([k, p]) => {
        const [name, sub] = PRESET_SHORT[k] || [p.label, ""];
        let shape;
        if (k === "custom") shape = `style="width:20px;height:26px;border-style:dashed"`;
        else {
          const sc = 30 / Math.max(p.w, p.h);
          shape = `style="width:${Math.round(p.w * sc)}px;height:${Math.round(p.h * sc)}px"`;
        }
        return `<button type="button" class="preset" data-preset="${k}" title="${esc(p.label)}"><span class="pv"><i ${shape}></i></span><b>${esc(name)}</b><span>${esc(sub)}</span></button>`;
      })
      .join("");
    box.addEventListener("click", (ev) => {
      const b = ev.target.closest(".preset");
      if (!b) return;
      onChange("card.preset", b.dataset.preset);
      if (b.dataset.preset === "custom") $("#f-cw").focus();
    });
  }
  const specRow = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  function sizeInfo() {
    const box = $("#sizeInfo");
    if (!box) return;
    const geo = P.envelope.geometry(state, 0);
    const cw = +state.card.width, ch = +state.card.height;
    box.innerHTML =
      specRow("Envelope fechado", `${mm(geo.W)} × ${mm(geo.H)} mm`) +
      specRow("Molde aberto", `${mm(geo.bbox.w)} × ${mm(geo.bbox.h)} mm`) +
      specRow("Aba superior", `${mm(geo.depth)} mm`) +
      specRow("Abas laterais", `${mm(geo.s)} mm`) +
      specRow("Folga do convite", `${mm((geo.W - Math.max(cw, ch)) / 2)} mm por lado`);
  }
  const orientLabel = (sh) => (sh.w > sh.h + 0.01 ? "paisagem" : sh.h > sh.w + 0.01 ? "retrato" : "quadrada");
  function printInfo(env, crd) {
    const box = $("#printInfo");
    if (!box) return;
    const pr = state.print;
    const cw = +state.card.width, ch = +state.card.height;
    let html = specRow("Folha do envelope", env && !env.error ? `${esc(paperName(env))} · ${orientLabel(env)}` : "não cabe");
    if (env && !env.error) html += specRow("Área imprimível", `${mm(env.w - 2 * pr.minMargin)} × ${mm(env.h - 2 * pr.minMargin)} mm`);
    html += specRow("Folha do convite", crd && !crd.error ? `${esc(paperName(crd))}${crd.count ? ` · ${crd.count} por folha` : ""}` : "não cabe");
    html += specRow("Área segura do convite", `${mm(cw - 10)} × ${mm(ch - 10)} mm`);
    html += specRow("Sangria", +pr.bleed > 0 ? `${mm(pr.bleed)} mm` : "sem");
    html += specRow("Margem mínima", `${mm(pr.minMargin)} mm`);
    box.innerHTML = html;
  }

  /* ---------- opções com miniatura ---------- */
  const GOLD = "#C8A45D";
  const TILE_SIG = {
    frame: () => "fixo",
    flap: () => "fixo",
    divider: () => JSON.stringify([state.colors.gold, state.colors.goldDark, state.colors.goldLight, state.seal.initials, state.seal.emblem, state.seal.icon, state.fonts.monogram, uploadId(), state.seal.uploadLook]),
    mono: () => TILE_SIG.divider(),
    pattern: () => JSON.stringify([state.colors.navy, state.colors.royal, state.colors.light]),
    liner: () => JSON.stringify([state.liner.color, state.colors.gold, state.colors.goldLight]),
    sealstyle: () => JSON.stringify([state.colors, state.seal, state.fonts.caps, state.fonts.monogram, uploadId()]),
  };
  function tileSvg(kind, v) {
    const vb = (body, box) => `<svg viewBox="${box || "0 0 60 40"}" aria-hidden="true">${body}</svg>`;
    if (kind === "frame") {
      const card = `<rect x="18.5" y="2.5" width="23" height="35" rx=".5" fill="#fff" stroke="currentColor" stroke-opacity=".35" stroke-width=".7"/>`;
      const x0 = 21.3, y0 = 5.3, x1 = 38.7, y1 = 34.7;
      let f = "";
      if (v === "classic") {
        const r = 1.7;
        f = `<path d="M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 0 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 0 ${x1 - r} ${y1}H${x0 + r}A${r} ${r} 0 0 0 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 0 ${x0 + r} ${y0}Z" fill="none" stroke="${GOLD}" stroke-width=".7"/>`;
        f += `<rect x="${x0 + 1}" y="${y0 + 1}" width="${x1 - x0 - 2}" height="${y1 - y0 - 2}" fill="none" stroke="${GOLD}" stroke-width=".35"/>`;
        f += [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => `<path d="M${x} ${y - 1.1}l1.1 1.1-1.1 1.1-1.1-1.1Z" fill="${GOLD}"/>`).join("");
      } else if (v === "deco") {
        const s = 1.6;
        f = `<path d="M${x0 + s} ${y0}H${x1 - s}V${y0 + s}H${x1}V${y1 - s}H${x1 - s}V${y1}H${x0 + s}V${y1 - s}H${x0}V${y0 + s}H${x0 + s}Z" fill="none" stroke="${GOLD}" stroke-width=".7"/>`;
        f += `<rect x="${x0 + 1.2}" y="${y0 + 1.2}" width="${x1 - x0 - 2.4}" height="${y1 - y0 - 2.4}" fill="none" stroke="${GOLD}" stroke-width=".35"/>`;
      } else if (v === "fine") f = `<rect x="${x0 + 0.6}" y="${y0 + 0.6}" width="${x1 - x0 - 1.2}" height="${y1 - y0 - 1.2}" fill="none" stroke="${GOLD}" stroke-width=".4"/>`;
      return vb(card + f);
    }
    if (kind === "flap") {
      const tip = v === "v" ? [30, 25] : [30, 20];
      const flap = v === "v" ? "M10.6 8.6 30 25 49.4 8.6" : v === "curve" ? "M10.6 8.6C13 23.5 47 23.5 49.4 8.6" : "M10.6 8.6 14 20h32l3.4-11.4";
      return vb(
        `<rect x="10" y="8" width="40" height="26" rx="1" fill="#fff" stroke="currentColor" stroke-width="1"/>` +
          `<path d="M10.6 33.4 26 22M49.4 33.4 34 22" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width=".7"/>` +
          `<path d="${flap}" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="${tip[0]}" cy="${tip[1]}" r="2.6" fill="${GOLD}"/>`
      );
    }
    if (kind === "pattern" || kind === "liner") {
      const id = `tl-${kind}-${v}`;
      const bg = kind === "pattern" ? P.envelopeMid(state) : state.liner.color;
      const ink = kind === "pattern" ? state.colors.light : state.colors.gold;
      const op = kind === "pattern" ? 0.5 : 0.8;
      let pat = "";
      if (v === "lattice") {
        let d = "";
        for (let x = -40; x <= 60; x += 7) d += `M${x} 0l28 40M${x + 40} 0l-28 40`;
        pat = `<path d="${d}" stroke="${ink}" stroke-width=".55" fill="none" opacity="${op}"/>`;
      } else if (v === "pinstripe") {
        let d = "";
        for (let x = 2; x < 60; x += 3.4) d += `M${x} 0V40`;
        pat = `<path d="${d}" stroke="${ink}" stroke-width=".45" fill="none" opacity="${op}"/>`;
      } else if (v === "dots") {
        let d = "";
        let row = 0;
        for (let y = 2.5; y < 40; y += 4.6, row++) for (let x = row % 2 ? 4.5 : 2; x < 60; x += 5) d += `M${x - 0.75} ${y}a.75 .75 0 1 0 1.5 0a.75 .75 0 1 0-1.5 0Z`;
        pat = `<path d="${d}" fill="${ink}" opacity="${op}"/>`;
      }
      return vb(`<defs><clipPath id="${id}"><rect x="4" y="3" width="52" height="34" rx="3"/></clipPath></defs><g clip-path="url(#${id})"><rect width="60" height="40" fill="${bg}"/>${pat}</g><rect x="4" y="3" width="52" height="34" rx="3" fill="none" stroke="#091A3A" stroke-opacity=".12" stroke-width=".6"/>`);
    }
    if (kind === "divider") {
      if (v === "none") return vb(`<path d="M18 20h24" stroke="currentColor" stroke-opacity=".3" stroke-width=".8" stroke-dasharray="1.6 1.8"/>`);
      // aproximado: o ornamento tem traços finos, então a miniatura mostra só o centro dele
      const ctx = new P.Ctx(state, "art", `tl-dv-${v}`);
      const body = P.orn.divider(ctx, 30, 20, 34, v);
      return vb(ctx.defsSvg() + body, "10 11.5 40 17");
    }
    if (kind === "mono") {
      const ctx = new P.Ctx(state, "art", `tl-mo-${v}`);
      const body = P.orn.badge(ctx, state, 30, 20, v === "laurel" ? 30 : 24, v);
      return vb(ctx.defsSvg() + body, "8 4 44 32");
    }
    if (kind === "sealstyle") {
      const st = Object.assign({}, state, { seal: Object.assign({}, state.seal, { style: v }) });
      const ctx = new P.Ctx(st, "art", `tl-se-${v}`);
      const body = P.seal.render(ctx, 30);
      return vb(ctx.defsSvg() + body, "-26 -17.5 52 35");
    }
    return "";
  }
  const tileSigs = {};
  function renderTiles(kinds) {
    for (const box of $$("[data-tiles]")) {
      const kind = box.dataset.tiles;
      if (kinds && !kinds.includes(kind)) continue;
      const sig = TILE_SIG[kind] ? TILE_SIG[kind]() : "";
      if (tileSigs[kind] === sig && box.children.length) continue;
      tileSigs[kind] = sig;
      try {
        box.innerHTML = OPTS[kind]
          .map(([v, label]) => `<button type="button" class="tile" data-value="${v}" title="${esc(label)}">${tileSvg(kind, v)}<span>${esc(label)}</span></button>`)
          .join("");
      } catch (e) {
        console.error(e);
        box.innerHTML = OPTS[kind].map(([v, label]) => `<button type="button" class="tile" data-value="${v}"><span>${esc(label)}</span></button>`).join("");
      }
      syncChoice(box);
    }
  }

  /* ---------- selo: prévia grande ---------- */
  let stageSig = "";
  function renderSealStage() {
    const st = $("#sealStage");
    if (!st) return;
    st.style.setProperty("--a", state.colors.navy);
    st.style.setProperty("--b", state.colors.royal);
    const sig = JSON.stringify([state.colors, state.seal, state.fonts.caps, state.fonts.monogram, uploadId()]);
    if (sig === stageSig) return;
    stageSig = sig;
    try {
      const ctx = new P.Ctx(state, "art", "stage");
      const R = 17.5;
      const body = P.seal.render(ctx, 30);
      st.innerHTML = `<svg viewBox="${-R} ${-R} ${2 * R} ${2 * R}" role="img" aria-label="Selo como será impresso">${ctx.defsSvg()}${body}</svg>`;
    } catch (e) {
      console.error(e);
    }
  }

  /* ---------- símbolos e imagem enviada ---------- */
  function buildSymbols() {
    const box = $("#symbols");
    if (!box || !P.SYMBOLS) return;
    box.innerHTML = P.SYMBOL_ORDER.map((k) => {
      const s = P.SYMBOLS[k];
      return `<button type="button" data-icon="${k}" title="${esc(s.label)}"><svg viewBox="0 0 ${s.w} ${s.h}" aria-hidden="true"><path d="${s.d}"/></svg><span>${esc(s.label)}</span></button>`;
    }).join("");
    box.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-icon]");
      if (!b) return;
      state.seal.icon = b.dataset.icon;
      state.seal.emblem = "icon";
      changed();
    });
  }

  /* Processa a imagem nos dois modos (metal e cores originais) de uma vez. */
  async function processUpload(src, tol) {
    const metal = await P.imagetools.process(src, "metal", tol);
    let original = null;
    try {
      original = await P.imagetools.process(src, "original", tol);
    } catch (e) {
      original = null;
    }
    return Object.assign({}, metal, original ? { png: original.png, pw: original.pw, ph: original.ph } : {}, { tol });
  }

  async function handleFile(file) {
    const drop = $("#dropZone");
    drop.classList.add("busy");
    toast("Tirando o fundo e preparando o símbolo…");
    try {
      const ing = await P.imagetools.ingest(file);
      const res = await processUpload(ing.src, state.seal.uploadTol);
      state.assets.upload = Object.assign({ name: ing.name, src: ing.src }, res);
      state.seal.emblem = "upload";
      changed();
      toast("Pronto: fundo retirado. Ajuste a remoção do fundo se precisar.", 4500);
    } catch (e) {
      console.error(e);
      toast(e.message || "Não foi possível usar esta imagem.", 7000, true);
    } finally {
      drop.classList.toggle("busy", false);
    }
  }

  let reprocessTimer = null, reprocessSeq = 0;
  function scheduleReprocess() {
    const up = state.assets && state.assets.upload;
    if (!up || !up.src) return;
    clearTimeout(reprocessTimer);
    reprocessTimer = setTimeout(async () => {
      const seq = ++reprocessSeq;
      const tol = state.seal.uploadTol;
      try {
        const res = await processUpload(up.src, tol);
        if (seq !== reprocessSeq || state.assets.upload !== up) return;
        state.assets.upload = Object.assign({ name: up.name, src: up.src }, res);
        sync();
        schedule();
        persist();
      } catch (e) {
        toast(e.message, 5000, true);
      }
    }, 220);
  }

  function bindUpload() {
    const input = $("#symbolFile"), drop = $("#dropZone");
    if (!input || !drop) return;
    input.addEventListener("change", () => {
      if (input.files[0]) handleFile(input.files[0]);
      input.value = "";
    });
    ["dragenter", "dragover"].forEach((t) =>
      drop.addEventListener(t, (ev) => {
        ev.preventDefault();
        drop.classList.add("over");
      })
    );
    ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.toggle("over", false)));
    drop.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    $("#removeUpload").addEventListener("click", async () => {
      const ok = await modal({
        title: "Remover a imagem?",
        html: "<p>A imagem enviada sai do selo, do convite e dos adesivos, e o centro do selo volta para as iniciais. Para usá-la de novo será preciso enviá-la outra vez.</p>",
        ok: "Remover imagem",
        danger: true,
      });
      if (!ok) return;
      state.assets.upload = null;
      if (state.seal.emblem === "upload") state.seal.emblem = "initials";
      changed();
      toast("Imagem removida.", 3000);
    });
  }

  let lastUpload, lastLook = "", lastGold = "";
  function uploadUI() {
    const up = state.assets && state.assets.upload;
    const look = state.seal.uploadLook;
    const c = state.colors;
    const gold = `${c.goldDark}${c.gold}${c.goldLight}`;
    if (up === lastUpload && look === lastLook && gold === lastGold) return;
    lastUpload = up;
    lastLook = look;
    lastGold = gold;
    const box = $("#uploadResult");
    if (!box) return;
    $("#dropTitle").textContent = up ? "Trocar imagem" : "Enviar imagem ou logotipo";
    $("#removeUpload").hidden = !up;
    box.hidden = !up;
    if (!up) return;
    $("#upOriginal").innerHTML = `<img src="${up.src}" alt="Imagem enviada">`;
    if (look === "original" && up.png) {
      $("#upResult").innerHTML = `<img src="${up.png}" alt="Imagem sem fundo">`;
    } else if (up.d) {
      $("#upResult").innerHTML =
        `<svg viewBox="0 0 ${up.vw} ${up.vh}" aria-label="Imagem sem fundo"><defs><linearGradient id="upg" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="${c.goldDark}"/><stop offset=".45" stop-color="${c.gold}"/><stop offset=".6" stop-color="${c.goldLight}"/><stop offset="1" stop-color="${c.goldDark}"/>` +
        `</linearGradient></defs><path d="${up.d}" fill="url(#upg)"/></svg>`;
    } else $("#upResult").innerHTML = "";
  }

  /* ---------- ferramentas, etapas e painel ---------- */
  // ao abrir uma ferramenta, a prévia vai para onde ela faz efeito (se ainda não estiver lá)
  const PREFERRED_STEP = {
    textos: ["card", ["envelope", "extras"]],
    cartoes: ["card", ["envelope", "extras"]],
    envelope: ["envelope", ["card"]],
    fontes: ["card", ["envelope", "extras"]],
    modelos: ["card", ["envelope", "extras"]],
  };
  function showTool(name, opts) {
    const o = opts || {};
    if (!TOOLS.includes(name)) name = "cores";
    const changedTool = ui.tool !== name;
    ui.tool = name;
    for (const b of $$(".rail button")) {
      const on = b.dataset.tool === name;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    }
    for (const s of $$(".tool")) s.classList.toggle("on", s.dataset.tool === name);
    if (changedTool) $("#panelScroll").scrollTop = 0;
    const wasPrint = printView;
    if (name === "impressao") printView = true;
    else if (changedTool) printView = false;
    let needRender = printView !== wasPrint;
    if (!printView && !o.keepStep) {
      const pref = PREFERRED_STEP[name];
      if (pref && pref[1].includes(ui.step)) {
        ui.step = pref[0];
        needRender = true;
      }
    }
    if (needRender) ppmZoom = 0;
    if (mq.matches && o.open !== false) app.classList.add("panel-open");
    saveUi();
    syncChrome();
    if (needRender) render();
    else afterRender();
  }

  function setStep(s) {
    if (!STEPS.includes(s)) return;
    ui.step = s;
    printView = false;
    ppmZoom = 0;
    saveUi();
    syncChrome();
    render();
  }

  const viewMode = () => (printView ? "print" : ui.step);

  function syncChrome() {
    const mode = viewMode();
    for (const b of $$(".step")) {
      const on = !printView && b.dataset.step === ui.step;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    }
    for (const el of $$("#wsContext [data-ctx]")) el.classList.toggle("show", el.dataset.ctx === mode && !(viewing && mode === "print"));
    for (const b of $$("#cardViewSeg button")) b.classList.toggle("on", b.dataset.cardview === ui.cardView);
    for (const b of $$("#extrasSeg button")) b.classList.toggle("on", b.dataset.extra === ui.extra);
  }

  /* seções: abrir uma fecha as outras da mesma ferramenta */
  function openSec(details, scroll) {
    if (!details) return;
    for (const d of $$(":scope > .sec", details.parentElement)) if (d !== details && d.open) d.open = false;
    details.open = true;
    if (scroll) setTimeout(() => details.scrollIntoView({ block: "start", behavior: "smooth" }), 30);
  }
  function bindSections() {
    for (const s of $$("details.sec > summary")) {
      s.addEventListener("click", () => {
        const d = s.parentElement;
        if (!d.open) for (const o of $$(":scope > .sec", d.parentElement)) if (o !== d && o.open) o.open = false;
      });
    }
  }

  /* leva até um texto no painel Textos, com a gaveta de estilo aberta */
  function revealText(key) {
    showTool("textos", { keepStep: true });
    const item = $(`.titem[data-key="${key}"]`);
    if (!item) return;
    openSec(item.closest("details"));
    toggleStyle($(".tstyle", item), true);
    setTimeout(() => {
      item.scrollIntoView({ block: "center", behavior: "smooth" });
      item.classList.remove("flash");
      void item.offsetWidth;
      item.classList.add("flash");
      const f = $("input, textarea", item);
      if (f) f.focus({ preventScroll: true });
    }, 60);
  }
  function revealField(tool, sec, focusSel) {
    showTool(tool, { keepStep: true });
    const d = $(`.tool[data-tool="${tool}"] details[data-sec="${sec}"]`);
    openSec(d, true);
    if (focusSel) setTimeout(() => { const f = $(focusSel); if (f) f.focus({ preventScroll: true }); }, 80);
  }

  /* ---------- edição direta na prévia ---------- */
  const FIELD_INFO = {
    "envelope.recipient": { label: "Destinatário · frente do envelope", placeholder: "vazio = linha para escrever à mão", tool: "envelope", sec: "front", focus: "#e-recipient" },
    "envelope.sender": { label: "Remetente · verso do envelope", placeholder: "", tool: "envelope", sec: "back", focus: "#e-sender" },
  };
  let ie = null; // { path, orig, multiline }
  function openInline(path, anchor) {
    const key = path.split(".")[1];
    const it = path.indexOf("text.") === 0 ? P.TEXT_ITEMS.find((t) => t.key === key) : null;
    const info = it ? { label: it.label, multiline: !!it.multiline, placeholder: "" } : FIELD_INFO[path];
    if (!info) return;
    closeCpop();
    closeInline(true);
    const ed = $("#inlineEd"), ta = $("#ieText");
    const v = P.get(state, path);
    ie = { path, orig: v == null ? "" : String(v), multiline: !!info.multiline };
    $("#ieLabel").textContent = info.label;
    ta.value = ie.orig;
    ta.placeholder = info.placeholder || "";
    ta.rows = info.multiline ? Math.min(5, Math.max(2, ie.orig.split("\n").length + 1)) : 1;
    $(".ie-foot span", ed).textContent = info.multiline ? "Enter confirma · Shift+Enter quebra a linha · Esc desfaz" : "Enter confirma · Esc desfaz";
    ed.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = ed.offsetWidth, h = ed.offsetHeight;
    const left = P.clamp(r.left + r.width / 2 - w / 2, 12, window.innerWidth - w - 12);
    let top = r.bottom + 10;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 10);
    ed.style.left = `${left}px`;
    ed.style.top = `${top}px`;
    ta.focus();
    ta.select();
  }
  function closeInline(keep) {
    if (!ie) return;
    if (!keep && String(P.get(state, ie.path) || "") !== ie.orig) onChange(ie.path, ie.orig);
    ie = null;
    $("#inlineEd").hidden = true;
  }
  function bindInline() {
    const ta = $("#ieText");
    ta.addEventListener("input", () => {
      if (!ie) return;
      if (!ie.multiline && /\n/.test(ta.value)) ta.value = ta.value.replace(/\n/g, " ");
      onChange(ie.path, ta.value);
    });
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeInline(false);
      } else if (ev.key === "Enter" && !(ev.shiftKey && ie && ie.multiline)) {
        ev.preventDefault();
        closeInline(true);
      }
    });
    $("#ieClose").addEventListener("click", () => closeInline(true));
    $("#ieMore").addEventListener("click", () => {
      if (!ie) return;
      const path = ie.path;
      closeInline(true);
      if (path.indexOf("text.") === 0) revealText(path.split(".")[1]);
      else {
        const f = FIELD_INFO[path];
        revealField(f.tool, f.sec, f.focus);
      }
    });
    document.addEventListener("pointerdown", (ev) => {
      if (ie && !ev.target.closest("#inlineEd") && !ev.target.closest(".hit")) closeInline(true);
    });
  }
  function onHit(field, el) {
    if (field === "@selo") return showTool("selo", { keepStep: true });
    if (field === "@cartoes") return revealField("cartoes", "divider");
    if (field === "@envelope") return revealField("envelope", "front");
    if (field === "text.date") return revealField("textos", "data", "#f-date");
    openInline(field, el);
  }

  /* ---------- prévia ---------- */
  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => requestAnimationFrame(render), printView ? 260 : 70);
  }

  function cardPreview(guides) {
    const st = state;
    const cw = +st.card.width, ch = +st.card.height;
    const b = +st.print.bleed || 0;
    const pad = (guides ? b : 0) + 8;
    const ctx = new P.Ctx(st, "art", "pv");
    const r = P.card.render(ctx, { bleed: guides ? b : 0, guides, hits: !viewing });
    const shadow = ctx.uid("sh");
    ctx.def(
      `<filter id="${shadow}" x="-15%" y="-15%" width="130%" height="135%">` +
        `<feDropShadow dx="0" dy="0.3" stdDeviation="0.35" flood-color="#091A3A" flood-opacity="0.16"/>` +
        `<feDropShadow dx="0" dy="2.4" stdDeviation="3.2" flood-color="#091A3A" flood-opacity="0.16"/></filter>`
    );
    let inner = r.svg;
    if (!guides) {
      const trim = ctx.uid("tr");
      ctx.def(`<clipPath id="${trim}"><rect width="${P.n(cw)}" height="${P.n(ch)}"/></clipPath>`);
      inner = `<g clip-path="url(#${trim})">${r.svg}</g>`;
    }
    const e = guides ? b : 0;
    const body =
      `<g transform="translate(${P.n(pad)} ${P.n(pad)})">` +
      `<rect x="${P.n(-e)}" y="${P.n(-e)}" width="${P.n(cw + 2 * e)}" height="${P.n(ch + 2 * e)}" fill="#fff" filter="url(#${shadow})"/>` +
      `${inner}</g>`;
    const w = cw + 2 * pad, h = ch + 2 * pad;
    return { w, h, bare: true, svg: P.svgDoc(w, h, body, ctx), overflow: r.overflow };
  }

  /* ---------- folhas de impressão (as mesmas páginas do PDF completo) ---------- */
  function printLabels() {
    const pr = state.print;
    const labels = ["Envelope planificado", "Convite"];
    if (pr.liner) labels.push("Forro do envelope");
    if (pr.stickers) labels.push("Selos adesivos");
    if (pr.dieline) labels.push("Faca do envelope");
    if (pr.foil) {
      labels.push("Hot stamping · envelope", "Hot stamping · convite");
      if (pr.stickers && state.colors.sealMode !== "wax") labels.push("Hot stamping · selos");
    }
    if (pr.ficha) labels.push("Ficha técnica e montagem");
    return labels;
  }
  const printCount = () => printLabels().length;
  let printCache = null;
  function printPages() {
    const sig = snapshot() + uploadId();
    if (printCache && printCache.sig === sig) return printCache;
    let pages = null, error = null;
    try {
      const labels = printLabels();
      pages = P.pdf.sheetsFor("all", state).map((sheet, i) => ({ sheet, label: labels[i] || `Folha ${i + 1}` }));
    } catch (e) {
      error = e.message;
    }
    printCache = { sig, pages, error };
    return printCache;
  }
  const prefixIds = (svg, pre) => svg.replace(/(\s)id="/g, `$1id="${pre}`).replace(/url\(#/g, `url(#${pre}`).replace(/href="#/g, `href="#${pre}`);
  function paperShort(sh) {
    if (sh.paperKey === "fit") return "ajustada";
    if (sh.paperKey === "exact") return "tamanho final";
    const key = sh.paperKey || Object.keys(P.PAPERS).find((k) => {
      const p = P.PAPERS[k];
      return (Math.abs(p.w - sh.w) < 0.5 && Math.abs(p.h - sh.h) < 0.5) || (Math.abs(p.h - sh.w) < 0.5 && Math.abs(p.w - sh.h) < 0.5);
    });
    return key && P.PAPERS[key] ? P.PAPERS[key].label.split(" — ")[0] : "folha";
  }
  function printBoard() {
    const pc = printPages();
    if (pc.error) return { error: pc.error };
    const html = pc.pages
      .map(
        (p, i) =>
          `<figure class="pp" data-i="${i}">${prefixIds(p.sheet.svg, `pg${i}-`)}` +
          `<figcaption><b>${i + 1} · ${esc(p.label)}</b> ${esc(paperShort(p.sheet))} · ${mm(p.sheet.w)} × ${mm(p.sheet.h)} mm</figcaption></figure>`
      )
      .join("");
    return { html, pages: pc.pages.map((p) => ({ w: p.sheet.w, h: p.sheet.h })), w: 1, h: 1 };
  }
  function renderPageList() {
    const box = $("#pageList");
    if (!box) return;
    const pc = printPages();
    if (pc.error) {
      box.innerHTML = `<li class="err"><b>${esc(pc.error)}</b></li>`;
      return;
    }
    box.innerHTML = pc.pages
      .map((p, i) => `<li data-i="${i}" tabindex="0" role="button" title="Ver esta folha"><b>${esc(p.label)}</b><small>${esc(paperShort(p.sheet))} · ${mm(p.sheet.w)} × ${mm(p.sheet.h)} mm</small></li>`)
      .join("");
  }
  function focusPage(i) {
    if (!printView) {
      printView = true;
      syncChrome();
      render();
    }
    if (!current || !current.layout) return;
    const it = current.layout.items[i];
    if (!it) return;
    ppmZoom = fitPpm(it.w, it.h) * 0.94;
    applyZoom();
    const cv = $("#canvas"), host = $("#sheet");
    const cr = cv.getBoundingClientRect(), br = host.getBoundingClientRect();
    const ppm = effPpm();
    cv.scrollLeft += br.left + (it.x + it.w / 2) * ppm - (cr.left + cr.width / 2);
    cv.scrollTop += br.top + (it.y + it.h / 2) * ppm - (cr.top + cr.height / 2);
  }

  function place(sh) {
    const host = $("#sheet");
    host.className = "board" + (sh.pages ? " print" : sh.bare ? "" : " paper");
    host.style.width = host.style.height = "";
    host.innerHTML = sh.html || sh.svg;
    current = { w: sh.w, h: sh.h, pages: sh.pages || null };
  }

  function availSize() {
    const cv = $("#canvas");
    const cs = getComputedStyle(cv);
    return [
      Math.max(60, cv.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
      Math.max(60, cv.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)),
    ];
  }
  function fitPpm(w, h) {
    const [aw, ah] = availSize();
    return P.clamp(Math.min(aw / w, ah / h), ZMIN, ZMAX);
  }
  const effPpm = () => ppmZoom || (current && current.fit) || 1;

  /* distribui as folhas em linhas, escolhendo o arranjo que as mostra maiores */
  function packRows(pages, rows, G) {
    const total = pages.reduce((s, p) => s + p.w, 0) + G * (pages.length - rows);
    const target = total / rows;
    const lines = [[]];
    let lw = 0;
    for (const p of pages) {
      const cur = lines[lines.length - 1];
      const add = (cur.length ? G : 0) + p.w;
      if (cur.length && lw + add > target * 1.08 && lines.length < rows) {
        lines.push([p]);
        lw = p.w;
      } else {
        cur.push(p);
        lw += add;
      }
    }
    const widths = lines.map((l) => l.reduce((s, p, i) => s + p.w + (i ? G : 0), 0));
    const W = Math.max(...widths);
    const items = [];
    let y = 0;
    lines.forEach((l, li) => {
      const lh = Math.max(...l.map((p) => p.h));
      let x = (W - widths[li]) / 2;
      for (const p of l) {
        items.push({ x, y, w: p.w, h: p.h });
        x += p.w + G;
      }
      y += lh + G;
    });
    return { W, H: y - G, items, G };
  }
  function layoutPrint() {
    const c = current;
    const [aw, ah0] = availSize();
    const ah = ah0 - 26; // legenda da última linha
    const choose = (G) => {
      let best = null;
      for (let rows = 1; rows <= c.pages.length; rows++) {
        const L = packRows(c.pages, rows, G);
        const s = Math.min(aw / L.W, ah / L.H);
        if (!best || s > best.s + 1e-9) best = Object.assign(L, { s });
      }
      return best;
    };
    let L = choose(30);
    const G2 = Math.max(30, 36 / L.s);
    if (G2 > 30.5) L = choose(G2);
    c.layout = L;
    c.w = L.W;
    c.h = L.H;
    c.fit = P.clamp(L.s, ZMIN, ZMAX);
    const ppm = ppmZoom || c.fit;
    const host = $("#sheet");
    host.style.width = `${L.W * ppm}px`;
    host.style.height = `${L.H * ppm + 26}px`;
    host.classList.toggle("tiny", L.G * ppm < 22);
    $$(".pp", host).forEach((el, i) => {
      const it = L.items[i];
      if (!it) return;
      el.style.left = `${it.x * ppm}px`;
      el.style.top = `${it.y * ppm}px`;
      const svg = $(":scope > svg", el);
      if (svg) {
        svg.style.width = `${it.w * ppm}px`;
        svg.style.height = `${it.h * ppm}px`;
      }
    });
  }

  function applyZoom() {
    if (current) {
      if (current.pages) layoutPrint();
      else {
        const svg = $("#sheet > svg");
        current.fit = fitPpm(current.w, current.h);
        const ppm = ppmZoom || current.fit;
        if (svg) {
          svg.style.width = `${current.w * ppm}px`;
          svg.style.height = `${current.h * ppm}px`;
        }
      }
    }
    const label = $("#zoomLabel");
    if (label) label.textContent = current ? `${Math.round((effPpm() / PX_PER_MM) * 100)}%` : "—";
  }
  function zoomAt(ppm, cx, cy) {
    if (!current) return;
    const cv = $("#canvas"), host = $("#sheet");
    const old = effPpm();
    ppm = P.clamp(ppm, ZMIN, ZMAX);
    const cr = cv.getBoundingClientRect();
    if (cx == null) {
      cx = cr.left + cr.width / 2;
      cy = cr.top + cr.height / 2;
    }
    const br = host.getBoundingClientRect();
    const mx = (cx - br.left) / old, my = (cy - br.top) / old;
    ppmZoom = ppm;
    applyZoom();
    const br2 = host.getBoundingClientRect();
    cv.scrollLeft += br2.left + mx * ppm - cx;
    cv.scrollTop += br2.top + my * ppm - cy;
  }
  const zoomBy = (f) => zoomAt(effPpm() * f);
  function fitZoom() {
    ppmZoom = 0;
    applyZoom();
  }

  function render() {
    const guides = !!state.view.guides && !viewing;
    const envOv = Object.assign({ hits: !viewing }, guides ? { safe: true } : {});
    let env = null, crd = null;
    try {
      env = P.sheets.envelopeSheet(state, "art", envOv);
      crd = P.sheets.cardSheet(state, "art");
    } catch (e) {
      console.error(e);
    }
    const mode = viewMode();
    let sh = null;
    try {
      if (mode === "print") sh = printBoard();
      else if (mode === "envelope") sh = env && env.error ? P.sheets.envelopeSheet(state, "art", Object.assign({}, envOv, { envPaper: "fit" })) : env;
      else if (mode === "card") sh = ui.cardView === "sheet" && crd && !crd.error ? crd : cardPreview(guides);
      else if (mode === "mockup") {
        const cv = $("#canvas");
        const layout = cv.clientWidth / Math.max(1, cv.clientHeight) > 2.1 ? "row" : "grid";
        sh = Object.assign(P.scene.mockup(state, layout), { bare: true });
      } else sh = ui.extra === "stickers" ? P.sheets.stickerSheet(state, "art") : P.sheets.linerSheet(state, "art");
      if (!sh) throw new Error("prévia indisponível");
      if (sh.error) throw new Error(sh.error);
      place(sh);
    } catch (e) {
      console.error(e);
      const host = $("#sheet");
      host.className = "board";
      host.style.width = host.style.height = "";
      host.innerHTML = `<div class="error">Não foi possível desenhar a prévia: ${esc(e.message)}</div>`;
      current = null;
    }
    if (env && crd) {
      dims(env, crd, mode, sh);
      preflight(env, crd);
      printInfo(env, crd);
      setSum("envpaper", env.error ? "Não cabe" : paperName(env));
      setSum("cardpaper", crd.error ? "Não cabe" : `${paperName(crd)}${crd.count > 1 ? ` · ${crd.count} por folha` : ""}`);
    }
    applyZoom();
    afterRender();
  }

  /* trabalhos que só interessam à ferramenta aberta */
  function afterRender() {
    const t = ui.tool;
    if (t === "selo") {
      renderSealStage();
      renderTiles(["sealstyle"]);
    } else if (t === "cartoes") renderTiles(["frame", "divider", "mono"]);
    else if (t === "envelope") renderTiles(["flap", "pattern", "liner"]);
    else if (t === "modelos") scheduleThumbs();
    else if (t === "impressao") renderPageList();
  }

  function paperName(sheet) {
    if (!sheet || sheet.error) return "—";
    if (sheet.paperKey === "fit") return `ajustada ${mm(sheet.w)} × ${mm(sheet.h)} mm`;
    if (sheet.paperKey === "exact") return "tamanho final";
    return P.PAPERS[sheet.paperKey] ? P.PAPERS[sheet.paperKey].label.split(" — ")[0] : sheet.paperKey;
  }

  function dims(env, crd, mode, shown) {
    const geo = env.geo || P.envelope.geometry(state, 0);
    const cw = +state.card.width, ch = +state.card.height;
    let html = "";
    if (mode === "envelope") html = `Envelope fechado <b>${mm(geo.W)} × ${mm(geo.H)} mm</b> · molde aberto <b>${mm(geo.bbox.w)} × ${mm(geo.bbox.h)} mm</b> · folha <b>${esc(paperName(env))}</b>`;
    else if (mode === "card")
      html =
        ui.cardView === "sheet" && !crd.error
          ? `Folha <b>${esc(paperName(crd))}</b>${crd.count ? ` · <b>${crd.count}</b> por folha` : ""} · convite ${mm(cw)} × ${mm(ch)} mm`
          : `Convite <b>${mm(cw)} × ${mm(ch)} mm</b>${+state.print.bleed ? ` · sangria ${mm(state.print.bleed)} mm` : ""}`;
    else if (mode === "mockup") html = `Envelope <b>${mm(geo.W)} × ${mm(geo.H)} mm</b> · convite <b>${mm(cw)} × ${mm(ch)} mm</b>`;
    else if (mode === "extras")
      html =
        ui.extra === "stickers"
          ? `${shown && shown.count ? `<b>${shown.count}</b> selos` : "Selos"} de <b>${mm(state.stickers.diameter)} mm</b> · folha <b>A4</b>`
          : `Forro do envelope · folha <b>${esc(paperName(shown))}</b>`;
    else html = `<b>${printCount()}</b> folhas · no PDF ficam em tamanho real (escala 100%)`;
    $("#dims").innerHTML = html;
  }

  function contrast(a, b) {
    const la = P.color.luminance(a), lb = P.color.luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function preflight(env, crd) {
    const items = [];
    const add = (level, msg) => items.push({ level, msg });
    const geo = env.geo || P.envelope.geometry(state, 0);
    if (env.error) add("err", esc(env.error) + " Escolha um papel maior ou “Ajustado ao molde” em Impressão.");
    else if (env.forced) add("warn", `O molde cabe em ${esc(paperName(env))}, mas sem espaço para marcas externas e legenda.`);
    else add("", `Envelope em escala 100% na folha ${esc(paperName(env))}, com margem de pelo menos ${mm(state.print.minMargin)} mm.`);

    const cw = +state.card.width, ch = +state.card.height;
    const fx = (geo.W - Math.max(cw, ch)) / 2, fy = (geo.H - Math.min(cw, ch)) / 2;
    if (fx < 1.5 || fy < 1.5) add("err", `Convite justo demais: folga de ${mm(fx)} × ${mm(fy)} mm. Aumente a folga em Medidas.`);
    else if (fx < 2.5 || fy < 2.5) add("warn", `Folga pequena (${mm(fx)} mm por lado). Para papel grosso, use 3 mm ou mais.`);
    else add("", `O convite entra no envelope com ${mm(fx)} mm de folga por lado.`);

    if (crd.error) add("err", esc(crd.error));
    else if (crd.overflow) add("err", "O conteúdo do convite não cabe na área útil. Encurte os textos ou reduza os tamanhos em Fontes.");
    else add("", `Convite: ${crd.count} por folha (${esc(paperName(crd))}), textos dentro da área de segurança.`);

    const c = state.colors;
    const bg = P.cardBg(state);
    if (contrast(c.cardText, bg) < 3) add("warn", "Pouco contraste entre o texto e o fundo do convite. Use “Ajustar o texto ao fundo” em Cores.");
    if (contrast(c.light, P.envelopeMid(state)) < 1.8) add("warn", "Os detalhes do envelope quase não aparecem sobre o fundo. Escolha um tom mais claro ou mais escuro em Cores.");

    if (!geo.seal.fits) add("warn", "O selo está grande para a aba superior. Reduza o diâmetro em Selo ou aprofunde a aba em Envelope.");
    else add("", `Selo de ${mm(geo.seal.r * 2)} mm dentro da aba, girado para ficar de pé no verso.`);

    if (geo.glue.length < 2) add("warn", "Abas laterais estreitas: pouca área para cola. Aumente a largura das abas em Envelope.");
    else add("", "Áreas de cola nas abas laterais, escondidas pela aba inferior depois de montado.");
    add("", `Fechamento com ${mm(geo.overlap)} mm de sobreposição entre a aba superior e a inferior.`);
    if (!(+state.print.bleed > 0)) add("warn", "Sem sangria: qualquer desvio no corte deixa um filete branco na borda.");
    else add("", `Sangria de ${mm(state.print.bleed)} mm. PDF vetorial, com os textos em curvas.`);

    $("#preflight").innerHTML = items.map((i) => `<li class="${i.level}">${i.msg}</li>`).join("");
    const nErr = items.filter((i) => i.level === "err").length;
    const nWarn = items.filter((i) => i.level === "warn").length;
    const btn = $("#checkBtn");
    btn.classList.toggle("err", nErr > 0);
    btn.classList.toggle("warn", !nErr && nWarn > 0);
    const text = nErr ? `${nErr} problema${nErr > 1 ? "s" : ""}` : nWarn ? `${nWarn} alerta${nWarn > 1 ? "s" : ""}` : "Pronto para produção";
    $("#checkSummary").textContent = text;
    btn.setAttribute("aria-label", `Verificação de produção: ${text}. ${items.length} itens conferidos.`);
    $("#checksPop h4").textContent = `Verificação de produção · ${items.length - nErr - nWarn} de ${items.length} itens ok`;
  }

  /* ---------- avisos, confirmações ---------- */
  let toastTimer = null;
  function toast(msg, ms, isError, action) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("error", !!isError);
    t.classList.toggle("has-act", !!action);
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "t-act";
      b.textContent = action.label;
      b.addEventListener("click", () => {
        t.classList.remove("show");
        action.fn();
      });
      t.appendChild(b);
    }
    t.classList.add("show");
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  let modalResolve = null, modalReturn = null;
  function modal(o) {
    const m = $("#modal");
    if (modalResolve) closeModal(false);
    $("#modalTitle").textContent = o.title || "";
    $("#modalBody").innerHTML = o.html || "";
    const ok = $("#modalOk");
    ok.textContent = o.ok || "Confirmar";
    ok.classList.toggle("danger", !!o.danger);
    $("#modalCancel").textContent = o.cancel || "Cancelar";
    $(".modal-card", m).classList.toggle("wide", !!o.wide);
    modalReturn = document.activeElement;
    m.hidden = false;
    setTimeout(() => ok.focus(), 20);
    return new Promise((res) => (modalResolve = res));
  }
  function closeModal(value) {
    const m = $("#modal");
    if (m.hidden) return;
    m.hidden = true;
    const r = modalResolve;
    modalResolve = null;
    if (r) r(value);
    if (modalReturn && modalReturn.focus && document.contains(modalReturn)) modalReturn.focus();
  }
  function bindModal() {
    const m = $("#modal");
    $("#modalOk").addEventListener("click", () => closeModal(true));
    $("#modalCancel").addEventListener("click", () => closeModal(false));
    m.addEventListener("click", (ev) => {
      if (ev.target === m) closeModal(false);
    });
    m.addEventListener("keydown", (ev) => {
      if (ev.key !== "Tab") return;
      const f = $$("button, [href], input, select, textarea", m).filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    });
  }

  /* ---------- exportação ---------- */
  /*
   * Entrega um arquivo ao usuário. Localmente (file://) usa um link de download;
   * online, pede ao visualizador para salvar (o usuário confirma nome e tamanho).
   * Resolve true quando o arquivo foi entregue e false quando o usuário recusou.
   */
  async function saveFile(filename, blob) {
    if (embedded) {
      const dl = await downloadsReady;
      if (!dl) throw { code: "unavailable" };
      try {
        await dl.save({ filename, data: blob });
        return true;
      } catch (e) {
        if (e && e.code === "declined") return false;
        throw e;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.parentNode.removeChild(a);
    }, 1500);
    return true;
  }

  function saveErrorMessage(e) {
    const code = e && e.code;
    if (code === "rate_limited") return "Já existe um pedido de download aberto. Responda a ele e tente de novo.";
    if (code === "rejected_extension" || code === "extension_not_enabled")
      return "Esta visualização não permite baixar este tipo de arquivo. Abra o editor pelo claude.ai ou use a versão local (papelaria/index.html).";
    if (code === "too_large") return "O arquivo ficou grande demais para esta visualização. Exporte as peças separadamente.";
    if (code) return "Downloads não estão disponíveis nesta visualização. Abra o editor pelo claude.ai ou use a versão local (papelaria/index.html).";
    return e && e.message ? e.message : String(e);
  }

  async function doExport(kind) {
    closeMenus();
    if (busy) return;
    busy = true;
    const buttons = $$("[data-export]");
    buttons.forEach((b) => (b.disabled = true));
    const isPng = kind.indexOf("png") === 0;
    const open = !embedded && !isPng && state.view.exportAction === "open";
    const win = open ? window.open("", "_blank") : null;
    toast(isPng ? "Gerando imagem em alta resolução…" : "Gerando PDF vetorial…");
    await new Promise((r) => setTimeout(r, 30));
    let res = null;
    try {
      if (kind === "png-card") res = await P.exporter.cardPng(state, 300);
      else if (kind === "png-scene") res = await P.exporter.presentationPng(state);
      else res = await P.pdf.exportPdf(kind, state, { onProgress: (i, n) => toast(`Gerando PDF… página ${i} de ${n}`) });
    } catch (e) {
      if (win) win.close();
      console.error(e);
      toast(`Não foi possível gerar o arquivo: ${e.message}`, 9000, true);
    }
    if (res) {
      const done = isPng
        ? `Imagem pronta: ${res.filename}`
        : `PDF pronto: ${res.filename} (${res.pages.length} página${res.pages.length > 1 ? "s" : ""}). Imprima em tamanho real, escala 100%.`;
      try {
        if (win) {
          win.location.href = URL.createObjectURL(res.blob);
          toast(done, 7000);
        } else {
          if (embedded) toast("Arquivo gerado. Confirme o download na janela que apareceu.");
          const ok = await saveFile(res.filename, res.blob);
          toast(ok ? done : "Download cancelado.", ok ? 7000 : 4000);
        }
      } catch (e) {
        toast(saveErrorMessage(e), 9000, true);
      }
    }
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
  }

  /* menus Projeto e Exportar */
  const MENUS = [["#projectBtn", "#projectMenu"], ["#exportBtn", "#exportMenu"]];
  function closeMenus() {
    for (const [b, m] of MENUS) {
      const menu = $(m);
      if (menu && !menu.hidden) {
        menu.hidden = true;
        $(b).setAttribute("aria-expanded", "false");
      }
    }
  }
  const menuOpen = () => MENUS.some(([, m]) => !$(m).hidden);
  function bindMenus() {
    for (const [b, m] of MENUS) {
      const btn = $(b), menu = $(m);
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const willOpen = menu.hidden;
        closeMenus();
        if (!willOpen) return;
        menu.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        const first = $("button:not(:disabled), label", menu);
        if (first) first.focus();
      });
      menu.addEventListener("keydown", (ev) => {
        if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
        ev.preventDefault();
        const items = $$("button:not(:disabled), label", menu);
        const i = items.indexOf(document.activeElement);
        const next = items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
        if (next) next.focus();
      });
    }
    document.addEventListener("click", (ev) => {
      if (!ev.target.closest(".menu-wrap")) closeMenus();
      if (!ev.target.closest("#checksPop") && !ev.target.closest("#checkBtn")) toggleChecks(false);
    });
    $(".menu-item[for=loadProject]").tabIndex = 0;
    $(".menu-item[for=loadProject]").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        $("#loadProject").click();
      }
    });
  }
  function toggleChecks(force) {
    const pop = $("#checksPop");
    const open = force != null ? force : pop.hidden;
    if (open === !pop.hidden) return;
    pop.hidden = !open;
    $("#checkBtn").setAttribute("aria-expanded", open ? "true" : "false");
  }

  /* ---------- projeto ---------- */
  async function saveProject() {
    closeMenus();
    flushSave();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    try {
      const ok = await saveFile("projeto-papelaria.json", blob);
      toast(ok ? "Projeto salvo em projeto-papelaria.json" : "Download cancelado.", 4000);
    } catch (e) {
      toast(saveErrorMessage(e), 8000, true);
    }
  }

  function loadProject(file) {
    closeMenus();
    const fr = new FileReader();
    fr.onload = async () => {
      let next;
      try {
        next = P.mergeDefaults(P.defaults(), P.migrate(JSON.parse(fr.result)));
      } catch (e) {
        toast("Arquivo de projeto inválido.", 5000, true);
        return;
      }
      const ok = await modal({ title: "Abrir este projeto?", html: `<p>“${esc(file.name)}” vai substituir o projeto atual. Se mudar de ideia, use desfazer.</p>`, ok: "Abrir projeto" });
      if (!ok) return;
      state = next;
      changed();
      render();
      toast("Projeto aberto.", 3000);
    };
    fr.readAsText(file);
  }

  async function resetProject() {
    closeMenus();
    const ok = await modal({
      title: "Restaurar o padrão?",
      html: "<p>Textos, cores, fontes e medidas voltam ao início. A imagem enviada continua disponível e você pode desfazer depois.</p>",
      ok: "Restaurar",
      danger: true,
    });
    if (!ok) return;
    const keep = state.assets;
    state = P.defaults();
    state.assets = keep; // a imagem enviada continua disponível
    changed();
    render();
    toast("Tudo restaurado para o padrão.", 6000, false, { label: "Desfazer", fn: undo });
  }

  /* ---------- área de trabalho: arrastar, zoom, tela cheia, visualização ---------- */
  let suppressClick = false;
  function bindCanvas() {
    const cv = $("#canvas");
    let pan = null;
    cv.addEventListener("pointerdown", (ev) => {
      if (mq.matches && app.classList.contains("panel-open") && !ev.target.closest(".hit")) app.classList.remove("panel-open");
      if (ev.button !== 0 || ev.pointerType === "touch") return;
      pan = { x: ev.clientX, y: ev.clientY, l: cv.scrollLeft, t: cv.scrollTop, moved: false, id: ev.pointerId };
    });
    cv.addEventListener("pointermove", (ev) => {
      if (!pan || ev.pointerId !== pan.id) return;
      const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) < 4) return;
      if (!pan.moved) {
        pan.moved = true;
        cv.classList.add("panning");
        try {
          cv.setPointerCapture(ev.pointerId);
        } catch (e) {
          /* sem captura: o arraste continua enquanto o ponteiro estiver na área */
        }
      }
      cv.scrollLeft = pan.l - dx;
      cv.scrollTop = pan.t - dy;
    });
    const end = () => {
      if (!pan) return;
      if (pan.moved) {
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 0);
      }
      cv.classList.remove("panning");
      pan = null;
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener(
      "click",
      (ev) => {
        if (suppressClick) {
          ev.stopPropagation();
          ev.preventDefault();
        }
      },
      true
    );
    cv.addEventListener(
      "wheel",
      (ev) => {
        if (!(ev.ctrlKey || ev.metaKey)) return;
        ev.preventDefault();
        const k = ev.deltaMode === 1 ? 0.05 : 0.0025;
        zoomAt(effPpm() * Math.exp(-ev.deltaY * k), ev.clientX, ev.clientY);
      },
      { passive: false }
    );
    $("#sheet").addEventListener("click", (ev) => {
      if (viewing) return;
      const h = ev.target.closest(".hit");
      if (h) onHit(h.dataset.field, h);
    });
    $("#pageList").addEventListener("click", (ev) => {
      const li = ev.target.closest("li[data-i]");
      if (li) focusPage(+li.dataset.i);
    });
    $("#pageList").addEventListener("keydown", (ev) => {
      const li = ev.target.closest("li[data-i]");
      if (li && (ev.key === "Enter" || ev.key === " ")) {
        ev.preventDefault();
        focusPage(+li.dataset.i);
      }
    });
  }

  function setViewing(on) {
    viewing = on;
    app.classList.toggle("viewing", on);
    const b = $("#modeBtn");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.dataset.tip = on ? "Voltar a editar · V" : "Modo visualização · V";
    $("use", b).setAttribute("href", on ? "#i-pen" : "#i-eye");
    $("#guidesBtn").disabled = on; // na visualização as guias ficam sempre ocultas
    closeInline(true);
    closeCpop();
    if (on) app.classList.remove("panel-open");
    ppmZoom = 0;
    syncChrome();
    render();
  }

  let nativeFull = false;
  function toggleFull(force) {
    const on = force != null ? force : !app.classList.contains("ws-full");
    app.classList.toggle("ws-full", on);
    const b = $("#fullBtn");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.dataset.tip = on ? "Sair da tela cheia · F" : "Tela cheia · F";
    const de = document.documentElement;
    if (on && de.requestFullscreen && !document.fullscreenElement) {
      de.requestFullscreen()
        .then(() => (nativeFull = true))
        .catch(() => (nativeFull = false));
    }
    if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (!on) nativeFull = false;
    ppmZoom = 0;
    requestAnimationFrame(() => (viewMode() === "mockup" ? render() : applyZoom()));
  }

  /* ---------- início ---------- */
  function init() {
    app = $("#app");
    document.documentElement.lang = "pt-BR";
    if (embedded) {
      document.documentElement.classList.add("embedded");
      downloadsReady.then((dl) => {
        if (dl) return;
        for (const b of $$("[data-export]")) {
          b.disabled = true;
          b.title = "Downloads não estão disponíveis nesta visualização";
        }
        const note = $("#exportNote");
        if (note) note.hidden = false;
      });
    }
    buildSelects();
    buildTextItems();
    buildFontRoles();
    buildFontPickers();
    buildColorPickers();
    buildTemplates();
    buildSizeSliders();
    buildPresets();
    buildSymbols();
    bindUpload();
    bind();
    bindColorPopover();
    bindInline();
    bindModal();
    bindMenus();
    bindSections();
    bindCanvas();

    // etapas, ferramentas e painel
    for (const b of $$(".step")) b.addEventListener("click", () => setStep(b.dataset.step));
    for (const b of $$(".rail button")) {
      b.addEventListener("click", () => {
        const name = b.dataset.tool;
        if (mq.matches && ui.tool === name && app.classList.contains("panel-open")) app.classList.remove("panel-open");
        else showTool(name);
      });
    }
    $("#panelClose").addEventListener("click", () => app.classList.remove("panel-open"));
    for (const a of $$("[data-goto]")) a.addEventListener("click", () => showTool(a.dataset.goto));
    $("#brand").addEventListener("click", (ev) => {
      ev.preventDefault();
      setStep("envelope");
    });
    $("#cardViewSeg").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-cardview]");
      if (!b) return;
      ui.cardView = b.dataset.cardview;
      ppmZoom = 0;
      saveUi();
      syncChrome();
      render();
    });
    $("#extrasSeg").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-extra]");
      if (!b) return;
      ui.extra = b.dataset.extra;
      ppmZoom = 0;
      saveUi();
      syncChrome();
      render();
    });

    // barra de zoom
    for (const b of $$("[data-zoom]")) {
      b.addEventListener("click", () => {
        const z = b.dataset.zoom;
        if (z === "fit") fitZoom();
        else if (z === "in") zoomBy(1.25);
        else if (z === "out") zoomBy(0.8);
        else zoomAt(PX_PER_MM);
      });
    }
    $("#modeBtn").addEventListener("click", () => setViewing(!viewing));
    $("#guidesBtn").addEventListener("click", () => onChange("view.guides", !state.view.guides));
    $("#fullBtn").addEventListener("click", () => toggleFull());
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && nativeFull && app.classList.contains("ws-full")) toggleFull(false);
    });
    $("#checkBtn").addEventListener("click", () => toggleChecks());

    // exportação e projeto
    for (const b of $$("[data-export]")) b.addEventListener("click", () => doExport(b.dataset.export));
    $("#saveProject").addEventListener("click", saveProject);
    $("#loadProject").addEventListener("change", (e) => {
      if (e.target.files[0]) loadProject(e.target.files[0]);
      e.target.value = "";
    });
    $("#resetProject").addEventListener("click", resetProject);
    $("#undoBtn").addEventListener("click", undo);
    $("#redoBtn").addEventListener("click", redo);

    // teclado
    document.addEventListener("keydown", (ev) => {
      const ae = document.activeElement || {};
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || "") && !/^(range|checkbox|color|radio|button|file)$/.test(ae.type || "");
      if (ev.key === "Escape") {
        if (!$("#modal").hidden) return closeModal(false);
        if (ie) return closeInline(false);
        if (cp) return closeCpop();
        if (menuOpen()) return closeMenus();
        if (!$("#checksPop").hidden) return toggleChecks(false);
        if (mq.matches && app.classList.contains("panel-open")) return app.classList.remove("panel-open");
        if (app.classList.contains("ws-full") && !document.fullscreenElement) return toggleFull(false);
        if (viewing && !typing) return setViewing(false);
        return;
      }
      if (!$("#modal").hidden) return;
      if (ev.ctrlKey || ev.metaKey) {
        const k = ev.key.toLowerCase();
        if (k === "s") {
          ev.preventDefault();
          flushSave();
          toast("O projeto é salvo automaticamente neste navegador. Para guardar uma cópia, use Projeto › Salvar arquivo do projeto.", 5000);
          return;
        }
        if (typing) return; // dentro de um campo de texto vale o desfazer do próprio campo
        if (k === "z" && !ev.shiftKey) {
          ev.preventDefault();
          undo();
        } else if ((k === "z" && ev.shiftKey) || k === "y") {
          ev.preventDefault();
          redo();
        }
        return;
      }
      if (typing || ev.altKey || (ae.closest && ae.closest(".menu"))) return;
      const k = ev.key;
      if (k === "+" || k === "=") zoomBy(1.25);
      else if (k === "-" || k === "_") zoomBy(0.8);
      else if (k === "0") fitZoom();
      else if (k === "1") zoomAt(PX_PER_MM);
      else if (k === "f" || k === "F") toggleFull();
      else if (k === "v" || k === "V") setViewing(!viewing);
      else if (k === "g" || k === "G") onChange("view.guides", !state.view.guides);
      else return;
      ev.preventDefault();
    });

    // a área de trabalho muda de tamanho: reajusta (a montagem pode trocar de arranjo)
    let rz = null, lastLayout = "";
    const onResize = () => {
      clearTimeout(rz);
      rz = setTimeout(() => {
        const cv = $("#canvas");
        const layout = cv.clientWidth / Math.max(1, cv.clientHeight) > 2.1 ? "row" : "grid";
        if (viewMode() === "mockup" && layout !== lastLayout) render();
        else applyZoom();
        lastLayout = layout;
      }, 90);
    };
    if (window.ResizeObserver) new ResizeObserver(onResize).observe($("#canvas"));
    else window.addEventListener("resize", onResize);
    window.addEventListener("pagehide", flushSave);
    if (mq.addEventListener) mq.addEventListener("change", () => app.classList.remove("panel-open"));

    showTool(ui.tool, { keepStep: true, open: false });
    setSaveState("saved", "Salvamento automático neste navegador");
    sync();
    pushNow();
    render();
    P.type.registerUiFonts().then(syncFontRoles);
  }

  P.app = {
    get state() {
      return state;
    },
    render,
    doExport,
    undo,
    redo,
    setStep,
    setTab: setStep,
    showTool,
    showPane: showTool,
    setViewing,
    zoom: (ppm) => (ppm ? zoomAt(ppm) : fitZoom()),
    focusPage,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
