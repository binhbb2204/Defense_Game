import type { RoadNode, RoadSegment, Vec3 } from '../../types/protocol';
import { makeGraphId, round2 } from '../graph/segmentCurve';
import { analyzeSectionCurvature } from './curvatureSafety';
import type { RoundCornerOptions, ShapeOperationResult } from './types';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Tier 2 Round Corner: replaces a single degree-2 node with two tangent nodes at distance
 * `t = r * tan(phi / 2)` (clamped to `<= 0.49` of each adjacent segment) and smooth arc nodes.
 */
export function roundCorner(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  nodeId: string,
  options: RoundCornerOptions = {},
): ShapeOperationResult {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const cornerNode = nodeMap.get(nodeId);
  const inc = segments.filter((s) => s.a === nodeId || s.b === nodeId);

  if (!cornerNode || inc.length !== 2) {
    return {
      allowed: false,
      blockedReason: 'Round corner requires a single interior node connected to exactly 2 segments.',
      warnings: [],
      nodes: [...nodes],
      segments: [...segments],
      affectedNodeIds: [nodeId],
      affectedSegmentIds: inc.map((s) => s.id),
      minRadius: Infinity,
      length: 0,
      violations: [],
      handles: [],
    };
  }
  if (cornerNode.role === 'spawn' || cornerNode.role === 'base') {
    return {
      allowed: false,
      blockedReason: 'Round corner cannot remove a Spawn or Base node.',
      warnings: [],
      nodes: [...nodes],
      segments: [...segments],
      affectedNodeIds: [nodeId],
      affectedSegmentIds: inc.map((s) => s.id),
      minRadius: Infinity,
      length: 0,
      violations: [],
      handles: [],
    };
  }

  const s0 = inc[0]!;
  const s1 = inc[1]!;
  const prevId = s0.a === nodeId ? s0.b : s0.a;
  const nextId = s1.a === nodeId ? s1.b : s1.a;
  const pPrev = nodeMap.get(prevId)!;
  const pNext = nodeMap.get(nextId)!;

  const dxA = pPrev.x - cornerNode.x;
  const dzA = pPrev.z - cornerNode.z;
  const dxB = pNext.x - cornerNode.x;
  const dzB = pNext.z - cornerNode.z;
  const lenA = Math.hypot(dxA, dzA);
  const lenB = Math.hypot(dxB, dzB);
  const uA = { x: dxA / Math.max(1e-6, lenA), z: dzA / Math.max(1e-6, lenA) };
  const uB = { x: dxB / Math.max(1e-6, lenB), z: dzB / Math.max(1e-6, lenB) };

  const dot = clamp(uA.x * uB.x + uA.z * uB.z, -0.999, 0.999);
  const interiorTheta = Math.acos(dot);
  const phi = Math.PI - interiorTheta;
  const tanHalfPhi = Math.tan(phi * 0.5);
  if (tanHalfPhi < 0.02) {
    return {
      allowed: false,
      blockedReason: 'Corner is nearly collinear; no rounding needed.',
      warnings: [],
      nodes: [...nodes],
      segments: [...segments],
      affectedNodeIds: [nodeId],
      affectedSegmentIds: [s0.id, s1.id],
      minRadius: Infinity,
      length: 0,
      violations: [],
      handles: [],
    };
  }

  const reqR = Math.max(2, options.radius ?? 10);
  const rawT = reqR * tanHalfPhi;
  const maxT = 0.49 * Math.min(lenA, lenB);
  const t = Math.min(rawT, maxT);
  const effR = t / tanHalfPhi;

  const t1Pos: Vec3 = {
    x: round2(cornerNode.x + uA.x * t),
    y: round2(cornerNode.y + (pPrev.y - cornerNode.y) * (t / Math.max(1e-4, lenA))),
    z: round2(cornerNode.z + uA.z * t),
  };
  const t2Pos: Vec3 = {
    x: round2(cornerNode.x + uB.x * t),
    y: round2(cornerNode.y + (pNext.y - cornerNode.y) * (t / Math.max(1e-4, lenB))),
    z: round2(cornerNode.z + uB.z * t),
  };

  const bx = uA.x + uB.x;
  const bz = uA.z + uB.z;
  const bLen = Math.hypot(bx, bz);
  const bisX = bLen > 1e-6 ? bx / bLen : -uA.z;
  const bisZ = bLen > 1e-6 ? bz / bLen : uA.x;
  const distToCenter = Math.hypot(effR, t);
  const center = { x: cornerNode.x + bisX * distToCenter, z: cornerNode.z + bisZ * distToCenter };

  const aStart = Math.atan2(t1Pos.z - center.z, t1Pos.x - center.x);
  const aEnd = Math.atan2(t2Pos.z - center.z, t2Pos.x - center.x);
  let sweep = aEnd - aStart;
  while (sweep <= -Math.PI) sweep += Math.PI * 2;
  while (sweep > Math.PI) sweep -= Math.PI * 2;

  const arcSteps = Math.max(2, Math.round(options.arcSegments ?? 4));
  const arcNodes: RoadNode[] = [];
  for (let k = 0; k <= arcSteps; k++) {
    const frac = k / arcSteps;
    const ang = aStart + sweep * frac;
    const y = round2(t1Pos.y + (t2Pos.y - t1Pos.y) * frac);
    arcNodes.push({
      id: makeGraphId('n'),
      x: round2(center.x + Math.cos(ang) * effR),
      y: Math.max(0, y),
      z: round2(center.z + Math.sin(ang) * effR),
      role: 'normal',
    });
  }

  const keptNodes = nodes.filter((n) => n.id !== nodeId).map((n) => ({ ...n }));
  const keptSegs = segments.filter((s) => s.id !== s0.id && s.id !== s1.id).map((s) => ({ ...s }));
  const s0Ends =
    s0.a === nodeId ? { a: arcNodes[0]!.id, b: prevId } : { a: prevId, b: arcNodes[0]!.id };
  const s1Ends =
    s1.b === nodeId
      ? { a: nextId, b: arcNodes[arcNodes.length - 1]!.id }
      : { a: arcNodes[arcNodes.length - 1]!.id, b: nextId };
  const newSegs: RoadSegment[] = [
    { ...s0, id: makeGraphId('seg'), ...s0Ends },
    ...arcNodes.slice(0, -1).map((nd, idx) => ({
      id: makeGraphId('seg'),
      a: nd.id,
      b: arcNodes[idx + 1]!.id,
      width: s0.width,
      kind: 'curve' as const,
      tension: 0.5,
      elevationMode: s0.elevationMode,
      slopeMode: s0.slopeMode,
      isTunnel: s0.isTunnel,
      isOverpass: s0.isOverpass,
    })),
    { ...s1, id: makeGraphId('seg'), ...s1Ends },
  ];

  const nextNodes = [...keptNodes, ...arcNodes];
  const nextSegs = [...keptSegs, ...newSegs];
  const newSegIds = newSegs.map((s) => s.id);
  const safety = analyzeSectionCurvature(nextNodes, nextSegs, newSegIds);
  const warnings: string[] = [];
  if (rawT > maxT + 1e-2) {
    warnings.push(`Clamped radius from ${reqR.toFixed(1)}m to ${effR.toFixed(1)}m to fit adjacent segments.`);
  }
  if (safety.violations.length > 0) {
    warnings.push(`Tight curve radius (${safety.minRadius.toFixed(1)}m).`);
  }

  return {
    allowed: true,
    warnings,
    nodes: nextNodes,
    segments: nextSegs,
    affectedNodeIds: [prevId, ...arcNodes.map((n) => n.id), nextId],
    affectedSegmentIds: newSegIds,
    minRadius: effR,
    length: Math.abs(sweep) * effR,
    violations: safety.violations,
    handles: [],
  };
}
