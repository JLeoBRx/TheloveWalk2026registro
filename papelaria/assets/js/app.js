/*
 * Interface do editor: seções, campos ligados ao estado, temas e cores,
 * desfazer/refazer, prévia em tempo real, verificação de produção e exportação.
 */
(function () {
  "use strict";
  const P = window.P;
  const KEY = "papelaria.projeto.v1";
  const PANE_KEY = "papelaria.secao";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const PX_PER_MM = 96 / 25.4;

  // Dentro do visualizador do claude.ai (versão online) a página roda num quadro
  // protegido: downloads passam pela permissão "downloads" da plataforma.
  const embedded = !!(window.claude && typeof window.claude.use === "function");
  const downloadsReady = embedded ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);

  let state = load();
  let tab = "envelope";
  let extra = "liner";
  let ppmZoom = 0; // 0 = ajustar à área
  let cardSheetView = false;
  let current = null; // { w, h }
  let busy = false;

  /* ---------- persistência ---------- */
  function store(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      /* armazenamento indisponível: o projeto pode ser salvo em arquivo */
    }
  }
  function read(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
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
  let saveTimer = null, quotaWarned = false;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        // sem espaço para a imagem enviada: guarda o resto e avisa uma vez
        store(KEY, JSON.stringify(Object.assign({}, state, { assets: { upload: null } })));
        if (!quotaWarned && state.assets && state.assets.upload) {
          quotaWarned = true;
          toast("A imagem é grande demais para ficar guardada no navegador. Use Salvar projeto para não perdê-la.", 7000);
        }
      }
    }, 300);
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
  const FORMATS = {
    pct: (v) => `${Math.round(v * 100)}%`,
    mm: (v) => `${P.mmLabel(v)} mm`,
    deg: (v) => `${Math.round(v)}°`,
    int: (v) => `${Math.round(v)}`,
    sidemm: () => `${P.mmLabel(P.envelope.geometry(state, 0).s)} mm`,
    clearance: (v) => `${P.mmLabel(v, 0)} mm (${P.mmLabel(v / 2)} por lado)`,
  };

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

  function coerce(el, raw) {
    const t = el.dataset.type || el.type;
    if (t === "checkbox") return !!raw;
    if (t === "range" || t === "number") return raw === "" ? 0 : +raw;
    return raw;
  }

  function bind() {
    for (const el of $$("[data-bind]")) {
      const path = el.dataset.bind;
      if (el.classList.contains("seg")) {
        el.addEventListener("click", (ev) => {
          const b = ev.target.closest("button[data-value]");
          if (!b) return;
          onChange(path, el.dataset.type === "number" ? +b.dataset.value : b.dataset.value);
        });
        continue;
      }
      const evName = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "date" || el.type === "time" ? "change" : "input";
      el.addEventListener(evName, () => {
        const v = el.type === "checkbox" ? el.checked : el.value;
        if (el.hasAttribute("data-custom-size")) {
          if (!(+v > 0)) return;
          state.card.preset = "custom";
        }
        onChange(path, coerce(el, v));
      });
    }
  }

  /* campos de cor: amostra nativa + código hexadecimal */
  function bindColorFields() {
    for (const cf of $$(".cf[data-color]")) {
      const path = cf.dataset.color;
      const picker = $('input[type="color"]', cf);
      const hex = $('input[type="text"]', cf);
      const apply = (v) => {
        v = v.toUpperCase();
        cf.classList.remove("invalid");
        if (path === "colors.base") {
          P.deriveFromBase(state, v);
          changed();
        } else onChange(path, v);
      };
      picker.addEventListener("input", () => apply(picker.value));
      hex.addEventListener("input", () => {
        let v = hex.value.trim();
        if (v && v[0] !== "#") v = "#" + v;
        if (/^#[0-9a-fA-F]{6}$/.test(v)) apply(v);
        else cf.classList.toggle("invalid", v.length >= 7);
      });
      hex.addEventListener("blur", () => {
        cf.classList.remove("invalid");
        syncColor(cf);
      });
    }
  }
  function syncColor(cf) {
    const v = P.get(state, cf.dataset.color);
    if (!P.color.valid(v)) return;
    const picker = $('input[type="color"]', cf);
    const hex = $('input[type="text"]', cf);
    if (picker.value.toLowerCase() !== v.toLowerCase()) picker.value = v.toLowerCase();
    if (document.activeElement !== hex) hex.value = v.toUpperCase();
  }

  function evalCond(expr) {
    const m = expr.match(/^([\w.]+)(!?=)(.*)$/);
    if (!m) return true;
    const v = String(P.get(state, m[1]));
    return m[2] === "=" ? v === m[3] : v !== m[3];
  }

  function sync() {
    for (const el of $$("[data-bind]")) {
      const v = P.get(state, el.dataset.bind);
      if (el.classList.contains("seg")) {
        for (const b of $$("button[data-value]", el)) b.classList.toggle("on", String(b.dataset.value) === String(v));
      } else if (el.type === "checkbox") el.checked = !!v;
      else if (document.activeElement !== el || el.type === "range" || el.tagName === "SELECT") {
        if (el.value !== String(v)) el.value = v == null ? "" : v;
      }
    }
    for (const cf of $$(".cf[data-color]")) syncColor(cf);
    for (const o of $$("output[data-for]")) {
      const v = P.get(state, o.dataset.for);
      const f = FORMATS[o.dataset.format];
      o.textContent = f ? f(v) : v;
    }
    for (const el of $$("[data-show-if]")) {
      let show = evalCond(el.dataset.showIf);
      if (el.dataset.hideIf && evalCond(el.dataset.hideIf)) show = false;
      el.hidden = !show;
    }
    if (embedded) for (const el of $$("[data-local-only]")) el.hidden = true;
    for (const el of $$("[data-tab-only]")) el.hidden = el.dataset.tabOnly !== tab;
    for (const pick of $$(".fontpick")) {
      const cur = state.fonts[pick.dataset.font];
      for (const b of $$("button", pick)) b.classList.toggle("on", b.dataset.id === cur);
    }
    for (const t of $$("#themes .theme")) t.classList.toggle("on", t.dataset.theme === state.colors.theme);
    for (const t of $$("#templates .template")) t.classList.toggle("on", t.dataset.template === state.text.template);
    for (const s of $$("#golds .chip")) s.classList.toggle("on", s.dataset.key === state.colors.goldTone);
    for (const s of $$("#waxes .chip")) s.classList.toggle("on", s.dataset.color.toLowerCase() === String(state.colors.waxColor).toLowerCase());
    for (const s of $$("#baseSwatches button")) s.classList.toggle("on", s.dataset.base.toLowerCase() === String(state.colors.base).toLowerCase());
    for (const b of $$("#symbols button")) b.classList.toggle("on", b.dataset.icon === state.seal.icon);
    uploadUI();
    sizeInfo();
    histButtons();
  }

  /* ---------- componentes montados por script ---------- */
  function buildSelects() {
    $("#presetSelect").innerHTML = Object.entries(P.CARD_PRESETS)
      .map(([k, p]) => `<option value="${k}">${P.esc(p.label)}</option>`)
      .join("");
    $("#envPaperSelect").innerHTML =
      `<option value="auto">Automático — menor papel em que o molde cabe</option>` +
      P.PAPER_ORDER.map((k) => `<option value="${k}">${P.esc(P.PAPERS[k].label)}</option>`).join("") +
      `<option value="fit">Ajustado ao molde (arquivo para gráfica)</option>`;
    $("#cardPaperSelect").innerHTML =
      `<option value="fit">Ajustado — convite + sangria + marcas de corte</option>` +
      `<option value="exact">Tamanho final exato (papel já cortado)</option>` +
      ["A4", "letter", "A3", "SRA3"].map((k) => `<option value="${k}">${P.esc(P.PAPERS[k].label)} com marcas de corte</option>`).join("");
  }

  function buildFontPickers() {
    for (const pick of $$(".fontpick")) {
      const cats = pick.dataset.cats.split(",");
      const sample = pick.dataset.sample || "Aa";
      pick.innerHTML = P.type
        .families(cats)
        .map((f) => {
          const style = f.cat === "script" ? "font-size:22px" : "";
          return `<button type="button" data-id="${f.id}" title="${P.esc(f.name)}"><b style="font-family:'${P.esc(f.name)}';${style}">${P.esc(sample)}</b><small>${P.esc(f.name)}</small></button>`;
        })
        .join("");
      pick.addEventListener("click", (ev) => {
        const b = ev.target.closest("button[data-id]");
        if (b) onChange(`fonts.${pick.dataset.font}`, b.dataset.id);
      });
    }
  }

  function buildColorPickers() {
    // temas
    const themes = $("#themes");
    themes.innerHTML = Object.entries(P.THEMES)
      .map(([k, t]) => {
        const g = P.GOLDS[t.gold];
        const card = t.card === "envelope" ? P.color.mix(t.navy, t.royal, 0.5) : t.pearl;
        return (
          `<button type="button" class="theme" data-theme="${k}" style="--a:${t.navy};--b:${t.royal};--c:${card};--g:${g.gold};--gl:${g.goldLight};--gd:${g.goldDark}">` +
          `<span class="mini"><span class="env"></span><span class="card"></span></span><span class="label">${P.esc(t.label)}</span></button>`
        );
      })
      .join("");
    themes.addEventListener("click", (ev) => {
      const b = ev.target.closest(".theme");
      if (!b) return;
      P.applyTheme(state, b.dataset.theme);
      changed();
    });
    // cor principal
    const base = $("#baseSwatches");
    base.innerHTML = P.BASE_SWATCHES.map((c) => `<button type="button" data-base="${c}" style="background:${c}" title="${c}" aria-label="Usar a cor ${c}"></button>`).join("");
    base.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-base]");
      if (!b) return;
      P.deriveFromBase(state, b.dataset.base);
      changed();
    });
    // metais
    const golds = $("#golds");
    golds.innerHTML = Object.entries(P.GOLDS)
      .map(([k, g]) => `<button type="button" class="chip" data-key="${k}"><i style="background:linear-gradient(135deg, ${g.goldDark}, ${g.gold} 45%, ${g.goldLight} 62%, ${g.gold})"></i>${P.esc(g.label)}</button>`)
      .join("");
    golds.addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip");
      if (!b) return;
      P.applyGold(state, b.dataset.key);
      changed();
    });
    // lacres
    const waxes = $("#waxes");
    waxes.innerHTML = Object.values(P.WAX)
      .map((w) => `<button type="button" class="chip" data-color="${w.color}"><i style="background:radial-gradient(circle at 35% 30%, ${P.color.mix(w.color, "#ffffff", 0.45)}, ${w.color} 55%, ${P.color.mix(w.color, "#000000", 0.4)})"></i>${P.esc(w.label)}</button>`)
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

  function buildTemplates() {
    const box = $("#templates");
    box.innerHTML = Object.entries(P.TEMPLATES)
      .map(([k, t]) => `<button type="button" class="template" data-template="${k}"><b>${P.esc(t.label)}</b><span>${P.esc(t.hint)}</span></button>`)
      .join("");
    box.addEventListener("click", (ev) => {
      const b = ev.target.closest(".template");
      if (!b) return;
      P.applyTemplate(state, b.dataset.template);
      changed();
      toast(`Modelo “${P.TEMPLATES[b.dataset.template].label}” aplicado. Ajuste os textos em Textos.`, 4000);
    });
  }

  function buildSizeSliders() {
    $("#sizeSliders").innerHTML = P.SIZE_KEYS.map(
      ([k, label]) =>
        `<label class="field range"><span>${P.esc(label)} <output data-for="card.sizes.${k}" data-format="pct"></output></span>` +
        `<input type="range" id="sz-${k}" min="0.6" max="1.5" step="0.01" data-bind="card.sizes.${k}"></label>`
    ).join("");
    $("#resetSizes").addEventListener("click", () => {
      for (const [k] of P.SIZE_KEYS) state.card.sizes[k] = 1;
      changed();
    });
  }

  function sizeInfo() {
    const box = $("#sizeInfo");
    if (!box) return;
    const geo = P.envelope.geometry(state, 0);
    const cw = +state.card.width, ch = +state.card.height;
    box.innerHTML =
      `<div>Envelope fechado: <b>${P.mmLabel(geo.W)} × ${P.mmLabel(geo.H)} mm</b> (o convite entra deitado)</div>` +
      `<div>Molde aberto: <b>${P.mmLabel(geo.bbox.w)} × ${P.mmLabel(geo.bbox.h)} mm</b></div>` +
      `<div>Convite: <b>${P.mmLabel(cw)} × ${P.mmLabel(ch)} mm</b> · folga ${P.mmLabel((geo.W - Math.max(cw, ch)) / 2)} mm por lado</div>`;
  }

  /* ---------- símbolos e imagem enviada ---------- */
  function buildSymbols() {
    const box = $("#symbols");
    if (!box || !P.SYMBOLS) return;
    box.innerHTML = P.SYMBOL_ORDER.map((k) => {
      const s = P.SYMBOLS[k];
      return `<button type="button" data-icon="${k}" title="${P.esc(s.label)}"><svg viewBox="0 0 ${s.w} ${s.h}" aria-hidden="true"><path d="${s.d}"/></svg><span>${P.esc(s.label)}</span></button>`;
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
    $("#removeUpload").addEventListener("click", () => {
      state.assets.upload = null;
      if (state.seal.emblem === "upload") state.seal.emblem = "initials";
      changed();
    });
  }

  let lastUpload, lastLook = "";
  function uploadUI() {
    const up = state.assets && state.assets.upload;
    const look = state.seal.uploadLook;
    if (up === lastUpload && look === lastLook) return;
    lastUpload = up;
    lastLook = look;
    const box = $("#uploadResult");
    if (!box) return;
    $("#dropTitle").textContent = up ? "Trocar imagem" : "Enviar imagem ou logotipo";
    $("#removeUpload").hidden = !up;
    box.hidden = !up;
    if (!up) return;
    $("#upOriginal").innerHTML = `<img src="${up.src}" alt="Imagem enviada">`;
    const c = state.colors;
    if (look === "original" && up.png) {
      $("#upResult").innerHTML = `<img src="${up.png}" alt="Imagem sem fundo">`;
    } else if (up.d) {
      $("#upResult").innerHTML =
        `<svg viewBox="0 0 ${up.vw} ${up.vh}" aria-label="Imagem sem fundo"><defs><linearGradient id="upg" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="${c.goldDark}"/><stop offset=".45" stop-color="${c.gold}"/><stop offset=".6" stop-color="${c.goldLight}"/><stop offset="1" stop-color="${c.goldDark}"/>` +
        `</linearGradient></defs><path d="${up.d}" fill="url(#upg)"/></svg>`;
    } else $("#upResult").innerHTML = "";
  }

  /* ---------- seções ---------- */
  function showPane(name) {
    for (const b of $$(".rail button")) b.classList.toggle("active", b.dataset.pane === name);
    for (const p of $$(".pane")) p.classList.toggle("active", p.dataset.pane === name);
    store(PANE_KEY, name);
    const panel = $("#panel");
    if (panel && window.innerWidth > 900) panel.scrollTop = 0;
  }

  /* ---------- prévia ---------- */
  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => requestAnimationFrame(render), 70);
  }

  function cardPreview() {
    const st = state;
    const cw = +st.card.width, ch = +st.card.height;
    const b = +st.print.bleed || 0;
    const guides = !!st.view.guides;
    const pad = (guides ? b : 0) + 8;
    const ctx = new P.Ctx(st, "art", "pv");
    const r = P.card.render(ctx, { bleed: guides ? b : 0, guides });
    const shadow = ctx.uid("sh");
    ctx.def(`<filter id="${shadow}" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="1.2" stdDeviation="2" flood-color="#0b1633" flood-opacity="0.35"/></filter>`);
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

  function place(sh) {
    const host = $("#sheet");
    host.classList.toggle("bare", !!sh.bare);
    host.innerHTML = sh.svg;
    current = { w: sh.w, h: sh.h };
    applyZoom();
  }

  function applyZoom() {
    const svg = $("#sheet svg");
    if (!svg || !current) return;
    const canvas = $("#canvas");
    const fit = Math.max(0.3, Math.min((canvas.clientWidth - 56) / current.w, (canvas.clientHeight - 56) / current.h));
    const ppm = ppmZoom || fit;
    svg.style.width = `${current.w * ppm}px`;
    svg.style.height = `${current.h * ppm}px`;
    const label = $("#zoomLabel");
    label.textContent = ppmZoom ? `${Math.round((ppm / PX_PER_MM) * 100)}%` : "Ajustar";
    label.title = "100% ≈ tamanho real na tela (depende do monitor). Clique para ajustar à área.";
  }

  function render() {
    let env, crd;
    try {
      env = P.sheets.envelopeSheet(state, "art", state.view.guides ? { safe: true } : null);
      crd = P.sheets.cardSheet(state, "art");
      let sh;
      if (tab === "envelope") {
        sh = env.error ? P.sheets.envelopeSheet(state, "art", { envPaper: "fit" }) : env;
      } else if (tab === "card") {
        sh = cardSheetView && !crd.error ? crd : cardPreview();
      } else if (tab === "mockup") {
        const cv = $("#canvas");
        const layout = cv.clientWidth / Math.max(1, cv.clientHeight) > 2.1 ? "row" : "grid";
        sh = Object.assign(P.scene.mockup(state, layout), { bare: true });
      } else {
        sh = extra === "stickers" ? P.sheets.stickerSheet(state, "art") : P.sheets.linerSheet(state, "art");
      }
      if (sh.error) throw new Error(sh.error);
      place(sh);
    } catch (e) {
      console.error(e);
      $("#sheet").innerHTML = `<div class="error">Não foi possível desenhar a prévia: ${P.esc(e.message)}</div>`;
      current = null;
    }
    if (env && crd) {
      dims(env, crd);
      preflight(env, crd);
    }
    applyZoom();
  }

  function paperName(sheet) {
    if (!sheet || sheet.error) return "—";
    if (sheet.paperKey === "fit") return `ajustada ${P.mmLabel(sheet.w)} × ${P.mmLabel(sheet.h)} mm`;
    if (sheet.paperKey === "exact") return "tamanho final";
    return P.PAPERS[sheet.paperKey] ? P.PAPERS[sheet.paperKey].label.split(" — ")[0] : sheet.paperKey;
  }

  function dims(env, crd) {
    const geo = env.geo || P.envelope.geometry(state, 0);
    $("#dims").innerHTML =
      `<div>Envelope <b>${P.mmLabel(geo.W)} × ${P.mmLabel(geo.H)} mm</b> · molde aberto <b>${P.mmLabel(geo.bbox.w)} × ${P.mmLabel(geo.bbox.h)} mm</b> · folha <b>${P.esc(paperName(env))}</b></div>` +
      `<div>Convite <b>${P.mmLabel(+state.card.width)} × ${P.mmLabel(+state.card.height)} mm</b> · folha <b>${P.esc(paperName(crd))}</b>${crd && !crd.error ? ` · ${crd.count} por folha` : ""}</div>`;
  }

  function contrast(a, b) {
    const la = P.color.luminance(a), lb = P.color.luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  let lastSig = "";
  function preflight(env, crd) {
    const items = [];
    const add = (level, msg) => items.push(`<li class="${level}">${msg}</li>`);
    const geo = env.geo || P.envelope.geometry(state, 0);
    if (env.error) add("err", P.esc(env.error) + " Escolha um papel maior ou “Ajustado ao molde”.");
    else if (env.forced) add("warn", `O molde cabe em ${P.esc(paperName(env))}, mas sem espaço para marcas externas e legenda.`);
    else add("", `Envelope em escala 100% na folha ${P.esc(paperName(env))}, com margem ≥ ${P.mmLabel(state.print.minMargin)} mm.`);

    const cw = +state.card.width, ch = +state.card.height;
    const fx = (geo.W - Math.max(cw, ch)) / 2, fy = (geo.H - Math.min(cw, ch)) / 2;
    if (fx < 1.5 || fy < 1.5) add("err", `Convite justo demais: folga de ${P.mmLabel(fx)} × ${P.mmLabel(fy)} mm. Aumente a folga em Medidas.`);
    else if (fx < 2.5 || fy < 2.5) add("warn", `Folga pequena (${P.mmLabel(fx)} mm por lado). Para papel grosso, use 3 mm ou mais.`);
    else add("", `Convite entra no envelope com ${P.mmLabel(fx)} mm de folga por lado.`);

    if (crd.error) add("err", P.esc(crd.error));
    else if (crd.overflow) add("err", "O conteúdo do convite não cabe na área útil. Encurte os textos ou reduza os tamanhos.");
    else add("", `Convite: ${crd.count} por folha (${P.esc(paperName(crd))}), textos dentro da área de segurança.`);

    const c = state.colors;
    const bg = P.cardBg(state);
    if (contrast(c.cardText, bg) < 3) add("warn", "Pouco contraste entre o texto e o fundo do convite. Use “Ajustar cores do texto ao fundo” em Cores.");
    if (contrast(c.light, P.envelopeMid(state)) < 1.8) add("warn", "Os detalhes do envelope quase não aparecem sobre o fundo. Escolha um tom mais claro ou mais escuro em Cores.");

    if (!geo.seal.fits) add("warn", "O selo está grande para a aba superior. Reduza o diâmetro ou aprofunde a aba.");
    else add("", `Selo de ${P.mmLabel(geo.seal.r * 2)} mm dentro da aba, girado para ficar de pé no verso.`);

    if (geo.glue.length < 2) add("warn", "Abas laterais estreitas: pouca área para cola. Aumente a largura das abas.");
    else add("", "Áreas de cola nas abas laterais, ocultas pela aba inferior após a montagem.");
    add("", `Fechamento com ${P.mmLabel(geo.overlap)} mm de sobreposição entre a aba superior e a inferior.`);
    if (!(+state.print.bleed > 0)) add("warn", "Sem sangria: qualquer desvio no corte deixa filete branco na borda.");
    else add("", `Sangria de ${P.mmLabel(state.print.bleed)} mm. PDF vetorial com textos em curvas.`);
    $("#preflight").innerHTML = items.join("");

    const nErr = items.filter((i) => i.includes('class="err"')).length;
    const nWarn = items.filter((i) => i.includes('class="warn"')).length;
    const sum = $("#checkSummary");
    sum.className = nErr ? "err" : nWarn ? "warn" : "";
    sum.textContent = nErr
      ? `× ${nErr} problema${nErr > 1 ? "s" : ""} impede${nErr > 1 ? "m" : ""} a produção`
      : nWarn
      ? `! ${nWarn} alerta${nWarn > 1 ? "s" : ""} · ${items.length - nWarn} itens conferidos`
      : `✓ Pronto para produção · ${items.length} itens conferidos`;
    const sig = `${nErr}/${nWarn}`;
    if (sig !== lastSig) {
      $("#checks").open = nErr + nWarn > 0;
      lastSig = sig;
    }
  }

  /* ---------- exportação ---------- */
  let toastTimer = null;
  function toast(msg, ms, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("error", !!isError);
    t.classList.add("show");
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

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
    closeMenu();
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

  /* menu Exportar */
  function openMenu() {
    $("#exportMenu").hidden = false;
    $("#exportBtn").setAttribute("aria-expanded", "true");
    const first = $("#exportMenu button");
    if (first) first.focus();
  }
  function closeMenu() {
    const m = $("#exportMenu");
    if (!m || m.hidden) return;
    m.hidden = true;
    $("#exportBtn").setAttribute("aria-expanded", "false");
  }

  /* ---------- projeto ---------- */
  async function saveProject() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    try {
      const ok = await saveFile("projeto-papelaria.json", blob);
      toast(ok ? "Projeto salvo em projeto-papelaria.json" : "Download cancelado.", 4000);
    } catch (e) {
      toast(saveErrorMessage(e), 8000, true);
    }
  }

  function loadProject(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        state = P.mergeDefaults(P.defaults(), P.migrate(JSON.parse(fr.result)));
        changed();
        render();
        toast("Projeto aberto.", 3000);
      } catch (e) {
        toast("Arquivo de projeto inválido.", 5000, true);
      }
    };
    fr.readAsText(file);
  }

  /* ---------- início ---------- */
  function init() {
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
    buildFontPickers();
    buildColorPickers();
    buildTemplates();
    buildSizeSliders();
    buildSymbols();
    bindUpload();
    bind();
    bindColorFields();
    showPane(read(PANE_KEY) || "cores");
    sync();

    for (const b of $$(".rail button")) b.addEventListener("click", () => showPane(b.dataset.pane));
    for (const b of $$(".tabs button")) {
      b.addEventListener("click", () => {
        tab = b.dataset.tab;
        $$(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
        ppmZoom = 0;
        sync();
        render();
      });
    }
    $("#extrasSeg").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-extra]");
      if (!b) return;
      extra = b.dataset.extra;
      $$("#extrasSeg button").forEach((x) => x.classList.toggle("on", x === b));
      ppmZoom = 0;
      render();
    });
    $("#checks").addEventListener("toggle", () => applyZoom());
    $("#cardSheetView").addEventListener("change", (e) => {
      cardSheetView = e.target.checked;
      ppmZoom = 0;
      render();
    });
    for (const b of $$("[data-zoom]")) {
      b.addEventListener("click", () => {
        if (!current) return;
        const canvas = $("#canvas");
        const fit = Math.min((canvas.clientWidth - 56) / current.w, (canvas.clientHeight - 56) / current.h);
        const cur = ppmZoom || fit;
        if (b.dataset.zoom === "fit") ppmZoom = 0;
        else if (b.dataset.zoom === "in") ppmZoom = Math.min(cur * 1.25, 40);
        else ppmZoom = Math.max(cur / 1.25, 0.3);
        applyZoom();
      });
    }

    for (const b of $$("[data-export]")) b.addEventListener("click", () => doExport(b.dataset.export));
    $("#exportBtn").addEventListener("click", (ev) => {
      ev.stopPropagation();
      if ($("#exportMenu").hidden) openMenu();
      else closeMenu();
    });
    document.addEventListener("click", (ev) => {
      if (!ev.target.closest(".menu-wrap")) closeMenu();
    });

    $("#undoBtn").addEventListener("click", undo);
    $("#redoBtn").addEventListener("click", redo);
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeMenu();
      const mod = ev.ctrlKey || ev.metaKey;
      if (!mod) return;
      const k = ev.key.toLowerCase();
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "") &&
        !/^(range|checkbox|color)$/.test(document.activeElement.type || "");
      if (typing) return; // dentro de um campo de texto vale o desfazer do próprio campo
      if (k === "z" && !ev.shiftKey) {
        ev.preventDefault();
        undo();
      } else if ((k === "z" && ev.shiftKey) || k === "y") {
        ev.preventDefault();
        redo();
      }
    });

    $("#saveProject").addEventListener("click", saveProject);
    $("#loadProject").addEventListener("change", (e) => {
      if (e.target.files[0]) loadProject(e.target.files[0]);
      e.target.value = "";
    });
    // confirmação em dois cliques, dentro da própria página
    let resetArmed = null;
    $("#resetProject").addEventListener("click", (ev) => {
      const btn = ev.currentTarget;
      const disarm = () => {
        clearTimeout(resetArmed);
        resetArmed = null;
        btn.textContent = "Restaurar padrão";
        btn.classList.remove("armed");
      };
      if (!resetArmed) {
        btn.textContent = "Clique de novo para restaurar tudo";
        btn.classList.add("armed");
        resetArmed = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      const keep = state.assets;
      state = P.defaults();
      state.assets = keep; // a imagem enviada continua disponível
      changed();
      render();
      toast("Tudo restaurado para o padrão. Use desfazer para voltar.", 4000);
    });

    let rz = null;
    window.addEventListener("resize", () => {
      clearTimeout(rz);
      rz = setTimeout(() => (tab === "mockup" ? render() : applyZoom()), 120);
    });

    pushNow();
    render();
    P.type.registerUiFonts();
  }

  P.app = {
    get state() {
      return state;
    },
    render,
    doExport,
    undo,
    redo,
    setTab: (t) => $(`.tabs button[data-tab="${t}"]`).click(),
    showPane,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
