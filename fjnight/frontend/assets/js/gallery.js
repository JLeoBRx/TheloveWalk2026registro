// Galeria em mosaico justificado com carregamento progressivo (páginas de 60).
import { api, fmt } from "./api.js";

const PAGE_SIZE = 60;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function ratioOf(item) {
  const r = Number(item.w) / Number(item.h);
  return Number.isFinite(r) && r > 0 ? clamp(r, 0.6, 2.2) : 1.5;
}

export function makeTile(item, index, { eager = false, label } = {}) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "tile tile--enter";
  tile.dataset.index = String(index);
  tile.style.setProperty("--r", ratioOf(item).toFixed(4));
  if (/^#[0-9a-f]{6}$/i.test(item.color || "")) tile.style.setProperty("--c", item.color);
  tile.setAttribute("aria-label", label || `Abrir fotografia ${index + 1}${item.category_label ? ` — ${item.category_label}` : ""}`);
  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.loading = eager ? "eager" : "lazy";
  if (eager) img.fetchPriority = "high";
  img.draggable = false;
  img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
  img.addEventListener("error", () => { tile.classList.add("is-broken"); }, { once: true });
  img.src = item.thumb;
  tile.append(img);
  return tile;
}

export class Gallery {
  constructor({ onOpen, onVersion }) {
    this.mosaic = document.getElementById("mosaic");
    this.sentinel = document.getElementById("sentinel");
    this.loadMoreBtn = document.getElementById("loadMore");
    this.status = document.getElementById("albumStatus");
    this.filters = document.getElementById("filters");
    this.count = document.getElementById("albumCount");
    this.countLabel = document.getElementById("albumCountLabel");
    this.onOpen = onOpen;
    this.onVersion = onVersion;
    this.items = [];
    this.ids = new Set();
    this.total = 0;
    this.category = "";
    this.version = null;
    this.loading = null;
    this.done = false;
    this.failed = false;
    this.request = 0;

    this.mosaic.addEventListener("click", (e) => {
      const tile = e.target.closest(".tile");
      if (tile) this.onOpen(Number(tile.dataset.index));
    });
    this.loadMoreBtn.addEventListener("click", () => this.loadNext());
    this.filters.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-category]");
      if (chip && chip.dataset.category !== this.category) this.reset(chip.dataset.category);
    });
    if ("IntersectionObserver" in window) {
      this.observer = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) this.loadNext();
      }, { rootMargin: "1400px 0px" });
      this.observer.observe(this.sentinel);
    }
  }

  // ---- fonte de dados para a visualização ampliada ----
  get length() { return this.total; }
  item(i) { return this.items[i]; }
  async ensure(i) {
    while (i >= this.items.length && !this.done && !this.failed) {
      await this.loadNext();
    }
    return this.items[i];
  }

  setCategories(categories, total) {
    this.filters.replaceChildren();
    const list = (categories || []).filter((c) => c.id);
    if (list.length < 2) { this.filters.hidden = true; return; }
    const chips = [{ id: "", label: "Todas", count: total }, ...list];
    for (const c of chips) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.category = c.id;
      chip.setAttribute("aria-pressed", String(c.id === this.category));
      chip.append(document.createTextNode(c.label));
      const small = document.createElement("small");
      small.textContent = fmt.format(c.count);
      chip.append(small);
      this.filters.append(chip);
    }
    this.filters.hidden = false;
  }

  skeletons(n = 14) {
    const frag = document.createDocumentFragment();
    const ratios = [1.5, 0.75, 1.33, 0.67, 1.5, 1.5, 0.75, 1.78, 0.67, 1.33, 1.5, 0.75, 1.5, 1.33];
    for (let i = 0; i < n; i++) {
      const s = document.createElement("div");
      s.className = "tile__skeleton";
      s.style.setProperty("--r", String(ratios[i % ratios.length]));
      frag.append(s);
    }
    this.mosaic.replaceChildren(frag);
  }

  async reset(category = this.category) {
    this.category = category;
    this.items = [];
    this.ids.clear();
    this.total = 0;
    this.done = false;
    this.failed = false;
    this.loading = null;
    this.request += 1;
    this.filters.querySelectorAll("[data-category]").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.category === category));
    });
    this.skeletons();
    this.setStatus("Carregando as fotografias…");
    await this.loadNext(true);
  }

  loadNext(first = false) {
    if (this.loading) return this.loading;
    if (this.done) return Promise.resolve();
    const req = this.request;
    const offset = this.items.length;
    this.loadMoreBtn.disabled = true;
    this.loading = (async () => {
      try {
        const data = await api.photos({ offset, limit: PAGE_SIZE, category: this.category });
        if (req !== this.request) return;
        if (first) this.mosaic.replaceChildren();
        this.failed = false;
        this.total = data.total;
        if (this.version && data.version !== this.version) this.onVersion?.(data.version);
        if (!this.version || first) this.version = data.version;
        const frag = document.createDocumentFragment();
        for (const item of data.items) {
          if (this.ids.has(item.id)) continue;
          this.ids.add(item.id);
          const index = this.items.length;
          this.items.push(item);
          frag.append(makeTile(item, index, { eager: index < 6 }));
        }
        this.mosaic.append(frag);
        this.done = data.next_offset == null || data.items.length === 0;
        if (first) this.updateCount();
        if (this.total === 0) this.renderEmpty();
        this.updateStatus();
      } catch (error) {
        if (req !== this.request) return;
        this.failed = true;
        if (first) this.mosaic.replaceChildren();
        this.setStatus(error.code === "network_error" || error.code === "timeout"
          ? "Sem conexão com o álbum. Verifique sua internet e tente novamente."
          : "Não foi possível carregar as fotografias agora.");
        this.loadMoreBtn.hidden = false;
        this.loadMoreBtn.disabled = false;
        this.loadMoreBtn.textContent = "Tentar novamente";
      } finally {
        if (req === this.request) this.loading = null;
      }
    })();
    return this.loading;
  }

  updateCount() {
    this.count.textContent = fmt.format(this.total);
    this.countLabel.textContent = this.total === 1 ? "fotografia" : "fotografias";
  }

  setStatus(text) { this.status.textContent = text; }

  updateStatus() {
    const shown = this.items.length;
    if (this.total === 0) { this.setStatus(""); this.loadMoreBtn.hidden = true; return; }
    if (this.done) {
      this.setStatus(`Você viu todas as ${fmt.format(shown)} fotografias${this.category ? " deste momento" : ""}.`);
      this.loadMoreBtn.hidden = true;
    } else {
      this.setStatus(`Exibindo ${fmt.format(shown)} de ${fmt.format(this.total)} fotografias`);
      // Sem IntersectionObserver, o botão garante a navegação.
      this.loadMoreBtn.hidden = Boolean(this.observer);
      this.loadMoreBtn.disabled = false;
      this.loadMoreBtn.textContent = "Carregar mais fotografias";
    }
  }

  renderEmpty(indexing = false) {
    const box = document.createElement("div");
    box.className = "empty";
    box.innerHTML = `<svg viewBox="0 0 240 200" aria-hidden="true"><use href="#i-dove"/></svg>
      <h3></h3><p></p>`;
    box.querySelector("h3").textContent = indexing ? "Revelando as fotografias…" : "As memórias estão a caminho";
    box.querySelector("p").textContent = indexing
      ? "As fotografias da noite estão sendo preparadas. Em instantes elas aparecerão aqui."
      : "As fotografias da FJU Night serão publicadas aqui assim que forem selecionadas. Volte em breve para reviver a Noite da Herança.";
    this.mosaic.replaceChildren(box);
  }
}
