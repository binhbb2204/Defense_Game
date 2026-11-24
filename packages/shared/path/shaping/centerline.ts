import type { RoadSegment, Vec3 } from '../../types/protocol';
import {
  clampVal,
  evalCubic,
  evalCubicDeriv1,
  evalCubicDeriv2,
  evalCubicTangent3D,
  resolveSegmentCubic,
} from './cubicBezier';
import type { CenterlineInput, CenterlineSample, CubicBezier3D } from './types';

export {
  resolveSegmentCubic,
  evalCubic,
  evalCubicDeriv1,
  evalCubicDeriv2,
  evalCubicTangent3D,
};

const EPS = 1e-6;
const DEFAULT_MAX_STEP = 1.5;
const DEFAULT_MAX_ANGLE = (5 * Math.PI) / 180;

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function sampleCubicAdaptiveParams(
  cubic: CubicBezier3D,
  maxStep = DEFAULT_MAX_STEP,
  maxAngle = DEFAULT_MAX_ANGLE,
): number[] {
  if (!cubic.isCurved) return [0, 1];
  const stepLim = Math.max(0.2, maxStep);
  const cosLim = Math.cos(clampVal(maxAngle, (0.5 * Math.PI) / 180, Math.PI * 0.5));
  const ts: number[] = [0];
  const stack: Array<{ t0: number; t1: number; depth: number }> = [{ t0: 0, t1: 1, depth: 0 }];

  while (stack.length > 0) {
    const item = stack.pop()!;
    const a = evalCubic(cubic, item.t0);
    const b = evalCubic(cubic, item.t1);
    const tm = 0.5 * (item.t0 + item.t1);
    const m = evalCubic(cubic, tm);
    const chordLen = dist3(a, b);

    let dev = 0;
    const xzLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (xzLen > EPS) {
      dev = Math.abs((m.x - a.x) * -(b.z - a.z) + (m.z - a.z) * (b.x - a.x)) / xzLen;
    }

    const ta = evalCubicTangent3D(cubic, item.t0);
    const tb = evalCubicTangent3D(cubic, item.t1);
    const angleCos = ta.x * tb.x + ta.z * tb.z;

    const shouldSplit =
      item.depth < 7 &&
      (chordLen > stepLim || angleCos < cosLim || dev > 0.025 || (item.depth < 2 && chordLen > 0.4));

    if (shouldSplit) {
      stack.push({ t0: tm, t1: item.t1, depth: item.depth + 1 });
      stack.push({ t0: item.t0, t1: tm, depth: item.depth + 1 });
    } else {
      ts.push(item.t1);
    }
  }
  return ts;
}

function appendSegmentSamples(
  seg: RoadSegment,
  cubic: CubicBezier3D,
  reversed: boolean,
  maxStep: number,
  maxAngle: number,
  sOffset: number,
  out: CenterlineSample[],
): number {
  const ts = sampleCubicAdaptiveParams(cubic, maxStep, maxAngle);
  if (reversed) ts.reverse();
  let curS = sOffset;
  let prevPos: Vec3 | null = out.length > 0 ? out[out.length - 1]! : null;

  for (let i = 0; i < ts.length; i++) {
    if (i === 0 && out.length > 0) continue;
    const u = ts[i]!;
    const p = evalCubic(cubic, u);
    const tan = evalCubicTangent3D(cubic, u);
    const orientedTan: Vec3 = reversed ? { x: -tan.x, y: -tan.y, z: -tan.z } : tan;
    if (prevPos) curS += dist3(prevPos, p);
    prevPos = p;
    out.push({
      x: p.x,
      y: p.y,
      z: p.z,
      tangent: orientedTan,
      s: curS,
      t: u,
      segmentId: seg.id,
      width: seg.width,
      isOverpass: seg.isOverpass,
      isTunnel: seg.isTunnel,
      roadPartAsset: seg.roadPartAsset,
    });
  }
  return curS;
}

/**
 * Single source of truth curve sampler shared by road mesh builder, direction arrows,
 * validator, preview overlay, and enemy runtime pathing (`PathSystem`).
 */
export function sampleCenterline(
  input: CenterlineInput,
  maxStep = DEFAULT_MAX_STEP,
  maxAngle = DEFAULT_MAX_ANGLE,
): CenterlineSample[] {
  const out: CenterlineSample[] = [];
  if ('segment' in input) {
    const segList = input.segments ?? [input.segment];
    const cubic = resolveSegmentCubic(input.segment, input.nodes, segList);
    appendSegmentSamples(input.segment, cubic, Boolean(input.reversed), maxStep, maxAngle, 0, out);
    return out;
  }

  const nodeIds = 'route' in input ? input.route.nodeIds : input.nodeIds;
  const segIds = 'route' in input ? input.route.segmentIds : input.segmentIds;
  const segMap = new Map(input.segments.map((s) => [s.id, s]));
  let sAccum = 0;

  for (let i = 0; i < segIds.length; i++) {
    const seg = segMap.get(segIds[i]!);
    if (!seg) continue;
    const fromNodeId = nodeIds[i];
    const reversed = fromNodeId !== undefined ? seg.a !== fromNodeId : false;
    const cubic = resolveSegmentCubic(seg, input.nodes, input.segments);
    sAccum = appendSegmentSamples(seg, cubic, reversed, maxStep, maxAngle, sAccum, out);
  }
  return out;
}
