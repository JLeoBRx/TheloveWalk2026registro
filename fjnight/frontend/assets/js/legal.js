// Preenche a página de privacidade com os dados configurados do evento.
import { api } from "./api.js";

try {
  const data = await api.event();
  const event = data.event || {};
  document.querySelectorAll("[data-event]").forEach((node) => {
    const value = event[node.dataset.event];
    if (typeof value === "string" && value.trim()) node.textContent = value;
  });
  const expires = data.face_search?.expires_at;
  if (expires) {
    const label = new Date(`${expires}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
    document.querySelectorAll("[data-expiry]").forEach((n) => { n.textContent = label; });
  }
} catch {
  /* mantém o texto padrão */
}
