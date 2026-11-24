/**
 * Automated 6-Node Mechanical Articulated Rigger & Animator
 * for `Turret_level_0.glb`.
 *
 * Backs up untouched `Turret_level_0.glb` -> `Turret_level_0.glb.bak`, normalizes scale &
 * pivots (`WORLD_SCALE = 3.6`, bolted pedestal flush on `y = 0`, slew center at `(0,0,0)`),
 * cleanly partitions triangles into articulated sub-meshes (`Base_Static`, `Turret_Yaw`,
 * `Turret_Pitch`, `Barrel_Recoil`) plus `Muzzle_Socket` & `Eject_Socket`, adds machined
 * dark gunmetal internal bearing/trunnion/recoil hardware plugs so no rotation/recoil pose
 * reveals hollow seams, bakes `Idle_Scan` & `Fire_Recoil` glTF 2.0 AnimationClips, and
 * self-verifies via Three.js GLTFLoader.
 *
 * Usage:
 *   pnpm rig:turret
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BAK_GLB = resolve(__dirname, 'Turret_level_0.glb.bak');
const OUTPUT_GLB = resolve(__dirname, 'Turret_level_0.glb');
if (!existsSync(BAK_GLB)) {
  copyFileSync(OUTPUT_GLB, BAK_GLB);
}
const THREE_ROOT = resolve(__dirname, '../../../../apps/client/node_modules/three');

// ---------------------------------------------------------------------------
// 1. Calibration Constants (derived from fine Y/Z cross-sections of Turret_level_0)
// ---------------------------------------------------------------------------
const WORLD_SCALE = 3.6;
const RAW_CENTER_X = 0.0;
const RAW_MIN_Y = -0.2431;
const RAW_SLEW_Z = -0.1795;

const toWorld = (rx, ry, rz) => [
  (rx - RAW_CENTER_X) * WORLD_SCALE,
  (ry - RAW_MIN_Y) * WORLD_SCALE,
  (rz - RAW_SLEW_Z) * WORLD_SCALE,
];

const DEG = Math.PI / 180;

// World joint origins
const PIVOT_BASE = [0, 0, 0];
const PIVOT_YAW = [0, 0.1984, 0];
const PIVOT_PITCH = [0, 1.2049, -0.0738]; // raw (0, 0.0916, -0.2000) -- exact center of cheek-plate bearing hubs
const PIVOT_BARREL = [0.0054, 1.5016, 0.5310];
// Socket offsets relative to owning parent node
const MUZZLE_LOCAL = [0.0029, 0.0144, 1.9224]; // relative to Barrel_Recoil
const EJECT_LOCAL = [-0.414, 0.2643, -0.0720]; // relative to Turret_Pitch (+Z forward -> -X is right side)

// ---------------------------------------------------------------------------
// 2. Parse Untouched Source GLB & Image Asset
// ---------------------------------------------------------------------------
const srcGlb = readFileSync(BAK_GLB);
if (srcGlb.readUInt32LE(0) !== 0x46546c67) {
  throw new Error('Turret_level_0.glb.bak is not a valid glTF 2.0 binary (.glb)');
}

const srcJsonLen = srcGlb.readUInt32LE(12);
const srcGltf = JSON.parse(srcGlb.subarray(20, 20 + srcJsonLen).toString('utf8'));
const srcBinOff = 20 + srcJsonLen;
const srcBinLen = srcGlb.readUInt32LE(srcBinOff);
const srcBin = Buffer.from(srcGlb.subarray(srcBinOff + 8, srcBinOff + 8 + srcBinLen));

const readAccessorFloat = (gltf, bin, accIdx, components) => {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const byteOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || components * 4;
  const out = new Float32Array(acc.count * components);
  for (let i = 0; i < acc.count; i++) {
    const base = byteOff + i * stride;
    for (let k = 0; k < components; k++) {
      out[i * components + k] = bin.readFloatLE(base + k * 4);
    }
  }
  return out;
};

const readAccessorIndices = (gltf, bin, accIdx) => {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const byteOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Uint32Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    if (acc.componentType === 5125) out[i] = bin.readUInt32LE(byteOff + i * 4);
    else if (acc.componentType === 5123) out[i] = bin.readUInt16LE(byteOff + i * 2);
    else out[i] = bin.readUInt8(byteOff + i);
  }
  return out;
};

const srcPrim = srcGltf.meshes[0].primitives[0];
const srcPos = readAccessorFloat(srcGltf, srcBin, srcPrim.attributes.POSITION, 3);
const srcNorm = readAccessorFloat(srcGltf, srcBin, srcPrim.attributes.NORMAL, 3);
const srcUv = readAccessorFloat(srcGltf, srcBin, srcPrim.attributes.TEXCOORD_0, 2);
const srcIdx = readAccessorIndices(srcGltf, srcBin, srcPrim.indices);

// Extract embedded diffuse PNG bytes cleanly
const srcImgBv = srcGltf.bufferViews[srcGltf.images[0].bufferView];
const imageBytes = Buffer.from(
  srcBin.subarray(srcImgBv.byteOffset || 0, (srcImgBv.byteOffset || 0) + srcImgBv.byteLength),
);

// ---------------------------------------------------------------------------
// 3. Partition Triangles Cleanly Into Articulated Sub-Meshes
// ---------------------------------------------------------------------------
const PART_SPECS = [
  { name: 'Base_Static', pivot: PIVOT_BASE },
  { name: 'Turret_Yaw', pivot: PIVOT_YAW },
  { name: 'Turret_Pitch', pivot: PIVOT_PITCH },
  { name: 'Barrel_Recoil', pivot: PIVOT_BARREL },
];

const cheekBotY = (z) => {
  if (z <= -0.106) return 0.0535;
  const t = Math.max(0, Math.min(1, (z - (-0.106)) / (-0.039 - (-0.106))));
  return 0.0535 - 0.0420 * Math.pow(t, 1.45);
};

const centerBotY = (z) => {
  // Behind front ribbed ramp (z <= -0.165): pass cleanly under rear V-frame & diagonal hydraulic valve pipes
  // Over front ribbed ramp (z >= -0.145): stay above the fixed yellow ribbed front glacis
  if (z <= -0.165) return 0.0515;
  if (z >= -0.145) return 0.062;
  const t = (z - (-0.165)) / 0.020;
  return 0.0515 + 0.0105 * t;
};

// > 0 => Base_Static, <= 0 => upper turret
const baseSDF = (_x, y, _z) => -0.188 - y;

// >= 0 => Turret_Pitch (+ Barrel_Recoil), < 0 => Turret_Yaw
const pitchSDF = (x, y, z) => {
  const ax = Math.abs(x);
  const fUpper = y - 0.080;
  const fCenter = Math.min(0.092 - ax, y - centerBotY(z), z - (-0.375));
  const fCheek = Math.min(0.1252 - ax, z - (-0.2485), (-0.036) - z, y - cheekBotY(z));
  const fBoss = Math.min(0.146 - ax, 0.0365 - Math.hypot(y - 0.0916, z + 0.2000), y - 0.0575);
  return Math.max(fUpper, fCenter, fCheek, fBoss);
};

// >= 0 => Barrel_Recoil, < 0 => Turret_Pitch
const barrelSDF = (x, y, z) => Math.min(z - (-0.032), y - 0.125, 0.058 - Math.abs(x));

const lerpVert = (a, b, t) => {
  const nx = a.nx + (b.nx - a.nx) * t;
  const ny = a.ny + (b.ny - a.ny) * t;
  const nz = a.nz + (b.nz - a.nz) * t;
  const nLen = Math.hypot(nx, ny, nz) || 1;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    nx: nx / nLen,
    ny: ny / nLen,
    nz: nz / nLen,
    u: a.u + (b.u - a.u) * t,
    v: a.v + (b.v - a.v) * t,
  };
};

const splitTriBySDF = (tri, sdfFn, outPos, outNeg) => {
  const [v0, v1, v2] = tri;
  const ds = [sdfFn(v0.x, v0.y, v0.z), sdfFn(v1.x, v1.y, v1.z), sdfFn(v2.x, v2.y, v2.z)];
  const posIdx = [];
  const negIdx = [];
  for (let i = 0; i < 3; i++) {
    if (ds[i] >= 0) posIdx.push(i);
    else negIdx.push(i);
  }
  if (posIdx.length === 3) {
    outPos.push(tri);
    return;
  }
  if (negIdx.length === 3) {
    outNeg.push(tri);
    return;
  }
  const isOnePos = posIdx.length === 1;
  const solo = isOnePos ? posIdx[0] : negIdx[0];
  const iA = (solo + 1) % 3;
  const iB = (solo + 2) % 3;
  const a = tri[solo];
  const b = tri[iA];
  const c = tri[iB];
  const tAB = ds[solo] / (ds[solo] - ds[iA]);
  const tAC = ds[solo] / (ds[solo] - ds[iB]);
  const mAB = lerpVert(a, b, tAB);
  const mAC = lerpVert(a, c, tAC);
  const soloOut = isOnePos ? outPos : outNeg;
  const pairOut = isOnePos ? outNeg : outPos;
  soloOut.push([a, mAB, mAC]);
  pairOut.push([mAB, b, c], [mAB, c, mAC]);
};

const partBuckets = PART_SPECS.map((spec) => ({
  ...spec,
  remap: new Map(),
  positions: [],
  normals: [],
  uvs: [],
  indices: [],
  triCount: 0,
}));

const pushClippedVert = (bucket, v) => {
  const key = `${Math.round(v.x * 1e5)},${Math.round(v.y * 1e5)},${Math.round(v.z * 1e5)},${Math.round(v.nx * 1e3)},${Math.round(v.ny * 1e3)},${Math.round(v.nz * 1e3)},${Math.round(v.u * 1e4)},${Math.round(v.v * 1e4)}`;
  const existing = bucket.remap.get(key);
  if (existing !== undefined) return existing;
  const newIdx = bucket.positions.length / 3;
  bucket.remap.set(key, newIdx);

  const w = toWorld(v.x, v.y, v.z);
  bucket.positions.push(
    w[0] - bucket.pivot[0],
    w[1] - bucket.pivot[1],
    w[2] - bucket.pivot[2],
  );

  const nLen = Math.hypot(v.nx, v.ny, v.nz) || 1;
  bucket.normals.push(v.nx / nLen, v.ny / nLen, v.nz / nLen);
  bucket.uvs.push(v.u, v.v);
  return newIdx;
};

const srcVert = (i) => ({
  x: srcPos[i * 3],
  y: srcPos[i * 3 + 1],
  z: srcPos[i * 3 + 2],
  nx: srcNorm[i * 3],
  ny: srcNorm[i * 3 + 1],
  nz: srcNorm[i * 3 + 2],
  u: srcUv[i * 2],
  v: srcUv[i * 2 + 1],
});

const baseTris = [];
const upperTris = [];
for (let t = 0; t < srcIdx.length; t += 3) {
  splitTriBySDF([srcVert(srcIdx[t]), srcVert(srcIdx[t + 1]), srcVert(srcIdx[t + 2])], baseSDF, baseTris, upperTris);
}

const pitchAndBarrelTris = [];
const yawTris = [];
for (const tri of upperTris) {
  splitTriBySDF(tri, pitchSDF, pitchAndBarrelTris, yawTris);
}

const barrelTris = [];
const pitchTris = [];
for (const tri of pitchAndBarrelTris) {
  splitTriBySDF(tri, barrelSDF, barrelTris, pitchTris);
}

const partitionedTris = [baseTris, yawTris, pitchTris, barrelTris];
for (let p = 0; p < 4; p++) {
  const bucket = partBuckets[p];
  for (const [a, b, c] of partitionedTris[p]) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    if (cx * cx + cy * cy + cz * cz < 1e-12) continue;
    bucket.indices.push(
      pushClippedVert(bucket, a),
      pushClippedVert(bucket, b),
      pushClippedVert(bucket, c),
    );
    bucket.triCount++;
  }
}

// ---------------------------------------------------------------------------
// 4. Procedural Machined Gunmetal Internal Hardware Plugs (zero hollow seams)
// ---------------------------------------------------------------------------
function createGeomBuilder() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const addVert = (x, y, z, nx, ny, nz) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    const idx = positions.length / 3;
    positions.push(x, y, z);
    normals.push(nx / l, ny / l, nz / l);
    uvs.push(0, 0);
    return idx;
  };

  /** Adds closed capped cylinder aligned along 'x' | 'y' | 'z'. */
  const addCylinder = (cx, cy, cz, axis, radius, length, radialSegs = 28) => {
    const half = length * 0.5;
    const toLocal = (u, v, ax) =>
      axis === 'y'
        ? [cx + u, cy + ax, cz + v]
        : axis === 'x'
          ? [cx + ax, cy + v, cz + u]
          : [cx + u, cy + v, cz + ax];
    const normAxis = (nu, nv, na) =>
      axis === 'y' ? [nu, na, nv] : axis === 'x' ? [na, nv, nu] : [nu, nv, na];

    // Side wall (counter-clockwise outward winding for all axes)
    const flipWinding = axis === 'y' || axis === 'x';
    const sideStart = positions.length / 3;
    for (let i = 0; i <= radialSegs; i++) {
      const a = (i / radialSegs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const pBot = toLocal(ca * radius, sa * radius, -half);
      const pTop = toLocal(ca * radius, sa * radius, half);
      const nSide = normAxis(ca, sa, 0);
      addVert(pBot[0], pBot[1], pBot[2], nSide[0], nSide[1], nSide[2]);
      addVert(pTop[0], pTop[1], pTop[2], nSide[0], nSide[1], nSide[2]);
    }
    for (let i = 0; i < radialSegs; i++) {
      const a = sideStart + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (flipWinding) {
        indices.push(a, b, c, c, b, d);
      } else {
        indices.push(a, c, b, c, d, b);
      }
    }

    // End caps
    for (const endSign of [-1, 1]) {
      const capPos = endSign * half;
      const nCap = normAxis(0, 0, endSign);
      const pCenter = toLocal(0, 0, capPos);
      const cIdx = addVert(pCenter[0], pCenter[1], pCenter[2], nCap[0], nCap[1], nCap[2]);
      const ringStart = positions.length / 3;
      for (let i = 0; i <= radialSegs; i++) {
        const a = (i / radialSegs) * Math.PI * 2;
        const p = toLocal(Math.cos(a) * radius, Math.sin(a) * radius, capPos);
        addVert(p[0], p[1], p[2], nCap[0], nCap[1], nCap[2]);
      }
      for (let i = 0; i < radialSegs; i++) {
        const v0 = ringStart + i;
        const v1 = ringStart + i + 1;
        const rev = flipWinding ? endSign > 0 : endSign < 0;
        if (rev) indices.push(cIdx, v1, v0);
        else indices.push(cIdx, v0, v1);
      }
    }
  };

  /** Adds closed axis-aligned box with outward CCW normals. */
  const addBox = (cx, cy, cz, sx, sy, sz) => {
    const x0 = cx - sx * 0.5;
    const x1 = cx + sx * 0.5;
    const y0 = cy - sy * 0.5;
    const y1 = cy + sy * 0.5;
    const z0 = cz - sz * 0.5;
    const z1 = cz + sz * 0.5;
    const faces = [
      { n: [1, 0, 0], pts: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
      { n: [-1, 0, 0], pts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
      { n: [0, 1, 0], pts: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
      { n: [0, -1, 0], pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
      { n: [0, 0, 1], pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
      { n: [0, 0, -1], pts: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
    ];
    for (const f of faces) {
      const i0 = addVert(f.pts[0][0], f.pts[0][1], f.pts[0][2], f.n[0], f.n[1], f.n[2]);
      const i1 = addVert(f.pts[1][0], f.pts[1][1], f.pts[1][2], f.n[0], f.n[1], f.n[2]);
      const i2 = addVert(f.pts[2][0], f.pts[2][1], f.pts[2][2], f.n[0], f.n[1], f.n[2]);
      const i3 = addVert(f.pts[3][0], f.pts[3][1], f.pts[3][2], f.n[0], f.n[1], f.n[2]);
      indices.push(i0, i1, i2, i0, i2, i3);
    }
  };

  return { addCylinder, addBox, positions, normals, uvs, indices };
}

const hwBuilders = [
  createGeomBuilder(), // 0: Base_Static
  createGeomBuilder(), // 1: Turret_Yaw
  createGeomBuilder(), // 2: Turret_Pitch
  createGeomBuilder(), // 3: Barrel_Recoil
];

// Slewing bearing collar on Base_Static at slew interface Y = 0.198m
hwBuilders[0].addCylinder(0, 0.198, 0, 'y', 0.46, 0.052, 32);
// Underside sealing disc + recessed trunnion saddle deck on Turret_Yaw (local space)
hwBuilders[1].addCylinder(0, 0.002, 0, 'y', 0.47, 0.032, 32);
hwBuilders[1].addBox(0, 0.772, -0.146, 0.54, 0.155, 0.46);
// Machined trunnion axle shaft, cradle/cheek underside seam seals, & jacket bore cap on Turret_Pitch (local space)
hwBuilders[2].addCylinder(0, 0, 0, 'x', 0.092, 0.84, 28);
hwBuilders[2].addBox(0, -0.101, 0.018, 0.42, 0.060, 0.36);
hwBuilders[2].addBox(0.391, -0.117, 0.090, 0.046, 0.020, 0.28);
hwBuilders[2].addBox(-0.391, -0.117, 0.090, 0.046, 0.020, 0.28);
hwBuilders[2].addCylinder(0.0054, 0.2967, 0.5048, 'z', 0.056, 0.16, 24);
// Telescoping inner hydraulic recoil sleeve on Barrel_Recoil (local space)
hwBuilders[3].addCylinder(0, 0, -0.14, 'z', 0.045, 0.26, 24);

// ---------------------------------------------------------------------------
// 5. Build Consolidated GLTF Buffer + Accessors + Nodes + Animation Clips
// ---------------------------------------------------------------------------
const chunks = [imageBytes];
let curByteLen = imageBytes.length;

const align4 = () => {
  const pad = (4 - (curByteLen % 4)) % 4;
  if (pad > 0) {
    chunks.push(Buffer.alloc(pad, 0));
    curByteLen += pad;
  }
};

const bufferViews = [];
const accessors = [];

const appendBV = (buf, target) => {
  align4();
  const byteOffset = curByteLen;
  chunks.push(buf);
  curByteLen += buf.length;
  const bv = { buffer: 0, byteOffset, byteLength: buf.length };
  if (target !== undefined) bv.target = target;
  bufferViews.push(bv);
  return bufferViews.length - 1;
};

const appendFloatAcc = (arr, type, comps, computeMinMax = false, target) => {
  const f32 = arr instanceof Float32Array ? arr : new Float32Array(arr);
  const raw = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
  const bvIdx = appendBV(raw, target);
  const acc = { bufferView: bvIdx, componentType: 5126, count: f32.length / comps, type };
  if (computeMinMax && f32.length >= comps) {
    const mn = new Array(comps).fill(Infinity);
    const mx = new Array(comps).fill(-Infinity);
    for (let i = 0; i < f32.length; i += comps) {
      for (let k = 0; k < comps; k++) {
        const v = f32[i + k];
        if (v < mn[k]) mn[k] = v;
        if (v > mx[k]) mx[k] = v;
      }
    }
    acc.min = mn;
    acc.max = mx;
  }
  accessors.push(acc);
  return accessors.length - 1;
};

const appendIndexAcc = (arr) => {
  const u32 = arr instanceof Uint32Array ? arr : new Uint32Array(arr);
  const raw = Buffer.from(u32.buffer, u32.byteOffset, u32.byteLength);
  const bvIdx = appendBV(raw, 34963);
  accessors.push({ bufferView: bvIdx, componentType: 5125, count: u32.length, type: 'SCALAR' });
  return accessors.length - 1;
};

// Keep bufferView[0] as the PNG image
bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: imageBytes.length });

// Create meshes (0..3) each with [diffuse hull primitive, gunmetal hardware primitive]
const meshes = [];
for (let p = 0; p < 4; p++) {
  const bucket = partBuckets[p];
  const hw = hwBuilders[p];
  const primitives = [];

  if (bucket.indices.length > 0) {
    primitives.push({
      attributes: {
        POSITION: appendFloatAcc(bucket.positions, 'VEC3', 3, true, 34962),
        NORMAL: appendFloatAcc(bucket.normals, 'VEC3', 3, false, 34962),
        TEXCOORD_0: appendFloatAcc(bucket.uvs, 'VEC2', 2, false, 34962),
      },
      indices: appendIndexAcc(bucket.indices),
      material: 0,
      mode: 4,
    });
  }
  if (hw.indices.length > 0) {
    primitives.push({
      attributes: {
        POSITION: appendFloatAcc(hw.positions, 'VEC3', 3, true, 34962),
        NORMAL: appendFloatAcc(hw.normals, 'VEC3', 3, false, 34962),
        TEXCOORD_0: appendFloatAcc(hw.uvs, 'VEC2', 2, false, 34962),
      },
      indices: appendIndexAcc(hw.indices),
      material: 1,
      mode: 4,
    });
  }
  meshes.push({ name: `${bucket.name}_Mesh`, primitives });
}

// Node hierarchy:
// 0: Tower_Root
// 1: Base_Static (mesh 0)
// 2: Turret_Yaw (mesh 1)
// 3: Turret_Pitch (mesh 2)
// 4: Barrel_Recoil (mesh 3)
// 5: Muzzle_Socket
// 6: Eject_Socket
const rel = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const barrelLocalInPitch = rel(PIVOT_BARREL, PIVOT_PITCH);

const nodes = [
  { name: 'Tower_Root', children: [1, 2] },
  { name: 'Base_Static', mesh: 0, translation: [0, 0, 0] },
  { name: 'Turret_Yaw', mesh: 1, translation: rel(PIVOT_YAW, PIVOT_BASE), rotation: [0, 0, 0, 1], children: [3] },
  { name: 'Turret_Pitch', mesh: 2, translation: rel(PIVOT_PITCH, PIVOT_YAW), rotation: [0, 0, 0, 1], children: [4, 6] },
  { name: 'Barrel_Recoil', mesh: 3, translation: barrelLocalInPitch, children: [5] },
  { name: 'Muzzle_Socket', translation: MUZZLE_LOCAL },
  { name: 'Eject_Socket', translation: EJECT_LOCAL },
];

// Animation 1: Idle_Scan (6.0s smooth sentry sweep + slight elevation scan)
const IDLE_DUR = 6.0;
const IDLE_KEYS = 60;
const idleTimes = new Float32Array(IDLE_KEYS + 1);
const idleYawQuats = new Float32Array((IDLE_KEYS + 1) * 4);
const idlePitchQuats = new Float32Array((IDLE_KEYS + 1) * 4);

for (let k = 0; k <= IDLE_KEYS; k++) {
  const u = k / IDLE_KEYS;
  idleTimes[k] = u * IDLE_DUR;
  const s = Math.sin(u * Math.PI * 2);
  const yawAngle = (Math.tanh(1.4 * s) / Math.tanh(1.4)) * (38 * DEG);
  const pitchAngle = -(1.5 + 2.5 * Math.sin(u * Math.PI * 4)) * DEG;
  idleYawQuats[k * 4] = 0;
  idleYawQuats[k * 4 + 1] = Math.sin(yawAngle * 0.5);
  idleYawQuats[k * 4 + 2] = 0;
  idleYawQuats[k * 4 + 3] = Math.cos(yawAngle * 0.5);

  idlePitchQuats[k * 4] = Math.sin(pitchAngle * 0.5);
  idlePitchQuats[k * 4 + 1] = 0;
  idlePitchQuats[k * 4 + 2] = 0;
  idlePitchQuats[k * 4 + 3] = Math.cos(pitchAngle * 0.5);
}

const idleTimeAcc = appendFloatAcc(idleTimes, 'SCALAR', 1, true);
const idleYawAcc = appendFloatAcc(idleYawQuats, 'VEC4', 4, false);
const idlePitchAcc = appendFloatAcc(idlePitchQuats, 'VEC4', 4, false);

// Animation 2: Fire_Recoil (0.22s hydraulic barrel kick + upward muzzle climb)
const FIRE_DUR = 0.22;
const FIRE_KEYS = 22;
const fireTimes = new Float32Array(FIRE_KEYS + 1);
const fireBarrelTrans = new Float32Array((FIRE_KEYS + 1) * 3);
const firePitchQuats = new Float32Array((FIRE_KEYS + 1) * 4);

const recoilEnv = (u) => {
  if (u <= 0 || u >= 1) return 0;
  if (u <= 0.11) return Math.sin((u / 0.11) * (Math.PI * 0.5));
  const dec = (u - 0.11) / 0.89;
  return Math.exp(-5.5 * dec) * (1 - Math.pow(dec, 4));
};

for (let k = 0; k <= FIRE_KEYS; k++) {
  const u = k / FIRE_KEYS;
  fireTimes[k] = u * FIRE_DUR;
  const env = recoilEnv(u);
  fireBarrelTrans[k * 3] = barrelLocalInPitch[0];
  fireBarrelTrans[k * 3 + 1] = barrelLocalInPitch[1];
  fireBarrelTrans[k * 3 + 2] = barrelLocalInPitch[2] - 0.165 * env;

  const kickRad = -2.8 * DEG * env;
  firePitchQuats[k * 4] = Math.sin(kickRad * 0.5);
  firePitchQuats[k * 4 + 1] = 0;
  firePitchQuats[k * 4 + 2] = 0;
  firePitchQuats[k * 4 + 3] = Math.cos(kickRad * 0.5);
}

const fireTimeAcc = appendFloatAcc(fireTimes, 'SCALAR', 1, true);
const fireBarrelAcc = appendFloatAcc(fireBarrelTrans, 'VEC3', 3, false);
const firePitchAcc = appendFloatAcc(firePitchQuats, 'VEC4', 4, false);

align4();
const finalBin = Buffer.concat(chunks);

const baseMat0 = srcGltf.materials?.[0] ?? {};
const outGltf = {
  asset: { version: '2.0', generator: 'DefenseKit RigTurret v1' },
  scene: 0,
  scenes: [{ name: 'Scene', nodes: [0] }],
  nodes,
  meshes,
  materials: [
    {
      name: baseMat0.name || 'modddif_material_0',
      pbrMetallicRoughness: {
        baseColorTexture: baseMat0.pbrMetallicRoughness?.baseColorTexture ?? { index: 0, texCoord: 0 },
        metallicFactor: 0.28,
        roughnessFactor: 0.62,
      },
    },
    {
      name: 'turret_mech_metal',
      pbrMetallicRoughness: {
        baseColorFactor: [0.14, 0.16, 0.19, 1],
        metallicFactor: 0.78,
        roughnessFactor: 0.36,
      },
    },
  ],
  textures: srcGltf.textures ?? [{ sampler: 0, source: 0 }],
  samplers: srcGltf.samplers ?? [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  images: [{ mimeType: srcGltf.images?.[0]?.mimeType || 'image/png', name: srcGltf.images?.[0]?.name || 'turret_diffuse.png', bufferView: 0 }],
  buffers: [{ byteLength: finalBin.length }],
  bufferViews,
  accessors,
  animations: [
    {
      name: 'Idle_Scan',
      samplers: [
        { input: idleTimeAcc, interpolation: 'LINEAR', output: idleYawAcc },
        { input: idleTimeAcc, interpolation: 'LINEAR', output: idlePitchAcc },
      ],
      channels: [
        { sampler: 0, target: { node: 2, path: 'rotation' } },
        { sampler: 1, target: { node: 3, path: 'rotation' } },
      ],
    },
    {
      name: 'Fire_Recoil',
      samplers: [
        { input: fireTimeAcc, interpolation: 'LINEAR', output: fireBarrelAcc },
        { input: fireTimeAcc, interpolation: 'LINEAR', output: firePitchAcc },
      ],
      channels: [
        { sampler: 0, target: { node: 4, path: 'translation' } },
        { sampler: 1, target: { node: 3, path: 'rotation' } },
      ],
    },
  ],
};

// Pad JSON chunk (0x20) & assemble GLB
const jsonRaw = Buffer.from(JSON.stringify(outGltf), 'utf8');
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
const binHdr = 20 + jsonPadded.length;
outGlb.writeUInt32LE(binPadded.length, binHdr);
outGlb.writeUInt32LE(0x004e4942, binHdr + 4);
binPadded.copy(outGlb, binHdr + 8);

writeFileSync(OUTPUT_GLB, outGlb);

// ---------------------------------------------------------------------------
// 6. Self-Verify via Three.js GLTFLoader + Compute World Bounds
// ---------------------------------------------------------------------------
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = async () => ({ width: 2048, height: 2048, close() {} });
}

const THREE = await import(pathToFileURL(resolve(THREE_ROOT, 'build/three.module.js')).href);
const { GLTFLoader } = await import(pathToFileURL(resolve(THREE_ROOT, 'examples/jsm/loaders/GLTFLoader.js')).href);

const parsed = await new Promise((res, rej) => {
  const loader = new GLTFLoader();
  const ab = outGlb.buffer.slice(outGlb.byteOffset, outGlb.byteOffset + outGlb.byteLength);
  loader.parse(ab, '', res, rej);
});

parsed.scene.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(parsed.scene);
const size = new THREE.Vector3();
box.getSize(size);

console.log('Wrote', OUTPUT_GLB);
console.log('  size  :', `${(outGlb.length / 1024 / 1024).toFixed(2)} MB | world bbox [${size.x.toFixed(2)}w x ${size.y.toFixed(2)}h x ${size.z.toFixed(2)}l] minY=${box.min.y.toFixed(4)}`);
for (const b of partBuckets) {
  console.log(`  part  : ${b.name.padEnd(14)} ${String(b.triCount).padStart(6)} tris (${b.positions.length / 3} verts)`);
}
for (const clip of parsed.animations) {
  console.log(`  clip  : ${clip.name} (${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks)`);
}
for (const n of ['Base_Static', 'Turret_Yaw', 'Turret_Pitch', 'Barrel_Recoil', 'Muzzle_Socket', 'Eject_Socket']) {
  const obj = parsed.scene.getObjectByName(n);
  if (!obj) throw new Error(`Missing required rig node: ${n}`);
  const wp = new THREE.Vector3();
  obj.getWorldPosition(wp);
  console.log(`  joint : ${n.padEnd(14)} world=(${wp.x.toFixed(3)}, ${wp.y.toFixed(3)}, ${wp.z.toFixed(3)})`);
}
