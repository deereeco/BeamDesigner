// Material presets. E and sigmaY are in canonical units (MPa).
// nu (Poisson's ratio) is stored for possible future 3D work; the plane-stress
// yield math here does not use it.
export const MATERIALS = [
  { name: 'Steel (mild, A36)',   E: 200000, sigmaY: 250, nu: 0.30 },
  { name: 'Aluminum 6061-T6',    E: 69000,  sigmaY: 276, nu: 0.33 },
  { name: 'Titanium Ti-6Al-4V',  E: 114000, sigmaY: 880, nu: 0.34 },
  { name: 'Custom',              E: 200000, sigmaY: 250, nu: 0.30, custom: true },
];

export function findMaterial(name) {
  return MATERIALS.find((m) => m.name === name);
}
