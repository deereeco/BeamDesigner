// All SVG drawing. Each draw function measures its target <svg>, sets the viewBox
// to the live pixel size (1 unit = 1 px, so nothing is distorted), clears it, and
// rebuilds its contents. Cheap for these small drawings; called on every change.

import { shapeNorm } from './beam.js';
import { fmtVal, fmtNum, unitLabel } from './units.js';

// Populated from CSS custom properties by refreshColors() so drawings follow the
// active theme. Mutated in place (not reassigned) to keep live imports valid.
export const COLORS = {};

export function refreshColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  Object.assign(COLORS, {
    na: v('--na'), fiber: v('--fiber'), accent: v('--accent'),
    safe: v('--safe'), warn: v('--warn'), danger: v('--danger'),
    axis: v('--axis'), grid: v('--grid'), ink: v('--ink'), muted: v('--muted'),
    shear: v('--shear'), moment: v('--moment'),
    wall: v('--svg-wall'), wallHatch: v('--svg-wall-hatch'),
    band: v('--svg-band'), bandStroke: v('--svg-band-stroke'),
    cut: v('--svg-cut'), halo: v('--svg-halo'), sectionFill: v('--svg-section-fill'),
  });
}

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

function txt(x, y, str, o = {}) {
  return el('text', {
    x, y, 'text-anchor': o.anchor || 'middle',
    'dominant-baseline': o.baseline || 'auto',
    'font-size': o.size || 11, fill: o.fill || COLORS.muted,
    'font-weight': o.weight || 400,
  }, str);
}

function setup(svg) {
  const r = svg.getBoundingClientRect();
  const w = Math.max(10, Math.round(r.width));
  const h = Math.max(10, Math.round(r.height));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  return { w, h, g: document.createDocumentFragment() };
}

function polyPath(pts, close = false) {
  let d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  if (close) d += ' Z';
  return d;
}

// Smallest "nice" 1-2-5 number >= x.
function niceStep(x) {
  if (!(x > 0) || !isFinite(x)) return 1;
  const e = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, e);
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, e);
}

// ───────────────────────── Beam strip ─────────────────────────
export function drawBeam(svg, state, d, system) {
  const { w, h, g } = setup(svg);
  const padX = 60, padTop = 34, padBot = 26;
  const x0 = padX, x1 = w - padX, plotW = Math.max(1, x1 - x0);
  const L = state.L;
  const toPx = (x) => x0 + (x / L) * plotW;

  const beamHalf = 15;
  const midY = padTop + 4 + beamHalf;
  const maxDefl = Math.max(10, (h - padBot - beamHalf) - midY - 14);
  const sat = Math.abs(d.delta) / (Math.abs(d.delta) + 3); // saturating 0..1
  const amp = maxDefl * sat * (d.delta >= 0 ? 1 : -1);
  const yCenter = (x) => midY + amp * shapeNorm(x, L);

  // Walls (clamped supports) at both ends — gray block + diagonal hatch.
  const wallW = 16, wallH = beamHalf + 14;
  for (const side of ['L', 'R']) {
    const wx = side === 'L' ? x0 - wallW : x1;
    g.appendChild(el('rect', { x: wx, y: midY - wallH, width: wallW, height: 2 * wallH, fill: COLORS.wall }));
    for (let yy = -wallH; yy < wallH; yy += 6) {
      g.appendChild(el('line', {
        x1: wx, y1: midY + yy + 6, x2: wx + wallW, y2: midY + yy,
        stroke: COLORS.wallHatch, 'stroke-width': 1,
      }));
    }
  }

  // Undeformed reference line.
  g.appendChild(el('line', { x1: x0, y1: midY, x2: x1, y2: midY, stroke: COLORS.grid, 'stroke-dasharray': '4 4', 'stroke-width': 1 }));

  // Deflected beam band.
  const N = 100, top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * L, yc = yCenter(x);
    top.push([toPx(x), yc - beamHalf]);
    bot.push([toPx(x), yc + beamHalf]);
  }
  const band = polyPath(top) + ' ' + bot.slice().reverse().map((p) => `L${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ') + ' Z';
  g.appendChild(el('path', { d: band, fill: COLORS.band, 'fill-opacity': 0.55, stroke: COLORS.bandStroke, 'stroke-width': 1.5 }));

  // Displacement arrow at center (when deflected).
  if (Math.abs(amp) > 2) {
    const xc = toPx(L / 2), yEnd = yCenter(L / 2);
    g.appendChild(el('line', { x1: xc, y1: midY, x2: xc, y2: yEnd, stroke: COLORS.ink, 'stroke-width': 1.5 }));
    const dir = amp >= 0 ? 1 : -1;
    g.appendChild(el('path', { d: `M${xc - 4} ${yEnd - 7 * dir} L${xc} ${yEnd} L${xc + 4} ${yEnd - 7 * dir} Z`, fill: COLORS.ink }));
    g.appendChild(txt(xc + 8, (midY + yEnd) / 2, `δ = ${fmtVal(d.delta, system, 'length', 3)}`, { anchor: 'start', size: 10, fill: COLORS.ink }));
  }

  // End ticks.
  g.appendChild(txt(x0, h - 8, '0', { size: 10 }));
  g.appendChild(txt(x1, h - 8, fmtVal(L, system, 'length', 3), { size: 10 }));

  // Hover preview (faint) when pinned and hovering elsewhere.
  const pinned = state.cut.xPinned != null;
  if (pinned && state.cut.xHover != null && Math.abs(state.cut.xHover - state.cut.xPinned) > 1) {
    const hx = toPx(Math.min(L, Math.max(0, state.cut.xHover)));
    g.appendChild(el('line', { x1: hx, y1: padTop - 6, x2: hx, y2: h - padBot, stroke: COLORS.muted, 'stroke-width': 1, 'stroke-dasharray': '3 4' }));
  }

  // Cut line at the evaluation location.
  const xE = d.xEval, cx = toPx(xE), yc = yCenter(xE);
  g.appendChild(el('line', {
    x1: cx, y1: yc - beamHalf - 16, x2: cx, y2: yc + beamHalf + 16,
    stroke: pinned ? COLORS.accent : COLORS.cut,
    'stroke-width': pinned ? 2.5 : 1.5,
    'stroke-dasharray': pinned ? null : '5 4',
  }));
  // Evaluation-point dots: neutral axis (center) and extreme fiber (top).
  g.appendChild(el('circle', { cx, cy: yc - beamHalf, r: 5, fill: COLORS.fiber, stroke: COLORS.halo, 'stroke-width': 1.5 }));
  g.appendChild(el('circle', { cx, cy: yc, r: 5, fill: COLORS.na, stroke: COLORS.halo, 'stroke-width': 1.5 }));

  // Location label.
  g.appendChild(txt(cx, padTop - 14, `x = ${fmtVal(xE, system, 'length', 3)}${pinned ? '  📌 pinned' : ''}`, {
    anchor: 'middle', size: 11, fill: pinned ? COLORS.accent : COLORS.ink, weight: 600,
  }));

  svg.appendChild(g);
}

// ───────────────────────── Shear / Moment diagrams ─────────────────────────
export function drawDiagram(svg, d, key, system) {
  const { w, h, g } = setup(svg);
  const padX = 56, padT = 12, padB = 14;
  const x0 = padX, x1 = w - padX, plotW = Math.max(1, x1 - x0);
  const xs = d.diagram.xs;
  const arr = key === 'M' ? d.diagram.Ms : d.diagram.Vs;
  const L = xs[xs.length - 1];
  let maxAbs = 0;
  for (const v of arr) maxAbs = Math.max(maxAbs, Math.abs(v));
  if (maxAbs < 1e-12) maxAbs = 1;
  const zeroY = padT + (h - padT - padB) / 2;
  const halfH = (h - padT - padB) / 2 - 3;
  const sc = halfH / maxAbs;
  const toPx = (x) => x0 + (x / L) * plotW;
  const toPy = (v) => zeroY - v * sc;
  const color = key === 'M' ? COLORS.moment : COLORS.shear;
  const cat = key === 'M' ? 'moment' : 'force';

  // Zero axis.
  g.appendChild(el('line', { x1: x0, y1: zeroY, x2: x1, y2: zeroY, stroke: COLORS.axis, 'stroke-width': 1 }));

  // Filled area + curve.
  const pts = arr.map((v, i) => [toPx(xs[i]), toPy(v)]);
  const area = `M${toPx(0).toFixed(2)} ${zeroY.toFixed(2)} ` +
    pts.map((p) => `L${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ') +
    ` L${toPx(L).toFixed(2)} ${zeroY.toFixed(2)} Z`;
  g.appendChild(el('path', { d: area, fill: color, 'fill-opacity': 0.14 }));
  g.appendChild(el('path', { d: polyPath(pts), fill: 'none', stroke: color, 'stroke-width': 1.8 }));

  // Cursor synced to evaluation location.
  const cx = toPx(d.xEval);
  g.appendChild(el('line', { x1: cx, y1: padT, x2: cx, y2: h - padB, stroke: COLORS.accent, 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }));

  // Peak labels.
  const peak = key === 'M' ? d.Mmax : d.Vmax;
  g.appendChild(txt(x0 - 4, padT + 4, `+${fmtVal(peak, system, cat, 3)}`, { anchor: 'end', size: 9 }));
  g.appendChild(txt(x0 - 4, h - padB - 2, `−${fmtVal(peak, system, cat, 3)}`, { anchor: 'end', size: 9 }));

  svg.appendChild(g);
}

// ───────────────────────── Cross-section + through-depth stress ─────────────────────────
export function drawSection(svg, d, system) {
  const { w, h, g } = setup(svg);
  const padT = 26, padB = 24, padL = 16, padR = 12, gap = 16;
  const yTop = padT, yBot = h - padB;
  const c = d.c;
  const toY = (y) => yBot - ((y + c) / (2 * c)) * (yBot - yTop);

  // Column A: the rectangular section.
  const colAw = Math.min(58, w * 0.16), colAx = padL;
  g.appendChild(el('rect', { x: colAx, y: yTop, width: colAw, height: yBot - yTop, fill: COLORS.sectionFill, stroke: COLORS.bandStroke, 'stroke-width': 1.2 }));
  g.appendChild(el('line', { x1: colAx - 4, y1: toY(0), x2: colAx + colAw + 4, y2: toY(0), stroke: COLORS.na, 'stroke-dasharray': '4 3', 'stroke-width': 1.2 }));
  g.appendChild(el('circle', { cx: colAx + colAw / 2, cy: toY(0), r: 5, fill: COLORS.na, stroke: COLORS.halo, 'stroke-width': 1.5 }));
  g.appendChild(el('circle', { cx: colAx + colAw / 2, cy: toY(c), r: 5, fill: COLORS.fiber, stroke: COLORS.halo, 'stroke-width': 1.5 }));
  g.appendChild(txt(colAx + colAw / 2, h - 8, 'section', { size: 10 }));

  // Stress plots share the vertical depth axis.
  const restX0 = colAx + colAw + gap + 18;
  const restW = (w - padR) - restX0;
  const colW = (restW - gap) / 2;

  const ys = d.sectionDist.ys, sx = d.sectionDist.sigmaXs, tau = d.sectionDist.taus;
  let sxMax = 0, tauMax = 0;
  for (const v of sx) sxMax = Math.max(sxMax, Math.abs(v));
  for (const v of tau) tauMax = Math.max(tauMax, Math.abs(v));
  sxMax = sxMax || 1; tauMax = tauMax || 1;

  // σ_x(y): linear, signed about a centered zero axis.
  const sigCx = restX0 + colW / 2;
  const sigHalf = colW / 2 - 6;
  g.appendChild(el('line', { x1: sigCx, y1: yTop, x2: sigCx, y2: yBot, stroke: COLORS.axis, 'stroke-width': 1 }));
  const sigPts = ys.map((y, i) => [sigCx + (sx[i] / sxMax) * sigHalf, toY(y)]);
  g.appendChild(el('path', { d: polyPath(sigPts), fill: 'none', stroke: COLORS.fiber, 'stroke-width': 1.8 }));
  g.appendChild(txt(sigCx, yTop - 8, 'σₓ(y)', { size: 10, fill: COLORS.fiber, weight: 600 }));
  g.appendChild(txt(sigCx, h - 8, `±${fmtVal(d.sectionDist.sigmaFiber, system, 'stress', 3)}`, { size: 9 }));

  // τ(y): parabola, magnitude to the right of a left zero axis.
  const tauX0 = restX0 + colW + gap;
  const tauW = colW - 6;
  g.appendChild(el('line', { x1: tauX0, y1: yTop, x2: tauX0, y2: yBot, stroke: COLORS.axis, 'stroke-width': 1 }));
  const tauPts = ys.map((y, i) => [tauX0 + (Math.abs(tau[i]) / tauMax) * tauW, toY(y)]);
  g.appendChild(el('path', { d: polyPath(tauPts), fill: 'none', stroke: COLORS.na, 'stroke-width': 1.8 }));
  g.appendChild(txt(tauX0 + tauW / 2, yTop - 8, 'τ(y)', { size: 10, fill: COLORS.na, weight: 600 }));
  g.appendChild(txt(tauX0 + tauW / 2, h - 8, `max ${fmtVal(d.sectionDist.tauNA, system, 'stress', 3)}`, { size: 9 }));

  // Depth ticks.
  g.appendChild(txt(colAx - 4, toY(c), '+c', { anchor: 'end', size: 9, baseline: 'middle' }));
  g.appendChild(txt(colAx - 4, toY(0), '0', { anchor: 'end', size: 9, baseline: 'middle' }));
  g.appendChild(txt(colAx - 4, toY(-c), '−c', { anchor: 'end', size: 9, baseline: 'middle' }));

  svg.appendChild(g);
}

// ───────────────────────── Mohr's circle ─────────────────────────
export function drawMohr(svg, pt, sigmaY, color, system) {
  const { w, h, g } = setup(svg);
  const margin = 30;
  const side = Math.min(w, h);
  const cx = w / 2, cy = h / 2;
  const R = side / 2 - margin;
  const C = pt.center, r = pt.radius;

  const ext = Math.max(Math.abs(C) + r, r, 1e-6);
  const S = niceStep(ext * 1.25);
  const sc = R / S;
  const X = (s) => cx + s * sc;
  const Y = (t) => cy - t * sc;

  // Axes.
  g.appendChild(el('line', { x1: X(-S), y1: cy, x2: X(S), y2: cy, stroke: COLORS.axis, 'stroke-width': 1 }));
  g.appendChild(el('line', { x1: cx, y1: Y(-S), x2: cx, y2: Y(S), stroke: COLORS.axis, 'stroke-width': 1 }));
  g.appendChild(txt(X(S), cy + 14, 'σ', { anchor: 'end', size: 11, fill: COLORS.ink }));
  g.appendChild(txt(cx + 8, Y(S) + 4, 'τ', { anchor: 'start', size: 11, fill: COLORS.ink }));

  // Tresca shear reference (|τ| = σY/2) if in range.
  if (sigmaY / 2 <= S) {
    for (const s of [1, -1]) {
      g.appendChild(el('line', { x1: X(-S), y1: Y(s * sigmaY / 2), x2: X(S), y2: Y(s * sigmaY / 2), stroke: COLORS.warn, 'stroke-width': 1, 'stroke-dasharray': '3 4', 'stroke-opacity': 0.7 }));
    }
    g.appendChild(txt(X(S), Y(sigmaY / 2) - 4, 'τ=σ_Y/2', { anchor: 'end', size: 9, fill: COLORS.warn }));
  }

  // The circle.
  if (r * sc > 0.5) {
    g.appendChild(el('circle', { cx: X(C), cy: Y(0), r: r * sc, fill: color, 'fill-opacity': 0.08, stroke: color, 'stroke-width': 2 }));
  }
  g.appendChild(el('circle', { cx: X(C), cy: Y(0), r: 2.5, fill: COLORS.muted }));

  // Principal points and the current stress point.
  g.appendChild(el('circle', { cx: X(pt.s1), cy: Y(0), r: 3.5, fill: COLORS.ink }));
  g.appendChild(el('circle', { cx: X(pt.s2), cy: Y(0), r: 3.5, fill: COLORS.ink }));
  g.appendChild(el('circle', { cx: X(0), cy: Y(-pt.tau), r: 3, fill: color, 'fill-opacity': 0.4 }));
  g.appendChild(el('circle', { cx: X(pt.sigma_x), cy: Y(pt.tau), r: 4.5, fill: color, stroke: COLORS.halo, 'stroke-width': 1.5 }));

  // Readouts.
  g.appendChild(txt(cx, h - 6, `σ₁=${fmtVal(pt.s1, system, 'stress', 3)}  σ₂=${fmtVal(pt.s2, system, 'stress', 3)}  τ_max=${fmtVal(pt.radius, system, 'stress', 3)}`, { size: 10, fill: COLORS.ink }));

  svg.appendChild(g);
}

// ───────────────────────── σ₁–σ₂ yield envelope ─────────────────────────
export function drawEnvelope(svg, pt, sigmaY, system) {
  const { w, h, g } = setup(svg);
  const margin = 30;
  const side = Math.min(w, h);
  const cx = w / 2, cy = h / 2;
  const R = side / 2 - margin;
  const axisMax = 1.3 * sigmaY;
  const sc = R / axisMax;
  const X = (s1) => cx + s1 * sc;
  const Y = (s2) => cy - s2 * sc;

  // Axes + σ_Y ticks.
  g.appendChild(el('line', { x1: X(-axisMax), y1: cy, x2: X(axisMax), y2: cy, stroke: COLORS.axis, 'stroke-width': 1 }));
  g.appendChild(el('line', { x1: cx, y1: Y(-axisMax), x2: cx, y2: Y(axisMax), stroke: COLORS.axis, 'stroke-width': 1 }));
  g.appendChild(txt(X(axisMax), cy + 14, 'σ₁', { anchor: 'end', size: 11, fill: COLORS.ink }));
  g.appendChild(txt(cx + 8, Y(axisMax) + 4, 'σ₂', { anchor: 'start', size: 11, fill: COLORS.ink }));
  for (const s of [1, -1]) {
    g.appendChild(el('line', { x1: X(s * sigmaY), y1: cy - 4, x2: X(s * sigmaY), y2: cy + 4, stroke: COLORS.axis }));
    g.appendChild(el('line', { x1: cx - 4, y1: Y(s * sigmaY), x2: cx + 4, y2: Y(s * sigmaY), stroke: COLORS.axis }));
  }
  g.appendChild(txt(X(sigmaY), cy + 14, 'σ_Y', { size: 9 }));

  // von Mises ellipse (rotated 45°): u along σ1=σ2, v along σ1=−σ2.
  const ePts = [];
  for (let k = 0; k <= 120; k++) {
    const t = (k / 120) * 2 * Math.PI;
    const u = Math.SQRT2 * sigmaY * Math.cos(t);
    const v = Math.sqrt(2 / 3) * sigmaY * Math.sin(t);
    ePts.push([X((u + v) / Math.SQRT2), Y((u - v) / Math.SQRT2)]);
  }
  g.appendChild(el('path', { d: polyPath(ePts, true), fill: COLORS.safe, 'fill-opacity': 0.06, stroke: COLORS.safe, 'stroke-width': 1.8 }));

  // Tresca hexagon.
  const hv = [[1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1], [0, -1]].map(([a, b]) => [X(a * sigmaY), Y(b * sigmaY)]);
  g.appendChild(el('path', { d: polyPath(hv, true), fill: 'none', stroke: COLORS.warn, 'stroke-width': 1.6, 'stroke-dasharray': '6 4' }));

  // Region classification.
  const region = pt.vM > sigmaY ? 'yield' : pt.tresca > sigmaY ? 'tresca' : 'safe';
  const pColor = region === 'yield' ? COLORS.danger : region === 'tresca' ? COLORS.warn : COLORS.safe;

  // Clamp the marker to the frame if it overshoots.
  let s1 = pt.s1, s2 = pt.s2, clamped = false;
  const m = Math.max(Math.abs(s1), Math.abs(s2));
  if (m > axisMax) { const f = axisMax / m; s1 *= f; s2 *= f; clamped = true; }

  g.appendChild(el('line', { x1: cx, y1: cy, x2: X(s1), y2: Y(s2), stroke: pColor, 'stroke-width': 1, 'stroke-opacity': 0.5 }));
  g.appendChild(el('circle', { cx: X(s1), cy: Y(s2), r: clamped ? 4 : 5.5, fill: pColor, stroke: COLORS.halo, 'stroke-width': 1.5 }));
  if (clamped) g.appendChild(txt(X(s1), Y(s2) - 9, '↗ off-scale', { size: 9, fill: pColor }));

  // Status + legend.
  const statusText = region === 'yield' ? 'YIELDING (von Mises)'
    : region === 'tresca' ? 'Tresca exceeded · vM safe' : 'Safe';
  g.appendChild(txt(cx, 14, statusText, { size: 11, fill: pColor, weight: 700 }));
  g.appendChild(txt(cx, h - 6, `vM ${fmtVal(pt.vM, system, 'stress', 3)} · FoS ${fmtNum(pt.fosVM, 3)} (vM) / ${fmtNum(pt.fosT, 3)} (Tr)`, { size: 10, fill: COLORS.ink }));

  svg.appendChild(g);
}
