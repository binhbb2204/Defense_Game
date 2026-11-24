import type { RoadNode, RoadSegment, Vec3 } from '../../types/protocol';
import { makeGraphId, round2 } from '../graph/segmentCurve';
import { evalCubic, resolveSegmentCubic } from './centerline';
import { analyzeSectionCurvature } from './curvatureSafety';
import type {
  CubicBezier3D,
  CurveBetweenOptions,
  RoadSection,
  ShapeOperationResult,
} from './types';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function resolveOutsideTangent(
  endNode: RoadNode,
  fallbackOpposite: RoadNode,
  isStartEnd: boolean,
  sectionSegSet: ReadonlySet<string>,
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
): Vec3 {
  const chordDx = isStartEnd ? fallbackOpposite.x - endNode.x : endNode.x - fallbackOpposite.x;
  const chordDz = isStartEnd ? fallbackOpposite.z - endNode.z : endNode.z - fallbackOpposite.z;
  const chordLen = Math.hypot(chordDx, chordDz);
  const fallback = chordLen > 1e-6 ? { x: chordDx / chordLen, y: 0, z: chordDz / chordLen } : { x: 1, y: 0, z: 0 };

  if (endNode.corner) return fallback;
  const outsideSegs = segments.filter(
    (s) => !sectionSegSet.has(s.id) && (s.a === endNode.id || s.b === endNode.id),
  );
  if (outsideSegs.length !== 1) return fallback;

  const outSeg = outsideSegs[0]!;
  const cubic = resolveSegmentCubic(outSeg, nodes, segments);
  const atA = outSeg.a === endNode.id;
  const refPt = atA ? cubic.c1 : cubic.c2;
  let dx = endNode.x - refPt.x;
  let dz = endNode.z - refPt.z;
  if (!isStartEnd) {
    dx = -dx;
    dz = -dz;
  }
  const len = Math.hypot(dx, dz);
  return len > 1e-5 ? { x: dx / len, y: 0, z: dz / len } : fallback;
}

/** Resamples a 3D cubic Bezier into arc-length-spaced points (always preserving endpoints and >= 1 span). */
export function resampleCurve(
  cubic: CubicBezier3D,
  options: { spacing?: number; nodeCount?: number } = {},
): { points: Vec3[]; totalLength: number } {
  const steps = 128;
  const arcS = new Float64Array(steps + 1);
  let prev = evalCubic(cubic, 0);
  let total = 0;
  for (let i = 1; i <= steps; i++) {
    const p = evalCubic(cubic, i / steps);
    total += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    arcS[i] = total;
    prev = p;
  }

  let segCount: number;
  if (options.nodeCount !== undefined) {
    segCount = Math.max(1, Math.round(options.nodeCount) - 1);
  } else {
    const spacing = Math.max(1.5, options.spacing ?? 8);
    segCount = Math.max(1, Math.round(total / spacing));
  }

  const evalAtArc = (targetS: number): Vec3 => {
    let lo = 0;
    let hi = steps;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (arcS[mid]! <= targetS) lo = mid;
      else hi = mid;
    }
    const s0 = arcS[lo]!;
    const s1 = arcS[hi]!;
    const frac = s1 > s0 + 1e-6 ? (targetS - s0) / (s1 - s0) : 0;
    return evalCubic(cubic, (lo + frac) / steps);
  };

  const points: Vec3[] = [cubic.p0];
  for (let k = 1; k < segCount; k++) {
    const pt = evalAtArc((k / segCount) * total);
    const prevPt = points[points.length - 1]!;
    const endDist = Math.hypot(pt.x - cubic.p3.x, pt.z - cubic.p3.z);
    const prevDist = Math.hypot(pt.x - prevPt.x, pt.z - prevPt.z);
    if (prevDist >= 0.45 && endDist >= 0.45) {
      points.push({ x: round2(pt.x), y: Math.max(0, round2(pt.y)), z: round2(pt.z) });
    }
  }
  points.push(cubic.p3);
  return { points, totalLength: total };
}

/** Curve (destructive): spans one cubic Bezier from A to B and resamples interior nodes evenly. */
export function curveBetween(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  section: RoadSection,
  options: CurveBetweenOptions = {},
): ShapeOperationResult {
  if (section.hasInteriorSpawnOrBase) {
    return {
      allowed: false,
      blockedReason: 'Curve mode removes interior nodes and cannot run across Spawn/Base interior nodes.',
      warnings: [],
      nodes: [...nodes],
      segments: [...segments],
      affectedNodeIds: [...section.nodeIds],
      affectedSegmentIds: [...section.segmentIds],
      minRadius: Infinity,
      length: section.length,
      violations: [],
      handles: [],
    };
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nodeA = nodeMap.get(section.startNodeId)!;
  const nodeB = nodeMap.get(section.endNodeId)!;
  const segSet = new Set(section.segmentIds);
  const firstSeg = segments.find((s) => s.id === section.segmentIds[0]);
  const templateWidth = firstSeg?.width ?? 5.2;

  const tanA = resolveOutsideTangent(nodeA, nodeB, true, segSet, nodes, segments);
  const tanB = resolveOutsideTangent(nodeB, nodeA, false, segSet, nodes, segments);
  const distAB = Math.hypot(nodeB.x - nodeA.x, nodeB.z - nodeA.z);
  const k = clamp(options.handleFactor ?? 0.4, 0.1, 0.8);
  const hLen = Math.max(0.5, k * distAB);

  const cubic: CubicBezier3D = {
    p0: { x: nodeA.x, y: nodeA.y, z: nodeA.z },
    c1: { x: nodeA.x + tanA.x * hLen, y: nodeA.y + (nodeB.y - nodeA.y) / 3, z: nodeA.z + tanA.z * hLen },
    c2: { x: nodeB.x - tanB.x * hLen, y: nodeA.y + ((nodeB.y - nodeA.y) * 2) / 3, z: nodeB.z - tanB.z * hLen },
    p3: { x: nodeB.x, y: nodeB.y, z: nodeB.z },
    isCurved: true,
  };

  const resampled = resampleCurve(cubic, { spacing: options.spacing ?? 8, nodeCount: options.nodeCount });
  const interiorRemoveSet = new Set(section.nodeIds.slice(1, -1));
  const keptNodes = nodes.filter((n) => !interiorRemoveSet.has(n.id)).map((n) => ({ ...n }));
  const keptSegments = segments.filter((s) => !segSet.has(s.id)).map((s) => ({ ...s }));

  const newInteriorNodes: RoadNode[] = resampled.points.slice(1, -1).map((pt) => ({
    id: makeGraphId('n'),
    x: round2(pt.x),
    y: Math.max(0, round2(pt.y)),
    z: round2(pt.z),
    role: 'normal',
  }));
  const chainNodeIds = [nodeA.id, ...newInteriorNodes.map((n) => n.id), nodeB.id];
  const tension = clamp(options.tension ?? 0.5, 0, 1);

  const newSegments: RoadSegment[] = [];
  for (let i = 0; i < chainNodeIds.length - 1; i++) {
    newSegments.push({
      id: makeGraphId('seg'),
      a: chainNodeIds[i]!,
      b: chainNodeIds[i + 1]!,
      width: templateWidth,
      kind: 'curve',
      tension,
      elevationMode: firstSeg?.elevationMode,
      slopeMode: firstSeg?.slopeMode,
      isTunnel: firstSeg?.isTunnel,
      isOverpass: firstSeg?.isOverpass,
      roadPartAsset: firstSeg?.roadPartAsset,
    });
  }

  const nextNodes = [...keptNodes, ...newInteriorNodes];
  const nextSegments = [...keptSegments, ...newSegments];
  const newSegIds = newSegments.map((s) => s.id);
  const safety = analyzeSectionCurvature(nextNodes, nextSegments, newSegIds);
  const warnings: string[] = [];
  if (safety.violations.length > 0) {
    warnings.push(
      `Tight curve radius (min R=${safety.minRadius.toFixed(1)}m < ${safety.violations[0]!.minAllowedRadius.toFixed(1)}m).`,
    );
  }

  return {
    allowed: true,
    warnings,
    nodes: nextNodes,
    segments: nextSegments,
    affectedNodeIds: chainNodeIds,
    affectedSegmentIds: newSegIds,
    minRadius: safety.minRadius,
    length: resampled.totalLength,
    violations: safety.violations,
    handles: [
      { anchor: cubic.p0, handle: cubic.c1 },
      { anchor: cubic.p3, handle: cubic.c2 },
    ],
  };
}
