import type { RoadNode, RoadSegment } from '../../types/protocol';
import { analyzeSectionCurvature } from './curvatureSafety';
import { curveBetween, smoothSection } from './shapeCoreModes';
import { roundCorner } from './shapeTier2Modes';
import type { RoadSection, ShapeMode } from './types';

export interface SafeShapeParams {
  tension?: number;
  handleFactor?: number;
  radius?: number;
}

/**
 * Computes conservative parameter values for Smooth (`tension`), Curve (`handleFactor`),
 * or Round corner (`radius`) that satisfy `minRadius >= seg.width * 0.5`.
 */
export function computeSafeShapeParams(
  mode: ShapeMode,
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  section: RoadSection | null,
  current: { tension: number; handleFactor: number; spacing: number; radius: number; singleNodeId?: string },
): SafeShapeParams {
  if (mode === 'smooth' && section) {
    let lo = 0;
    let hi = Math.max(0, Math.min(1, current.tension));
    if (smoothSection(nodes, segments, section, { tension: hi }).violations.length === 0) {
      return { tension: hi };
    }
    for (let i = 0; i < 14; i++) {
      const mid = 0.5 * (lo + hi);
      if (smoothSection(nodes, segments, section, { tension: mid }).violations.length === 0) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return { tension: Number(lo.toFixed(2)) };
  }

  if (mode === 'curve' && section && !section.hasInteriorSpawnOrBase) {
    let bestFactor = current.handleFactor;
    let bestViolations = Infinity;
    for (let f = 0.1; f <= 0.801; f += 0.05) {
      const candidate = curveBetween(nodes, segments, section, {
        handleFactor: f,
        spacing: current.spacing,
      });
      const vCount = candidate.violations.length;
      if (vCount === 0 && (bestViolations > 0 || Math.abs(f - current.handleFactor) < Math.abs(bestFactor - current.handleFactor))) {
        bestViolations = 0;
        bestFactor = Number(f.toFixed(2));
      } else if (vCount < bestViolations && bestViolations > 0) {
        bestViolations = vCount;
        bestFactor = Number(f.toFixed(2));
      }
    }
    return { handleFactor: bestFactor };
  }

  if (mode === 'round_corner' && current.singleNodeId) {
    const inc = segments.filter((s) => s.a === current.singleNodeId || s.b === current.singleNodeId);
    const minSafeR = Math.max(3, ...inc.map((s) => s.width * 0.55));
    const maxTry = Math.max(minSafeR, current.radius * 2);
    for (let r = Math.max(current.radius, minSafeR); r <= maxTry + 12; r += 1) {
      const res = roundCorner(nodes, segments, current.singleNodeId, { radius: r });
      if (res.allowed && res.violations.length === 0) {
        return { radius: Number(res.minRadius.toFixed(1)) };
      }
    }
    return { radius: Number(minSafeR.toFixed(1)) };
  }

  void analyzeSectionCurvature;
  return {};
}
