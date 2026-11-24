import type { RoadNode, RoadSegment, RoadSegmentKind, Vec2, Vec3 } from '../types/protocol';
import { clampVal, round2 } from './graph/segmentCurve';
import { evalCubicTangent3D, resolveSegmentCubic, sampleCenterline } from './shaping/centerline';
import { measureSegmentMinRadius } from './shaping/curvatureSafety';

export type RoadBuildMode = 'straight' | 'curve' | 'free';

export interface RoadWidthPreset {
  id: 'narrow' | 'standard' | 'wide';
  label: string;
  width: number;
}

export const ROAD_WIDTH_PRESETS: readonly RoadWidthPreset[] = [
  { id: 'narrow', label: 'Narrow', width: 4 },
  { id: 'standard', label: 'Standard', width: 6 },
  { id: 'wide', label: 'Wide', width: 10 },
];

export const DEFAULT_MIN_SEGMENT_LENGTH = 4;
export const DEFAULT_FREE_MAX_DEFLECTION_DEG = 75;

const EPS = 1e-6;
const ANGLE_STEP_RAD = (15 * Math.PI) / 180;

export interface RoadCandidateEval {
  kind: RoadSegmentKind;
  control: Vec3 | null;
  endPos: Vec3;
  length: number;
  angleDeg: number | null;
  minRadius: number;
  nextTangent: Vec2 | null;
  incomingTangent: Vec2 | null;
  usedAngleSnap: boolean;
  cornerFallback: boolean;
  cornerHint: string | null;
  tooTightRadius: boolean;
}

export function normalizeXZ(dx: number, dz: number): Vec2 | null {
  const len = Math.hypot(dx, dz);
  if (len < EPS) return null;
  return { x: dx / len, z: dz / len };
}

export function angleBetweenXZDeg(a: Vec2 | null, b: Vec2 | null): number | null {
  if (!a || !b) return null;
  const dot = clampVal(a.x * b.x + a.z * b.z, -1, 1);
  return Number(((Math.acos(dot) * 180) / Math.PI).toFixed(1));
}

export function computeSegmentEndTangentXZ(
  start: Vec3,
  end: Vec3,
  kind: RoadSegmentKind,
  control: Vec3 | null | undefined,
): Vec2 | null {
  if (kind === 'curve' && control) {
    const t = normalizeXZ(end.x - control.x, end.z - control.z);
    if (t) return t;
  }
  return normalizeXZ(end.x - start.x, end.z - start.z);
}

/**
 * Resolves the outward tangent continuing away from an existing degree-1 or degree-2 node.
 * Returns null for degree-0 (isolated) or degree-3+ junctions.
 */
export function resolveNodeContinuationTangent(
  node: Pick<Vec3, 'x' | 'y' | 'z'> & { id?: string },
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  aimDirXZ?: Vec2 | null,
): Vec2 | null {
  if (!node.id) return null;
  const incident = segments.filter((s) => s.a === node.id || s.b === node.id);
  if (incident.length === 0 || incident.length > 2) return null;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const candidates: Vec2[] = [];

  for (const seg of incident) {
    const otherId = seg.a === node.id ? seg.b : seg.a;
    const other = nodeMap.get(otherId);
    if (!other) continue;

    let outward: Vec2 | null = null;
    if (seg.kind === 'curve' && seg.control) {
      outward = normalizeXZ(node.x - seg.control.x, node.z - seg.control.z);
    } else if (seg.kind === 'curve') {
      const cubic = resolveSegmentCubic(seg, nodes, segments);
      const t = seg.b === node.id ? 1 : 0;
      const tan = evalCubicTangent3D(cubic, t);
      outward = seg.b === node.id ? normalizeXZ(tan.x, tan.z) : normalizeXZ(-tan.x, -tan.z);
    }
    if (!outward) {
      outward = normalizeXZ(node.x - other.x, node.z - other.z);
    }
    if (outward) candidates.push(outward);
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1 || !aimDirXZ) return candidates[0]!;

  const dot0 = candidates[0]!.x * aimDirXZ.x + candidates[0]!.z * aimDirXZ.z;
  const dot1 = candidates[1]!.x * aimDirXZ.x + candidates[1]!.z * aimDirXZ.z;
  return dot1 > dot0 ? candidates[1]! : candidates[0]!;
}

/** Snaps cursor bearing around `anchor` to 15-deg increments relative to `refTangent` (or +X). */
export function snapAngle15(anchor: Vec3, cursor: Vec3, refTangent: Vec2 | null): Vec3 {
  const dx = cursor.x - anchor.x;
  const dz = cursor.z - anchor.z;
  const dist = Math.hypot(dx, dz);
  if (dist < EPS) return { ...cursor };

  const baseAngle = refTangent ? Math.atan2(refTangent.z, refTangent.x) : 0;
  const rawAngle = Math.atan2(dz, dx);
  const steps = Math.round((rawAngle - baseAngle) / ANGLE_STEP_RAD);
  const snappedAngle = baseAngle + steps * ANGLE_STEP_RAD;

  return {
    x: round2(anchor.x + Math.cos(snappedAngle) * dist),
    y: cursor.y,
    z: round2(anchor.z + Math.sin(snappedAngle) * dist),
  };
}

/** Snaps Curve mode's control handle onto the continuation of `prevTangent` when aligned. */
export function snapCurveControlToTangent(
  anchor: Vec3,
  cursor: Vec3,
  prevTangent: Vec2 | null,
  options: { altHeld: boolean; angleSnap: boolean },
): { pos: Vec3; snappedToTangent: boolean } {
  if (!options.altHeld && prevTangent) {
    const dx = cursor.x - anchor.x;
    const dz = cursor.z - anchor.z;
    const proj = dx * prevTangent.x + dz * prevTangent.z;
    const perp = Math.abs(dx * -prevTangent.z + dz * prevTangent.x);
    const coneDeg = (Math.atan2(perp, Math.max(EPS, proj)) * 180) / Math.PI;
    if (proj > 0.5 && (perp <= 4.0 || coneDeg <= 18)) {
      return {
        pos: {
          x: round2(anchor.x + prevTangent.x * proj),
          y: cursor.y,
          z: round2(anchor.z + prevTangent.z * proj),
        },
        snappedToTangent: true,
      };
    }
  }

  if (!options.altHeld && options.angleSnap) {
    return {
      pos: snapAngle15(anchor, cursor, prevTangent),
      snappedToTangent: false,
    };
  }

  return { pos: { ...cursor }, snappedToTangent: false };
}

function sampleQuadCurveLength(
  anchor: Vec3,
  endPos: Vec3,
  control: Vec3,
  roadWidth: number,
): { seg: RoadSegment; evalNodes: RoadNode[]; length: number } {
  const seg: RoadSegment = {
    id: '__cand__',
    a: '__a__',
    b: '__b__',
    width: roadWidth,
    kind: 'curve',
    control,
  };
  const evalNodes: RoadNode[] = [
    { id: '__a__', x: anchor.x, y: anchor.y, z: anchor.z, role: 'normal' },
    { id: '__b__', x: endPos.x, y: endPos.y, z: endPos.z, role: 'normal' },
  ];
  const samples = sampleCenterline({ segment: seg, nodes: evalNodes, segments: [seg] }, 1.5, (5 * Math.PI) / 180);
  const length = samples.length > 0 ? samples[samples.length - 1]!.s : Math.hypot(endPos.x - anchor.x, endPos.y - anchor.y, endPos.z - anchor.z);
  return { seg, evalNodes, length };
}

export function evaluateStraightCandidate(
  anchor: Vec3,
  cursor: Vec3,
  prevTangent: Vec2 | null,
  options: { angleSnap: boolean; altHeld: boolean; allowAngleSnap: boolean },
): RoadCandidateEval {
  const shouldAngleSnap = options.angleSnap && !options.altHeld && options.allowAngleSnap;
  const endPos = shouldAngleSnap ? snapAngle15(anchor, cursor, prevTangent) : { ...cursor };
  const nextTangent = normalizeXZ(endPos.x - anchor.x, endPos.z - anchor.z);
  const length = Math.hypot(endPos.x - anchor.x, endPos.y - anchor.y, endPos.z - anchor.z);
  return {
    kind: 'straight',
    control: null,
    endPos,
    length: Number(length.toFixed(2)),
    angleDeg: angleBetweenXZDeg(prevTangent, nextTangent),
    minRadius: Infinity,
    nextTangent,
    incomingTangent: prevTangent,
    usedAngleSnap: shouldAngleSnap,
    cornerFallback: false,
    cornerHint: null,
    tooTightRadius: false,
  };
}

export function evaluateCurveCandidate(
  anchor: Vec3,
  control: Vec3,
  endPos: Vec3,
  roadWidth: number,
  prevTangent: Vec2 | null,
): RoadCandidateEval {
  const resolvedControl: Vec3 = {
    x: control.x,
    y: round2((anchor.y + endPos.y) * 0.5),
    z: control.z,
  };
  const { seg, evalNodes, length } = sampleQuadCurveLength(anchor, endPos, resolvedControl, roadWidth);
  const minRadius = measureSegmentMinRadius(seg, evalNodes, [seg]).minRadius;
  const startTan = normalizeXZ(resolvedControl.x - anchor.x, resolvedControl.z - anchor.z);
  const nextTangent = computeSegmentEndTangentXZ(anchor, endPos, 'curve', resolvedControl);
  const refStart = prevTangent ?? startTan;

  return {
    kind: 'curve',
    control: resolvedControl,
    endPos,
    length: Number(length.toFixed(2)),
    angleDeg: angleBetweenXZDeg(refStart, nextTangent),
    minRadius,
    nextTangent,
    incomingTangent: prevTangent,
    usedAngleSnap: false,
    cornerFallback: false,
    cornerHint: null,
    tooTightRadius: Number.isFinite(minRadius) && minRadius < roadWidth * 0.5,
  };
}

export function evaluateFreeCandidate(
  anchor: Vec3 & { id?: string },
  endPos: Vec3,
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  roadWidth: number,
  prevTangent: Vec2 | null,
  options: { shiftHeld: boolean; maxDeflectionDeg?: number },
): RoadCandidateEval {
  const dx = endPos.x - anchor.x;
  const dy = endPos.y - anchor.y;
  const dz = endPos.z - anchor.z;
  const aim = normalizeXZ(dx, dz);
  const incomingTangent =
    prevTangent ?? resolveNodeContinuationTangent(anchor, nodes, segments, aim);

  const straightLength = Number(Math.hypot(dx, dy, dz).toFixed(2));
  if (options.shiftHeld || !incomingTangent || !aim) {
    return {
      kind: 'straight',
      control: null,
      endPos: { ...endPos },
      length: straightLength,
      angleDeg: angleBetweenXZDeg(incomingTangent, aim),
      minRadius: Infinity,
      nextTangent: aim,
      incomingTangent,
      usedAngleSnap: false,
      cornerFallback: false,
      cornerHint: null,
      tooTightRadius: false,
    };
  }

  const distXZ = Math.hypot(dx, dz);
  const dotDT = dx * incomingTangent.x + dz * incomingTangent.z;
  const cosTheta = clampVal(dotDT / Math.max(EPS, distXZ), -1, 1);
  const theta = Math.acos(cosTheta);
  const thetaDeg = (theta * 180) / Math.PI;
  const maxDefl = options.maxDeflectionDeg ?? DEFAULT_FREE_MAX_DEFLECTION_DEG;

  if (thetaDeg <= 1.0) {
    return {
      kind: 'straight',
      control: null,
      endPos: { ...endPos },
      length: straightLength,
      angleDeg: 0,
      minRadius: Infinity,
      nextTangent: aim,
      incomingTangent,
      usedAngleSnap: false,
      cornerFallback: false,
      cornerHint: null,
      tooTightRadius: false,
    };
  }

  if (thetaDeg > maxDefl || dotDT <= 1e-4) {
    return {
      kind: 'straight',
      control: null,
      endPos: { ...endPos },
      length: straightLength,
      angleDeg: Number(thetaDeg.toFixed(1)),
      minRadius: Infinity,
      nextTangent: aim,
      incomingTangent,
      usedAngleSnap: false,
      cornerFallback: true,
      cornerHint: 'Turn too tight',
      tooTightRadius: false,
    };
  }

  const s = (distXZ * distXZ) / (2 * dotDT);
  const control: Vec3 = {
    x: round2(anchor.x + incomingTangent.x * s),
    y: round2((anchor.y + endPos.y) * 0.5),
    z: round2(anchor.z + incomingTangent.z * s),
  };
  const sinTheta = Math.max(EPS, Math.sin(theta));
  const estRadius = distXZ / (2 * sinTheta);
  const { length } = sampleQuadCurveLength(anchor, endPos, control, roadWidth);
  const nextTangent = computeSegmentEndTangentXZ(anchor, endPos, 'curve', control);

  return {
    kind: 'curve',
    control,
    endPos: { ...endPos },
    length: Number(length.toFixed(2)),
    angleDeg: Number((thetaDeg * 2).toFixed(1)),
    minRadius: estRadius,
    nextTangent,
    incomingTangent,
    usedAngleSnap: false,
    cornerFallback: false,
    cornerHint: null,
    tooTightRadius: Number.isFinite(estRadius) && estRadius < roadWidth * 0.5,
  };
}
