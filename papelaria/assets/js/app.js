/*
 * Interface do editor: ligação dos campos ao estado, prévia em tempo real,
 * verificação de produção (preflight), exportação e projeto salvo.
 */
(function () {
  "use strict";
  const P = window.P;
  const KEY = "papelaria.projeto.v1";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const PX_PER_MM = 96 / 25.4;

  let state = load();
  let tab = "envelope";
  let ppmZoom = 0; // 0 = ajustar à área
  let cardSheetView = false;
  let current = null; // { w, h }
  let busy = false;

  /* ---------- persistência ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return P.mergeDefaults(P.defaults(), JSON.parse(raw));
    } catch (e) {
      /* armazenamento indisponível: segue com o padrão */
    }
    return P.defaults();
  }
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        /* sem armazenamento local: o projeto pode ser salvo em arquivo */
      }
    }, 300);
  }

  /* ---------- formatação ---------- */
  const FORMATS = {
    pct: (v) => `${Math.round(v * 100)}%`,
    mm: (v) => `${P.mmLabel(v)} mm`,
    deg: (v) => `${Math.round(v)}°`,
    sidemm: () => `${P.mmLabel(P.envelope.geometry(state, 0).s)} mm`,
    clearance: (v) => `${P.mmLabel(v, 0)} mm (${P.mmLabel(v / 2)} por lado)`,
  };

  /* ---------- ligação dos campos ---------- */
  function coerce(el, raw) {
    const t = el.dataset.type || el.type;
    if (t === "checkbox") return !!raw;
    if (t === "range" || t === "number") return raw === "" ? 0 : +raw;
    return raw;
  }

  function onChange(path, value) {
    P.set(state, path, value);
    if (path === "card.preset" && P.CARD_PRESETS[value] && value !== "custom") {
      const pr = P.CARD_PRESETS[value];
      state.card.width = pr.w;
      state.card.height = pr.h;
      state.envelope.clearance = pr.clearance;
    }
    if (path === "colors.navy" || path === "colors.royal" || path === "colors.light") state.colors.palette = "custom";
    if (/^colors\.gold/.test(path)) state.colors.goldTone = "custom";
    sync();
    schedule();
    persist();
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
      const evName = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "color" || el.type === "date" || el.type === "time" ? "change" : "input";
      el.addEventListener(evName, () => {
        const v = el.type === "checkbox" ? el.checked : el.value;
        if (el.hasAttribute("data-custom-size")) {
          if (!(+v > 0)) return;
          state.card.preset = "custom";
        }
        onChange(path, coerce(el, v));
      });
      if (el.type === "color") el.addEventListener("input", () => onChange(path, el.value));
    }
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
    for (const el of $$("[data-tab-only]")) el.hidden = el.dataset.tabOnly !== tab;
    for (const pick of $$(".fontpick")) {
      const cur = state.fonts[pick.dataset.font];
      for (const b of $$("button", pick)) b.classList.toggle("on", b.dataset.id === cur);
    }
    for (const s of $$("#palettes .swatch")) s.classList.toggle("on", s.dataset.key === state.colors.palette);
    for (const s of $$("#golds .swatch")) s.classList.toggle("on", s.dataset.key === state.colors.goldTone);
    sizeInfo();
  }

  /* ---------- componentes montados por script ---------- */
  function buildSelects() {
    const preset = $("#presetSelect");
    preset.innerHTML = Object.entries(P.CARD_PRESETS)
      .map(([k, p]) => `<option value="${k}">${P.esc(p.label)}</option>`)
      .join("");
    const env = $("#envPaperSelect");
    env.innerHTML =
      `<option value="auto">Automático — menor papel em que o molde cabe</option>` +
      P.PAPER_ORDER.map((k) => `<option value="${k}">${P.esc(P.PAPERS[k].label)}</option>`).join("") +
      `<option value="fit">Ajustado ao molde (arquivo para gráfica)</option>`;
    const card = $("#cardPaperSelect");
    card.innerHTML =
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

  function buildSwatches() {
    const pal = $("#palettes");
    pal.innerHTML = Object.entries(P.PALETTES)
      .map(
        ([k, p]) =>
          `<button type="button" class="swatch" data-key="${k}"><i style="background:linear-gradient(135deg, ${p.navy}, ${p.royal} 70%, ${p.light})"></i>${P.esc(p.label)}</button>`
      )
      .join("");
    pal.addEventListener("click", (ev) => {
      const b = ev.target.closest(".swatch");
      if (!b) return;
      const p = P.PALETTES[b.dataset.key];
      Object.assign(state.colors, { navy: p.navy, royal: p.royal, light: p.light, palette: b.dataset.key });
      sync();
      schedule();
      persist();
    });
    const gold = $("#golds");
    gold.innerHTML = Object.entries(P.GOLDS)
      .map(
        ([k, g]) =>
          `<button type="button" class="swatch" data-key="${k}"><i style="background:linear-gradient(135deg, ${g.goldDark}, ${g.gold} 45%, ${g.goldLight} 60%, ${g.gold})"></i>${P.esc(g.label)}</button>`
      )
      .join("");
    gold.addEventListener("click", (ev) => {
      const b = ev.target.closest(".swatch");
      if (!b) return;
      const g = P.GOLDS[b.dataset.key];
      Object.assign(state.colors, { goldDark: g.goldDark, gold: g.gold, goldLight: g.goldLight, goldTone: b.dataset.key });
      sync();
      schedule();
      persist();
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
    // com guias: mostra a sangria e as linhas; sem guias: o cartão já refilado
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
    return { w, h, bare: true, svg: P.svgDoc(w, h, body, ctx), overflow: r.overflow, scale: r.scale };
  }

  function label(txt, x, y) {
    const sp = { font: "montserrat", variant: "semibold", size: 3.4, tracking: 0.22, upper: true };
    return `<path d="${P.type.line(txt, x, y, sp, "middle").d}" fill="#5B6475"/>`;
  }

  function mockupPreview() {
    const ctx = new P.Ctx(state, "art", "mk");
    const geo = P.envelope.geometry(state, 0);
    const mk = P.envelope.mockup(ctx, geo);
    const cw = +state.card.width, ch = +state.card.height;
    const cr = P.card.render(ctx, { bleed: 0 });
    const cclip = ctx.uid("cc");
    ctx.def(`<clipPath id="${cclip}"><rect width="${P.n(cw)}" height="${P.n(ch)}"/></clipPath>`);
    const sh = ctx.uid("ms");
    ctx.def(`<filter id="${sh}" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="2.2" stdDeviation="3" flood-color="#0b1633" flood-opacity="0.32"/></filter>`);
    const { W, H } = geo;
    const m = 12, gap = 18, lab = 12;
    const canvas = $("#canvas");
    const wide = canvas.clientWidth / Math.max(1, canvas.clientHeight) > 1.55;
    let w, h, pos;
    if (wide) {
      const rowH = Math.max(H, ch);
      w = 2 * W + cw + 2 * gap + 2 * m;
      h = rowH + lab + 2 * m;
      pos = { back: [m, m + (rowH - H) / 2], front: [m + W + gap, m + (rowH - H) / 2], card: [m + 2 * W + 2 * gap, m + (rowH - ch) / 2], labY: m + rowH + 8 };
    } else {
      w = Math.max(2 * W + gap, cw) + 2 * m;
      h = H + ch + 2 * lab + gap + 2 * m;
      const x0 = (w - (2 * W + gap)) / 2;
      pos = { back: [x0, m], front: [x0 + W + gap, m], card: [(w - cw) / 2, m + H + lab + gap], labY: m + H + 8, labY2: m + H + lab + gap + ch + 8 };
    }
    let body = "";
    body += `<g transform="translate(${P.n(pos.back[0])} ${P.n(pos.back[1])})"><g filter="url(#${sh})">${mk.back}</g></g>`;
    body += `<g transform="translate(${P.n(pos.front[0])} ${P.n(pos.front[1])})"><g filter="url(#${sh})">${mk.front}</g></g>`;
    body += `<g transform="translate(${P.n(pos.card[0])} ${P.n(pos.card[1])})"><g filter="url(#${sh})"><g clip-path="url(#${cclip})">${cr.svg}</g></g></g>`;
    body += label("Verso · fechado com o selo", pos.back[0] + W / 2, wide ? pos.labY : pos.labY);
    body += label("Frente do envelope", pos.front[0] + W / 2, wide ? pos.labY : pos.labY);
    body += label("Convite", pos.card[0] + cw / 2, wide ? pos.labY : pos.labY2);
    return { w, h, bare: true, svg: P.svgDoc(w, h, body, ctx) };
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
    $("#zoomLabel").textContent = ppmZoom ? `${Math.round((ppm / PX_PER_MM) * 100)}%` : "Ajustar";
    $("#zoomLabel").title = "100% ≈ tamanho real na tela (depende do monitor). Clique para ajustar à área.";
  }

  function render() {
    let env, crd, cardInfo;
    try {
      env = P.sheets.envelopeSheet(state, "art", state.view.guides ? { safe: true } : null);
      crd = P.sheets.cardSheet(state, "art");
      let sh;
      if (tab === "envelope") {
        sh = env.error ? P.sheets.envelopeSheet(state, "art", { envPaper: "fit" }) : env;
      } else if (tab === "card") {
        cardInfo = cardPreview();
        sh = cardSheetView && !crd.error ? crd : cardInfo;
      } else {
        sh = mockupPreview();
      }
      place(sh);
    } catch (e) {
      console.error(e);
      $("#sheet").innerHTML = `<div class="error">Não foi possível desenhar a prévia: ${P.esc(e.message)}</div>`;
      return;
    }
    dims(env, crd);
    preflight(env, crd);
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

  function preflight(env, crd) {
    const items = [];
    const add = (level, msg) => items.push(`<li class="${level}">${msg}</li>`);
    const geo = env.geo || P.envelope.geometry(state, 0);
    if (env.error) add("err", P.esc(env.error) + " Escolha um papel maior ou “Ajustado ao molde”.");
    else if (env.forced) add("warn", `O molde cabe em ${P.esc(paperName(env))}, mas sem espaço para marcas externas e legenda.`);
    else add("", `Envelope em escala 100% na folha ${P.esc(paperName(env))}, com margem ≥ ${P.mmLabel(state.print.minMargin)} mm.`);

    const cw = +state.card.width, ch = +state.card.height;
    const fx = (geo.W - Math.max(cw, ch)) / 2, fy = (geo.H - Math.min(cw, ch)) / 2;
    if (fx < 1.5 || fy < 1.5) add("err", `Convite justo demais: folga de ${P.mmLabel(fx)} × ${P.mmLabel(fy)} mm. Aumente a folga.`);
    else if (fx < 2.5 || fy < 2.5) add("warn", `Folga pequena (${P.mmLabel(fx)} mm por lado). Para papel grosso, use 3 mm ou mais.`);
    else add("", `Convite entra no envelope com ${P.mmLabel(fx)} mm de folga por lado.`);

    if (crd.error) add("err", P.esc(crd.error));
    else if (crd.overflow) add("err", "O conteúdo do convite não cabe na área útil. Encurte os textos ou reduza os tamanhos.");
    else add("", `Convite: ${crd.count} por folha (${P.esc(paperName(crd))}), textos dentro da área de segurança.`);

    if (!geo.seal.fits) add("warn", "O selo está grande para a aba superior. Reduza o diâmetro ou aprofunde a aba.");
    else add("", `Selo de ${P.mmLabel(geo.seal.r * 2)} mm dentro da aba, girado para ficar de pé no verso.`);

    if (geo.glue.length < 2) add("warn", "Abas laterais estreitas: pouca área para cola. Aumente a largura das abas.");
    else add("", `Áreas de cola nas abas laterais, ocultas pela aba inferior após a montagem.`);
    add("", `Fechamento com ${P.mmLabel(geo.overlap)} mm de sobreposição entre a aba superior e a inferior.`);
    if (!(+state.print.bleed > 0)) add("warn", "Sem sangria: qualquer desvio no corte deixa filete branco na borda.");
    else add("", `Sangria de ${P.mmLabel(state.print.bleed)} mm nas bordas externas. PDF vetorial com textos em curvas.`);
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
  let lastSig = "";

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

  async function doExport(kind) {
    if (busy) return;
    busy = true;
    const buttons = $$("[data-export]");
    buttons.forEach((b) => (b.disabled = true));
    const open = state.view.exportAction === "open";
    const win = open ? window.open("", "_blank") : null;
    toast("Gerando PDF vetorial…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      const res = await P.pdf.exportPdf(kind, state, {
        open,
        win,
        onProgress: (i, n) => toast(`Gerando PDF… página ${i} de ${n}`),
      });
      toast(`PDF pronto: ${res.filename} (${res.pages.length} página${res.pages.length > 1 ? "s" : ""}). Imprima em tamanho real, escala 100%.`, 7000);
    } catch (e) {
      if (win) win.close();
      console.error(e);
      toast(`Não foi possível gerar o PDF: ${e.message}`, 9000, true);
    } finally {
      busy = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  /* ---------- projeto ---------- */
  function saveProject() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "projeto-papelaria.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    toast("Projeto salvo em projeto-papelaria.json", 4000);
  }

  function loadProject(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        state = P.mergeDefaults(P.defaults(), JSON.parse(fr.result));
        sync();
        render();
        persist();
        toast("Projeto aberto.", 3000);
      } catch (e) {
        toast("Arquivo de projeto inválido.", 5000, true);
      }
    };
    fr.readAsText(file);
  }

  /* ---------- início ---------- */
  function init() {
    buildSelects();
    buildFontPickers();
    buildSwatches();
    bind();
    sync();

    for (const b of $$(".tabs button")) {
      b.addEventListener("click", () => {
        tab = b.dataset.tab;
        $$(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
        ppmZoom = 0;
        sync();
        render();
      });
    }
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
    $("#saveProject").addEventListener("click", saveProject);
    $("#loadProject").addEventListener("change", (e) => {
      if (e.target.files[0]) loadProject(e.target.files[0]);
      e.target.value = "";
    });
    $("#resetProject").addEventListener("click", () => {
      if (!confirm("Restaurar todos os textos, cores e medidas para o padrão?")) return;
      state = P.defaults();
      sync();
      render();
      persist();
    });
    let rz = null;
    window.addEventListener("resize", () => {
      clearTimeout(rz);
      rz = setTimeout(() => (tab === "mockup" ? render() : applyZoom()), 120);
    });
    render();
    P.type.registerUiFonts();
  }

  P.app = { get state() { return state; }, render, doExport, setTab: (t) => $(`.tabs button[data-tab="${t}"]`).click() };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
