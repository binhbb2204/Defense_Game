import type {
  MapDefinition,
  RoadNode,
  RoadSegment,
  Vec3,
} from '../types/protocol';
import { getMapGraph } from './mapMigration';
import {
  findRoutes,
  measureRoadSegment,
} from './roadGraph';
import { sampleCenterline } from './shaping';

export type RoadGraphValidationCode =
  | 'SPAWN_NO_ROUTE'
  | 'ISOLATED_NODE'
  | 'PROP_OVERLAPS_ROAD'
  | 'ROAD_CROSSING_NO_NODE'
  | 'SHARP_CURVE'
  | 'STEEP_SLOPE';

export interface RoadGraphValidationIssue {
  id: string;
  code: RoadGraphValidationCode;
  severity: 'warn' | 'error';
  message: string;
  focusPos: Vec3;
  entityType?: 'road_node' | 'road_segment' | 'obstacle' | 'zone' | 'custom_model';
  entityId?: string;
}

export interface ValidateRoadGraphOptions {
  anarchyEnabled?: boolean;
}

interface SampledGraphSpan {
  segmentId: string;
  aId: string;
  bId: string;
  a: Vec3;
  b: Vec3;
  halfWidth: number;
  spanIndex: number;
}

function pointToSegmentDistXZ(
  px: number,
  pz: number,
  a: Vec3,
  b: Vec3,
): { dist: number; closest: Vec3 } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) {
    return { dist: Math.hypot(px - a.x, pz - a.z), closest: a };
  }
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq));
  const cx = a.x + dx * t;
  const cy = a.y + (b.y - a.y) * t;
  const cz = a.z + dz * t;
  return {
    dist: Math.hypot(px - cx, pz - cz),
    closest: { x: cx, y: cy, z: cz },
  };
}

function intersectSpansXZ(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  allowEndpoints: boolean,
): { hit: boolean; pos: Vec3; yDiff: number } {
  const rX = b.x - a.x;
  const rZ = b.z - a.z;
  const sX = d.x - c.x;
  const sZ = d.z - c.z;
  const denom = rX * sZ - rZ * sX;
  if (Math.abs(denom) < 1e-5) {
    return { hit: false, pos: { x: 0, y: 0, z: 0 }, yDiff: 0 };
  }
  const qpx = c.x - a.x;
  const qpz = c.z - a.z;
  const t = (qpx * sZ - qpz * sX) / denom;
  const u = (qpx * rZ - qpz * rX) / denom;

  const minB = allowEndpoints ? -0.001 : 0.02;
  const maxB = allowEndpoints ? 1.001 : 0.98;
  if (t >= minB && t <= maxB && u >= minB && u <= maxB) {
    const ct = Math.max(0, Math.min(1, t));
    const cu = Math.max(0, Math.min(1, u));
    const y1 = a.y + (b.y - a.y) * ct;
    const y2 = c.y + (d.y - c.y) * cu;
    return {
      hit: true,
      pos: {
        x: Number((a.x + ct * rX).toFixed(2)),
        y: Number(((y1 + y2) * 0.5).toFixed(2)),
        z: Number((a.z + ct * rZ).toFixed(2)),
      },
      yDiff: Math.abs(y1 - y2),
    };
  }
  return { hit: false, pos: { x: 0, y: 0, z: 0 }, yDiff: 0 };
}

function sharesEndpoint(s1: RoadSegment, s2: RoadSegment): boolean {
  return (
    s1.a === s2.a ||
    s1.a === s2.b ||
    s1.b === s2.a ||
    s1.b === s2.b
  );
}

/**
 * Non-blocking Road Graph Validator:
 * - Spawns with no route to any Base
 * - Isolated nodes (degree 0)
 * - Props overlapping road segments
 * - Level roads crossing without a shared junction node (elevated bridges ignored)
 * - Tight curve radii and steep grades (>22%)
 */
export function validateRoadGraph(
  map: MapDefinition,
  options: ValidateRoadGraphOptions = {},
): RoadGraphValidationIssue[] {
  const { nodes, segments } = getMapGraph(map);
  const issues: RoadGraphValidationIssue[] = [];
  const nodeMap = new Map<string, RoadNode>(nodes.map((n) => [n.id, n]));

  // Degree counter per node
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const s of segments) {
    degree.set(s.a, (degree.get(s.a) ?? 0) + 1);
    degree.set(s.b, (degree.get(s.b) ?? 0) + 1);
  }

  for (const n of nodes) {
    if ((degree.get(n.id) ?? 0) === 0) {
      issues.push({
        id: `iso_${n.id}`,
        code: 'ISOLATED_NODE',
        severity: 'warn',
        message: `Node "${n.label || n.id}" is isolated (no connected segments).`,
        focusPos: { x: n.x, y: n.y, z: n.z },
        entityType: 'road_node',
        entityId: n.id,
      });
    }
  }

  // Spawn -> Base reachability via findRoutes
  const routes = findRoutes(nodes, segments);
  const routedSpawns = new Set(routes.map((r) => r.spawnId));
  for (const n of nodes) {
    if (n.role === 'spawn' && !routedSpawns.has(n.id)) {
      issues.push({
        id: `noroute_${n.id}`,
        code: 'SPAWN_NO_ROUTE',
        severity: 'error',
        message: `Spawn "${n.label || n.id}" has no connected route to a Base node.`,
        focusPos: { x: n.x, y: n.y, z: n.z },
        entityType: 'road_node',
        entityId: n.id,
      });
    }
  }

  // Geometry metrics & polyline spans per segment
  const allSpans: SampledGraphSpan[] = [];
  for (const seg of segments) {
    const a = nodeMap.get(seg.a);
    const b = nodeMap.get(seg.b);
    if (!a || !b) continue;

    const metrics = measureRoadSegment(a, b, seg, nodes, segments);
    const mid = {
      x: Number(((a.x + b.x) * 0.5).toFixed(2)),
      y: Number(((a.y + b.y) * 0.5).toFixed(2)),
      z: Number(((a.z + b.z) * 0.5).toFixed(2)),
    };

    if (!options.anarchyEnabled) {
      const safeMinR = Math.max(0.5, seg.width * 0.5);
      if (Number.isFinite(metrics.minTurnRadius) && metrics.minTurnRadius < safeMinR) {
        issues.push({
          id: `sharp_${seg.id}`,
          code: 'SHARP_CURVE',
          severity: 'warn',
          message: `Segment "${seg.id}" tight curve radius (${metrics.minTurnRadius.toFixed(1)}m < ${safeMinR.toFixed(1)}m).`,
          focusPos: mid,
          entityType: 'road_segment',
          entityId: seg.id,
        });
      }
      if (metrics.maxSlopePct > 22) {
        issues.push({
          id: `steep_${seg.id}`,
          code: 'STEEP_SLOPE',
          severity: 'error',
          message: `Segment "${seg.id}" grade (${metrics.maxSlopePct.toFixed(0)}%) exceeds 22%.`,
          focusPos: mid,
          entityType: 'road_segment',
          entityId: seg.id,
        });
      }
    }

    const pts = sampleCenterline({ segment: seg, nodes, segments }, 1.5, (5 * Math.PI) / 180);
    for (let k = 1; k < pts.length; k++) {
      allSpans.push({
        segmentId: seg.id,
        aId: seg.a,
        bId: seg.b,
        a: pts[k - 1]!,
        b: pts[k]!,
        halfWidth: Math.max(1.2, seg.width * 0.5),
        spanIndex: k - 1,
      });
    }
  }

  // Props overlapping roads
  if (allSpans.length > 0) {
    for (const obs of map.obstacles) {
      if (obs.kind === 'tunnel_shell' || obs.kind === 'pillar') continue;
      const halfFoot = Math.min(obs.size.x, obs.size.z) * 0.45;
      const baseY = obs.position.y - obs.size.y * 0.5;
      const topY = obs.position.y + obs.size.y * 0.5;
      for (const span of allSpans) {
        const { dist, closest } = pointToSegmentDistXZ(obs.position.x, obs.position.z, span.a, span.b);
        const clearVert = baseY > closest.y + 3.2 || topY < closest.y - 0.5;
        if (!clearVert && dist < span.halfWidth + halfFoot) {
          issues.push({
            id: `ov_obs_${obs.id}_${span.segmentId}`,
            code: 'PROP_OVERLAPS_ROAD',
            severity: 'warn',
            message: `Obstacle "${obs.id}" overlaps road segment.`,
            focusPos: { ...obs.position },
            entityType: 'obstacle',
            entityId: obs.id,
          });
          break;
        }
      }
    }

    for (const mdl of map.customModels ?? []) {
      const approxFoot = Math.max(mdl.scale.x, mdl.scale.z) * 0.65;
      for (const span of allSpans) {
        const { dist, closest } = pointToSegmentDistXZ(mdl.position.x, mdl.position.z, span.a, span.b);
        if (Math.abs(mdl.position.y - closest.y) < 3.0 && dist < span.halfWidth + approxFoot) {
          issues.push({
            id: `ov_mdl_${mdl.id}_${span.segmentId}`,
            code: 'PROP_OVERLAPS_ROAD',
            severity: 'warn',
            message: `3D Model "${mdl.name}" overlaps road segment.`,
            focusPos: { ...mdl.position },
            entityType: 'custom_model',
            entityId: mdl.id,
          });
          break;
        }
      }
    }
  }

  // Level roads crossing without a shared node
  const segLookup = new Map(segments.map((s) => [s.id, s]));
  const recorded: Vec3[] = [];
  for (let i = 0; i < allSpans.length; i++) {
    const s1 = allSpans[i]!;
    const seg1 = segLookup.get(s1.segmentId);
    if (!seg1) continue;
    for (let j = i + 1; j < allSpans.length; j++) {
      const s2 = allSpans[j]!;
      if (s1.segmentId === s2.segmentId) continue;
      const seg2 = segLookup.get(s2.segmentId);
      if (!seg2 || sharesEndpoint(seg1, seg2)) continue;

      const cross = intersectSpansXZ(s1.a, s1.b, s2.a, s2.b, true);
      if (!cross.hit || cross.yDiff >= 2.5) continue;
      if (recorded.some((rc) => Math.hypot(rc.x - cross.pos.x, rc.z - cross.pos.z) < 2.5)) {
        continue;
      }
      recorded.push(cross.pos);
      issues.push({
        id: `cross_${recorded.length}`,
        code: 'ROAD_CROSSING_NO_NODE',
        severity: 'warn',
        message: 'Two roads cross at level grade without a junction node (snap to split & connect).',
        focusPos: cross.pos,
        entityType: 'road_segment',
        entityId: seg1.id,
      });
    }
  }

  return issues;
}
