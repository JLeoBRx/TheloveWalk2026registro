// Poeira dourada leve no céu do herói. Pausa fora da tela, em segundo plano
// e quando o visitante prefere menos movimento.
import { prefersReducedMotion } from "./api.js";

export function startDust(canvas) {
  if (!canvas || prefersReducedMotion()) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const small = window.matchMedia("(max-width: 640px)").matches;
  const count = small ? 26 : 56;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let w = 0, h = 0, raf = 0, visible = true, last = 0;
  const parts = [];

  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = rect.width; h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function spawn(p, initial) {
    p.x = w * (0.15 + Math.random() * 0.7) + (Math.random() - 0.5) * w * 0.3;
    p.y = initial ? Math.random() * h : h * (0.55 + Math.random() * 0.45);
    p.r = 0.6 + Math.random() * 1.9;
    p.vy = 6 + Math.random() * 16;
    p.vx = (Math.random() - 0.5) * 6;
    p.life = 0;
    p.max = 5 + Math.random() * 7;
    p.tw = Math.random() * Math.PI * 2;
  }
  resize();
  for (let i = 0; i < count; i++) { const p = {}; spawn(p, true); parts.push(p); }

  function frame(t) {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (const p of parts) {
      p.life += dt; p.y -= p.vy * dt; p.x += p.vx * dt; p.tw += dt * 2.2;
      if (p.life > p.max || p.y < -10) spawn(p, false);
      const fade = Math.min(1, p.life / 1.2) * Math.min(1, (p.max - p.life) / 1.5);
      const a = Math.max(0, fade) * (0.45 + 0.35 * Math.sin(p.tw));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      g.addColorStop(0, `rgba(255,230,170,${a})`);
      g.addColorStop(1, "rgba(255,170,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } };
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  let rt = 0;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(resize, 150); }, { passive: true });
  kick();
}
