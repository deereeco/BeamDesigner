// Pure mechanics for a fixed-fixed (clamped-clamped) prismatic beam loaded at the
// center, driven either by a prescribed central displacement delta or by an applied
// central force P (linked by delta = P L^3 / (192 E I)). All quantities in canonical
// units (mm, N, MPa, N*mm). No UI, no unit conversion here.

const EPS = 1e-9;

// Bending moment and shear at position x (origin at left wall), for a fixed-fixed
// beam of length L with an equivalent central point load P.
//   M(x) = (P/2)x - PL/8   for 0 <= x <= L/2   (mirror on the right half)
//   V    = +P/2 for x < L/2,  -P/2 for x > L/2  (jump of P at the center)
// Sign convention: sagging-positive moment, with M = -PL/8 at the walls and
// +PL/8 at the center.
export function beamMV(x, L, P) {
  const half = L / 2;
  if (x <= half) {
    return { M: (P / 2) * x - (P * L) / 8, V: P / 2 };
  }
  const xr = L - x; // mirror coordinate from the right wall
  return { M: (P / 2) * xr - (P * L) / 8, V: -P / 2 };
}

// Normalized deflected shape (downward-positive), 0 at the walls and 1 at the
// center. v(x)/delta = 4 x^2 (3L - 4x) / L^3 for 0 <= x <= L/2 (mirror beyond).
export function shapeNorm(x, L) {
  const xm = x <= L / 2 ? x : L - x;
  return (4 * xm * xm * (3 * L - 4 * xm)) / (L * L * L);
}

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

  // Rectangular section properties.
  const I = (b * h * h * h) / 12;   // mm^4
  const A = b * h;                  // mm^2
  const c = h / 2;                  // mm (extreme fiber distance)

  // Load model: in 'force' mode the applied central load P is the input and the
  // resulting displacement is derived; otherwise the prescribed displacement delta
  // is the input and P is back-calculated. Linked by delta = P L^3 / (192 E I).
  let P, delta;
  if (state.driveMode === 'force') {
    P = state.P;
    delta = (P * L * L * L) / (192 * E * I);
  } else {
    delta = state.delta;
    P = (192 * E * I * delta) / (L * L * L);
  }
  const R = P / 2;                  // N, reaction at each wall
  const Mwall = (P * L) / 8;        // N*mm, |moment| at walls and center

  // Evaluation location: pinned wins, else hover, else center. Clamp to the beam.
  let xEval = state.cut.xPinned ?? state.cut.xHover ?? L / 2;
  xEval = Math.min(L, Math.max(0, xEval));

  const { M: Mx, V: Vx } = beamMV(xEval, L, P);
  const absM = Math.abs(Mx);
  const absV = Math.abs(Vx);

  // Two evaluation points across the depth at xEval.
  // Neutral axis: pure shear (sigma = 0, tau = 1.5 V / A for a rectangle).
  const tauNA = (1.5 * absV) / A;
  const pointNA = stressState(0, tauNA, sigmaY);

  // Extreme fiber: pure uniaxial bending (sigma = 6M/(b h^2) = Mc/I, tau = 0).
  const sigmaFiber = (6 * absM) / (b * h * h);
  const pointFiber = stressState(sigmaFiber, 0, sigmaY);

  // Diagrams along the length.
  const N = 201;
  const xs = new Array(N), Ms = new Array(N), Vs = new Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * L;
    const mv = beamMV(x, L, P);
    xs[i] = x; Ms[i] = mv.M; Vs[i] = mv.V;
  }

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
    Mmax: Mwall, Vmax: P / 2,
  };
}
