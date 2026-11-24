/**
 * Procedural 3D Sprinter ("Speedy") GLB Generator.
 * Single source of truth inside `packages/shared/enemies/Speedy/`.
 *
 * Derives a distinct, realistic stylized low-poly Sprinter from `Normal/Normal.glb`
 * using only Node built-in modules (`node:fs`, `node:zlib`):
 *   1. Lean wiry sprinter proportions (84% width, 90% depth, full height) via Armature + scale track
 *   2. 2.1x faster in-place 50-bone Mixamo sprint animation ("Run") with amplified stride & arm pump
 *   3. Real 2K->1K recolored RGBA PNG texture atlas (burnt-amber runner jacket, charcoal joggers,
 *      ashen-feverish undead skin) preserving all original folds, seams, skull hollows & grime
 *
 * Usage:
 *   pnpm generate:speedy
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_NORMAL_GLB = resolve(__dirname, '../Normal/Normal_base.glb');
const INPUT_GLB = existsSync(BASE_NORMAL_GLB)
  ? BASE_NORMAL_GLB
  : resolve(__dirname, '../Normal/Normal.glb');
const OUTPUT_GLB = resolve(__dirname, 'Speedy.glb');
const THREE_ROOT = resolve(__dirname, '../../../../apps/client/node_modules/three');

// ---------------------------------------------------------------------------
// Helpers: Math & Quaternions
// ---------------------------------------------------------------------------
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function qNormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len > 1e-8 ? [q[0] / len, q[1] / len, q[2] / len, q[3] / len] : [0, 0, 0, 1];
}

function qConjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

function qDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

function qMultiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function qScaleDeviation(q, qMean, factor) {
  const aligned = qDot(q, qMean) < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
  const dq = qNormalize(qMultiply(qConjugate(qMean), aligned));
  const wClamped = clamp(dq[3], -1, 1);
  const halfAngle = Math.acos(wClamped);
  const sinHalf = Math.sin(halfAngle);
  if (sinHalf < 1e-6) return aligned;

  const newHalfAngle = Math.min(Math.PI * 0.48, halfAngle * factor);
  const s = Math.sin(newHalfAngle) / sinHalf;
  const dqScaled = [dq[0] * s, dq[1] * s, dq[2] * s, Math.cos(newHalfAngle)];
  return qNormalize(qMultiply(qMean, dqScaled));
}

function qSlerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cosHalf = qDot(a, b);
  if (cosHalf < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosHalf = -cosHalf;
  }
  if (cosHalf >= 0.9995) {
    return qNormalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }
  const halfTheta = Math.acos(clamp(cosHalf, -1, 1));
  const sinHalf = Math.sqrt(1 - cosHalf * cosHalf);
  const ra = Math.sin((1 - t) * halfTheta) / sinHalf;
  const rb = Math.sin(t * halfTheta) / sinHalf;
  return [
    a[0] * ra + bx * rb,
    a[1] * ra + by * rb,
    a[2] * ra + bz * rb,
    a[3] * ra + bw * rb,
  ];
}

// ---------------------------------------------------------------------------
// Helpers: Pure-Node PNG Decode, Recolor, Downsample & Encode (8-bit RGBA)
// ---------------------------------------------------------------------------
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgba(pngBuf) {
  if (!pngBuf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('Invalid PNG signature');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  const idats = [];

  while (offset < pngBuf.length) {
    const len = pngBuf.readUInt32BE(offset);
    const type = pngBuf.toString('ascii', offset + 4, offset + 8);
    const data = pngBuf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (depth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(`Unsupported PNG format: depth=${depth}, colorType=${colorType}, interlace=${interlace}`);
      }
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idats));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = new Uint8Array(width * height * bpp);

  for (let y = 0; y < height; y++) {
    const scanStart = y * (stride + 1);
    const filter = raw[scanStart];
    const dstRow = y * stride;
    const prevRow = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const filtByte = raw[scanStart + 1 + x];
      const left = x >= bpp ? pixels[dstRow + x - bpp] : 0;
      const up = y > 0 ? pixels[prevRow + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[prevRow + x - bpp] : 0;

      let recon;
      switch (filter) {
        case 0:
          recon = filtByte;
          break;
        case 1:
          recon = (filtByte + left) & 0xff;
          break;
        case 2:
          recon = (filtByte + up) & 0xff;
          break;
        case 3:
          recon = (filtByte + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          recon = (filtByte + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unknown PNG filter type: ${filter}`);
      }
      pixels[dstRow + x] = recon;
    }
  }

  return { width, height, pixels };
}

function makePngChunk(type, data) {
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRgba(width, height, pixels) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // non-interlaced

  const stride = width * 4;
  const raw = Buffer.allocUnsafe(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const srcRow = y * stride;
    const dstStart = y * (stride + 1);
    raw[dstStart] = 1; // Sub filter improves deflate ratio on smooth painted atlases
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[srcRow + x - 4] : 0;
      raw[dstStart + 1 + x] = (pixels[srcRow + x] - left) & 0xff;
    }
  }

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIG,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function recolorAndDownsampleAtlas(pngBuf) {
  const { width, height, pixels } = decodePngRgba(pngBuf);
  const stats = { jacket: 0, pants: 0, skin: 0, other: 0 };

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const chroma = maxC - minC;

    if (b >= r - 2 && b >= g - 6 && chroma < 75 && lum > 22) {
      // Cool slate jacket -> weathered burnt-amber / hazard-ochre sprinter jacket
      pixels[i] = clamp255(lum * 1.48 + 12);
      pixels[i + 1] = clamp255(lum * 1.02 + 2);
      pixels[i + 2] = clamp255(lum * 0.36);
      stats.jacket++;
    } else if (r > b + 14 && r >= g && g >= b) {
      // Warm brown-tan pants -> dark charcoal-slate athletic pants
      pixels[i] = clamp255(lum * 0.44);
      pixels[i + 1] = clamp255(lum * 0.48);
      pixels[i + 2] = clamp255(lum * 0.56);
      stats.pants++;
    } else if (g > r + 5 && g >= b) {
      // Greenish undead skin -> pale ashen-bone / gaunt feverish sprinter skin
      pixels[i] = clamp255(lum * 0.96 + 8);
      pixels[i + 1] = clamp255(lum * 0.92 + 4);
      pixels[i + 2] = clamp255(lum * 0.88 + 4);
      stats.skin++;
    } else {
      stats.other++;
    }
  }

  // 2x2 box average downsample: 2048x2048 -> 1024x1024
  const outW = width >> 1;
  const outH = height >> 1;
  const outPixels = new Uint8Array(outW * outH * 4);
  const srcStride = width * 4;
  const dstStride = outW * 4;

  for (let y = 0; y < outH; y++) {
    const sy0 = (y * 2) * srcStride;
    const sy1 = (y * 2 + 1) * srcStride;
    const dy = y * dstStride;
    for (let x = 0; x < outW; x++) {
      const sx = x * 8;
      const dx = dy + x * 4;
      for (let c = 0; c < 4; c++) {
        outPixels[dx + c] =
          (pixels[sy0 + sx + c] +
            pixels[sy0 + sx + 4 + c] +
            pixels[sy1 + sx + c] +
            pixels[sy1 + sx + 4 + c] +
            2) >>
          2;
      }
    }
  }

  const outPng = encodePngRgba(outW, outH, outPixels);
  return { outW, outH, outPng, stats };
}

// ---------------------------------------------------------------------------
// 1. Parse Normal.glb
// ---------------------------------------------------------------------------
const srcGlb = readFileSync(INPUT_GLB);
if (srcGlb.readUInt32LE(0) !== 0x46546c67) {
  throw new Error('Normal.glb is not a valid binary glTF file');
}

const jsonChunkLen = srcGlb.readUInt32LE(12);
const gltf = JSON.parse(srcGlb.subarray(20, 20 + jsonChunkLen).toString('utf8'));
const binHeaderOffset = 20 + jsonChunkLen;
const binChunkLen = srcGlb.readUInt32LE(binHeaderOffset);
const binBuf = Buffer.from(srcGlb.subarray(binHeaderOffset + 8, binHeaderOffset + 8 + binChunkLen));

function getAccessorSlice(accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const compCount =
    acc.type === 'SCALAR' ? 1 : acc.type === 'VEC3' ? 3 : acc.type === 'VEC4' ? 4 : 1;
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const byteLength = acc.count * compCount * 4;
  return {
    acc,
    compCount,
    arr: new Float32Array(binBuf.buffer, binBuf.byteOffset + byteOffset, acc.count * compCount),
    byteLength,
  };
}

// ---------------------------------------------------------------------------
// 2. Lean Sprinter Proportions (Armature static scale + Armature scale track)
// ---------------------------------------------------------------------------
const WIDTH_SCALE = 0.84;
const DEPTH_SCALE = 0.90;

const armatureIdx = gltf.nodes.findIndex((n) => n.name === 'Armature');
if (armatureIdx >= 0) {
  const arm = gltf.nodes[armatureIdx];
  if (Array.isArray(arm.scale)) {
    // Armature is rotated +90 deg on X -> local X is width, local Y is depth, local Z is height
    arm.scale[0] *= WIDTH_SCALE;
    arm.scale[1] *= DEPTH_SCALE;
  }
}

// ---------------------------------------------------------------------------
// 3. Transform 50-Bone Mixamo Walk -> High-Cadence In-Place Sprint ("Run")
// ---------------------------------------------------------------------------
const TIME_SCALE = 0.48;
const SWING_FACTORS = {
  LeftUpLeg: 1.38,
  RightUpLeg: 1.38,
  LeftLeg: 1.38,
  RightLeg: 1.38,
  LeftFoot: 1.38,
  RightFoot: 1.38,
  LeftArm: 1.55,
  RightArm: 1.55,
  LeftForeArm: 1.55,
  RightForeArm: 1.55,
  Spine: 1.25,
  Spine1: 1.25,
  Spine2: 1.25,
};

const primaryAnim = gltf.animations[0];
primaryAnim.name = 'Run';
gltf.animations = [primaryAnim];

// Compress keyframe timestamps once per shared input accessor
const scaledInputAccessors = new Set();
for (const sampler of primaryAnim.samplers) {
  if (scaledInputAccessors.has(sampler.input)) continue;
  scaledInputAccessors.add(sampler.input);

  const { acc, arr } = getAccessorSlice(sampler.input);
  const t0 = arr[0];
  let minT = Infinity;
  let maxT = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const t = (arr[i] - t0) * TIME_SCALE;
    arr[i] = t;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  if (acc.min) acc.min[0] = minT;
  if (acc.max) acc.max[0] = maxT;
}

let amplifiedTracks = 0;
for (const ch of primaryAnim.channels) {
  const node = gltf.nodes[ch.target.node];
  if (!node) continue;
  const sampler = primaryAnim.samplers[ch.sampler];
  const { acc, arr } = getAccessorSlice(sampler.output);

  // Match Armature scale animation channel to our lean X/Y scale
  if (ch.target.node === armatureIdx && ch.target.path === 'scale') {
    for (let i = 0; i < acc.count; i++) {
      arr[i * 3] *= WIDTH_SCALE;
      arr[i * 3 + 1] *= DEPTH_SCALE;
    }
    if (acc.min) {
      acc.min[0] *= WIDTH_SCALE;
      acc.min[1] *= DEPTH_SCALE;
    }
    if (acc.max) {
      acc.max[0] *= WIDTH_SCALE;
      acc.max[1] *= DEPTH_SCALE;
    }
    continue;
  }

  // Hips translation: strip forward root-motion drift (axis 1) & boost vertical bounce (axis 2)
  if (node.name === 'mixamorig:Hips' && ch.target.path === 'translation') {
    const fixedForward = arr[1];
    let sumZ = 0;
    for (let i = 0; i < acc.count; i++) sumZ += arr[i * 3 + 2];
    const meanZ = sumZ / acc.count;

    const minV = [Infinity, Infinity, Infinity];
    const maxV = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < acc.count; i++) {
      const idx = i * 3;
      arr[idx + 1] = fixedForward;
      arr[idx + 2] = meanZ + (arr[idx + 2] - meanZ) * 1.35;
      for (let k = 0; k < 3; k++) {
        if (arr[idx + k] < minV[k]) minV[k] = arr[idx + k];
        if (arr[idx + k] > maxV[k]) maxV[k] = arr[idx + k];
      }
    }
    if (acc.min) acc.min = minV;
    if (acc.max) acc.max = maxV;
    continue;
  }

  // Amplify rotation swing via coordinate-invariant quaternion mean-pose extrapolation
  if (ch.target.path === 'rotation' && node.name.startsWith('mixamorig:')) {
    const boneKey = node.name.slice('mixamorig:'.length);
    const factor = SWING_FACTORS[boneKey];
    if (!factor || acc.count < 3) continue;

    const q0 = [arr[0], arr[1], arr[2], arr[3]];
    const sum = [0, 0, 0, 0];
    for (let i = 0; i < acc.count; i++) {
      const idx = i * 4;
      const q = [arr[idx], arr[idx + 1], arr[idx + 2], arr[idx + 3]];
      const sign = qDot(q, q0) < 0 ? -1 : 1;
      sum[0] += q[0] * sign;
      sum[1] += q[1] * sign;
      sum[2] += q[2] * sign;
      sum[3] += q[3] * sign;
    }
    const qMean = qNormalize(sum);

    const outQuats = new Array(acc.count);
    for (let i = 0; i < acc.count; i++) {
      const idx = i * 4;
      const q = [arr[idx], arr[idx + 1], arr[idx + 2], arr[idx + 3]];
      outQuats[i] = qScaleDeviation(q, qMean, factor);
    }

    // Smoothly close any minor end-to-start gap for a seamless sprint loop
    const lastIdx = acc.count - 1;
    outQuats[lastIdx] = outQuats[0];
    if (lastIdx >= 2) {
      outQuats[lastIdx - 1] = qSlerp(outQuats[lastIdx - 1], outQuats[0], 0.5);
    }

    const minQ = [Infinity, Infinity, Infinity, Infinity];
    const maxQ = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < acc.count; i++) {
      const idx = i * 4;
      const q = outQuats[i];
      for (let k = 0; k < 4; k++) {
        arr[idx + k] = q[k];
        if (q[k] < minQ[k]) minQ[k] = q[k];
        if (q[k] > maxQ[k]) maxQ[k] = q[k];
      }
    }
    if (acc.min) acc.min = minQ;
    if (acc.max) acc.max = maxQ;
    amplifiedTracks++;
  }
}

// ---------------------------------------------------------------------------
// 4. Recolor & Downsample Embedded 2K PNG Atlas (2048x2048 -> 1024x1024)
// ---------------------------------------------------------------------------
const imgMeta = gltf.images[0];
const imgBvIdx = imgMeta.bufferView;
const imgBv = gltf.bufferViews[imgBvIdx];
const oldStart = imgBv.byteOffset || 0;
const oldLen = imgBv.byteLength;
const oldEnd = oldStart + oldLen;
const oldPaddedEnd = Math.ceil(oldEnd / 4) * 4;
const oldPaddedLen = oldPaddedEnd - oldStart;

const srcPng = binBuf.subarray(oldStart, oldEnd);
const { outW, outH, outPng, stats: pxStats } = recolorAndDownsampleAtlas(srcPng);

const newPaddedLen = Math.ceil(outPng.length / 4) * 4;
const paddedPng = Buffer.alloc(newPaddedLen, 0);
outPng.copy(paddedPng, 0);

const delta = newPaddedLen - oldPaddedLen;
const newBinBuf = Buffer.concat([
  binBuf.subarray(0, oldStart),
  paddedPng,
  binBuf.subarray(oldPaddedEnd),
]);

// Update bufferView offsets for every bufferView positioned after the replaced image
imgBv.byteLength = outPng.length;
for (let i = 0; i < gltf.bufferViews.length; i++) {
  if (i === imgBvIdx) continue;
  const bv = gltf.bufferViews[i];
  const off = bv.byteOffset || 0;
  if (off >= oldPaddedEnd) {
    bv.byteOffset = off + delta;
  }
}
gltf.buffers[0].byteLength = newBinBuf.length;
imgMeta.name = 'speedy_atlas_1024.png';
if (gltf.materials?.[0]) {
  gltf.materials[0].name = 'SpeedyRunnerPBR';
}

// ---------------------------------------------------------------------------
// 5. Re-pack GLB Binary & Self-Verify with Three.js GLTFLoader
// ---------------------------------------------------------------------------
const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPadLen = (4 - (jsonRaw.length % 4)) % 4;
const jsonPadded = Buffer.concat([jsonRaw, Buffer.alloc(jsonPadLen, 0x20)]); // space-padded JSON

const binPadLen = (4 - (newBinBuf.length % 4)) % 4;
const binPadded = Buffer.concat([newBinBuf, Buffer.alloc(binPadLen, 0x00)]); // null-padded BIN

const totalBytes = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
const outGlb = Buffer.allocUnsafe(totalBytes);
outGlb.writeUInt32LE(0x46546c67, 0); // 'glTF'
outGlb.writeUInt32LE(2, 4);          // version 2
outGlb.writeUInt32LE(totalBytes, 8);

outGlb.writeUInt32LE(jsonPadded.length, 12);
outGlb.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
jsonPadded.copy(outGlb, 20);

const binChunkStart = 20 + jsonPadded.length;
outGlb.writeUInt32LE(binPadded.length, binChunkStart);
outGlb.writeUInt32LE(0x004e4942, binChunkStart + 4); // 'BIN\0'
binPadded.copy(outGlb, binChunkStart + 8);

writeFileSync(OUTPUT_GLB, outGlb);

// Self-verification: parse generated GLB with Three.js GLTFLoader
const THREE = await import(pathToFileURL(resolve(THREE_ROOT, 'build/three.module.js')).href);
const { GLTFLoader } = await import(pathToFileURL(resolve(THREE_ROOT, 'examples/jsm/loaders/GLTFLoader.js')).href);

// Node environment lacks browser `self` and `createImageBitmap` for texture decoding inside GLTFLoader
const parsed = await new Promise((res, rej) => {
  if (typeof globalThis.self === 'undefined') {
    globalThis.self = globalThis;
  }
  if (typeof globalThis.createImageBitmap === 'undefined') {
    globalThis.createImageBitmap = async () => ({ width: outW, height: outH, close() {} });
  }
  const loader = new GLTFLoader();
  const ab = outGlb.buffer.slice(outGlb.byteOffset, outGlb.byteOffset + outGlb.byteLength);
  loader.parse(ab, '', res, rej);
});

const bbox = new THREE.Box3().setFromObject(parsed.scene);
const size = bbox.getSize(new THREE.Vector3());
const clip = parsed.animations[0];

console.log('Wrote', OUTPUT_GLB);
console.log('  bytes            :', outGlb.byteLength, `(${(outGlb.byteLength / 1024 / 1024).toFixed(2)} MB)`);
console.log('  atlas PNG        :', `${outW}x${outH}`, `(${(outPng.length / 1024).toFixed(1)} KB)`);
console.log('  recolored pixels :', pxStats);
console.log('  amplified tracks :', amplifiedTracks);
console.log('  animation        :', `${clip.name} (${clip.duration.toFixed(3)}s, ${clip.tracks.length} tracks)`);
console.log('  bbox size        :', size.toArray().map((v) => v.toFixed(3)).join(' x '), 'm');
