# Tactical Zombie TD (3D Hardcore Tower Defense)

Single-codebase **Web App + Lightweight Desktop App (Tauri)** built with **Three.js (TypeScript)**, **React + Tailwind CSS + Zustand**, and **Rust/Tauri**.

## Quick Start

### Prerequisites
- **Node.js** >= 20 & **pnpm** >= 9
- *(Optional, for Desktop build)* **Rust** (`rustup` / `cargo`) + Windows WebView2 / Visual Studio C++ Build Tools

### Commands
```bash
# Install all workspace dependencies
pnpm install

# Run Web App (http://localhost:1420)
pnpm dev

# Type-check all workspace packages
pnpm typecheck

# Production Web build
pnpm build

# Run Tauri Desktop App (requires Rust toolchain)
pnpm tauri:dev

# Package lightweight Desktop binary
pnpm tauri:build
```

## Phase 1 Status
- [x] Monorepo scaffold (`apps/client`, `apps/server`, `packages/shared`) + Tauri v2 wrapper
- [x] `GameLoop.ts` — Fixed 60Hz timestep simulation + variable-rate interpolated render loop
- [x] `World.ts` — Pure Three.js scene, tactical RTS camera, dusk lighting, procedural 3D `highway_01` prototype map (overpass, LoS-blocking containers/walls/tunnel, elevated rooftop zones)
- [x] `PathSystem.ts` — Pre-baked arc-length spline LUT ($O(1)$ zero-allocation sampling, lateral horde lane offsets, tunnel/overpass masks)
- [x] `WaveManager.ts` & `Zombie.ts` — Deterministic seeded spawner + `InstancedMesh` pooled prototype zombies (2 draw calls for up to 1,024 active units)
- [x] Zustand HUD bridge (`WaveHUD`, `TowerBar`, `UpgradePanel`) isolated from the 60Hz loop

## Camera Controls
- **Pan:** `W A S D` / Arrow keys / Middle-Mouse drag
- **Orbit Yaw:** Right-Mouse drag or `Q` / `E`
- **Zoom:** Mouse wheel
- **Reset Camera:** `R`
