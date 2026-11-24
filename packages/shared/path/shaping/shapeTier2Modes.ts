import type { RoadNode, RoadSegment } from '../../types/protocol';
import { makeGraphId, round2 } from '../graph/segmentCurve';
import { sampleCenterline } from './centerline';
import { analyzeSectionCurvature } from './curvatureSafety';
import type {
  ConnectSegmentsOptions,
  ParallelSectionOptions,
  RoadSection,
  ShapeOperationResult,
} from './types';

export { roundCorner } from './roundCornerMode';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Tier 2 Connect: links the nearest open endpoints of two separate segments with a smooth
 * curve-straight-curve transition using tangents of both existing segments.
 */
export function connectSegments(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  segAId: string,
  segBId: string,
  options: ConnectSegmentsOptions = {},
): ShapeOperationResult {
  const segA = segments.find((s) => s.id === segAId);
  const segB = segments.find((s) => s.id === segBId);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  if (!segA || !segB || segA.id === segB.id) {
    return {
      allowed: false,
      blockedReason: 'Pick two distinct road segments to connect.',
      warnings: [],
      nodes: [...nodes],
      segments: [...segments],
      affectedNodeIds: [],
      affectedSegmentIds: [],
      minRadius: Infinity,
      length: 0,
      violations: [],
      handles: [],
    };
  }

  const deg = (id: string) => segments.filter((s) => s.a === id || s.b === id).length;
  let bestPair: [string, string] | null = null;
  let bestScore = Infinity;

  for (const ea of [segA.a, segA.b]) {
    for (const eb of [segB.a, segB.b]) {
      if (ea === eb) continue;
      const na = nodeMap.get(ea);
      const nb = nodeMap.get(eb);
      if (!na || !nb) continue;
      const penalty = (deg(ea) === 1 ? 0 : 1000) + (deg(eb) === 1 ? 0 : 1000);
      const d = Math.hypot(nb.x - na.x, nb.z - na.z) + penalty;
      if (d < bestScore) {
        bestScore = d;
        bestPair = [ea, eb];
      }
    }
  }

  if (!bestPair) {
    return {
      allowed: false,
      blockedReason: 'Segments already share endpoints.',
      warnings: [],
      nodes: [...nodes],
      segments: [...segments],
      affectedNodeIds: [],
      affectedSegmentIds: [],
      minRadius: Infinity,
      length: 0,
      violations: [],
      handles: [],
    };
  }

  const [idA, idB] = bestPair;
  const nA = nodeMap.get(idA)!;
  const nB = nodeMap.get(idB)!;
  const oA = nodeMap.get(segA.a === idA ? segA.b : segA.a)!;
  const oB = nodeMap.get(segB.a === idB ? segB.b : segB.a)!;
  const distAB = Math.hypot(nB.x - nA.x, nB.z - nA.z);
  const r = Math.min(Math.max(2, options.radius ?? 12), distAB * 0.35);

  const dirA = {
    x: (nA.x - oA.x) / Math.max(1e-6, Math.hypot(nA.x - oA.x, nA.z - oA.z)),
    z: (nA.z - oA.z) / Math.max(1e-6, Math.hypot(nA.x - oA.x, nA.z - oA.z)),
  };
  const dirB = {
    x: (oB.x - nB.x) / Math.max(1e-6, Math.hypot(oB.x - nB.x, oB.z - nB.z)),
    z: (oB.z - nB.z) / Math.max(1e-6, Math.hypot(oB.x - nB.x, oB.z - nB.z)),
  };

  const mid1: RoadNode = {
    id: makeGraphId('n'),
    x: round2(nA.x + dirA.x * r),
    y: round2(nA.y + (nB.y - nA.y) * 0.3),
    z: round2(nA.z + dirA.z * r),
    role: 'normal',
  };
  const mid2: RoadNode = {
    id: makeGraphId('n'),
    x: round2(nB.x - dirB.x * r),
    y: round2(nA.y + (nB.y - nA.y) * 0.7),
    z: round2(nB.z - dirB.z * r),
    role: 'normal',
  };

  const w = (segA.width + segB.width) * 0.5;
  const sCurve1: RoadSegment = { id: makeGraphId('seg'), a: idA, b: mid1.id, width: w, kind: 'curve', tension: 0.5 };
  const sStraight: RoadSegment = { id: makeGraphId('seg'), a: mid1.id, b: mid2.id, width: w, kind: 'straight' };
  const sCurve2: RoadSegment = { id: makeGraphId('seg'), a: mid2.id, b: idB, width: w, kind: 'curve', tension: 0.5 };

  const nextNodes = [...nodes.map((n) => ({ ...n })), mid1, mid2];
  const nextSegments = [...segments.map((s) => ({ ...s })), sCurve1, sStraight, sCurve2];
  const newIds = [sCurve1.id, sStraight.id, sCurve2.id];
  const safety = analyzeSectionCurvature(nextNodes, nextSegments, newIds);

  return {
    allowed: true,
    warnings: safety.violations.length > 0 ? [`Tight bend radius (${safety.minRadius.toFixed(1)}m).`] : [],
    nodes: nextNodes,
    segments: nextSegments,
    affectedNodeIds: [idA, mid1.id, mid2.id, idB],
    affectedSegmentIds: newIds,
    minRadius: safety.minRadius,
    length: distAB,
    violations: safety.violations,
    handles: [],
  };
}

/**
 * Tier 2 Parallel: creates an independent offset road network on the chosen side of a section
 * with zero auto-connect edges back to the original road.
 */
export function parallelSection(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  section: RoadSection,
  options: ParallelSectionOptions = {},
): ShapeOperationResult {
  const offsetDist = clamp(options.offset ?? 9, 2, 60);
  const sideSign = options.side === 'left' ? -1 : 1;
  const spacing = clamp(options.spacing ?? 10, 3, 25);
  const firstSeg = segments.find((s) => s.id === section.segmentIds[0]);
  const width = firstSeg?.width ?? 5.2;

  const samples = sampleCenterline(
    { nodeIds: section.nodeIds, segmentIds: section.segmentIds, nodes, segments },
    spacing,
    (12 * Math.PI) / 180,
  );
  if (samples.length < 2) {
    return {
      allowed: false,
      blockedReason: 'Selected section is too short to offset.',
      warnings: [],
      nodes: [...nodes],
      segments: [...segments],
      affectedNodeIds: [],
      affectedSegmentIds: [],
      minRadius: Infinity,
      length: 0,
      violations: [],
      handles: [],
    };
  }

  const picked = [samples[0]!];
  for (let i = 1; i < samples.length - 1; i++) {
    const prev = picked[picked.length - 1]!;
    const cur = samples[i]!;
    if (Math.hypot(cur.x - prev.x, cur.z - prev.z) >= spacing * 0.7) {
      picked.push(cur);
    }
  }
  picked.push(samples[samples.length - 1]!);

  const parallelNodes: RoadNode[] = [];
  for (const c of picked) {
    const len = Math.hypot(c.tangent.x, c.tangent.z) || 1;
    const rx = (-c.tangent.z / len) * sideSign;
    const rz = (c.tangent.x / len) * sideSign;
    const ox = round2(c.x + rx * offsetDist);
    const oz = round2(c.z + rz * offsetDist);
    const prevOut = parallelNodes[parallelNodes.length - 1];
    if (!prevOut || Math.hypot(ox - prevOut.x, oz - prevOut.z) >= 1.2) {
      parallelNodes.push({ id: makeGraphId('n'), x: ox, y: Math.max(0, round2(c.y)), z: oz, role: 'normal' });
    }
  }

  if (parallelNodes.length < 2) {
    return {
      allowed: false,
      blockedReason: 'Parallel offset collapsed into degenerate length.',
      warnings: [],
      nodes: [...nodes],
      segments: [...segments],
      affectedNodeIds: [],
      affectedSegmentIds: [],
      minRadius: Infinity,
      length: 0,
      violations: [],
      handles: [],
    };
  }

  const parallelSegments: RoadSegment[] = [];
  for (let i = 0; i < parallelNodes.length - 1; i++) {
    parallelSegments.push({
      id: makeGraphId('seg'),
      a: parallelNodes[i]!.id,
      b: parallelNodes[i + 1]!.id,
      width,
      kind: 'curve',
      tension: 0.5,
      elevationMode: firstSeg?.elevationMode,
      slopeMode: firstSeg?.slopeMode,
      isTunnel: firstSeg?.isTunnel,
      isOverpass: firstSeg?.isOverpass,
    });
  }

  const nextNodes = [...nodes.map((n) => ({ ...n })), ...parallelNodes];
  const nextSegments = [...segments.map((s) => ({ ...s })), ...parallelSegments];
  const newIds = parallelSegments.map((s) => s.id);
  const safety = analyzeSectionCurvature(nextNodes, nextSegments, newIds);

  return {
    allowed: true,
    warnings: [],
    nodes: nextNodes,
    segments: nextSegments,
    affectedNodeIds: parallelNodes.map((n) => n.id),
    affectedSegmentIds: newIds,
    minRadius: safety.minRadius,
    length: samples[samples.length - 1]!.s,
    violations: safety.violations,
    handles: [],
  };
}
