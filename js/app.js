// Entry point: single state object, control wiring, hover/pin interaction, and the
// render() orchestrator that redraws every panel on any change. Inputs are stored in
// canonical units (mm, MPa, N, N*mm); conversion happens only at the input/display
// boundary. Working state + a "baseline" design are persisted to localStorage and can
// be shared via a URL hash.

import { computeDerived } from './beam.js';
import { MATERIALS, findMaterial, getUserMaterials, saveUserMaterial } from './materials.js';
import { toCanonical, fromCanonical, unitLabel, fmtVal, fmtNum } from './units.js';
import { COLORS, refreshColors, drawBeam, drawDiagram, drawSection, drawMohr, drawEnvelope } from './plots.js';

const BEAM_PAD_X = 60; // must match padX inside drawBeam for pointer->x mapping

// ───────────────────────── Defaults & State ─────────────────────────
const DEF_MAT = MATERIALS[0]; // Steel (mild, A36)

// Full default payload (the same shape serializeState() produces).
const DEFAULTS = {
  L: 1000, b: 20, h: 40, delta: 2, P: 8192, driveMode: 'delta',
  material: { name: DEF_MAT.name, E: DEF_MAT.E, sigmaY: DEF_MAT.sigmaY },
  unitSystem: 'SI', cutX: null,
};

const state = {
  L: 1000, b: 20, h: 40, delta: 2, P: 8192, // mm / N
  driveMode: 'delta',                        // 'delta' | 'force'
  material: { ...DEF_MAT },                   // E, sigmaY in MPa
  unitSystem: 'SI',
  cut: { xPinned: null, xHover: null },       // mm; eval = pinned ?? hover ?? L/2
};

// Geometry/load sliders. min/max/step and hard bounds are CANONICAL (mm/N); display
// converts. `mode` (when present) ties a control to a drive mode (shown only then).
const NUM_CONTROLS = [
  { key: 'L',     label: 'Length L',              cat: 'length', min: 100, max: 5000, step: 10,  hardMin: 1,   hardMax: 100000 },
  { key: 'b',     label: 'Width b',               cat: 'length', min: 2,   max: 300,  step: 1,   hardMin: 0.1, hardMax: 5000 },
  { key: 'h',     label: 'Height h',              cat: 'length', min: 2,   max: 600,  step: 1,   hardMin: 0.1, hardMax: 5000 },
  { key: 'delta', label: 'Center displacement δ', cat: 'length', min: 0,   max: 20,   step: 0.1, hardMin: 0,   hardMax: 100000, mode: 'delta' },
  { key: 'P',     label: 'Central load P',        cat: 'force',  min: 0,   max: 50000, step: 50, hardMin: 0,   hardMax: 1e8,    mode: 'force' },
];

const STATE_KEY = 'beam-state';
const BASELINE_KEY = 'beam-baseline';

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
const saveMaterialBtn = $('save-material-btn');
const unitToggle = $('unit-toggle');
const driveToggle = $('drive-toggle');
const themeToggle = $('theme-toggle');
const cutStatus = $('cut-status');
const cutNum = $('cut-num');
const unpinBtn = $('unpin-btn');
const saveDesignBtn = $('save-design-btn');
const resetDesignBtn = $('reset-design-btn');
const copyLinkBtn = $('copy-link-btn');
const designHint = $('design-hint');
const fosValue = $('fos-value');
const fosState = $('fos-state');
const readouts = $('readouts');
const naSub = $('na-sub');
const fiberSub = $('fiber-sub');

const DESIGN_HINT_DEFAULT = designHint ? designHint.textContent : '';

const numCtrls = []; // {key, cat, min, max, hardMin, hardMax, range, num, marker, miniReset, tickMin, tickMax, el}
let userMaterials = [];      // user-saved presets (localStorage)
let baselineDesign = null;   // design payload to snap back to
let baselineStr = '';        // JSON of baselineDesign, for dirty comparison
let loading = false;         // suppress commit() while applying state programmatically

const inputStr = (v) => String(+Number(v).toFixed(4));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundCanon = (v) => (isFinite(v) ? Number(Number(v).toPrecision(9)) : v);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────────────────────── Serialization ─────────────────────────
// Design subset (no display prefs) — what Save/Reset and dirty checks use.
function designPayload() {
  return {
    L: roundCanon(state.L), b: roundCanon(state.b), h: roundCanon(state.h),
    delta: roundCanon(state.delta), P: roundCanon(state.P),
    driveMode: state.driveMode,
    material: { name: state.material.name, E: roundCanon(state.material.E), sigmaY: roundCanon(state.material.sigmaY) },
    cutX: state.cut.xPinned == null ? null : roundCanon(state.cut.xPinned),
  };
}
// Full working snapshot — persisted and shared (adds display prefs).
function statePayload() {
  return { ...designPayload(), unitSystem: state.unitSystem };
}
function defaultDesignPayload() {
  return {
    L: roundCanon(DEFAULTS.L), b: roundCanon(DEFAULTS.b), h: roundCanon(DEFAULTS.h),
    delta: roundCanon(DEFAULTS.delta), P: roundCanon(DEFAULTS.P),
    driveMode: DEFAULTS.driveMode,
    material: { name: DEF_MAT.name, E: roundCanon(DEF_MAT.E), sigmaY: roundCanon(DEF_MAT.sigmaY) },
    cutX: null,
  };
}

// Resolve a material payload {name,E,sigmaY} into a usable material. Honors the actual
// E/σY (physics); shows a preset name only if its values still match, else "Custom".
function materialFromPayload(m) {
  if (!m || !isFinite(m.E) || !isFinite(m.sigmaY)) return { ...DEF_MAT };
  const E = m.E > 0 ? m.E : DEF_MAT.E;
  const sigmaY = m.sigmaY > 0 ? m.sigmaY : DEF_MAT.sigmaY;
  const known = findMaterialMerged(m.name);
  if (known && !known.custom && roundCanon(known.E) === roundCanon(E) && roundCanon(known.sigmaY) === roundCanon(sigmaY)) {
    return { ...known };
  }
  return { name: 'Custom', E, sigmaY, nu: known && isFinite(known.nu) ? known.nu : DEF_MAT.nu };
}

// ───────────────────────── Apply state ─────────────────────────
function applyState(p) {
  if (!p || typeof p !== 'object') return;
  loading = true;
  const pick = (v, d) => (isFinite(v) ? v : d);

  state.unitSystem = p.unitSystem === 'imperial' ? 'imperial' : (p.unitSystem === 'SI' ? 'SI' : state.unitSystem);
  state.driveMode = p.driveMode === 'force' ? 'force' : 'delta';
  state.material = materialFromPayload(p.material);
  state.cut.xPinned = isFinite(p.cutX) ? p.cutX : null;
  state.cut.xHover = null;

  refreshUnitToggleUI();
  refreshDriveToggleUI();
  updateDriveVisibility();
  for (const ctl of numCtrls) setControlValue(ctl, pick(p[ctl.key], DEFAULTS[ctl.key]));

  materialSelect.value = findMaterialMerged(state.material.name) ? state.material.name : 'Custom';
  refreshMaterialInputs();
  updateSaveMaterialBtn();
  refreshUnitDisplays();
  loading = false;
}

// ───────────────────────── Persistence & dirty UI ─────────────────────────
let persistTimer = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 300);
}
function persistNow() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  try { localStorage.setItem(STATE_KEY, JSON.stringify(statePayload())); } catch { /* storage off */ }
}
function readJSON(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
}

function commit() {
  if (loading) return;
  refreshDirtyUI();
  schedulePersist();
}
// Called by every explicit input handler: redraw + persist + dirty UI.
function onInput() { scheduleRender(); commit(); }

function setBaseline(design) {
  baselineDesign = design;
  baselineStr = JSON.stringify(design);
  try { localStorage.setItem(BASELINE_KEY, baselineStr); } catch { /* storage off */ }
}

function refreshDirtyUI() {
  const dirty = JSON.stringify(designPayload()) !== baselineStr;
  resetDesignBtn.disabled = !dirty;
  for (const ctl of numCtrls) {
    const base = baselineDesign ? baselineDesign[ctl.key] : state[ctl.key];
    ctl.miniReset.hidden = roundCanon(state[ctl.key]) === roundCanon(base);
    positionMarker(ctl);
  }
}

// ───────────────────────── Slider value plumbing ─────────────────────────
function expandRangeIfNeeded(ctl, v) {
  let changed = false;
  if (v < +ctl.range.min) { ctl.range.min = Math.max(ctl.hardMin, v); changed = true; }
  if (v > +ctl.range.max) { ctl.range.max = Math.min(ctl.hardMax, v); changed = true; }
  if (changed) updateTicks(ctl);
}
// The single path for writing any slider value (handlers, toggle transfer, applyState).
function setControlValue(ctl, canonical) {
  const v = clamp(canonical, ctl.hardMin, ctl.hardMax);
  expandRangeIfNeeded(ctl, v);
  state[ctl.key] = v;
  ctl.range.value = v;
  if (document.activeElement !== ctl.num) {
    ctl.num.value = inputStr(fromCanonical(v, state.unitSystem, ctl.cat));
  }
  positionMarker(ctl);
}
function positionMarker(ctl) {
  const base = baselineDesign ? baselineDesign[ctl.key] : state[ctl.key];
  const min = +ctl.range.min, max = +ctl.range.max;
  const frac = max > min ? (base - min) / (max - min) : 0;
  ctl.marker.style.left = clamp(frac, 0, 1) * 100 + '%';
}
function updateTicks(ctl) {
  ctl.tickMin.textContent = inputStr(fromCanonical(+ctl.range.min, state.unitSystem, ctl.cat));
  ctl.tickMax.textContent = inputStr(fromCanonical(+ctl.range.max, state.unitSystem, ctl.cat));
}
function resetControl(ctl) {
  if (!baselineDesign) return;
  setControlValue(ctl, baselineDesign[ctl.key]);
  onInput();
}

// ───────────────────────── Build controls ─────────────────────────
function buildNumControls() {
  const host = $('geometry-controls');
  for (const cfg of NUM_CONTROLS) {
    const wrap = document.createElement('div');
    wrap.className = 'num-ctrl';
    const v0 = clamp(state[cfg.key], cfg.min, cfg.max);
    wrap.innerHTML = `
      <div class="num-head">
        <label>${cfg.label} (<span data-unit-label="${cfg.cat}">${unitLabel(state.unitSystem, cfg.cat)}</span>)</label>
        <button type="button" class="mini-reset" title="Reset to baseline" aria-label="Reset ${cfg.label} to baseline" hidden>↺</button>
      </div>
      <div class="slider-wrap">
        <input type="range" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${v0}" aria-label="${cfg.label}" />
        <span class="slider-marker" aria-hidden="true"></span>
      </div>
      <input type="number" step="any" value="${inputStr(fromCanonical(state[cfg.key], state.unitSystem, cfg.cat))}" aria-label="${cfg.label} value" />
      <div class="slider-ticks"><span class="tick-min"></span><span class="tick-max"></span></div>`;
    host.appendChild(wrap);

    const ctl = {
      ...cfg, el: wrap,
      range: wrap.querySelector('input[type="range"]'),
      num: wrap.querySelector('input[type="number"]'),
      marker: wrap.querySelector('.slider-marker'),
      miniReset: wrap.querySelector('.mini-reset'),
      tickMin: wrap.querySelector('.tick-min'),
      tickMax: wrap.querySelector('.tick-max'),
    };
    numCtrls.push(ctl);
    updateTicks(ctl);
    positionMarker(ctl);

    ctl.range.addEventListener('input', () => {
      state[cfg.key] = parseFloat(ctl.range.value); // already within element min/max
      if (document.activeElement !== ctl.num) ctl.num.value = inputStr(fromCanonical(state[cfg.key], state.unitSystem, cfg.cat));
      positionMarker(ctl);
      onInput();
    });
    // Shift+Arrow = coarse nudge (~10x step); plain arrows use the native step.
    ctl.range.addEventListener('keydown', (e) => {
      if (!e.shiftKey) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { setControlValue(ctl, state[cfg.key] + cfg.step * 10); onInput(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { setControlValue(ctl, state[cfg.key] - cfg.step * 10); onInput(); e.preventDefault(); }
    });
    ctl.range.addEventListener('dblclick', () => resetControl(ctl));

    ctl.num.addEventListener('input', () => {
      const disp = parseFloat(ctl.num.value);
      if (!isFinite(disp)) return; // allow mid-typing / empty
      setControlValue(ctl, toCanonical(disp, state.unitSystem, cfg.cat));
      onInput();
    });
    ctl.num.addEventListener('change', () => {
      ctl.num.value = inputStr(fromCanonical(state[cfg.key], state.unitSystem, cfg.cat));
    });
    ctl.miniReset.addEventListener('click', () => resetControl(ctl));
  }
}

// ───────────────────────── Drive-mode toggle ─────────────────────────
function buildDriveToggle() {
  driveToggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.drive;
      if (mode === state.driveMode) return;
      // Carry the derived value over (computed under the OLD mode) so the beam doesn't jump.
      const d = computeDerived(state);
      if (mode === 'force') state.P = d.P; else state.delta = d.delta;
      state.driveMode = mode;
      refreshDriveToggleUI();
      updateDriveVisibility();
      const ctl = numCtrls.find((c) => c.key === (mode === 'force' ? 'P' : 'delta'));
      if (ctl) setControlValue(ctl, state[ctl.key]); // expands range if the carried value needs it
      onInput();
    });
  });
}
function refreshDriveToggleUI() {
  driveToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.drive === state.driveMode));
}
function updateDriveVisibility() {
  for (const ctl of numCtrls) {
    if (!ctl.mode) continue;
    ctl.el.hidden = ctl.mode !== state.driveMode;
  }
}

// ───────────────────────── Materials ─────────────────────────
function allMaterials() {
  const builtins = MATERIALS.filter((m) => !m.custom);
  const custom = MATERIALS.find((m) => m.custom);
  return [...builtins, ...userMaterials, custom];
}
function findMaterialMerged(name) {
  return allMaterials().find((m) => m.name === name);
}
function optHtml(m) { return `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`; }
function rebuildMaterialOptions() {
  const builtins = MATERIALS.filter((m) => !m.custom);
  const custom = MATERIALS.find((m) => m.custom);
  let html = `<optgroup label="Presets">${builtins.map(optHtml).join('')}</optgroup>`;
  if (userMaterials.length) html += `<optgroup label="My materials">${userMaterials.map(optHtml).join('')}</optgroup>`;
  html += optHtml(custom);
  materialSelect.innerHTML = html;
}

function buildMaterials() {
  userMaterials = getUserMaterials();
  rebuildMaterialOptions();
  materialSelect.value = state.material.name;
  refreshMaterialInputs();
  updateSaveMaterialBtn();

  materialSelect.addEventListener('change', () => {
    const m = findMaterialMerged(materialSelect.value);
    if (m && !m.custom) state.material = { ...m };
    else state.material = { ...state.material, name: 'Custom' };
    refreshMaterialInputs();
    updateSaveMaterialBtn();
    onInput();
  });

  const setCustom = () => {
    state.material.name = 'Custom';
    materialSelect.value = 'Custom';
    updateSaveMaterialBtn();
  };
  ENum.addEventListener('input', () => {
    const v = parseFloat(ENum.value);
    if (!isFinite(v) || v <= 0) return;
    state.material.E = toCanonical(v, state.unitSystem, 'modulus');
    setCustom();
    onInput();
  });
  sigmaYNum.addEventListener('input', () => {
    const v = parseFloat(sigmaYNum.value);
    if (!isFinite(v) || v <= 0) return;
    state.material.sigmaY = toCanonical(v, state.unitSystem, 'stress');
    setCustom();
    onInput();
  });
  saveMaterialBtn.addEventListener('click', onSaveMaterial);
}

function onSaveMaterial() {
  const name = (window.prompt('Save current material as:', '') || '').trim();
  if (!name) return;
  if (name.toLowerCase() === 'custom') { window.alert('"Custom" is reserved — pick another name.'); return; }
  const exists = MATERIALS.some((m) => m.name === name) || userMaterials.some((m) => m.name === name);
  if (exists && !window.confirm(`"${name}" already exists. Overwrite it?`)) return;
  userMaterials = saveUserMaterial({ name, E: state.material.E, sigmaY: state.material.sigmaY, nu: state.material.nu ?? 0.3 });
  state.material = { name, E: state.material.E, sigmaY: state.material.sigmaY, nu: state.material.nu ?? 0.3 };
  rebuildMaterialOptions();
  materialSelect.value = name;
  refreshMaterialInputs();
  updateSaveMaterialBtn();
  onInput();
}
function updateSaveMaterialBtn() {
  saveMaterialBtn.hidden = state.material.name !== 'Custom';
}
function refreshMaterialInputs() {
  if (document.activeElement !== ENum) ENum.value = inputStr(fromCanonical(state.material.E, state.unitSystem, 'modulus'));
  if (document.activeElement !== sigmaYNum) sigmaYNum.value = inputStr(fromCanonical(state.material.sigmaY, state.unitSystem, 'stress'));
}

// ───────────────────────── Unit toggle ─────────────────────────
function buildUnitToggle() {
  unitToggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const u = btn.dataset.unit;
      if (u === state.unitSystem) return;
      state.unitSystem = u;
      refreshUnitToggleUI();
      refreshUnitDisplays();
      onInput();
    });
  });
}
function refreshUnitToggleUI() {
  unitToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.unit === state.unitSystem));
}
function refreshUnitDisplays() {
  document.querySelectorAll('[data-unit-label]').forEach((sp) => {
    sp.textContent = unitLabel(state.unitSystem, sp.dataset.unitLabel);
  });
  for (const c of numCtrls) {
    if (document.activeElement !== c.num) c.num.value = inputStr(fromCanonical(state[c.key], state.unitSystem, c.cat));
    updateTicks(c);
  }
  refreshMaterialInputs();
  if (document.activeElement !== cutNum) cutNum.value = inputStr(fromCanonical(state.cut.xPinned ?? state.L / 2, state.unitSystem, 'length'));
}

// ───────────────────────── Theme ─────────────────────────
const THEME_KEY = 'beam-theme';
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (themeToggle) themeToggle.textContent = theme === 'dark' ? '☀' : '🌙';
}
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved ?? (prefersDark.matches ? 'dark' : 'light'));
}
function wireThemeToggle() {
  if (!themeToggle) return;
  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    refreshColors();
    scheduleRender();
  });
  prefersDark.addEventListener('change', (e) => {
    if (localStorage.getItem(THEME_KEY)) return;
    applyTheme(e.matches ? 'dark' : 'light');
    refreshColors();
    scheduleRender();
  });
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
    onInput();
  });
  beamSvg.addEventListener('keydown', onBeamKey);
  unpinBtn.addEventListener('click', () => {
    state.cut.xPinned = null;
    onInput();
  });
}
function onBeamKey(e) {
  const L = state.L;
  const cur = state.cut.xPinned ?? state.cut.xHover ?? L / 2;
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
  if (handled) { e.preventDefault(); onInput(); }
}
function wireCutBox() {
  cutNum.addEventListener('input', () => {
    const disp = parseFloat(cutNum.value);
    if (!isFinite(disp)) return;
    state.cut.xPinned = clamp(toCanonical(disp, state.unitSystem, 'length'), 0, state.L);
    onInput();
  });
  cutNum.addEventListener('change', () => {
    cutNum.value = inputStr(fromCanonical(state.cut.xPinned ?? state.L / 2, state.unitSystem, 'length'));
  });
}
function updateCutUI() {
  const pinned = state.cut.xPinned != null;
  unpinBtn.disabled = !pinned;
  cutStatus.textContent = pinned
    ? `Pinned at x = ${fmtVal(state.cut.xPinned, state.unitSystem, 'length', 3)}. Change variables to watch this section respond.`
    : 'Hover the beam to move the cut; click to pin.';
  if (document.activeElement !== cutNum) {
    cutNum.value = inputStr(fromCanonical(state.cut.xPinned ?? state.L / 2, state.unitSystem, 'length'));
  }
  beamSvg.setAttribute('aria-valuemax', Math.round(state.L));
  beamSvg.setAttribute('aria-valuenow', Math.round(state.cut.xPinned ?? state.cut.xHover ?? state.L / 2));
}

// ───────────────────────── Design toolbar ─────────────────────────
let hintTimer = null;
function flashHint(msg) {
  if (!designHint) return;
  designHint.textContent = msg;
  designHint.classList.add('copied');
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    designHint.textContent = DESIGN_HINT_DEFAULT;
    designHint.classList.remove('copied');
  }, 1800);
}
function buildDesignToolbar() {
  saveDesignBtn.addEventListener('click', () => {
    setBaseline(designPayload());
    refreshDirtyUI();
    flashHint('Saved as your baseline.');
  });
  resetDesignBtn.addEventListener('click', () => {
    if (!baselineDesign) return;
    applyState(baselineDesign); // baseline has no unitSystem, so units/theme are untouched
    scheduleRender();
    refreshDirtyUI();
    persistNow();
    flashHint('Reset to baseline.');
  });
  copyLinkBtn.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#d=${encodeURIComponent(JSON.stringify(statePayload()))}`;
    try {
      await navigator.clipboard.writeText(url);
      flashHint('Link copied to clipboard!');
    } catch {
      window.prompt('Copy this shareable link:', url);
    }
  });
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
      stat('Center displacement δ', fv(d.delta, 'length')) +
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
function readHash() {
  const m = location.hash.match(/(?:^#|[#&])d=([^&]+)/);
  if (!m) return null;
  let obj = null;
  try { obj = JSON.parse(decodeURIComponent(m[1])); } catch { obj = null; }
  // Strip the payload so later edits persist and reloads use localStorage (even if invalid).
  history.replaceState(null, '', location.pathname + location.search);
  return obj && typeof obj === 'object' ? obj : null;
}

function init() {
  initTheme();
  refreshColors();        // populate COLORS from CSS vars before the first draw
  wireThemeToggle();
  buildNumControls();
  buildDriveToggle();
  buildMaterials();
  buildUnitToggle();
  buildDesignToolbar();
  wireCutBox();
  wireBeam();

  // Load precedence: share-link hash > saved working state > defaults.
  const hashState = readHash();
  if (hashState) {
    applyState(hashState);
    setBaseline(designPayload());           // a shared link is the design you snap back to
  } else {
    applyState(readJSON(STATE_KEY) || DEFAULTS);
    const savedBaseline = readJSON(BASELINE_KEY);
    if (savedBaseline && typeof savedBaseline === 'object') setBaseline(savedBaseline);
    else setBaseline(defaultDesignPayload());
  }
  refreshDirtyUI();

  // Redraw on container resize (SVGs are sized in CSS px).
  const ro = new ResizeObserver(() => scheduleRender());
  ro.observe(document.querySelector('.content'));
  window.addEventListener('resize', scheduleRender);
  window.addEventListener('pagehide', persistNow); // flush any debounced write

  scheduleRender();
}

init();
