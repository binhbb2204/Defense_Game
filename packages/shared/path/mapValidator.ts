import type {
  MapDefinition,
  MapJunction,
  MapPath,
  Vec3,
} from '../types/protocol';
import { getMapPaths } from './mapMigration';
import { RoadPathEvaluator } from './RoadPathEvaluator';

export type MapValidationCode =
  | 'PATH_TOO_SHORT'
  | 'PROP_OVERLAPS_ROAD'
  | 'ROAD_CROSSING_NO_JUNCTION'
  | 'NODES_TOO_FAR'
  | 'SHARP_CURVE'
  | 'STEEP_SLOPE';

export interface MapValidationIssue {
  id: string;
  code: MapValidationCode;
  severity: 'warn' | 'error';
  message: string;
  focusPos: Vec3;
  pathId?: string;
  nodeId?: string;
  entityType?: 'path' | 'path_node' | 'obstacle' | 'zone' | 'custom_model' | 'junction';
  entityId?: string;
}

export interface ValidateMapOptions {
  maxNodeDistance?: number;
  anarchyEnabled?: boolean;
}

interface SampledRoadSpan {
  pathId: string;
  pathName: string;
  a: Vec3;
  b: Vec3;
  halfWidth: number;
  spanIndex: number;
}

function pointToSegmentDistXZ(px: number, pz: number, a: Vec3, b: Vec3): { dist: number; closest: Vec3 } {
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

function intersectSegmentsXZ(
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

  const minBound = allowEndpoints ? -0.001 : 0.02;
  const maxBound = allowEndpoints ? 1.001 : 0.98;
  if (t >= minBound && t <= maxBound && u >= minBound && u <= maxBound) {
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

function samplePathSpans(path: MapPath): SampledRoadSpan[] {
  if (path.nodes.length < 2) return [];
  const ev = new RoadPathEvaluator(path.nodes, {
    defaultRoadWidth: path.width,
    loop: path.loop,
  });
  const count = Math.max(8, Math.min(96, Math.ceil(ev.totalLength / 4)));
  const spans: SampledRoadSpan[] = [];
  let prev = ev.sampleAtDistance(0);
  for (let i = 1; i <= count; i++) {
    const s = (ev.totalLength * i) / count;
    const cur = ev.sampleAtDistance(s);
    spans.push({
      pathId: path.id,
      pathName: path.name,
      a: prev.position,
      b: cur.position,
      halfWidth: Math.max(1.2, (prev.roadWidth + cur.roadWidth) * 0.25),
      spanIndex: i - 1,
    });
    prev = cur;
  }
  return spans;
}

function hasJunctionNear(junctions: readonly MapJunction[], pos: Vec3, radius = 3.2): boolean {
  return junctions.some(
    (j) =>
      Math.hypot(j.pos.x - pos.x, j.pos.z - pos.z) <= radius &&
      Math.abs(j.pos.y - pos.y) <= 2.4,
  );
}

/**
 * Non-blocking Map Validation analyzer:
 * checks path lengths, node spacing, tight curves / steep grades, prop-on-road overlap,
 * and level road crossings missing a Junction.
 */
export function validateMap(
  map: MapDefinition,
  options: ValidateMapOptions = {},
): MapValidationIssue[] {
  const maxNodeDist = options.maxNodeDistance ?? 30;
  const anarchyEnabled = options.anarchyEnabled ?? false;
  const paths = getMapPaths(map);
  const junctions = map.junctions ?? [];
  const issues: MapValidationIssue[] = [];
  const allSpans: SampledRoadSpan[] = [];

  for (const path of paths) {
    if (path.nodes.length < 2) {
      const anchor = path.nodes[0];
      issues.push({
        id: `short_${path.id}`,
        code: 'PATH_TOO_SHORT',
        severity: 'warn',
        message: `"${path.name}" has ${path.nodes.length} node(s). Add at least 2 nodes (Start and End).`,
        focusPos: anchor ? { x: anchor.x, y: anchor.y, z: anchor.z } : { x: 0, y: 0, z: 0 },
        pathId: path.id,
        nodeId: anchor?.id,
        entityType: 'path',
        entityId: path.id,
      });
      continue;
    }

    // Consecutive node distance check (plus loop closing span)
    const pairCount = path.loop && path.nodes.length >= 3 ? path.nodes.length : path.nodes.length - 1;
    for (let i = 0; i < pairCount; i++) {
      const a = path.nodes[i]!;
      const b = path.nodes[(i + 1) % path.nodes.length]!;
      const distXZ = Math.hypot(b.x - a.x, b.z - a.z);
      if (distXZ > maxNodeDist) {
        issues.push({
          id: `far_${path.id}_${i}`,
          code: 'NODES_TOO_FAR',
          severity: 'warn',
          message: `"${path.name}" segment #${i + 1} spans ${distXZ.toFixed(1)}m (> ${maxNodeDist}m threshold). Insert a middle node for smoother curves.`,
          focusPos: {
            x: Number(((a.x + b.x) * 0.5).toFixed(2)),
            y: Number(((a.y + b.y) * 0.5).toFixed(2)),
            z: Number(((a.z + b.z) * 0.5).toFixed(2)),
          },
          pathId: path.id,
          nodeId: a.id,
          entityType: 'path_node',
          entityId: a.id,
        });
      }
    }

    const ev = new RoadPathEvaluator(path.nodes, {
      defaultRoadWidth: path.width,
      anarchyEnabled,
      loop: path.loop,
    });
    const metrics = ev.evaluateSegmentMetrics();
    for (const seg of metrics) {
      for (const issue of seg.issues) {
        const midS = (seg.startDistance + seg.endDistance) * 0.5;
        const midSample = ev.sampleAtDistance(midS);
        const ownerNode = path.nodes[seg.segmentIndex % path.nodes.length];
        issues.push({
          id: `seg_${path.id}_${seg.segmentIndex}_${issue.code}`,
          code: issue.code,
          severity: issue.severity,
          message: `[${path.name} #${seg.segmentIndex + 1}] ${issue.message}`,
          focusPos: midSample.position,
          pathId: path.id,
          nodeId: ownerNode?.id,
          entityType: 'path_node',
          entityId: ownerNode?.id,
        });
      }
    }

    allSpans.push(...samplePathSpans(path));
  }

  // Props overlapping roads (obstacles + imported custom models; skip structural tunnel_shell & pillar)
  if (allSpans.length > 0) {
    for (const obs of map.obstacles) {
      if (obs.kind === 'tunnel_shell' || obs.kind === 'pillar') continue;
      const propHalfFoot = Math.min(obs.size.x, obs.size.z) * 0.45;
      const propBaseY = obs.position.y - obs.size.y * 0.5;
      const propTopY = obs.position.y + obs.size.y * 0.5;

      for (const span of allSpans) {
        const { dist, closest } = pointToSegmentDistXZ(obs.position.x, obs.position.z, span.a, span.b);
        const verticalClearance = propBaseY > closest.y + 3.2 || propTopY < closest.y - 0.5;
        if (!verticalClearance && dist < span.halfWidth + propHalfFoot) {
          issues.push({
            id: `prop_obs_${obs.id}_${span.pathId}`,
            code: 'PROP_OVERLAPS_ROAD',
            severity: 'warn',
            message: `Obstacle "${obs.id}" overlaps "${span.pathName}".`,
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
            id: `prop_mdl_${mdl.id}_${span.pathId}`,
            code: 'PROP_OVERLAPS_ROAD',
            severity: 'warn',
            message: `3D Model "${mdl.name}" overlaps "${span.pathName}".`,
            focusPos: { ...mdl.position },
            entityType: 'custom_model',
            entityId: mdl.id,
          });
          break;
        }
      }
    }
  }

  // Level roads crossing without a Junction (ignores elevated overpasses >= 2.5m vertical separation)
  const recordedCrossings: Vec3[] = [];
  for (let i = 0; i < allSpans.length; i++) {
    const s1 = allSpans[i]!;
    for (let j = i + 1; j < allSpans.length; j++) {
      const s2 = allSpans[j]!;
      if (s1.pathId === s2.pathId && Math.abs(s1.spanIndex - s2.spanIndex) <= 2) {
        continue;
      }
      const cross = intersectSegmentsXZ(s1.a, s1.b, s2.a, s2.b, s1.pathId !== s2.pathId);
      if (!cross.hit || cross.yDiff >= 2.5) continue;
      if (hasJunctionNear(junctions, cross.pos, 3.2)) continue;
      if (
        recordedCrossings.some(
          (rc) => Math.hypot(rc.x - cross.pos.x, rc.z - cross.pos.z) < 3.2,
        )
      ) {
        continue;
      }
      recordedCrossings.push(cross.pos);
      const label =
        s1.pathId === s2.pathId
          ? `"${s1.pathName}" crosses itself without a Junction.`
          : `"${s1.pathName}" crosses "${s2.pathName}" at level height without a Junction.`;
      issues.push({
        id: `cross_${recordedCrossings.length}`,
        code: 'ROAD_CROSSING_NO_JUNCTION',
        severity: 'warn',
        message: label,
        focusPos: cross.pos,
        pathId: s1.pathId,
        entityType: 'path',
        entityId: s1.pathId,
      });
    }
  }

  return issues;
}
