// Preenche a política de privacidade com os dados informados pelo controlador.
// Campos vazios aparecem como "não informado" — o sistema não inventa valores.
const MISSING = "Não informado pelo controlador.";

function fill(node, value) {
  const text = typeof value === "string" ? value.trim() : "";
  node.textContent = text || MISSING;
  node.classList.toggle("is-missing", !text);
}

try {
  const response = await fetch("/api/privacy", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(String(response.status));
  const data = await response.json();
  document.querySelectorAll("[data-privacy]").forEach((node) => fill(node, data.privacy?.[node.dataset.privacy]));
  const expires = data.face_search?.expires_at;
  if (expires) {
    const label = new Date(`${expires}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
    document.querySelectorAll("[data-expiry]").forEach((n) => { n.textContent = label; });
  }
  document.getElementById("faceState").textContent = data.retention_receipt
    ? "Encerrada: o prazo terminou e os dados faciais foram eliminados."
    : data.face_search?.authorized
      ? "Ativa, com autorização registrada pelo controlador."
      : "Desativada. Nenhum dado facial das fotos é processado enquanto a busca não for autorizada.";
} catch {
  document.querySelectorAll("[data-privacy]").forEach((node) => fill(node, ""));
  document.getElementById("faceState").textContent = "Não foi possível consultar a situação agora.";
}
