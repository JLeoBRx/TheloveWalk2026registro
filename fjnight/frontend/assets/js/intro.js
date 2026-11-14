// Abertura cinematográfica: preto → raios dourados → pomba → FJ NIGHT → título → botão.
import { prefersReducedMotion } from "./api.js";

const SEEN_KEY = "fjnight:intro-vista";

function alreadySeen() {
  try { return sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
function markSeen() {
  try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* modo privado */ }
}

export function runIntro({ skip = false } = {}) {
  const intro = document.getElementById("intro");
  return new Promise((resolve) => {
    if (!intro) return resolve();
    const finish = (instant = false) => {
      timers.forEach(clearTimeout);
      markSeen();
      document.body.classList.remove("has-intro", "no-scroll");
      if (instant) {
        intro.remove();
      } else {
        intro.classList.add("is-leaving");
        setTimeout(() => intro.remove(), 950);
      }
      resolve();
    };
    const timers = [];
    if (skip || alreadySeen()) return finish(true);

    document.body.classList.add("no-scroll");
    const stages = prefersReducedMotion()
      ? [["s1", 0], ["s2", 0], ["s3", 0], ["s4", 0], ["s5", 0]]
      : [["s1", 150], ["s2", 700], ["s3", 1300], ["s4", 1850], ["s5", 2750]];
    for (const [cls, delay] of stages) {
      timers.push(setTimeout(() => intro.classList.add(cls), delay));
    }
    const enter = document.getElementById("introEnter");
    timers.push(setTimeout(() => enter.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 2900));
    enter.addEventListener("click", () => finish(false), { once: true });
    document.getElementById("introSkip").addEventListener("click", () => finish(false), { once: true });
    intro.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(false);
    });
  });
}
