import {
  measureRoadSegment,
  type MapObstacle,
  type RoadNode,
  type RoadSegment,
  type Vec3,
} from '@tactical-td/shared';
import type { RoadSnapResult } from '../roadSnapping';
import {
  BasePlacementRule,
  type PlacementRuleResult,
  type RoadPlacementContext,
} from './BasePlacementRule';
import {
  DuplicateSegmentRule,
  MaxSlopeRule,
  MinLengthRule,
  MinTurnRadiusRule,
} from './GeometryConstraintRules';
import {
  LevelCrossingRule,
  MinJunctionAngleRule,
  ObstacleOverlapRule,
} from './TopologyRules';

/**
 * Composable placement validator executing an ordered list of BasePlacementRule subclasses.
 * Under Anarchy, non-enforced rules warn cleanly without blocking commit.
 */
export class RoadPlacementValidator {
  private readonly rules: readonly BasePlacementRule[];

  constructor(rules?: readonly BasePlacementRule[]) {
    this.rules = rules ?? [
      new MinLengthRule(),
      new MaxSlopeRule(),
      new MinTurnRadiusRule(),
      new DuplicateSegmentRule(),
      new MinJunctionAngleRule(),
      new ObstacleOverlapRule(),
      new LevelCrossingRule(),
    ];
  }

  validate(ctx: RoadPlacementContext): PlacementRuleResult {
    let warning: string | null = null;
    let radiusViolation = false;

    for (const rule of this.rules) {
      const res = rule.validate(ctx);
      if (!res.allowed) {
        if (ctx.anarchyEnabled && !rule.enforceUnderAnarchy) {
          if (!warning) warning = `${res.reason} (Anarchy)`;
          if (res.isRadiusViolation) radiusViolation = true;
          continue;
        }
        return { ...res, maxSlopePct: ctx.metrics.maxSlopePct };
      }
    }
    return {
      allowed: true,
      reason: null,
      warning,
      isRadiusViolation: radiusViolation,
      maxSlopePct: ctx.metrics.maxSlopePct,
    };
  }
}

const defaultValidator = new RoadPlacementValidator();

export function checkRoadSegmentPlacement(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  obstacles: readonly MapObstacle[],
  anchorNode: RoadNode,
  targetSnap: RoadSnapResult,
  control: Vec3 | null,
  roadWidth: number,
  anarchyEnabled: boolean,
  options?: {
    minLength?: number;
    minAngleDeg?: number;
    autoIntersect?: boolean;
    radiusOverride?: number;
  },
): PlacementRuleResult {
  const segCandidate: Pick<RoadSegment, 'kind' | 'control'> = {
    kind: control ? 'curve' : 'straight',
    control: control ?? undefined,
  };
  const ctx: RoadPlacementContext = {
    nodes,
    segments,
    obstacles,
    anchorNode,
    targetSnap,
    control,
    roadWidth,
    anarchyEnabled,
    minLength: options?.minLength ?? 4,
    minAngleDeg: options?.minAngleDeg ?? 25,
    autoIntersect: options?.autoIntersect ?? true,
    radiusOverride: options?.radiusOverride,
    segCandidate,
    metrics: measureRoadSegment(anchorNode, targetSnap.pos, segCandidate),
    nodeMap: new Map(nodes.map((n) => [n.id, n])),
  };
  return defaultValidator.validate(ctx);
}
