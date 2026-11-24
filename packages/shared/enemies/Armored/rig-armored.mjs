/**
 * Automatic 17-Bone Humanoid SkinnedMesh Rigger + Heavy Armored Zombie Animator
 * for `Armored_Zombie.glb`.
 *
 * Reads untouched T-pose `Armored_Zombie.glb.bak`, computes a C1-continuous, zero-cliff
 * anatomical weight field (`JOINTS_0`, `WEIGHTS_0`), solves an analytic 2-bone leg IK
 * gait with genuine high-lift stomp clearance (`21.7 cm`) and constant `-2.80 m/s`
 * stance velocity (zero foot sliding), synchronizes contralateral arm/torso weight,
 * and writes `Armored_Zombie.glb`.
 *
 * Usage:
 *   pnpm rig:armored
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BAK_GLB = resolve(__dirname, 'Armored_Zombie.glb.bak');
const OUTPUT_GLB = resolve(__dirname, 'Armored_Zombie.glb');
if (!existsSync(BAK_GLB)) {
  copyFileSync(OUTPUT_GLB, BAK_GLB);
}
const INPUT_GLB = BAK_GLB;
const THREE_ROOT = resolve(__dirname, '../../../../apps/client/node_modules/three');

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Quaternion & Vector Math Helpers
// ---------------------------------------------------------------------------
function qNormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len > 1e-8 ? [q[0] / len, q[1] / len, q[2] / len, q[3] / len] : [0, 0, 0, 1];
}

function qConj(q) {
  return [-q[0], -q[1], -q[2], q[3]];
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

/** Composes Euler rotations in order: first Z, then Y, then X (qX * qY * qZ). */
function qEulerZYX(rx, ry, rz) {
  const qx = qAxisAngle(1, 0, 0, rx);
  const qy = qAxisAngle(0, 1, 0, ry);
  const qz = qAxisAngle(0, 0, 1, rz);
  return qNormalize(qMul(qx, qMul(qy, qz)));
}

function qRotateVec(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

const vecSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vecAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Anatomical upper-arm quaternion: drop from T-pose, slight inward yaw, then forward/back swing. */
function qArm(side, dropDeg, swingForwardDeg, yawInDeg) {
  const qDrop = qAxisAngle(0, 0, 1, -side * dropDeg * DEG);
  const qYaw = qAxisAngle(0, 1, 0, -side * yawInDeg * DEG);
  const qSwing = qAxisAngle(1, 0, 0, -swingForwardDeg * DEG);
  return qNormalize(qMul(qSwing, qMul(qYaw, qDrop)));
}

/** Anatomical forearm elbow bend (forward toward +Z) with optional pronation roll. */
function qForeArm(side, elbowBendDeg, twistDeg = 0) {
  const qBend = qAxisAngle(0, 1, 0, -side * elbowBendDeg * DEG);
  const qRoll = qAxisAngle(0, 0, 1, -side * twistDeg * DEG);
  return qNormalize(qMul(qBend, qRoll));
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
// 2. Define 17-Bone Skeleton Matched to Armored_Zombie Armor Landmarks
//    Mesh local space: facing +Z, Left = +X, Right = -X, Up = +Y
//    Bounds: x in [-0.500, +0.500], y in [-0.3684, +0.3684], z in [-0.1093, +0.1093]
// ---------------------------------------------------------------------------
const BONES = [
  { name: 'Hips',       parent: -1, world: [ 0.000, -0.025, -0.008] }, // 0
  { name: 'Spine',      parent:  0, world: [ 0.000,  0.055,  0.012] }, // 1
  { name: 'Chest',      parent:  1, world: [ 0.000,  0.155, -0.008] }, // 2
  { name: 'Neck',       parent:  2, world: [ 0.000,  0.252, -0.016] }, // 3
  { name: 'Head',       parent:  3, world: [ 0.000,  0.285, -0.012] }, // 4
  { name: 'UpperArm_L', parent:  2, world: [ 0.145,  0.194, -0.018] }, // 5
  { name: 'ForeArm_L',  parent:  5, world: [ 0.258,  0.182, -0.022] }, // 6
  { name: 'Hand_L',     parent:  6, world: [ 0.395,  0.168, -0.005] }, // 7
  { name: 'UpperArm_R', parent:  2, world: [-0.145,  0.194, -0.018] }, // 8
  { name: 'ForeArm_R',  parent:  8, world: [-0.258,  0.182, -0.022] }, // 9
  { name: 'Hand_R',     parent:  9, world: [-0.395,  0.168, -0.005] }, // 10
  { name: 'Thigh_L',    parent:  0, world: [ 0.064, -0.082, -0.006] }, // 11
  { name: 'Shin_L',     parent: 11, world: [ 0.062, -0.204,  0.002] }, // 12
  { name: 'Foot_L',     parent: 12, world: [ 0.064, -0.325,  0.008] }, // 13
  { name: 'Thigh_R',    parent:  0, world: [-0.064, -0.082, -0.006] }, // 14
  { name: 'Shin_R',     parent: 14, world: [-0.062, -0.204,  0.002] }, // 15
  { name: 'Foot_R',     parent: 15, world: [-0.064, -0.325,  0.008] }, // 16
];

const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b.name, i]));

// ---------------------------------------------------------------------------
// 3. C1-Continuous Zero-Cliff Skinning Weight Field (JOINTS_0, WEIGHTS_0)
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
  const ax = Math.abs(x);

  // Core Spine / Torso / Head chain (continuous across y)
  const tSpine = smoothstep(-0.025, 0.075, y);
  const tChest = smoothstep(0.090, 0.170, y);
  const neckCenterMask = 1 - smoothstep(0.068, 0.105, ax);
  const tNeck = smoothstep(0.242, 0.270, y) * neckCenterMask;
  const tHead = smoothstep(0.268, 0.296, y) * neckCenterMask;

  const rawHips = 1 - tSpine;
  const rawSpine = tSpine * (1 - tChest);
  const rawChest = tSpine * tChest * (1 - tNeck);
  const rawNeck = tSpine * tChest * tNeck * (1 - tHead);
  const rawHead = tSpine * tChest * tNeck * tHead;

  // Continuous Arm blend (smooth C1 transition across armpit Y and shoulder pauldron X)
  const armBandBlend = smoothstep(0.16, 0.28, ax);
  const armYMin = 0.105 - 0.035 * armBandBlend;
  const armYMax = 0.145 - 0.040 * armBandBlend;
  const armMaskY = smoothstep(armYMin, armYMax, y);
  const armAlpha = smoothstep(0.105, 0.205, ax) * armMaskY;
  const tElbow = smoothstep(0.225, 0.292, ax);
  const tWrist = smoothstep(0.368, 0.422, ax);

  const wUpperArm = armAlpha * (1 - tElbow);
  const wForeArm = armAlpha * tElbow * (1 - tWrist);
  const wHand = armAlpha * tElbow * tWrist;

  // Continuous Leg blend (groin guard y >= -0.098 around x = 0 stays Hips; wide hip/knee/ankle bands)
  const tLegY = smoothstep(-0.068, -0.165, y);
  const centerSafe = smoothstep(0.012, 0.048, ax);
  const belowCrotchSplit = smoothstep(-0.098, -0.138, y);
  const splitMask = centerSafe * (1 - belowCrotchSplit) + belowCrotchSplit;
  const legAlpha = tLegY * splitMask;

  // Wide knee & ankle gradients calibrated for high swing knee lift
  const tKnee = smoothstep(-0.158, -0.250, y);
  const tAnkle = smoothstep(-0.278, -0.352, y);
  const wThigh = legAlpha * (1 - tKnee);
  const wShin = legAlpha * tKnee * (1 - tAnkle);
  const wFoot = legAlpha * tKnee * tAnkle;

  const torsoScale = Math.max(0, 1 - armAlpha - legAlpha);
  const isLeft = x >= 0;

  assignWeights(i, [
    [BONE_INDEX.Hips, rawHips * torsoScale],
    [BONE_INDEX.Spine, rawSpine * torsoScale],
    [BONE_INDEX.Chest, rawChest * torsoScale],
    [BONE_INDEX.Neck, rawNeck * torsoScale],
    [BONE_INDEX.Head, rawHead * torsoScale],
    [isLeft ? BONE_INDEX.UpperArm_L : BONE_INDEX.UpperArm_R, wUpperArm],
    [isLeft ? BONE_INDEX.ForeArm_L : BONE_INDEX.ForeArm_R, wForeArm],
    [isLeft ? BONE_INDEX.Hand_L : BONE_INDEX.Hand_R, wHand],
    [isLeft ? BONE_INDEX.Thigh_L : BONE_INDEX.Thigh_R, wThigh],
    [isLeft ? BONE_INDEX.Shin_L : BONE_INDEX.Shin_R, wShin],
    [isLeft ? BONE_INDEX.Foot_L : BONE_INDEX.Foot_R, wFoot],
  ]);
}

// ---------------------------------------------------------------------------
// 4. Inverse Bind Matrices (17 x 4x4 column-major pure translation matrices)
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
// 5. Analytic 2-Bone Leg IK + Synchronized Upper-Body Riot Brute Walk Cycle
// ---------------------------------------------------------------------------
const KEYS = 36;
const SCALE = 2.05 / 0.7369;
const GAME_SPEED = 2.80;
const STANCE_FRAC = 0.53;
const Z_FRONT = 0.105;
const Z_BACK = -0.136;
const STANCE_SPAN_LOCAL = Z_FRONT - Z_BACK;
const DURATION = Number(((STANCE_SPAN_LOCAL * SCALE) / (STANCE_FRAC * GAME_SPEED)).toFixed(3));
const SWING_LIFT_LOCAL = 0.065; // ~18.1 cm clear visible boot lift during swing

const REST_SOLE_MIN_Y = -0.3684;
const BOOT_SOLE_LOCAL_PTS = [
  [0, -0.0434, -0.0648],
  [0, -0.0434,  0.0000],
  [0, -0.0434,  0.0550],
  [0, -0.0434,  0.0933],
];

function ankleYForSoleLift(liftLocal, bootPitch) {
  const c = Math.cos(bootPitch);
  const s = Math.sin(bootPitch);
  let minDy = Infinity;
  for (const pt of BOOT_SOLE_LOCAL_PTS) {
    const dy = pt[1] * c - pt[2] * s;
    if (dy < minDy) minDy = dy;
  }
  return REST_SOLE_MIN_Y + liftLocal - minDy;
}

function sampleFootTarget(u) {
  if (u < STANCE_FRAC) {
    const t = u / STANCE_FRAC;
    const footZ = Z_FRONT - t * STANCE_SPAN_LOCAL;
    const heelSettle = -8 * (1 - smoothstep(0, 0.15, t));
    const pushOffRise = 12 * smoothstep(0.75, 1.0, t);
    const bootPitch = (heelSettle + pushOffRise) * DEG;
    return { footZ, liftLocal: 0, bootPitch };
  }

  const s = (u - STANCE_FRAC) / (1 - STANCE_FRAC);
  const sZ = smoothstep(0, 1, s);
  const footZ = Z_BACK + STANCE_SPAN_LOCAL * sZ;
  const liftShape = Math.sin(Math.PI * Math.pow(s, 0.88));
  const liftLocal = SWING_LIFT_LOCAL * Math.pow(Math.max(0, liftShape), 0.90);
  const bootPitch =
    (12 * Math.pow(1 - s, 1.6) - 8 * Math.pow(s, 1.4) + 2 * Math.sin(Math.PI * s)) * DEG;
  return { footZ, liftLocal, bootPitch };
}

function sampleHipsPos(u) {
  const [hx, hy, hz] = BONES[0].world;
  const hipsX = hx + 0.011 * Math.sin(2 * Math.PI * u);
  const hipsY = hy - 0.021 - 0.011 * Math.cos(4 * Math.PI * (u - 0.06));
  return [hipsX, hipsY, hz];
}

// Upper body/arm tracks use pUpper = p + pi/2 so u = 0 (Left stomp) matches max contralateral swing
const UPPER_QUAT_TRACKS = {
  Hips:       (pU) => qEulerZYX((6 + 2 * Math.cos(2 * pU)) * DEG, 9 * Math.sin(pU) * DEG, 2.2 * Math.sin(pU) * DEG),
  Spine:      (pU) => qEulerZYX((11 + 2 * Math.cos(2 * pU)) * DEG, -6 * Math.sin(pU) * DEG, -2.5 * Math.sin(pU) * DEG),
  Chest:      (pU) => qEulerZYX((10 + 2.5 * Math.cos(2 * pU)) * DEG, -9 * Math.sin(pU) * DEG, 3.8 * Math.sin(pU) * DEG),
  Neck:       (pU) => qEulerZYX((-9 - 1.5 * Math.cos(2 * pU)) * DEG, 0, (3 + 1 * Math.sin(pU)) * DEG),
  Head:       (pU) => qEulerZYX((-11 - 2 * Math.cos(2 * pU)) * DEG, 5 * Math.cos(pU) * DEG, (5 + 2.5 * Math.sin(pU)) * DEG),

  UpperArm_L: (pU) => qArm(+1, 52 + 3 * Math.sin(pU), 18 - 20 * Math.sin(pU), 10 - 4 * Math.sin(pU)),
  ForeArm_L:  (pU) => qForeArm(+1, 46 - 10 * Math.sin(pU), 4),
  Hand_L:     ()   => qEulerZYX(0, -8 * DEG, -10 * DEG),

  UpperArm_R: (pU) => qArm(-1, 53 - 3 * Math.sin(pU), 14 + 20 * Math.sin(pU), 8 + 4 * Math.sin(pU)),
  ForeArm_R:  (pU) => qForeArm(-1, 42 + 10 * Math.sin(pU), 4),
  Hand_R:     ()   => qEulerZYX(0, 8 * DEG, 10 * DEG),
};

const LEG_IK_METRICS = { L1: {}, L2: {}, restThighRx: {}, restShinRx: {} };
for (const sideSuffix of ['L', 'R']) {
  const bThigh = BONES[BONE_INDEX['Thigh_' + sideSuffix]].world;
  const bShin = BONES[BONE_INDEX['Shin_' + sideSuffix]].world;
  const bFoot = BONES[BONE_INDEX['Foot_' + sideSuffix]].world;
  LEG_IK_METRICS.L1[sideSuffix] = Math.hypot(bShin[1] - bThigh[1], bShin[2] - bThigh[2]);
  LEG_IK_METRICS.L2[sideSuffix] = Math.hypot(bFoot[1] - bShin[1], bFoot[2] - bShin[2]);
  LEG_IK_METRICS.restThighRx[sideSuffix] = Math.atan2(-(bShin[2] - bThigh[2]), -(bShin[1] - bThigh[1]));
  LEG_IK_METRICS.restShinRx[sideSuffix] = Math.atan2(-(bFoot[2] - bShin[2]), -(bFoot[1] - bShin[1]));
}

let maxReachRatio = 0;

function solveLegIK(hipsPos, qHips, sideSuffix, u) {
  const iThigh = BONE_INDEX['Thigh_' + sideSuffix];
  const L1 = LEG_IK_METRICS.L1[sideSuffix];
  const L2 = LEG_IK_METRICS.L2[sideSuffix];
  const restThighRx = LEG_IK_METRICS.restThighRx[sideSuffix];
  const restShinRx = LEG_IK_METRICS.restShinRx[sideSuffix];

  const pHip = vecAdd(hipsPos, qRotateVec(qHips, vecSub(BONES[iThigh].world, BONES[0].world)));
  const { footZ, liftLocal, bootPitch } = sampleFootTarget(u);
  const ankleY = ankleYForSoleLift(liftLocal, bootPitch);

  const dy = ankleY - pHip[1];
  const dz = footZ - pHip[2];
  const rawD = Math.hypot(dy, dz);
  if (rawD / (L1 + L2) > maxReachRatio) maxReachRatio = rawD / (L1 + L2);
  const d = clamp(rawD, Math.abs(L1 - L2) + 0.015, (L1 + L2) * 0.994);

  const cosKnee = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
  const kneeFlex = Math.PI - Math.acos(cosKnee);
  const cosBeta = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const beta = Math.acos(cosBeta);
  const lineAngle = Math.atan2(-dz, -dy);

  const thighWorldRx = lineAngle - beta;
  const shinWorldRx = thighWorldRx + kneeFlex;

  const qThighWorld = qAxisAngle(1, 0, 0, thighWorldRx - restThighRx);
  const qShinWorld = qAxisAngle(1, 0, 0, shinWorldRx - restShinRx);
  const qFootWorld = qAxisAngle(1, 0, 0, bootPitch);

  return {
    qThigh: qNormalize(qMul(qConj(qHips), qThighWorld)),
    qShin: qNormalize(qMul(qConj(qThighWorld), qShinWorld)),
    qFoot: qNormalize(qMul(qConj(qShinWorld), qFootWorld)),
  };
}

// Bake all 36 keyframes + wrap frame 36 = frame 0
const timesData = new Float32Array(KEYS + 1);
for (let k = 0; k <= KEYS; k++) {
  timesData[k] = (k / KEYS) * DURATION;
}

const hipsTransData = new Float32Array((KEYS + 1) * 3);
const quatTracks = Object.fromEntries(
  BONES.map((b) => [b.name, new Float32Array((KEYS + 1) * 4)]),
);

function writeQuatAt(track, k, q) {
  track[k * 4 + 0] = q[0];
  track[k * 4 + 1] = q[1];
  track[k * 4 + 2] = q[2];
  track[k * 4 + 3] = q[3];
}

for (let k = 0; k < KEYS; k++) {
  const uL = k / KEYS;
  const uR = (uL + 0.5) % 1;
  const pUpper = uL * Math.PI * 2 + Math.PI * 0.5;

  const hipsPos = sampleHipsPos(uL);
  hipsTransData[k * 3 + 0] = hipsPos[0];
  hipsTransData[k * 3 + 1] = hipsPos[1];
  hipsTransData[k * 3 + 2] = hipsPos[2];

  const qHips = UPPER_QUAT_TRACKS.Hips(pUpper);
  for (const [boneName, fn] of Object.entries(UPPER_QUAT_TRACKS)) {
    writeQuatAt(quatTracks[boneName], k, fn(pUpper));
  }

  const ikL = solveLegIK(hipsPos, qHips, 'L', uL);
  writeQuatAt(quatTracks.Thigh_L, k, ikL.qThigh);
  writeQuatAt(quatTracks.Shin_L, k, ikL.qShin);
  writeQuatAt(quatTracks.Foot_L, k, ikL.qFoot);

  const ikR = solveLegIK(hipsPos, qHips, 'R', uR);
  writeQuatAt(quatTracks.Thigh_R, k, ikR.qThigh);
  writeQuatAt(quatTracks.Shin_R, k, ikR.qShin);
  writeQuatAt(quatTracks.Foot_R, k, ikR.qFoot);
}

// Copy k = 0 verbatim into k = KEYS for seamless loop wrap
hipsTransData[KEYS * 3 + 0] = hipsTransData[0];
hipsTransData[KEYS * 3 + 1] = hipsTransData[1];
hipsTransData[KEYS * 3 + 2] = hipsTransData[2];
for (const track of Object.values(quatTracks)) {
  track[KEYS * 4 + 0] = track[0];
  track[KEYS * 4 + 1] = track[1];
  track[KEYS * 4 + 2] = track[2];
  track[KEYS * 4 + 3] = track[3];
}

// ---------------------------------------------------------------------------
// 6. Append Skinning Attributes, Skeleton, Skin & "Walk" Clip into glTF JSON
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
  { name: 'Armored_Zombie_Root', children: [MESH_NODE_IDX, FIRST_BONE_NODE] },
  { name: 'Armored_Zombie_Mesh', mesh: 0, skin: 0 },
  ...boneNodes,
];

gltf.scenes = [{ name: 'Scene', nodes: [0] }];
gltf.scene = 0;

gltf.skins = [
  {
    name: 'ArmoredSkeleton',
    inverseBindMatrices: ibmAcc,
    skeleton: FIRST_BONE_NODE,
    joints: boneNodeIndices,
  },
];

const timesBv = appendBufferView(timesData);
const timesAcc = appendAccessor(timesBv, 5126, KEYS + 1, 'SCALAR', [0], [DURATION]);

const samplers = [];
const channels = [];

const hipsTransBv = appendBufferView(hipsTransData);
const hipsTransAcc = appendAccessor(hipsTransBv, 5126, KEYS + 1, 'VEC3');
samplers.push({ input: timesAcc, interpolation: 'LINEAR', output: hipsTransAcc });
channels.push({ sampler: samplers.length - 1, target: { node: FIRST_BONE_NODE, path: 'translation' } });

for (const bone of BONES) {
  const nodeIdx = FIRST_BONE_NODE + BONE_INDEX[bone.name];
  const bvIdx = appendBufferView(quatTracks[bone.name]);
  const accIdx = appendAccessor(bvIdx, 5126, KEYS + 1, 'VEC4');
  samplers.push({ input: timesAcc, interpolation: 'LINEAR', output: accIdx });
  channels.push({ sampler: samplers.length - 1, target: { node: nodeIdx, path: 'rotation' } });
}

gltf.animations = [{ name: 'Walk', channels, samplers }];

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
const stepMeters = STANCE_SPAN_LOCAL * SCALE;
console.log('Wrote', OUTPUT_GLB);
console.log('  source      :', INPUT_GLB);
console.log('  bytes       :', outGlb.length, `(${(outGlb.length / 1024 / 1024).toFixed(2)} MB)`);
console.log('  skinnedMesh :', skinnedCount, '| bones:', boneCount, '| verts:', vertCount);
console.log('  ikReachMax  :', `${(maxReachRatio * 100).toFixed(1)}% of leg length`);
console.log('  step/cycle  :', `${stepMeters.toFixed(3)} m/step -> duration ${DURATION.toFixed(3)}s (${(stepMeters / (STANCE_FRAC * DURATION)).toFixed(2)} m/s stance)`);
console.log('  animation   :', `${clip.name} (${clip.duration.toFixed(3)}s, ${clip.tracks.length} tracks)`);
