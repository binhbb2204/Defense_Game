import type { RoadNode, RoadSegment } from '../../types/protocol';
import { findRoutes } from '../graph/graphRouting';
import { round2 } from '../graph/segmentCurve';
import { resolveSegmentCubic, sampleCenterline } from './centerline';
import { analyzeSectionCurvature } from './curvatureSafety';
import type {
  RoadSection,
  ShapeOperationResult,
  ShapePreviewHandle,
  SmoothSectionOptions,
  StraightenSectionOptions,
} from './types';

export { resampleCurve, curveBetween } from './curveBetweenMode';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function collectHandles(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  segmentIds: readonly string[],
): ShapePreviewHandle[] {
  const segSet = new Set(segmentIds);
  const handles: ShapePreviewHandle[] = [];
  for (const seg of segments) {
    if (!segSet.has(seg.id)) continue;
    const c = resolveSegmentCubic(seg, nodes, segments);
    handles.push({ anchor: c.p0, handle: c.c1 }, { anchor: c.p3, handle: c.c2 });
  }
  return handles;
}

/** Smooth (non-destructive): keeps all nodes fixed and enables centripetal Catmull-Rom curves on the chain. */
export function smoothSection(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  section: RoadSection,
  options: SmoothSectionOptions = {},
): ShapeOperationResult {
  const tension = clamp(options.tension ?? 0.5, 0, 1);
  const segSet = new Set(section.segmentIds);
  const nextNodes = nodes.map((n) => ({ ...n }));
  const nextSegments = segments.map((s) =>
    segSet.has(s.id) ? { ...s, kind: 'curve' as const, tension, control: undefined } : { ...s },
  );

  const safety = analyzeSectionCurvature(nextNodes, nextSegments, section.segmentIds);
  const samples = sampleCenterline(
    { nodeIds: section.nodeIds, segmentIds: section.segmentIds, nodes: nextNodes, segments: nextSegments },
    1.5,
    (5 * Math.PI) / 180,
  );
  const length = samples.length > 0 ? samples[samples.length - 1]!.s : 0;
  const warnings: string[] = [];
  if (safety.violations.length > 0) {
    const minReq = safety.violations[0]!.minAllowedRadius;
    warnings.push(
      `Curvature too tight (min R=${safety.minRadius.toFixed(1)}m < ${minReq.toFixed(1)}m).${
        options.anarchyEnabled ? ' (Anarchy warning only)' : ''
      }`,
    );
  }

  return {
    allowed: true,
    warnings,
    nodes: nextNodes,
    segments: nextSegments,
    affectedNodeIds: [...section.nodeIds],
    affectedSegmentIds: [...section.segmentIds],
    minRadius: safety.minRadius,
    length,
    violations: safety.violations,
    handles: collectHandles(nextNodes, nextSegments, section.segmentIds),
  };
}

/** Straighten (destructive): aligns interior nodes onto A-B and converts chain segments to straight. */
export function straightenSection(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  section: RoadSection,
  options: StraightenSectionOptions = {},
): ShapeOperationResult {
  if (section.hasInteriorSpawnOrBase) {
    return {
      allowed: false,
      blockedReason: 'Straighten moves interior nodes and is blocked across Spawn/Base interior nodes.',
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
  const dx = nodeB.x - nodeA.x;
  const dy = nodeB.y - nodeA.y;
  const dz = nodeB.z - nodeA.z;
  const lenSqXZ = dx * dx + dz * dz;
  const nLen = section.nodeIds.length;
  const minGap = 1 / Math.max(20, nLen * 4);

  const projectedParams = new Map<string, number>();
  let prevT = 0;
  for (let i = 1; i < nLen - 1; i++) {
    const id = section.nodeIds[i]!;
    const p = nodeMap.get(id)!;
    let t =
      options.equaliseSpacing || lenSqXZ < 1e-6
        ? i / (nLen - 1)
        : clamp(((p.x - nodeA.x) * dx + (p.z - nodeA.z) * dz) / lenSqXZ, prevT + minGap, 1 - (nLen - 1 - i) * minGap);
    if (!options.equaliseSpacing && t <= prevT + 1e-4) t = Math.min(1 - minGap, prevT + minGap);
    projectedParams.set(id, t);
    prevT = t;
  }

  const nextNodes = nodes.map((n) => {
    const t = projectedParams.get(n.id);
    if (t === undefined) return { ...n };
    return {
      ...n,
      x: round2(nodeA.x + dx * t),
      y: Math.max(0, round2(nodeA.y + dy * t)),
      z: round2(nodeA.z + dz * t),
    };
  });

  const segSet = new Set(section.segmentIds);
  const nextSegments = segments.map((s) =>
    segSet.has(s.id)
      ? { ...s, kind: 'straight' as const, control: undefined, tension: undefined }
      : { ...s },
  );

  return {
    allowed: true,
    warnings: [],
    nodes: nextNodes,
    segments: nextSegments,
    affectedNodeIds: [...section.nodeIds],
    affectedSegmentIds: [...section.segmentIds],
    minRadius: Infinity,
    length: Math.hypot(dx, dy, dz),
    violations: [],
    handles: [],
  };
}

/** Reverse (non-destructive): swaps a/b and marks directional flow on every segment in the chain. */
export function reverseSection(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  section: RoadSection,
): ShapeOperationResult {
  const beforeRoutes = findRoutes(nodes, segments, 8).length;
  const segSet = new Set(section.segmentIds);
  const nextNodes = nodes.map((n) => ({ ...n }));
  const nextSegments = segments.map((s) =>
    segSet.has(s.id) ? { ...s, a: s.b, b: s.a, oneWay: true } : { ...s },
  );
  const afterRoutes = findRoutes(nextNodes, nextSegments, 8).length;
  const warnings: string[] = [];
  if (beforeRoutes > 0 && afterRoutes === 0) {
    warnings.push('Warning: Reversing this section breaks Spawn-to-Base reachability!');
  }

  const safety = analyzeSectionCurvature(nextNodes, nextSegments, section.segmentIds);
  return {
    allowed: true,
    warnings,
    nodes: nextNodes,
    segments: nextSegments,
    affectedNodeIds: [...section.nodeIds],
    affectedSegmentIds: [...section.segmentIds],
    minRadius: safety.minRadius,
    length: section.length,
    violations: safety.violations,
    handles: [],
  };
}
