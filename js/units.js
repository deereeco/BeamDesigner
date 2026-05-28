// Unit systems and conversion.
// Canonical internal units: length = mm, force = N, stress = MPa (= N/mm^2),
// moment = N*mm. All physics in beam.js uses canonical units exclusively;
// conversions happen only here, at the input/display boundary.

// `perUnit` = how many CANONICAL units are in ONE display unit.
//   toCanonical(displayValue)   = displayValue * perUnit
//   fromCanonical(canonical)    = canonical / perUnit
export const UNIT_SYSTEMS = {
  SI: {
    name: 'SI',
    length:  { label: 'mm',   perUnit: 1 },
    force:   { label: 'N',    perUnit: 1 },
    stress:  { label: 'MPa',  perUnit: 1 },
    modulus: { label: 'GPa',  perUnit: 1000 },          // 1 GPa = 1000 MPa
    moment:  { label: 'N·m', perUnit: 1000 },      // 1 N*m  = 1000 N*mm
  },
  imperial: {
    name: 'Imperial',
    length:  { label: 'in',   perUnit: 25.4 },
    force:   { label: 'lbf',  perUnit: 4.4482216153 },
    stress:  { label: 'ksi',  perUnit: 6.8947572932 },  // 1 ksi = 6.8948 MPa
    modulus: { label: 'Msi',  perUnit: 6894.7572932 },  // 1 Msi = 1e6 psi
    moment:  { label: 'lbf·in', perUnit: 112.984829 }, // 4.4482216*25.4
  },
};

export function unitLabel(system, cat) {
  return UNIT_SYSTEMS[system][cat].label;
}

export function toCanonical(displayValue, system, cat) {
  return displayValue * UNIT_SYSTEMS[system][cat].perUnit;
}

export function fromCanonical(canonicalValue, system, cat) {
  return canonicalValue / UNIT_SYSTEMS[system][cat].perUnit;
}

// Format a plain number to ~`sig` significant figures without trailing noise.
export function fmtNum(v, sig = 4) {
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '-∞';
  if (!isFinite(v)) return '—';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e6 || abs < 1e-3) return v.toExponential(2);
  const decimals = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
  return v.toFixed(Math.min(decimals, 6));
}

// Format a canonical value into a display string "<value> <unit>".
export function fmtVal(canonicalValue, system, cat, sig = 4) {
  const v = fromCanonical(canonicalValue, system, cat);
  return `${fmtNum(v, sig)} ${unitLabel(system, cat)}`;
}
