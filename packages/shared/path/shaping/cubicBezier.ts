import type { RoadNode, RoadSegment, Vec3 } from '../../types/protocol';
import type { CubicBezier3D } from './types';

const EPS = 1e-6;

export function normXZ(dx: number, dz: number): Vec3 {
  const len = Math.hypot(dx, dz);
  if (len < EPS) return { x: 1, y: 0, z: 0 };
  return { x: dx / len, y: 0, z: dz / len };
}

function tensionScaleFactor(rawTension: number | undefined): number {
  const t = Math.max(0, Math.min(1, rawTension ?? 0.5));
  return t <= 0.5 ? 0.03 + (t / 0.5) * 0.97 : 1.0 + ((t - 0.5) / 0.5) * 0.65;
}

export function clampVal(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function resolveEndpointTangent(
  atNode: RoadNode,
  oppositeNode: RoadNode,
  thisSeg: RoadSegment,
  nodeMap: ReadonlyMap<string, RoadNode>,
  incident: readonly RoadSegment[],
): { dir: Vec3; defaultLen: number } {
  const chordDx = oppositeNode.x - atNode.x;
  const chordDz = oppositeNode.z - atNode.z;
  const chordLenXZ = Math.hypot(chordDx, chordDz);
  const sign = thisSeg.a === atNode.id ? 1 : -1;
  const chordFwd = normXZ(chordDx * sign, chordDz * sign);

  if (atNode.corner || incident.length !== 2) {
    return { dir: chordFwd, defaultLen: chordLenXZ / 3 };
  }

  const otherSeg = incident[0]!.id === thisSeg.id ? incident[1]! : incident[0]!;
  const prevId = otherSeg.a === atNode.id ? otherSeg.b : otherSeg.a;
  const prevNode = nodeMap.get(prevId);
  if (!prevNode) {
    return { dir: chordFwd, defaultLen: chordLenXZ / 3 };
  }

  if (otherSeg.kind === 'straight') {
    const inDir =
      thisSeg.a === atNode.id
        ? normXZ(atNode.x - prevNode.x, atNode.z - prevNode.z)
        : normXZ(prevNode.x - atNode.x, prevNode.z - atNode.z);
    return { dir: inDir, defaultLen: chordLenXZ * 0.34 };
  }

  if (otherSeg.control) {
    const q = otherSeg.control;
    const dx = thisSeg.a === atNode.id ? atNode.x - q.x : q.x - atNode.x;
    const dz = thisSeg.a === atNode.id ? atNode.z - q.z : q.z - atNode.z;
    const dLen = Math.hypot(dx, dz);
    if (dLen > EPS) {
      return { dir: { x: dx / dLen, y: 0, z: dz / dLen }, defaultLen: chordLenXZ * 0.34 };
    }
  }

  const t01 = Math.max(1e-3, Math.sqrt(Math.hypot(atNode.x - prevNode.x, atNode.z - prevNode.z)));
  const t12 = Math.max(1e-3, Math.sqrt(chordLenXZ));
  const m1x =
    t12 *
    ((atNode.x - prevNode.x) / t01 -
      (oppositeNode.x - prevNode.x) / (t01 + t12) +
      (oppositeNode.x - atNode.x) / t12);
  const m1z =
    t12 *
    ((atNode.z - prevNode.z) / t01 -
      (oppositeNode.z - prevNode.z) / (t01 + t12) +
      (oppositeNode.z - atNode.z) / t12);

  const mLen = Math.hypot(m1x, m1z);
  if (mLen < EPS) return { dir: chordFwd, defaultLen: chordLenXZ / 3 };
  return {
    dir: { x: (m1x / mLen) * sign, y: 0, z: (m1z / mLen) * sign },
    defaultLen: mLen / 3,
  };
}

/**
 * Resolves a RoadSegment into a concrete 3D cubic Bezier:
 * - `'straight'`: linear control points
 * - `'curve'` + explicit `control`: exact degree elevation from quadratic Bezier
 * - `'curve'` without `control`: live-derived centripetal Catmull-Rom (`alpha = 0.5`) scaled by `tension`
 */
export function resolveSegmentCubic(
  segment: RoadSegment,
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[] = [segment],
): CubicBezier3D {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const a = nodeMap.get(segment.a);
  const b = nodeMap.get(segment.b);
  if (!a || !b) {
    const z = { x: 0, y: 0, z: 0 };
    return { p0: z, c1: z, c2: z, p3: z, isCurved: false };
  }

  const p0: Vec3 = { x: a.x, y: a.y, z: a.z };
  const p3: Vec3 = { x: b.x, y: b.y, z: b.z };
  const linearCubic = (): CubicBezier3D => ({
    p0,
    c1: { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3, z: p0.z + (p3.z - p0.z) / 3 },
    c2: { x: p0.x + ((p3.x - p0.x) * 2) / 3, y: p0.y + ((p3.y - p0.y) * 2) / 3, z: p0.z + ((p3.z - p0.z) * 2) / 3 },
    p3,
    isCurved: false,
  });

  if (segment.kind !== 'curve') return linearCubic();

  if (segment.control && Number.isFinite(segment.control.x) && Number.isFinite(segment.control.z)) {
    const q = segment.control;
    return {
      p0,
      c1: { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y), z: p0.z + (2 / 3) * (q.z - p0.z) },
      c2: { x: p3.x + (2 / 3) * (q.x - p3.x), y: p3.y + (2 / 3) * (q.y - p3.y), z: p3.z + (2 / 3) * (q.z - p3.z) },
      p3,
      isCurved: true,
    };
  }

  const rawTension = clampVal(segment.tension ?? 0.5, 0, 1);
  if (rawTension <= 0.015) return linearCubic();

  const incA = segments.filter((s) => s.a === a.id || s.b === a.id);
  const incB = segments.filter((s) => s.a === b.id || s.b === b.id);
  const tanA = resolveEndpointTangent(a, b, segment, nodeMap, incA);
  const tanB = resolveEndpointTangent(b, a, segment, nodeMap, incB);

  const chordDir = normXZ(p3.x - p0.x, p3.z - p0.z);
  const chordBlend = rawTension < 0.12 ? (0.12 - rawTension) / 0.105 : 0;
  const dirA =
    chordBlend > 0
      ? normXZ(tanA.dir.x * (1 - chordBlend) + chordDir.x * chordBlend, tanA.dir.z * (1 - chordBlend) + chordDir.z * chordBlend)
      : tanA.dir;
  const dirB =
    chordBlend > 0
      ? normXZ(tanB.dir.x * (1 - chordBlend) + chordDir.x * chordBlend, tanB.dir.z * (1 - chordBlend) + chordDir.z * chordBlend)
      : tanB.dir;

  const chordLenXZ = Math.hypot(p3.x - p0.x, p3.z - p0.z);
  const tScale = tensionScaleFactor(rawTension);
  const lenA = Math.min(chordLenXZ * 0.48, tanA.defaultLen * tScale);
  const lenB = Math.min(chordLenXZ * 0.48, tanB.defaultLen * tScale);

  const minY = Math.min(p0.y, p3.y);
  const maxY = Math.max(p0.y, p3.y);
  return {
    p0,
    c1: { x: p0.x + dirA.x * lenA, y: clampVal(p0.y + (p3.y - p0.y) / 3, minY, maxY), z: p0.z + dirA.z * lenA },
    c2: { x: p3.x - dirB.x * lenB, y: clampVal(p0.y + ((p3.y - p0.y) * 2) / 3, minY, maxY), z: p3.z - dirB.z * lenB },
    p3,
    isCurved: true,
  };
}

export function evalCubic(c: CubicBezier3D, t: number): Vec3 {
  const u = clampVal(t, 0, 1);
  const inv = 1 - u;
  const w0 = inv * inv * inv;
  const w1 = 3 * inv * inv * u;
  const w2 = 3 * inv * u * u;
  const w3 = u * u * u;
  return {
    x: w0 * c.p0.x + w1 * c.c1.x + w2 * c.c2.x + w3 * c.p3.x,
    y: w0 * c.p0.y + w1 * c.c1.y + w2 * c.c2.y + w3 * c.p3.y,
    z: w0 * c.p0.z + w1 * c.c1.z + w2 * c.c2.z + w3 * c.p3.z,
  };
}

export function evalCubicDeriv1(c: CubicBezier3D, t: number): Vec3 {
  const u = clampVal(t, 0, 1);
  const inv = 1 - u;
  return {
    x: 3 * inv * inv * (c.c1.x - c.p0.x) + 6 * inv * u * (c.c2.x - c.c1.x) + 3 * u * u * (c.p3.x - c.c2.x),
    y: 3 * inv * inv * (c.c1.y - c.p0.y) + 6 * inv * u * (c.c2.y - c.c1.y) + 3 * u * u * (c.p3.y - c.c2.y),
    z: 3 * inv * inv * (c.c1.z - c.p0.z) + 6 * inv * u * (c.c2.z - c.c1.z) + 3 * u * u * (c.p3.z - c.c2.z),
  };
}

export function evalCubicDeriv2(c: CubicBezier3D, t: number): Vec3 {
  const u = clampVal(t, 0, 1);
  const inv = 1 - u;
  return {
    x: 6 * inv * (c.c2.x - 2 * c.c1.x + c.p0.x) + 6 * u * (c.p3.x - 2 * c.c2.x + c.c1.x),
    y: 6 * inv * (c.c2.y - 2 * c.c1.y + c.p0.y) + 6 * u * (c.p3.y - 2 * c.c2.y + c.c1.y),
    z: 6 * inv * (c.c2.z - 2 * c.c1.z + c.p0.z) + 6 * u * (c.p3.z - 2 * c.c2.z + c.c1.z),
  };
}

export function evalCubicTangent3D(c: CubicBezier3D, t: number): Vec3 {
  if (!c.isCurved) {
    const dx = c.p3.x - c.p0.x;
    const dy = c.p3.y - c.p0.y;
    const dz = c.p3.z - c.p0.z;
    const len = Math.hypot(dx, dy, dz);
    return len > EPS ? { x: dx / len, y: dy / len, z: dz / len } : { x: 1, y: 0, z: 0 };
  }
  let d = evalCubicDeriv1(c, t);
  let len = Math.hypot(d.x, d.y, d.z);
  if (len < 1e-4) {
    const epsT = t < 0.5 ? Math.min(1, t + 1e-3) : Math.max(0, t - 1e-3);
    d = evalCubicDeriv1(c, epsT);
    len = Math.hypot(d.x, d.y, d.z);
  }
  if (len < EPS) {
    const dx = c.p3.x - c.p0.x;
    const dy = c.p3.y - c.p0.y;
    const dz = c.p3.z - c.p0.z;
    const cLen = Math.hypot(dx, dy, dz);
    return cLen > EPS ? { x: dx / cLen, y: dy / cLen, z: dz / cLen } : { x: 1, y: 0, z: 0 };
  }
  return { x: d.x / len, y: d.y / len, z: d.z / len };
}
