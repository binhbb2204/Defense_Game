import {
  MAP_SCHEMA_VERSION,
  type MapDefinition,
  type RoadNode,
  type RoadSegment,
  type WaypointNode,
} from '../types/protocol';
import { addNode, addSegment, findRoutes } from './roadGraph';
import { sampleCenterline } from './shaping';

export const PATH_COLOR_PALETTE = [
  '#38bdf8',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#a855f7',
  '#f97316',
  '#14b8a6',
  '#ef4444',
] as const;

/**
 * Creates a clean empty MapDefinition (schema v3 graph) with no preloaded roads or props.
 */
export function createEmptyMap(
  id = 'untitled_map',
  name = 'Untitled Map',
): MapDefinition {
  return {
    id,
    name,
    version: MAP_SCHEMA_VERSION,
    bounds: { width: 96, depth: 72 },
    baseHp: 100,
    startingCash: 450,
    defaultRoadWidth: 5.2,
    nodes: [],
    segments: [],
    waypoints: [],
    obstacles: [],
    elevatedZones: [],
    customModels: [],
  };
}

/**
 * Derives a legacy linear `waypoints` polyline from the Road Graph (first Spawn -> Base route)
 * so runtime `PathSystem`, `GameEngine`, and `BalanceSim` remain 100% compatible.
 */
export function syncGraphToLegacyWaypoints(map: MapDefinition): MapDefinition {
  const nodes = map.nodes ?? [];
  const segments = map.segments ?? [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const segMap = new Map(segments.map((s) => [s.id, s]));

  const routes = findRoutes(nodes, segments, 4);
  let orderedIds: string[] = routes[0]?.nodeIds ?? [];

  if (orderedIds.length === 0 && nodes.length >= 2 && segments.length >= 1) {
    // Fallback: follow first connected chain from earliest spawn or earliest node
    const start = nodes.find((n) => n.role === 'spawn') ?? nodes[0]!;
    const visited = new Set<string>([start.id]);
    const chain = [start.id];
    let cur = start.id;
    while (true) {
      const nextSeg = segments.find(
        (s) =>
          (s.a === cur && !visited.has(s.b)) ||
          (s.b === cur && !visited.has(s.a)),
      );
      if (!nextSeg) break;
      const nxt = nextSeg.a === cur ? nextSeg.b : nextSeg.a;
      visited.add(nxt);
      chain.push(nxt);
      cur = nxt;
    }
    orderedIds = chain;
  }

  const waypoints: WaypointNode[] = [];
  const hasCurvedSegment =
    orderedIds.length >= 2 &&
    orderedIds.some((nid, idx) => {
      if (idx >= orderedIds.length - 1) return false;
      const nextId = orderedIds[idx + 1]!;
      const seg = segments.find(
        (s) => (s.a === nid && s.b === nextId) || (s.b === nid && s.a === nextId),
      );
      return seg?.kind === 'curve';
    });

  if (hasCurvedSegment && orderedIds.length >= 2) {
    const orderedSegIds: string[] = [];
    for (let i = 0; i < orderedIds.length - 1; i++) {
      const aId = orderedIds[i]!;
      const bId = orderedIds[i + 1]!;
      const seg = segments.find(
        (s) => (s.a === aId && s.b === bId) || (s.b === aId && s.a === bId),
      );
      if (seg) orderedSegIds.push(seg.id);
    }
    const samples = sampleCenterline(
      { nodeIds: orderedIds, segmentIds: orderedSegIds, nodes, segments },
      1.5,
      (5 * Math.PI) / 180,
    );
    const segLookup = new Map(segments.map((s) => [s.id, s]));
    for (let i = 0; i < samples.length; i++) {
      const sp = samples[i]!;
      const seg = segLookup.get(sp.segmentId);
      waypoints.push({
        id: i === 0 ? orderedIds[0] : i === samples.length - 1 ? orderedIds[orderedIds.length - 1] : undefined,
        x: sp.x,
        y: sp.y,
        z: sp.z,
        roadWidth: sp.width || map.defaultRoadWidth,
        segmentMode: 'straight',
        elevationMode: seg?.elevationMode,
        slopeMode: seg?.slopeMode,
        isTunnel: sp.isTunnel,
        isOverpass: sp.isOverpass,
        roadPartAsset: sp.roadPartAsset,
      });
    }
  } else {
    for (let i = 0; i < orderedIds.length; i++) {
      const n = nodeMap.get(orderedIds[i]!)!;
      const nextId = orderedIds[i + 1];
      const connectingSeg = nextId
        ? segments.find(
            (s) => (s.a === n.id && s.b === nextId) || (s.b === n.id && s.a === nextId),
          ) ?? segMap.get('')
        : undefined;

      waypoints.push({
        id: n.id,
        label: n.label,
        x: n.x,
        y: n.y,
        z: n.z,
        roadWidth: connectingSeg?.width ?? map.defaultRoadWidth,
        segmentMode: connectingSeg?.kind,
        curveControl: connectingSeg?.control
          ? { x: connectingSeg.control.x, z: connectingSeg.control.z }
          : undefined,
        elevationMode: connectingSeg?.elevationMode,
        slopeMode: connectingSeg?.slopeMode,
        isTunnel: connectingSeg?.isTunnel,
        isOverpass: connectingSeg?.isOverpass,
        roadPartAsset: connectingSeg?.roadPartAsset,
      });
    }
  }

  return {
    ...map,
    version: MAP_SCHEMA_VERSION,
    nodes,
    segments,
    waypoints,
  };
}

/** Alias kept for any caller using previous name. */
export const syncLegacyWaypoints = syncGraphToLegacyWaypoints;

function waypointsListToChain(
  rawList: readonly WaypointNode[],
  defaultWidth: number,
  nodePrefix: string,
  segPrefix: string,
): { nodes: RoadNode[]; segments: RoadSegment[] } {
  let nodes: RoadNode[] = [];
  let segments: RoadSegment[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const wp = rawList[i]!;
    const role =
      rawList.length >= 2 && i === 0
        ? 'spawn'
        : rawList.length >= 2 && i === rawList.length - 1
          ? 'base'
          : 'normal';
    const res = addNode(
      nodes,
      { x: wp.x, y: wp.y, z: wp.z },
      {
        id: wp.id?.trim() || `${nodePrefix}_${String(i + 1).padStart(2, '0')}`,
        role,
        label: wp.label,
      },
    );
    nodes = res.nodes;
  }

  for (let i = 0; i < rawList.length - 1; i++) {
    const wpA = rawList[i]!;
    const wpB = rawList[i + 1]!;
    const nodeA = nodes[i]!;
    const nodeB = nodes[i + 1]!;
    const segRes = addSegment(nodes, segments, nodeA.id, nodeB.id, {
      id: `${segPrefix}_${String(i + 1).padStart(2, '0')}`,
      width: wpA.roadWidth ?? defaultWidth,
      kind: wpA.segmentMode === 'curve' && wpA.curveControl ? 'curve' : 'straight',
      control: wpA.curveControl
        ? {
            x: wpA.curveControl.x,
            y: Number(((wpA.y + wpB.y) * 0.5).toFixed(2)),
            z: wpA.curveControl.z,
          }
        : undefined,
      elevationMode: wpA.elevationMode,
      slopeMode: wpA.slopeMode,
      isTunnel: wpA.isTunnel ?? (wpA.elevationMode === 'tunnel' ? true : undefined),
      isOverpass:
        wpA.isOverpass ??
        (wpA.elevationMode === 'bridge' || wpA.elevationMode === 'elevated' ? true : undefined),
      roadPartAsset: wpA.roadPartAsset,
    });
    segments = segRes.segments;
  }

  return { nodes, segments };
}

/**
 * Pure immutable v1 / v2 -> v3 Road Graph migrator.
 * - v3 (`nodes[]` + `segments[]`): normalizes & syncs `waypoints`.
 * - v2 (`paths[]`): merges paths into graph nodes + segments.
 * - v1 (`waypoints[]`, e.g., `highway_01.json`): builds a chain of `N` RoadNodes (first=spawn, last=base)
 *   and `N-1` RoadSegments (highway_01 -> 18 nodes, 17 segments).
 */
export function migrateMapDefinition(raw: MapDefinition): MapDefinition {
  const defaultRoadWidth =
    typeof raw.defaultRoadWidth === 'number' && raw.defaultRoadWidth > 0
      ? raw.defaultRoadWidth
      : 5.2;
  const bounds = {
    width: raw.bounds?.width ?? 96,
    depth: raw.bounds?.depth ?? 72,
  };

  let nodes: RoadNode[] = [];
  let segments: RoadSegment[] = [];

  if (Array.isArray(raw.nodes) && Array.isArray(raw.segments)) {
    const isV4OrNewer = typeof raw.version === 'number' && raw.version >= 4;
    nodes = raw.nodes.map((n, idx) => ({
      id: n.id && n.id.trim().length > 0 ? n.id : `n_${String(idx + 1).padStart(2, '0')}`,
      x: n.x,
      y: n.y,
      z: n.z,
      role: n.role === 'spawn' || n.role === 'base' ? n.role : 'normal',
      label: n.label,
      corner: isV4OrNewer && n.corner ? true : undefined,
    }));
    const validIds = new Set(nodes.map((n) => n.id));
    segments = raw.segments
      .filter((s) => s.a !== s.b && validIds.has(s.a) && validIds.has(s.b))
      .map((s, idx) => {
        const hasExplicitControl = s.kind === 'curve' && s.control !== undefined;
        const keepDerivedCurve = isV4OrNewer && s.kind === 'curve';
        return {
          ...s,
          id: s.id && s.id.trim().length > 0 ? s.id : `seg_${String(idx + 1).padStart(2, '0')}`,
          width: s.width > 0 ? s.width : defaultRoadWidth,
          kind: hasExplicitControl || keepDerivedCurve ? 'curve' : 'straight',
          control: hasExplicitControl && s.control ? { ...s.control } : undefined,
          tension:
            isV4OrNewer && s.kind === 'curve' && !hasExplicitControl
              ? Math.max(0, Math.min(1, s.tension ?? 0.5))
              : undefined,
          oneWay: s.oneWay ? true : undefined,
        };
      });
  } else if (Array.isArray(raw.paths) && raw.paths.length > 0) {
    raw.paths.forEach((lane, pIdx) => {
      const chain = waypointsListToChain(
        lane.nodes ?? [],
        lane.width || defaultRoadWidth,
        `p${pIdx + 1}_n`,
        `p${pIdx + 1}_s`,
      );
      nodes.push(...chain.nodes);
      segments.push(...chain.segments);
    });
  } else if (Array.isArray(raw.waypoints) && raw.waypoints.length > 0) {
    const chain = waypointsListToChain(raw.waypoints, defaultRoadWidth, 'wp', 'seg');
    nodes = chain.nodes;
    segments = chain.segments;
  }

  return syncGraphToLegacyWaypoints({
    ...raw,
    id: raw.id || 'untitled_map',
    name: raw.name || 'Untitled Map',
    version: MAP_SCHEMA_VERSION,
    bounds,
    baseHp: typeof raw.baseHp === 'number' ? raw.baseHp : 100,
    startingCash: typeof raw.startingCash === 'number' ? raw.startingCash : 450,
    defaultRoadWidth,
    nodes,
    segments,
    obstacles: Array.isArray(raw.obstacles)
      ? raw.obstacles.map((o) => ({
          ...o,
          position: { ...o.position },
          size: { ...o.size },
        }))
      : [],
    elevatedZones: Array.isArray(raw.elevatedZones)
      ? raw.elevatedZones.map((z) => ({
          ...z,
          position: { ...z.position },
          size: { ...z.size },
        }))
      : [],
    customModels: Array.isArray(raw.customModels)
      ? raw.customModels.map((m) => ({
          ...m,
          position: { ...m.position },
          scale: { ...m.scale },
        }))
      : [],
  });
}

export function getMapGraph(map: MapDefinition): { nodes: RoadNode[]; segments: RoadSegment[] } {
  if (Array.isArray(map.nodes) && Array.isArray(map.segments)) {
    return { nodes: map.nodes, segments: map.segments };
  }
  const migrated = migrateMapDefinition(map);
  return { nodes: migrated.nodes ?? [], segments: migrated.segments ?? [] };
}

/** Legacy v2 helper preserved for compatibility. */
export function getMapPaths(map: MapDefinition) {
  return map.paths ?? [];
}
