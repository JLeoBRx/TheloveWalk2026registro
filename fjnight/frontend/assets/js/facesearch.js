// Busca por reconhecimento facial: consentimento → selfie/arquivo → resultados.
// A imagem é reduzida no próprio aparelho antes do envio, existe só na memória
// desta página e é descartada ao fechar o painel ou iniciar nova busca.
import { api, fmt, overlays, toast } from "./api.js";
import { makeTile } from "./gallery.js";

const MAX_SIDE = 1600;

const ERRORS = {
  no_face_detected: ["Não encontramos um rosto", "Use uma foto em que seu rosto apareça de frente, bem iluminado e sem óculos escuros, boné ou máscara."],
  face_too_small: ["Rosto muito pequeno", "Aproxime a câmera do rosto ou envie uma foto em que ele ocupe uma parte maior da imagem."],
  invalid_image: ["Imagem não reconhecida", "Envie uma foto em JPG, PNG ou WebP."],
  file_too_large: ["Arquivo muito grande", "Envie uma foto menor (até 12 MB)."],
  too_many_searches: ["Muitas buscas seguidas", "Por segurança, limitamos o número de buscas. Aguarde alguns minutos e tente novamente."],
  consent_required: ["Autorização necessária", "Confirme as duas autorizações para continuar."],
  face_search_expired: ["Busca encerrada", "O prazo de uso dos dados faciais terminou e eles foram apagados. Você ainda pode navegar pelo álbum completo."],
  face_search_disabled: ["Busca indisponível", "A busca por reconhecimento facial está desativada no momento. Navegue pelo álbum completo."],
  face_search_models_unavailable: ["Busca em preparação", "O reconhecimento facial ainda está sendo configurado. Tente novamente mais tarde."],
  network_error: ["Sem conexão", "Verifique sua internet e tente novamente."],
  timeout: ["A busca demorou demais", "A conexão está lenta. Tente novamente."],
};

export class FaceSearch {
  constructor({ lightbox }) {
    this.lightbox = lightbox;
    this.sheet = document.getElementById("faceSheet");
    this.panel = document.getElementById("facePanel");
    this.video = document.getElementById("cameraVideo");
    this.camera = document.getElementById("camera");
    this.choices = document.getElementById("captureChoices");
    this.errorEl = document.getElementById("captureError");
    this.status = null;
    this.blob = null;
    this.blobUrl = null;
    this.stream = null;
    this.facing = "user";
    this.highList = [];
    this.maybeList = [];
    this.lastFocus = null;

    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-open-face]")) { e.preventDefault(); this.open(); }
      else if (e.target.closest("[data-close-face]")) { e.preventDefault(); this.close(); }
    });
    const self = document.getElementById("consentSelf");
    const bio = document.getElementById("consentBio");
    const cont = document.getElementById("consentContinue");
    const sync = () => { cont.disabled = !(self.checked && bio.checked); };
    self.addEventListener("change", sync);
    bio.addEventListener("change", sync);
    cont.addEventListener("click", () => { if (!cont.disabled) this.show("capture"); });
    document.getElementById("useCamera").addEventListener("click", () => this.startCamera());
    document.getElementById("cameraCancel").addEventListener("click", () => this.stopCamera(true));
    document.getElementById("cameraFlip").addEventListener("click", () => {
      this.facing = this.facing === "user" ? "environment" : "user";
      this.startCamera();
    });
    document.getElementById("cameraShot").addEventListener("click", () => this.capture());
    document.getElementById("fileInput").addEventListener("change", (e) => this.fromFile(e.target));
    document.getElementById("searchAgain").addEventListener("click", () => { this.clear(); this.show("capture"); });
    document.getElementById("errorRetry").addEventListener("click", () => { this.clear(); this.show(this.consented() ? "capture" : "consent"); });
    document.getElementById("chooseStage").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-face]");
      if (btn) this.submit(Number(btn.dataset.face));
    });
    const openResult = (list) => (e) => {
      const tile = e.target.closest(".tile");
      if (!tile) return;
      const source = { items: list, get length() { return list.length; }, item: (i) => list[i] };
      this.lightbox.open(source, Number(tile.dataset.index));
    };
    this.resultsHigh = document.getElementById("resultsHigh");
    this.resultsMaybe = document.getElementById("resultsMaybe");
    this.resultsHigh.addEventListener("click", (e) => openResult(this.highList)(e));
    this.resultsMaybe.addEventListener("click", (e) => openResult(this.maybeList)(e));
    this.sheet.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.lightbox.isOpen) this.close();
    });
  }

  consented() {
    return document.getElementById("consentSelf").checked && document.getElementById("consentBio").checked;
  }

  async open() {
    if (this.sheet.classList.contains("is-open")) return;
    this.lastFocus = document.activeElement;
    this.sheet.hidden = false;
    document.body.classList.add("no-scroll");
    requestAnimationFrame(() => this.sheet.classList.add("is-open"));
    overlays.push("face", () => this.hide());
    if (!this.status) {
      try { this.status = await api.faceStatus(); } catch { this.status = null; }
    }
    if (this.status && !this.status.available) {
      return this.fail(`face_search_${this.status.reason}`);
    }
    this.show(this.consented() ? "capture" : "consent");
  }

  close() {
    if (overlays.isOpen("face")) overlays.close("face");
    else this.hide();
  }

  hide() {
    this.stopCamera();
    this.clear();
    this.sheet.classList.remove("is-open");
    setTimeout(() => { this.sheet.hidden = true; }, 300);
    document.body.classList.remove("no-scroll");
    this.lastFocus?.focus?.({ preventScroll: true });
  }

  show(step) {
    for (const s of this.panel.querySelectorAll(".step")) s.hidden = s.dataset.step !== step;
    this.panel.scrollTop = 0;
    const heading = this.panel.querySelector(`[data-step="${step}"] .step__title`);
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
    if (step === "capture") {
      this.errorEl.textContent = "";
      this.camera.hidden = true;
      this.choices.hidden = false;
    }
  }

  /** Remove da memória a imagem e os resultados desta busca. */
  clear() {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blob = null;
    this.blobUrl = null;
    this.highList = [];
    this.maybeList = [];
    this.resultsHigh.replaceChildren();
    this.resultsMaybe.replaceChildren();
    document.getElementById("scanPreview").removeAttribute("src");
    document.getElementById("chooseImg").removeAttribute("src");
    document.querySelectorAll(".choose__face").forEach((n) => n.remove());
    document.getElementById("fileInput").value = "";
  }

  // ---------------- Captura ----------------
  async startCamera() {
    this.errorEl.textContent = "";
    if (!navigator.mediaDevices?.getUserMedia) {
      this.errorEl.textContent = "Seu navegador não permite usar a câmera aqui. Escolha “Enviar uma foto”.";
      return;
    }
    this.stopCamera();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: this.facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
      });
      this.video.srcObject = this.stream;
      this.camera.classList.toggle("is-rear", this.facing !== "user");
      this.camera.hidden = false;
      this.choices.hidden = true;
      await this.video.play().catch(() => {});
    } catch (error) {
      this.stopCamera(true);
      this.errorEl.textContent = error && error.name === "NotAllowedError"
        ? "Permissão de câmera negada. Libere o acesso nas configurações do navegador ou escolha “Enviar uma foto”."
        : "Não foi possível abrir a câmera. Escolha “Enviar uma foto”.";
    }
  }

  stopCamera(showChoices = false) {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    if (showChoices) { this.camera.hidden = true; this.choices.hidden = false; }
  }

  async capture() {
    const v = this.video;
    if (!v.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
    this.stopCamera();
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    canvas.width = canvas.height = 0;
    if (blob) this.useBlob(blob);
  }

  async fromFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    this.errorEl.textContent = "";
    if (!/^image\//.test(file.type)) { this.errorEl.textContent = "Escolha um arquivo de imagem."; return; }
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error("blob");
      this.useBlob(blob);
    } catch {
      this.errorEl.textContent = "Não foi possível abrir esta imagem. Tente uma foto em JPG ou PNG.";
    } finally {
      input.value = "";
    }
  }

  useBlob(blob) {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blob = blob;
    this.blobUrl = URL.createObjectURL(blob);
    this.submit(null);
  }

  // ---------------- Envio ----------------
  async submit(faceIndex) {
    if (!this.blob) return;
    document.getElementById("scanPreview").src = this.blobUrl;
    this.show("processing");
    const form = new FormData();
    form.append("image", this.blob, "selfie.jpg");
    form.append("consent", "true");
    form.append("consent_version", this.status?.consent_version || "");
    if (faceIndex != null) form.append("face", String(faceIndex));
    try {
      const data = await api.faceSearch(form);
      if (data.status === "choose_face") return this.chooseFace(data.faces);
      this.renderResults(data.items || []);
    } catch (error) {
      this.fail(error.code || "face_search_failed");
    }
  }

  chooseFace(faces) {
    const stage = document.getElementById("chooseStage");
    const img = document.getElementById("chooseImg");
    stage.querySelectorAll(".choose__face").forEach((n) => n.remove());
    img.src = this.blobUrl;
    faces.forEach((f, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "choose__face";
      b.dataset.face = String(f.index);
      b.style.left = `${f.x * 100}%`;
      b.style.top = `${f.y * 100}%`;
      b.style.width = `${f.w * 100}%`;
      b.style.height = `${f.h * 100}%`;
      b.setAttribute("aria-label", `Sou eu — rosto ${i + 1}`);
      const tag = document.createElement("span");
      tag.textContent = "Sou eu";
      b.append(tag);
      stage.append(b);
    });
    this.show("choose");
  }

  renderResults(items) {
    this.highList = items.filter((i) => i.match === "alta");
    this.maybeList = items.filter((i) => i.match !== "alta");
    const title = document.getElementById("resultsTitle");
    const lead = document.getElementById("resultsLead");
    this.resultsHigh.replaceChildren(...this.highList.map((it, i) => makeTile(it, i, { label: `Abrir fotografia ${i + 1} em que você aparece` })));
    this.resultsMaybe.replaceChildren(...this.maybeList.map((it, i) => makeTile(it, i, { label: `Abrir possível correspondência ${i + 1}` })));
    document.getElementById("resultsMaybeTitle").hidden = this.maybeList.length === 0 || this.highList.length === 0;
    if (!items.length) {
      title.textContent = "Nenhuma foto encontrada";
      lead.textContent = "Não encontramos você nas fotos publicadas até agora. Tente outra selfie, de frente e com boa luz — ou navegue pelo álbum completo. Novas fotos podem ser publicadas.";
    } else {
      title.textContent = `${fmt.format(items.length)} ${items.length === 1 ? "fotografia encontrada" : "fotografias encontradas"}`;
      lead.textContent = this.maybeList.length && this.highList.length
        ? "Toque em uma foto para ver em tamanho grande e baixar. As “possíveis correspondências” têm semelhança menor — confira se é você."
        : this.highList.length
          ? "Toque em uma foto para ver em tamanho grande e baixar."
          : "Encontramos fotos com semelhança moderada. Confira se é você.";
    }
    this.show("results");
    if (items.length) toast("Seus resultados ficam só nesta tela e são apagados ao fechar.");
  }

  fail(code) {
    const [title, text] = ERRORS[code] || ["Algo não saiu como esperado", "Não foi possível concluir a busca agora. Tente novamente em instantes."];
    document.getElementById("errorTitle").textContent = title;
    document.getElementById("errorText").textContent = text;
    const retry = document.getElementById("errorRetry");
    retry.hidden = /expired|disabled/.test(code);
    this.show("error");
  }
}
