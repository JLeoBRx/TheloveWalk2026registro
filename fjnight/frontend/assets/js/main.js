// FJ Night — A Noite da Herança · orquestração da página.
import { api, fmt } from "./api.js";
import { runIntro } from "./intro.js";
import { startDust } from "./particles.js";
import { Gallery } from "./gallery.js";
import { Lightbox } from "./lightbox.js";
import { FaceSearch } from "./facesearch.js";

const deepLink = (location.hash.match(/^#foto=([a-f0-9]{20})$/i) || [])[1];
let knownVersion = null;

const lightbox = new Lightbox();
const gallery = new Gallery({
  onOpen: (index) => lightbox.open(gallery, index),
  onVersion: () => showUpdateNotice(),
});
new FaceSearch({ lightbox });

// A abertura roda em paralelo: os dados e as primeiras miniaturas já carregam por trás.
const introDone = runIntro({ skip: Boolean(deepLink) });
const firstPage = gallery.reset("");
loadEvent();
introDone.then(() => startDust(document.getElementById("dust")));

// Cabeçalho sólido após o herói
const topbar = document.getElementById("topbar");
const onScroll = () => topbar.classList.toggle("is-solid", window.scrollY > 40);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

document.getElementById("albumRefresh").addEventListener("click", async () => {
  document.getElementById("albumNotice").hidden = true;
  await loadEvent();
  await gallery.reset(gallery.category);
});

if (deepLink) openDeepLink(deepLink);

// Verifica periodicamente se novas fotografias foram publicadas (sem recarregar a página).
setInterval(() => { if (!document.hidden) loadEvent({ quiet: true }); }, 120000);

async function loadEvent({ quiet = false } = {}) {
  try {
    const data = await api.event();
    applyEvent(data.event || {});
    document.getElementById("factCount").textContent = data.photos_total ? fmt.format(data.photos_total) : "—";
    applyFaceStatus(data.face_search || {});
    if (knownVersion && data.catalog_version !== knownVersion && quiet) showUpdateNotice();
    knownVersion = data.catalog_version;
    if (!quiet) {
      await firstPage;
      gallery.setCategories(data.categories, data.photos_total);
      if (data.photos_total === 0 && gallery.total === 0) gallery.renderEmpty(Boolean(data.indexing));
    }
  } catch {
    /* Informações estáticas da página continuam visíveis. */
  }
}

function applyEvent(event) {
  document.querySelectorAll("[data-event]").forEach((node) => {
    const value = event[node.dataset.event];
    if (typeof value === "string" && value.trim()) node.textContent = value;
  });
  const map = document.getElementById("mapLink");
  if (event.map_url && /^https:\/\//.test(event.map_url)) {
    map.href = event.map_url;
    map.hidden = false;
  }
}

function applyFaceStatus(face) {
  if (face.expires_at) {
    const date = new Date(`${face.expires_at}T12:00:00`);
    document.getElementById("faceExpiry").textContent = date.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  }
  const note = document.getElementById("faceUnavailable");
  const messages = {
    expired: "O prazo da busca por reconhecimento facial terminou e os dados faciais foram apagados. O álbum completo continua disponível.",
    disabled: "A busca por reconhecimento facial está desativada no momento. O álbum completo continua disponível.",
    models_unavailable: "A busca por reconhecimento facial está em preparação. Tente novamente mais tarde.",
  };
  if (face.available === false && messages[face.reason]) {
    note.textContent = messages[face.reason];
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

function showUpdateNotice() {
  document.getElementById("albumNotice").hidden = false;
}

async function openDeepLink(id) {
  history.replaceState(null, "", location.pathname);
  try {
    const photo = await api.photo(id);
    const list = [photo];
    lightbox.open({ items: list, get length() { return 1; }, item: (i) => list[i] }, 0);
  } catch {
    /* foto removida ou oculta: segue para o álbum */
  }
}
