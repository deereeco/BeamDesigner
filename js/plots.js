// All SVG drawing. Each draw function measures its target <svg>, sets the viewBox
// to the live pixel size (1 unit = 1 px, so nothing is distorted), clears it, and
// rebuilds its contents. Cheap for these small drawings; called on every change.

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

// Horizontal padding for the beam strip (room for end walls/labels). Exported so
// app.js beamXFromEvent uses the identical value — keeps the pointer→x mapping exact
// at any beam width (the strip is now in the narrower left column).
export function beamPadX(w) { return Math.max(28, Math.min(60, w * 0.10)); }

// Horizontal padding for the shear/moment diagrams (symmetric, fixed). Exported so
// app.js diagramXFromEvent uses the identical value — keeps the pointer→x mapping exact.
export const DIAGRAM_PAD_X = 56;

// ───────────────────────── Beam strip ─────────────────────────
export function drawBeam(svg, state, d, system) {
  const { w, h, g } = setup(svg);
  const padX = beamPadX(w);
  const x0 = padX, x1 = w - padX, plotW = Math.max(1, x1 - x0);
  const L = state.L;
  const toPx = (x) => x0 + (x / L) * plotW;

  // Vertical layout: a top band for the cut label + load arrow, the beam in the
  // middle, and a lower band for the deflection / reaction labels and end ticks.
  const beamHalf = 15;
  const beamTop = 52;
  const midY = beamTop + beamHalf;          // neutral axis at rest
  const beamBot = midY + beamHalf;
  const maxDefl = 42;
  const sat = Math.abs(d.delta) / (Math.abs(d.delta) + 3); // saturating 0..1
  const amp = maxDefl * sat * (d.delta >= 0 ? 1 : -1);
  const model = d.model;
  const yCenter = (x) => midY + amp * model.shapeNorm(x, L);

  // Walls (clamped supports) — gray block + diagonal hatch. Both ends for a fixed-fixed
  // beam; the left end only for a cantilever (the right end is free).
  const wallW = 16, wallH = beamHalf + 14;
  for (const side of model.walls) {
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

  // Applied load P: a down-arrow above the beam at the load point (center for a
  // fixed-fixed beam, the free tip for a cantilever). Skipped at P≈0 (force mode at 0).
  const loadX = L * model.dispXFrac;
  const lpx = toPx(loadX);
  const nearRight = model.dispXFrac > 0.9;
  if (d.P > 1e-9) {
    const aBot = beamTop - 3, aTop = aBot - 19;
    g.appendChild(el('line', { x1: lpx, y1: aTop, x2: lpx, y2: aBot, stroke: COLORS.ink, 'stroke-width': 1.6 }));
    g.appendChild(el('path', { d: `M${lpx - 4} ${aBot - 7} L${lpx} ${aBot} L${lpx + 4} ${aBot - 7} Z`, fill: COLORS.ink }));
    g.appendChild(txt(nearRight ? lpx - 7 : lpx + 7, aTop + 9, `P = ${fmtVal(d.P, system, 'force', 3)}`, { anchor: nearRight ? 'end' : 'start', size: 10, fill: COLORS.ink, weight: 600 }));
  }

  // Reactions: an up-arrow plus the wall reaction R and the wall moment |M| at each support.
  for (const side of model.walls) {
    const sx = side === 'L' ? x0 : x1;
    const tx = side === 'L' ? sx + 6 : sx - 6;
    const anchor = side === 'L' ? 'start' : 'end';
    const aTop = beamBot + 3, aBot = aTop + 17;
    g.appendChild(el('line', { x1: sx, y1: aBot, x2: sx, y2: aTop, stroke: COLORS.muted, 'stroke-width': 1.6 }));
    g.appendChild(el('path', { d: `M${sx - 4} ${aTop + 7} L${sx} ${aTop} L${sx + 4} ${aTop + 7} Z`, fill: COLORS.muted }));
    g.appendChild(txt(tx, aBot + 3, `R = ${fmtVal(d.R, system, 'force', 3)}`, { anchor, size: 9, fill: COLORS.muted, baseline: 'hanging' }));
    g.appendChild(txt(tx, aBot + 15, `|M| = ${fmtVal(d.Mwall, system, 'moment', 3)}`, { anchor, size: 9, fill: COLORS.muted, baseline: 'hanging' }));
  }

  // Displacement arrow at the peak-deflection point, when deflected. Flip the label to the
  // left when the arrow sits at the tip.
  if (Math.abs(amp) > 2) {
    const yEnd = yCenter(loadX);
    g.appendChild(el('line', { x1: lpx, y1: midY, x2: lpx, y2: yEnd, stroke: COLORS.ink, 'stroke-width': 1.5 }));
    const dir = amp >= 0 ? 1 : -1;
    g.appendChild(el('path', { d: `M${lpx - 4} ${yEnd - 7 * dir} L${lpx} ${yEnd} L${lpx + 4} ${yEnd - 7 * dir} Z`, fill: COLORS.ink }));
    g.appendChild(txt(nearRight ? lpx - 8 : lpx + 8, (midY + yEnd) / 2, `δ = ${fmtVal(d.delta, system, 'length', 3)}`, { anchor: nearRight ? 'end' : 'start', size: 10, fill: COLORS.ink }));
  }

  // End ticks.
  g.appendChild(txt(x0, h - 7, '0', { size: 10 }));
  g.appendChild(txt(x1, h - 7, fmtVal(L, system, 'length', 3), { size: 10 }));

  // Hover preview (faint) when pinned and hovering elsewhere.
  const pinned = state.cut.xPinned != null;
  if (pinned && state.cut.xHover != null && Math.abs(state.cut.xHover - state.cut.xPinned) > 1) {
    const hx = toPx(Math.min(L, Math.max(0, state.cut.xHover)));
    g.appendChild(el('line', { x1: hx, y1: beamTop - 20, x2: hx, y2: beamBot + 20, stroke: COLORS.muted, 'stroke-width': 1, 'stroke-dasharray': '3 4' }));
  }

  // Cut line at the evaluation location.
  const xE = d.xEval, cx = toPx(xE), yc = yCenter(xE);
  g.appendChild(el('line', {
    x1: cx, y1: yc - beamHalf - 15, x2: cx, y2: yc + beamHalf + 15,
    stroke: pinned ? COLORS.accent : COLORS.cut,
    'stroke-width': pinned ? 2.5 : 1.5,
    'stroke-dasharray': pinned ? null : '5 4',
  }));
  // Evaluation-point dots: extreme fiber (top) and neutral axis (center).
  g.appendChild(el('circle', { cx, cy: yc - beamHalf, r: 5, fill: COLORS.fiber, stroke: COLORS.halo, 'stroke-width': 1.5 }));
  g.appendChild(el('circle', { cx, cy: yc, r: 5, fill: COLORS.na, stroke: COLORS.halo, 'stroke-width': 1.5 }));

  // Location label (top band).
  g.appendChild(txt(cx, 13, `x = ${fmtVal(xE, system, 'length', 3)}${pinned ? '  📌 pinned' : ''}`, {
    anchor: 'middle', size: 11, fill: pinned ? COLORS.accent : COLORS.ink, weight: 600,
  }));

  svg.appendChild(g);
}

// ───────────────────────── Shear / Moment diagrams ─────────────────────────
export function drawDiagram(svg, state, d, key, system) {
  const { w, h, g } = setup(svg);
  const padX = DIAGRAM_PAD_X, padT = 12, padB = 14;
  const x0 = padX, x1 = w - padX, plotW = Math.max(1, x1 - x0);
  const xs = d.diagram.xs;
  const arr = key === 'M' ? d.diagram.Ms : d.diagram.Vs;
  const L = xs[xs.length - 1];
  let maxAbs = 0, vMin = Infinity, vMax = -Infinity;
  for (const v of arr) { maxAbs = Math.max(maxAbs, Math.abs(v)); if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
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

  // Hover preview (faint) when pinned and hovering elsewhere — mirrors drawBeam.
  const pinned = state.cut.xPinned != null;
  if (pinned && state.cut.xHover != null && Math.abs(state.cut.xHover - state.cut.xPinned) > 1) {
    const hx = toPx(Math.min(L, Math.max(0, state.cut.xHover)));
    g.appendChild(el('line', { x1: hx, y1: padT, x2: hx, y2: h - padB, stroke: COLORS.muted, 'stroke-width': 1, 'stroke-dasharray': '3 4' }));
  }
  // Cut line synced to the evaluation location: bold/solid when pinned, light/dashed when hovering.
  const cx = toPx(d.xEval);
  g.appendChild(el('line', {
    x1: cx, y1: padT, x2: cx, y2: h - padB,
    stroke: pinned ? COLORS.accent : COLORS.cut,
    'stroke-width': pinned ? 2.2 : 1.2,
    'stroke-dasharray': pinned ? null : '4 3',
  }));

  // At-cut value: a marker on the curve and a label at the top edge (consolidated from
  // the former readout table). Highlighted when the cut is pinned.
  const cutVal = key === 'M' ? d.Mx : d.Vx;
  const cyCut = toPy(cutVal);
  g.appendChild(el('circle', { cx, cy: cyCut, r: 3, fill: pinned ? COLORS.accent : color, stroke: COLORS.halo, 'stroke-width': 1 }));
  const leftHalf = cx < (x0 + x1) / 2;
  g.appendChild(txt(leftHalf ? cx + 5 : cx - 5, padT + 8, `${key}(x) = ${fmtVal(cutVal, system, cat, 3)}`, { anchor: leftHalf ? 'start' : 'end', size: 9, fill: pinned ? COLORS.accent : COLORS.ink, weight: 600 }));

  // Peak labels — only on the side(s) the curve actually occupies. A cantilever's moment is
  // one-signed (all hogging) and its shear is constant, so the opposite label is suppressed.
  const tol = maxAbs * 1e-6;
  if (vMax > tol) g.appendChild(txt(x0 - 4, padT + 4, `+${fmtVal(vMax, system, cat, 3)}`, { anchor: 'end', size: 9 }));
  if (vMin < -tol) g.appendChild(txt(x0 - 4, h - padB - 2, `−${fmtVal(-vMin, system, cat, 3)}`, { anchor: 'end', size: 9 }));

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

// ───────────────────────── Cross-section dimensions (to scale) ─────────────────────────
// A true b:h-aspect rectangle with engineering dimension lines, redrawn live as b/h change.
// For extreme aspect ratios the thin side is clamped to a minimum pixel width so it stays
// visible (with a "(not to scale)" note); the labels always report the true values.
function arrowTri(g, x, y, dir, color) {
  const a = 5, b = 2.6; // length, half-width
  let d;
  if (dir === 'R') d = `M${x} ${y} L${x - a} ${y - b} L${x - a} ${y + b} Z`;
  else if (dir === 'L') d = `M${x} ${y} L${x + a} ${y - b} L${x + a} ${y + b} Z`;
  else if (dir === 'D') d = `M${x} ${y} L${x - b} ${y - a} L${x + b} ${y - a} Z`;
  else d = `M${x} ${y} L${x - b} ${y + a} L${x + b} ${y + a} Z`; // 'U'
  g.appendChild(el('path', { d, fill: color }));
}
function drawDimLineH(g, x1, x2, y) {
  g.appendChild(el('line', { x1, y1: y, x2, y2: y, stroke: COLORS.axis, 'stroke-width': 1 }));
  arrowTri(g, x1, y, 'L', COLORS.axis);
  arrowTri(g, x2, y, 'R', COLORS.axis);
}
function drawDimLineV(g, y1, y2, x) {
  g.appendChild(el('line', { x1: x, y1, x2: x, y2, stroke: COLORS.axis, 'stroke-width': 1 }));
  arrowTri(g, x, y1, 'U', COLORS.axis);
  arrowTri(g, x, y2, 'D', COLORS.axis);
}

export function drawSectionDims(svg, state, system) {
  const { w, h, g } = setup(svg);
  const b = Math.max(1e-6, state.b), hh = Math.max(1e-6, state.h); // canonical mm

  // Annotation insets: vertical dim (left), horizontal dim (below), orientation
  // labels + axis key (right), caption (top).
  const mL = 56, mR = 92, mT = 24, mB = 44;
  const availW = Math.max(10, w - mL - mR);
  const availH = Math.max(10, h - mT - mB);

  // Fit the true aspect ratio, then clamp a degenerate thin side to a visible minimum.
  const aspect = b / hh; // width / height
  let rw, rh;
  if (availW / availH > aspect) { rh = availH; rw = rh * aspect; } // height-limited
  else { rw = availW; rh = rw / aspect; }                          // width-limited
  const MINPX = 10;
  let notToScale = false;
  if (rw < MINPX) { rw = MINPX; notToScale = true; }
  if (rh < MINPX) { rh = MINPX; notToScale = true; }

  const rx = mL + (availW - rw) / 2;
  const ry = mT + (availH - rh) / 2;

  // Rectangle + neutral axis.
  g.appendChild(el('rect', { x: rx, y: ry, width: rw, height: rh, fill: COLORS.sectionFill, stroke: COLORS.bandStroke, 'stroke-width': 1.4 }));
  g.appendChild(el('line', { x1: rx, y1: ry + rh / 2, x2: rx + rw, y2: ry + rh / 2, stroke: COLORS.na, 'stroke-dasharray': '4 3', 'stroke-width': 1 }));

  // Width dimension (b) below the rectangle.
  const dimY = ry + rh + 22;
  g.appendChild(el('line', { x1: rx, y1: ry + rh, x2: rx, y2: dimY + 5, stroke: COLORS.axis, 'stroke-width': 1 }));
  g.appendChild(el('line', { x1: rx + rw, y1: ry + rh, x2: rx + rw, y2: dimY + 5, stroke: COLORS.axis, 'stroke-width': 1 }));
  drawDimLineH(g, rx, rx + rw, dimY);
  g.appendChild(txt(rx + rw / 2, dimY - 5, `b = ${fmtVal(b, system, 'length', 3)}`, { anchor: 'middle', size: 11, fill: COLORS.ink, weight: 600 }));

  // Height dimension (h) left of the rectangle (rotated label).
  const dimX = rx - 26;
  g.appendChild(el('line', { x1: rx, y1: ry, x2: dimX - 5, y2: ry, stroke: COLORS.axis, 'stroke-width': 1 }));
  g.appendChild(el('line', { x1: rx, y1: ry + rh, x2: dimX - 5, y2: ry + rh, stroke: COLORS.axis, 'stroke-width': 1 }));
  drawDimLineV(g, ry, ry + rh, dimX);
  const hy = ry + rh / 2;
  g.appendChild(el('text', {
    x: dimX - 6, y: hy, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
    'font-size': 11, fill: COLORS.ink, 'font-weight': 600,
    transform: `rotate(-90 ${dimX - 6} ${hy})`,
  }, `h = ${fmtVal(hh, system, 'length', 3)}`));

  // ── Orientation cue: this rectangle is the beam sliced at the cut, viewed
  //    end-on — looking along the beam's length. Mark the extreme fiber (top)
  //    and the neutral axis (mid) in the same colors as the dots on the beam. ──
  const cxR = rx + rw / 2;
  g.appendChild(el('circle', { cx: cxR, cy: ry, r: 4, fill: COLORS.fiber, stroke: COLORS.halo, 'stroke-width': 1.5 }));
  g.appendChild(el('circle', { cx: cxR, cy: ry + rh / 2, r: 4, fill: COLORS.na, stroke: COLORS.halo, 'stroke-width': 1.5 }));
  const lblX = rx + rw + 9;
  g.appendChild(txt(lblX, ry + 3, 'extreme fiber', { anchor: 'start', size: 9, fill: COLORS.fiber }));
  g.appendChild(txt(lblX, ry + rh / 2 + 3, 'neutral axis', { anchor: 'start', size: 9, fill: COLORS.na }));

  // Caption (folds in the not-to-scale note when the aspect is clamped).
  const cap = 'looking along beam axis' + (notToScale ? ' · not to scale' : '');
  g.appendChild(txt(cxR, mT - 11, cap, { anchor: 'middle', size: 9, fill: COLORS.muted }));

  // Axis key: x ⊗ (beam axis, into the page) · y up (depth) · z across (width b).
  const kx = rx + rw + 34, ky = ry + rh - 2;
  g.appendChild(el('circle', { cx: kx, cy: ky, r: 5.5, fill: 'none', stroke: COLORS.ink, 'stroke-width': 1.2 }));
  g.appendChild(el('line', { x1: kx - 3.9, y1: ky - 3.9, x2: kx + 3.9, y2: ky + 3.9, stroke: COLORS.ink, 'stroke-width': 1.2 }));
  g.appendChild(el('line', { x1: kx - 3.9, y1: ky + 3.9, x2: kx + 3.9, y2: ky - 3.9, stroke: COLORS.ink, 'stroke-width': 1.2 }));
  g.appendChild(txt(kx - 9, ky + 3, 'x', { anchor: 'end', size: 9, fill: COLORS.ink }));
  g.appendChild(el('line', { x1: kx, y1: ky - 6, x2: kx, y2: ky - 20, stroke: COLORS.ink, 'stroke-width': 1.2 }));
  arrowTri(g, kx, ky - 20, 'U', COLORS.ink);
  g.appendChild(txt(kx + 5, ky - 15, 'y', { anchor: 'start', size: 9, fill: COLORS.ink }));
  g.appendChild(el('line', { x1: kx + 6, y1: ky, x2: kx + 20, y2: ky, stroke: COLORS.ink, 'stroke-width': 1.2 }));
  arrowTri(g, kx + 20, ky, 'R', COLORS.ink);
  g.appendChild(txt(kx + 14, ky + 13, 'z (b)', { anchor: 'middle', size: 9, fill: COLORS.ink }));

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

  // Caption: driving stress + principals (consolidated from the former readout table;
  // τ_max is the circle's radius, still shown geometrically).
  const fvS = (v) => fmtVal(v, system, 'stress', 3);
  const drive = (pt.tau !== 0 && pt.sigma_x === 0) ? `τ ${fvS(pt.tau)}`
    : (pt.sigma_x !== 0 && pt.tau === 0) ? `σₓ ${fvS(pt.sigma_x)}`
    : `σₓ ${fvS(pt.sigma_x)} · τ ${fvS(pt.tau)}`;
  g.appendChild(txt(cx, h - 6, `${drive} · σ₁/σ₂ ${fvS(pt.s1)} / ${fvS(pt.s2)}`, { size: 10, fill: COLORS.ink }));

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
  g.appendChild(txt(cx, h - 6, `σ_vM ${fmtVal(pt.vM, system, 'stress', 3)} · FoS ${fmtNum(pt.fosVM, 3)} (vM) / ${fmtNum(pt.fosT, 3)} (Tr)`, { size: 10, fill: COLORS.ink }));

  svg.appendChild(g);
}
