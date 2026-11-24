import type { RoadNode, RoadNodeRole, RoadSegment, Vec3 } from '../../types/protocol';
import {
  clampVal,
  closestParamOnSegmentXZ,
  evaluateRoadSegmentAt,
  lerp3,
  makeGraphId,
  round2,
} from './segmentCurve';

/** Creates a new RoadNode and returns the updated immutable node array + node. */
export function addNode(
  nodes: readonly RoadNode[],
  pos: Vec3,
  options: { id?: string; role?: RoadNodeRole; label?: string } = {},
): { nodes: RoadNode[]; node: RoadNode } {
  const node: RoadNode = {
    id: options.id?.trim() || makeGraphId('n'),
    x: round2(pos.x),
    y: Math.max(0, round2(pos.y)),
    z: round2(pos.z),
    role: options.role ?? 'normal',
    label: options.label,
  };
  return {
    nodes: [...nodes, node],
    node,
  };
}

/**
 * Adds a RoadSegment between `aId` and `bId`.
 * Rejects self-loops, missing node IDs, and duplicate edges between the same endpoints.
 */
export function addSegment(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  aId: string,
  bId: string,
  options: Partial<Omit<RoadSegment, 'id' | 'a' | 'b'>> & { id?: string } = {},
): { segments: RoadSegment[]; segment: RoadSegment | null } {
  if (aId === bId) return { segments: [...segments], segment: null };
  const hasA = nodes.some((n) => n.id === aId);
  const hasB = nodes.some((n) => n.id === bId);
  if (!hasA || !hasB) return { segments: [...segments], segment: null };

  const duplicate = segments.some(
    (s) => (s.a === aId && s.b === bId) || (s.a === bId && s.b === aId),
  );
  if (duplicate) return { segments: [...segments], segment: null };

  const kind = options.kind ?? (options.control ? 'curve' : 'straight');
  const segment: RoadSegment = {
    id: options.id?.trim() || makeGraphId('seg'),
    a: aId,
    b: bId,
    width: options.width && options.width > 0 ? options.width : 5.2,
    kind,
    control: kind === 'curve' && options.control ? { ...options.control } : undefined,
    tension: kind === 'curve' && !options.control ? (options.tension ?? 0.5) : options.tension,
    oneWay: options.oneWay,
    weight: options.weight,
    elevationMode: options.elevationMode,
    slopeMode: options.slopeMode,
    isTunnel: options.isTunnel,
    isOverpass: options.isOverpass,
    roadPartAsset: options.roadPartAsset,
  };

  return {
    segments: [...segments, segment],
    segment,
  };
}

/**
 * Inserts a new RoadNode inside `segmentId` and splits the segment in two.
 * Uses exact De Casteljau subdivision for curved segments so geometry stays seamless.
 */
export function splitSegment(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  segmentId: string,
  posOrT: number | Vec3,
  options: { role?: RoadNodeRole; label?: string } = {},
): {
  nodes: RoadNode[];
  segments: RoadSegment[];
  insertedNode: RoadNode | null;
  leftSegment: RoadSegment | null;
  rightSegment: RoadSegment | null;
} {
  const seg = segments.find((s) => s.id === segmentId);
  if (!seg) {
    return {
      nodes: [...nodes],
      segments: [...segments],
      insertedNode: null,
      leftSegment: null,
      rightSegment: null,
    };
  }
  const nodeA = nodes.find((n) => n.id === seg.a);
  const nodeB = nodes.find((n) => n.id === seg.b);
  if (!nodeA || !nodeB) {
    return {
      nodes: [...nodes],
      segments: [...segments],
      insertedNode: null,
      leftSegment: null,
      rightSegment: null,
    };
  }

  const rawT =
    typeof posOrT === 'number'
      ? posOrT
      : closestParamOnSegmentXZ(nodeA, nodeB, seg, posOrT.x, posOrT.z, nodes, segments).t;
  const u = clampVal(rawT, 0.05, 0.95);

  let midPos: Vec3;
  let leftControl: Vec3 | undefined;
  let rightControl: Vec3 | undefined;

  if (seg.kind === 'curve' && seg.control) {
    leftControl = lerp3(nodeA, seg.control, u);
    rightControl = lerp3(seg.control, nodeB, u);
    midPos = lerp3(leftControl, rightControl, u);
  } else if (seg.kind === 'curve') {
    midPos = evaluateRoadSegmentAt(nodeA, nodeB, seg, u, nodes, segments).position;
  } else {
    midPos = lerp3(nodeA, nodeB, u);
  }

  const added = addNode(nodes, midPos, {
    role: options.role ?? 'normal',
    label: options.label,
  });

  const leftSeg: RoadSegment = {
    id: makeGraphId('seg'),
    a: seg.a,
    b: added.node.id,
    width: seg.width,
    kind: seg.kind,
    control: leftControl,
    tension: seg.kind === 'curve' && !leftControl ? (seg.tension ?? 0.5) : undefined,
    oneWay: seg.oneWay,
    weight: seg.weight,
    elevationMode: seg.elevationMode,
    slopeMode: seg.slopeMode,
    isTunnel: seg.isTunnel,
    isOverpass: seg.isOverpass,
    roadPartAsset: seg.roadPartAsset,
  };

  const rightSeg: RoadSegment = {
    id: makeGraphId('seg'),
    a: added.node.id,
    b: seg.b,
    width: seg.width,
    kind: seg.kind,
    control: rightControl,
    tension: seg.kind === 'curve' && !rightControl ? (seg.tension ?? 0.5) : undefined,
    oneWay: seg.oneWay,
    weight: seg.weight,
    elevationMode: seg.elevationMode,
    slopeMode: seg.slopeMode,
    isTunnel: seg.isTunnel,
    isOverpass: seg.isOverpass,
    roadPartAsset: seg.roadPartAsset,
  };

  const nextSegments = segments.flatMap((s) =>
    s.id === seg.id ? [leftSeg, rightSeg] : [s],
  );

  return {
    nodes: added.nodes,
    segments: nextSegments,
    insertedNode: added.node,
    leftSegment: leftSeg,
    rightSegment: rightSeg,
  };
}

/**
 * Deletes `nodeId` and all incident segments.
 * If `nodeId` had exactly 2 incident segments connecting distinct neighbors,
 * cleanly reconnects those two neighbors with a new stitched segment.
 */
export function deleteNode(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  nodeId: string,
): {
  nodes: RoadNode[];
  segments: RoadSegment[];
  reconnectedSegment: RoadSegment | null;
} {
  if (!nodes.some((n) => n.id === nodeId)) {
    return { nodes: [...nodes], segments: [...segments], reconnectedSegment: null };
  }

  const incident = segments.filter((s) => s.a === nodeId || s.b === nodeId);
  const remainingNodes = nodes.filter((n) => n.id !== nodeId);
  let remainingSegments = segments.filter((s) => s.a !== nodeId && s.b !== nodeId);
  let reconnectedSegment: RoadSegment | null = null;

  if (incident.length === 2) {
    const s1 = incident[0]!;
    const s2 = incident[1]!;

    let aId: string;
    let bId: string;
    if (s1.b === nodeId && s2.a === nodeId) {
      aId = s1.a;
      bId = s2.b;
    } else if (s2.b === nodeId && s1.a === nodeId) {
      aId = s2.a;
      bId = s1.b;
    } else {
      aId = s1.a === nodeId ? s1.b : s1.a;
      bId = s2.a === nodeId ? s2.b : s2.a;
    }

    if (aId !== bId) {
      const nodeA = remainingNodes.find((n) => n.id === aId);
      const nodeB = remainingNodes.find((n) => n.id === bId);
      const bothCurved = s1.kind === 'curve' && s2.kind === 'curve' && nodeA && nodeB;
      const hasExplicitCtrl = Boolean(s1.control || s2.control);
      const midCtrl =
        bothCurved && hasExplicitCtrl
          ? {
              x: round2((nodeA.x + nodeB.x) * 0.5),
              y: round2((nodeA.y + nodeB.y) * 0.5),
              z: round2((nodeA.z + nodeB.z) * 0.5),
            }
          : undefined;

      const added = addSegment(remainingNodes, remainingSegments, aId, bId, {
        width: Number(((s1.width + s2.width) * 0.5).toFixed(2)),
        kind: bothCurved ? 'curve' : 'straight',
        control: midCtrl,
        tension: bothCurved && !hasExplicitCtrl ? (s1.tension ?? s2.tension ?? 0.5) : undefined,
        oneWay: Boolean(s1.oneWay && s2.oneWay) ? true : undefined,
        weight: s1.weight ?? s2.weight,
        elevationMode: s1.elevationMode ?? s2.elevationMode,
        slopeMode: s1.slopeMode ?? s2.slopeMode,
        isTunnel: Boolean(s1.isTunnel && s2.isTunnel),
        isOverpass: Boolean(s1.isOverpass && s2.isOverpass),
        roadPartAsset: s1.roadPartAsset ?? s2.roadPartAsset,
      });
      remainingSegments = added.segments;
      reconnectedSegment = added.segment;
    }
  }

  return {
    nodes: remainingNodes,
    segments: remainingSegments,
    reconnectedSegment,
  };
}

export function deleteSegment(
  segments: readonly RoadSegment[],
  segmentId: string,
): RoadSegment[] {
  return segments.filter((s) => s.id !== segmentId);
}

export function moveRoadNode(
  nodes: readonly RoadNode[],
  nodeId: string,
  pos: Vec3,
): RoadNode[] {
  return nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          x: round2(pos.x),
          y: Math.max(0, round2(pos.y)),
          z: round2(pos.z),
        }
      : n,
  );
}

export function updateRoadNode(
  nodes: readonly RoadNode[],
  nodeId: string,
  patch: Partial<Pick<RoadNode, 'x' | 'y' | 'z' | 'role' | 'label' | 'corner'>>,
): RoadNode[] {
  return nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          ...patch,
          x: patch.x !== undefined ? round2(patch.x) : n.x,
          y: patch.y !== undefined ? Math.max(0, round2(patch.y)) : n.y,
          z: patch.z !== undefined ? round2(patch.z) : n.z,
        }
      : n,
  );
}

export function updateRoadSegment(
  segments: readonly RoadSegment[],
  segmentId: string,
  patch: Partial<Omit<RoadSegment, 'id' | 'a' | 'b'>>,
): RoadSegment[] {
  return segments.map((s) => (s.id === segmentId ? { ...s, ...patch } : s));
}

export function toggleRoadSegmentKind(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  segmentId: string,
): RoadSegment[] {
  const seg = segments.find((s) => s.id === segmentId);
  if (!seg) return [...segments];
  const nodeA = nodes.find((n) => n.id === seg.a);
  const nodeB = nodes.find((n) => n.id === seg.b);
  if (!nodeA || !nodeB) return [...segments];

  const toCurve = seg.kind !== 'curve';
  if (!toCurve) {
    return updateRoadSegment(segments, segmentId, { kind: 'straight', control: undefined });
  }

  const dx = nodeB.x - nodeA.x;
  const dz = nodeB.z - nodeA.z;
  const len = Math.max(1, Math.hypot(dx, dz));
  const nx = -dz / len;
  const nz = dx / len;
  const bulge = Math.min(8, len * 0.25);

  return updateRoadSegment(segments, segmentId, {
    kind: 'curve',
    control: {
      x: round2((nodeA.x + nodeB.x) * 0.5 + nx * bulge),
      y: round2((nodeA.y + nodeB.y) * 0.5),
      z: round2((nodeA.z + nodeB.z) * 0.5 + nz * bulge),
    },
  });
}
