// Material presets. E and sigmaY are in canonical units (MPa).
// nu (Poisson's ratio) is stored for possible future 3D work; the plane-stress
// yield math here does not use it. Values are representative handbook figures
// (room-temperature, typical tempers) and are meant for exploration, not design sign-off.
export const MATERIALS = [
  { name: 'Steel (mild, A36)',     E: 200000, sigmaY: 250, nu: 0.30 },
  { name: 'Steel (4140, norm.)',   E: 205000, sigmaY: 655, nu: 0.29 },
  { name: 'Stainless 304',         E: 193000, sigmaY: 215, nu: 0.29 },
  { name: 'Aluminum 6061-T6',      E: 69000,  sigmaY: 276, nu: 0.33 },
  { name: 'Aluminum 7075-T6',      E: 71700,  sigmaY: 503, nu: 0.33 },
  { name: 'Titanium Ti-6Al-4V',    E: 114000, sigmaY: 880, nu: 0.34 },
  { name: 'Magnesium AZ31B',       E: 45000,  sigmaY: 200, nu: 0.35 },
  { name: 'Brass C360',            E: 97000,  sigmaY: 310, nu: 0.31 },
  { name: 'Copper (annealed)',     E: 117000, sigmaY: 70,  nu: 0.34 },
  { name: 'Polycarbonate',         E: 2300,   sigmaY: 62,  nu: 0.37 },
  { name: 'Custom',                E: 200000, sigmaY: 250, nu: 0.30, custom: true },
];

export function findMaterial(name) {
  return MATERIALS.find((m) => m.name === name);
}

// ───────────────── User-saved materials (localStorage) ─────────────────
const USER_KEY = 'beam-materials';

// Returns the user's saved materials (each {name, E, sigmaY, nu}), or [] if none /
// storage is unavailable. Defensive against corrupt payloads.
export function getUserMaterials() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (m) => m && typeof m.name === 'string' && isFinite(m.E) && m.E > 0 && isFinite(m.sigmaY),
    );
  } catch {
    return [];
  }
}

// Save (or replace, by name) a user material. Returns the updated list.
export function saveUserMaterial(mat) {
  const clean = { name: mat.name, E: +mat.E, sigmaY: +mat.sigmaY, nu: isFinite(mat.nu) ? +mat.nu : 0.3 };
  const list = getUserMaterials().filter((m) => m.name !== clean.name);
  list.push(clean);
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: keep the in-memory list only */
  }
  return list;
}
