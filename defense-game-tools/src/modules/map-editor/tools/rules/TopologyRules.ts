import { sampleRoadSegment } from '@tactical-td/shared';
import {
  checkNodeIncidentAngles,
  evaluateCandidateEnds,
  findSegmentCrossings,
} from '../roadSnapping';
import {
  BasePlacementRule,
  type PlacementRuleResult,
  type RoadPlacementContext,
} from './BasePlacementRule';

export class MinJunctionAngleRule extends BasePlacementRule {
  readonly name = 'min-junction-angle';

  validate(ctx: RoadPlacementContext): PlacementRuleResult {
    const { startTan, intoTarget } = evaluateCandidateEnds(
      ctx.anchorNode,
      ctx.targetSnap.pos,
      ctx.segCandidate,
    );

    if (!checkNodeIncidentAngles(ctx.anchorNode, startTan, ctx.segments, ctx.nodeMap, ctx.minAngleDeg)) {
      return this.fail(`Angle too sharp (< ${ctx.minAngleDeg} deg) - enable Anarchy`);
    }

    if (ctx.targetSnap.kind === 'node' && ctx.targetSnap.nodeId) {
      const targetNode = ctx.nodeMap.get(ctx.targetSnap.nodeId);
      if (
        targetNode &&
        !checkNodeIncidentAngles(targetNode, intoTarget, ctx.segments, ctx.nodeMap, ctx.minAngleDeg)
      ) {
        return this.fail(`Target junction angle < ${ctx.minAngleDeg} deg - enable Anarchy`);
      }
    }
    return this.ok();
  }
}

export class ObstacleOverlapRule extends BasePlacementRule {
  readonly name = 'obstacle-overlap';

  validate(ctx: RoadPlacementContext): PlacementRuleResult {
    const pts = sampleRoadSegment(ctx.anchorNode, ctx.targetSnap.pos, ctx.segCandidate, 10);
    const newHalfW = ctx.roadWidth * 0.5;

    for (const obs of ctx.obstacles) {
      if (obs.kind === 'tunnel_shell' || obs.kind === 'pillar') continue;
      const foot = Math.min(obs.size.x, obs.size.z) * 0.4;
      for (const p of pts) {
        const distXZ = Math.hypot(p.x - obs.position.x, p.z - obs.position.z);
        if (distXZ < newHalfW + foot && Math.abs(p.y - (obs.position.y - obs.size.y * 0.5)) < 3.0) {
          return this.fail(`Overlaps "${obs.id}" - enable Anarchy`);
        }
      }
    }
    return this.ok();
  }
}

export class LevelCrossingRule extends BasePlacementRule {
  readonly name = 'level-crossing';

  validate(ctx: RoadPlacementContext): PlacementRuleResult {
    if (ctx.autoIntersect) return this.ok();
    const crossings = findSegmentCrossings(
      ctx.nodes,
      ctx.segments,
      ctx.anchorNode,
      ctx.targetSnap,
      ctx.control,
    );
    if (crossings.length > 0) {
      return this.fail('Crosses road without snapping - enable Auto-Intersect, raise Y, or Anarchy');
    }
    return this.ok();
  }
}
