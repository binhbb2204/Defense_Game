import type { RoadNode, RoadSegment, Vec3 } from '../../types/protocol';
import {
  evalCubic,
  evalCubicDeriv1,
  evalCubicDeriv2,
  resolveSegmentCubic,
  sampleCenterline,
} from './centerline';
import type { CurvatureViolation } from './types';

/**
 * Computes minimum discrete XZ circumradius along a polyline.
 * Returns `Infinity` for collinear points or fewer than 3 points.
 */
export function minRadius(points: readonly Vec3[]): number {
  if (points.length < 3) return Infinity;
  let best = Infinity;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ac = Math.hypot(c.x - a.x, c.z - a.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (area2 < 1e-6 || ab < 1e-4 || bc < 1e-4) continue;
    const r = (ab * bc * ac) / (2 * area2);
    if (r < best) best = r;
  }
  return best;
}

/** Measures minimum analytic + sampled curvature radius for a single segment. */
export function measureSegmentMinRadius(
  segment: RoadSegment,
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
): { minRadius: number; minPos: Vec3 } {
  if (segment.kind !== 'curve') {
    return { minRadius: Infinity, minPos: { x: 0, y: 0, z: 0 } };
  }
  const cubic = resolveSegmentCubic(segment, nodes, segments);
  let bestR = Infinity;
  let bestPos = evalCubic(cubic, 0.5);

  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const d1 = evalCubicDeriv1(cubic, u);
    const d2 = evalCubicDeriv2(cubic, u);
    const sp2 = d1.x * d1.x + d1.z * d1.z;
    const sp3 = sp2 * Math.sqrt(sp2);
    const cross = Math.abs(d1.x * d2.z - d1.z * d2.x);
    if (cross > 1e-5) {
      const r = sp3 / cross;
      if (r < bestR) {
        bestR = r;
        bestPos = evalCubic(cubic, u);
      }
    }
  }

  const samples = sampleCenterline({ segment, nodes, segments }, 1.2, (4 * Math.PI) / 180);
  const polyR = minRadius(samples);
  if (polyR < bestR) {
    bestR = polyR;
  }
  return { minRadius: bestR, minPos: bestPos };
}

/** Checks curvature threshold (`R < width / 2`, where inner curb folds) across given segment IDs. */
export function analyzeSectionCurvature(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  segmentIds: readonly string[],
): { minRadius: number; violations: CurvatureViolation[] } {
  const segMap = new Map(segments.map((s) => [s.id, s]));
  const violations: CurvatureViolation[] = [];
  let minR = Infinity;

  for (const sid of segmentIds) {
    const seg = segMap.get(sid);
    if (!seg) continue;
    const minAllowed = Math.max(0.5, seg.width * 0.5);
    const m = measureSegmentMinRadius(seg, nodes, segments);
    if (m.minRadius < minR) minR = m.minRadius;
    if (Number.isFinite(m.minRadius) && m.minRadius < minAllowed) {
      violations.push({
        segmentId: seg.id,
        position: m.minPos,
        radius: m.minRadius,
        minAllowedRadius: minAllowed,
      });
    }
  }
  return { minRadius: minR, violations };
}

/** Binary-searches a safe tension `in [0, 1]` where curvature satisfies `R >= width / 2`. */
export function findSafeTension(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  segmentIds: readonly string[],
  currentTension: number,
): number {
  const idSet = new Set(segmentIds);
  const testAt = (tension: number) => {
    const patched = segments.map((s) =>
      idSet.has(s.id) ? { ...s, kind: 'curve' as const, tension, control: undefined } : s,
    );
    return analyzeSectionCurvature(nodes, patched, segmentIds).violations.length === 0;
  };
  if (testAt(currentTension)) return currentTension;
  let lo = 0;
  let hi = Math.max(0, Math.min(1, currentTension));
  for (let it = 0; it < 14; it++) {
    const mid = 0.5 * (lo + hi);
    if (testAt(mid)) lo = mid;
    else hi = mid;
  }
  return Number(lo.toFixed(2));
}
