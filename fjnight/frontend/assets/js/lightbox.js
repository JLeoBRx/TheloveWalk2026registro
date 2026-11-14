// Visualização ampliada: fundo escuro, navegação, gestos de toque, zoom e download.
import { fmt, overlays, toast } from "./api.js";

const ZOOM = 2.4;

export class Lightbox {
  constructor() {
    this.el = document.getElementById("lightbox");
    this.frame = document.getElementById("lbFrame");
    this.img = document.getElementById("lbImg");
    this.thumb = document.getElementById("lbThumb");
    this.stage = document.getElementById("lbStage");
    this.countEl = document.getElementById("lbCount");
    this.catEl = document.getElementById("lbCat");
    this.download = document.getElementById("lbDownload");
    this.prevBtn = document.getElementById("lbPrev");
    this.nextBtn = document.getElementById("lbNext");
    this.source = null;
    this.index = 0;
    this.token = 0;
    this.zoomed = false;
    this.pan = { x: 0, y: 0 };
    this.lastFocus = null;

    document.getElementById("lbClose").addEventListener("click", () => this.close());
    document.getElementById("lbShare").addEventListener("click", () => this.share());
    this.prevBtn.addEventListener("click", () => this.go(-1));
    this.nextBtn.addEventListener("click", () => this.go(1));
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.bindGestures();
  }

  get isOpen() { return !this.el.hidden; }

  open(source, index) {
    this.source = source;
    this.index = index;
    if (!this.isOpen) {
      this.lastFocus = document.activeElement;
      this.el.hidden = false;
      document.body.classList.add("no-scroll");
      requestAnimationFrame(() => this.el.classList.add("is-open"));
      overlays.push("lightbox", () => this.hide());
      document.getElementById("lbClose").focus({ preventScroll: true });
    }
    this.render();
  }

  close() {
    if (overlays.isOpen("lightbox")) overlays.close("lightbox");
    else this.hide();
  }

  hide() {
    if (!this.isOpen) return;
    this.token += 1;
    this.el.classList.remove("is-open", "ui-hidden", "is-zoomed", "is-loading");
    this.el.style.removeProperty("--lb-bg");
    setTimeout(() => {
      this.el.hidden = true;
      this.img.removeAttribute("src");
      this.thumb.removeAttribute("src");
      this.frame.style.transform = "";
    }, 260);
    if (!document.getElementById("faceSheet").classList.contains("is-open")) {
      document.body.classList.remove("no-scroll");
    }
    this.lastFocus?.focus?.({ preventScroll: true });
  }

  async go(step) {
    if (!this.source) return;
    const next = this.index + step;
    if (next < 0 || next >= this.source.length) return;
    if (!this.source.item(next) && this.source.ensure) {
      this.el.classList.add("is-loading");
      await this.source.ensure(next);
    }
    if (!this.source.item(next)) return;
    this.index = next;
    this.resetZoom();
    this.frame.classList.remove("is-dragging");
    this.frame.style.transition = "none";
    this.frame.style.transform = `translateX(${step * 36}px)`;
    this.frame.style.opacity = "0";
    this.render();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.frame.style.transition = "";
      this.frame.style.transform = "";
      this.frame.style.opacity = "";
    }));
  }

  render() {
    const item = this.source.item(this.index);
    if (!item) return;
    const total = this.source.length;
    this.countEl.textContent = `${fmt.format(this.index + 1)} / ${fmt.format(total)}`;
    this.catEl.textContent = item.category_label || "A Noite da Herança";
    this.prevBtn.disabled = this.index <= 0;
    this.nextBtn.disabled = this.index >= total - 1;
    if (item.download) {
      this.download.hidden = false;
      this.download.href = item.download;
    } else {
      this.download.hidden = true;
      this.download.removeAttribute("href");
    }
    const token = ++this.token;
    this.frame.classList.remove("has-image");
    this.img.classList.remove("is-loaded");
    this.thumb.src = item.thumb;
    this.thumb.alt = "";
    this.img.alt = `Fotografia ${this.index + 1} de ${total} — FJ Night, A Noite da Herança`;
    this.el.classList.add("is-loading");
    const loader = new Image();
    loader.decoding = "async";
    loader.src = item.display;
    const show = () => {
      if (token !== this.token) return;
      this.img.src = item.display;
      this.img.classList.add("is-loaded");
      this.frame.classList.add("has-image");
      this.el.classList.remove("is-loading");
      this.preload();
    };
    (loader.decode ? loader.decode() : new Promise((ok, ko) => { loader.onload = ok; loader.onerror = ko; }))
      .then(show)
      .catch(() => {
        if (token !== this.token) return;
        this.el.classList.remove("is-loading");
        toast("Não foi possível carregar esta fotografia em alta resolução.");
      });
    if (this.source.ensure && this.index + 4 >= (this.source.items?.length ?? Infinity)) {
      this.source.ensure(this.index + 4).catch(() => {});
    }
  }

  preload() {
    for (const i of [this.index + 1, this.index - 1]) {
      const item = this.source.item(i);
      if (item) { const im = new Image(); im.decoding = "async"; im.src = item.display; }
    }
  }

  async share() {
    const item = this.source?.item(this.index);
    if (!item) return;
    const url = `${location.origin}/#foto=${item.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "FJ Night · A Noite da Herança", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast("Link da fotografia copiado.");
    } catch (error) {
      if (error && error.name === "AbortError") return;
      toast("Não foi possível compartilhar agora.");
    }
  }

  onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); if (this.zoomed) this.resetZoom(); else this.close(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); this.go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); this.go(-1); }
    else if (e.key === "Tab") {
      const focusables = [...this.el.querySelectorAll("button:not([disabled]):not([hidden]), a[href]:not([hidden])")]
        .filter((n) => n.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  // ---------------- Zoom ----------------
  toggleZoom(clientX, clientY) {
    if (this.zoomed) return this.resetZoom();
    const rect = this.img.getBoundingClientRect();
    if (!rect.width) return;
    this.zoomed = true;
    this.el.classList.add("is-zoomed");
    // Amplia em direção ao ponto tocado.
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    this.pan = { x: (cx - clientX) * (ZOOM - 1), y: (cy - clientY) * (ZOOM - 1) };
    this.clampPan();
    this.applyZoom();
  }
  clampPan() {
    const rect = this.img.getBoundingClientRect();
    const w = (this.zoomed ? rect.width / (this.currentScale || 1) : rect.width) * ZOOM;
    const h = (this.zoomed ? rect.height / (this.currentScale || 1) : rect.height) * ZOOM;
    const maxX = Math.max(0, (w - window.innerWidth) / 2 + 40);
    const maxY = Math.max(0, (h - window.innerHeight) / 2 + 40);
    this.pan.x = Math.max(-maxX, Math.min(maxX, this.pan.x));
    this.pan.y = Math.max(-maxY, Math.min(maxY, this.pan.y));
  }
  applyZoom() {
    this.currentScale = this.zoomed ? ZOOM : 1;
    this.img.style.transform = this.zoomed ? `translate(${this.pan.x}px, ${this.pan.y}px) scale(${ZOOM})` : "";
  }
  resetZoom() {
    this.zoomed = false;
    this.pan = { x: 0, y: 0 };
    this.el.classList.remove("is-zoomed");
    this.applyZoom();
  }

  // ---------------- Gestos ----------------
  bindGestures() {
    let start = null, axis = null, lastTap = 0, moved = false, panStart = null;
    const stage = this.stage;

    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button,a")) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
      axis = null; moved = false;
      panStart = { ...this.pan };
      stage.setPointerCapture?.(e.pointerId);
    });
    stage.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) > 8) moved = true;
      if (this.zoomed) {
        this.img.style.transition = "none";
        this.pan = { x: panStart.x + dx, y: panStart.y + dy };
        this.clampPan();
        this.applyZoom();
        return;
      }
      if (!axis && moved) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis === "x") {
        const atEdge = (dx > 0 && this.index === 0) || (dx < 0 && this.index >= this.source.length - 1);
        this.frame.classList.add("is-dragging");
        this.frame.style.transform = `translateX(${atEdge ? dx * 0.3 : dx}px)`;
      } else if (axis === "y" && dy > 0) {
        this.frame.classList.add("is-dragging");
        this.frame.style.transform = `translateY(${dy}px) scale(${Math.max(0.85, 1 - dy / 1600)})`;
        this.el.style.setProperty("--lb-bg", String(Math.max(0.25, 1 - dy / 420)));
      }
    });
    const end = (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      const dt = Math.max(1, performance.now() - start.t);
      this.img.style.transition = "";
      this.frame.classList.remove("is-dragging");
      const wasAxis = axis;
      start = null; axis = null;
      if (this.zoomed) {
        if (!moved) this.handleTap(e, lastTap, (t) => { lastTap = t; });
        return;
      }
      if (wasAxis === "x" && (Math.abs(dx) > 70 || Math.abs(dx) / dt > 0.55)) {
        this.frame.style.transform = "";
        this.go(dx < 0 ? 1 : -1);
        return;
      }
      if (wasAxis === "y" && (dy > 120 || dy / dt > 0.7)) {
        this.close();
        return;
      }
      this.frame.style.transform = "";
      this.el.style.removeProperty("--lb-bg");
      if (!moved) this.handleTap(e, lastTap, (t) => { lastTap = t; });
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("dblclick", (e) => {
      if (e.pointerType === "touch") return;
      e.preventDefault();
      this.toggleZoom(e.clientX, e.clientY);
    });
  }

  handleTap(e, lastTap, setLast) {
    const now = performance.now();
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      if (now - lastTap < 300) {
        clearTimeout(this.tapTimer);
        setLast(0);
        this.toggleZoom(e.clientX, e.clientY);
        return;
      }
      setLast(now);
      this.tapTimer = setTimeout(() => {
        if (!this.zoomed) this.el.classList.toggle("ui-hidden");
      }, 300);
    } else if (e.target === this.stage || e.target === this.frame) {
      this.close();  // clique fora da foto, no computador
    }
  }
}
