import type { RoadNode, RoadSegment, Vec3 } from '../../types/protocol';
import { evalCubic, evalCubicDeriv1, resolveSegmentCubic, sampleCenterline } from '../shaping/centerline';
import { measureSegmentMinRadius } from '../shaping/curvatureSafety';

export const GRAPH_EPS = 1e-6;

export function makeGraphId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function round2(n: number): number {
  return Number(n.toFixed(2));
}

export function clampVal(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: round2(a.x + (b.x - a.x) * t),
    y: Math.max(0, round2(a.y + (b.y - a.y) * t)),
    z: round2(a.z + (b.z - a.z) * t),
  };
}

/** Evaluates 3D position, forward unit tangent, and horizontal Y-up locked right vector at `t in [0,1]`. */
export function evaluateRoadSegmentAt(
  nodeA: Pick<Vec3, 'x' | 'y' | 'z'> & { id?: string; role?: RoadNode['role']; corner?: boolean },
  nodeB: Pick<Vec3, 'x' | 'y' | 'z'> & { id?: string; role?: RoadNode['role']; corner?: boolean },
  segment: Pick<RoadSegment, 'kind' | 'control' | 'tension'> & Partial<RoadSegment>,
  t: number,
  graphNodes?: readonly RoadNode[],
  graphSegments?: readonly RoadSegment[],
): { position: Vec3; tangent: Vec3; right: Vec3 } {
  const u = clampVal(t, 0, 1);

  let px: number;
  let py: number;
  let pz: number;
  let dx: number;
  let dy: number;
  let dz: number;

  if (segment.kind === 'curve' && segment.control) {
    const c = segment.control;
    const inv = 1 - u;
    px = inv * inv * nodeA.x + 2 * inv * u * c.x + u * u * nodeB.x;
    py = inv * inv * nodeA.y + 2 * inv * u * c.y + u * u * nodeB.y;
    pz = inv * inv * nodeA.z + 2 * inv * u * c.z + u * u * nodeB.z;

    dx = 2 * inv * (c.x - nodeA.x) + 2 * u * (nodeB.x - c.x);
    dy = 2 * inv * (c.y - nodeA.y) + 2 * u * (nodeB.y - c.y);
    dz = 2 * inv * (c.z - nodeA.z) + 2 * u * (nodeB.z - c.z);
  } else if (segment.kind === 'curve') {
    const fullSeg: RoadSegment = {
      id: segment.id ?? '__eval_seg__',
      a: segment.a ?? nodeA.id ?? '__eval_a__',
      b: segment.b ?? nodeB.id ?? '__eval_b__',
      width: segment.width ?? 5.2,
      kind: 'curve',
      tension: segment.tension,
    };
    const evalNodes: readonly RoadNode[] =
      graphNodes ?? [
        { id: fullSeg.a, x: nodeA.x, y: nodeA.y, z: nodeA.z, role: nodeA.role ?? 'normal', corner: nodeA.corner },
        { id: fullSeg.b, x: nodeB.x, y: nodeB.y, z: nodeB.z, role: nodeB.role ?? 'normal', corner: nodeB.corner },
      ];
    const cubic = resolveSegmentCubic(fullSeg, evalNodes, graphSegments ?? [fullSeg]);
    const p = evalCubic(cubic, u);
    const d1 = evalCubicDeriv1(cubic, u);
    px = p.x;
    py = p.y;
    pz = p.z;
    dx = d1.x;
    dy = d1.y;
    dz = d1.z;
  } else {
    dx = nodeB.x - nodeA.x;
    dy = nodeB.y - nodeA.y;
    dz = nodeB.z - nodeA.z;
    px = nodeA.x + dx * u;
    py = nodeA.y + dy * u;
    pz = nodeA.z + dz * u;
  }

  const len3 = Math.hypot(dx, dy, dz);
  const tx = len3 > GRAPH_EPS ? dx / len3 : 1;
  const ty = len3 > GRAPH_EPS ? dy / len3 : 0;
  const tz = len3 > GRAPH_EPS ? dz / len3 : 0;

  const rLen = Math.hypot(-tz, tx);
  const rx = rLen > GRAPH_EPS ? -tz / rLen : 0;
  const rz = rLen > GRAPH_EPS ? tx / rLen : 1;

  return {
    position: { x: px, y: py, z: pz },
    tangent: { x: tx, y: ty, z: tz },
    right: { x: rx, y: 0, z: rz },
  };
}

export function sampleRoadSegment(
  nodeA: Pick<Vec3, 'x' | 'y' | 'z'> & { id?: string; role?: RoadNode['role']; corner?: boolean },
  nodeB: Pick<Vec3, 'x' | 'y' | 'z'> & { id?: string; role?: RoadNode['role']; corner?: boolean },
  segment: Pick<RoadSegment, 'kind' | 'control' | 'tension'> & Partial<RoadSegment>,
  steps = 20,
  graphNodes?: readonly RoadNode[],
  graphSegments?: readonly RoadSegment[],
): Vec3[] {
  const count = Math.max(2, steps);
  const pts: Vec3[] = [];
  for (let i = 0; i <= count; i++) {
    pts.push(evaluateRoadSegmentAt(nodeA, nodeB, segment, i / count, graphNodes, graphSegments).position);
  }
  return pts;
}

/** Measures segment arc length, minimum XZ curvature radius, and peak vertical grade %. */
export function measureRoadSegment(
  nodeA: Pick<Vec3, 'x' | 'y' | 'z'> & { id?: string; role?: RoadNode['role']; corner?: boolean },
  nodeB: Pick<Vec3, 'x' | 'y' | 'z'> & { id?: string; role?: RoadNode['role']; corner?: boolean },
  segment: Pick<RoadSegment, 'kind' | 'control' | 'tension'> & Partial<RoadSegment>,
  graphNodes?: readonly RoadNode[],
  graphSegments?: readonly RoadSegment[],
): { length: number; minTurnRadius: number; maxSlopePct: number } {
  const fullSeg: RoadSegment = {
    id: segment.id ?? '__eval_seg__',
    a: segment.a ?? nodeA.id ?? '__eval_a__',
    b: segment.b ?? nodeB.id ?? '__eval_b__',
    width: segment.width ?? 5.2,
    kind: segment.kind,
    control: segment.control,
    tension: segment.tension,
  };
  const evalNodes: readonly RoadNode[] =
    graphNodes ?? [
      { id: fullSeg.a, x: nodeA.x, y: nodeA.y, z: nodeA.z, role: nodeA.role ?? 'normal', corner: nodeA.corner },
      { id: fullSeg.b, x: nodeB.x, y: nodeB.y, z: nodeB.z, role: nodeB.role ?? 'normal', corner: nodeB.corner },
    ];
  const evalSegs = graphSegments ?? [fullSeg];
  const pts = sampleCenterline({ segment: fullSeg, nodes: evalNodes, segments: evalSegs }, 1.5, (5 * Math.PI) / 180);
  let maxSlopePct = 0;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const horiz = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const dy = Math.abs(p1.y - p0.y);
    if (horiz > 1e-4) {
      const grade = (dy / horiz) * 100;
      if (grade > maxSlopePct) maxSlopePct = grade;
    }
  }

  const length = pts.length > 0 ? pts[pts.length - 1]!.s : 0;
  const minTurnRadius =
    segment.kind === 'curve' ? measureSegmentMinRadius(fullSeg, evalNodes, evalSegs).minRadius : Infinity;

  return { length, minTurnRadius, maxSlopePct };
}

export function closestParamOnSegmentXZ(
  nodeA: RoadNode,
  nodeB: RoadNode,
  segment: RoadSegment,
  x: number,
  z: number,
  graphNodes?: readonly RoadNode[],
  graphSegments?: readonly RoadSegment[],
): { t: number; point: Vec3; distXZ: number } {
  if (segment.kind === 'straight') {
    const dx = nodeB.x - nodeA.x;
    const dz = nodeB.z - nodeA.z;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq > GRAPH_EPS ? clampVal(((x - nodeA.x) * dx + (z - nodeA.z) * dz) / lenSq, 0, 1) : 0.5;
    const pt = evaluateRoadSegmentAt(nodeA, nodeB, segment, t).position;
    return { t, point: pt, distXZ: Math.hypot(pt.x - x, pt.z - z) };
  }

  const steps = 28;
  let bestT = 0.5;
  let bestDistSq = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = evaluateRoadSegmentAt(nodeA, nodeB, segment, t, graphNodes, graphSegments).position;
    const dSq = (pt.x - x) ** 2 + (pt.z - z) ** 2;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestT = t;
    }
  }

  let lo = Math.max(0, bestT - 1 / steps);
  let hi = Math.min(1, bestT + 1 / steps);
  for (let it = 0; it < 12; it++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const p1 = evaluateRoadSegmentAt(nodeA, nodeB, segment, m1, graphNodes, graphSegments).position;
    const p2 = evaluateRoadSegmentAt(nodeA, nodeB, segment, m2, graphNodes, graphSegments).position;
    if ((p1.x - x) ** 2 + (p1.z - z) ** 2 < (p2.x - x) ** 2 + (p2.z - z) ** 2) {
      hi = m2;
    } else {
      lo = m1;
    }
  }

  const finalT = (lo + hi) * 0.5;
  const pt = evaluateRoadSegmentAt(nodeA, nodeB, segment, finalT, graphNodes, graphSegments).position;
  return { t: finalT, point: pt, distXZ: Math.hypot(pt.x - x, pt.z - z) };
}
