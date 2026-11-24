import type {
  Vec2,
  Vec3,
  WaypointElevationMode,
  WaypointNode,
  WaypointSlopeMode,
} from '../types/protocol';
import {
  QuadraticBezierHorizontalSegment,
  createHorizontalSegment,
} from './horizontalSegments';
import { RoadPathEvaluator } from './RoadPathEvaluator';

function makeWpId(): string {
  return `wp_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2, 5)}`;
}

/** Appends a new waypoint to the end (moving Base endpoint forward). */
export function appendWaypoint(
  waypoints: readonly WaypointNode[],
  node: WaypointNode,
  outgoingConfig?: Partial<Pick<WaypointNode, 'segmentMode' | 'curveControl' | 'elevationMode' | 'slopeMode' | 'roadPartAsset'>>,
): WaypointNode[] {
  const next = waypoints.map((w) => ({ ...w }));
  if (next.length > 0 && outgoingConfig) {
    const lastIdx = next.length - 1;
    next[lastIdx] = {
      ...next[lastIdx]!,
      ...outgoingConfig,
    };
  }
  next.push({ id: makeWpId(), ...node });
  return next;
}

/**
 * Inserts a new waypoint at exact curve parameter `t` inside segment `[segIndex -> segIndex + 1]`.
 * Uses De Casteljau subdivision when `segmentMode === 'curve'` so overall shape stays 100% intact.
 */
export function insertWaypointOnSegment(
  waypoints: readonly WaypointNode[],
  segIndex: number,
  t: number,
): { waypoints: WaypointNode[]; insertedIndex: number } {
  if (segIndex < 0 || segIndex >= waypoints.length - 1) {
    return { waypoints: [...waypoints], insertedIndex: -1 };
  }

  const evaluator = new RoadPathEvaluator(waypoints);
  const clampedT = Math.max(0.05, Math.min(0.95, t));
  const sample = evaluator.sampleAtSegmentParameter(segIndex, clampedT);

  const wpA = waypoints[segIndex]!;
  const wpB = waypoints[segIndex + 1]!;
  const next = waypoints.map((w) => ({ ...w }));

  const inserted: WaypointNode = {
    id: makeWpId(),
    x: Number(sample.position.x.toFixed(2)),
    y: Number(sample.position.y.toFixed(2)),
    z: Number(sample.position.z.toFixed(2)),
    roadWidth: Number(sample.roadWidth.toFixed(2)),
    isTunnel: sample.isTunnel,
    isOverpass: sample.isOverpass,
    elevationMode: wpA.elevationMode,
    slopeMode: wpA.slopeMode,
    roadPartAsset: wpA.roadPartAsset,
    segmentMode: wpA.segmentMode ?? 'straight',
  };

  const horiz = createHorizontalSegment(waypoints, segIndex);
  if (horiz instanceof QuadraticBezierHorizontalSegment) {
    const split = horiz.splitAt(clampedT);
    next[segIndex] = {
      ...wpA,
      segmentMode: 'curve',
      curveControl: {
        x: Number(split.leftControl.x.toFixed(2)),
        z: Number(split.leftControl.z.toFixed(2)),
      },
    };
    inserted.x = Number(split.midPoint.x.toFixed(2));
    inserted.z = Number(split.midPoint.z.toFixed(2));
    inserted.segmentMode = 'curve';
    inserted.curveControl = {
      x: Number(split.rightControl.x.toFixed(2)),
      z: Number(split.rightControl.z.toFixed(2)),
    };
  } else if (wpA.segmentMode === undefined) {
    // Keep legacy smoothness or default straight cleanly
    inserted.segmentMode = wpB.segmentMode;
  }

  next.splice(segIndex + 1, 0, inserted);
  return { waypoints: next, insertedIndex: segIndex + 1 };
}

/** Deletes waypoint `index` and cleanly stitches neighbors (preserving minimum 2 endpoints). */
export function deleteWaypointAndStitch(
  waypoints: readonly WaypointNode[],
  index: number,
): WaypointNode[] {
  if (waypoints.length <= 2 || index < 0 || index >= waypoints.length) {
    return [...waypoints];
  }
  const next = waypoints.filter((_, i) => i !== index).map((w) => ({ ...w }));
  // Re-center curveControl on preceding curved segment so stitched curve stays sensible
  const prevIdx = index - 1;
  if (prevIdx >= 0 && prevIdx < next.length - 1) {
    const prev = next[prevIdx]!;
    const after = next[prevIdx + 1]!;
    if (prev.segmentMode === 'curve') {
      next[prevIdx] = {
        ...prev,
        curveControl: {
          x: Number(((prev.x + after.x) * 0.5).toFixed(2)),
          z: Number(((prev.z + after.z) * 0.5).toFixed(2)),
        },
      };
    }
  }
  return next;
}

export function moveWaypoint(
  waypoints: readonly WaypointNode[],
  index: number,
  pos: Vec3,
): WaypointNode[] {
  return waypoints.map((w, i) =>
    i === index
      ? {
          ...w,
          x: Number(pos.x.toFixed(2)),
          y: Math.max(0, Number(pos.y.toFixed(2))),
          z: Number(pos.z.toFixed(2)),
        }
      : w,
  );
}

export function moveCurveControl(
  waypoints: readonly WaypointNode[],
  segIndex: number,
  ctrl: Vec2,
): WaypointNode[] {
  return waypoints.map((w, i) =>
    i === segIndex
      ? {
          ...w,
          segmentMode: 'curve',
          curveControl: { x: Number(ctrl.x.toFixed(2)), z: Number(ctrl.z.toFixed(2)) },
        }
      : w,
  );
}

/** Converts segment `segIndex` between `straight` and `curve` (with slight outward offset handle). */
export function toggleSegmentMode(
  waypoints: readonly WaypointNode[],
  segIndex: number,
): WaypointNode[] {
  if (segIndex < 0 || segIndex >= waypoints.length - 1) return [...waypoints];
  const a = waypoints[segIndex]!;
  const b = waypoints[segIndex + 1]!;
  const toCurve = a.segmentMode !== 'curve';

  return waypoints.map((w, i) => {
    if (i !== segIndex) return w;
    if (!toCurve) {
      return { ...w, segmentMode: 'straight', curveControl: undefined };
    }
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.max(1, Math.hypot(dx, dz));
    const nx = -dz / len;
    const nz = dx / len;
    const bulge = Math.min(8, len * 0.25);
    return {
      ...w,
      segmentMode: 'curve',
      curveControl: {
        x: Number(((a.x + b.x) * 0.5 + nx * bulge).toFixed(2)),
        z: Number(((a.z + b.z) * 0.5 + nz * bulge).toFixed(2)),
      },
    };
  });
}

export function setWaypointElevation(
  waypoints: readonly WaypointNode[],
  index: number,
  y: number,
): WaypointNode[] {
  const safeY = Math.max(0, Number(y.toFixed(2)));
  return waypoints.map((w, i) => {
    if (i !== index) return w;
    const autoOverpass = safeY > 0.6 ? true : w.elevationMode === 'bridge' || w.elevationMode === 'elevated';
    return {
      ...w,
      y: safeY,
      isOverpass: w.elevationMode === 'ground' ? false : autoOverpass,
    };
  });
}

export function stepWaypointElevation(
  waypoints: readonly WaypointNode[],
  index: number,
  deltaY: number,
): WaypointNode[] {
  const cur = waypoints[index];
  if (!cur) return [...waypoints];
  return setWaypointElevation(waypoints, index, cur.y + deltaY);
}

export function setWaypointElevationMode(
  waypoints: readonly WaypointNode[],
  index: number,
  mode: WaypointElevationMode,
): WaypointNode[] {
  return waypoints.map((w, i) => {
    if (i !== index) return w;
    if (mode === 'ground') {
      return { ...w, elevationMode: mode, y: 0, isOverpass: false, isTunnel: false };
    }
    if (mode === 'tunnel') {
      return { ...w, elevationMode: mode, isTunnel: true, isOverpass: false };
    }
    return {
      ...w,
      elevationMode: mode,
      isOverpass: true,
      isTunnel: false,
      y: w.y < 1 ? 4.5 : w.y,
    };
  });
}

export function setSegmentSlopeMode(
  waypoints: readonly WaypointNode[],
  segIndex: number,
  slopeMode: WaypointSlopeMode,
): WaypointNode[] {
  return waypoints.map((w, i) => (i === segIndex ? { ...w, slopeMode } : w));
}

export function setSegmentRoadPart(
  waypoints: readonly WaypointNode[],
  segIndex: number,
  roadPartAsset?: string,
): WaypointNode[] {
  return waypoints.map((w, i) => (i === segIndex ? { ...w, roadPartAsset } : w));
}

/**
 * Network Multitool `Slope Nodes`: sets every intermediate node Y cleanly proportional to arc length
 * so multi-segment highway ramps become dead smooth from `startIdx` to `endIdx`.
 */
export function smoothSlopeRange(
  waypoints: readonly WaypointNode[],
  startIdx: number,
  endIdx: number,
): WaypointNode[] {
  const sIdx = Math.max(0, Math.min(startIdx, endIdx));
  const eIdx = Math.min(waypoints.length - 1, Math.max(startIdx, endIdx));
  if (eIdx - sIdx < 2) return [...waypoints];

  const evalPath = new RoadPathEvaluator(waypoints);
  const startS = evalPath.stations[sIdx]!;
  const endS = evalPath.stations[eIdx]!;
  const spanS = endS - startS;
  if (spanS < 1e-4) return [...waypoints];

  const yStart = waypoints[sIdx]!.y;
  const yEnd = waypoints[eIdx]!.y;

  return waypoints.map((w, i) => {
    if (i <= sIdx || i >= eIdx) {
      if (i >= sIdx && i < eIdx) return { ...w, slopeMode: 'straight_slope' };
      return w;
    }
    const alpha = (evalPath.stations[i]! - startS) / spanS;
    const nextY = Number((yStart + (yEnd - yStart) * alpha).toFixed(2));
    return {
      ...w,
      y: nextY,
      slopeMode: 'straight_slope',
      isOverpass: nextY > 0.6,
    };
  });
}

/** Flattens height `Y` across `[startIdx..endIdx]` to build perfectly level bridge decks. */
export function levelHeightRange(
  waypoints: readonly WaypointNode[],
  startIdx: number,
  endIdx: number,
  targetY: number,
): WaypointNode[] {
  const sIdx = Math.max(0, Math.min(startIdx, endIdx));
  const eIdx = Math.min(waypoints.length - 1, Math.max(startIdx, endIdx));
  const safeY = Math.max(0, Number(targetY.toFixed(2)));
  return waypoints.map((w, i) =>
    i >= sIdx && i <= eIdx
      ? { ...w, y: safeY, slopeMode: 'straight_slope', isOverpass: safeY > 0.6 }
      : w,
  );
}

/** Network Multitool `Arrange at Line`: aligns `[startIdx..endIdx]` along a straight XZ line. */
export function straightenRange(
  waypoints: readonly WaypointNode[],
  startIdx: number,
  endIdx: number,
): WaypointNode[] {
  const sIdx = Math.max(0, Math.min(startIdx, endIdx));
  const eIdx = Math.min(waypoints.length - 1, Math.max(startIdx, endIdx));
  if (eIdx - sIdx < 1) return [...waypoints];

  const a = waypoints[sIdx]!;
  const b = waypoints[eIdx]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;

  return waypoints.map((w, i) => {
    if (i < sIdx || i > eIdx) return w;
    const nextW: WaypointNode = { ...w, segmentMode: 'straight', curveControl: undefined };
    if (i > sIdx && i < eIdx && lenSq > 1e-4) {
      const proj = Math.max(0, Math.min(1, ((w.x - a.x) * dx + (w.z - a.z) * dz) / lenSq));
      nextW.x = Number((a.x + dx * proj).toFixed(2));
      nextW.z = Number((a.z + dz * proj).toFixed(2));
    }
    return nextW;
  });
}

/** Reverses path direction (Start <-> Base) cleanly preserving per-segment curve handles & modes. */
export function reverseWaypoints(waypoints: readonly WaypointNode[]): WaypointNode[] {
  const n = waypoints.length;
  if (n < 2) return [...waypoints];

  return Array.from({ length: n }, (_, k) => {
    const src = waypoints[n - 1 - k]!;
    const reversed: WaypointNode = {
      id: src.id,
      x: src.x,
      y: src.y,
      z: src.z,
      roadWidth: src.roadWidth,
      elevationMode: src.elevationMode,
      isTunnel: src.isTunnel,
      isOverpass: src.isOverpass,
    };
    if (k < n - 1) {
      const prevSpanOwner = waypoints[n - 2 - k]!;
      reversed.segmentMode = prevSpanOwner.segmentMode;
      reversed.curveControl = prevSpanOwner.curveControl
        ? { ...prevSpanOwner.curveControl }
        : undefined;
      reversed.slopeMode = prevSpanOwner.slopeMode;
      reversed.roadPartAsset = prevSpanOwner.roadPartAsset;
    }
    return reversed;
  });
}
