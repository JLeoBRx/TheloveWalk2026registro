/*
 * Convite interno (cartão independente).
 * Coordenadas locais em mm: o cartão ocupa (0,0)–(largura, altura); a arte de fundo
 * se estende pela sangria quando solicitada.
 */
(function () {
  "use strict";
  const P = window.P;
  const T = () => P.type;

  const WEEK = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  function dateParts(text) {
    const m = String(text.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let out = null;
    if (m) {
      const y = +m[1], mo = +m[2], d = +m[3];
      const dt = new Date(Date.UTC(y, mo - 1, d));
      out = { weekday: WEEK[dt.getUTCDay()], day: String(d), month: MONTHS[mo - 1], year: String(y) };
    }
    const tm = String(text.time || "").match(/^(\d{1,2}):(\d{2})/);
    const time = tm ? `${+tm[1]}h${tm[2] === "00" ? "" : tm[2]}` : "";
    return { date: out, time };
  }
  P.dateParts = dateParts;

  P.dateLine = function (text) {
    if (String(text.dateText || "").trim()) return String(text.dateText).trim();
    const { date, time } = dateParts(text);
    let s = "";
    if (date) s = `${date.weekday.charAt(0).toUpperCase() + date.weekday.slice(1)}, ${date.day} de ${date.month} de ${date.year}`;
    if (time) s += (s ? " · " : "") + time;
    return s;
  };

  function colors(st) {
    const c = st.colors;
    if (st.card.background === "blue") return { text: "#F3F6FC", accent: c.light, soft: P.color.mix(c.light, "#ffffff", 0.35) };
    return { text: c.cardText, accent: c.cardAccent, soft: P.color.mix(c.cardText, c.pearl, 0.35) };
  }

  /* ---------- moldura ---------- */
  function frame(ctx, cw, ch) {
    const st = ctx.state;
    const style = st.card.frame;
    const m1 = Math.max(5.5, Math.min(cw, ch) * 0.042);
    const g = ctx.gold(0, 0, cw, ch);
    const gl = ctx.goldLine();
    let out = "";
    const rect = (x, y, w, h, sw) =>
      `<rect x="${P.n(x)}" y="${P.n(y)}" width="${P.n(w)}" height="${P.n(h)}" fill="none" stroke="${gl}" stroke-width="${sw}"/>`;
    if (style === "fine") {
      out += rect(m1 + 0.8, m1 + 0.8, cw - 2 * m1 - 1.6, ch - 2 * m1 - 1.6, 0.28);
      return { svg: out, inner: m1 + 0.8 };
    }
    const x0 = m1, y0 = m1, x1 = cw - m1, y1 = ch - m1;
    if (style === "deco") {
      const s = 3.2;
      const d =
        `M${P.n(x0 + s)} ${P.n(y0)}H${P.n(x1 - s)}V${P.n(y0 + s)}H${P.n(x1)}V${P.n(y1 - s)}H${P.n(x1 - s)}V${P.n(y1)}` +
        `H${P.n(x0 + s)}V${P.n(y1 - s)}H${P.n(x0)}V${P.n(y0 + s)}H${P.n(x0 + s)}Z`;
      out += `<path d="${d}" fill="none" stroke="${gl}" stroke-width="0.4"/>`;
      const i = 2.0;
      out += rect(x0 + i, y0 + i, x1 - x0 - 2 * i, y1 - y0 - 2 * i, 0.16);
      const sq = (x, y) => `M${P.n(x - 0.9)} ${P.n(y - 0.9)}h1.8v1.8h-1.8Z`;
      out += `<path d="${[[x0 + s / 2, y0 + s / 2], [x1 - s / 2, y0 + s / 2], [x1 - s / 2, y1 - s / 2], [x0 + s / 2, y1 - s / 2]].map(([x, y]) => sq(x, y)).join("")}" fill="${g}"/>`;
      return { svg: out, inner: m1 + i };
    }
    // clássica: cantos côncavos + losangos
    const r = 4.2;
    const d =
      `M${P.n(x0 + r)} ${P.n(y0)}H${P.n(x1 - r)}A${r} ${r} 0 0 0 ${P.n(x1)} ${P.n(y0 + r)}V${P.n(y1 - r)}` +
      `A${r} ${r} 0 0 0 ${P.n(x1 - r)} ${P.n(y1)}H${P.n(x0 + r)}A${r} ${r} 0 0 0 ${P.n(x0)} ${P.n(y1 - r)}` +
      `V${P.n(y0 + r)}A${r} ${r} 0 0 0 ${P.n(x0 + r)} ${P.n(y0)}Z`;
    out += `<path d="${d}" fill="none" stroke="${gl}" stroke-width="0.4"/>`;
    const i = 1.7;
    out += rect(x0 + i, y0 + i, x1 - x0 - 2 * i, y1 - y0 - 2 * i, 0.16);
    out += `<path d="${[[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => P.envelope.diamond(x, y, 1.5)).join("")}" fill="${g}"/>`;
    return { svg: out, inner: m1 + i };
  }

  /* ---------- blocos de conteúdo ---------- */
  function buildBlocks(ctx, cw, k, maxW) {
    const st = ctx.state, tx = st.text, f = st.fonts, card = st.card;
    const col = colors(st);
    const ts = k * (+card.textScale || 1);
    const tts = k * (+card.titleScale || 1);
    const blocks = [];
    const cx = cw / 2;
    const fill = (c) => (ctx.foil ? null : c);

    const paragraph = (text, sp, color, lh, width, gap, isGold) => {
      const lines = T().wrap(text, sp, width, true);
      const m = T().metrics(sp);
      const step = sp.size * lh;
      const h = m.cap + (lines.length - 1) * step + m.desc * 0.5;
      return {
        gap,
        h,
        draw(y) {
          if (ctx.foil && !isGold) return "";
          let s = "";
          lines.forEach((ln, i) => {
            const r = T().line(ln, cx, y + m.cap + i * step, sp, "middle");
            const paint = isGold ? ctx.gold(cx - width / 2, y, cx + width / 2, y + h) : color;
            s += `<path d="${r.d}" fill="${paint}"/>`;
          });
          return s;
        },
      };
    };

    // monograma
    if (card.showMonogram && String(st.seal.initials || "").trim()) {
      const D = 15 * k;
      blocks.push({
        gap: 0,
        h: D,
        draw(y) {
          const cy = y + D / 2;
          const g = ctx.gold(cx - D / 2, y, cx + D / 2, y + D);
          const gl = ctx.goldLine();
          const mono = P.seal.monogram(st, st.seal.initials, D * 0.56, D * 0.42);
          return (
            `<circle cx="${P.n(cx)}" cy="${P.n(cy)}" r="${P.n(D / 2)}" fill="none" stroke="${gl}" stroke-width="0.3"/>` +
            `<circle cx="${P.n(cx)}" cy="${P.n(cy)}" r="${P.n(D / 2 - 1)}" fill="none" stroke="${gl}" stroke-width="0.12"/>` +
            `<g transform="translate(${P.n(cx)} ${P.n(cy)})"><path d="${mono.d}" fill="${g}"/></g>`
          );
        },
      });
    }

    if (String(tx.eyebrow || "").trim())
      blocks.push(paragraph(tx.eyebrow, { font: f.caps, variant: "regular", size: P.pt(7.4) * ts, tracking: 0.2, upper: true }, col.accent, 1.7, maxW * 0.92, 5.5 * k));

    // título caligráfico (ajusta para caber na largura)
    if (String(tx.title || "").trim()) {
      const lines = String(tx.title).split(/\r?\n/).filter((l) => l.trim());
      const base = { font: f.title, variant: "regular", size: P.pt(40) * tts };
      let size = base.size;
      for (const ln of lines) {
        const w = T().width(ln, Object.assign({}, base, { size }));
        if (w > maxW) size = (size * maxW) / w;
      }
      const sp = Object.assign({}, base, { size });
      const inks = lines.map((ln) => T().ink(ln, sp));
      const step = size * 1.05;
      const top = Math.min(...inks.map((b, i) => b.y1 + i * step));
      const bottom = Math.max(...inks.map((b, i) => b.y2 + i * step));
      const capT = T().metrics(sp).cap;
      const asc = Math.max(-top, capT);
      const h = asc + bottom;
      blocks.push({
        gap: 3.2 * k,
        h,
        draw(y) {
          if (ctx.foil && !card.titleGold) return "";
          const paint = card.titleGold ? ctx.gold(cx - maxW / 2, y, cx + maxW / 2, y + h) : col.text;
          return lines
            .map((ln, i) => `<path d="${T().line(ln, cx, y + asc + i * step, sp, "middle").d}" fill="${paint}"/>`)
            .join("");
        },
      });
    }

    if (String(tx.subtitle || "").trim())
      blocks.push(paragraph(tx.subtitle, { font: f.text, variant: "italic", size: P.pt(12.5) * ts }, col.text, 1.3, maxW * 0.9, 2.6 * k));

    // ornamento
    blocks.push({
      gap: 5 * k,
      h: 3,
      draw(y) {
        return P.envelope.divider(ctx, cx, y + 1.5, Math.min(40, maxW * 0.36));
      },
    });

    if (String(tx.message || "").trim())
      blocks.push(paragraph(tx.message, { font: f.text, variant: "regular", size: P.pt(11.8) * ts }, col.text, 1.36, Math.min(maxW, 104 * k), 5 * k));

    // data
    const dp = dateParts(tx);
    if (card.dateStyle === "block" && dp.date && !String(tx.dateText || "").trim()) {
      const capsSp = { font: f.caps, variant: "regular", size: P.pt(8.4) * ts, tracking: 0.2, upper: true };
      const smallSp = { font: f.caps, variant: "regular", size: P.pt(7.6) * ts, tracking: 0.26, upper: true };
      const daySp = { font: f.text, variant: "medium", size: P.pt(32) * ts };
      const mCaps = T().metrics(capsSp), mSmall = T().metrics(smallSp), mDay = T().metrics(daySp);
      const dayInk = T().ink(dp.date.day, daySp);
      const dayH = -dayInk.y1;
      const h = mSmall.cap + 2.6 * k + dayH + 2.8 * k + mSmall.cap;
      const colW = Math.min(36 * k, maxW * 0.3);
      blocks.push({
        gap: 7 * k,
        h,
        draw(y) {
          const g = ctx.gold(cx - maxW / 2, y, cx + maxW / 2, y + h);
          let s = "";
          const midY = y + h / 2;
          const offX = Math.max(colW / 2 + 12 * k, (dayInk.x2 - dayInk.x1) / 2 + colW / 2 + 6 * k);
          const sideLabel = (txt, x) => {
            let sp = capsSp;
            const w = T().width(txt, sp);
            if (w > colW) sp = Object.assign({}, sp, { size: (sp.size * colW) / w });
            const r = T().line(txt, x, midY + T().metrics(sp).cap / 2, sp, "middle");
            const rule = `M${P.n(x - colW / 2)} ${P.n(midY - 5.2 * k)}H${P.n(x + colW / 2)}M${P.n(x - colW / 2)} ${P.n(midY + 5.2 * k)}H${P.n(x + colW / 2)}`;
            return (ctx.foil ? "" : `<path d="${r.d}" fill="${col.text}"/>`) + `<path d="${rule}" stroke="${ctx.goldLine()}" stroke-width="0.24" fill="none"/>`;
          };
          s += sideLabel(dp.date.weekday, cx - offX);
          if (dp.time) s += sideLabel(dp.time, cx + offX);
          if (!ctx.foil) {
            s += `<path d="${T().line(dp.date.month, cx, y + mSmall.cap, smallSp, "middle").d}" fill="${col.accent}"/>`;
            s += `<path d="${T().line(dp.date.year, cx, y + h, smallSp, "middle").d}" fill="${col.accent}"/>`;
          }
          s += `<path d="${T().line(dp.date.day, cx, y + mSmall.cap + 2.6 * k + dayH, daySp, "middle").d}" fill="${g}"/>`;
          void mCaps; void mDay;
          return s;
        },
      });
    } else {
      const line = P.dateLine(tx);
      if (line)
        blocks.push(paragraph(line, { font: f.caps, variant: "regular", size: P.pt(8.6) * ts, tracking: 0.16, upper: true }, col.text, 1.7, maxW, 7 * k));
    }

    // local
    if (String(tx.venue || "").trim())
      blocks.push(paragraph(tx.venue, { font: f.caps, variant: "semibold", size: P.pt(8.8) * ts, tracking: 0.16, upper: true }, col.text, 1.6, maxW, 7 * k));
    if (String(tx.address || "").trim())
      blocks.push(paragraph(tx.address, { font: f.text, variant: "italic", size: P.pt(10.8) * ts }, col.text, 1.3, maxW, 2.2 * k));

    if (String(tx.info || "").trim())
      blocks.push(paragraph(tx.info, { font: f.caps, variant: "regular", size: P.pt(6.9) * ts, tracking: 0.14, upper: true }, col.accent, 1.85, maxW, 6 * k));

    if (String(tx.signatureLead || "").trim())
      blocks.push(paragraph(tx.signatureLead, { font: f.text, variant: "italic", size: P.pt(10.5) * ts }, col.text, 1.3, maxW, 7 * k));
    if (String(tx.signature || "").trim()) {
      const sp0 = { font: f.signature, variant: "regular", size: P.pt(23) * tts };
      let sp = sp0;
      const w = T().width(tx.signature, sp0);
      if (w > maxW * 0.9) sp = Object.assign({}, sp0, { size: (sp0.size * maxW * 0.9) / w });
      const ink = T().ink(tx.signature, sp);
      const asc = Math.max(-ink.y1, T().metrics(sp).cap);
      const h = asc + Math.max(0, ink.y2);
      blocks.push({
        gap: String(tx.signatureLead || "").trim() ? 1.6 * k : 7 * k,
        h,
        draw(y) {
          if (ctx.foil && !card.signatureGold) return "";
          const paint = card.signatureGold ? ctx.gold(cx - maxW / 2, y, cx + maxW / 2, y + h) : col.text;
          return `<path d="${T().line(tx.signature, cx, y + asc, sp, "middle").d}" fill="${paint}"/>`;
        },
      });
    }
    return blocks;
  }

  function stackHeight(blocks) {
    return blocks.reduce((s, b, i) => s + b.h + (i ? b.gap : 0), 0);
  }

  /*
   * Renderiza o cartão. o = { bleed, guides }
   * Retorna { svg, overflow, scale }
   */
  function render(ctx, o) {
    const st = ctx.state;
    const cw = +st.card.width, ch = +st.card.height;
    const b = Math.max(0, +(o && o.bleed) || 0);
    const c = st.colors;
    let out = "";
    ctx.dark = st.card.background === "blue";

    if (ctx.art) {
      let bg;
      if (st.card.background === "blue") {
        bg = ctx.radial(
          [[0, c.royal], [0.55, P.color.mix(c.royal, c.navy, 0.5)], [1, c.navy]],
          cw / 2, ch * 0.42, Math.hypot(cw / 2, ch * 0.6)
        );
      } else {
        bg = ctx.linear(
          [[0, P.color.lighten(c.pearl, 0.55)], [0.42, c.pearl], [0.78, P.color.mix(c.pearl, c.light, 0.1)], [1, P.color.mix(c.pearl, "#E9DCC9", 0.35)]],
          0, 0, cw, ch
        );
      }
      out += `<rect x="${P.n(-b)}" y="${P.n(-b)}" width="${P.n(cw + 2 * b)}" height="${P.n(ch + 2 * b)}" fill="${bg}"/>`;
    }

    const fr = frame(ctx, cw, ch);
    if (ctx.art || ctx.foil) out += fr.svg;

    const sf = Math.min(cw / 150, ch / 210);
    const padX = fr.inner + Math.max(7, 9 * sf);
    const padY = fr.inner + Math.max(7, 10 * sf);
    const maxW = cw - 2 * padX;
    const availH = ch - 2 * padY;

    // ajuste automático: reduz o conjunto até caber na área útil
    let k = sf, blocks = buildBlocks(ctx, cw, k, maxW), total = stackHeight(blocks);
    let overflow = false;
    if (total > availH) {
      let lo = sf * 0.5, hi = sf;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const bl = buildBlocks(ctx, cw, mid, maxW);
        if (stackHeight(bl) <= availH) lo = mid;
        else hi = mid;
      }
      k = lo;
      blocks = buildBlocks(ctx, cw, k, maxW);
      total = stackHeight(blocks);
      overflow = total > availH + 0.01;
    }
    // espaço sobrando: abre um pouco os espaçamentos e centraliza
    const extra = Math.max(0, availH - total);
    const gapsTotal = blocks.reduce((s, bl, i) => s + (i ? bl.gap : 0), 0) || 1;
    const grow = Math.min(extra * 0.5, gapsTotal * 0.55);
    const factor = 1 + grow / gapsTotal;
    let y = padY + (extra - grow) / 2;
    blocks.forEach((bl, i) => {
      if (i) y += bl.gap * factor;
      out += bl.draw(y);
      y += bl.h;
    });

    if (o && o.guides) {
      out += `<rect x="5" y="5" width="${P.n(cw - 10)}" height="${P.n(ch - 10)}" fill="none" stroke="#19B5E8" stroke-width="0.18" stroke-dasharray="0.5 0.9"/>`;
      if (b) out += `<rect x="${P.n(-b)}" y="${P.n(-b)}" width="${P.n(cw + 2 * b)}" height="${P.n(ch + 2 * b)}" fill="none" stroke="#EC008C" stroke-width="0.18" stroke-dasharray="1.2 0.8"/>`;
      out += `<rect x="0" y="0" width="${P.n(cw)}" height="${P.n(ch)}" fill="none" stroke="#7a7a7a" stroke-width="0.12"/>`;
    }
    return { svg: out, overflow, scale: k / sf };
  }

  P.card = { render, colors };
})();
