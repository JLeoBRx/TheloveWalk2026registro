// Painel administrativo do álbum.
const $ = (id) => document.getElementById(id);
const KEY = "fjnight:admin-token";
const fmt = new Intl.NumberFormat("pt-BR");
const PAGE = 48;
let token = "";
let offset = 0;
let pollTimer = 0;
const thumbUrls = [];

try { token = sessionStorage.getItem(KEY) || ""; } catch { token = ""; }

async function call(path, { method = "GET", json, form } = {}) {
  const headers = { "X-Admin-Token": token };
  let body;
  if (json) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(path, { method, headers, body });
  let data = {};
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const err = new Error(data.detail || data.code || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function msg(id, text, error = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle("is-error", error);
}

const ERR = {
  admin_unauthorized: "Token inválido.",
  admin_not_configured: "ADMIN_TOKEN não configurado no servidor (mínimo de 24 caracteres).",
  index_already_running: "Já existe uma sincronização em andamento.",
  no_face_detected: "Nenhum rosto encontrado na imagem.",
  face_too_small: "O rosto está pequeno demais na imagem.",
  face_models_unavailable: "Modelos faciais ausentes no servidor.",
};
const explain = (e) => ERR[e.message] || e.message;

async function login(event) {
  event?.preventDefault();
  token = $("token").value.trim() || token;
  if (!token) return;
  try {
    await refreshStatus();
    try { sessionStorage.setItem(KEY, token); } catch { /* ignorado */ }
    $("authed").hidden = false;
    $("logout").hidden = false;
    msg("loginMsg", "Conectado.");
    loadPhotos();
  } catch (e) {
    $("authed").hidden = true;
    msg("loginMsg", explain(e), true);
  }
}

function stat(label, value) {
  const d = document.createElement("div");
  d.className = "stat";
  const b = document.createElement("b"); b.textContent = value;
  const s = document.createElement("span"); s.textContent = label;
  d.append(b, s);
  return d;
}

async function refreshStatus() {
  const s = await call("/api/admin/status");
  const c = s.catalog, f = s.faces, j = s.job;
  const expires = new Date(f.expires_at).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
  $("stats").replaceChildren(
    stat("Arquivos na pasta", fmt.format(c.source_files)),
    stat("Publicadas", fmt.format(c.public)),
    stat("Ocultas", fmt.format(c.hidden)),
    stat("Sem download", fmt.format(c.no_download)),
    stat("Fotos no índice facial", fmt.format(f.photos_indexed)),
    stat("Rostos indexados", fmt.format(f.faces_indexed)),
    stat("Oposições registradas", fmt.format(f.optouts)),
    stat("Busca facial", f.available ? "Ativa" : ({ disabled: "Desligada", expired: "Encerrada", models_unavailable: "Sem modelos" }[f.reason] || f.reason)),
    stat("Apagamento automático", expires),
  );
  const sel = $("categoryFilter");
  if (sel.options.length === 1) {
    for (const cat of c.categories) {
      const o = document.createElement("option");
      o.value = cat.id; o.textContent = `${cat.label} (${cat.count})`;
      sel.append(o);
    }
  }
  if (j.running) {
    $("progress").hidden = false;
    $("progressBar").style.width = j.total ? `${Math.round((100 * j.done) / j.total)}%` : "5%";
    msg("jobMsg", `${j.phase === "faces" ? "Indexando rostos" : "Processando fotografias"}: ${j.done} de ${j.total}…`);
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => refreshStatus().catch(() => {}), 1500);
  } else {
    $("progress").hidden = true;
    if (j.last_result) {
      const r = j.last_result, cat = r.catalog || {}, fc = r.faces || {};
      msg("jobMsg", `Última sincronização: ${cat.found ?? 0} arquivos, ${cat.processed ?? 0} novos/alterados, ${cat.removed ?? 0} removidos, ${cat.errors ?? 0} erros.` +
        (fc.status === "ok" ? ` Rostos: ${fc.faces_indexed} indexados em ${fc.photos_processed} fotos.` : fc.status ? ` Índice facial: ${fc.status}.` : ""));
    } else if (j.last_error) {
      msg("jobMsg", `A última sincronização falhou (${j.last_error}).`, true);
    } else {
      msg("jobMsg", "");
    }
  }
  return s;
}

async function loadPhotos() {
  const qs = new URLSearchParams({ offset: String(offset), limit: String(PAGE) });
  if ($("search").value.trim()) qs.set("q", $("search").value.trim());
  if ($("categoryFilter").value) qs.set("category", $("categoryFilter").value);
  if ($("onlyFilter").value) qs.set("only", $("onlyFilter").value);
  const data = await call(`/api/admin/photos?${qs}`);
  thumbUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const grid = $("photoGrid");
  grid.replaceChildren();
  for (const p of data.items) {
    const card = document.createElement("div");
    card.className = "admin-card" + (p.hidden ? " is-hidden" : "");
    const img = document.createElement("img");
    img.alt = p.rel_path;
    img.loading = "lazy";
    card.append(img);
    fetch(`/api/admin/photos/${p.id}/thumb`, { headers: { "X-Admin-Token": token } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b) { const u = URL.createObjectURL(b); thumbUrls.push(u); img.src = u; } });
    const body = document.createElement("div");
    body.className = "admin-card__body";
    const name = document.createElement("span");
    name.className = "admin-card__name"; name.textContent = p.rel_path; name.title = p.rel_path;
    body.append(name);
    for (const [field, label, invert] of [["hidden", "Publicada", true], ["downloadable", "Download", false], ["face_search", "Busca facial", false]]) {
      const lab = document.createElement("label");
      lab.className = "toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = invert ? !p[field] : p[field];
      input.addEventListener("change", async () => {
        input.disabled = true;
        try {
          const value = invert ? !input.checked : input.checked;
          const r = await call(`/api/admin/photos/${p.id}`, { method: "PATCH", json: { [field]: value } });
          card.classList.toggle("is-hidden", r.hidden);
        } catch (e) {
          input.checked = !input.checked;
          alert(`Não foi possível salvar: ${explain(e)}`);
        } finally {
          input.disabled = false;
        }
      });
      lab.append(input, document.createTextNode(label));
      body.append(lab);
    }
    card.append(body);
    grid.append(card);
  }
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  $("pageInfo").textContent = `Página ${Math.floor(offset / PAGE) + 1} de ${pages} · ${fmt.format(data.total)} fotos`;
  $("prevPage").disabled = offset === 0;
  $("nextPage").disabled = offset + PAGE >= data.total;
}

$("loginForm").addEventListener("submit", login);
$("logout").addEventListener("click", () => {
  token = "";
  try { sessionStorage.removeItem(KEY); } catch { /* ignorado */ }
  location.reload();
});
$("syncConfirm").addEventListener("change", (e) => { $("syncBtn").disabled = !e.target.checked; });
$("syncBtn").addEventListener("click", async () => {
  try {
    await call("/api/admin/sync", { method: "POST", json: { confirm: true, faces: true } });
    msg("syncMsg", "Sincronização iniciada. Acompanhe o progresso em “Situação”.");
    refreshStatus();
  } catch (e) { msg("syncMsg", explain(e), true); }
});
$("exportRules").addEventListener("click", async () => {
  try {
    const data = await call("/api/admin/rules/export");
    const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "photo-rules.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    msg("syncMsg", "Arquivo exportado. Salve-o em fjnight/config/photo-rules.json e faça commit para tornar as decisões permanentes.");
  } catch (e) { msg("syncMsg", explain(e), true); }
});
let searchTimer = 0;
$("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { offset = 0; loadPhotos(); }, 300); });
$("categoryFilter").addEventListener("change", () => { offset = 0; loadPhotos(); });
$("onlyFilter").addEventListener("change", () => { offset = 0; loadPhotos(); });
$("prevPage").addEventListener("click", () => { offset = Math.max(0, offset - PAGE); loadPhotos(); });
$("nextPage").addEventListener("click", () => { offset += PAGE; loadPhotos(); });

async function sendOptout(face) {
  const file = $("optoutFile").files[0];
  if (!file) { msg("optoutMsg", "Escolha a foto do rosto da pessoa.", true); return; }
  if (!confirm("Registrar a oposição desta pessoa? O rosto dela deixará de ser localizado pela busca facial.")) return;
  const form = new FormData();
  form.append("image", file);
  form.append("confirm", "true");
  if (face != null) form.append("face", String(face));
  try {
    const r = await call("/api/admin/faces/optout", { method: "POST", form });
    if (r.status === "choose_face") {
      const box = $("optoutFaces");
      box.replaceChildren();
      msg("optoutMsg", `A foto tem ${r.faces.length} rostos. Escolha o da pessoa (da esquerda para a direita, por tamanho):`);
      r.faces.forEach((f, i) => {
        const b = document.createElement("button");
        b.className = "btn btn--ghost btn--sm";
        b.textContent = `Rosto ${i + 1} (x ${Math.round(f.x * 100)}%)`;
        b.addEventListener("click", () => { box.replaceChildren(); sendOptout(f.index); });
        box.append(b);
      });
      return;
    }
    msg("optoutMsg", `Oposição registrada. ${r.faces_removed} rosto(s) removido(s) do índice em ${r.photos_affected} foto(s).`);
    $("optoutFile").value = "";
    const box = $("optoutFaces");
    box.replaceChildren();
    if (r.photo_ids && r.photo_ids.length) {
      // Sem disco persistente, o registro de oposição some no próximo deploy.
      // Retirar as fotos da busca e exportar as regras mantém a decisão no Git, sem biometria.
      const keep = document.createElement("button");
      keep.className = "btn btn--ghost btn--sm";
      keep.textContent = `Retirar estas ${r.photo_ids.length} foto(s) da busca facial`;
      keep.addEventListener("click", async () => {
        keep.disabled = true;
        try {
          for (const id of r.photo_ids) await call(`/api/admin/photos/${id}`, { method: "PATCH", json: { face_search: false } });
          msg("optoutMsg", "Fotos retiradas da busca facial. Agora use “Exportar regras” e faça commit de config/photo-rules.json para manter a decisão em novos deploys.");
          box.replaceChildren();
          loadPhotos();
        } catch (e) { msg("optoutMsg", explain(e), true); keep.disabled = false; }
      });
      box.append(keep);
    }
    refreshStatus();
  } catch (e) { msg("optoutMsg", explain(e), true); }
}
$("optoutBtn").addEventListener("click", () => sendOptout(null));

$("reindexBtn").addEventListener("click", async () => {
  if (!confirm("Apagar e reconstruir o índice facial agora?")) return;
  try {
    await call("/api/admin/faces/reindex", { method: "POST", json: { confirm: true } });
    msg("facesMsg", "Reconstrução iniciada.");
    refreshStatus();
  } catch (e) { msg("facesMsg", explain(e), true); }
});
$("purgeBtn").addEventListener("click", async () => {
  const typed = prompt("Para apagar todos os dados faciais, digite APAGAR");
  if (typed !== "APAGAR") return;
  try {
    await call("/api/admin/faces", { method: "DELETE", json: { confirm: "APAGAR", include_optouts: $("purgeOptouts").checked } });
    msg("facesMsg", "Dados faciais apagados.");
    refreshStatus();
  } catch (e) { msg("facesMsg", explain(e), true); }
});

if (token) { $("token").value = token; login(); }
