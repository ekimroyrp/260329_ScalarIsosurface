# 260329_ScalarIsosurface

260329_ScalarIsosurface is an interactive Three.js scalar-field sandbox that generates layered isosurfaces from point sources inside a resizable 3D boundary box. It uses a CPU marching-cubes pipeline with independent axis resolution, supports realtime point editing/simulation/cutting, and includes a styled material and export workflow for fast form iteration.

## Features

- Gaussian scalar-field accumulation from custom points and seeded random points.
- Resizable boundary domain with `Size X`, `Size Y`, and `Size Z` plus independent `X/Y/Z Resolution` controls.
- Layered surface extraction with `IsoValue`, `Layers`, and equal-step `Offset` spacing away from points.
- Per-layer shell generation via `Thickness`, including corrected outward shell normals.
- Post-mesh shaping controls with integer `Subdivision` (Catmull-Clark) and volumetric `Smoothing`.
- Realtime interaction loop: add/select/move/delete points and see live isosurface updates.
- Built-in point simulation (`Start/Pause`, `Reset`, timeline scrub, `Simulation Rate`) with bounded wandering motion.
- Shift+LMB multi-cut tool with camera-parallel cut planes and `Clear IsoSurface Cuts`.
- Visibility toggles for `Show Boundary`, `Show IsoSurface`, and `Show Points`.
- Material styling controls for gradient (`Gradient Start` to `Gradient End`), `Fresnel`, `Specular`, and `Bloom`.
- Export tools for `OBJ`, `GLB`, and screenshots; exports include current thickened geometry and color data.
- DifferentialGrowth-inspired dark UI/environment styling with editable numeric fields for precise control.

## Getting Started

1. `npm install`
2. `npm run dev` to start Vite and open the local URL shown in the terminal
3. `npm run build` to generate a production bundle in `dist/`
4. `npm run preview` to inspect the production build locally

## Controls

- `Left Click`: Select an existing custom point (shows move gizmo) or add a new custom point on boundary hit.
- `Drag Gizmo Arrows`: Move the selected custom point in world space with realtime mesh updates.
- `Delete`: Remove the selected custom point.
- `Shift + Left Drag`: Draw a cut line in screen space to add a camera-parallel cut plane; cuts stack until cleared.
- `Right Mouse Drag`: Orbit camera.
- `Middle Mouse Drag`: Pan camera.
- `Mouse Wheel`: Zoom camera.
- `Start / Pause`: Start or pause point simulation (editing is locked while running).
- `Reset` (Simulation): Return simulated points to their base positions and reset timeline.
- `Simulation Timeline`: Scrub integer simulation steps while paused.
- `UI Panel`: Adjust boundary size/resolution, isosurface shaping, point/random-point controls, material controls, and export actions.
- `Clear Custom Points`: Remove all manually added custom points.
- `Clear IsoSurface Cuts`: Remove all active cut planes.
- `Show Boundary / Show IsoSurface / Show Points`: Toggle visual visibility of each subsystem.
- `Numeric Inputs`: Type values directly; fields are clamped/snapped to each control's min/max/step.
- `Export`: Save `OBJ`, `GLB`, or `Screenshot` from the current scene state.

## Deployment

- **Local production preview:** `npm install`, then `npm run build` followed by `npm run preview` to inspect the compiled bundle.
- **Publish to GitHub Pages:** From a clean `main`, run `npm run build -- --base=./`. Checkout (or create) the `gh-pages` branch in a separate worktree/temp clone, copy everything inside `dist/` plus a `.nojekyll` marker to its root (and optional `env/` folder if used), commit with a descriptive message, and `git push origin gh-pages`.
- **Live demo:** https://ekimroyrp.github.io/260329_ScalarIsosurface/
