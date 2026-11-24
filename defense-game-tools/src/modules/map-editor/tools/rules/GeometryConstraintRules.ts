import {
  BasePlacementRule,
  type PlacementRuleResult,
  type RoadPlacementContext,
} from './BasePlacementRule';

export class MinLengthRule extends BasePlacementRule {
  readonly name = 'min-length';
  override readonly enforceUnderAnarchy = true;

  validate(ctx: RoadPlacementContext): PlacementRuleResult {
    if (ctx.metrics.length < ctx.minLength) {
      return this.fail(`Segment too short (min ${ctx.minLength.toFixed(0)} m)`);
    }
    return this.ok();
  }
}

export class MaxSlopeRule extends BasePlacementRule {
  readonly name = 'max-slope';

  validate(ctx: RoadPlacementContext): PlacementRuleResult {
    if (ctx.metrics.maxSlopePct > 22) {
      return this.fail(`Slope ${ctx.metrics.maxSlopePct.toFixed(0)}% > 22% (enable Anarchy)`);
    }
    return this.ok();
  }
}

export class MinTurnRadiusRule extends BasePlacementRule {
  readonly name = 'min-turn-radius';

  validate(ctx: RoadPlacementContext): PlacementRuleResult {
    const safeMinR = ctx.roadWidth * 0.5;
    const r = ctx.radiusOverride ?? ctx.metrics.minTurnRadius;
    if (Number.isFinite(r) && r < safeMinR) {
      return this.fail(
        `Turn radius ${r.toFixed(1)}m < ${safeMinR.toFixed(1)}m`,
        true,
      );
    }
    return this.ok();
  }
}

export class DuplicateSegmentRule extends BasePlacementRule {
  readonly name = 'duplicate-segment';

  validate(ctx: RoadPlacementContext): PlacementRuleResult {
    if (ctx.targetSnap.kind === 'node' && ctx.targetSnap.nodeId) {
      const dup = ctx.segments.some(
        (s) =>
          (s.a === ctx.anchorNode.id && s.b === ctx.targetSnap.nodeId) ||
          (s.b === ctx.anchorNode.id && s.a === ctx.targetSnap.nodeId),
      );
      if (dup) {
        return this.fail('Segment already connects these nodes');
      }
    }
    return this.ok();
  }
}
