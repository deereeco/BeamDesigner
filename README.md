# Beam Designer

An interactive, browser-based tool for exploring the **stress state of a beam** — either a
**fixed–fixed (clamped–clamped)** beam with a central load or a **cantilever** with a load at
the free end — driven by a **prescribed displacement** or an applied force. Change the support,
geometry, material, and displacement and watch the stress state move relative to the
**von Mises** and **Tresca** yield envelopes in real time.

No build step, no dependencies — just static HTML/CSS/JS, ready for GitHub Pages.

## What it does

- Choose the **support** (fixed–fixed or cantilever), then set beam **length, width, height,
  material** (steel / aluminum / titanium / custom) and the imposed **displacement δ** — at the
  center for fixed–fixed, at the free end for a cantilever. The equivalent point load `P`, wall
  reactions, and moments are derived automatically from `δ = P·L³ / (C·E·I)`, with `C = 192`
  for fixed–fixed and `C = 3` for the cantilever.
- **Hover** along the beam to move a cutting line; **click** to pin it. Once pinned, move
  the mouse to the sliders and watch that fixed cross-section respond live. Re-click to
  re-pin; `Esc`, the **Unpin** button, or arrow keys (when the beam is focused) also work.
- At the cut, two points are evaluated:
  - **Neutral axis** — pure shear (`σ = 0`, `τ = 1.5·V/A`).
  - **Extreme fiber** — pure uniaxial bending (`σ = 6M/bh²`, `τ = 0`).
- For each point you get a **Mohr's circle** and a **σ₁–σ₂ yield plot** (von Mises ellipse
  + Tresca hexagon scaled by σ_Y) with the live stress state, plus **factor-of-safety**
  readouts, **shear/moment diagrams**, and the **through-depth stress distribution**.
- Toggle between **SI** and **Imperial** units anytime.

## Run locally

ES modules require an HTTP origin (opening `index.html` via `file://` will not load the
modules). Serve the folder with any static server:

```bash
python -m http.server 8000
# then open http://localhost:8000/
```

(or `npx serve`, VS Code "Live Server", etc.)

## Deploy to GitHub Pages

This is a static site with no build step:

1. Commit `index.html`, `styles.css`, and `js/` to the repo **root** on `main`.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch →
   Branch `main`, Folder `/ (root)` → Save.**
3. The site goes live at `https://<user>.github.io/<repo>/` within ~1 minute.

Asset paths are relative (`./styles.css`, `./js/app.js`) so they resolve correctly under
the project sub-path.

## Project structure

```
index.html        # shell: controls + SVG containers
styles.css        # responsive layout & theme
js/units.js       # SI/Imperial conversions (canonical = mm, N, MPa)
js/materials.js   # material presets
js/beam.js        # pure mechanics (computeDerived)
js/plots.js       # all SVG drawing
js/app.js         # state, events, render orchestration
```

## Modeling notes & limits

- Euler–Bernoulli beam theory (transverse shear deformation neglected); for very short,
  deep beams (`L/h ≲ 5`) the δ→P relation under-predicts deflection.
- Reported factor of safety is the **minimum of the two canonical points**, not a full
  through-depth optimization. Bending typically governs for slender beams; transverse
  shear can govern for short, deep ones — both points are always shown so the crossover is
  visible.
- Tresca uses the full principal set `{σ₁, σ₂, 0}` (the out-of-plane principal matters).
