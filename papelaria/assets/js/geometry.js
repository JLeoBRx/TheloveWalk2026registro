/*
 * Geometria plana (milímetros). Polígonos são listas de pontos [x, y], com o eixo y
 * para baixo, como no SVG.
 */
(function () {
  "use strict";
  const P = window.P;

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const len = (a) => Math.hypot(a[0], a[1]);
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

  function area(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      s += p[0] * q[1] - q[0] * p[1];
    }
    return s / 2;
  }

  function dedupe(poly, closed) {
    const out = [];
    for (const p of poly) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
    }
    if (closed && out.length > 1) {
      const a = out[0], b = out[out.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out.pop();
    }
    return out;
  }

  /* Curva quadrática amostrada (inclui o ponto inicial e o final). */
  function quad(p0, c, p1, steps) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
    }
    return pts;
  }

  /*
   * Arredonda vértices. radii[i] é o raio aproximado do vértice i (0 = canto vivo).
   * Para cadeias abertas (closed=false) o primeiro e o último ponto nunca são arredondados.
   */
  function fillet(points, radii, closed) {
    const n = points.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = typeof radii === "number" ? radii : radii[i] || 0;
      const isEnd = !closed && (i === 0 || i === n - 1);
      if (!r || isEnd) {
        out.push(points[i]);
        continue;
      }
      const v = points[i];
      const a = points[(i - 1 + n) % n];
      const b = points[(i + 1) % n];
      const la = len(sub(a, v)), lb = len(sub(b, v));
      const ua = mul(sub(a, v), 1 / la), ub = mul(sub(b, v), 1 / lb);
      const cosT = P.clamp(ua[0] * ub[0] + ua[1] * ub[1], -1, 1);
      const theta = Math.acos(cosT); // ângulo interno
      let t = r / Math.tan(theta / 2);
      t = Math.min(t, la * 0.48, lb * 0.48);
      const p1 = add(v, mul(ua, t)), p2 = add(v, mul(ub, t));
      // arco circular verdadeiro entre p1 e p2
      const bis = add(ua, ub);
      const bl = len(bis);
      const realR = t * Math.tan(theta / 2);
      if (bl < 1e-9 || !isFinite(realR)) {
        out.push(v);
        continue;
      }
      const dc = realR / Math.sin(theta / 2);
      const c = add(v, mul(bis, dc / bl));
      let a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
      let a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(4, Math.ceil(Math.abs(da) / (Math.PI / 24)));
      for (let k = 0; k <= steps; k++) {
        const ang = a1 + (da * k) / steps;
        out.push([c[0] + realR * Math.cos(ang), c[1] + realR * Math.sin(ang)]);
      }
    }
    return dedupe(out, closed);
  }

  /*
   * Deslocamento (offset) de polígono convexo, aresta por aresta.
   * dists[i] vale para a aresta i (do vértice i ao i+1); positivo = para fora.
   * O polígono resultante tem as arestas na mesma ordem do original.
   */
  function offset(poly, dists) {
    const n = poly.length;
    const s = area(poly) > 0 ? 1 : -1;
    const lines = [];
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n];
      const d = sub(q, p);
      const l = len(d) || 1e-9;
      const nrm = s > 0 ? [d[1] / l, -d[0] / l] : [-d[1] / l, d[0] / l];
      const dist = typeof dists === "number" ? dists : dists[i] || 0;
      lines.push({ p: add(p, mul(nrm, dist)), d, nrm, dist });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
      const den = cross(L1.d, L2.d);
      if (Math.abs(den) < 1e-9 * len(L1.d) * len(L2.d)) {
        out.push(add(poly[i], mul(L2.nrm, L2.dist)));
      } else {
        const t = cross(sub(L2.p, L1.p), L2.d) / den;
        out.push(add(L1.p, mul(L1.d, t)));
      }
    }
    return out;
  }

  /* Recorte de Sutherland–Hodgman: subject recortado pelo polígono convexo clipPoly. */
  function clip(subject, clipPoly) {
    const s = area(clipPoly) > 0 ? 1 : -1;
    let out = subject.slice();
    for (let i = 0; i < clipPoly.length && out.length; i++) {
      const a = clipPoly[i], b = clipPoly[(i + 1) % clipPoly.length];
      const inside = (p) => s * cross(sub(b, a), sub(p, a)) >= -1e-9;
      const inter = (p, q) => {
        const d1 = sub(q, p), d2 = sub(b, a);
        const den = cross(d1, d2);
        if (Math.abs(den) < 1e-12) return p;
        const t = cross(sub(a, p), d2) / den;
        return add(p, mul(d1, t));
      };
      const input = out;
      out = [];
      for (let j = 0; j < input.length; j++) {
        const cur = input[j], prev = input[(j - 1 + input.length) % input.length];
        const ci = inside(cur), pi = inside(prev);
        if (ci) {
          if (!pi) out.push(inter(prev, cur));
          out.push(cur);
        } else if (pi) out.push(inter(prev, cur));
      }
    }
    return dedupe(out, true);
  }

  function bbox(polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys)
      for (const p of poly) {
        if (p[0] < x0) x0 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[0] > x1) x1 = p[0];
        if (p[1] > y1) y1 = p[1];
      }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, x1, y1 };
  }

  function d(poly, closed) {
    if (!poly.length) return "";
    let s = "M" + P.n(poly[0][0]) + " " + P.n(poly[0][1]);
    for (let i = 1; i < poly.length; i++) s += "L" + P.n(poly[i][0]) + " " + P.n(poly[i][1]);
    return closed === false ? s : s + "Z";
  }

  function map(poly, fn) {
    return poly.map((p) => fn(p[0], p[1]));
  }

  /* Distância de um ponto a um segmento. */
  function distSeg(p, a, b) {
    const ab = sub(b, a), ap = sub(p, a);
    const t = P.clamp((ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1] || 1e-9), 0, 1);
    return len(sub(p, add(a, mul(ab, t))));
  }
  function distChain(p, chain) {
    let m = Infinity;
    for (let i = 0; i < chain.length - 1; i++) m = Math.min(m, distSeg(p, chain[i], chain[i + 1]));
    return m;
  }

  /* Ponto dentro de polígono (par-ímpar). */
  function inside(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  /* Hachura diagonal dentro de um polígono convexo: devolve segmentos. */
  function hatch(poly, spacing, angleDeg) {
    const a = (angleDeg * Math.PI) / 180;
    const dir = [Math.cos(a), Math.sin(a)], nrm = [-Math.sin(a), Math.cos(a)];
    let lo = Infinity, hi = -Infinity;
    for (const p of poly) {
      const v = p[0] * nrm[0] + p[1] * nrm[1];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const segs = [];
    for (let v = Math.ceil(lo / spacing) * spacing; v <= hi; v += spacing) {
      // interseção da reta {x·nrm = v} com as arestas
      const hits = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const vp = p[0] * nrm[0] + p[1] * nrm[1], vq = q[0] * nrm[0] + q[1] * nrm[1];
        if ((vp - v) * (vq - v) <= 0 && vp !== vq) {
          const t = (v - vp) / (vq - vp);
          hits.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
      if (hits.length >= 2) {
        hits.sort((h1, h2) => h1[0] * dir[0] + h1[1] * dir[1] - (h2[0] * dir[0] + h2[1] * dir[1]));
        segs.push([hits[0], hits[hits.length - 1]]);
      }
    }
    return segs;
  }

  function centroid(poly) {
    let x = 0, y = 0, a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const f = p[0] * q[1] - q[0] * p[1];
      x += (p[0] + q[0]) * f;
      y += (p[1] + q[1]) * f;
      a += f;
    }
    if (Math.abs(a) < 1e-9) return poly[0];
    return [x / (3 * a), y / (3 * a)];
  }

  P.geo = { area, fillet, offset, clip, bbox, d, map, quad, dedupe, distSeg, distChain, inside, hatch, centroid };
})();
