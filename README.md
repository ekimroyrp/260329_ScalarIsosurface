# 260329_ScalarIsosurface

260329_ScalarIsosurface is an interactive Three.js tool for generating a 3D scalar-field isosurface inside a bounded box using user-placed source points and a CPU marching-cubes mesh extraction pipeline with independent X/Y/Z grid resolution controls.

## Features

- Interactive isosurface generation from Gaussian point-field contributions.
- Independent X, Y, and Z grid resolution controls.
- Adjustable iso value threshold for surface extraction.
- Multi-surface extraction where `Amount` sets layer count and `offset` sets equal spacing between layers moving away from points.
- Catmull-Clark subdivision smoothing with an integer `Subdivision` level control.
- Left-click point placement on the box surface.
- Right-drag orbit and middle-drag pan navigation.
- Live point count and one-click clear operation.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the development server:
   ```bash
   npm run dev
   ```
3. Open the local URL shown by Vite in your browser.

## Controls

- `Left Click`: Add a scalar source point where the ray hits the box.
- `Right Mouse Drag`: Orbit camera.
- `Middle Mouse Drag`: Pan camera.
- `Mouse Wheel`: Zoom.
- `GUI`: Set `X res`, `Y res`, `Z res`, `isoValue`, `Amount`, `offset` (equal layer spacing), `Subdivision`, and `Clear All` points.
