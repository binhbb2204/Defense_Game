import type { RoadNode, RoadSegment, Vec3 } from '../../types/protocol';
import { sampleCenterline } from '../shaping/centerline';
import type { CurveLutEntry, SegmentCache } from './types';

export const EPS = 1e-6;
export const AREA_EPS = 1e-6;
export const COLLINEAR_DOT_THRESHOLD = Math.cos((2 * Math.PI) / 180);

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function addV3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subV3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleV3(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function distSqXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function distXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function normXZ(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.z);
  if (len < EPS) return { x: 1, y: 0, z: 0 };
  return { x: v.x / len, y: 0, z: v.z / len };
}

export function dotXZ(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.z * b.z;
}

export function perpLeftXZ(d: Vec3): Vec3 {
  return { x: d.z, y: 0, z: -d.x };
}

export function perpRightXZ(d: Vec3): Vec3 {
  return { x: -d.z, y: 0, z: d.x };
}

/**
 * Signed area * 2 in XZ plane, equal to Y-component of (b - a) x (c - a).
 * Positive (> 0) guarantees upward +Y normal in Three.js right-handed coordinates.
 */
export function signedAreaXZ(a: Vec3, b: Vec3, c: Vec3): number {
  return (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
}

export function intersectLinesXZ(
  p1: Vec3,
  d1: Vec3,
  p2: Vec3,
  d2: Vec3
): { point: Vec3; t1: number; t2: number } | null {
  const det = -d1.x * d2.z + d1.z * d2.x;
  if (Math.abs(det) < 1e-5) return null;
  const rx = p2.x - p1.x;
  const rz = p2.z - p1.z;
  const t1 = (-rx * d2.z + rz * d2.x) / det;
  const t2 = (d1.x * rz - d1.z * rx) / det;
  return {
    point: {
      x: p1.x + d1.x * t1,
      y: (p1.y + p2.y) * 0.5,
      z: p1.z + d1.z * t1,
    },
    t1,
    t2,
  };
}

export function positiveAngleDiff(fromAngle: number, toAngle: number): number {
  let diff = toAngle - fromAngle;
  while (diff < 0) diff += Math.PI * 2;
  while (diff >= Math.PI * 2) diff -= Math.PI * 2;
  return diff;
}

export function evalBezier(a: Vec3, c: Vec3, b: Vec3, t: number): Vec3 {
  const mt = 1 - t;
  const w0 = mt * mt;
  const w1 = 2 * mt * t;
  const w2 = t * t;
  return {
    x: w0 * a.x + w1 * c.x + w2 * b.x,
    y: w0 * a.y + w1 * c.y + w2 * b.y,
    z: w0 * a.z + w1 * c.z + w2 * b.z,
  };
}

export function buildSegmentCache(
  segIdx: number,
  seg: RoadSegment,
  nodeA: RoadNode,
  nodeB: RoadNode,
  flowSign: 1 | -1,
  graphNodes: readonly RoadNode[] = [nodeA, nodeB],
  graphSegments: readonly RoadSegment[] = [seg]
): SegmentCache {
  const halfW = Math.max(0.25, (Number(seg.width) || 3.4) * 0.5);
  const aPos = v3(nodeA.x, nodeA.y, nodeA.z);
  const bPos = v3(nodeB.x, nodeB.y, nodeB.z);
  const isCurved =
    seg.kind === 'curve' &&
    (seg.control === undefined ||
      (Number.isFinite(seg.control.x) && Number.isFinite(seg.control.z)));

  const lut: CurveLutEntry[] = [];
  if (!isCurved) {
    const abLen = distXZ(aPos, bPos);
    const ab3dLen = Math.hypot(bPos.x - aPos.x, bPos.y - aPos.y, bPos.z - aPos.z);
    const outDirA = abLen > EPS ? normXZ(subV3(bPos, aPos)) : v3(1, 0, 0);
    const outDirB = { x: -outDirA.x, y: 0, z: -outDirA.z };
    lut.push({ t: 0, s: 0, pos: aPos, tangent: outDirA });
    lut.push({ t: 1, s: ab3dLen, pos: bPos, tangent: outDirA });
    return {
      segIdx,
      seg,
      nodeA,
      nodeB,
      halfW,
      totalLen: ab3dLen,
      isCurved: false,
      lut,
      outDirA,
      outDirB,
      flowSign,
    };
  }

  // Consume single-source-of-truth adaptive centerline samples for curved segments
  const samples = sampleCenterline(
    { segment: seg, nodes: graphNodes, segments: graphSegments },
    1.1,
    (4 * Math.PI) / 180
  );
  for (const sp of samples) {
    lut.push({
      t: sp.t,
      s: sp.s,
      pos: v3(sp.x, sp.y, sp.z),
      tangent: normXZ(sp.tangent),
    });
  }

  const totalLen = lut.length > 0 ? lut[lut.length - 1]!.s : 0;
  const outDirA = lut.length > 0 ? lut[0]!.tangent : v3(1, 0, 0);
  const endTan = lut.length > 0 ? lut[lut.length - 1]!.tangent : v3(1, 0, 0);
  return {
    segIdx,
    seg,
    nodeA,
    nodeB,
    halfW,
    totalLen,
    isCurved: true,
    lut,
    outDirA,
    outDirB: { x: -endTan.x, y: 0, z: -endTan.z },
    flowSign,
  };
}

export function sampleCacheByS(
  cache: SegmentCache,
  s: number
): { t: number; pos: Vec3; tangent: Vec3 } {
  const total = cache.totalLen;
  if (total <= EPS || cache.lut.length < 2) {
    return {
      t: 0,
      pos: cache.lut[0]!.pos,
      tangent: cache.lut[0]!.tangent,
    };
  }
  const clamped = Math.max(0, Math.min(total, s));
  if (!cache.isCurved) {
    const u = clamped / total;
    const a = cache.lut[0]!.pos;
    const b = cache.lut[1]!.pos;
    return {
      t: u,
      pos: {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        z: a.z + (b.z - a.z) * u,
      },
      tangent: cache.outDirA,
    };
  }

  const lut = cache.lut;
  let lo = 0;
  let hi = lut.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (lut[mid]!.s <= clamped) lo = mid;
    else hi = mid;
  }
  const e0 = lut[lo]!;
  const e1 = lut[hi]!;
  const span = e1.s - e0.s;
  const alpha = span > EPS ? (clamped - e0.s) / span : 0;
  return {
    t: e0.t + (e1.t - e0.t) * alpha,
    pos: {
      x: e0.pos.x + (e1.pos.x - e0.pos.x) * alpha,
      y: e0.pos.y + (e1.pos.y - e0.pos.y) * alpha,
      z: e0.pos.z + (e1.pos.z - e0.pos.z) * alpha,
    },
    tangent: normXZ({
      x: e0.tangent.x + (e1.tangent.x - e0.tangent.x) * alpha,
      y: 0,
      z: e0.tangent.z + (e1.tangent.z - e0.tangent.z) * alpha,
    }),
  };
}

export function dedupePointRing(pts: Vec3[], tol = 1e-4): Vec3[] {
  const out: Vec3[] = [];
  const tolSq = tol * tol;
  for (const p of pts) {
    if (out.length === 0 || distSqXZ(out[out.length - 1]!, p) > tolSq) {
      out.push(p);
    }
  }
  if (out.length > 2 && distSqXZ(out[0]!, out[out.length - 1]!) <= tolSq) {
    out.pop();
  }
  return out;
}
