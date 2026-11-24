/**
 * Builds all 6 articulated Turret upgrade models (Levels 1-4 + dual Level 5 paths)
 * inheriting calibrated pivots, scale (`WORLD_SCALE = 3.6`, flush `y = 0`), and
 * weathered industrial yellow/gunmetal PBR geometry directly from `Turret_level_0.glb`.
 *
 * Outputs:
 *   Turret_level_1.glb        - Reinforced Sentry (no human rifle scope, brass belt, cooling sleeve)
 *   Turret_level_2.glb        - Twin Autocannon + Dual Drums + Sensor Pod
 *   Turret_level_3.glb        - Heavy Armored Twin-Shroud Fortress (4 stabilizer feet, ballistic shield)
 *   Turret_level_4.glb        - Rotary Minigun (6 cold gunmetal barrels on `Barrel_Spin`)
 *   Turret_level_5_top.glb    - Top Path: Heavy Electromagnetic Railgun (semi-auto big dmg)
 *   Turret_level_5_bottom.glb - Bottom Path: Twin Vulcan (12 cold steel barrels on `Barrel_Spin_L/R`)
 *
 * Usage:
 *   pnpm build:turret-upgrades
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LV0_GLB = resolve(__dirname, 'Turret_level_0.glb');
const THREE_ROOT = resolve(__dirname, '../../../../apps/client/node_modules/three');
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 1. Parse Calibrated Turret_level_0.glb Source Asset
// ---------------------------------------------------------------------------
const lv0Buf = readFileSync(LV0_GLB);
if (lv0Buf.readUInt32LE(0) !== 0x46546c67) {
  throw new Error('Turret_level_0.glb is not a valid glTF 2.0 binary (.glb)');
}
const lv0JsonLen = lv0Buf.readUInt32LE(12);
const lv0Gltf = JSON.parse(lv0Buf.subarray(20, 20 + lv0JsonLen).toString('utf8'));
const lv0BinOff = 20 + lv0JsonLen;
const lv0BinLen = lv0Buf.readUInt32LE(lv0BinOff);
const lv0Bin = Buffer.from(lv0Buf.subarray(lv0BinOff + 8, lv0BinOff + 8 + lv0BinLen));

const readAccessor = (gltf, bin, accIdx) => {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const comps = acc.type === 'VEC3' ? 3 : acc.type === 'VEC2' ? 2 : acc.type === 'VEC4' ? 4 : 1;
  if (acc.componentType === 5126) {
    const out = new Float32Array(acc.count * comps);
    const stride = bv.byteStride || comps * 4;
    for (let i = 0; i < acc.count; i++) {
      for (let k = 0; k < comps; k++) {
        out[i * comps + k] = bin.readFloatLE(off + i * stride + k * 4);
      }
    }
    return out;
  }
  const out = new Uint32Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    out[i] = acc.componentType === 5125 ? bin.readUInt32LE(off + i * 4) : bin.readUInt16LE(off + i * 2);
  }
  return out;
};

const extractMeshPrims = (nodeName) => {
  const node = lv0Gltf.nodes.find((n) => n.name === nodeName);
  if (!node || node.mesh === undefined) throw new Error(`Missing node ${nodeName} in Turret_level_0.glb`);
  const mesh = lv0Gltf.meshes[node.mesh];
  return {
    translation: [...(node.translation ?? [0, 0, 0])],
    primitives: mesh.primitives.map((prim) => ({
      material: prim.material ?? 0,
      positions: readAccessor(lv0Gltf, lv0Bin, prim.attributes.POSITION),
      normals: readAccessor(lv0Gltf, lv0Bin, prim.attributes.NORMAL),
      uvs: readAccessor(lv0Gltf, lv0Bin, prim.attributes.TEXCOORD_0),
      indices: readAccessor(lv0Gltf, lv0Bin, prim.indices),
    })),
  };
};

const lv0Parts = {
  base: extractMeshPrims('Base_Static'),
  yaw: extractMeshPrims('Turret_Yaw'),
  pitch: extractMeshPrims('Turret_Pitch'),
  barrel: extractMeshPrims('Barrel_Recoil'),
};
const lv0ImgBv = lv0Gltf.bufferViews[lv0Gltf.images[0].bufferView];
const lv0DiffusePng = Buffer.from(
  lv0Bin.subarray(lv0ImgBv.byteOffset || 0, (lv0ImgBv.byteOffset || 0) + lv0ImgBv.byteLength),
);

// ---------------------------------------------------------------------------
// 2. Procedural Weathered Hard-Surface PNG Textures (encoded cleanly via zlib)
// ---------------------------------------------------------------------------
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function encodePngRgba(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const tb = Buffer.from(type);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
    return Buffer.concat([len, tb, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hash2 = (x, y, s) => {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const noise2 = (x, y, s) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s);
  const b = hash2(ix + 1, iy, s);
  const c = hash2(ix, iy + 1, s);
  const d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};
const fbm2 = (x, y, s) =>
  0.55 * noise2(x, y, s) + 0.30 * noise2(x * 2.1, y * 2.1, s + 17) + 0.15 * noise2(x * 4.3, y * 4.3, s + 53);
const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));

function makeTexPng(size, fn) {
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    const v = py / size;
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const [r, g, b] = fn(u, v);
      const o = (py * size + px) * 4;
      buf[o] = clampByte(r);
      buf[o + 1] = clampByte(g);
      buf[o + 2] = clampByte(b);
      buf[o + 3] = 255;
    }
  }
  return encodePngRgba(size, size, buf);
}

const PNG_YELLOW = makeTexPng(128, (u, v) => {
  const n = fbm2(u * 8, v * 8, 101);
  const grime = fbm2(u * 22, v * 22, 307);
  const seam = u < 0.03 || u > 0.97 || v < 0.03 || v > 0.97 ? 0.84 : 1.0;
  const mul = (0.86 + n * 0.22 - grime * 0.10) * seam;
  return [205 * mul, 166 * mul, 64 * mul];
});

// Pure cold dark matte gunmetal steel (ZERO red or warm tint)
const PNG_GUNMETAL = makeTexPng(128, (u, v) => {
  const grain = fbm2(u * 24, v * 6, 409);
  const speck = fbm2(u * 14, v * 14, 521);
  const mul = 0.82 + grain * 0.24 + (speck - 0.5) * 0.12;
  return [46 * mul, 52 * mul, 61 * mul];
});

const PNG_BRUSHED_STEEL = makeTexPng(128, (u, v) => {
  const streak = fbm2(u * 30, v * 5, 617);
  const mul = 0.85 + streak * 0.24;
  return [126 * mul, 134 * mul, 146 * mul];
});

const PNG_HAZARD = makeTexPng(128, (u, v) => {
  const stripe = ((u + v) * 6.0) % 1.0;
  const isYellow = stripe < 0.5;
  const wear = 0.88 + fbm2(u * 14, v * 14, 733) * 0.22;
  return isYellow ? [202 * wear, 160 * wear, 52 * wear] : [34 * wear, 38 * wear, 44 * wear];
});

const PNG_OBSIDIAN = makeTexPng(128, (u, v) => {
  const n = fbm2(u * 10, v * 10, 881);
  const edge = u < 0.025 || u > 0.975 || v < 0.025 || v > 0.975 ? 0.82 : 1.0;
  const mul = (0.84 + n * 0.24) * edge;
  return [31 * mul, 37 * mul, 47 * mul];
});

const PNG_BRASS = makeTexPng(128, (u, v) => {
  const rib = 0.85 + 0.15 * Math.sin(u * Math.PI * 16);
  const pat = 0.90 + fbm2(u * 16, v * 8, 991) * 0.18;
  return [204 * rib * pat, 158 * rib * pat, 64 * rib * pat];
});

// ---------------------------------------------------------------------------
// 3. Hard-Surface Multi-Material Geometry Kit
// ---------------------------------------------------------------------------
function createPartMeshCollector(seedPrims = []) {
  const buckets = new Map();

  const getBucket = (matIdx) => {
    let b = buckets.get(matIdx);
    if (!b) {
      b = { mat: matIdx, pos: [], norm: [], uv: [], idx: [] };
      buckets.set(matIdx, b);
    }
    return b;
  };

  for (const sp of seedPrims) {
    const b = getBucket(sp.material);
    const vBase = b.pos.length / 3;
    for (let i = 0; i < sp.positions.length; i++) b.pos.push(sp.positions[i]);
    for (let i = 0; i < sp.normals.length; i++) b.norm.push(sp.normals[i]);
    for (let i = 0; i < sp.uvs.length; i++) b.uv.push(sp.uvs[i]);
    for (let i = 0; i < sp.indices.length; i++) b.idx.push(vBase + sp.indices[i]);
  }

  const pushVert = (b, x, y, z, nx, ny, nz, u, v) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    const idx = b.pos.length / 3;
    b.pos.push(x, y, z);
    b.norm.push(nx / l, ny / l, nz / l);
    b.uv.push(u, v);
    return idx;
  };

  const addQuad = (mat, p0, p1, p2, p3, uScale = 1, vScale = 1) => {
    const b = getBucket(mat);
    const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
    const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const i0 = pushVert(b, p0[0], p0[1], p0[2], nx, ny, nz, 0, 0);
    const i1 = pushVert(b, p1[0], p1[1], p1[2], nx, ny, nz, uScale, 0);
    const i2 = pushVert(b, p2[0], p2[1], p2[2], nx, ny, nz, uScale, vScale);
    const i3 = pushVert(b, p3[0], p3[1], p3[2], nx, ny, nz, 0, vScale);
    b.idx.push(i0, i1, i2, i0, i2, i3);
  };

  const addBox = (mat, cx, cy, cz, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const corners = [
      [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
      [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
    ];
    const cxR = Math.cos(rx), sxR = Math.sin(rx);
    const cyR = Math.cos(ry), syR = Math.sin(ry);
    const czR = Math.cos(rz), szR = Math.sin(rz);
    const xf = corners.map(([x, y, z]) => {
      // Z -> X -> Y Euler transform
      const x1 = x * czR - y * szR, y1 = x * szR + y * czR, z1 = z;
      const x2 = x1, y2 = y1 * cxR - z1 * sxR, z2 = y1 * sxR + z1 * cxR;
      const x3 = x2 * cyR + z2 * syR, y3 = y2, z3 = -x2 * syR + z2 * cyR;
      return [cx + x3, cy + y3, cz + z3];
    });
    addQuad(mat, xf[5], xf[1], xf[2], xf[6]); // +X
    addQuad(mat, xf[0], xf[4], xf[7], xf[3]); // -X
    addQuad(mat, xf[7], xf[6], xf[2], xf[3]); // +Y
    addQuad(mat, xf[0], xf[1], xf[5], xf[4]); // -Y
    addQuad(mat, xf[4], xf[5], xf[6], xf[7]); // +Z
    addQuad(mat, xf[1], xf[0], xf[3], xf[2]); // -Z
  };

  /** 8-sided chamfered rectangular prism aligned along +Z. */
  const addChamferedBeam = (mat, cx, cy, cz, w, h, len, bevel) => {
    const hw = w * 0.5;
    const hh = h * 0.5;
    const b = Math.min(bevel, hw * 0.45, hh * 0.45);
    const z0 = cz - len * 0.5;
    const z1 = cz + len * 0.5;
    const ring = [
      [-hw + b, -hh], [hw - b, -hh], [hw, -hh + b], [hw, hh - b],
      [hw - b, hh], [-hw + b, hh], [-hw, hh - b], [-hw, -hh + b],
    ];
    for (let i = 0; i < 8; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % 8];
      addQuad(
        mat,
        [cx + a[0], cy + a[1], z0],
        [cx + c[0], cy + c[1], z0],
        [cx + c[0], cy + c[1], z1],
        [cx + a[0], cy + a[1], z1],
      );
    }
    const bl = getBucket(mat);
    const pushCap = (zPos, signZ) => {
      const cIdx = pushVert(bl, cx, cy, zPos, 0, 0, signZ, 0.5, 0.5);
      const rStartIdx = bl.pos.length / 3;
      for (let i = 0; i < 8; i++) {
        const pt = ring[i];
        pushVert(
          bl,
          cx + pt[0],
          cy + pt[1],
          zPos,
          0,
          0,
          signZ,
          0.5 + pt[0] / Math.max(1e-4, w),
          0.5 + pt[1] / Math.max(1e-4, h),
        );
      }
      for (let i = 0; i < 8; i++) {
        const next = (i + 1) % 8;
        if (signZ > 0) bl.idx.push(cIdx, rStartIdx + i, rStartIdx + next);
        else bl.idx.push(cIdx, rStartIdx + next, rStartIdx + i);
      }
    };
    pushCap(z1, 1);
    pushCap(z0, -1);
  };

  /** Tapered frustum / cylinder aligned along 'x' | 'y' | 'z'. */
  const addCylinder = (mat, cx, cy, cz, axis, rStart, rEnd, length, radialSegs = 20, capped = true) => {
    const b = getBucket(mat);
    const half = length * 0.5;
    const toLocal = (u, v, ax) =>
      axis === 'y' ? [cx + u, cy + ax, cz + v] : axis === 'x' ? [cx + ax, cy + v, cz + u] : [cx + u, cy + v, cz + ax];
    const normAxis = (nu, nv, na) =>
      axis === 'y' ? [nu, na, nv] : axis === 'x' ? [na, nv, nu] : [nu, nv, na];

    const flipWinding = axis === 'y' || axis === 'x';
    const sideStart = b.pos.length / 3;
    for (let i = 0; i <= radialSegs; i++) {
      const a = (i / radialSegs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const p0 = toLocal(ca * rStart, sa * rStart, -half);
      const p1 = toLocal(ca * rEnd, sa * rEnd, half);
      const nSide = normAxis(ca, sa, 0);
      pushVert(b, p0[0], p0[1], p0[2], nSide[0], nSide[1], nSide[2], i / radialSegs, 0);
      pushVert(b, p1[0], p1[1], p1[2], nSide[0], nSide[1], nSide[2], i / radialSegs, 1);
    }
    for (let i = 0; i < radialSegs; i++) {
      const i0 = sideStart + i * 2;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      const i3 = i0 + 3;
      if (flipWinding) b.idx.push(i0, i1, i2, i2, i1, i3);
      else b.idx.push(i0, i2, i1, i2, i3, i1);
    }
    if (capped) {
      for (const [sign, r] of [[-1, rStart], [1, rEnd]]) {
        if (r <= 1e-4) continue;
        const axPos = sign * half;
        const nCap = normAxis(0, 0, sign);
        const pc = toLocal(0, 0, axPos);
        const cIdx = pushVert(b, pc[0], pc[1], pc[2], nCap[0], nCap[1], nCap[2], 0.5, 0.5);
        const rStartIdx = b.pos.length / 3;
        for (let i = 0; i <= radialSegs; i++) {
          const a = (i / radialSegs) * Math.PI * 2;
          const p = toLocal(Math.cos(a) * r, Math.sin(a) * r, axPos);
          pushVert(b, p[0], p[1], p[2], nCap[0], nCap[1], nCap[2], 0.5 + 0.45 * Math.cos(a), 0.5 + 0.45 * Math.sin(a));
        }
        const rev = flipWinding ? sign > 0 : sign < 0;
        for (let i = 0; i < radialSegs; i++) {
          const v0 = rStartIdx + i;
          const v1 = rStartIdx + i + 1;
          if (rev) b.idx.push(cIdx, v1, v0);
          else b.idx.push(cIdx, v0, v1);
        }
      }
    }
  };

  /** Octagonal pedestal base seated cleanly with rotation around Y (`Math.PI / 8` aligns flat faces forward/sides). */
  const addOctagonPedestal = (mat, cx, yBot, yTop, rBot, rTop) => {
    const b = getBucket(mat);
    const sides = 8;
    const h = yTop - yBot;
    const slope = (rBot - rTop) / Math.max(1e-4, h);
    for (let i = 0; i < sides; i++) {
      const a0 = ((i + 0.5) / sides) * Math.PI * 2;
      const a1 = ((i + 1.5) / sides) * Math.PI * 2;
      const am = 0.5 * (a0 + a1);
      const nx = Math.cos(am), nz = Math.sin(am), ny = slope;
      const bl = [cx + Math.cos(a0) * rBot, yBot, Math.sin(a0) * rBot];
      const br = [cx + Math.cos(a1) * rBot, yBot, Math.sin(a1) * rBot];
      const tr = [cx + Math.cos(a1) * rTop, yTop, Math.sin(a1) * rTop];
      const tl = [cx + Math.cos(a0) * rTop, yTop, Math.sin(a0) * rTop];
      const i0 = pushVert(b, bl[0], bl[1], bl[2], nx, ny, nz, 0, 0);
      const i1 = pushVert(b, br[0], br[1], br[2], nx, ny, nz, 1, 0);
      const i2 = pushVert(b, tr[0], tr[1], tr[2], nx, ny, nz, 1, 1);
      const i3 = pushVert(b, tl[0], tl[1], tl[2], nx, ny, nz, 0, 1);
      b.idx.push(i0, i2, i1, i0, i3, i2);
    }
    addCylinder(mat, cx, yTop - 0.005, 0, 'y', rTop * 0.94, rTop * 0.94, 0.012, 8, true);
  };

  /** Corner hydraulic outrigger stabilizer leg (flush pad at y = 0). */
  const addOutriggerLeg = (matArmor, matSteel, matBolt, yawAngle, rStart, rEnd, yAttach) => {
    const dirX = Math.cos(yawAngle);
    const dirZ = Math.sin(yawAngle);
    const padX = dirX * rEnd;
    const padZ = dirZ * rEnd;
    const shoulderX = dirX * rStart;
    const shoulderZ = dirZ * rStart;

    // Footpad flush on y = 0 + steel bolts
    addBox(matSteel, padX, 0.028, padZ, 0.25, 0.056, 0.25, 0, yawAngle, 0);
    addBox(matArmor, padX, 0.072, padZ, 0.18, 0.044, 0.18, 0, yawAngle, 0);
    addCylinder(matBolt, padX, 0.098, padZ, 'y', 0.048, 0.048, 0.04, 12);

    // Angled armored main leg strut from shoulder down to footpad
    const midX = 0.5 * (shoulderX + padX);
    const midZ = 0.5 * (shoulderZ + padZ);
    const midY = 0.5 * (yAttach + 0.08);
    const dx = padX - shoulderX, dz = padZ - shoulderZ;
    const horizLen = Math.hypot(dx, dz);
    const dy = yAttach - 0.08;
    const strutLen = Math.hypot(horizLen, dy) + 0.04;
    const tiltAngle = Math.atan2(dy, horizLen);
    // Strut oriented in local +X then rotated by -yawAngle around Y and -tiltAngle around Z
    const segs = 1;
    void segs;
    addBox(matArmor, midX, midY, midZ, strutLen, 0.11, 0.13, 0, -yawAngle, -tiltAngle);
    addCylinder(
      matBolt,
      midX - dirX * 0.04,
      midY + 0.075,
      midZ - dirZ * 0.04,
      'y',
      0.045,
      0.045,
      0.08,
      12,
    );
    // Hydraulic cylinder piston underneath
    addBox(matSteel, midX, midY - 0.055, midZ, strutLen * 0.85, 0.052, 0.055, 0, -yawAngle, -tiltAngle);
  };

  /** Heavy autocannon barrel with perforated cooling shroud & slotted brake. */
  const addShroudedBarrel = (matSteel, matBright, len, radius, perforated = true, flaredBrake = false) => {
    addCylinder(matSteel, 0, 0, len * 0.5, 'z', radius * 1.15, radius, len, 18);
    addCylinder(matBright, 0, 0, 0.14, 'z', radius * 1.55, radius * 1.55, 0.24, 18);
    if (perforated) {
      addCylinder(matSteel, 0, 0, 0.62, 'z', radius * 1.72, radius * 1.66, 0.92, 16);
      // Recessed vent rings & clamp collars mimicking perforated jacket
      for (let k = 0; k < 6; k++) {
        addCylinder(matBright, 0, 0, 0.26 + k * 0.14, 'z', radius * 1.82, radius * 1.82, 0.036, 16);
      }
      addCylinder(matBright, 0, 0, 1.10, 'z', radius * 1.68, radius * 1.62, 0.07, 16);
    }
    if (flaredBrake) {
      addCylinder(matSteel, 0, 0, len - 0.08, 'z', radius * 1.35, radius * 1.85, 0.18, 16);
      addBox(matBright, 0, 0, len - 0.05, radius * 3.1, radius * 2.2, 0.12);
    } else {
      addBox(matSteel, 0, 0, len - 0.06, radius * 3.4, radius * 2.4, 0.16);
      addBox(matBright, 0, 0, len - 0.02, radius * 2.8, radius * 1.8, 0.06);
    }
  };

  /** 6-barrel cold gunmetal rotary Gatling cluster centered at local (0,0,0), pointing +Z. */
  const addRotaryMinigun6 = (matColdGunmetal, matBrightSteel, ringRadius, barrelLen) => {
    // Center drive axle & rear rotor flange
    addCylinder(matColdGunmetal, 0, 0, barrelLen * 0.45, 'z', ringRadius * 0.34, ringRadius * 0.30, barrelLen * 0.9, 16);
    addCylinder(matBrightSteel, 0, 0, 0.08, 'z', ringRadius * 1.48, ringRadius * 1.48, 0.16, 24);
    addCylinder(matColdGunmetal, 0, 0, 0.56, 'z', ringRadius * 1.45, ringRadius * 1.45, 0.10, 24);
    addCylinder(matBrightSteel, 0, 0, 0.56, 'z', ringRadius * 1.50, ringRadius * 1.50, 0.04, 24);
    addCylinder(matBrightSteel, 0, 0, barrelLen * 0.66, 'z', ringRadius * 1.44, ringRadius * 1.44, 0.09, 24);
    addCylinder(matColdGunmetal, 0, 0, barrelLen - 0.14, 'z', ringRadius * 1.42, ringRadius * 1.38, 0.16, 24);
    addCylinder(matBrightSteel, 0, 0, barrelLen - 0.07, 'z', ringRadius * 1.45, ringRadius * 1.45, 0.04, 24);

    // 6 distinct cold steel barrels around ring
    const bRad = ringRadius * 0.31;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bx = Math.cos(a) * ringRadius;
      const by = Math.sin(a) * ringRadius;
      addCylinder(matColdGunmetal, bx, by, barrelLen * 0.5, 'z', bRad, bRad * 0.95, barrelLen, 14);
      addCylinder(matBrightSteel, bx, by, barrelLen - 0.015, 'z', bRad * 1.06, bRad * 1.06, 0.03, 12);
    }
  };

  /** Segmented flexible ammunition belt linking an array of 3D control points. */
  const addAmmoBelt = (matBelt, matLink, pts, beltWidth = 0.13, linkThick = 0.042) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mx = 0.5 * (a[0] + b[0]), my = 0.5 * (a[1] + b[1]), mz = 0.5 * (a[2] + b[2]);
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const segLen = Math.hypot(dx, dy, dz);
      const yaw = Math.atan2(dx, dz);
      const horiz = Math.hypot(dx, dz);
      const pitch = -Math.atan2(dy, horiz);
      addBox(matBelt, mx, my, mz, beltWidth, linkThick, segLen * 0.96, pitch, yaw, 0);
      addBox(matLink, mx, my, mz, beltWidth * 1.06, linkThick * 1.15, segLen * 0.34, pitch, yaw, 0);
    }
  };

  /** Parabolic radar dish & feed horn built cleanly around origin of `Radar_Spin`. */
  const addRadarDish = (matSteel, matYellow, matCyan) => {
    addCylinder(matSteel, 0, 0.06, 0, 'y', 0.075, 0.065, 0.12, 16);
    addBox(matYellow, 0, 0.16, 0, 0.14, 0.12, 0.12);
    // Tilted dish backing + rim + forward feed horn (+Z is look direction)
    addCylinder(matSteel, 0, 0.28, -0.02, 'z', 0.06, 0.24, 0.10, 22);
    addCylinder(matYellow, 0, 0.28, 0.025, 'z', 0.24, 0.21, 0.04, 22);
    addCylinder(matSteel, 0, 0.28, 0.09, 'z', 0.022, 0.015, 0.14, 10);
    addCylinder(matCyan, 0, 0.28, 0.165, 'z', 0.036, 0.022, 0.04, 12);
  };

  const toPrimitiveList = () => {
    const out = [];
    for (const b of buckets.values()) {
      if (b.idx.length === 0) continue;
      out.push({
        mat: b.mat,
        pos: new Float32Array(b.pos),
        norm: new Float32Array(b.norm),
        uv: new Float32Array(b.uv),
        idx: new Uint32Array(b.idx),
      });
    }
    return out;
  };

  return {
    addBox,
    addChamferedBeam,
    addCylinder,
    addOctagonPedestal,
    addOutriggerLeg,
    addShroudedBarrel,
    addRotaryMinigun6,
    addAmmoBelt,
    addRadarDish,
    toPrimitiveList,
  };
}

// ---------------------------------------------------------------------------
// 4. Write Consolidated Multi-Material GLB Assembler + Self-Verification
// ---------------------------------------------------------------------------
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = async () => ({ width: 512, height: 512, close() {} });
}
const THREE = await import(pathToFileURL(resolve(THREE_ROOT, 'build/three.module.js')).href);
const { GLTFLoader } = await import(pathToFileURL(resolve(THREE_ROOT, 'examples/jsm/loaders/GLTFLoader.js')).href);

function buildAndWriteUpgradeGlb(spec) {
  const { filename, yawPosY, nodesSpec, spinNodes = [], radarNodeIdx = null, barrelRecoilNodeIdxs } = spec;
  const outPath = resolve(__dirname, filename);

  const imageList = [
    { name: 'lv0_diffuse.png', mimeType: 'image/png', bytes: lv0DiffusePng },
    { name: 'armor_yellow.png', mimeType: 'image/png', bytes: PNG_YELLOW },
    { name: 'gunmetal_cold.png', mimeType: 'image/png', bytes: PNG_GUNMETAL },
    { name: 'brushed_steel.png', mimeType: 'image/png', bytes: PNG_BRUSHED_STEEL },
    { name: 'hazard_stripes.png', mimeType: 'image/png', bytes: PNG_HAZARD },
    { name: 'obsidian_citadel.png', mimeType: 'image/png', bytes: PNG_OBSIDIAN },
    { name: 'brass_ammo.png', mimeType: 'image/png', bytes: PNG_BRASS },
  ];

  const chunks = [];
  let curLen = 0;
  const bufferViews = [];
  const accessors = [];

  const align4 = () => {
    const pad = (4 - (curLen % 4)) % 4;
    if (pad > 0) {
      chunks.push(Buffer.alloc(pad, 0));
      curLen += pad;
    }
  };
  const appendBV = (buf, target) => {
    align4();
    const off = curLen;
    chunks.push(buf);
    curLen += buf.length;
    const bv = { buffer: 0, byteOffset: off, byteLength: buf.length };
    if (target !== undefined) bv.target = target;
    bufferViews.push(bv);
    return bufferViews.length - 1;
  };
  const appendFloatAcc = (arr, type, comps, computeMinMax = false, target) => {
    const f32 = arr instanceof Float32Array ? arr : new Float32Array(arr);
    const bvIdx = appendBV(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength), target);
    const acc = { bufferView: bvIdx, componentType: 5126, count: f32.length / comps, type };
    if (computeMinMax && f32.length >= comps) {
      const mn = new Array(comps).fill(Infinity);
      const mx = new Array(comps).fill(-Infinity);
      for (let i = 0; i < f32.length; i += comps) {
        for (let k = 0; k < comps; k++) {
          const val = f32[i + k];
          if (val < mn[k]) mn[k] = val;
          if (val > mx[k]) mx[k] = val;
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
    const bvIdx = appendBV(Buffer.from(u32.buffer, u32.byteOffset, u32.byteLength), 34963);
    accessors.push({ bufferView: bvIdx, componentType: 5125, count: u32.length, type: 'SCALAR' });
    return accessors.length - 1;
  };

  const gltfImages = imageList.map((img) => ({
    mimeType: img.mimeType,
    name: img.name,
    bufferView: appendBV(img.bytes),
  }));
  const gltfTextures = gltfImages.map((_, i) => ({ sampler: 0, source: i }));

  const meshes = [];
  const gltfNodes = nodesSpec.map((ns) => {
    const out = { name: ns.name };
    if (ns.translation) out.translation = ns.translation;
    if (ns.rotation) out.rotation = ns.rotation;
    if (ns.children) out.children = ns.children;
    if (ns.collector) {
      const prims = ns.collector.toPrimitiveList().map((pr) => ({
        attributes: {
          POSITION: appendFloatAcc(pr.pos, 'VEC3', 3, true, 34962),
          NORMAL: appendFloatAcc(pr.norm, 'VEC3', 3, false, 34962),
          TEXCOORD_0: appendFloatAcc(pr.uv, 'VEC2', 2, false, 34962),
        },
        indices: appendIndexAcc(pr.idx),
        material: pr.mat,
        mode: 4,
      }));
      meshes.push({ name: `${ns.name}_Mesh`, primitives: prims });
      out.mesh = meshes.length - 1;
    }
    return out;
  });

  // Update Turret_Yaw translation cleanly
  gltfNodes[2].translation = [0, yawPosY, 0];

  // Idle_Scan animation (6.0s sentry sweep + optional continuous Radar_Spin)
  const IDLE_DUR = 6.0;
  const IDLE_KEYS = 60;
  const idleTimes = new Float32Array(IDLE_KEYS + 1);
  const idleYawQ = new Float32Array((IDLE_KEYS + 1) * 4);
  const idlePitchQ = new Float32Array((IDLE_KEYS + 1) * 4);
  const idleRadarQ = new Float32Array((IDLE_KEYS + 1) * 4);
  for (let k = 0; k <= IDLE_KEYS; k++) {
    const u = k / IDLE_KEYS;
    idleTimes[k] = u * IDLE_DUR;
    const s = Math.sin(u * Math.PI * 2);
    const ya = (Math.tanh(1.4 * s) / Math.tanh(1.4)) * (38 * DEG);
    const pa = -(1.5 + 2.5 * Math.sin(u * Math.PI * 4)) * DEG;
    const ra = u * Math.PI * 2;
    idleYawQ[k * 4 + 1] = Math.sin(ya * 0.5);
    idleYawQ[k * 4 + 3] = Math.cos(ya * 0.5);
    idlePitchQ[k * 4] = Math.sin(pa * 0.5);
    idlePitchQ[k * 4 + 3] = Math.cos(pa * 0.5);
    idleRadarQ[k * 4 + 1] = Math.sin(ra * 0.5);
    idleRadarQ[k * 4 + 3] = Math.cos(ra * 0.5);
  }
  const idleTAcc = appendFloatAcc(idleTimes, 'SCALAR', 1, true);
  const idleYAcc = appendFloatAcc(idleYawQ, 'VEC4', 4, false);
  const idlePAcc = appendFloatAcc(idlePitchQ, 'VEC4', 4, false);
  const idleSamplers = [
    { input: idleTAcc, interpolation: 'LINEAR', output: idleYAcc },
    { input: idleTAcc, interpolation: 'LINEAR', output: idlePAcc },
  ];
  const idleChannels = [
    { sampler: 0, target: { node: 2, path: 'rotation' } },
    { sampler: 1, target: { node: 3, path: 'rotation' } },
  ];
  if (radarNodeIdx !== null) {
    const idleRAcc = appendFloatAcc(idleRadarQ, 'VEC4', 4, false);
    idleSamplers.push({ input: idleTAcc, interpolation: 'LINEAR', output: idleRAcc });
    idleChannels.push({ sampler: idleSamplers.length - 1, target: { node: radarNodeIdx, path: 'rotation' } });
  }

  // Fire_Recoil clip
  const FIRE_DUR = 0.22;
  const FIRE_KEYS = 22;
  const fireTimes = new Float32Array(FIRE_KEYS + 1);
  const firePitchQ = new Float32Array((FIRE_KEYS + 1) * 4);
  const recoilEnv = (u) =>
    u <= 0 || u >= 1
      ? 0
      : u <= 0.11
        ? Math.sin((u / 0.11) * Math.PI * 0.5)
        : Math.exp(-5.5 * ((u - 0.11) / 0.89)) * (1 - Math.pow((u - 0.11) / 0.89, 4));
  for (let k = 0; k <= FIRE_KEYS; k++) {
    const u = k / FIRE_KEYS;
    fireTimes[k] = u * FIRE_DUR;
    const kick = -2.6 * DEG * recoilEnv(u);
    firePitchQ[k * 4] = Math.sin(kick * 0.5);
    firePitchQ[k * 4 + 3] = Math.cos(kick * 0.5);
  }
  const fireTAcc = appendFloatAcc(fireTimes, 'SCALAR', 1, true);
  const firePAcc = appendFloatAcc(firePitchQ, 'VEC4', 4, false);
  const fireSamplers = [{ input: fireTAcc, interpolation: 'LINEAR', output: firePAcc }];
  const fireChannels = [{ sampler: 0, target: { node: 3, path: 'rotation' } }];

  for (const bIdx of barrelRecoilNodeIdxs) {
    const baseT = gltfNodes[bIdx].translation;
    const trans = new Float32Array((FIRE_KEYS + 1) * 3);
    for (let k = 0; k <= FIRE_KEYS; k++) {
      const env = recoilEnv(k / FIRE_KEYS);
      trans[k * 3] = baseT[0];
      trans[k * 3 + 1] = baseT[1];
      trans[k * 3 + 2] = baseT[2] - 0.16 * env;
    }
    const bAcc = appendFloatAcc(trans, 'VEC3', 3, false);
    fireSamplers.push({ input: fireTAcc, interpolation: 'LINEAR', output: bAcc });
    fireChannels.push({ sampler: fireSamplers.length - 1, target: { node: bIdx, path: 'translation' } });
  }
  for (const { nodeIdx, dir } of spinNodes) {
    const spinQ = new Float32Array((FIRE_KEYS + 1) * 4);
    for (let k = 0; k <= FIRE_KEYS; k++) {
      const ang = (k / FIRE_KEYS) * (Math.PI / 3) * dir;
      spinQ[k * 4 + 2] = Math.sin(ang * 0.5);
      spinQ[k * 4 + 3] = Math.cos(ang * 0.5);
    }
    const sAcc = appendFloatAcc(spinQ, 'VEC4', 4, false);
    fireSamplers.push({ input: fireTAcc, interpolation: 'LINEAR', output: sAcc });
    fireChannels.push({ sampler: fireSamplers.length - 1, target: { node: nodeIdx, path: 'rotation' } });
  }

  align4();
  const finalBin = Buffer.concat(chunks);

  const outGltf = {
    asset: { version: '2.0', generator: 'DefenseKit TurretUpgradeBuilder v1' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: gltfNodes,
    meshes,
    materials: [
      { name: 'lv0_diffuse', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.28, roughnessFactor: 0.62 } },
      { name: 'turret_mech_metal', pbrMetallicRoughness: { baseColorFactor: [0.14, 0.16, 0.19, 1], metallicFactor: 0.78, roughnessFactor: 0.36 } },
      { name: 'armor_yellow_weathered', pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicFactor: 0.28, roughnessFactor: 0.60 } },
      { name: 'gunmetal_cold_steel', pbrMetallicRoughness: { baseColorTexture: { index: 2 }, metallicFactor: 0.82, roughnessFactor: 0.36 } },
      { name: 'brushed_steel', pbrMetallicRoughness: { baseColorTexture: { index: 3 }, metallicFactor: 0.88, roughnessFactor: 0.28 } },
      { name: 'hazard_stripes', pbrMetallicRoughness: { baseColorTexture: { index: 4 }, metallicFactor: 0.26, roughnessFactor: 0.56 } },
      { name: 'obsidian_citadel', pbrMetallicRoughness: { baseColorTexture: { index: 5 }, metallicFactor: 0.58, roughnessFactor: 0.40 } },
      { name: 'brass_ammo', pbrMetallicRoughness: { baseColorTexture: { index: 6 }, metallicFactor: 0.86, roughnessFactor: 0.30 } },
      {
        name: 'emissive_cyan',
        pbrMetallicRoughness: { baseColorFactor: [0.22, 0.90, 1.0, 1], metallicFactor: 0.12, roughnessFactor: 0.18 },
        emissiveFactor: [0.20, 0.88, 1.0],
      },
      {
        name: 'dark_optics_lens',
        pbrMetallicRoughness: { baseColorFactor: [0.07, 0.22, 0.28, 1], metallicFactor: 0.2, roughnessFactor: 0.12 },
        emissiveFactor: [0.05, 0.28, 0.38],
      },
      {
        name: 'rail_copper',
        pbrMetallicRoughness: { baseColorFactor: [0.68, 0.34, 0.18, 1], metallicFactor: 0.88, roughnessFactor: 0.28 },
      },
      {
        name: 'railgun_discharge_neon',
        pbrMetallicRoughness: { baseColorFactor: [0.05, 0.14, 0.26, 1], metallicFactor: 0.35, roughnessFactor: 0.22 },
        emissiveFactor: [0.04, 0.22, 0.55],
      },
    ],
    textures: gltfTextures,
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: gltfImages,
    buffers: [{ byteLength: finalBin.length }],
    bufferViews,
    accessors,
    animations: [
      { name: 'Idle_Scan', samplers: idleSamplers, channels: idleChannels },
      { name: 'Fire_Recoil', samplers: fireSamplers, channels: fireChannels },
    ],
  };

  const jsonRaw = Buffer.from(JSON.stringify(outGltf), 'utf8');
  const jsonPad = Buffer.concat([jsonRaw, Buffer.alloc((4 - (jsonRaw.length % 4)) % 4, 0x20)]);
  const binPad = Buffer.concat([finalBin, Buffer.alloc((4 - (finalBin.length % 4)) % 4, 0x00)]);
  const totalBytes = 12 + 8 + jsonPad.length + 8 + binPad.length;
  const outGlb = Buffer.allocUnsafe(totalBytes);
  outGlb.writeUInt32LE(0x46546c67, 0);
  outGlb.writeUInt32LE(2, 4);
  outGlb.writeUInt32LE(totalBytes, 8);
  outGlb.writeUInt32LE(jsonPad.length, 12);
  outGlb.writeUInt32LE(0x4e4f534a, 16);
  jsonPad.copy(outGlb, 20);
  const binHdr = 20 + jsonPad.length;
  outGlb.writeUInt32LE(binPad.length, binHdr);
  outGlb.writeUInt32LE(0x004e4942, binHdr + 4);
  binPad.copy(outGlb, binHdr + 8);
  writeFileSync(outPath, outGlb);
  return { outPath, outGlb };
}

// Material indices for readability
const MAT = {
  LV0: 0,
  MECH: 1,
  YELLOW: 2,
  GUNMETAL: 3,
  STEEL: 4,
  HAZARD: 5,
  OBSIDIAN: 6,
  BRASS: 7,
  CYAN: 8,
  OPTICS: 9,
  COPPER: 10,
  RAIL_NEON: 11,
};

const PITCH_IN_YAW = lv0Parts.pitch.translation; // [0, 1.0065, -0.0738]
const BARREL_IN_PITCH = lv0Parts.barrel.translation; // [0.0054, 0.2967, 0.6048]
const YAW_Y0 = lv0Parts.yaw.translation[1]; // 0.1984

// Common helper: build standard Base/Yaw/Pitch collectors cloned from Lv0
const seedLv0Collectors = () => ({
  base: createPartMeshCollector(lv0Parts.base.primitives),
  yaw: createPartMeshCollector(lv0Parts.yaw.primitives),
  pitch: createPartMeshCollector(lv0Parts.pitch.primitives),
});

// ---------------------------------------------------------------------------
// 5. Define All 6 Upgrade Levels Faithful to Approved Concepts
// ---------------------------------------------------------------------------
function buildLevel1Spec() {
  const { base, yaw, pitch } = seedLv0Collectors();
  const barrel = createPartMeshCollector(lv0Parts.barrel.primitives);

  // Lv 1: Thicker bolted steel flange + yellow collar flush on y = 0
  base.addCylinder(MAT.GUNMETAL, 0, 0.024, 0, 'y', 0.78, 0.75, 0.048, 24);
  base.addCylinder(MAT.YELLOW, 0, 0.078, 0, 'y', 0.71, 0.66, 0.064, 24);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    base.addCylinder(MAT.STEEL, Math.cos(a) * 0.71, 0.056, Math.sin(a) * 0.71, 'y', 0.022, 0.022, 0.028, 8);
  }

  // Front bolted dark-steel armor reinforcement plate on roll-cage bar (no rifle scope!)
  yaw.addBox(MAT.GUNMETAL, 0, 0.33, 0.735, 0.62, 0.27, 0.055);
  yaw.addBox(MAT.STEEL, 0, 0.33, 0.76, 0.44, 0.045, 0.025);
  for (const sx of [-0.25, 0.25]) {
    for (const sy of [0.24, 0.42]) {
      yaw.addCylinder(MAT.STEEL, sx, sy, 0.768, 'z', 0.018, 0.018, 0.024, 8);
    }
  }
  // Slightly larger right ammo box + curved brass bullet belt feeding up into receiver
  yaw.addBox(MAT.YELLOW, -0.78, 0.47, 0.02, 0.42, 0.42, 0.68);
  yaw.addBox(MAT.STEEL, -0.78, 0.67, 0.02, 0.34, 0.04, 0.16);
  yaw.addAmmoBelt(
    MAT.BRASS,
    MAT.GUNMETAL,
    [
      [-0.72, 0.70, 0.02],
      [-0.64, 0.88, 0.0],
      [-0.50, 1.02, -0.02],
      [-0.36, 1.07, -0.04],
    ],
    0.13,
    0.042,
  );
  // Flush autonomous robotic optical camera lens built into left housing (ZERO tubular rifle scope)
  yaw.addBox(MAT.GUNMETAL, 0.78, 0.52, 0.56, 0.26, 0.24, 0.10);
  yaw.addCylinder(MAT.STEEL, 0.78, 0.52, 0.615, 'z', 0.088, 0.088, 0.036, 16);
  yaw.addCylinder(MAT.CYAN, 0.78, 0.52, 0.634, 'z', 0.062, 0.062, 0.014, 16);

  // Subtle shoulder bolster plates on Turret_Pitch
  pitch.addBox(MAT.GUNMETAL, 0.22, 0.26, 0.30, 0.08, 0.14, 0.34);
  pitch.addBox(MAT.GUNMETAL, -0.22, 0.26, 0.30, 0.08, 0.14, 0.34);

  // Short ribbed heavy cooling collar near breech on single barrel (clean mechanical +1 upgrade)
  barrel.addCylinder(MAT.GUNMETAL, 0, 0, 0.32, 'z', 0.095, 0.092, 0.56, 18);
  for (let i = 0; i < 8; i++) {
    barrel.addCylinder(MAT.STEEL, 0, 0, 0.10 + i * 0.064, 'z', 0.112, 0.112, 0.024, 18);
  }
  barrel.addCylinder(MAT.STEEL, 0.095, -0.04, 0.22, 'z', 0.026, 0.026, 0.42, 12);
  barrel.addCylinder(MAT.STEEL, -0.095, -0.04, 0.22, 'z', 0.026, 0.026, 0.42, 12);

  return {
    filename: 'Turret_level_1.glb',
    yawPosY: YAW_Y0 + 0.02,
    radarNodeIdx: null,
    barrelRecoilNodeIdxs: [4],
    nodesSpec: [
      { name: 'Tower_Root', children: [1, 2] },
      { name: 'Base_Static', collector: base, translation: [0, 0, 0] },
      { name: 'Turret_Yaw', collector: yaw, translation: [0, YAW_Y0 + 0.02, 0], rotation: [0, 0, 0, 1], children: [3] },
      { name: 'Turret_Pitch', collector: pitch, translation: PITCH_IN_YAW, rotation: [0, 0, 0, 1], children: [4, 6] },
      { name: 'Barrel_Recoil', collector: barrel, translation: BARREL_IN_PITCH, children: [5] },
      { name: 'Muzzle_Socket', translation: [0.003, 0.014, 1.925] },
      { name: 'Eject_Socket', translation: [-0.414, 0.264, -0.072] },
    ],
  };
}

function buildLevel2Spec() {
  const { base, yaw, pitch } = seedLv0Collectors();
  const barrelL = createPartMeshCollector();
  const barrelR = createPartMeshCollector();

  // Lv 2: Wider bolted circular skirt base (+0.07m lift)
  base.addCylinder(MAT.GUNMETAL, 0, 0.032, 0, 'y', 0.90, 0.85, 0.064, 28);
  base.addCylinder(MAT.YELLOW, 0, 0.135, 0, 'y', 0.83, 0.72, 0.145, 28);
  base.addCylinder(MAT.GUNMETAL, 0, 0.235, 0, 'y', 0.62, 0.60, 0.07, 28);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    base.addCylinder(MAT.STEEL, Math.cos(a) * 0.84, 0.068, Math.sin(a) * 0.84, 'y', 0.024, 0.024, 0.032, 8);
  }

  // Twin armored cylindrical side ammo drums + hazard stripes + steel belt chutes
  yaw.addBox(MAT.GUNMETAL, 0, 0.34, 0.74, 0.70, 0.30, 0.06);
  yaw.addBox(MAT.HAZARD, 0.44, 0.52, 0.56, 0.08, 0.26, 0.26);
  yaw.addBox(MAT.HAZARD, -0.44, 0.52, 0.56, 0.08, 0.26, 0.26);
  for (const sx of [-0.90, 0.90]) {
    yaw.addCylinder(MAT.YELLOW, sx, 0.48, -0.10, 'z', 0.26, 0.26, 0.62, 20);
    yaw.addCylinder(MAT.GUNMETAL, sx, 0.48, 0.22, 'z', 0.27, 0.25, 0.055, 20);
    yaw.addCylinder(MAT.GUNMETAL, sx, 0.48, -0.42, 'z', 0.27, 0.25, 0.055, 20);
    yaw.addBox(MAT.GUNMETAL, sx * 0.82, 0.24, -0.10, 0.26, 0.14, 0.48);
    yaw.addAmmoBelt(
      MAT.GUNMETAL,
      MAT.STEEL,
      [
        [sx, 0.73, -0.06],
        [sx * 0.74, 0.96, -0.06],
        [sx * 0.42, 1.08, -0.08],
      ],
      0.16,
      0.048,
    );
  }

  // Widened twin-barrel trunnion cradle + glowing cyan sensor pod
  pitch.addBox(MAT.GUNMETAL, 0, 0.28, 0.44, 0.52, 0.26, 0.34);
  pitch.addBox(MAT.YELLOW, 0, 0.33, 0.34, 0.48, 0.16, 0.26);
  pitch.addBox(MAT.YELLOW, 0.38, 0.36, -0.44, 0.22, 0.20, 0.30);
  pitch.addBox(MAT.CYAN, 0.38, 0.36, -0.28, 0.12, 0.11, 0.03);

  // Twin sleek cold gunmetal barrels with flared muzzle brakes
  barrelL.addShroudedBarrel(MAT.GUNMETAL, MAT.STEEL, 1.98, 0.054, false, true);
  barrelR.addShroudedBarrel(MAT.GUNMETAL, MAT.STEEL, 1.98, 0.054, false, true);

  return {
    filename: 'Turret_level_2.glb',
    yawPosY: YAW_Y0 + 0.07,
    radarNodeIdx: null,
    barrelRecoilNodeIdxs: [4, 6],
    nodesSpec: [
      { name: 'Tower_Root', children: [1, 2] },
      { name: 'Base_Static', collector: base, translation: [0, 0, 0] },
      { name: 'Turret_Yaw', collector: yaw, translation: [0, YAW_Y0 + 0.07, 0], rotation: [0, 0, 0, 1], children: [3] },
      { name: 'Turret_Pitch', collector: pitch, translation: PITCH_IN_YAW, rotation: [0, 0, 0, 1], children: [4, 6, 8] },
      { name: 'Barrel_Recoil_L', collector: barrelL, translation: [0.14, BARREL_IN_PITCH[1], 0.56], children: [5] },
      { name: 'Muzzle_Socket_L', translation: [0, 0, 2.02] },
      { name: 'Barrel_Recoil_R', collector: barrelR, translation: [-0.14, BARREL_IN_PITCH[1], 0.56], children: [7] },
      { name: 'Muzzle_Socket_R', translation: [0, 0, 2.02] },
      { name: 'Eject_Socket', translation: [-0.46, 0.26, -0.07] },
    ],
  };
}

function buildLevel3Spec() {
  const { base, yaw, pitch } = seedLv0Collectors();
  const barrelL = createPartMeshCollector();
  const barrelR = createPartMeshCollector();

  // Lv 3: Heavy Armored Octagonal Base + 4 bolted corner stabilizer legs (+0.16m lift)
  base.addOctagonPedestal(MAT.YELLOW, 0, 0.04, 0.33, 0.98, 0.86);
  base.addCylinder(MAT.GUNMETAL, 0, 0.022, 0, 'y', 1.02, 1.00, 0.044, 16);
  base.addCylinder(MAT.GUNMETAL, 0, 0.345, 0, 'y', 0.66, 0.62, 0.06, 24);
  for (let i = 0; i < 4; i++) {
    base.addOutriggerLeg(MAT.YELLOW, MAT.GUNMETAL, MAT.STEEL, Math.PI * 0.25 + i * (Math.PI * 0.5), 0.78, 1.20, 0.22);
  }

  // Heavy sloped front ballistic shield (yellow outer bezel + gunmetal armor core)
  yaw.addBox(MAT.YELLOW, 0, 0.44, 0.72, 0.94, 0.64, 0.11, -0.34, 0, 0);
  yaw.addBox(MAT.GUNMETAL, 0, 0.45, 0.755, 0.76, 0.48, 0.07, -0.34, 0, 0);
  yaw.addCylinder(MAT.CYAN, 0.74, 0.44, 0.56, 'z', 0.07, 0.07, 0.03, 14);

  // Oversized double hazard-striped side ammo crates + brass feed belts + rear radiator & whip antenna
  for (const sx of [-0.88, 0.88]) {
    yaw.addBox(MAT.YELLOW, sx, 0.48, 0.04, 0.46, 0.46, 0.78);
    yaw.addBox(MAT.HAZARD, sx + (sx > 0 ? 0.04 : -0.04), 0.34, 0.04, 0.40, 0.14, 0.80);
    yaw.addAmmoBelt(
      MAT.BRASS,
      MAT.GUNMETAL,
      [
        [sx * 0.86, 0.72, 0.05],
        [sx * 0.66, 0.94, 0.02],
        [sx * 0.40, 1.08, -0.02],
      ],
      0.16,
      0.048,
    );
  }
  yaw.addBox(MAT.GUNMETAL, 0.24, 0.76, -0.78, 0.24, 0.26, 0.30);
  yaw.addBox(MAT.GUNMETAL, -0.24, 0.76, -0.78, 0.24, 0.26, 0.30);
  yaw.addCylinder(MAT.GUNMETAL, 0.38, 1.24, -0.78, 'y', 0.016, 0.008, 0.88, 8);

  // Widened armored cradle + dual-lens cyan autonomous optical sensor pod on upper left shoulder
  pitch.addBox(MAT.GUNMETAL, 0, 0.29, 0.44, 0.56, 0.28, 0.36);
  pitch.addBox(MAT.YELLOW, 0, 0.35, 0.34, 0.50, 0.18, 0.28);
  pitch.addBox(MAT.YELLOW, 0.44, 0.38, 0.04, 0.24, 0.34, 0.40);
  pitch.addBox(MAT.GUNMETAL, 0.44, 0.38, 0.24, 0.20, 0.30, 0.04);
  pitch.addCylinder(MAT.CYAN, 0.44, 0.45, 0.265, 'z', 0.055, 0.055, 0.02, 14);
  pitch.addCylinder(MAT.CYAN, 0.44, 0.31, 0.265, 'z', 0.055, 0.055, 0.02, 14);

  // Twin thick heavy barrels wrapped in perforated ventilated cooling heat shrouds
  barrelL.addShroudedBarrel(MAT.GUNMETAL, MAT.STEEL, 2.02, 0.062, true, false);
  barrelR.addShroudedBarrel(MAT.GUNMETAL, MAT.STEEL, 2.02, 0.062, true, false);

  return {
    filename: 'Turret_level_3.glb',
    yawPosY: YAW_Y0 + 0.16,
    radarNodeIdx: null,
    barrelRecoilNodeIdxs: [4, 6],
    nodesSpec: [
      { name: 'Tower_Root', children: [1, 2] },
      { name: 'Base_Static', collector: base, translation: [0, 0, 0] },
      { name: 'Turret_Yaw', collector: yaw, translation: [0, YAW_Y0 + 0.16, 0], rotation: [0, 0, 0, 1], children: [3] },
      { name: 'Turret_Pitch', collector: pitch, translation: PITCH_IN_YAW, rotation: [0, 0, 0, 1], children: [4, 6, 8] },
      { name: 'Barrel_Recoil_L', collector: barrelL, translation: [0.16, BARREL_IN_PITCH[1], 0.55], children: [5] },
      { name: 'Muzzle_Socket_L', translation: [0, 0, 2.06] },
      { name: 'Barrel_Recoil_R', collector: barrelR, translation: [-0.16, BARREL_IN_PITCH[1], 0.55], children: [7] },
      { name: 'Muzzle_Socket_R', translation: [0, 0, 2.06] },
      { name: 'Eject_Socket', translation: [-0.48, 0.26, -0.07] },
    ],
  };
}

function buildLevel4Spec() {
  const { base, yaw, pitch } = seedLv0Collectors();
  const barrelRecoil = createPartMeshCollector();
  const barrelSpin = createPartMeshCollector();

  // Lv 4: Tall Heavy Octagonal Bunker Base + 4 thick hydraulic outrigger legs (+0.26m lift)
  base.addOctagonPedestal(MAT.YELLOW, 0, 0.04, 0.43, 1.06, 0.90);
  base.addCylinder(MAT.GUNMETAL, 0, 0.022, 0, 'y', 1.10, 1.08, 0.044, 16);
  base.addCylinder(MAT.GUNMETAL, 0, 0.445, 0, 'y', 0.72, 0.68, 0.07, 24);
  for (let i = 0; i < 4; i++) {
    base.addOutriggerLeg(MAT.YELLOW, MAT.GUNMETAL, MAT.STEEL, Math.PI * 0.25 + i * (Math.PI * 0.5), 0.84, 1.28, 0.30);
  }

  // Large armored cylindrical side ammo drum on right + metallic belt chute
  yaw.addBox(MAT.GUNMETAL, 0, 0.34, 0.74, 0.72, 0.30, 0.06);
  yaw.addCylinder(MAT.YELLOW, -0.92, 0.48, -0.06, 'z', 0.32, 0.32, 0.74, 22);
  yaw.addCylinder(MAT.GUNMETAL, -0.92, 0.48, 0.32, 'z', 0.33, 0.30, 0.06, 22);
  yaw.addCylinder(MAT.GUNMETAL, -0.92, 0.48, -0.44, 'z', 0.33, 0.30, 0.06, 22);
  yaw.addAmmoBelt(
    MAT.GUNMETAL,
    MAT.STEEL,
    [
      [-0.92, 0.78, -0.04],
      [-0.68, 0.99, -0.04],
      [-0.36, 1.10, -0.06],
    ],
    0.19,
    0.052,
  );

  // Cylindrical rotary electric drive housing + dorsal heat-sink cooling fins + FLIR dome
  pitch.addCylinder(MAT.GUNMETAL, 0, 0.295, 0.36, 'z', 0.24, 0.22, 0.50, 24);
  pitch.addCylinder(MAT.STEEL, 0, 0.295, 0.58, 'z', 0.23, 0.23, 0.05, 24);
  for (let i = 0; i < 5; i++) {
    pitch.addBox(MAT.GUNMETAL, 0, 0.57, -0.05 - i * 0.11, 0.28, 0.16, 0.045);
  }
  pitch.addCylinder(MAT.GUNMETAL, 0.14, 0.56, -0.62, 'y', 0.13, 0.12, 0.18, 16);
  pitch.addCylinder(MAT.STEEL, 0.14, 0.67, -0.62, 'y', 0.11, 0.07, 0.08, 16);
  pitch.addCylinder(MAT.OPTICS, 0.14, 0.63, -0.51, 'z', 0.045, 0.045, 0.03, 12);

  // Recoil collar + true 6-barrel cold dark gunmetal rotary cluster (`Barrel_Spin`)
  barrelRecoil.addCylinder(MAT.GUNMETAL, 0, 0, 0.06, 'z', 0.19, 0.19, 0.12, 20);
  barrelSpin.addRotaryMinigun6(MAT.GUNMETAL, MAT.STEEL, 0.118, 1.88);

  return {
    filename: 'Turret_level_4.glb',
    yawPosY: YAW_Y0 + 0.26,
    radarNodeIdx: null,
    barrelRecoilNodeIdxs: [4],
    spinNodes: [{ nodeIdx: 5, dir: 1 }],
    nodesSpec: [
      { name: 'Tower_Root', children: [1, 2] },
      { name: 'Base_Static', collector: base, translation: [0, 0, 0] },
      { name: 'Turret_Yaw', collector: yaw, translation: [0, YAW_Y0 + 0.26, 0], rotation: [0, 0, 0, 1], children: [3] },
      { name: 'Turret_Pitch', collector: pitch, translation: PITCH_IN_YAW, rotation: [0, 0, 0, 1], children: [4, 7] },
      { name: 'Barrel_Recoil', collector: barrelRecoil, translation: [0, BARREL_IN_PITCH[1], 0.60], children: [5, 6] },
      { name: 'Barrel_Spin', collector: barrelSpin, translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
      { name: 'Muzzle_Socket', translation: [0, 0, 1.92] },
      { name: 'Eject_Socket', translation: [-0.46, 0.26, -0.07] },
    ],
  };
}

function buildLevel5TopSpec() {
  const { base, yaw, pitch } = seedLv0Collectors();
  const railBarrel = createPartMeshCollector();

  // Lv 5 Top — Heavy Electromagnetic Railgun (Semi-Auto Big DMG): Sleek ISL Naval Monolith
  base.addOctagonPedestal(MAT.OBSIDIAN, 0, 0.04, 0.47, 1.12, 0.94);
  base.addCylinder(MAT.GUNMETAL, 0, 0.022, 0, 'y', 1.16, 1.14, 0.044, 16);
  base.addCylinder(MAT.YELLOW, 0, 0.42, 0, 'y', 0.88, 0.84, 0.07, 8);
  base.addCylinder(MAT.RAIL_NEON, 0, 0.47, 0, 'y', 0.76, 0.72, 0.04, 16);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * 0.25 + i * (Math.PI * 0.5);
    base.addOutriggerLeg(MAT.YELLOW, MAT.OBSIDIAN, MAT.RAIL_NEON, a, 0.88, 1.34, 0.34);
    const ca = i * (Math.PI * 0.5);
    base.addCylinder(MAT.RAIL_NEON, Math.cos(ca) * 0.96, 0.26, Math.sin(ca) * 0.96, 'y', 0.028, 0.028, 0.32, 10);
  }

  // Obsidian sloped ballistic front shield + reactive blue-neon energy bus slits
  yaw.addBox(MAT.OBSIDIAN, 0, 0.46, 0.73, 0.96, 0.66, 0.12, -0.34, 0, 0);
  yaw.addBox(MAT.YELLOW, 0, 0.22, 0.79, 0.78, 0.08, 0.05, -0.34, 0, 0);
  yaw.addBox(MAT.RAIL_NEON, 0, 0.52, 0.78, 0.56, 0.035, 0.035, -0.34, 0, 0);
  for (const sx of [-0.74, 0.74]) {
    yaw.addBox(MAT.OBSIDIAN, sx, 0.48, -0.02, 0.38, 0.44, 0.76);
    yaw.addBox(MAT.YELLOW, sx, 0.69, -0.02, 0.32, 0.06, 0.66);
    yaw.addBox(MAT.RAIL_NEON, sx + (sx > 0 ? 0.195 : -0.195), 0.48, 0.08, 0.02, 0.20, 0.42);
  }

  // Armored chamfered breech cradle collar + twin reactive capacitor tanks + sleek low-profile sensor pod
  pitch.addChamferedBeam(MAT.OBSIDIAN, 0, BARREL_IN_PITCH[1], 0.26, 0.42, 0.46, 0.54, 0.05);
  for (const sx of [-0.46, 0.46]) {
    pitch.addCylinder(MAT.OBSIDIAN, sx, 0.36, -0.58, 'z', 0.16, 0.16, 0.64, 18);
    pitch.addCylinder(MAT.RAIL_NEON, sx, 0.36, -0.58, 'z', 0.135, 0.135, 0.44, 18);
    pitch.addCylinder(MAT.STEEL, sx, 0.36, -0.90, 'z', 0.17, 0.13, 0.08, 18);
    pitch.addCylinder(MAT.RAIL_NEON, sx * 0.72, 0.16, -0.40, 'x', 0.035, 0.035, 0.24, 10);
  }
  pitch.addChamferedBeam(MAT.OBSIDIAN, 0.34, 0.44, -0.05, 0.20, 0.18, 0.36, 0.035);
  pitch.addBox(MAT.YELLOW, 0.34, 0.51, -0.05, 0.14, 0.03, 0.24);
  pitch.addCylinder(MAT.OPTICS, 0.34, 0.44, 0.135, 'z', 0.052, 0.052, 0.024, 14);

  // Stage 1: Heavy Stepped Chamfered Breech Block (z: 0.0 -> 0.86)
  railBarrel.addChamferedBeam(MAT.OBSIDIAN, 0, 0, 0.43, 0.30, 0.38, 0.86, 0.036);
  railBarrel.addChamferedBeam(MAT.YELLOW, 0, 0, 0.06, 0.315, 0.395, 0.08, 0.038);
  for (const sx of [-1, 1]) {
    railBarrel.addBox(MAT.GUNMETAL, sx * 0.148, -0.01, 0.42, 0.018, 0.24, 0.62);
    railBarrel.addBox(MAT.STEEL, sx * 0.151, 0.115, 0.42, 0.012, 0.014, 0.60);
    railBarrel.addBox(MAT.STEEL, sx * 0.151, -0.135, 0.42, 0.012, 0.014, 0.60);
  }
  for (const bz of [0.22, 0.46, 0.70]) {
    railBarrel.addCylinder(MAT.STEEL, 0, 0.194, bz, 'y', 0.022, 0.022, 0.016, 12);
  }

  // Stage 2: Sleek Long Monolithic Chamfered Forward Barrel (z: 0.84 -> 2.50)
  railBarrel.addChamferedBeam(MAT.OBSIDIAN, 0, 0, 1.67, 0.20, 0.285, 1.66, 0.030);
  railBarrel.addBox(MAT.GUNMETAL, 0, 0.144, 1.67, 0.115, 0.012, 1.60);
  for (let i = 0; i < 7; i++) {
    railBarrel.addCylinder(MAT.STEEL, 0, 0.153, 0.96 + i * 0.24, 'y', 0.018, 0.018, 0.014, 12);
  }
  railBarrel.addBox(MAT.GUNMETAL, 0, -0.144, 1.62, 0.10, 0.012, 1.50);
  // Razor-thin recessed side magnetic containment seams (stealthy at rest, neon blue pulse on fire)
  railBarrel.addBox(MAT.RAIL_NEON, 0.101, 0, 1.64, 0.008, 0.022, 1.52);
  railBarrel.addBox(MAT.RAIL_NEON, -0.101, 0, 1.64, 0.008, 0.022, 1.52);

  // Stage 3: 3D Recessed Muzzle Bore with Twin Parallel Copper Accelerator Rails (z: 2.50 -> 2.54)
  railBarrel.addBox(MAT.GUNMETAL, 0, 0.118, 2.518, 0.18, 0.044, 0.04);
  railBarrel.addBox(MAT.GUNMETAL, 0, -0.118, 2.518, 0.18, 0.044, 0.04);
  railBarrel.addBox(MAT.GUNMETAL, 0.068, 0, 2.518, 0.044, 0.20, 0.04);
  railBarrel.addBox(MAT.GUNMETAL, -0.068, 0, 2.518, 0.044, 0.20, 0.04);
  railBarrel.addBox(MAT.COPPER, 0, 0.056, 2.506, 0.072, 0.058, 0.036);
  railBarrel.addBox(MAT.COPPER, 0, -0.056, 2.506, 0.072, 0.058, 0.036);
  railBarrel.addBox(MAT.RAIL_NEON, 0, 0, 2.502, 0.062, 0.048, 0.032);

  return {
    filename: 'Turret_level_5_top.glb',
    yawPosY: YAW_Y0 + 0.30,
    radarNodeIdx: null,
    barrelRecoilNodeIdxs: [4],
    nodesSpec: [
      { name: 'Tower_Root', children: [1, 2] },
      { name: 'Base_Static', collector: base, translation: [0, 0, 0] },
      { name: 'Turret_Yaw', collector: yaw, translation: [0, YAW_Y0 + 0.30, 0], rotation: [0, 0, 0, 1], children: [3] },
      { name: 'Turret_Pitch', collector: pitch, translation: PITCH_IN_YAW, rotation: [0, 0, 0, 1], children: [4, 6] },
      { name: 'Barrel_Recoil', collector: railBarrel, translation: [0, BARREL_IN_PITCH[1], 0.42], children: [5] },
      { name: 'Muzzle_Socket', translation: [0, 0, 2.54] },
      { name: 'Eject_Socket', translation: [-0.46, 0.26, -0.07] },
    ],
  };
}

function buildLevel5BottomSpec() {
  const { base, yaw, pitch } = seedLv0Collectors();
  const barrelRecoilL = createPartMeshCollector();
  const barrelSpinL = createPartMeshCollector();
  const barrelRecoilR = createPartMeshCollector();
  const barrelSpinR = createPartMeshCollector();
  const radar = createPartMeshCollector();

  // Lv 5 Bottom — Twin Vulcan (Better Minigun): Obsidian + Yellow Fortress Base + 12 Cold Gunmetal Barrels
  base.addOctagonPedestal(MAT.OBSIDIAN, 0, 0.04, 0.47, 1.14, 0.96);
  base.addCylinder(MAT.GUNMETAL, 0, 0.022, 0, 'y', 1.18, 1.16, 0.044, 16);
  base.addCylinder(MAT.YELLOW, 0, 0.43, 0, 'y', 0.90, 0.86, 0.08, 8);
  base.addCylinder(MAT.GUNMETAL, 0, 0.485, 0, 'y', 0.74, 0.70, 0.06, 24);
  for (let i = 0; i < 4; i++) {
    base.addOutriggerLeg(MAT.YELLOW, MAT.OBSIDIAN, MAT.STEEL, Math.PI * 0.25 + i * (Math.PI * 0.5), 0.88, 1.36, 0.34);
  }

  // Heavy front armor + twin oversized hazard-striped side ammo hoppers + dual steel feed belts
  yaw.addBox(MAT.OBSIDIAN, 0, 0.44, 0.72, 0.96, 0.62, 0.11, -0.32, 0, 0);
  yaw.addBox(MAT.YELLOW, 0, 0.21, 0.78, 0.80, 0.09, 0.06, -0.32, 0, 0);
  for (const sx of [-0.94, 0.94]) {
    yaw.addBox(MAT.YELLOW, sx, 0.48, 0.02, 0.52, 0.50, 0.86);
    yaw.addBox(MAT.HAZARD, sx + (sx > 0 ? 0.04 : -0.04), 0.34, 0.02, 0.46, 0.18, 0.88);
    yaw.addBox(MAT.OBSIDIAN, sx, 0.74, 0.02, 0.44, 0.06, 0.74);
    yaw.addAmmoBelt(
      MAT.GUNMETAL,
      MAT.STEEL,
      [
        [sx * 0.88, 0.76, 0.04],
        [sx * 0.66, 0.98, 0.02],
        [sx * 0.42, 1.10, -0.02],
      ],
      0.20,
      0.052,
    );
  }

  // Twin armored cheek plates, twin rotary motor drums, & dorsal radiator exhaust grille
  pitch.addBox(MAT.OBSIDIAN, 0, 0.29, 0.36, 0.76, 0.36, 0.46);
  pitch.addBox(MAT.YELLOW, 0.42, 0.30, 0.20, 0.09, 0.46, 0.72);
  pitch.addBox(MAT.YELLOW, -0.42, 0.30, 0.20, 0.09, 0.46, 0.72);
  pitch.addCylinder(MAT.GUNMETAL, 0.205, 0.295, 0.42, 'z', 0.20, 0.19, 0.46, 22);
  pitch.addCylinder(MAT.GUNMETAL, -0.205, 0.295, 0.42, 'z', 0.20, 0.19, 0.46, 22);
  pitch.addBox(MAT.OBSIDIAN, 0, 0.56, -0.18, 0.44, 0.14, 0.44);
  pitch.addCylinder(MAT.GUNMETAL, 0.28, 1.18, -0.74, 'y', 0.014, 0.007, 0.92, 8);

  // Armored CIWS tracking radar dome (`Radar_Spin`) mounted on roof
  radar.addCylinder(MAT.OBSIDIAN, 0, 0.08, 0, 'y', 0.14, 0.13, 0.16, 16);
  radar.addCylinder(MAT.GUNMETAL, 0, 0.24, 0, 'y', 0.18, 0.16, 0.22, 18);
  radar.addCylinder(MAT.STEEL, 0, 0.36, 0, 'y', 0.16, 0.08, 0.08, 18);
  radar.addCylinder(MAT.OPTICS, 0, 0.25, 0.175, 'z', 0.065, 0.065, 0.03, 14);

  // Twin side-by-side 6-barrel cold gunmetal rotary clusters (12 cold steel barrels total)
  barrelRecoilL.addCylinder(MAT.GUNMETAL, 0, 0, 0.05, 'z', 0.17, 0.17, 0.10, 20);
  barrelSpinL.addRotaryMinigun6(MAT.GUNMETAL, MAT.STEEL, 0.104, 1.92);
  barrelRecoilR.addCylinder(MAT.GUNMETAL, 0, 0, 0.05, 'z', 0.17, 0.17, 0.10, 20);
  barrelSpinR.addRotaryMinigun6(MAT.GUNMETAL, MAT.STEEL, 0.104, 1.92);

  return {
    filename: 'Turret_level_5_bottom.glb',
    yawPosY: YAW_Y0 + 0.30,
    radarNodeIdx: 11,
    barrelRecoilNodeIdxs: [4, 7],
    spinNodes: [
      { nodeIdx: 5, dir: 1 },
      { nodeIdx: 8, dir: -1 },
    ],
    nodesSpec: [
      { name: 'Tower_Root', children: [1, 2] },
      { name: 'Base_Static', collector: base, translation: [0, 0, 0] },
      { name: 'Turret_Yaw', collector: yaw, translation: [0, YAW_Y0 + 0.30, 0], rotation: [0, 0, 0, 1], children: [3] },
      { name: 'Turret_Pitch', collector: pitch, translation: PITCH_IN_YAW, rotation: [0, 0, 0, 1], children: [4, 7, 10, 11] },
      { name: 'Barrel_Recoil_L', collector: barrelRecoilL, translation: [0.205, BARREL_IN_PITCH[1], 0.62], children: [5, 6] },
      { name: 'Barrel_Spin_L', collector: barrelSpinL, translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
      { name: 'Muzzle_Socket_L', translation: [0, 0, 1.96] },
      { name: 'Barrel_Recoil_R', collector: barrelRecoilR, translation: [-0.205, BARREL_IN_PITCH[1], 0.62], children: [8, 9] },
      { name: 'Barrel_Spin_R', collector: barrelSpinR, translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
      { name: 'Muzzle_Socket_R', translation: [0, 0, 1.96] },
      { name: 'Eject_Socket', translation: [-0.52, 0.26, -0.07] },
      { name: 'Radar_Spin', collector: radar, translation: [0, 0.62, -0.34], rotation: [0, 0, 0, 1] },
    ],
  };
}

// ---------------------------------------------------------------------------
// 6. Generate & Self-Verify All 6 Upgraded Turret Models
// ---------------------------------------------------------------------------
const specs = [
  buildLevel1Spec(),
  buildLevel2Spec(),
  buildLevel3Spec(),
  buildLevel4Spec(),
  buildLevel5TopSpec(),
  buildLevel5BottomSpec(),
];

for (const spec of specs) {
  const { outPath, outGlb } = buildAndWriteUpgradeGlb(spec);
  const parsed = await new Promise((res, rej) => {
    const loader = new GLTFLoader();
    const ab = outGlb.buffer.slice(outGlb.byteOffset, outGlb.byteOffset + outGlb.byteLength);
    loader.parse(ab, '', res, rej);
  });
  parsed.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(parsed.scene);
  const sz = new THREE.Vector3();
  box.getSize(sz);
  let tris = 0;
  parsed.scene.traverse((o) => {
    if (o.isMesh && o.geometry.index) tris += o.geometry.index.count / 3;
  });
  if (!Number.isFinite(sz.x) || Math.abs(box.min.y) > 0.025) {
    throw new Error(`Bounds check failed for ${spec.filename}: minY=${box.min.y}`);
  }
  console.log(
    `Built ${spec.filename.padEnd(25)} ${(outGlb.length / 1024 / 1024).toFixed(2)} MB | ${String(tris).padStart(6)} tris | bbox [${sz.x.toFixed(2)}w x ${sz.y.toFixed(2)}h x ${sz.z.toFixed(2)}l] minY=${box.min.y.toFixed(4)} | clips=${parsed.animations.length}`,
  );
  void outPath;
}
