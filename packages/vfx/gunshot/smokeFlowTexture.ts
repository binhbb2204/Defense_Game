import type { RgbaImageData } from './textures';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function hash2(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function wrapMod(i: number, period: number): number {
  const m = i % period;
  return m < 0 ? m + period : m;
}

function periodicNoise2(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const x0 = wrapMod(ix, period);
  const x1 = wrapMod(ix + 1, period);
  const y0 = wrapMod(iy, period);
  const y1 = wrapMod(iy + 1, period);

  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function periodicFbm2(u: number, v: number, basePeriod: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freqMul = 1;
  for (let i = 0; i < octaves; i++) {
    const p = basePeriod * freqMul;
    sum += amp * periodicNoise2(u * p, v * p, p, seed + i * 37);
    norm += amp;
    amp *= 0.5;
    freqMul *= 2;
  }
  return sum / norm;
}

function periodicBillow2(u: number, v: number, basePeriod: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freqMul = 1;
  for (let i = 0; i < octaves; i++) {
    const p = basePeriod * freqMul;
    const n = periodicNoise2(u * p, v * p, p, seed + i * 59);
    sum += amp * (1 - Math.abs(n * 2 - 1));
    norm += amp;
    amp *= 0.5;
    freqMul *= 2;
  }
  return sum / norm;
}

function periodicWarpedFbm2(u: number, v: number, basePeriod: number, seed: number): number {
  const wx = periodicFbm2(u + 0.13, v + 0.41, basePeriod, seed + 11, 3) - 0.5;
  const wy = periodicFbm2(u + 0.67, v + 0.19, basePeriod, seed + 29, 3) - 0.5;
  return periodicFbm2(u + wx * 0.24, v + wy * 0.24, basePeriod, seed + 71, 4);
}

/**
 * Generates a seamlessly tileable (wrapping in U and V) multi-channel fluid smoke flow texture.
 * R: billowy low-frequency cloud density, G: warped wispy filaments,
 * B: high-frequency curl & volumetric light hint, A: secondary phase-shifted curl distortion.
 */
export function createTileableSmokeFlowPixels(size = 256): RgbaImageData {
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    const v = py / size;
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const rVal = periodicFbm2(u, v, 4, 907, 4);
      const gWarp = periodicWarpedFbm2(u, v, 6, 1217);
      const gBillow = periodicBillow2(u + 0.08, v + 0.17, 6, 1451, 4);
      const gVal = clamp01(gWarp * 0.55 + gBillow * 0.52);

      const bCurl = periodicBillow2(u, v, 8, 1789, 3);
      const bUp = periodicFbm2(u, (v + 0.025) % 1, 8, 1789, 3);
      const bVal = clamp01(0.45 + bCurl * 0.35 + (rVal - bUp) * 1.45);

      const aVal = periodicFbm2(u + 0.31, v + 0.63, 4, 2113, 4);

      const o = (py * size + px) * 4;
      data[o] = Math.round(clamp01(rVal) * 255);
      data[o + 1] = Math.round(gVal * 255);
      data[o + 2] = Math.round(bVal * 255);
      data[o + 3] = Math.round(clamp01(aVal) * 255);
    }
  }
  return { width: size, height: size, data };
}
