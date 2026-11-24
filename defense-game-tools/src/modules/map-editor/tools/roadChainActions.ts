import {
  addSegment,
  splitSegment,
  syncGraphToLegacyWaypoints,
  type MapDefinition,
  type RoadNode,
  type RoadSegment,
  type RoadSegmentKind,
  type Vec2,
  type Vec3,
  type WaypointElevationMode,
  type WaypointSlopeMode,
} from '@tactical-td/shared';
import { findSegmentCrossings, type RoadSnapResult } from './roadSnapping';
import type {
  RoadClickOutcome,
  RoadPlacementConfig,
  RoadToolState,
} from './roadToolStateMachine';

export interface SegmentMetaSpec {
  width: number;
  kind: RoadSegmentKind;
  control: RoadSegment['control'];
  elevationMode: WaypointElevationMode;
  slopeMode: WaypointSlopeMode;
  isTunnel?: boolean;
  isOverpass?: boolean;
  roadPartAsset?: string;
}

/** Splits intersecting road segments along an anchor -> snap path when Auto-Intersect is active. */
export function connectAcrossCrossings(
  map: MapDefinition,
  inNodes: RoadNode[],
  inSegments: RoadSegment[],
  anchorNode: RoadNode,
  snap: RoadSnapResult,
  curveControl: Vec3 | null,
  segMeta: SegmentMetaSpec,
  config: RoadPlacementConfig,
  targetNodeId: string,
  endState: RoadToolState,
  endMessage: string,
): RoadClickOutcome {
  let curNodes = inNodes;
  let curSegs = inSegments;
  const crossHits =
    config.autoIntersect ?? true
      ? findSegmentCrossings(curNodes, curSegs, anchorNode, snap, curveControl)
      : [];

  let prevId = anchorNode.id;
  let addedCrossings = 0;

  for (const hit of crossHits) {
    if (!curSegs.some((s) => s.id === hit.segmentId)) continue;
    const splitRes = splitSegment(curNodes, curSegs, hit.segmentId, hit.point, { role: 'normal' });
    if (!splitRes.insertedNode) continue;
    curNodes = splitRes.nodes;
    curSegs = splitRes.segments;
    const segRes = addSegment(curNodes, curSegs, prevId, splitRes.insertedNode.id, {
      ...segMeta,
      kind: 'straight',
      control: undefined,
    });
    curSegs = segRes.segments;
    prevId = splitRes.insertedNode.id;
    addedCrossings += 1;
  }

  const finalSegRes = addSegment(curNodes, curSegs, prevId, targetNodeId, {
    ...segMeta,
    kind: addedCrossings > 0 ? 'straight' : segMeta.kind,
    control: addedCrossings > 0 ? undefined : segMeta.control,
  });
  const nextMap = syncGraphToLegacyWaypoints({
    ...map,
    nodes: curNodes,
    segments: finalSegRes.segments,
  });
  return {
    nextMap,
    nextState: endState,
    committed: true,
    selectedNodeId: targetNodeId,
    message:
      addedCrossings > 0
        ? `${endMessage} (${addedCrossings} intersection${addedCrossings > 1 ? 's' : ''} auto-split)`
        : endMessage,
  };
}

/** Removes the last placed step in the active Drawing chain (Control -> Start -> Previous segment/node). */
export function handleRoadBackspace(
  map: MapDefinition,
  state: RoadToolState,
): { nextMap: MapDefinition; nextState: RoadToolState; reverted: boolean; message: string } {
  if (state.status !== 'drawing') {
    return { nextMap: map, nextState: state, reverted: false, message: '' };
  }
  if (state.curveControl) {
    return {
      nextMap: map,
      nextState: { ...state, curveControl: null },
      reverted: true,
      message: 'Stepped back to start node (cleared control point).',
    };
  }
  const snap = state.undoSnapshots[state.undoSnapshots.length - 1];
  if (!snap) {
    return {
      nextMap: map,
      nextState: { status: 'idle' },
      reverted: false,
      message: 'Ended drawing chain.',
    };
  }
  const remaining = state.undoSnapshots.slice(0, -1);
  if (!snap.prevAnchorId) {
    return {
      nextMap: snap.map,
      nextState: { status: 'idle' },
      reverted: true,
      message: 'Undid initial node (chain ended).',
    };
  }
  return {
    nextMap: snap.map,
    nextState: {
      status: 'drawing',
      anchorNodeId: snap.prevAnchorId,
      chainNodeCount: snap.prevCount,
      undoSnapshots: remaining,
      curveControl: null,
      prevTangent: snap.prevTangent,
    },
    reverted: true,
    message: 'Removed last placed node/segment.',
  };
}

export type RoadBackspaceSnapshotTangent = Vec2 | null;
