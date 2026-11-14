// Trilha da noite: player do YouTube controlado por postMessage (sem script externo).
// O vídeo fica sempre visível enquanto toca (regra do YouTube); fechar o player para a música.
import { toast } from "./api.js";

const ORIGIN = "https://www.youtube-nocookie.com";
const ERRORS = {
  2: "Endereço do vídeo inválido.",
  5: "Este vídeo não pode ser reproduzido neste navegador.",
  100: "Vídeo removido ou privado.",
  101: "O titular não permite tocar este vídeo fora do YouTube.",
  150: "O titular não permite tocar este vídeo fora do YouTube.",
  153: "O YouTube recusou a reprodução incorporada.",
};

export class Music {
  constructor() {
    this.el = document.getElementById("music");
    this.launch = document.getElementById("musicLaunch");
    this.video = document.getElementById("musicVideo");
    this.title = document.getElementById("musicTitle");
    this.status = document.getElementById("musicStatus");
    this.toggle = document.getElementById("musicToggle");
    this.list = document.getElementById("musicList");
    this.tracks = [];
    this.index = 0;
    this.playing = false;
    this.frame = null;
    this.failures = 0;
    this.watchdog = 0;

    this.launch.addEventListener("click", () => (this.el.hidden ? this.open(this.index) : this.close()));
    document.getElementById("musicClose").addEventListener("click", () => this.close());
    document.getElementById("musicPrev").addEventListener("click", () => this.step(-1));
    document.getElementById("musicNext").addEventListener("click", () => this.step(1));
    this.toggle.addEventListener("click", () => this.command(this.playing ? "pauseVideo" : "playVideo"));
    this.list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-track]");
      if (b) this.load(Number(b.dataset.track));
    });
    window.addEventListener("message", (e) => this.onMessage(e));
  }

  setTracks(tracks) {
    this.tracks = Array.isArray(tracks) ? tracks.filter((t) => /^[A-Za-z0-9_-]{11}$/.test(t.youtube_id)) : [];
    this.launch.hidden = this.tracks.length === 0;
    this.list.replaceChildren(...this.tracks.map((t, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.track = String(i);
      const n = document.createElement("small");
      n.textContent = String(i + 1).padStart(2, "0");
      const label = document.createElement("span");
      label.textContent = t.artist ? `${t.title} — ${t.artist}` : t.title;
      b.append(n, label);
      li.append(b);
      return li;
    }));
  }

  open(index = 0) {
    if (!this.tracks.length) return;
    this.el.hidden = false;
    this.launch.setAttribute("aria-expanded", "true");
    this.load(index);
  }

  close() {
    this.command("pauseVideo");
    clearTimeout(this.watchdog);
    this.frame?.remove();
    this.frame = null;
    this.playing = false;
    this.el.hidden = true;
    this.launch.setAttribute("aria-expanded", "false");
  }

  step(delta) {
    if (!this.tracks.length) return;
    this.load((this.index + delta + this.tracks.length) % this.tracks.length);
  }

  load(index) {
    const track = this.tracks[index];
    if (!track) return;
    this.index = index;
    this.playing = false;
    this.title.textContent = track.artist ? `${track.title} — ${track.artist}` : track.title;
    this.setStatus("Carregando…");
    this.list.querySelectorAll("[data-track]").forEach((b) =>
      b.setAttribute("aria-current", String(Number(b.dataset.track) === index)));
    const params = new URLSearchParams({
      enablejsapi: "1", playsinline: "1", rel: "0", autoplay: "1", origin: location.origin,
    });
    const frame = document.createElement("iframe");
    frame.src = `${ORIGIN}/embed/${track.youtube_id}?${params}`;
    frame.title = `${track.title} — vídeo do YouTube`;
    frame.allow = "autoplay; encrypted-media; picture-in-picture";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allowFullscreen = true;
    frame.addEventListener("load", () => {
      // Pede ao player que envie eventos de estado e de erro.
      this.post({ event: "listening", id: "fjunight", channel: "widget" });
      this.post({ event: "command", func: "addEventListener", args: ["onStateChange"] });
      this.post({ event: "command", func: "addEventListener", args: ["onError"] });
    });
    this.frame?.remove();
    this.frame = frame;
    this.video.replaceChildren(frame);
    clearTimeout(this.watchdog);
    // Celulares podem bloquear o início automático: orienta o toque no vídeo.
    this.watchdog = setTimeout(() => {
      if (!this.playing) this.setStatus("Toque em ▶ no vídeo para começar.");
    }, 4500);
    this.renderToggle();
  }

  post(message) {
    this.frame?.contentWindow?.postMessage(JSON.stringify(message), ORIGIN);
  }

  command(func) {
    if (this.frame) this.post({ event: "command", func, args: [] });
  }

  onMessage(e) {
    if (e.origin !== ORIGIN || !this.frame || e.source !== this.frame.contentWindow) return;
    let data;
    try { data = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!data || typeof data !== "object") return;
    let state = null;
    if (data.event === "onStateChange") state = Number(data.info);
    if (data.event === "infoDelivery" && data.info && typeof data.info.playerState === "number") state = data.info.playerState;
    if (state !== null) this.onState(state);
    if (data.event === "onError") this.onError(Number(data.info));
  }

  onState(state) {
    // -1 não iniciado, 0 terminou, 1 tocando, 2 pausado, 3 carregando, 5 pronto
    if (state === 1) { this.playing = true; this.failures = 0; this.setStatus(`Faixa ${this.index + 1} de ${this.tracks.length}`); }
    else if (state === 2) { this.playing = false; this.setStatus("Pausado"); }
    else if (state === 0) { this.playing = false; this.step(1); return; }
    this.renderToggle();
  }

  onError(code) {
    const message = ERRORS[code] || "Não foi possível tocar este vídeo.";
    this.failures += 1;
    this.playing = false;
    this.renderToggle();
    if (this.failures >= this.tracks.length) {
      this.setStatus(`${message} Nenhuma faixa pôde ser reproduzida agora.`);
      return;
    }
    toast(`${message} Pulando para a próxima faixa.`);
    setTimeout(() => this.step(1), 1200);
  }

  setStatus(text) { this.status.textContent = text; }

  renderToggle() {
    this.toggle.setAttribute("aria-label", this.playing ? "Pausar" : "Tocar");
    this.toggle.querySelector("use").setAttribute("href", this.playing ? "#i-pause" : "#i-play");
  }
}
