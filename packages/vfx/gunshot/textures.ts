export interface RgbaImageData {
  width: number;
  height: number;
  data: Uint8Array;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function hash2(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2.04;
  }
  return sum / norm;
}

function billowFbm2(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = noise2(x * freq, y * freq, seed + i * 47);
    sum += amp * (1 - Math.abs(n * 2 - 1));
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

function warpedFbm(x: number, y: number, seed: number): number {
  const wx = fbm2(x + 1.7, y + 9.2, seed + 11, 3) - 0.5;
  const wy = fbm2(x + 8.3, y + 2.8, seed + 29, 3) - 0.5;
  return fbm2(x + wx * 1.45, y + wy * 1.45, seed + 53, 5);
}

/**
 * Generates a 2x2 procedural turbulent cauliflower fireball atlas.
 * R: incandescent core density, G: fine turbulent flame detail,
 * B: outer amber glow softness, A: hard-border-free radial mask.
 */
export function createFireballAtlasPixels(tileSize = 256): RgbaImageData {
  const width = tileSize * 2;
  const height = tileSize * 2;
  const data = new Uint8Array(width * height * 4);

  const lobeConfigs = [
    { seed: 101, cx: 0.46, cy: 0.50, sx: 1.02, sy: 0.92, lobes: 3.0, phase: 0.4 },
    { seed: 233, cx: 0.52, cy: 0.48, sx: 0.94, sy: 1.04, lobes: 4.0, phase: 1.6 },
    { seed: 389, cx: 0.48, cy: 0.52, sx: 1.05, sy: 0.95, lobes: 3.0, phase: 2.5 },
    { seed: 521, cx: 0.50, cy: 0.47, sx: 0.96, sy: 1.00, lobes: 5.0, phase: 0.9 },
  ];

  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const cfg = lobeConfigs[ty * 2 + tx]!;
      const x0 = tx * tileSize;
      const y0 = ty * tileSize;

      for (let py = 0; py < tileSize; py++) {
        const v = (py + 0.5) / tileSize;
        for (let px = 0; px < tileSize; px++) {
          const u = (px + 0.5) / tileSize;
          const dx = (u - cfg.cx) * 2.15 * cfg.sx;
          const dy = (v - cfg.cy) * 2.15 * cfg.sy;
          const r = Math.hypot(dx, dy);
          const ang = Math.atan2(dy, dx);

          // Dense turbulent cauliflower fireball contour + rugged billow flame tongues
          const angularLobe =
            0.045 * Math.cos(ang * cfg.lobes + cfg.phase) +
            0.035 * Math.sin(ang * (cfg.lobes + 1) - cfg.phase * 1.4);
          const lowBillow = fbm2(u * 2.6 + tx * 2.7, v * 2.6 + ty * 3.9, cfg.seed + 19, 3);
          const turb = warpedFbm(u * 4.4 + tx * 3.1, v * 4.4 + ty * 4.3, cfg.seed);
          const fine = billowFbm2(u * 9.0 + 1.3, v * 9.0 + 2.7, cfg.seed + 77, 4);

          const warpedR = r - angularLobe - (lowBillow - 0.5) * 0.34 - (turb - 0.5) * 0.36 - (fine - 0.5) * 0.14;
          // Guarantee zero well before tile boundary so bilinear filter never leaks or clips
          const borderFade = smoothstep(0.94, 0.72, Math.max(Math.abs(u * 2 - 1), Math.abs(v * 2 - 1)));

          const outerFlame = smoothstep(0.88, 0.20, warpedR) * borderFade;
          const coreDensity = clamp01(Math.pow(smoothstep(0.76, 0.05, warpedR), 1.25) * (0.76 + turb * 0.38) * borderFade);
          const detailVal = clamp01((turb * 0.58 + fine * 0.48) * outerFlame);
          const maskAlpha = clamp01(Math.pow(outerFlame, 0.85));

          const o = ((y0 + py) * width + (x0 + px)) * 4;
          data[o] = Math.round(coreDensity * 255);
          data[o + 1] = Math.round(detailVal * 255);
          data[o + 2] = Math.round(outerFlame * 255);
          data[o + 3] = Math.round(maskAlpha * 255);
        }
      }
    }
  }

  return { width, height, data };
}

/**
 * Generates a 2x2 billowing, curling fBm gunsmoke atlas.
 * R: cloud density, G: fine curly wisps, B: top-lit highlight hint, A: radial vignette alpha.
 */
export function createSmokeAtlasPixels(tileSize = 256): RgbaImageData {
  const width = tileSize * 2;
  const height = tileSize * 2;
  const data = new Uint8Array(width * height * 4);

  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const seed = 701 + (ty * 2 + tx) * 137;
      const x0 = tx * tileSize;
      const y0 = ty * tileSize;

      for (let py = 0; py < tileSize; py++) {
        const v = (py + 0.5) / tileSize;
        for (let px = 0; px < tileSize; px++) {
          const u = (px + 0.5) / tileSize;
          const dx = (u - 0.5) * 2.08;
          const dy = (v - 0.5) * 2.08;
          const r = Math.hypot(dx, dy);

          const base = warpedFbm(u * 3.8 + tx * 5.2, v * 3.8 + ty * 4.1, seed);
          const curl = billowFbm2(u * 6.4 + base * 1.4, v * 6.4 - base * 1.1, seed + 41, 4);
          const edgeR = r - (base - 0.5) * 0.36;

          const borderFade = smoothstep(0.94, 0.72, Math.max(Math.abs(u * 2 - 1), Math.abs(v * 2 - 1)));
          const radial = smoothstep(0.92, 0.14, edgeR) * borderFade;

          const cloudDensity = clamp01(radial * (0.64 + base * 0.44));
          const fineWisp = clamp01(curl * radial);

          // Pseudo directional top lighting derivative along v for volumetric cloud volume
          const baseUp = fbm2(u * 3.8 + tx * 5.2, (v + 0.03) * 3.8 + ty * 4.1, seed + 53, 3);
          const topLight = clamp01(0.55 + (base - baseUp) * 3.5 + (v - 0.5) * 0.45);

          const o = ((y0 + py) * width + (x0 + px)) * 4;
          data[o] = Math.round(cloudDensity * 255);
          data[o + 1] = Math.round(fineWisp * 255);
          data[o + 2] = Math.round(topLight * 255);
          data[o + 3] = Math.round(clamp01(Math.pow(radial, 0.85)) * 255);
        }
      }
    }
  }

  return { width, height, data };
}

/**
 * Soft exponential atmospheric optical bloom halo with zero edge clipping.
 */
export function createOpticalHaloPixels(size = 128): RgbaImageData {
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    const v = ((py + 0.5) / size) * 2 - 1;
    for (let px = 0; px < size; px++) {
      const u = ((px + 0.5) / size) * 2 - 1;
      const r = Math.hypot(u, v);
      const glow = Math.exp(-r * r * 4.4) * smoothstep(1.0, 0.68, r);
      const c = Math.round(clamp01(glow) * 255);
      const o = (py * size + px) * 4;
      data[o] = c;
      data[o + 1] = c;
      data[o + 2] = c;
      data[o + 3] = c;
    }
  }
  return { width: size, height: size, data };
}

/**
 * Razor-sharp velocity spark streak texture (leading incandescent bead at v~0.86,
 * tapering tail toward v=0.05). R: hot core weight, A: full streak alpha.
 */
export function createSparkStreakPixels(width = 64, height = 128): RgbaImageData {
  const data = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height; // 0 = tail, 1 = leading front tip
    const longEnv = v < 0.86 ? Math.pow(smoothstep(0.03, 0.86, v), 1.45) : smoothstep(0.99, 0.86, v);
    const halfWidth = 0.08 + 0.34 * Math.pow(smoothstep(0.04, 0.88, v), 1.7);

    for (let px = 0; px < width; px++) {
      const u = ((px + 0.5) / width) * 2 - 1;
      const xDist = Math.abs(u) / Math.max(0.02, halfWidth);
      const radial = Math.exp(-xDist * xDist * 2.8) * smoothstep(1.0, 0.65, Math.abs(u));
      const headBoost = Math.exp(-Math.pow((v - 0.85) * 9.5, 2)) * Math.exp(-u * u * 10.0);

      const alpha = clamp01((longEnv * radial + headBoost * 0.55) * smoothstep(1.0, 0.94, v));
      const core = clamp01(headBoost * 1.1 + longEnv * radial * 0.65);

      const o = (py * width + px) * 4;
      data[o] = Math.round(core * 255);
      data[o + 1] = Math.round(clamp01(longEnv * radial) * 255);
      data[o + 2] = Math.round(alpha * 255);
      data[o + 3] = Math.round(alpha * 255);
    }
  }
  return { width, height, data };
}

export { createTileableSmokeFlowPixels } from './smokeFlowTexture';
