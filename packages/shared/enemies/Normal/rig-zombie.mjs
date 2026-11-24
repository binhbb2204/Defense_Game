/**
 * Automatic 17-Bone Humanoid SkinnedMesh Rigger + Zombie Shamble Animator
 * for unrigged T-pose humanoid GLBs (`Normal_Zombie.glb`).
 *
 * Reads `Normal_Zombie.glb.bak` (untouched T-pose source), computes anatomically-partitioned
 * smooth skinning weights (`JOINTS_0`, `WEIGHTS_0`), builds a 17-bone skeleton (`skins[0]`)
 * with exact inverseBindMatrices, and bakes a seamless in-place "Walk" zombie shamble clip.
 *
 * Usage:
 *   pnpm rig:normal
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BAK_GLB = resolve(__dirname, 'Normal_Zombie.glb.bak');
const OUTPUT_GLB = resolve(__dirname, 'Normal_Zombie.glb');
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

/** Composes intrinsic/extrinsic rotations in order: first Z, then Y, then X (qX * qY * qZ). */
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
// 2. Define 17-Bone Humanoid Skeleton (exact measured anatomy of Normal_Zombie.glb)
//    Mesh local space: facing +Z, Left = +X, Right = -X, Up = +Y (y in [-0.377, +0.377])
// ---------------------------------------------------------------------------
const BONES = [
  { name: 'Hips',       parent: -1, world: [ 0.000, -0.025, -0.012] }, // 0
  { name: 'Spine',      parent:  0, world: [ 0.000,  0.055, -0.009] }, // 1
  { name: 'Chest',      parent:  1, world: [ 0.000,  0.155, -0.010] }, // 2
  { name: 'Neck',       parent:  2, world: [ 0.000,  0.238, -0.012] }, // 3
  { name: 'Head',       parent:  3, world: [ 0.000,  0.268, -0.012] }, // 4
  { name: 'UpperArm_L', parent:  2, world: [ 0.088,  0.214, -0.010] }, // 5
  { name: 'ForeArm_L',  parent:  5, world: [ 0.235,  0.210, -0.007] }, // 6
  { name: 'Hand_L',     parent:  6, world: [ 0.378,  0.206, -0.004] }, // 7
  { name: 'UpperArm_R', parent:  2, world: [-0.088,  0.216, -0.010] }, // 8
  { name: 'ForeArm_R',  parent:  8, world: [-0.235,  0.212, -0.007] }, // 9
  { name: 'Hand_R',     parent:  9, world: [-0.378,  0.208, -0.004] }, // 10
  { name: 'Thigh_L',    parent:  0, world: [ 0.052, -0.052, -0.013] }, // 11
  { name: 'Shin_L',     parent: 11, world: [ 0.056, -0.193, -0.015] }, // 12
  { name: 'Foot_L',     parent: 12, world: [ 0.057, -0.338,  0.005] }, // 13
  { name: 'Thigh_R',    parent:  0, world: [-0.052, -0.052, -0.013] }, // 14
  { name: 'Shin_R',     parent: 14, world: [-0.056, -0.193, -0.015] }, // 15
  { name: 'Foot_R',     parent: 15, world: [-0.057, -0.338,  0.005] }, // 16
];

const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b.name, i]));

// ---------------------------------------------------------------------------
// 3. Compute Anatomically-Partitioned Smooth Skinning Weights (JOINTS_0, WEIGHTS_0)
// ---------------------------------------------------------------------------
const jointsData = new Uint8Array(vertCount * 4);
const weightsData = new Float32Array(vertCount * 4);

function assignWeights(vIdx, pairs) {
  // Keep top 4 non-zero weights and normalize sum === 1.0
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
  if (x > 0.070 && y > 0.130 && y < 0.275) {
    const tShoulder = smoothstep(0.070, 0.118, x); // 0 = Chest, 1 = Arm
    const tElbow = smoothstep(0.210, 0.260, x);    // 0 = UpperArm, 1 = ForeArm
    const tWrist = smoothstep(0.355, 0.400, x);    // 0 = ForeArm, 1 = Hand

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
  if (x < -0.070 && y > 0.130 && y < 0.275) {
    const ax = -x;
    const tShoulder = smoothstep(0.070, 0.118, ax);
    const tElbow = smoothstep(0.210, 0.260, ax);
    const tWrist = smoothstep(0.355, 0.400, ax);

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

    const tHipToThigh = smoothstep(-0.015, -0.070, y); // 0 = Hips, 1 = Thigh
    const tKnee = smoothstep(-0.165, -0.222, y);       // 0 = Thigh, 1 = Shin
    const tAnkle = smoothstep(-0.315, -0.355, y);      // 0 = Shin, 1 = Foot

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

  // D. Neck & Head region (y > +0.225)
  if (y > 0.225) {
    const tNeck = smoothstep(0.225, 0.252, y);
    const tHead = smoothstep(0.250, 0.278, y);
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
  const tSpine = smoothstep(-0.020, 0.075, y);
  const tChest = smoothstep(0.105, 0.190, y);
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
// 4. Build Inverse Bind Matrices (17 x 4x4 column-major translation matrices)
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
// 5. Bake Speed-Matched In-Place Zombie Lurch Animation ("Walk", 0.58s, 36 keyframes)
//    Stride calibrated to match Normal's in-game road speed (~4.2 m/s at 1.75m height)
//    with realistic stance-phase weight transfer & swing-phase knee clearance.
// ---------------------------------------------------------------------------
const DURATION = 0.58;
const KEYS = 36;
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
    // Grounded vertical hip drop at double-support (p = pi/2, 3pi/2) & lateral weight shift (in-place!)
    out[k * 3 + 0] = hx + Math.sin(p) * 0.014;
    out[k * 3 + 1] = hy - Math.abs(Math.sin(p)) * 0.022 + 0.004;
    out[k * 3 + 2] = hz;
  }
  return out;
}

/**
 * Realistic bipedal leg gait helper (phase p in [0, 2pi]):
 *   p = 0     : mid-swing forward (knee bent high to clear ground)
 *   p = pi/2  : heel strike (thigh max forward, knee nearly extended, ankle dorsiflexed)
 *   p = pi    : mid-stance (planted foot passing directly under hip, knee straight)
 *   p = 3pi/2 : toe-off push (thigh max back, ankle plantarflexed pushing off ground)
 */
function legThighAngle(p, forwardDeg, backDeg) {
  const mid = (backDeg - forwardDeg) * 0.5;
  const amp = (forwardDeg + backDeg) * 0.5;
  return (mid - amp * Math.sin(p)) * DEG;
}

function legKneeAngle(p, maxBendDeg) {
  // High knee bend strictly during swing phase (cos(p) > 0 around p = 0), near-straight during stance
  const swing = Math.max(0, Math.cos(p - 0.25));
  const stanceYield = Math.max(0, Math.sin(p - 0.4)) * 0.14;
  return (5 + maxBendDeg * Math.pow(swing, 1.35) + maxBendDeg * stanceYield) * DEG;
}

function legAnkleAngle(p) {
  // Dorsiflex on heel strike (p ~ pi/2), push off toes at toe-off (p ~ 3pi/2)
  return (-12 * Math.sin(p) - 10 * Math.cos(p)) * DEG;
}

// Bone animations: grounded fast-shambling zombie walk matched to 4.2 m/s road speed
const ANIM_ROT_TRACKS = {
  Hips:       (p) => [ 5 * DEG,   10 * DEG * Math.sin(p),   (4.5 * Math.sin(p) + 1.5) * DEG],
  Spine:      (p) => [12 * DEG + 2 * DEG * Math.cos(2 * p), -7 * DEG * Math.sin(p), (-3 * Math.sin(p) - 1.5) * DEG],
  Chest:      (p) => [11 * DEG + 2 * DEG * Math.cos(2 * p), -8 * DEG * Math.sin(p), ( 3 * Math.sin(p) + 1.5) * DEG],
  Neck:       (p) => [-9 * DEG + 2 * DEG * Math.cos(2 * p),  0,                      5 * DEG],
  Head:       (p) => [-10 * DEG + 3 * DEG * Math.sin(p),     4 * DEG * Math.cos(p), 12 * DEG + 3 * DEG * Math.sin(p)],

  // Left arm (rest points along +X): outstretched forward (+Z) with weighty zombie reach sway
  UpperArm_L: (p) => [ 5 * DEG * Math.sin(p),  (-76 + 8 * Math.sin(p)) * DEG,  (-20 + 5 * Math.cos(p)) * DEG],
  ForeArm_L:  (p) => [ 0,                      (-16 + 5 * Math.cos(p)) * DEG,  (-10 + 3 * Math.sin(p)) * DEG],
  Hand_L:     (p) => [ 0,                       0,                              (-22 + 5 * Math.sin(p)) * DEG],

  // Right arm (rest points along -X): asymmetric outstretched forward reach
  UpperArm_R: (p) => [-6 * DEG * Math.sin(p),  ( 68 - 9 * Math.sin(p)) * DEG,  ( 26 - 5 * Math.cos(p)) * DEG],
  ForeArm_R:  (p) => [ 0,                      ( 22 - 6 * Math.cos(p)) * DEG,  ( 14 - 3 * Math.sin(p)) * DEG],
  Hand_R:     (p) => [ 0,                       0,                              ( 26 - 5 * Math.sin(p)) * DEG],

  // Left leg: wide stride (-42° forward reach -> +36° back push-off)
  Thigh_L:    (p) => [legThighAngle(p, 42, 36), 0,  2 * DEG],
  Shin_L:     (p) => [legKneeAngle(p, 56),      0,  0],
  Foot_L:     (p) => [legAnkleAngle(p),         0,  0],

  // Right leg: matched stride length with slight asymmetric zombie drag knee
  Thigh_R:    (p) => [legThighAngle(p + Math.PI, 40, 38), 0, -2 * DEG],
  Shin_R:     (p) => [legKneeAngle(p + Math.PI, 48),      0,  0],
  Foot_R:     (p) => [legAnkleAngle(p + Math.PI),         0,  0],
};

// ---------------------------------------------------------------------------
// 6. Append New Buffers, Accessors, Nodes, Skin & Animation into glTF JSON
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

// 6a. Skinning vertex attributes on Mesh 0 Primitive 0
const jointsBv = appendBufferView(jointsData, 34962);  // ARRAY_BUFFER
const weightsBv = appendBufferView(weightsData, 34962);
prim.attributes.JOINTS_0 = appendAccessor(jointsBv, 5121, vertCount, 'VEC4');  // UNSIGNED_BYTE
prim.attributes.WEIGHTS_0 = appendAccessor(weightsBv, 5126, vertCount, 'VEC4'); // FLOAT

// 6b. Inverse Bind Matrices
const ibmBv = appendBufferView(ibmData);
const ibmAcc = appendAccessor(ibmBv, 5126, BONES.length, 'MAT4');

// 6c. Build Clean Scene Graph:
//     Node 0: Root wrapper ("Normal_Zombie_Root") -> children: [MeshNode(1), Hips(2)]
//     Node 1: SkinnedMesh ("Normal_Zombie_Mesh", mesh: 0, skin: 0) at identity transform
//     Nodes 2..18: 17 Bone Joint Nodes
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
  { name: 'Normal_Zombie_Root', children: [MESH_NODE_IDX, FIRST_BONE_NODE] },
  { name: 'Normal_Zombie_Mesh', mesh: 0, skin: 0 },
  ...boneNodes,
];

gltf.scenes = [{ name: 'Scene', nodes: [0] }];
gltf.scene = 0;

gltf.skins = [
  {
    name: 'ZombieSkeleton',
    inverseBindMatrices: ibmAcc,
    skeleton: FIRST_BONE_NODE,
    joints: boneNodeIndices,
  },
];

// 6d. Build "Walk" Animation Clip
const timesBv = appendBufferView(timesData);
const timesAcc = appendAccessor(timesBv, 5126, KEYS + 1, 'SCALAR', [0], [DURATION]);

const samplers = [];
const channels = [];

// Hips translation channel
const hipsTransData = bakeHipsTranslationTrack();
const hipsTransBv = appendBufferView(hipsTransData);
const hipsTransAcc = appendAccessor(hipsTransBv, 5126, KEYS + 1, 'VEC3');
samplers.push({ input: timesAcc, interpolation: 'LINEAR', output: hipsTransAcc });
channels.push({ sampler: samplers.length - 1, target: { node: FIRST_BONE_NODE, path: 'translation' } });

// Bone rotation channels
for (const [boneName, rotFn] of Object.entries(ANIM_ROT_TRACKS)) {
  const boneLocalIdx = BONE_INDEX[boneName];
  const nodeIdx = FIRST_BONE_NODE + boneLocalIdx;
  const quatData = bakeQuatTrack(rotFn);
  const bvIdx = appendBufferView(quatData);
  const accIdx = appendAccessor(bvIdx, 5126, KEYS + 1, 'VEC4');
  samplers.push({ input: timesAcc, interpolation: 'LINEAR', output: accIdx });
  channels.push({ sampler: samplers.length - 1, target: { node: nodeIdx, path: 'rotation' } });
}

gltf.animations = [{ name: 'Walk', channels, samplers }];

// ---------------------------------------------------------------------------
// 7. Write Rigged & Animated GLB + Self-Verify with Three.js GLTFLoader
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

// Self-verify SkinnedMesh + AnimationMixer parse cleanly in Three.js
const THREE = await import(pathToFileURL(resolve(THREE_ROOT, 'build/three.module.js')).href);
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
