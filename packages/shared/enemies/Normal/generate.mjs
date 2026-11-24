/**
 * Procedural Zombie Shamble Animation Generator for "Normal" (Walker) zombie.
 * Reads `Normal_base.glb` (untouched source) and writes `Normal.glb` (idempotent).
 *
 * Transforms the standard human Mixamo walk into a classic shambling zombie walk:
 *   - Hunched forward spine with heavy asymmetric limping sway
 *   - Creepy tilted head bobbing forward at prey
 *   - Outstretched asymmetric reaching zombie arms (raised forward along +Z)
 *   - Heavier, slower shamble cadence (~2.5s cycle) with zero root-motion drift (in-place)
 *
 * Usage:
 *   pnpm generate:normal
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_GLB = resolve(__dirname, 'Normal_base.glb');
const OUTPUT_GLB = resolve(__dirname, 'Normal.glb');
const INPUT_GLB = existsSync(BASE_GLB) ? BASE_GLB : OUTPUT_GLB;

const DEG = Math.PI / 180;

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

function qMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function qFromAxisAngle(ax, ay, az, rad) {
  const half = rad * 0.5;
  const s = Math.sin(half);
  return [ax * s, ay * s, az * s, Math.cos(half)];
}

function qFromWorldEulerXYZ(rx, ry, rz) {
  const qx = qFromAxisAngle(1, 0, 0, rx);
  const qy = qFromAxisAngle(0, 1, 0, ry);
  const qz = qFromAxisAngle(0, 0, 1, rz);
  return qNormalize(qMul(qz, qMul(qy, qx)));
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
  const halfTheta = Math.acos(Math.max(-1, Math.min(1, cosHalf)));
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
// 1. Parse Normal_base.glb
// ---------------------------------------------------------------------------
const srcGlb = readFileSync(INPUT_GLB);
if (srcGlb.readUInt32LE(0) !== 0x46546c67) {
  throw new Error('Input GLB is not a valid binary glTF 2.0 file');
}

const jsonChunkLen = srcGlb.readUInt32LE(12);
const gltf = JSON.parse(srcGlb.subarray(20, 20 + jsonChunkLen).toString('utf8'));
const binHeaderOffset = 20 + jsonChunkLen;
const binChunkLen = srcGlb.readUInt32LE(binHeaderOffset);
const binBuf = Buffer.from(srcGlb.subarray(binHeaderOffset + 8, binHeaderOffset + 8 + binChunkLen));

// Build parent map for exact world-space bone frame calculation
const parentOf = new Map();
gltf.nodes.forEach((node, idx) => {
  for (const child of node.children || []) {
    parentOf.set(child, idx);
  }
});

function getAccessorSlice(accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const compCount = acc.type === 'SCALAR' ? 1 : acc.type === 'VEC3' ? 3 : acc.type === 'VEC4' ? 4 : 1;
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  return {
    acc,
    arr: new Float32Array(binBuf.buffer, binBuf.byteOffset + byteOffset, acc.count * compCount),
  };
}

// ---------------------------------------------------------------------------
// 2. Transform Primary Animation -> "Walk" (Zombie Shamble)
// ---------------------------------------------------------------------------
const primaryAnim = gltf.animations[0];
primaryAnim.name = 'Walk';
gltf.animations = [primaryAnim];

// Heavier, slower zombie shamble cadence (1.18x slower than human walk)
const TIME_SCALE = 1.18;
const scaledInputs = new Set();
for (const sampler of primaryAnim.samplers) {
  if (scaledInputs.has(sampler.input)) continue;
  scaledInputs.add(sampler.input);
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

// Index rotation tracks by node index so we can compute exact parent world quaternions at every frame
const rotTrackByNode = new Map();
let frameCount = 64;

for (const ch of primaryAnim.channels) {
  const node = gltf.nodes[ch.target.node];
  if (!node) continue;
  const sampler = primaryAnim.samplers[ch.sampler];
  const { acc, arr } = getAccessorSlice(sampler.output);

  if (ch.target.path === 'rotation') {
    rotTrackByNode.set(ch.target.node, { acc, arr, count: acc.count });
    if (acc.count > frameCount) frameCount = acc.count;
  }

  // Strip forward root motion on Hips (axis 1) & add subtle limping lateral sway (axis 0)
  if (node.name === 'mixamorig:Hips' && ch.target.path === 'translation') {
    const baseX = arr[0];
    const baseY = arr[1];
    const minV = [Infinity, Infinity, Infinity];
    const maxV = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < acc.count; i++) {
      const p = (i / (acc.count - 1)) * Math.PI * 2;
      const idx = i * 3;
      arr[idx] = baseX + Math.sin(p) * 3.8; // heavy zombie side-to-side limp sway
      arr[idx + 1] = baseY;                 // locked in-place (zero root-motion snapback)
      for (let k = 0; k < 3; k++) {
        if (arr[idx + k] < minV[k]) minV[k] = arr[idx + k];
        if (arr[idx + k] > maxV[k]) maxV[k] = arr[idx + k];
      }
    }
    if (acc.min) acc.min = minV;
    if (acc.max) acc.max = maxV;
  }
}

// Snapshot original local rotations so parent world frames are computed cleanly in topological order
const localQuats = new Map();
for (let idx = 0; idx < gltf.nodes.length; idx++) {
  const track = rotTrackByNode.get(idx);
  const frames = new Array(frameCount);
  if (track && track.count === frameCount) {
    for (let f = 0; f < frameCount; f++) {
      const o = f * 4;
      frames[f] = [track.arr[o], track.arr[o + 1], track.arr[o + 2], track.arr[o + 3]];
    }
  } else {
    const rest = gltf.nodes[idx].rotation || [0, 0, 0, 1];
    for (let f = 0; f < frameCount; f++) frames[f] = rest;
  }
  localQuats.set(idx, frames);
}

// World-space zombie shamble offsets applied in parent-to-child order:
//   rx > 0: pitch forward (+Z); rx < 0: pitch up/back
//   ry: yaw left/right
//   rz: roll sideways (head cock / limping shoulder tilt)
const ZOMBIE_OFFSETS = [
  ['mixamorig:Hips', (p) => [3 * DEG, 0, (4.5 * Math.sin(p) + 2) * DEG]],
  ['mixamorig:Spine', (p) => [9 * DEG, 0, (3 * Math.sin(p) - 2) * DEG]],
  ['mixamorig:Spine1', (p) => [8 * DEG, 3 * DEG * Math.sin(p), 2 * DEG]],
  ['mixamorig:Spine2', (p) => [6 * DEG, -2 * DEG * Math.sin(p), -3 * DEG]],
  ['mixamorig:Neck', (p) => [-8 * DEG + 3 * DEG * Math.cos(2 * p), 0, 6 * DEG]],
  ['mixamorig:Head', (p) => [-6 * DEG + 4 * DEG * Math.sin(p), 6 * DEG * Math.cos(p), 16 * DEG + 4 * DEG * Math.sin(p)]],
  // Outstretched zombie arms reaching forward (+Z) with asymmetric creepy sway
  ['mixamorig:LeftArm', (p) => [-58 * DEG + 7 * DEG * Math.sin(p), 8 * DEG, 6 * DEG]],
  ['mixamorig:LeftForeArm', (p) => [-12 * DEG + 5 * DEG * Math.cos(p), 0, 0]],
  ['mixamorig:RightArm', (p) => [-70 * DEG - 8 * DEG * Math.sin(p), -10 * DEG, -8 * DEG]],
  ['mixamorig:RightForeArm', (p) => [-16 * DEG - 6 * DEG * Math.cos(p), 0, 0]],
];

function computeWorldQuat(nodeIdx, frame) {
  const q = localQuats.get(nodeIdx)[frame];
  const pIdx = parentOf.get(nodeIdx);
  return pIdx !== undefined ? qMul(computeWorldQuat(pIdx, frame), q) : q;
}

let modifiedBones = 0;
for (const [boneName, offsetFn] of ZOMBIE_OFFSETS) {
  const nodeIdx = gltf.nodes.findIndex((n) => n.name === boneName);
  if (nodeIdx < 0) continue;
  const track = rotTrackByNode.get(nodeIdx);
  if (!track || track.count !== frameCount) continue;

  const pIdx = parentOf.get(nodeIdx);
  const updated = new Array(frameCount);

  for (let f = 0; f < frameCount; f++) {
    const phase = (f / (frameCount - 1)) * Math.PI * 2;
    const [rx, ry, rz] = offsetFn(phase);
    const qWorldDelta = qFromWorldEulerXYZ(rx, ry, rz);

    const wParent = pIdx !== undefined ? computeWorldQuat(pIdx, f) : [0, 0, 0, 1];
    const qLocal = localQuats.get(nodeIdx)[f];
    // Convert world-space delta into parent-local space: q' = (W_p^-1 * qDelta * W_p) * qLocal
    const qLocalDelta = qMul(qConjugate(wParent), qMul(qWorldDelta, wParent));
    updated[f] = qNormalize(qMul(qLocalDelta, qLocal));
  }

  // Seamless loop closure
  updated[frameCount - 1] = updated[0];
  updated[frameCount - 2] = qSlerp(updated[frameCount - 2], updated[0], 0.5);

  localQuats.set(nodeIdx, updated);

  const minQ = [Infinity, Infinity, Infinity, Infinity];
  const maxQ = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (let f = 0; f < frameCount; f++) {
    const q = updated[f];
    const o = f * 4;
    for (let k = 0; k < 4; k++) {
      track.arr[o + k] = q[k];
      if (q[k] < minQ[k]) minQ[k] = q[k];
      if (q[k] > maxQ[k]) maxQ[k] = q[k];
    }
  }
  if (track.acc.min) track.acc.min = minQ;
  if (track.acc.max) track.acc.max = maxQ;
  modifiedBones++;
}

// ---------------------------------------------------------------------------
// 3. Re-pack Normal.glb
// ---------------------------------------------------------------------------
const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPadLen = (4 - (jsonRaw.length % 4)) % 4;
const jsonPadded = Buffer.concat([jsonRaw, Buffer.alloc(jsonPadLen, 0x20)]);

const binPadLen = (4 - (binBuf.length % 4)) % 4;
const binPadded = Buffer.concat([binBuf, Buffer.alloc(binPadLen, 0x00)]);

const totalBytes = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
const outGlb = Buffer.allocUnsafe(totalBytes);
outGlb.writeUInt32LE(0x46546c67, 0);
outGlb.writeUInt32LE(2, 4);
outGlb.writeUInt32LE(totalBytes, 8);

outGlb.writeUInt32LE(jsonPadded.length, 12);
outGlb.writeUInt32LE(0x4e4f534a, 16);
jsonPadded.copy(outGlb, 20);

const binChunkStart = 20 + jsonPadded.length;
outGlb.writeUInt32LE(binPadded.length, binChunkStart);
outGlb.writeUInt32LE(0x004e4942, binChunkStart + 4);
binPadded.copy(outGlb, binChunkStart + 8);

writeFileSync(OUTPUT_GLB, outGlb);
console.log('Wrote', OUTPUT_GLB);
console.log('  source        :', INPUT_GLB);
console.log('  bytes         :', outGlb.length, `(${(outGlb.length / 1024 / 1024).toFixed(2)} MB)`);
console.log('  zombie bones  :', modifiedBones);
console.log('  animation     :', `${primaryAnim.name} (${(2.1 * TIME_SCALE).toFixed(2)}s, ${primaryAnim.channels.length} channels)`);
