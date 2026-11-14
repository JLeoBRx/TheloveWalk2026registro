// Comunicação com o servidor do álbum (tentativas, tempo limite e erros legíveis).

export class ApiError extends Error {
  constructor(code, status, data = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

async function request(path, { method = "GET", body, timeout = 20000, retries = 2, headers = {} } = {}) {
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(path, {
        method,
        body,
        headers: { Accept: "application/json", ...headers },
        signal: controller.signal,
        credentials: "same-origin",
      });
      let data = {};
      try { data = await response.json(); } catch { /* corpo vazio */ }
      if (!response.ok) {
        const code = data.code || data.detail || `http_${response.status}`;
        // Repetimos apenas falhas transitórias de leitura.
        if (method === "GET" && response.status >= 500 && attempt < retries) throw new ApiError(code, response.status, data);
        const err = new ApiError(code, response.status, data);
        err.final = true;
        throw err;
      }
      return data;
    } catch (error) {
      if (error.final || method !== "GET" || attempt >= retries) {
        if (error.name === "AbortError") throw new ApiError("timeout", 0);
        if (error instanceof ApiError) throw error;
        throw new ApiError("network_error", 0);
      }
      attempt += 1;
      await new Promise((r) => setTimeout(r, 600 * attempt * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}

export const api = {
  event: () => request("/api/event"),
  photos: ({ offset = 0, limit = 60, category = "" } = {}) => {
    const qs = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (category) qs.set("category", category);
    return request(`/api/photos?${qs}`);
  },
  photo: (id) => request(`/api/photos/${encodeURIComponent(id)}`),
  faceStatus: () => request("/api/faces/status", { retries: 1 }),
  faceSearch: (form) => request("/api/faces/search", { method: "POST", body: form, timeout: 60000, retries: 0 }),
};

export const fmt = new Intl.NumberFormat("pt-BR");

export function toast(message, ms = 3200) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("is-visible"), ms);
}

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Pilha de camadas (lightbox, busca) integrada ao botão Voltar do celular. */
const layers = [];
export const overlays = {
  push(name, onClose) {
    layers.push({ name, onClose });
    history.pushState({ ...(history.state || {}), overlay: name, depth: layers.length }, "");
  },
  /** Fecha a camada pela interface: volta o histórico, o que dispara o popstate. */
  close(name) {
    const top = layers[layers.length - 1];
    if (top && top.name === name) history.back();
  },
  isOpen: (name) => layers.some((l) => l.name === name),
};
window.addEventListener("popstate", (event) => {
  const depth = (event.state && event.state.depth) || 0;
  while (layers.length > depth) {
    const layer = layers.pop();
    layer.onClose();
  }
});
