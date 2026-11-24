import {
  evaluateRoadSegmentAt,
  sampleRoadSegment,
  snapToNode,
  snapToSegment,
  type RoadNode,
  type RoadSegment,
  type Vec2,
  type Vec3,
  type WaypointElevationMode,
} from '@tactical-td/shared';

export type SnapHitKind = 'node' | 'segment' | 'grid' | 'free';

export interface RoadSnapResult {
  kind: SnapHitKind;
  pos: Vec3;
  nodeId?: string;
  segmentId?: string;
  segmentT?: number;
}

export interface RoadCrossingHit {
  segmentId: string;
  point: Vec3;
  candidateT: number;
  existingT: number;
}

export function resolveRoadCursorSnap(
  rawXZ: Vec2,
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  options: {
    snapEnabled: boolean;
    gridEnabled: boolean;
    gridStep: number;
    snapRadius: number;
    drawElevation: number;
    elevationMode: WaypointElevationMode;
    altHeld: boolean;
    excludeNodeId?: string;
    isDrawing?: boolean;
  },
): RoadSnapResult {
  const defaultY = Math.max(0, options.drawElevation);
  const filterByElevation = defaultY > 0 || Boolean(options.isDrawing);

  if (!options.altHeld && options.snapEnabled) {
    const snapNodes = filterByElevation
      ? nodes.filter((n) => Math.abs(n.y - defaultY) < 2.5)
      : nodes;
    const nodeHit = snapToNode(snapNodes, rawXZ, options.snapRadius, options.excludeNodeId);
    if (nodeHit) {
      return {
        kind: 'node',
        pos: { x: nodeHit.node.x, y: nodeHit.node.y, z: nodeHit.node.z },
        nodeId: nodeHit.node.id,
      };
    }

    let snapSegments = segments;
    if (filterByElevation) {
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      snapSegments = segments.filter((s) => {
        const a = nodeMap.get(s.a);
        const b = nodeMap.get(s.b);
        if (!a || !b) return false;
        const minY = Math.min(a.y, b.y) - 2.5;
        const maxY = Math.max(a.y, b.y) + 2.5;
        return defaultY >= minY && defaultY <= maxY;
      });
    }

    const segHit = snapToSegment(
      nodes,
      snapSegments,
      rawXZ,
      options.snapRadius * 0.9,
      options.excludeNodeId,
    );
    if (segHit && (!filterByElevation || Math.abs(segHit.point.y - defaultY) < 2.5)) {
      return {
        kind: 'segment',
        pos: segHit.point,
        segmentId: segHit.segment.id,
        segmentT: segHit.t,
      };
    }
  }

  if (!options.altHeld && options.gridEnabled) {
    const step = Math.max(0.5, options.gridStep);
    return {
      kind: 'grid',
      pos: {
        x: Number((Math.round(rawXZ.x / step) * step).toFixed(2)),
        y: defaultY,
        z: Number((Math.round(rawXZ.z / step) * step).toFixed(2)),
      },
    };
  }

  return {
    kind: 'free',
    pos: {
      x: Number(rawXZ.x.toFixed(1)),
      y: defaultY,
      z: Number(rawXZ.z.toFixed(1)),
    },
  };
}

function segmentsCrossXZ(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
): { hit: boolean; yDiff: number; t: number; u: number; point: Vec3 } {
  const rX = b.x - a.x;
  const rZ = b.z - a.z;
  const sX = d.x - c.x;
  const sZ = d.z - c.z;
  const denom = rX * sZ - rZ * sX;
  if (Math.abs(denom) < 1e-5) {
    return { hit: false, yDiff: 0, t: 0, u: 0, point: { x: 0, y: 0, z: 0 } };
  }
  const t = ((c.x - a.x) * sZ - (c.z - a.z) * sX) / denom;
  const u = ((c.x - a.x) * rZ - (c.z - a.z) * rX) / denom;
  if (t > 0.04 && t < 0.96 && u > 0.04 && u < 0.96) {
    const y1 = a.y + (b.y - a.y) * t;
    const y2 = c.y + (d.y - c.y) * u;
    return {
      hit: true,
      yDiff: Math.abs(y1 - y2),
      t,
      u,
      point: {
        x: Number((a.x + rX * t).toFixed(3)),
        y: Number(((y1 + y2) * 0.5).toFixed(3)),
        z: Number((a.z + rZ * t).toFixed(3)),
      },
    };
  }
  return { hit: false, yDiff: 0, t: 0, u: 0, point: { x: 0, y: 0, z: 0 } };
}

/**
 * Finds all level-grade crossings (< 2.5m elevation diff) between the candidate segment
 * and existing graph segments (excluding directly adjacent/snapped segments), ordered along candidateT.
 */
export function findSegmentCrossings(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  anchorNode: RoadNode,
  targetSnap: RoadSnapResult,
  control: Vec3 | null,
): RoadCrossingHit[] {
  const segCandidate: Pick<RoadSegment, 'kind' | 'control'> = {
    kind: control ? 'curve' : 'straight',
    control: control ?? undefined,
  };
  const candSteps = segCandidate.kind === 'curve' ? 14 : 4;
  const pts = sampleRoadSegment(anchorNode, targetSnap.pos, segCandidate, candSteps);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const hits: RoadCrossingHit[] = [];

  for (const seg of segments) {
    if (
      seg.a === anchorNode.id ||
      seg.b === anchorNode.id ||
      (targetSnap.kind === 'node' && (seg.a === targetSnap.nodeId || seg.b === targetSnap.nodeId)) ||
      (targetSnap.kind === 'segment' && seg.id === targetSnap.segmentId)
    ) {
      continue;
    }
    const ea = nodeMap.get(seg.a);
    const eb = nodeMap.get(seg.b);
    if (!ea || !eb) continue;
    const exSteps = seg.kind === 'curve' ? 12 : 4;
    const exPts = sampleRoadSegment(ea, eb, seg, exSteps);

    let recordedForSeg = false;
    for (let i = 1; i < pts.length && !recordedForSeg; i++) {
      for (let j = 1; j < exPts.length; j++) {
        const res = segmentsCrossXZ(pts[i - 1]!, pts[i]!, exPts[j - 1]!, exPts[j]!);
        if (res.hit && res.yDiff < 2.5) {
          const candidateT = ((i - 1) + res.t) / candSteps;
          const existingT = ((j - 1) + res.u) / exSteps;
          const tooClose = hits.some(
            (h) => Math.hypot(h.point.x - res.point.x, h.point.z - res.point.z) < 0.6,
          );
          if (!tooClose) {
            hits.push({ segmentId: seg.id, point: res.point, candidateT, existingT });
            recordedForSeg = true;
            break;
          }
        }
      }
    }
  }

  hits.sort((a, b) => a.candidateT - b.candidateT);
  return hits;
}

export function checkNodeIncidentAngles(
  node: RoadNode,
  outgoingDirXZ: { x: number; z: number },
  segments: readonly RoadSegment[],
  nodeMap: Map<string, RoadNode>,
  minAngleDeg: number,
): boolean {
  const cosLimit = Math.cos((minAngleDeg * Math.PI) / 180);
  const dLen = Math.hypot(outgoingDirXZ.x, outgoingDirXZ.z) || 1;
  const dx = outgoingDirXZ.x / dLen;
  const dz = outgoingDirXZ.z / dLen;

  for (const s of segments) {
    if (s.a !== node.id && s.b !== node.id) continue;
    const otherId = s.a === node.id ? s.b : s.a;
    const other = nodeMap.get(otherId);
    if (!other) continue;
    const refPos = s.kind === 'curve' && s.control ? s.control : other;
    const ox = refPos.x - node.x;
    const oz = refPos.z - node.z;
    const oLen = Math.hypot(ox, oz) || 1;
    if ((dx * ox + dz * oz) / oLen > cosLimit) {
      return false;
    }
  }
  return true;
}

export function evaluateCandidateEnds(
  anchorNode: RoadNode,
  targetPos: Vec3,
  segCandidate: Pick<RoadSegment, 'kind' | 'control'>,
) {
  const startTan = evaluateRoadSegmentAt(anchorNode, targetPos, segCandidate, 0.05).tangent;
  const endTan = evaluateRoadSegmentAt(anchorNode, targetPos, segCandidate, 0.95).tangent;
  return { startTan, intoTarget: { x: -endTan.x, z: -endTan.z } };
}

/**
 * Builds a minimal local RoadGraph containing anchor/target neighbors plus the candidate
 * segment so the ghost preview uses the exact per-node joint geometry generator.
 */
export function buildGhostPreviewGraph(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  anchorNode: RoadNode,
  targetSnap: RoadSnapResult,
  control: Vec3 | null,
  roadWidth: number,
  elevationMode: WaypointElevationMode,
): { nodes: RoadNode[]; segments: RoadSegment[] } {
  const includedNodeIds = new Set<string>([anchorNode.id]);
  const includedSegs: RoadSegment[] = [];

  for (const s of segments) {
    if (
      s.a === anchorNode.id ||
      s.b === anchorNode.id ||
      (targetSnap.kind === 'node' &&
        targetSnap.nodeId &&
        (s.a === targetSnap.nodeId || s.b === targetSnap.nodeId))
    ) {
      includedSegs.push(s);
      includedNodeIds.add(s.a);
      includedNodeIds.add(s.b);
    }
  }

  const localNodes = nodes.filter((n) => includedNodeIds.has(n.id));
  let targetId = targetSnap.nodeId;
  if (targetSnap.kind !== 'node' || !targetId) {
    targetId = '__ghost_target__';
    localNodes.push({
      id: targetId,
      x: targetSnap.pos.x,
      y: targetSnap.pos.y,
      z: targetSnap.pos.z,
      role: 'normal',
    });
  }

  includedSegs.push({
    id: '__ghost_seg__',
    a: anchorNode.id,
    b: targetId,
    width: roadWidth,
    kind: control ? 'curve' : 'straight',
    control: control ?? undefined,
    elevationMode,
  });

  return { nodes: localNodes, segments: includedSegs };
}
