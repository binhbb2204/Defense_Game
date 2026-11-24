import type {
  MapJunction,
  MapJunctionOut,
  MapPath,
  PathNode,
  Vec2,
  Vec3,
  WaypointElevationMode,
  WaypointNode,
  WaypointSlopeMode,
} from '../types/protocol';
import { PATH_COLOR_PALETTE } from './mapMigration';
import { RoadPathEvaluator } from './RoadPathEvaluator';
import {
  insertWaypointOnSegment,
  levelHeightRange,
  moveCurveControl,
  moveWaypoint,
  reverseWaypoints,
  setSegmentRoadPart,
  setSegmentSlopeMode,
  setWaypointElevation,
  setWaypointElevationMode,
  smoothSlopeRange,
  stepWaypointElevation,
  straightenRange,
  toggleSegmentMode,
} from './waypointCommands';

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2, 6)}`;
}

function nextUniquePathName(paths: readonly MapPath[]): string {
  const existing = new Set(paths.map((p) => p.name.trim().toLowerCase()));
  let idx = paths.length + 1;
  while (existing.has(`path ${idx}`)) {
    idx += 1;
  }
  return `Path ${idx}`;
}

function nextUniquePathColor(paths: readonly MapPath[]): string {
  const used = new Set(paths.map((p) => p.color.toLowerCase()));
  for (const c of PATH_COLOR_PALETTE) {
    if (!used.has(c.toLowerCase())) return c;
  }
  return PATH_COLOR_PALETTE[paths.length % PATH_COLOR_PALETTE.length]!;
}

/** Creates a new empty Path with a distinct color and name. */
export function createPath(
  paths: readonly MapPath[],
  options: Partial<Pick<MapPath, 'name' | 'color' | 'width' | 'loop'>> = {},
): { paths: MapPath[]; created: MapPath } {
  const created: MapPath = {
    id: makeId('path'),
    name: options.name?.trim() || nextUniquePathName(paths),
    color: options.color || nextUniquePathColor(paths),
    width: options.width && options.width > 0 ? options.width : 5.2,
    loop: Boolean(options.loop),
    visible: true,
    locked: false,
    nodes: [],
  };
  return {
    paths: [...paths, created],
    created,
  };
}

/** Deletes an entire path and prunes dead junction references (< 2 total linked paths). */
export function deletePath(
  paths: readonly MapPath[],
  junctions: readonly MapJunction[],
  pathId: string,
): { paths: MapPath[]; junctions: MapJunction[] } {
  const nextPaths = paths.filter((p) => p.id !== pathId);
  const nextJunctions = junctions
    .map((j) => {
      const inPaths = j.inPaths.filter((id) => id !== pathId);
      const outPaths = j.outPaths.filter((o) => o.pathId !== pathId);
      return {
        ...j,
        inPaths,
        outPaths: normalizeWeights(outPaths),
      };
    })
    .filter((j) => {
      const distinct = new Set([...j.inPaths, ...j.outPaths.map((o) => o.pathId)]);
      return distinct.size >= 2;
    });

  return { paths: nextPaths, junctions: nextJunctions };
}

export function updatePathProps(
  paths: readonly MapPath[],
  pathId: string,
  patch: Partial<Pick<MapPath, 'name' | 'color' | 'width' | 'loop' | 'visible' | 'locked'>>,
): MapPath[] {
  return paths.map((p) => (p.id === pathId ? { ...p, ...patch } : p));
}

function updatePathNodes(
  paths: readonly MapPath[],
  pathId: string,
  updater: (nodes: PathNode[], path: MapPath) => PathNode[],
): MapPath[] {
  return paths.map((p) => {
    if (p.id !== pathId) return p;
    return {
      ...p,
      nodes: updater(p.nodes, p),
    };
  });
}

/**
 * Appends a new node ONLY to `pathId`. Other paths remain completely untouched.
 */
export function appendNodeToPath(
  paths: readonly MapPath[],
  pathId: string,
  node: Omit<PathNode, 'id'> & { id?: string },
  outgoingConfig?: Partial<
    Pick<
      WaypointNode,
      'segmentMode' | 'curveControl' | 'elevationMode' | 'slopeMode' | 'roadPartAsset'
    >
  >,
): { paths: MapPath[]; addedNode: PathNode | null } {
  let addedNode: PathNode | null = null;
  const nextPaths = updatePathNodes(paths, pathId, (nodes, path) => {
    const cloned: PathNode[] = nodes.map((n) => ({
      ...n,
      curveControl: n.curveControl ? { ...n.curveControl } : undefined,
    }));
    if (cloned.length > 0 && outgoingConfig) {
      const lastIdx = cloned.length - 1;
      cloned[lastIdx] = {
        ...cloned[lastIdx]!,
        ...outgoingConfig,
        curveControl: outgoingConfig.curveControl
          ? { ...outgoingConfig.curveControl }
          : undefined,
      };
    }
    const created: PathNode = {
      ...node,
      id: node.id && node.id.trim().length > 0 ? node.id : makeId('wp'),
      roadWidth: node.roadWidth ?? path.width,
      curveControl: node.curveControl ? { ...node.curveControl } : undefined,
    };
    addedNode = created;
    cloned.push(created);
    return cloned;
  });

  return { paths: nextPaths, addedNode };
}

/**
 * Inserts a new node on `pathId` at segment `[segIndex -> segIndex + 1]` (supports loop closing span too).
 * Uses De Casteljau subdivision when `segmentMode === 'curve'`.
 */
export function insertNodeOnPathSegment(
  paths: readonly MapPath[],
  pathId: string,
  segIndex: number,
  t: number,
): { paths: MapPath[]; insertedNodeId: string | null; insertedIndex: number } {
  const path = paths.find((p) => p.id === pathId);
  if (!path || path.nodes.length < 2) {
    return { paths: [...paths], insertedNodeId: null, insertedIndex: -1 };
  }

  const isLoopClosing = path.loop && path.nodes.length >= 3 && segIndex === path.nodes.length - 1;
  const evalInput: WaypointNode[] = isLoopClosing
    ? [...path.nodes, path.nodes[0]!]
    : [...path.nodes];

  const { waypoints: splitWps, insertedIndex } = insertWaypointOnSegment(evalInput, segIndex, t);
  if (insertedIndex < 0) {
    return { paths: [...paths], insertedNodeId: null, insertedIndex: -1 };
  }

  const resultWps = isLoopClosing ? splitWps.slice(0, -1) : splitWps;
  const newNodeId = makeId('wp');
  const nextNodes: PathNode[] = resultWps.map((wp, idx) => ({
    ...wp,
    id: idx === insertedIndex ? newNodeId : (wp.id ?? makeId('wp')),
    roadWidth: wp.roadWidth ?? path.width,
  }));

  const nextPaths = paths.map((p) => (p.id === pathId ? { ...p, nodes: nextNodes } : p));
  return { paths: nextPaths, insertedNodeId: newNodeId, insertedIndex };
}

/**
 * Deletes `nodeId` inside `pathId` with full neighbor reconnection / shortening:
 * - Middle node deleted: neighbors reconnect seamlessly; preceding Bezier handle re-centers.
 * - Start/end node deleted: path shortens cleanly and trailing `curveControl` is cleared.
 * - Last remaining node deleted (length <= 1): removes the whole path and cleans up junctions.
 */
export function deleteNodeFromPath(
  paths: readonly MapPath[],
  junctions: readonly MapJunction[],
  pathId: string,
  nodeId: string,
): { paths: MapPath[]; junctions: MapJunction[]; removedPath: boolean } {
  const path = paths.find((p) => p.id === pathId);
  if (!path) {
    return { paths: [...paths], junctions: [...junctions], removedPath: false };
  }
  const idx = path.nodes.findIndex((n) => n.id === nodeId);
  if (idx < 0) {
    return { paths: [...paths], junctions: [...junctions], removedPath: false };
  }

  if (path.nodes.length <= 1) {
    const deleted = deletePath(paths, junctions, pathId);
    return { ...deleted, removedPath: true };
  }

  const remaining = path.nodes
    .filter((_, i) => i !== idx)
    .map((n) => ({
      ...n,
      curveControl: n.curveControl ? { ...n.curveControl } : undefined,
    }));

  // If a middle node was removed, stitch prev -> after sensibly
  const prevIdx = idx - 1;
  if (idx > 0 && idx < path.nodes.length - 1 && prevIdx >= 0 && prevIdx < remaining.length - 1) {
    const prev = remaining[prevIdx]!;
    const after = remaining[prevIdx + 1]!;
    if (prev.segmentMode === 'curve') {
      remaining[prevIdx] = {
        ...prev,
        curveControl: {
          x: Number(((prev.x + after.x) * 0.5).toFixed(2)),
          z: Number(((prev.z + after.z) * 0.5).toFixed(2)),
        },
      };
    }
  }

  // Clear orphaned outgoing curve data on new tail node (unless path loops)
  if (!path.loop && remaining.length > 0) {
    const tailIdx = remaining.length - 1;
    const tail = remaining[tailIdx]!;
    if (tail.curveControl || tail.segmentMode === 'curve') {
      remaining[tailIdx] = {
        ...tail,
        segmentMode: 'straight',
        curveControl: undefined,
      };
    }
  }

  const nextPaths = paths.map((p) => (p.id === pathId ? { ...p, nodes: remaining } : p));
  return { paths: nextPaths, junctions: [...junctions], removedPath: false };
}

/** Removes the last placed node from `pathId` (or removes path if only 0-1 nodes left). */
export function undoLastNodeOnPath(
  paths: readonly MapPath[],
  junctions: readonly MapJunction[],
  pathId: string,
): { paths: MapPath[]; junctions: MapJunction[]; removedPath: boolean } {
  const path = paths.find((p) => p.id === pathId);
  if (!path) {
    return { paths: [...paths], junctions: [...junctions], removedPath: false };
  }
  if (path.nodes.length <= 1) {
    const deleted = deletePath(paths, junctions, pathId);
    return { ...deleted, removedPath: true };
  }
  const last = path.nodes[path.nodes.length - 1]!;
  return deleteNodeFromPath(paths, junctions, pathId, last.id);
}

function asPathNodes(wps: WaypointNode[]): PathNode[] {
  return wps.map((w) => ({
    ...w,
    id: w.id && w.id.trim().length > 0 ? w.id : makeId('wp'),
  }));
}

export function moveNodeInPath(
  paths: readonly MapPath[],
  pathId: string,
  nodeId: string,
  pos: Vec3,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) => {
    const idx = nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return nodes;
    return asPathNodes(moveWaypoint(nodes, idx, pos));
  });
}

export function updateNodeInPath(
  paths: readonly MapPath[],
  pathId: string,
  nodeId: string,
  patch: Partial<PathNode>,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) =>
    nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
  );
}

export function moveCurveControlInPath(
  paths: readonly MapPath[],
  pathId: string,
  nodeId: string,
  ctrl: Vec2,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) => {
    const idx = nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return nodes;
    return asPathNodes(moveCurveControl(nodes, idx, ctrl));
  });
}

export function togglePathSegmentCurve(
  paths: readonly MapPath[],
  pathId: string,
  segIndex: number,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes, path) => {
    if (path.loop && path.nodes.length >= 3 && segIndex === path.nodes.length - 1) {
      const temp = toggleSegmentMode([...nodes, nodes[0]!], segIndex);
      return asPathNodes(temp.slice(0, -1));
    }
    return asPathNodes(toggleSegmentMode(nodes, segIndex));
  });
}

export function stepNodeElevationInPath(
  paths: readonly MapPath[],
  pathId: string,
  nodeId: string,
  deltaY: number,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) => {
    const idx = nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return nodes;
    return asPathNodes(stepWaypointElevation(nodes, idx, deltaY));
  });
}

export function setNodeElevationInPath(
  paths: readonly MapPath[],
  pathId: string,
  nodeId: string,
  y: number,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) => {
    const idx = nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return nodes;
    return asPathNodes(setWaypointElevation(nodes, idx, y));
  });
}

export function setNodeElevationModeInPath(
  paths: readonly MapPath[],
  pathId: string,
  nodeId: string,
  mode: WaypointElevationMode,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) => {
    const idx = nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return nodes;
    return asPathNodes(setWaypointElevationMode(nodes, idx, mode));
  });
}

export function setSegmentSlopeModeInPath(
  paths: readonly MapPath[],
  pathId: string,
  segIndex: number,
  slopeMode: WaypointSlopeMode,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) =>
    asPathNodes(setSegmentSlopeMode(nodes, segIndex, slopeMode)),
  );
}

export function setSegmentRoadPartInPath(
  paths: readonly MapPath[],
  pathId: string,
  segIndex: number,
  roadPartAsset?: string,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) =>
    asPathNodes(setSegmentRoadPart(nodes, segIndex, roadPartAsset)),
  );
}

export function applyRoadPartToAllSegmentsInPath(
  paths: readonly MapPath[],
  pathId: string,
  roadPartAsset?: string,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes, path) =>
    nodes.map((n, i) =>
      path.loop || i < nodes.length - 1 ? { ...n, roadPartAsset } : n,
    ),
  );
}

export function reversePathNodes(paths: readonly MapPath[], pathId: string): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) => asPathNodes(reverseWaypoints(nodes)));
}

export function smoothPathSlopeRange(
  paths: readonly MapPath[],
  pathId: string,
  startIdx: number,
  endIdx: number,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) =>
    asPathNodes(smoothSlopeRange(nodes, startIdx, endIdx)),
  );
}

export function levelPathHeightRange(
  paths: readonly MapPath[],
  pathId: string,
  startIdx: number,
  endIdx: number,
  targetY: number,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) =>
    asPathNodes(levelHeightRange(nodes, startIdx, endIdx, targetY)),
  );
}

export function straightenPathRange(
  paths: readonly MapPath[],
  pathId: string,
  startIdx: number,
  endIdx: number,
): MapPath[] {
  return updatePathNodes(paths, pathId, (nodes) =>
    asPathNodes(straightenRange(nodes, startIdx, endIdx)),
  );
}

/** Finds closest point on a single path using `RoadPathEvaluator`. */
export function findClosestPointOnPathXZ(
  path: MapPath,
  x: number,
  z: number,
): { segIndex: number; t: number; position: Vec3; distanceXZ: number } | null {
  if (path.nodes.length < 2) return null;
  const ev = new RoadPathEvaluator(path.nodes, {
    defaultRoadWidth: path.width,
    loop: path.loop,
  });
  const hit = ev.findClosestPointXZ(x, z);
  if (!hit) return null;
  return {
    segIndex: hit.segIndex,
    t: hit.t,
    position: hit.sample.position,
    distanceXZ: hit.distanceXZ,
  };
}

function normalizeWeights(outPaths: readonly MapJunctionOut[]): MapJunctionOut[] {
  if (outPaths.length === 0) return [];
  const total = outPaths.reduce((acc, o) => acc + Math.max(0, o.weight), 0);
  if (total <= 0) {
    const even = Math.floor(100 / outPaths.length);
    return outPaths.map((o, i) => ({
      pathId: o.pathId,
      weight: i === 0 ? 100 - even * (outPaths.length - 1) : even,
    }));
  }
  const scaled = outPaths.map((o) => ({
    pathId: o.pathId,
    weight: Math.round((Math.max(0, o.weight) / total) * 100),
  }));
  const diff = 100 - scaled.reduce((acc, o) => acc + o.weight, 0);
  if (scaled.length > 0 && diff !== 0) {
    scaled[0]!.weight = Math.max(0, scaled[0]!.weight + diff);
  }
  return scaled;
}

/**
 * Creates a Junction or merges into a nearby existing Junction within 1.5m XZ+Y.
 */
export function upsertJunction(
  junctions: readonly MapJunction[],
  pos: Vec3,
  inPathId: string,
  outPathId: string,
): { junctions: MapJunction[]; junction: MapJunction } {
  const nearIdx = junctions.findIndex(
    (j) =>
      Math.hypot(j.pos.x - pos.x, j.pos.z - pos.z) <= 1.5 &&
      Math.abs(j.pos.y - pos.y) <= 1.5,
  );

  if (nearIdx >= 0) {
    const existing = junctions[nearIdx]!;
    const inSet = new Set(existing.inPaths);
    inSet.add(inPathId);
    const outList = [...existing.outPaths];
    if (!outList.some((o) => o.pathId === outPathId)) {
      outList.push({ pathId: outPathId, weight: 50 });
    }
    const updated: MapJunction = {
      ...existing,
      inPaths: Array.from(inSet),
      outPaths: normalizeWeights(outList),
    };
    return {
      junctions: junctions.map((j, i) => (i === nearIdx ? updated : j)),
      junction: updated,
    };
  }

  const created: MapJunction = {
    id: makeId('junc'),
    name: `Junction ${junctions.length + 1}`,
    pos: {
      x: Number(pos.x.toFixed(2)),
      y: Number(pos.y.toFixed(2)),
      z: Number(pos.z.toFixed(2)),
    },
    inPaths: [inPathId],
    outPaths: [{ pathId: outPathId, weight: 100 }],
  };

  return {
    junctions: [...junctions, created],
    junction: created,
  };
}

export function updateJunctionOutWeights(
  junctions: readonly MapJunction[],
  junctionId: string,
  outPaths: readonly MapJunctionOut[],
): MapJunction[] {
  return junctions.map((j) =>
    j.id === junctionId
      ? {
          ...j,
          outPaths: outPaths.map((o) => ({
            pathId: o.pathId,
            weight: Math.max(0, Math.min(100, Math.round(o.weight))),
          })),
        }
      : j,
  );
}

export function deleteJunction(
  junctions: readonly MapJunction[],
  junctionId: string,
): MapJunction[] {
  return junctions.filter((j) => j.id !== junctionId);
}
