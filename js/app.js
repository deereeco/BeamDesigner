// Entry point: single state object, control wiring, hover/pin interaction, and the
// render() orchestrator that redraws every panel on any change.

import { computeDerived } from './beam.js';
import { MATERIALS, findMaterial } from './materials.js';
import { toCanonical, fromCanonical, unitLabel, fmtVal, fmtNum } from './units.js';
import { COLORS, drawBeam, drawDiagram, drawSection, drawMohr, drawEnvelope } from './plots.js';

const BEAM_PAD_X = 60; // must match padX inside drawBeam for pointer->x mapping

// ───────────────────────── State ─────────────────────────
const state = {
  L: 1000, b: 20, h: 40, delta: 2,         // mm
  material: { ...MATERIALS[0] },            // E, sigmaY in MPa
  unitSystem: 'SI',
  cut: { xPinned: null, xHover: null },     // mm; eval = pinned ?? hover ?? L/2
};

// Geometry/load sliders. min/max/step are CANONICAL (mm); display converts.
const NUM_CONTROLS = [
  { key: 'L', label: 'Length L', cat: 'length', min: 100, max: 5000, step: 10 },
  { key: 'b', label: 'Width b', cat: 'length', min: 2, max: 300, step: 1 },
  { key: 'h', label: 'Height h', cat: 'length', min: 2, max: 600, step: 1 },
  { key: 'delta', label: 'Center displacement δ', cat: 'length', min: 0, max: 20, step: 0.1 },
];

// ───────────────────────── DOM refs ─────────────────────────
const $ = (id) => document.getElementById(id);
const beamSvg = $('beam-svg');
const shearSvg = $('shear-svg');
const momentSvg = $('moment-svg');
const sectionSvg = $('section-svg');
const mohrNaSvg = $('mohr-na-svg');
const envNaSvg = $('env-na-svg');
const mohrFiberSvg = $('mohr-fiber-svg');
const envFiberSvg = $('env-fiber-svg');
const materialSelect = $('material-select');
const ENum = $('E-num');
const sigmaYNum = $('sigmaY-num');
const unitToggle = $('unit-toggle');
const cutStatus = $('cut-status');
const unpinBtn = $('unpin-btn');
const fosValue = $('fos-value');
const fosState = $('fos-state');
const readouts = $('readouts');
const naSub = $('na-sub');
const fiberSub = $('fiber-sub');

const numCtrls = []; // {key, cat, min, max, range, num}

const inputStr = (v) => String(+Number(v).toFixed(4));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ───────────────────────── Build controls ─────────────────────────
function buildNumControls() {
  const host = $('geometry-controls');
  for (const cfg of NUM_CONTROLS) {
    const wrap = document.createElement('div');
    wrap.className = 'num-ctrl';
    wrap.innerHTML = `
      <label>${cfg.label} (<span data-unit-label="${cfg.cat}">${unitLabel(state.unitSystem, cfg.cat)}</span>)</label>
      <div class="num-line">
        <input type="range" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${state[cfg.key]}" aria-label="${cfg.label}" />
        <input type="number" step="any" value="${inputStr(fromCanonical(state[cfg.key], state.unitSystem, cfg.cat))}" aria-label="${cfg.label} value" />
      </div>`;
    host.appendChild(wrap);
    const range = wrap.querySelector('input[type="range"]');
    const num = wrap.querySelector('input[type="number"]');
    const ctl = { ...cfg, range, num };
    numCtrls.push(ctl);

    range.addEventListener('input', () => {
      state[cfg.key] = clamp(parseFloat(range.value), cfg.min, cfg.max);
      num.value = inputStr(fromCanonical(state[cfg.key], state.unitSystem, cfg.cat));
      scheduleRender();
    });
    num.addEventListener('input', () => {
      const disp = parseFloat(num.value);
      if (!isFinite(disp)) return; // allow mid-typing / empty
      state[cfg.key] = clamp(toCanonical(disp, state.unitSystem, cfg.cat), cfg.min, cfg.max);
      range.value = state[cfg.key];
      scheduleRender();
    });
    num.addEventListener('change', () => {
      num.value = inputStr(fromCanonical(state[cfg.key], state.unitSystem, cfg.cat));
    });
  }
}

function buildMaterials() {
  materialSelect.innerHTML = MATERIALS.map((m) => `<option value="${m.name}">${m.name}</option>`).join('');
  materialSelect.value = state.material.name;
  refreshMaterialInputs();

  materialSelect.addEventListener('change', () => {
    const m = findMaterial(materialSelect.value);
    if (m && !m.custom) {
      state.material = { ...m };
    } else {
      state.material = { ...state.material, name: 'Custom' };
    }
    refreshMaterialInputs();
    scheduleRender();
  });

  const setCustom = () => {
    state.material.name = 'Custom';
    materialSelect.value = 'Custom';
  };
  ENum.addEventListener('input', () => {
    const v = parseFloat(ENum.value);
    if (!isFinite(v) || v <= 0) return;
    state.material.E = toCanonical(v, state.unitSystem, 'modulus');
    setCustom();
    scheduleRender();
  });
  sigmaYNum.addEventListener('input', () => {
    const v = parseFloat(sigmaYNum.value);
    if (!isFinite(v) || v <= 0) return;
    state.material.sigmaY = toCanonical(v, state.unitSystem, 'stress');
    setCustom();
    scheduleRender();
  });
}

function refreshMaterialInputs() {
  ENum.value = inputStr(fromCanonical(state.material.E, state.unitSystem, 'modulus'));
  sigmaYNum.value = inputStr(fromCanonical(state.material.sigmaY, state.unitSystem, 'stress'));
}

// ───────────────────────── Unit toggle ─────────────────────────
function buildUnitToggle() {
  unitToggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const u = btn.dataset.unit;
      if (u === state.unitSystem) return;
      state.unitSystem = u;
      unitToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      refreshUnitDisplays();
      scheduleRender();
    });
  });
}

function refreshUnitDisplays() {
  document.querySelectorAll('[data-unit-label]').forEach((sp) => {
    sp.textContent = unitLabel(state.unitSystem, sp.dataset.unitLabel);
  });
  for (const c of numCtrls) c.num.value = inputStr(fromCanonical(state[c.key], state.unitSystem, c.cat));
  refreshMaterialInputs();
}

// ───────────────────────── Cut interaction ─────────────────────────
function beamXFromEvent(evt) {
  const rect = beamSvg.getBoundingClientRect();
  const x0 = BEAM_PAD_X, x1 = rect.width - BEAM_PAD_X;
  const px = evt.clientX - rect.left;
  const frac = clamp((px - x0) / Math.max(1, x1 - x0), 0, 1);
  return frac * state.L;
}

function wireBeam() {
  beamSvg.addEventListener('pointermove', (e) => {
    state.cut.xHover = beamXFromEvent(e);
    scheduleRender();
  });
  beamSvg.addEventListener('pointerleave', () => {
    state.cut.xHover = null;
    scheduleRender();
  });
  beamSvg.addEventListener('click', (e) => {
    state.cut.xPinned = beamXFromEvent(e);
    state.cut.xHover = state.cut.xPinned;
    scheduleRender();
  });
  beamSvg.addEventListener('keydown', onBeamKey);
  unpinBtn.addEventListener('click', () => {
    state.cut.xPinned = null;
    scheduleRender();
  });
}

function onBeamKey(e) {
  const L = state.L;
  let cur = state.cut.xPinned ?? state.cut.xHover ?? L / 2;
  let handled = true;
  switch (e.key) {
    case 'ArrowLeft': state.cut.xPinned = clamp(cur - (e.shiftKey ? L / 20 : L / 100), 0, L); break;
    case 'ArrowRight': state.cut.xPinned = clamp(cur + (e.shiftKey ? L / 20 : L / 100), 0, L); break;
    case 'Home': state.cut.xPinned = 0; break;
    case 'End': state.cut.xPinned = L; break;
    case 'Enter': case ' ':
      state.cut.xPinned = state.cut.xPinned != null ? null : cur; break;
    case 'Escape': state.cut.xPinned = null; break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); scheduleRender(); }
}

function updateCutUI() {
  const pinned = state.cut.xPinned != null;
  unpinBtn.disabled = !pinned;
  cutStatus.textContent = pinned
    ? `Pinned at x = ${fmtVal(state.cut.xPinned, state.unitSystem, 'length', 3)}. Change variables to watch this section respond.`
    : 'Hover the beam to move the cut; click to pin.';
  beamSvg.setAttribute('aria-valuemax', Math.round(state.L));
  beamSvg.setAttribute('aria-valuenow', Math.round(state.cut.xPinned ?? state.cut.xHover ?? state.L / 2));
}

// ───────────────────────── Readouts ─────────────────────────
function updateReadouts(d) {
  const s = state.unitSystem;
  const fv = (v, cat) => fmtVal(v, s, cat, 3);
  const stat = (l, v) => `<div class="stat"><span>${l}</span><span>${v}</span></div>`;
  const block = (title, cls, inner) => `<div class="readout-block ${cls}"><h4>${title}</h4>${inner}</div>`;
  readouts.innerHTML =
    block('Loading &amp; reactions', '',
      stat('Central load P', fv(d.P, 'force')) +
      stat('Wall reaction R', fv(d.R, 'force')) +
      stat('|M| wall = center', fv(d.Mwall, 'moment'))) +
    block('At cut', '',
      stat('x', fv(d.xEval, 'length')) +
      stat('M(x)', fv(d.Mx, 'moment')) +
      stat('V(x)', fv(d.Vx, 'force'))) +
    block('Neutral axis (shear)', 'na',
      stat('τ', fv(d.pointNA.tau, 'stress')) +
      stat('σ₁ / σ₂', `${fv(d.pointNA.s1, 'stress')} / ${fv(d.pointNA.s2, 'stress')}`) +
      stat('σ_vM', fv(d.pointNA.vM, 'stress')) +
      stat('FoS vM / Tr', `${fmtNum(d.pointNA.fosVM, 3)} / ${fmtNum(d.pointNA.fosT, 3)}`)) +
    block('Extreme fiber (bending)', 'fiber',
      stat('σₓ', fv(d.pointFiber.sigma_x, 'stress')) +
      stat('σ₁ / σ₂', `${fv(d.pointFiber.s1, 'stress')} / ${fv(d.pointFiber.s2, 'stress')}`) +
      stat('σ_vM', fv(d.pointFiber.vM, 'stress')) +
      stat('FoS vM / Tr', `${fmtNum(d.pointFiber.fosVM, 3)} / ${fmtNum(d.pointFiber.fosT, 3)}`));
}

function updateFoS(d) {
  const f = d.globalFoS;
  fosValue.textContent = isFinite(f) ? fmtNum(f, 3) : '∞';
  let label, color;
  if (!isFinite(f) || f >= 1.5) { label = 'Safe'; color = COLORS.safe; }
  else if (f >= 1) { label = 'Near yield'; color = COLORS.warn; }
  else { label = 'Yielding'; color = COLORS.danger; }
  fosValue.style.color = color;
  fosState.textContent = label;
  fosState.style.color = color;
}

function updateSubs(d) {
  const s = state.unitSystem;
  naSub.textContent = `σ = 0, τ = ${fmtVal(d.pointNA.tau, s, 'stress', 3)}`;
  fiberSub.textContent = `σ = ${fmtVal(d.pointFiber.sigma_x, s, 'stress', 3)}, τ = 0`;
}

// ───────────────────────── Render ─────────────────────────
let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

function render() {
  // Keep the cut within the (possibly changed) beam length.
  if (state.cut.xPinned != null) state.cut.xPinned = clamp(state.cut.xPinned, 0, state.L);
  if (state.cut.xHover != null) state.cut.xHover = clamp(state.cut.xHover, 0, state.L);

  const d = computeDerived(state);
  const sys = state.unitSystem;

  drawBeam(beamSvg, state, d, sys);
  drawDiagram(shearSvg, d, 'V', sys);
  drawDiagram(momentSvg, d, 'M', sys);
  drawSection(sectionSvg, d, sys);
  drawMohr(mohrNaSvg, d.pointNA, d.sigmaY, COLORS.na, sys);
  drawEnvelope(envNaSvg, d.pointNA, d.sigmaY, sys);
  drawMohr(mohrFiberSvg, d.pointFiber, d.sigmaY, COLORS.fiber, sys);
  drawEnvelope(envFiberSvg, d.pointFiber, d.sigmaY, sys);

  updateReadouts(d);
  updateFoS(d);
  updateSubs(d);
  updateCutUI();
}

// ───────────────────────── Init ─────────────────────────
function init() {
  buildNumControls();
  buildMaterials();
  buildUnitToggle();
  wireBeam();

  // Redraw on container resize (SVGs are sized in CSS px).
  const ro = new ResizeObserver(() => scheduleRender());
  ro.observe(document.querySelector('.content'));
  window.addEventListener('resize', scheduleRender);

  scheduleRender();
}

init();
