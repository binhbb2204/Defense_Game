import type { RoadNode, RoadSegment, Vec2, Vec3 } from '../../types/protocol';
import { closestParamOnSegmentXZ, round2 } from './segmentCurve';

/** Snaps to closest existing RoadNode within `radius` XZ. */
export function snapToNode(
  nodes: readonly RoadNode[],
  pos: Vec2 | Vec3,
  radius: number,
  excludeNodeId?: string,
): { node: RoadNode; distance: number } | null {
  let bestDist = radius;
  let best: RoadNode | null = null;
  for (const n of nodes) {
    if (excludeNodeId && n.id === excludeNodeId) continue;
    const d = Math.hypot(n.x - pos.x, n.z - pos.z);
    if (d <= bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best ? { node: best, distance: bestDist } : null;
}

/** Snaps to closest existing RoadSegment within `radius` XZ. */
export function snapToSegment(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  pos: Vec2 | Vec3,
  radius: number,
  excludeIncidentNodeId?: string,
): { segment: RoadSegment; t: number; point: Vec3; distance: number } | null {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let bestDist = radius;
  let bestHit: { segment: RoadSegment; t: number; point: Vec3; distance: number } | null = null;

  for (const seg of segments) {
    if (excludeIncidentNodeId && (seg.a === excludeIncidentNodeId || seg.b === excludeIncidentNodeId)) {
      continue;
    }
    const a = nodeMap.get(seg.a);
    const b = nodeMap.get(seg.b);
    if (!a || !b) continue;
    const hit = closestParamOnSegmentXZ(a, b, seg, pos.x, pos.z, nodes, segments);
    if (hit.distXZ <= bestDist) {
      bestDist = hit.distXZ;
      bestHit = {
        segment: seg,
        t: hit.t,
        point: {
          x: round2(hit.point.x),
          y: Math.max(0, round2(hit.point.y)),
          z: round2(hit.point.z),
        },
        distance: hit.distXZ,
      };
    }
  }

  return bestHit;
}
