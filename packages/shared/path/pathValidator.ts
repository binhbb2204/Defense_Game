import type {
  IHorizontalSegment,
  IPathValidator,
  IVerticalProfile,
  SegmentValidationIssue,
} from './types';

/**
 * Default tactical road constraint validator (matches Cities: Skylines Anarchy behavior).
 * Flags sharp inner turns where R < 0.6 * roadWidth and steep grades > 20%.
 */
export class RoadPathValidator implements IPathValidator {
  public validateSegment(
    segIndex: number,
    horizontal: IHorizontalSegment,
    vertical: IVerticalProfile,
    startS: number,
    endS: number,
    avgRoadWidth: number,
    anarchyEnabled: boolean,
  ): SegmentValidationIssue[] {
    if (anarchyEnabled) return [];
    const issues: SegmentValidationIssue[] = [];

    const safeMinRadius = Math.max(1.2, avgRoadWidth * 0.6);
    const minR = horizontal.getMinTurnRadius();
    if (Number.isFinite(minR) && minR < safeMinRadius) {
      issues.push({
        segmentIndex: segIndex,
        code: 'SHARP_CURVE',
        severity: 'warn',
        message: `Tight turn radius (${minR.toFixed(1)}m < ${safeMinRadius.toFixed(1)}m safe min) may pinch inner curb.`,
      });
    }

    let maxGrade = 0;
    const samples = 12;
    for (let k = 0; k <= samples; k++) {
      const s = startS + ((endS - startS) * k) / samples;
      const slopePct = Math.abs(vertical.evaluateSlope(s, segIndex)) * 100;
      if (slopePct > maxGrade) maxGrade = slopePct;
    }

    if (maxGrade > 22) {
      issues.push({
        segmentIndex: segIndex,
        code: 'STEEP_SLOPE',
        severity: 'error',
        message: `Steep grade ${maxGrade.toFixed(0)}% exceeds recommended 22% ramp limit.`,
      });
    }

    return issues;
  }
}
