import type { MapObstacle, RoadNode, RoadSegment, Vec3 } from '@tactical-td/shared';
import type { RoadSnapResult } from '../roadSnapping';

export interface PlacementRuleResult {
  allowed: boolean;
  reason: string | null;
  warning?: string | null;
  isRadiusViolation?: boolean;
  maxSlopePct?: number;
}

export interface RoadPlacementContext {
  nodes: readonly RoadNode[];
  segments: readonly RoadSegment[];
  obstacles: readonly MapObstacle[];
  anchorNode: RoadNode;
  targetSnap: RoadSnapResult;
  control: Vec3 | null;
  roadWidth: number;
  anarchyEnabled: boolean;
  minLength: number;
  minAngleDeg: number;
  autoIntersect: boolean;
  radiusOverride?: number;
  segCandidate: Pick<RoadSegment, 'kind' | 'control'>;
  metrics: { length: number; minTurnRadius: number; maxSlopePct: number };
  nodeMap: Map<string, RoadNode>;
}

/**
 * Abstract base class for Open/Closed placement validation rules.
 */
export abstract class BasePlacementRule {
  abstract readonly name: string;

  /** When false, rule degrades to a warning instead of blocking when Anarchy is active. */
  readonly enforceUnderAnarchy: boolean = false;

  abstract validate(ctx: RoadPlacementContext): PlacementRuleResult;

  protected ok(): PlacementRuleResult {
    return { allowed: true, reason: null };
  }

  protected fail(reason: string, isRadiusViolation = false): PlacementRuleResult {
    return { allowed: false, reason, isRadiusViolation };
  }
}
