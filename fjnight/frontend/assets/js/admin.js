// Painel administrativo da FJU Night.
// Sessão por cookie HttpOnly; o token CSRF fica só na memória desta página.
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("pt-BR");
const PAGE = 48;
let csrf = "";
let offset = 0;
let pollTimer = 0;
let sessionTimer = 0;
let idleExpiresAt = 0;
let importPayload = null;
let lastJobRunning = false;

const ERR = {
  admin_unauthorized: "Token inválido.",
  admin_not_configured: "ADMIN_TOKEN não está configurado no servidor (mínimo de 24 caracteres).",
  admin_session_required: "Sua sessão expirou. Entre novamente.",
  too_many_login_attempts: "Muitas tentativas. Aguarde alguns minutos para tentar de novo.",
  csrf_failed: "A página ficou desatualizada. Recarregue e tente de novo.",
  durable_storage_required: "Sem banco durável (DATABASE_URL), esta alteração seria perdida no próximo deploy. Configure o banco antes.",
  index_already_running: "Já existe uma sincronização em andamento.",
  confirmation_required: "Confirmação necessária.",
  no_face_detected: "Nenhum rosto encontrado na imagem.",
  face_too_small: "O rosto está pequeno demais na imagem.",
  face_models_unavailable: "Modelos faciais ausentes no servidor.",
  face_key_missing: "FACE_DATA_KEY não está configurada no servidor.",
  face_key_mismatch: "A FACE_DATA_KEY atual é diferente da usada nos registros. Restaure a chave correta.",
  face_search_not_authorized: "A busca facial não está autorizada.",
  authorization_checklist_incomplete: "Marque todas as confirmações.",
  authorization_identity_required: "Informe nome e cargo de quem autoriza.",
  authorization_prerequisites_missing: "Ainda há pendências obrigatórias (veja a lista acima).",
  invalid_image: "Imagem inválida. Use JPG, PNG ou WebP.",
  unsupported_media_type: "Formato não suportado. Use JPG, PNG ou WebP.",
  file_too_large: "Arquivo grande demais.",
  playlist_track_invalid: "Cada faixa precisa de título e de um link ou ID válido do YouTube.",
  playlist_invalid: "Playlist inválida.",
  config_format_invalid: "Este arquivo não é uma exportação válida do painel.",
  optout_not_found: "Registro não encontrado.",
  network_error: "Sem conexão com o servidor.",
};
const explain = (e) => ERR[e.code] || ERR[e.message] || `Erro inesperado (${e.code || e.message}).`;
const ACTIONS = {
  login: "Login", logout: "Saída", sync: "Sincronização", photo_rule: "Regra de foto", publish_pending: "Publicação",
  face_authorize: "Autorização da busca facial", face_revoke: "Revogação da busca facial",
  optout_registered: "Oposição registrada", optout_removed: "Oposição removida", face_reindex: "Reconstrução do índice",
  face_purge: "Exclusão de dados faciais", retention_purge: "Exclusão por fim da retenção",
  playlist_saved: "Playlist", config_exported: "Exportação", config_restored: "Restauração",
  sessions_revoked: "Sessões encerradas",
};

class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

async function api(path, { method = "GET", json, body, headers = {} } = {}) {
  const h = { Accept: "application/json", ...headers };
  if (method !== "GET") h["X-CSRF-Token"] = csrf;
  let payload = body;
  if (json !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(json); }
  let res;
  try {
    res = await fetch(path, { method, headers: h, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError("network_error", 0);
  }
  let data = {};
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const code = data.detail || data.code || `http_${res.status}`;
    if (res.status === 401 && path !== "/api/admin/login") showLogin(ERR.admin_session_required);
    throw new ApiError(typeof code === "string" ? code : `http_${res.status}`, res.status);
  }
  touchSession();
  return data;
}

function msg(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle("is-error", kind === "error");
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("is-visible");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("is-visible"), 3500);
}

function when(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

// ---------------- Confirmação ----------------
function confirmDialog({ title, text, word = "", ok = "Confirmar" }) {
  return new Promise((resolve) => {
    const modal = $("confirmModal");
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmOk").textContent = ok;
    const input = $("confirmType");
    const label = $("confirmTypeLabel");
    input.value = "";
    input.hidden = label.hidden = !word;
    label.textContent = word ? `Para confirmar, digite ${word}` : "";
    const okBtn = $("confirmOk");
    okBtn.disabled = Boolean(word);
    const onInput = () => { okBtn.disabled = input.value.trim() !== word; };
    const done = (value) => {
      modal.hidden = true;
      input.removeEventListener("input", onInput);
      okBtn.onclick = $("confirmCancel").onclick = null;
      resolve(value);
    };
    input.addEventListener("input", onInput);
    okBtn.onclick = () => done(true);
    $("confirmCancel").onclick = () => done(false);
    modal.hidden = false;
    (word ? input : $("confirmCancel")).focus();
  });
}

// ---------------- Sessão ----------------
function touchSession() {
  if (idleExpiresAt) idleExpiresAt = Date.now() / 1000 + (touchSession.idle || 30) * 60;
}

function renderSessionTime() {
  if (!idleExpiresAt) return;
  const left = Math.max(0, Math.round((idleExpiresAt - Date.now() / 1000) / 60));
  $("sessionTime").textContent = left > 0 ? `Sessão expira em ${left} min sem uso` : "Sessão expirada";
  if (left <= 0) showLogin(ERR.admin_session_required);
}

function showLogin(message = "") {
  csrf = "";
  idleExpiresAt = 0;
  clearInterval(sessionTimer);
  clearTimeout(pollTimer);
  $("app").hidden = true;
  $("sessionBox").hidden = true;
  $("loginPanel").hidden = false;
  msg("loginMsg", message, message ? "error" : "");
}

function startSession(info) {
  csrf = info.csrf;
  touchSession.idle = info.idle_minutes || 30;
  idleExpiresAt = info.idle_expires_at || Date.now() / 1000 + touchSession.idle * 60;
  $("loginPanel").hidden = true;
  $("app").hidden = false;
  $("sessionBox").hidden = false;
  clearInterval(sessionTimer);
  sessionTimer = setInterval(renderSessionTime, 20000);
  renderSessionTime();
  refreshStatus();
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = $("token").value;
  try {
    const info = await api("/api/admin/login", { method: "POST", json: { token } });
    $("token").value = "";
    startSession(info);
  } catch (err) {
    msg("loginMsg", explain(err), "error");
  }
});

$("logout").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST", json: {} }); } catch { /* sessão já encerrada */ }
  showLogin("Você saiu do painel.");
});

// ---------------- Abas ----------------
document.querySelector(".admin-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  document.querySelectorAll(".admin-tabs [data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === b)));
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  ({ overview: refreshStatus, photos: () => { loadPhotos(); loadIssues(); }, faces: loadFaces,
     music: loadTracks, history: loadHistory })[b.dataset.tab]?.();
});

// ---------------- Situação ----------------
function check(ok, text, warn = false) {
  return el("div", { class: `check-row ${ok ? "is-ok" : warn ? "is-warn" : "is-bad"}` },
    el("b", { text: ok ? "✓" : warn ? "!" : "✕", "aria-hidden": "true" }), el("span", { text }));
}

function stat(label, value) {
  return el("div", { class: "stat" }, el("b", { text: value }), el("span", { text: label }));
}

async function refreshStatus() {
  let s;
  try { s = await api("/api/admin/status"); } catch (err) { msg("persistenceMsg", explain(err), "error"); return; }
  const p = s.persistence, db = p.database, st = p.storage, f = s.faces, c = s.catalog;
  $("persistence").replaceChildren(
    check(db.ok, `Banco de dados ${db.kind === "postgresql" ? "PostgreSQL" : "SQLite"}: ${db.ok ? `leitura e escrita confirmadas (${db.latency_ms} ms)` : `indisponível (${db.error || "erro"})`}`),
    check(db.durable, db.durable ? "Decisões do painel são permanentes (sobrevivem a deploys)." :
      "Banco NÃO durável: alterações do painel estão bloqueadas. Configure DATABASE_URL.", !db.durable),
    check(st.ok, `Fotos: ${st.kind === "r2" ? `Cloudflare R2 (bucket ${st.bucket})` : "pasta local"} ${st.ok ? "acessível" : `indisponível (${st.error || "erro"})`}`),
    check(f.key.configured && f.key.matches, f.key.configured ? (f.key.matches ? "Chave de cifragem configurada e consistente." :
      "Chave de cifragem diferente da usada nos registros!") : "FACE_DATA_KEY não configurada (necessária só para a busca facial).", !f.key.configured),
  );
  msg("persistenceMsg", p.admin_writes_allowed ? "" : "Modo somente leitura: a galeria funciona normalmente.", p.admin_writes_allowed ? "" : "error");
  $("stats").replaceChildren(
    stat("Publicadas", fmt.format(c.public)), stat("Ocultas", fmt.format(c.hidden)),
    stat("Em revisão", fmt.format(c.pending_review)), stat("RAW", fmt.format(c.raw)),
    stat("Sem download", fmt.format(c.no_download)), stat("Com problema", fmt.format(c.issues)),
    stat("Busca facial", f.search.available ? "Ativa" : f.authorized ? "Preparando" : "Desligada"),
    stat("Oposições", fmt.format(f.optouts)),
  );
  $("publishPending").hidden = !c.pending_review;
  const ls = c.last_sync;
  $("lastSync").textContent = ls ? `Última sincronização: ${when(ls.at)} — ${ls.found} arquivos, ${ls.processed} processados, ` +
    `${ls.unchanged} sem mudança, ${ls.renamed} renomeados, ${ls.duplicates} duplicatas, ${ls.removed} removidos, ${ls.errors} com erro.` :
    "Nenhuma sincronização registrada ainda.";
  const sel = $("categoryFilter");
  if (sel.options.length === 1) {
    for (const cat of c.categories) sel.append(el("option", { value: cat.id, text: `${cat.label} (${cat.count})` }));
  }
  renderJob(s.job);
}

function renderJob(j) {
  const box = $("job");
  if (j.running) {
    box.hidden = false;
    $("jobLabel").textContent = `${j.phase === "faces" ? "Atualizando o índice facial" : "Processando fotografias"}: ${j.done} de ${j.total}…`;
    $("progressBar").style.width = j.total ? `${Math.round((100 * j.done) / j.total)}%` : "4%";
    $("syncBtn").disabled = true;
    lastJobRunning = true;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(refreshStatus, 1500);
    return;
  }
  box.hidden = true;
  $("syncBtn").disabled = !$("syncConfirm").checked;
  if (lastJobRunning) {  // sucesso só depois que o servidor confirma o término
    lastJobRunning = false;
    if (j.last_error) msg("syncMsg", `A sincronização falhou (${j.last_error}). Veja o histórico.`, "error");
    else if (j.last_result) {
      const r = j.last_result.catalog;
      msg("syncMsg", `Sincronização concluída: ${r.processed} processadas, ${r.removed} removidas, ${r.duplicates} duplicatas, ${r.errors} com erro.`);
    }
  }
}

$("syncConfirm").addEventListener("change", (e) => { $("syncBtn").disabled = !e.target.checked; });
$("syncBtn").addEventListener("click", async () => {
  try {
    await api("/api/admin/sync", { method: "POST", json: { confirm: true } });
    msg("syncMsg", "Sincronização em andamento…");
    lastJobRunning = true;
    refreshStatus();
  } catch (err) { msg("syncMsg", explain(err), "error"); }
});
$("publishPending").addEventListener("click", async () => {
  if (!await confirmDialog({ title: "Publicar fotos em revisão?", text: "Todas as fotos aguardando revisão passarão a aparecer no álbum.", ok: "Publicar" })) return;
  try {
    const r = await api("/api/admin/photos/publish-pending", { method: "POST", json: { confirm: true } });
    toast(`${r.published} foto(s) publicada(s).`);
    refreshStatus();
  } catch (err) { msg("syncMsg", explain(err), "error"); }
});

// ---------------- Fotos ----------------
async function loadPhotos() {
  const qs = new URLSearchParams({ offset: String(offset), limit: String(PAGE) });
  if ($("search").value.trim()) qs.set("q", $("search").value.trim());
  if ($("categoryFilter").value) qs.set("category", $("categoryFilter").value);
  if ($("onlyFilter").value) qs.set("only", $("onlyFilter").value);
  let data;
  try { data = await api(`/api/admin/photos?${qs}`); } catch (err) { toast(explain(err)); return; }
  const grid = $("photoGrid");
  grid.replaceChildren(...data.items.map((p) => photoCard(p)));
  if (!data.items.length) grid.append(el("p", { class: "admin-note", text: "Nenhuma foto encontrada." }));
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  $("pageInfo").textContent = `Página ${Math.floor(offset / PAGE) + 1} de ${pages} · ${fmt.format(data.total)} fotos`;
  $("prevPage").disabled = offset === 0;
  $("nextPage").disabled = offset + PAGE >= data.total;
}

function photoCard(p) {
  const card = el("div", { class: "admin-card" + (p.hidden ? " is-hidden" : "") },
    el("img", { src: p.thumb, alt: p.rel_path, loading: "lazy" }));
  const body = el("div", { class: "admin-card__body" }, el("span", { class: "admin-card__name", text: p.rel_path, title: p.rel_path }));
  if (p.reason) body.append(el("span", { class: "admin-card__reason", text: p.reason }));
  for (const [field, label, invert] of [["hidden", "Publicada", true], ["downloadable", "Download", false], ["face_search", "Busca facial", false]]) {
    const input = el("input", { type: "checkbox" });
    input.checked = invert ? !p[field] : p[field];
    input.addEventListener("change", async () => {
      input.disabled = true;
      const value = invert ? !input.checked : input.checked;
      try {
        const r = await api(`/api/admin/photos/${p.id}`, { method: "PATCH", json: { [field]: value } });
        card.classList.toggle("is-hidden", r.hidden);
        toast("Alteração salva.");
      } catch (err) {
        input.checked = !input.checked;
        toast(explain(err));
      } finally { input.disabled = false; }
    });
    body.append(el("label", { class: "toggle" }, input, document.createTextNode(label)));
  }
  card.append(body);
  return card;
}

async function loadIssues() {
  try {
    const data = await api("/api/admin/issues");
    $("issues").replaceChildren(...(data.items.length ? data.items.map((i) => el("li", {},
      el("span", { text: `${i.rel_path} — ${i.kind === "duplicate" ? "duplicata" : "erro"}: ${i.detail}` }))) :
      [el("li", { class: "empty", text: "Nenhum problema na última sincronização." })]));
  } catch (err) { toast(explain(err)); }
}

let searchTimer = 0;
$("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { offset = 0; loadPhotos(); }, 300); });
$("categoryFilter").addEventListener("change", () => { offset = 0; loadPhotos(); });
$("onlyFilter").addEventListener("change", () => { offset = 0; loadPhotos(); });
$("prevPage").addEventListener("click", () => { offset = Math.max(0, offset - PAGE); loadPhotos(); });
$("nextPage").addEventListener("click", () => { offset += PAGE; loadPhotos(); });

// ---------------- Busca facial ----------------
const PRIVACY_LABELS = {
  controller: "Controlador", controller_document: "CNPJ/CPF", contact: "Contato", dpo: "Encarregado (DPO)",
  requests_channel: "Canal de atendimento", response_time: "Prazo de resposta",
  legal_basis_publication: "Base legal — publicação", legal_basis_face_index: "Base legal — índice facial",
  legal_basis_face_search: "Base legal — busca com selfie", attendees_notice: "Como os participantes foram informados",
};

async function loadFaces() {
  let a, status, optouts;
  try {
    const [auth, st, list] = await Promise.all([api("/api/admin/faces/authorization"), api("/api/admin/status"),
      api("/api/admin/faces/optouts")]);
    a = auth; status = st; optouts = list.items;
  } catch (err) { msg("authMsg", explain(err), "error"); return; }
  const f = status.faces;
  $("faceSummary").textContent = f.search.available ? "A busca facial está ATIVA para os visitantes."
    : a.authorized ? "Autorizada — o índice está sendo preparado." : "A busca facial está DESLIGADA para os visitantes.";
  const labels = {
    env_enabled: "FACE_SEARCH_ENABLED ativo no servidor", durable_storage: "Banco durável configurado",
    key_configured: "FACE_DATA_KEY configurada", key_matches: "Chave consistente com os registros",
    privacy_complete: "config/privacy.json preenchido", authorized: "Autorização registrada pelo responsável",
    privacy_unchanged: "Texto de privacidade igual ao autorizado", within_retention: "Dentro do prazo de retenção",
    models_available: "Modelos faciais presentes",
  };
  $("faceChecks").replaceChildren(...Object.entries(a.checks).map(([k, ok]) => {
    const pending = a.pending.find((p) => p.code === k);
    return check(ok || (k === "privacy_unchanged" && !a.checks.authorized), pending ? pending.message : labels[k]);
  }));
  $("privacyPreview").replaceChildren(...Object.entries(PRIVACY_LABELS).map(([k, label]) =>
    el("div", {}, el("dt", { text: label }), el("dd", { class: a.privacy[k] ? "" : "is-missing", text: a.privacy[k] || "Não preenchido" }))));
  const list = $("authChecklist");
  if (!list.childElementCount) {
    for (const [k, text] of Object.entries(a.checklist)) {
      list.append(el("label", { class: "check-inline" }, el("input", { type: "checkbox", "data-check": k }), el("span", { text })));
    }
    list.addEventListener("change", syncAuthButton);
  }
  syncAuthButton();
  $("revokeBtn").hidden = !a.authorization;
  $("authHistory").replaceChildren(...(a.history.length ? a.history.map((h) => el("li", {}, el("span", {
    text: `${when(h.created_at)} — ${h.confirmed_by} (${h.role})` + (h.revoked_at ? ` · revogada em ${when(h.revoked_at)}${h.revoke_reason ? ` (${h.revoke_reason})` : ""}` : " · VIGENTE"),
  }))) : [el("li", { class: "empty", text: "Nenhuma autorização registrada." })]));
  $("optoutList").replaceChildren(...(optouts.length ? optouts.map((o) => el("li", {},
    el("span", { text: `${o.protocol} — ${when(o.created_at)}` }),
    el("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Remover", onclick: () => removeOptout(o.protocol) }))) :
    [el("li", { class: "empty", text: "Nenhuma oposição registrada." })]));
  const r = f.retention_receipt;
  $("retentionReceipt").textContent = r ? `Exclusão por fim da retenção em ${when(r.executed_at)}: ${r.local_faces_deleted} rostos e ${r.optouts_deleted} oposições eliminados — verificação ${r.verified ? "confirmada" : "FALHOU"}.`
    : `Exclusão automática prevista para ${new Date(a.expires_at).toLocaleDateString("pt-BR")}. Índice atual: ${fmt.format(f.local_index.faces_indexed)} rostos em ${fmt.format(f.local_index.photos_indexed)} fotos.`;
}

function syncAuthButton() {
  const boxes = [...document.querySelectorAll("[data-check]")];
  $("authBtn").disabled = !(boxes.length && boxes.every((b) => b.checked));
}

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const checklist = Object.fromEntries([...document.querySelectorAll("[data-check]")].map((b) => [b.dataset.check, b.checked]));
  if (!await confirmDialog({ title: "Registrar autorização?", text: "A busca facial passará a indexar o rosto das pessoas nas fotos publicadas, assim que todas as pendências estiverem resolvidas.", word: "AUTORIZAR", ok: "Autorizar" })) return;
  try {
    await api("/api/admin/faces/authorize", { method: "POST", json: { confirmed_by: $("authName").value, role: $("authRole").value, checklist } });
    msg("authMsg", "Autorização registrada.");
    loadFaces();
  } catch (err) { msg("authMsg", explain(err), "error"); }
});

$("revokeBtn").addEventListener("click", async () => {
  if (!await confirmDialog({ title: "Revogar a autorização?", text: "A busca facial será desligada e o índice facial apagado imediatamente.", word: "REVOGAR", ok: "Revogar" })) return;
  try {
    await api("/api/admin/faces/revoke", { method: "POST", json: { confirm: "REVOGAR", by: $("authName").value || "painel", reason: "Revogada no painel" } });
    msg("authMsg", "Autorização revogada e índice apagado.");
    loadFaces();
  } catch (err) { msg("authMsg", explain(err), "error"); }
});

async function sendOptout(face) {
  const file = $("optoutFile").files[0];
  if (!file) { msg("optoutMsg", "Escolha a foto do rosto da pessoa.", "error"); return; }
  if (face == null && !await confirmDialog({ title: "Registrar oposição?", text: "O rosto desta pessoa deixará de ser localizado pela busca facial, inclusive após novos deploys.", ok: "Registrar" })) return;
  try {
    const r = await api(`/api/admin/faces/optout${face != null ? `?face=${face}` : ""}`, {
      method: "POST", body: file, headers: { "Content-Type": file.type || "image/jpeg", "X-Confirm": "true" } });
    if (r.status === "choose_face") {
      msg("optoutMsg", `A foto tem ${r.faces.length} rostos. Escolha o da pessoa (ordenados do maior para o menor):`);
      $("optoutFaces").replaceChildren(...r.faces.map((f, i) => el("button", { class: "btn btn--ghost btn--sm", type: "button",
        text: `Rosto ${i + 1} (posição ${Math.round(f.x * 100)}% da esquerda)`, onclick: () => { $("optoutFaces").replaceChildren(); sendOptout(f.index); } })));
      return;
    }
    msg("optoutMsg", `Oposição registrada com o protocolo ${r.protocol}. ${r.faces_removed} rosto(s) removido(s) do índice atual.`);
    $("optoutFile").value = "";
    loadFaces();
  } catch (err) { msg("optoutMsg", explain(err), "error"); }
}
$("optoutBtn").addEventListener("click", () => sendOptout(null));

async function removeOptout(protocol) {
  if (!await confirmDialog({ title: `Remover a oposição ${protocol}?`, text: "Use apenas se a própria pessoa retirou o pedido. Os rostos dela voltarão a ser indexados na próxima sincronização.", word: "REMOVER", ok: "Remover" })) return;
  try {
    await api(`/api/admin/faces/optouts/${encodeURIComponent(protocol)}`, { method: "DELETE", json: { confirm: "REMOVER" } });
    toast("Oposição removida.");
    loadFaces();
  } catch (err) { msg("optoutMsg", explain(err), "error"); }
}

$("reindexBtn").addEventListener("click", async () => {
  if (!await confirmDialog({ title: "Reconstruir o índice facial?", text: "O índice atual será apagado e recalculado a partir das fotos publicadas." })) return;
  try {
    await api("/api/admin/faces/reindex", { method: "POST", json: { confirm: true } });
    msg("facesMsg", "Reconstrução em andamento. Acompanhe na aba Situação.");
  } catch (err) { msg("facesMsg", explain(err), "error"); }
});

$("purgeBtn").addEventListener("click", async () => {
  const all = $("purgeOptouts").checked;
  if (!await confirmDialog({ title: "Apagar dados faciais?", text: all ? "Serão apagados o índice, todas as oposições e a autorização. Não há como desfazer." : "O índice facial será apagado imediatamente.", word: "APAGAR", ok: "Apagar" })) return;
  try {
    const r = await api("/api/admin/faces", { method: "DELETE", json: { confirm: "APAGAR", include_optouts: all } });
    msg("facesMsg", `Apagados: ${r.faces_indexed} rostos do índice${all ? ` e ${r.optouts_deleted} oposições` : ""}. Arquivo do índice removido: ${r.file_removed ? "sim" : "NÃO"}.`);
    loadFaces();
  } catch (err) { msg("facesMsg", explain(err), "error"); }
});

// ---------------- Trilha ----------------
function trackRow(t = {}) {
  const row = el("div", { class: "track-row" },
    el("input", { class: "field", placeholder: "Título", maxlength: "120", "aria-label": "Título", value: t.title || "" }),
    el("input", { class: "field", placeholder: "Artista (opcional)", maxlength: "120", "aria-label": "Artista", value: t.artist || "" }),
    el("input", { class: "field", placeholder: "Link ou ID do YouTube", "aria-label": "Link ou ID do YouTube", value: t.youtube_id || "" }),
    el("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Remover", onclick: () => row.remove() }));
  return row;
}

async function loadTracks() {
  try {
    const data = await api("/api/admin/playlist");
    $("tracks").replaceChildren(...data.tracks.map(trackRow));
    if (!data.tracks.length) msg("musicMsg", "Nenhuma faixa cadastrada: o player não aparece no site.");
  } catch (err) { msg("musicMsg", explain(err), "error"); }
}
$("addTrack").addEventListener("click", () => $("tracks").append(trackRow()));
$("saveTracks").addEventListener("click", async () => {
  const tracks = [...$("tracks").children].map((row) => {
    const [title, artist, url] = row.querySelectorAll("input");
    return { title: title.value, artist: artist.value, url: url.value };
  });
  try {
    const r = await api("/api/admin/playlist", { method: "PUT", json: { tracks } });
    $("tracks").replaceChildren(...r.tracks.map(trackRow));
    msg("musicMsg", `Playlist salva com ${r.tracks.length} faixa(s).`);
  } catch (err) { msg("musicMsg", explain(err), "error"); }
});

// ---------------- Configurações ----------------
$("exportBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/admin/config/export");
    const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" })),
      download: `fjunight-configuracao-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Exportadas ${data.regras_por_arquivo.length} regras e ${data.playlist.length} faixas.`);
  } catch (err) { toast(explain(err)); }
});

$("importCheck").addEventListener("click", async () => {
  importPayload = null;
  $("importApply").disabled = true;
  const file = $("importFile").files[0];
  if (!file) { msg("importMsg", "Escolha o arquivo exportado.", "error"); return; }
  try {
    importPayload = JSON.parse(await file.text());
  } catch { msg("importMsg", "O arquivo não é um JSON válido.", "error"); return; }
  try {
    const r = await api("/api/admin/config/import?dry_run=true", { method: "POST", json: importPayload });
    msg("importMsg", `O arquivo restaura ${r.rules} regra(s)${r.rules_ignored ? ` (${r.rules_ignored} ignoradas por estarem incompletas)` : ""}` +
      `${r.playlist_tracks != null ? ` e uma playlist com ${r.playlist_tracks} faixa(s)` : ""}. Nada foi alterado ainda.`);
    $("importApply").disabled = false;
  } catch (err) { importPayload = null; msg("importMsg", explain(err), "error"); }
});

$("importApply").addEventListener("click", async () => {
  if (!importPayload) return;
  if (!await confirmDialog({ title: "Restaurar configurações?", text: "As regras do arquivo substituirão as atuais para as mesmas fotos.", word: "RESTAURAR", ok: "Restaurar" })) return;
  try {
    const r = await api("/api/admin/config/import?dry_run=false", { method: "POST", json: importPayload });
    msg("importMsg", `Restauradas ${r.rules} regra(s).`);
    $("importApply").disabled = true;
    importPayload = null;
  } catch (err) { msg("importMsg", explain(err), "error"); }
});

$("revokeSessions").addEventListener("click", async () => {
  if (!await confirmDialog({ title: "Encerrar todas as sessões?", text: "Todos os acessos ao painel serão desconectados, inclusive este." })) return;
  try { await api("/api/admin/sessions/revoke-all", { method: "POST", json: {} }); } catch { /* já encerrada */ }
  showLogin("Todas as sessões foram encerradas.");
});

// ---------------- Histórico ----------------
async function loadHistory() {
  try {
    const data = await api("/api/admin/history?limit=100");
    $("historyBody").replaceChildren(...data.items.map((h) => el("tr", {},
      el("td", { text: when(h.at) }), el("td", { text: ACTIONS[h.action] || h.action }),
      el("td", { class: h.ok ? "ok" : "fail", text: h.ok ? "Concluída" : "Falhou" }),
      el("td", {}, el("code", { text: Object.keys(h.detail).length ? JSON.stringify(h.detail) : "" })))));
  } catch (err) { toast(explain(err)); }
}

// ---------------- Início ----------------
(async () => {
  try {
    const info = await api("/api/admin/session");
    startSession(info);
  } catch {
    showLogin("");
  }
})();
