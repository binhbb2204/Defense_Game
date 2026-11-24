import {
  addNode,
  DEFAULT_FREE_MAX_DEFLECTION_DEG,
  DEFAULT_MIN_SEGMENT_LENGTH,
  evaluateCurveCandidate,
  evaluateFreeCandidate,
  evaluateStraightCandidate,
  getMapGraph,
  resolveNodeContinuationTangent,
  snapCurveControlToTangent,
  splitSegment,
  syncGraphToLegacyWaypoints,
  updateRoadNode,
  type MapDefinition,
  type RoadBuildMode,
  type RoadCandidateEval,
  type RoadJoinStyle,
  type RoadNodeRole,
  type RoadSegmentKind,
  type Vec2,
  type Vec3,
  type WaypointElevationMode,
  type WaypointSlopeMode,
} from '@tactical-td/shared';
import {
  connectAcrossCrossings,
  handleRoadBackspace,
  type SegmentMetaSpec,
} from './roadChainActions';
import {
  buildGhostPreviewGraph,
  findSegmentCrossings,
  resolveRoadCursorSnap,
  type RoadCrossingHit,
  type RoadSnapResult,
  type SnapHitKind,
} from './roadSnapping';
import { checkRoadSegmentPlacement } from './rules/RoadPlacementValidator';

export type { RoadSnapResult, SnapHitKind, RoadCrossingHit };
export {
  buildGhostPreviewGraph,
  checkRoadSegmentPlacement,
  findSegmentCrossings,
  handleRoadBackspace,
  resolveRoadCursorSnap,
};

export interface RoadUndoSnapshot {
  map: MapDefinition;
  prevAnchorId: string | null;
  prevCount: number;
  prevTangent: Vec2 | null;
}

/** Explicit Single-Source-of-Truth Road Tool State Machine (Idle | Drawing). */
export type RoadToolState =
  | { status: 'idle' }
  | {
      status: 'drawing';
      anchorNodeId: string;
      chainNodeCount: number;
      undoSnapshots: RoadUndoSnapshot[];
      curveControl: Vec3 | null;
      prevTangent: Vec2 | null;
    };

export interface RoadPlacementConfig {
  roadWidth: number;
  buildMode: RoadBuildMode;
  newNodeRole: RoadNodeRole;
  elevationMode: WaypointElevationMode;
  slopeMode: WaypointSlopeMode;
  drawElevation: number;
  angleSnap: boolean;
  altHeld: boolean;
  shiftHeld: boolean;
  roadPartAsset?: string;
  anarchyEnabled: boolean;
  minLength?: number;
  maxDeflectionDeg?: number;
  minAngleDeg?: number;
  autoIntersect?: boolean;
  joinStyle?: RoadJoinStyle;
}

export interface RoadClickOutcome {
  nextMap: MapDefinition;
  nextState: RoadToolState;
  committed: boolean;
  blockedReason?: string;
  warning?: string | null;
  selectedNodeId?: string;
  message: string;
}

/** Pure Road Tool state machine transition across Straight, Curve (3-click), and Free modes. */
export function handleRoadClick(
  map: MapDefinition,
  state: RoadToolState,
  snap: RoadSnapResult,
  config: RoadPlacementConfig,
): RoadClickOutcome {
  const { nodes, segments } = getMapGraph(map);

  if (state.status === 'idle') {
    if (snap.kind === 'node' && snap.nodeId) {
      const existing = nodes.find((n) => n.id === snap.nodeId);
      const prevTangent = existing ? resolveNodeContinuationTangent(existing, nodes, segments) : null;
      return {
        nextMap: map,
        nextState: {
          status: 'drawing',
          anchorNodeId: snap.nodeId,
          chainNodeCount: 1,
          undoSnapshots: [],
          curveControl: null,
          prevTangent,
        },
        committed: false,
        selectedNodeId: snap.nodeId,
        message: 'Started chain from existing node (Esc / Right-click to finish).',
      };
    }

    if (snap.kind === 'segment' && snap.segmentId) {
      const splitRes = splitSegment(nodes, segments, snap.segmentId, snap.pos, { role: 'normal' });
      if (!splitRes.insertedNode) {
        return { nextMap: map, nextState: state, committed: false, message: 'Failed to split segment.' };
      }
      const prevTangent = resolveNodeContinuationTangent(
        splitRes.insertedNode,
        splitRes.nodes,
        splitRes.segments,
      );
      const nextMap = syncGraphToLegacyWaypoints({
        ...map,
        nodes: splitRes.nodes,
        segments: splitRes.segments,
      });
      return {
        nextMap,
        nextState: {
          status: 'drawing',
          anchorNodeId: splitRes.insertedNode.id,
          chainNodeCount: 1,
          undoSnapshots: [{ map: structuredClone(map), prevAnchorId: null, prevCount: 0, prevTangent: null }],
          curveControl: null,
          prevTangent,
        },
        committed: true,
        selectedNodeId: splitRes.insertedNode.id,
        message: 'Split road segment and started junction chain.',
      };
    }

    const added = addNode(nodes, snap.pos, { role: config.newNodeRole });
    const nextMap = syncGraphToLegacyWaypoints({ ...map, nodes: added.nodes, segments });
    return {
      nextMap,
      nextState: {
        status: 'drawing',
        anchorNodeId: added.node.id,
        chainNodeCount: 1,
        undoSnapshots: [{ map: structuredClone(map), prevAnchorId: null, prevCount: 0, prevTangent: null }],
        curveControl: null,
        prevTangent: null,
      },
      committed: true,
      selectedNodeId: added.node.id,
      message: 'Start node placed — click next point to extend chain.',
    };
  }

  const anchorNode = nodes.find((n) => n.id === state.anchorNodeId);
  if (!anchorNode) {
    return {
      nextMap: map,
      nextState: { status: 'idle' },
      committed: false,
      message: 'Anchor node missing; reset Road tool to Idle.',
    };
  }

  // Curve Mode Click 2: pick control handle
  if (config.buildMode === 'curve' && !state.curveControl) {
    const snappedCtrl = snapCurveControlToTangent(anchorNode, snap.pos, state.prevTangent, {
      altHeld: config.altHeld,
      angleSnap: config.angleSnap,
    });
    if (Math.hypot(snappedCtrl.pos.x - anchorNode.x, snappedCtrl.pos.z - anchorNode.z) < 1.0) {
      return {
        nextMap: map,
        nextState: state,
        committed: false,
        blockedReason: 'Control point too close to start node',
        message: 'Control point too close to start node.',
      };
    }
    return {
      nextMap: map,
      nextState: { ...state, curveControl: snappedCtrl.pos },
      committed: false,
      message: snappedCtrl.snappedToTangent
        ? 'Control snapped to tangent — click end point.'
        : 'Control point placed — click end point.',
    };
  }

  let candidate: RoadCandidateEval;
  let effectiveSnap = snap;
  if (config.buildMode === 'curve' && state.curveControl) {
    candidate = evaluateCurveCandidate(anchorNode, state.curveControl, snap.pos, config.roadWidth, state.prevTangent);
  } else if (config.buildMode === 'free') {
    candidate = evaluateFreeCandidate(
      anchorNode,
      snap.pos,
      nodes,
      segments,
      config.roadWidth,
      state.prevTangent,
      { shiftHeld: config.shiftHeld, maxDeflectionDeg: config.maxDeflectionDeg ?? DEFAULT_FREE_MAX_DEFLECTION_DEG },
    );
  } else {
    const allowAngleSnap = snap.kind !== 'node' && snap.kind !== 'segment';
    candidate = evaluateStraightCandidate(anchorNode, snap.pos, state.prevTangent, {
      angleSnap: config.angleSnap,
      altHeld: config.altHeld,
      allowAngleSnap,
    });
    if (candidate.usedAngleSnap) {
      effectiveSnap = { ...snap, kind: 'free', pos: candidate.endPos };
    }
  }

  const check = checkRoadSegmentPlacement(
    nodes,
    segments,
    map.obstacles,
    anchorNode,
    effectiveSnap,
    candidate.control,
    config.roadWidth,
    config.anarchyEnabled,
    {
      minLength: config.minLength ?? DEFAULT_MIN_SEGMENT_LENGTH,
      minAngleDeg: config.minAngleDeg ?? 25,
      autoIntersect: config.autoIntersect ?? true,
      radiusOverride: config.buildMode === 'free' ? candidate.minRadius : undefined,
    },
  );

  if (!check.allowed) {
    return {
      nextMap: map,
      nextState: state,
      committed: false,
      blockedReason: check.reason ?? 'Blocked by placement constraints',
      message: check.reason ?? 'Blocked placement.',
    };
  }

  const workingNodes = candidate.cornerFallback
    ? updateRoadNode(nodes, anchorNode.id, { corner: true })
    : nodes;

  const segMeta: SegmentMetaSpec = {
    width: config.roadWidth,
    kind: candidate.kind as RoadSegmentKind,
    control: candidate.control ?? undefined,
    elevationMode: config.elevationMode,
    slopeMode: config.slopeMode,
    isTunnel: config.elevationMode === 'tunnel' ? true : undefined,
    isOverpass:
      config.elevationMode === 'bridge' ||
      config.elevationMode === 'elevated' ||
      effectiveSnap.pos.y > 0.6 ||
      anchorNode.y > 0.6
        ? true
        : undefined,
    roadPartAsset: config.roadPartAsset || undefined,
  };

  const makeNextState = (nextAnchorId: string): RoadToolState => ({
    status: 'drawing',
    anchorNodeId: nextAnchorId,
    chainNodeCount: state.chainNodeCount + 1,
    undoSnapshots: [
      ...state.undoSnapshots,
      {
        map: structuredClone(map),
        prevAnchorId: anchorNode.id,
        prevCount: state.chainNodeCount,
        prevTangent: state.prevTangent,
      },
    ],
    curveControl: null,
    prevTangent: candidate.nextTangent,
  });

  if (effectiveSnap.kind === 'node' && effectiveSnap.nodeId) {
    const out = connectAcrossCrossings(
      map,
      workingNodes,
      segments,
      anchorNode,
      effectiveSnap,
      candidate.control,
      segMeta,
      config,
      effectiveSnap.nodeId,
      makeNextState(effectiveSnap.nodeId),
      'Connected to node (chain continues).',
    );
    return { ...out, warning: candidate.cornerHint ?? check.warning ?? null };
  }

  if (effectiveSnap.kind === 'segment' && effectiveSnap.segmentId) {
    const splitRes = splitSegment(workingNodes, segments, effectiveSnap.segmentId, effectiveSnap.pos, { role: 'normal' });
    if (!splitRes.insertedNode) {
      return { nextMap: map, nextState: state, committed: false, message: 'Failed to snap to segment.' };
    }
    const out = connectAcrossCrossings(
      map,
      splitRes.nodes,
      splitRes.segments,
      anchorNode,
      effectiveSnap,
      candidate.control,
      segMeta,
      config,
      splitRes.insertedNode.id,
      makeNextState(splitRes.insertedNode.id),
      'Split road & connected junction (chain continues).',
    );
    return { ...out, warning: candidate.cornerHint ?? check.warning ?? null };
  }

  const nodeRes = addNode(workingNodes, effectiveSnap.pos, { role: config.newNodeRole });
  const out = connectAcrossCrossings(
    map,
    nodeRes.nodes,
    segments,
    anchorNode,
    effectiveSnap,
    candidate.control,
    segMeta,
    config,
    nodeRes.node.id,
    makeNextState(nodeRes.node.id),
    `Added node (${state.chainNodeCount + 1} in chain).`,
  );
  return { ...out, warning: candidate.cornerHint ?? check.warning ?? null };
}
