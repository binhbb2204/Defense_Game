/**
 * Automatic 17-Bone Humanoid SkinnedMesh Rigger + High-Speed Feral Sprinter Animator
 * for unrigged T-pose `Speedy_Zombie.glb`.
 *
 * Reads `Speedy_Zombie.glb.bak` (untouched T-pose source), computes anatomically-partitioned
 * smooth skinning weights (`JOINTS_0`, `WEIGHTS_0`), builds a 17-bone skeleton (`skins[0]`)
 * tuned to Speedy_Zombie's exact measured proportions, and bakes a high-cadence in-place
 * "Run" sprint cycle matched to Speedy's 7.6 m/s speed:
 *   - Aggressive ~42° predatory forward sprint lean + crane-forward head
 *   - Bent 90° runner elbows pumping cheek-to-hip contralaterally
 *   - Explosive high-knee leg drive (-62°..+48°) & sharp +96° heel-kick knee recovery
 *   - Snappy 0.38s stride cadence with double-frequency sprint bounce (100% in-place)
 *
 * Usage:
 *   pnpm rig:speedy
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BAK_GLB = resolve(__dirname, 'Speedy_Zombie.glb.bak');
const OUTPUT_GLB = resolve(__dirname, 'Speedy_Zombie.glb');
const INPUT_GLB = existsSync(BAK_GLB) ? BAK_GLB : OUTPUT_GLB;
const THREE_ROOT = resolve(__dirname, '../../../../apps/client/node_modules/three');

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Quaternion Helpers
// ---------------------------------------------------------------------------
function qNormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len > 1e-8 ? [q[0] / len, q[1] / len, q[2] / len, q[3] / len] : [0, 0, 0, 1];
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

function qAxisAngle(ax, ay, az, rad) {
  const h = rad * 0.5;
  const s = Math.sin(h);
  return [ax * s, ay * s, az * s, Math.cos(h)];
}

/** Composes rotations in order: first Z (lower T-pose arm), then Y (bend/angle), then X (forward/back swing). */
function qEulerZYX(rx, ry, rz) {
  const qx = qAxisAngle(1, 0, 0, rx);
  const qy = qAxisAngle(0, 1, 0, ry);
  const qz = qAxisAngle(0, 0, 1, rz);
  return qNormalize(qMul(qx, qMul(qy, qz)));
}

// ---------------------------------------------------------------------------
// 1. Parse Source T-Pose GLB
// ---------------------------------------------------------------------------
const srcGlb = readFileSync(INPUT_GLB);
if (srcGlb.readUInt32LE(0) !== 0x46546c67) {
  throw new Error('Input file is not a valid binary glTF 2.0 (.glb)');
}

const jsonChunkLen = srcGlb.readUInt32LE(12);
const gltf = JSON.parse(srcGlb.subarray(20, 20 + jsonChunkLen).toString('utf8'));
const binHeaderOffset = 20 + jsonChunkLen;
const binChunkLen = srcGlb.readUInt32LE(binHeaderOffset);
const srcBin = Buffer.from(srcGlb.subarray(binHeaderOffset + 8, binHeaderOffset + 8 + binChunkLen));

const prim = gltf.meshes[0].primitives[0];
const posAcc = gltf.accessors[prim.attributes.POSITION];
const posBv = gltf.bufferViews[posAcc.bufferView];
const vertCount = posAcc.count;
const posArr = new Float32Array(
  srcBin.buffer,
  srcBin.byteOffset + (posBv.byteOffset || 0) + (posAcc.byteOffset || 0),
  vertCount * 3,
);

// ---------------------------------------------------------------------------
// 2. Define 17-Bone Skeleton (measured exact centroids of Speedy_Zombie.glb, y in [-0.358, +0.358])
// ---------------------------------------------------------------------------
const BONES = [
  { name: 'Hips',       parent: -1, world: [ 0.000, -0.025, -0.010] }, // 0
  { name: 'Spine',      parent:  0, world: [ 0.000,  0.048,  0.002] }, // 1
  { name: 'Chest',      parent:  1, world: [ 0.000,  0.145, -0.006] }, // 2
  { name: 'Neck',       parent:  2, world: [ 0.000,  0.232, -0.010] }, // 3
  { name: 'Head',       parent:  3, world: [ 0.000,  0.264, -0.010] }, // 4
  { name: 'UpperArm_L', parent:  2, world: [ 0.088,  0.198, -0.011] }, // 5
  { name: 'ForeArm_L',  parent:  5, world: [ 0.235,  0.192, -0.009] }, // 6
  { name: 'Hand_L',     parent:  6, world: [ 0.375,  0.186, -0.007] }, // 7
  { name: 'UpperArm_R', parent:  2, world: [-0.088,  0.192, -0.011] }, // 8
  { name: 'ForeArm_R',  parent:  8, world: [-0.235,  0.186, -0.009] }, // 9
  { name: 'Hand_R',     parent:  9, world: [-0.375,  0.188, -0.007] }, // 10
  { name: 'Thigh_L',    parent:  0, world: [ 0.052, -0.050, -0.015] }, // 11
  { name: 'Shin_L',     parent: 11, world: [ 0.062, -0.175, -0.020] }, // 12
  { name: 'Foot_L',     parent: 12, world: [ 0.060, -0.318, -0.006] }, // 13
  { name: 'Thigh_R',    parent:  0, world: [-0.052, -0.050, -0.015] }, // 14
  { name: 'Shin_R',     parent: 14, world: [-0.062, -0.175, -0.020] }, // 15
  { name: 'Foot_R',     parent: 15, world: [-0.060, -0.318, -0.008] }, // 16
];

const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b.name, i]));

// ---------------------------------------------------------------------------
// 3. Anatomically-Partitioned Smooth Skinning Weights (JOINTS_0, WEIGHTS_0)
// ---------------------------------------------------------------------------
const jointsData = new Uint8Array(vertCount * 4);
const weightsData = new Float32Array(vertCount * 4);

function assignWeights(vIdx, pairs) {
  const filtered = pairs.filter((p) => p[1] > 1e-5).sort((a, b) => b[1] - a[1]).slice(0, 4);
  let sum = 0;
  for (const p of filtered) sum += p[1];
  if (sum <= 1e-6) {
    jointsData[vIdx * 4] = 0;
    weightsData[vIdx * 4] = 1;
    return;
  }
  const base = vIdx * 4;
  for (let k = 0; k < 4; k++) {
    if (k < filtered.length) {
      jointsData[base + k] = filtered[k][0];
      weightsData[base + k] = filtered[k][1] / sum;
    } else {
      jointsData[base + k] = 0;
      weightsData[base + k] = 0;
    }
  }
}

for (let i = 0; i < vertCount; i++) {
  const x = posArr[i * 3];
  const y = posArr[i * 3 + 1];

  // A. Left Arm region (x > +0.070, y in arm band)
  if (x > 0.070 && y > 0.110 && y < 0.270) {
    const tShoulder = smoothstep(0.070, 0.120, x);
    const tElbow = smoothstep(0.208, 0.262, x);
    const tWrist = smoothstep(0.352, 0.398, x);

    const wChest = 1 - tShoulder;
    const wUpper = tShoulder * (1 - tElbow);
    const wFore = tShoulder * tElbow * (1 - tWrist);
    const wHand = tShoulder * tElbow * tWrist;
    assignWeights(i, [
      [BONE_INDEX.Chest, wChest],
      [BONE_INDEX.UpperArm_L, wUpper],
      [BONE_INDEX.ForeArm_L, wFore],
      [BONE_INDEX.Hand_L, wHand],
    ]);
    continue;
  }

  // B. Right Arm region (x < -0.070, y in arm band)
  if (x < -0.070 && y > 0.110 && y < 0.270) {
    const ax = -x;
    const tShoulder = smoothstep(0.070, 0.120, ax);
    const tElbow = smoothstep(0.208, 0.262, ax);
    const tWrist = smoothstep(0.352, 0.398, ax);

    const wChest = 1 - tShoulder;
    const wUpper = tShoulder * (1 - tElbow);
    const wFore = tShoulder * tElbow * (1 - tWrist);
    const wHand = tShoulder * tElbow * tWrist;
    assignWeights(i, [
      [BONE_INDEX.Chest, wChest],
      [BONE_INDEX.UpperArm_R, wUpper],
      [BONE_INDEX.ForeArm_R, wFore],
      [BONE_INDEX.Hand_R, wHand],
    ]);
    continue;
  }

  // C. Legs region (y < -0.015) — strictly isolated Left (x >= 0) vs Right (x < 0)
  if (y < -0.015) {
    const isLeft = x >= 0;
    const thighIdx = isLeft ? BONE_INDEX.Thigh_L : BONE_INDEX.Thigh_R;
    const shinIdx = isLeft ? BONE_INDEX.Shin_L : BONE_INDEX.Shin_R;
    const footIdx = isLeft ? BONE_INDEX.Foot_L : BONE_INDEX.Foot_R;

    const tHipToThigh = smoothstep(-0.015, -0.068, y);
    const tKnee = smoothstep(-0.148, -0.205, y);
    const tAnkle = smoothstep(-0.295, -0.338, y);

    const wHips = 1 - tHipToThigh;
    const wThigh = tHipToThigh * (1 - tKnee);
    const wShin = tHipToThigh * tKnee * (1 - tAnkle);
    const wFoot = tHipToThigh * tKnee * tAnkle;
    assignWeights(i, [
      [BONE_INDEX.Hips, wHips],
      [thighIdx, wThigh],
      [shinIdx, wShin],
      [footIdx, wFoot],
    ]);
    continue;
  }

  // D. Neck & Head region (y > +0.218)
  if (y > 0.218) {
    const tNeck = smoothstep(0.218, 0.246, y);
    const tHead = smoothstep(0.245, 0.275, y);
    const wChest = 1 - tNeck;
    const wNeck = tNeck * (1 - tHead);
    const wHead = tNeck * tHead;
    assignWeights(i, [
      [BONE_INDEX.Chest, wChest],
      [BONE_INDEX.Neck, wNeck],
      [BONE_INDEX.Head, wHead],
    ]);
    continue;
  }

  // E. Core Torso (Hips -> Spine -> Chest)
  const tSpine = smoothstep(-0.020, 0.068, y);
  const tChest = smoothstep(0.095, 0.180, y);
  const wHips = 1 - tSpine;
  const wSpine = tSpine * (1 - tChest);
  const wChest = tSpine * tChest;
  assignWeights(i, [
    [BONE_INDEX.Hips, wHips],
    [BONE_INDEX.Spine, wSpine],
    [BONE_INDEX.Chest, wChest],
  ]);
}

// ---------------------------------------------------------------------------
// 4. Inverse Bind Matrices (17 pure translation MAT4s)
// ---------------------------------------------------------------------------
const ibmData = new Float32Array(BONES.length * 16);
for (let i = 0; i < BONES.length; i++) {
  const [wx, wy, wz] = BONES[i].world;
  const o = i * 16;
  ibmData[o + 0] = 1;
  ibmData[o + 5] = 1;
  ibmData[o + 10] = 1;
  ibmData[o + 12] = -wx;
  ibmData[o + 13] = -wy;
  ibmData[o + 14] = -wz;
  ibmData[o + 15] = 1;
}

// ---------------------------------------------------------------------------
// 5. Bake High-Speed Feral Sprinter Animation ("Run", 0.38s, 32 keyframes)
//    Matched to Speedy's 7.6 m/s speed: explosive knee drive, 90° pumping arms,
//    deep forward sprint lean, and snappy airborne flight bounce (100% in-place).
// ---------------------------------------------------------------------------
const DURATION = 0.38;
const KEYS = 32;
const timesData = new Float32Array(KEYS + 1);
for (let k = 0; k <= KEYS; k++) {
  timesData[k] = (k / KEYS) * DURATION;
}

function bakeQuatTrack(fn) {
  const out = new Float32Array((KEYS + 1) * 4);
  for (let k = 0; k <= KEYS; k++) {
    const p = (k / KEYS) * Math.PI * 2;
    const [rx, ry, rz] = fn(p);
    const q = qEulerZYX(rx, ry, rz);
    out[k * 4 + 0] = q[0];
    out[k * 4 + 1] = q[1];
    out[k * 4 + 2] = q[2];
    out[k * 4 + 3] = q[3];
  }
  return out;
}

function bakeHipsTranslationTrack() {
  const out = new Float32Array((KEYS + 1) * 3);
  const [hx, hy, hz] = BONES[0].world;
  for (let k = 0; k <= KEYS; k++) {
    const p = (k / KEYS) * Math.PI * 2;
    // Snappy sprinter vertical flight phase (highest at p = 0, pi; lowest at foot plant p = pi/2, 3pi/2)
    out[k * 3 + 0] = hx + Math.sin(p) * 0.010;
    out[k * 3 + 1] = hy + Math.cos(2 * p) * 0.024 - 0.010;
    out[k * 3 + 2] = hz;
  }
  return out;
}

/** High-power sprinter leg kinematics: wide -62°..+48° sweep, sharp +96° swing recovery knee fold. */
function sprintThighAngle(p) {
  // sin(p)=+1 -> -62° max high-knee drive forward; sin(p)=-1 -> +48° full rear push-off
  return (-7 - 55 * Math.sin(p)) * DEG;
}

function sprintKneeAngle(p) {
  // Sharp heel-kick fold during forward swing recovery (around p = -0.35), near-extended on foot strike
  const swingKick = Math.max(0, Math.cos(p - 0.35));
  const impactAbsorb = Math.max(0, Math.sin(p - 0.3)) * 0.18;
  return (8 + 88 * Math.pow(swingKick, 1.25) + 88 * impactAbsorb) * DEG;
}

function sprintAnkleAngle(p) {
  // Strong forefoot push-off (+26°) at toe-off, dorsiflexed (-18°) on strike
  return (-18 * Math.sin(p) - 12 * Math.cos(p) + 4) * DEG;
}

const ANIM_ROT_TRACKS = {
  // Aggressive predatory forward sprint lean (~40° total) + counter-rotating athletic torso twist
  Hips:       (p) => [10 * DEG + 3 * DEG * Math.cos(2 * p),  14 * DEG * Math.sin(p),   4 * DEG * Math.sin(p)],
  Spine:      (p) => [15 * DEG + 2 * DEG * Math.cos(2 * p), -11 * DEG * Math.sin(p),  -3 * DEG * Math.sin(p)],
  Chest:      (p) => [14 * DEG + 2 * DEG * Math.cos(2 * p), -14 * DEG * Math.sin(p),   3 * DEG * Math.sin(p)],
  Neck:       (p) => [-15 * DEG - 2 * DEG * Math.cos(2 * p),  0,                       0],
  Head:       (p) => [-18 * DEG - 3 * DEG * Math.cos(2 * p),  8 * DEG * Math.sin(p),   4 * DEG * Math.sin(p)],

  // Left arm (rest +X): rz=-66° drops arm alongside torso; rx pumps cheek-to-hip opposite to Left Leg
  UpperArm_L: (p) => [(58 * Math.sin(p) - 10) * DEG,   -10 * DEG,   (-66 + 6 * Math.cos(p)) * DEG],
  // Left forearm: ry=-92° bends elbow tightly forward (+Z) like a sprinter!
  ForeArm_L:  (p) => [0,   (-92 + 16 * Math.sin(p)) * DEG,   -6 * DEG],
  Hand_L:     (p) => [0,   -10 * DEG,                        -10 * DEG],

  // Right arm (rest -X): mirrored opposite phase
  UpperArm_R: (p) => [(58 * Math.sin(p + Math.PI) - 10) * DEG,   10 * DEG,   (66 - 6 * Math.cos(p + Math.PI)) * DEG],
  ForeArm_R:  (p) => [0,   (92 - 16 * Math.sin(p + Math.PI)) * DEG,   6 * DEG],
  Hand_R:     (p) => [0,    10 * DEG,                                10 * DEG],

  // Explosive sprinting legs (contralateral)
  Thigh_L:    (p) => [sprintThighAngle(p),           0,  2 * DEG],
  Shin_L:     (p) => [sprintKneeAngle(p),            0,  0],
  Foot_L:     (p) => [sprintAnkleAngle(p),           0,  0],

  Thigh_R:    (p) => [sprintThighAngle(p + Math.PI), 0, -2 * DEG],
  Shin_R:     (p) => [sprintKneeAngle(p + Math.PI),  0,  0],
  Foot_R:     (p) => [sprintAnkleAngle(p + Math.PI), 0,  0],
};

// ---------------------------------------------------------------------------
// 6. Append Skinning Attributes, Skeleton, Skin & "Run" Clip into glTF JSON
// ---------------------------------------------------------------------------
const extraChunks = [];
let binCursor = Math.ceil(srcBin.length / 4) * 4;
if (binCursor > srcBin.length) {
  extraChunks.push(Buffer.alloc(binCursor - srcBin.length, 0));
}

function appendBufferView(typedArray, target) {
  const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  const pad = (4 - (bytes.length % 4)) % 4;
  const byteOffset = binCursor;
  extraChunks.push(bytes);
  if (pad > 0) extraChunks.push(Buffer.alloc(pad, 0));
  binCursor += bytes.length + pad;

  const bv = { buffer: 0, byteOffset, byteLength: bytes.length };
  if (target !== undefined) bv.target = target;
  gltf.bufferViews.push(bv);
  return gltf.bufferViews.length - 1;
}

function appendAccessor(bvIdx, componentType, count, type, min, max) {
  const acc = { bufferView: bvIdx, componentType, count, type };
  if (min) acc.min = min;
  if (max) acc.max = max;
  gltf.accessors.push(acc);
  return gltf.accessors.length - 1;
}

const jointsBv = appendBufferView(jointsData, 34962);
const weightsBv = appendBufferView(weightsData, 34962);
prim.attributes.JOINTS_0 = appendAccessor(jointsBv, 5121, vertCount, 'VEC4');
prim.attributes.WEIGHTS_0 = appendAccessor(weightsBv, 5126, vertCount, 'VEC4');

const ibmBv = appendBufferView(ibmData);
const ibmAcc = appendAccessor(ibmBv, 5126, BONES.length, 'MAT4');

const MESH_NODE_IDX = 1;
const FIRST_BONE_NODE = 2;
const boneNodeIndices = BONES.map((_, i) => FIRST_BONE_NODE + i);

const boneNodes = BONES.map((bone, i) => {
  const children = [];
  for (let c = 0; c < BONES.length; c++) {
    if (BONES[c].parent === i) children.push(FIRST_BONE_NODE + c);
  }
  let tx = bone.world[0];
  let ty = bone.world[1];
  let tz = bone.world[2];
  if (bone.parent >= 0) {
    const pw = BONES[bone.parent].world;
    tx -= pw[0];
    ty -= pw[1];
    tz -= pw[2];
  }
  const node = {
    name: bone.name,
    translation: [tx, ty, tz],
    rotation: [0, 0, 0, 1],
  };
  if (children.length > 0) node.children = children;
  return node;
});

gltf.nodes = [
  { name: 'Speedy_Zombie_Root', children: [MESH_NODE_IDX, FIRST_BONE_NODE] },
  { name: 'Speedy_Zombie_Mesh', mesh: 0, skin: 0 },
  ...boneNodes,
];

gltf.scenes = [{ name: 'Scene', nodes: [0] }];
gltf.scene = 0;

gltf.skins = [
  {
    name: 'SpeedySkeleton',
    inverseBindMatrices: ibmAcc,
    skeleton: FIRST_BONE_NODE,
    joints: boneNodeIndices,
  },
];

const timesBv = appendBufferView(timesData);
const timesAcc = appendAccessor(timesBv, 5126, KEYS + 1, 'SCALAR', [0], [DURATION]);

const samplers = [];
const channels = [];

const hipsTransData = bakeHipsTranslationTrack();
const hipsTransBv = appendBufferView(hipsTransData);
const hipsTransAcc = appendAccessor(hipsTransBv, 5126, KEYS + 1, 'VEC3');
samplers.push({ input: timesAcc, interpolation: 'LINEAR', output: hipsTransAcc });
channels.push({ sampler: samplers.length - 1, target: { node: FIRST_BONE_NODE, path: 'translation' } });

for (const [boneName, rotFn] of Object.entries(ANIM_ROT_TRACKS)) {
  const nodeIdx = FIRST_BONE_NODE + BONE_INDEX[boneName];
  const quatData = bakeQuatTrack(rotFn);
  const bvIdx = appendBufferView(quatData);
  const accIdx = appendAccessor(bvIdx, 5126, KEYS + 1, 'VEC4');
  samplers.push({ input: timesAcc, interpolation: 'LINEAR', output: accIdx });
  channels.push({ sampler: samplers.length - 1, target: { node: nodeIdx, path: 'rotation' } });
}

gltf.animations = [{ name: 'Run', channels, samplers }];

// ---------------------------------------------------------------------------
// 7. Pack Rigged GLB + Self-Verify with Three.js GLTFLoader
// ---------------------------------------------------------------------------
const finalBin = Buffer.concat([srcBin, ...extraChunks]);
gltf.buffers[0].byteLength = finalBin.length;

const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPadLen = (4 - (jsonRaw.length % 4)) % 4;
const jsonPadded = Buffer.concat([jsonRaw, Buffer.alloc(jsonPadLen, 0x20)]);

const binPadLen = (4 - (finalBin.length % 4)) % 4;
const binPadded = Buffer.concat([finalBin, Buffer.alloc(binPadLen, 0x00)]);

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

const { GLTFLoader } = await import(pathToFileURL(resolve(THREE_ROOT, 'examples/jsm/loaders/GLTFLoader.js')).href);

const parsed = await new Promise((res, rej) => {
  if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
  if (typeof globalThis.createImageBitmap === 'undefined') {
    globalThis.createImageBitmap = async () => ({ width: 2048, height: 2048, close() {} });
  }
  const loader = new GLTFLoader();
  const ab = outGlb.buffer.slice(outGlb.byteOffset, outGlb.byteOffset + outGlb.byteLength);
  loader.parse(ab, '', res, rej);
});

let skinnedCount = 0;
let boneCount = 0;
parsed.scene.traverse((o) => {
  if (o.isSkinnedMesh) skinnedCount++;
  if (o.isBone) boneCount++;
});

const clip = parsed.animations[0];
console.log('Wrote', OUTPUT_GLB);
console.log('  source      :', INPUT_GLB);
console.log('  bytes       :', outGlb.length, `(${(outGlb.length / 1024 / 1024).toFixed(2)} MB)`);
console.log('  skinnedMesh :', skinnedCount, '| bones:', boneCount, '| verts:', vertCount);
console.log('  animation   :', `${clip.name} (${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks)`);
