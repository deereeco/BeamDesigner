// Pure mechanics for prismatic beams in two support conditions, driven either by a
// prescribed displacement delta or by an applied point load P. All quantities in canonical
// units (mm, N, MPa, N*mm). No UI, no unit conversion here.
//
//   BEAM_MODELS keys:
//     'fixed-fixed' — clamped at both ends, central point load; delta at the center.
//     'cantilever'  — clamped at the left wall (x=0), free at x=L, point load at the free
//                     tip; delta at the tip.
//   Both link load <-> displacement by  delta = P*L^3 / (C*E*I)  with C = stiffnessC
//   (192 for fixed-fixed, 3 for the cantilever).

const EPS = 1e-9;

// ───────────────────────── Beam models ─────────────────────────
// Each model captures everything load-case-specific: the delta<->P stiffness coefficient,
// the internal-force field beamMV(x,L,P) -> {M, V} (sagging-positive M; V positive when the
// left-of-cut segment pushes up), the normalized downward deflection shape shapeNorm(x,L) in
// [0,1], the wall reaction, plus labels and beam-strip drawing metadata (which ends are
// walls, and the fraction of L where peak displacement / the delta arrow sits).

// Fixed-fixed (clamped-clamped), equivalent central point load P.
//   M(x) = (P/2)x − PL/8 for 0 <= x <= L/2 (mirror on the right half); M = −PL/8 at the
//   walls and +PL/8 at the center. V = +P/2 left of center, −P/2 right of center.
//   Shape: v/delta = 4x^2(3L − 4x)/L^3 for 0 <= x <= L/2 (mirror beyond).
const fixedFixed = {
  id: 'fixed-fixed',
  name: 'Fixed–fixed',
  subtitle: 'Fixed–fixed beam · prescribed center displacement · live stress & yield state',
  stiffnessC: 192,
  walls: ['L', 'R'],
  dispXFrac: 0.5,
  loadLabel: 'Central load P',
  dispLabel: 'Center displacement δ',
  momentLabel: '|M| wall = center',
  reaction: (P) => P / 2,
  beamMV(x, L, P) {
    const half = L / 2;
    if (x <= half) {
      return { M: (P / 2) * x - (P * L) / 8, V: P / 2 };
    }
    const xr = L - x; // mirror coordinate from the right wall
    return { M: (P / 2) * xr - (P * L) / 8, V: -P / 2 };
  },
  shapeNorm(x, L) {
    const xm = x <= L / 2 ? x : L - x;
    return (4 * xm * xm * (3 * L - 4 * xm)) / (L * L * L);
  },
};

// Cantilever clamped at the left wall (x=0), free at x=L, downward point load P at the
// free tip. Verified against AmesWeb / EngineeringToolbox references:
//   delta_tip = P*L^3 / (3*E*I);   M(x) = −P(L − x)  (hogging, −PL at the wall, 0 at the tip);
//   V(x) = +P (constant);   v/delta = x^2(3L − x)/(2L^3)  (0 with slope 0 at the clamp, 1 at the tip).
const cantilever = {
  id: 'cantilever',
  name: 'Cantilever',
  subtitle: 'Cantilever beam · prescribed end displacement · live stress & yield state',
  stiffnessC: 3,
  walls: ['L'],
  dispXFrac: 1,
  loadLabel: 'End load P',
  dispLabel: 'End displacement δ',
  momentLabel: '|M| at wall',
  reaction: (P) => P,
  beamMV(x, L, P) {
    return { M: -P * (L - x), V: P };
  },
  shapeNorm(x, L) {
    return (x * x * (3 * L - x)) / (2 * L * L * L);
  },
};

export const BEAM_MODELS = { 'fixed-fixed': fixedFixed, cantilever };
export const DEFAULT_BEAM_TYPE = 'fixed-fixed';

// Plane-stress state at a point (sigma_y = 0, sigma_3 = 0), returning principal
// stresses, von Mises / Tresca equivalent stresses, and factors of safety.
export function stressState(sigmaX, tauXY, sigmaY) {
  const center = sigmaX / 2;                              // Mohr's circle center
  const radius = Math.sqrt(center * center + tauXY * tauXY); // Mohr's circle radius
  const s1 = center + radius;
  const s2 = center - radius;

  // Tresca must include the out-of-plane principal sigma_3 = 0 in the min/max set;
  // otherwise the uniaxial case is wrong by 2x.
  const smax = Math.max(s1, s2, 0);
  const smin = Math.min(s1, s2, 0);
  const tresca = smax - smin;                  // = sigma_max - sigma_min
  const tauMaxAbs = tresca / 2;                // absolute max shear (largest 3D circle)

  // von Mises (plane stress): sqrt(sigma_x^2 + 3 tau^2) === sqrt(s1^2 - s1 s2 + s2^2)
  const vM = Math.sqrt(sigmaX * sigmaX + 3 * tauXY * tauXY);

  const fosVM = vM > EPS ? sigmaY / vM : Infinity;
  const fosT = tresca > EPS ? sigmaY / tresca : Infinity;

  return {
    sigma_x: sigmaX, tau: tauXY, s1, s2, s3: 0,
    center, radius, tauMaxAbs, vM, tresca, fosVM, fosT,
  };
}

// Compute everything the UI needs from the current state. Pure function of state.
export function computeDerived(state) {
  const { L, b, h } = state;
  const E = state.material.E;       // MPa
  const sigmaY = state.material.sigmaY; // MPa
  const model = BEAM_MODELS[state.beamType] || BEAM_MODELS[DEFAULT_BEAM_TYPE];

  // Rectangular section properties.
  const I = (b * h * h * h) / 12;   // mm^4
  const A = b * h;                  // mm^2
  const c = h / 2;                  // mm (extreme fiber distance)

  // Load model: delta = P L^3 / (C E I). In 'force' mode the applied load P is the input
  // and the displacement is derived; otherwise the prescribed displacement delta is the
  // input and P is back-calculated. C is the support's stiffness coefficient.
  const C = model.stiffnessC;
  let P, delta;
  if (state.driveMode === 'force') {
    P = state.P;
    delta = (P * L * L * L) / (C * E * I);
  } else {
    delta = state.delta;
    P = (C * E * I * delta) / (L * L * L);
  }
  const R = model.reaction(P);      // N, wall reaction

  // Evaluation location: pinned wins, else hover, else center. Clamp to the beam.
  let xEval = state.cut.xPinned ?? state.cut.xHover ?? L / 2;
  xEval = Math.min(L, Math.max(0, xEval));

  const { M: Mx, V: Vx } = model.beamMV(xEval, L, P);
  const absM = Math.abs(Mx);
  const absV = Math.abs(Vx);

  // Two evaluation points across the depth at xEval.
  // Neutral axis: pure shear (sigma = 0, tau = 1.5 V / A for a rectangle).
  const tauNA = (1.5 * absV) / A;
  const pointNA = stressState(0, tauNA, sigmaY);

  // Extreme fiber: pure uniaxial bending (sigma = 6M/(b h^2) = Mc/I, tau = 0).
  const sigmaFiber = (6 * absM) / (b * h * h);
  const pointFiber = stressState(sigmaFiber, 0, sigmaY);

  // Diagrams along the length; track the peak |M| and |V| for readouts.
  const N = 201;
  const xs = new Array(N), Ms = new Array(N), Vs = new Array(N);
  let Mmax = 0, Vmax = 0;
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * L;
    const mv = model.beamMV(x, L, P);
    xs[i] = x; Ms[i] = mv.M; Vs[i] = mv.V;
    Mmax = Math.max(Mmax, Math.abs(mv.M));
    Vmax = Math.max(Vmax, Math.abs(mv.V));
  }
  const Mwall = Mmax;               // peak |M| (at the wall for both supports)

  // Stress distribution through the depth at xEval (signed).
  const Ns = 41;
  const ys = new Array(Ns), sigmaXs = new Array(Ns), taus = new Array(Ns);
  for (let i = 0; i < Ns; i++) {
    const y = -c + (i / (Ns - 1)) * h; // -c (bottom) .. +c (top)
    const Q = (b / 2) * ((h * h) / 4 - y * y);
    ys[i] = y;
    sigmaXs[i] = (Mx * y) / I;
    taus[i] = (Vx * Q) / (I * b);
  }

  const globalFoS = Math.min(
    pointNA.fosVM, pointFiber.fosVM, pointNA.fosT, pointFiber.fosT,
  );

  return {
    I, A, c, P, R, Mwall, delta,
    xEval, Mx, Vx,
    pointNA, pointFiber,
    diagram: { xs, Ms, Vs },
    sectionDist: { ys, sigmaXs, taus, sigmaFiber, tauNA },
    globalFoS, sigmaY,
    Mmax, Vmax,
    model,
  };
}
