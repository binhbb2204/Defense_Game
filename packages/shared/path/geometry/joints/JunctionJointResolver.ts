import type { RoadNode, Vec3 } from '../../../types/protocol';
import {
  addV3,
  dedupePointRing,
  distXZ,
  dotXZ,
  evalBezier,
  intersectLinesXZ,
  positiveAngleDiff,
  sampleCacheByS,
  scaleV3,
  subV3,
  v3,
} from '../math2d';
import type { HalfEdge, JointContext, SectorCorner } from '../types';
import { BaseJointResolver } from './BaseJointResolver';

export class JunctionJointResolver extends BaseJointResolver {
  canHandle(degree: number): boolean {
    return degree >= 3;
  }

  computeRequestedTrims(
    node: RoadNode,
    halfEdges: HalfEdge[],
    ctx: JointContext
  ): void {
    const { cornerRadius, maxCornerDistMult } = ctx.options;
    const sorted = [...halfEdges].sort((a, b) => a.angle - b.angle);
    const m = sorted.length;
    const sectors: SectorCorner[] = [];

    for (let k = 0; k < m; k++) {
      const heFrom = sorted[k];
      const heTo = sorted[(k + 1) % m];
      const dAng = positiveAngleDiff(heFrom.angle, heTo.angle);
      const maxH = Math.max(heFrom.halfW, heTo.halfW);

      let intersection: Vec3 | null = null;
      let usedFallback = false;

      if (dAng > 0.04 && dAng < Math.PI - 0.03) {
        const hit = intersectLinesXZ(
          addV3(node, scaleV3(heFrom.outRight, heFrom.halfW)),
          heFrom.outDir,
          addV3(node, scaleV3(heTo.outLeft, heTo.halfW)),
          heTo.outDir
        );
        if (
          hit &&
          hit.t1 >= -0.05 &&
          hit.t2 >= -0.05 &&
          distXZ(node, hit.point) <= maxCornerDistMult * maxH
        ) {
          intersection = hit.point;
          heFrom.trimDist = Math.max(heFrom.trimDist, heFrom.halfW, hit.t1);
          heTo.trimDist = Math.max(heTo.trimDist, heTo.halfW, hit.t2);
        } else {
          usedFallback = true;
        }
      } else {
        usedFallback = true;
      }

      if (usedFallback) {
        heFrom.trimDist = Math.max(heFrom.trimDist, heFrom.halfW);
        heTo.trimDist = Math.max(heTo.trimDist, heTo.halfW);
      }

      sectors.push({
        heFrom,
        heTo,
        intersection,
        usedFallback,
        perimeterPts: [],
      });
    }

    if (cornerRadius > 0.02) {
      for (const sec of sectors) {
        if (sec.intersection && !sec.usedFallback) {
          const dAng = positiveAngleDiff(sec.heFrom.angle, sec.heTo.angle);
          if (dAng < Math.PI * 0.88) {
            const pFrom = dotXZ(subV3(sec.intersection, node), sec.heFrom.outDir);
            const pTo = dotXZ(subV3(sec.intersection, node), sec.heTo.outDir);
            sec.heFrom.trimDist = Math.max(sec.heFrom.trimDist, pFrom + cornerRadius);
            sec.heTo.trimDist = Math.max(sec.heTo.trimDist, pTo + cornerRadius);
          }
        }
      }
    }

    ctx.junctionMap.set(node.id, {
      node,
      sortedHalfEdges: sorted,
      sectors,
      perimeterRing: [],
    });
  }

  recomputeScaledEndpoints(
    node: RoadNode,
    _halfEdges: HalfEdge[],
    ctx: JointContext
  ): void {
    const jMeta = ctx.junctionMap.get(node.id)!;
    const { cornerRadius } = ctx.options;

    for (const he of jMeta.sortedHalfEdges) {
      const cache = ctx.cacheBySegIdx.get(he.segIdx)!;
      const sample = sampleCacheByS(
        cache,
        he.end === 'a' ? he.trimDist : cache.totalLen - he.trimDist
      );
      he.leftVert = addV3(sample.pos, scaleV3(he.outLeft, he.halfW));
      he.rightVert = addV3(sample.pos, scaleV3(he.outRight, he.halfW));
    }

    const ring: Vec3[] = [];
    for (const sec of jMeta.sectors) {
      const pts: Vec3[] = [sec.heFrom.rightVert];
      if (sec.intersection && !sec.usedFallback) {
        const c = sec.intersection;
        const projFrom = dotXZ(subV3(c, node), sec.heFrom.outDir);
        const projTo = dotXZ(subV3(c, node), sec.heTo.outDir);
        const cValid =
          projFrom <= sec.heFrom.trimDist + 0.05 && projTo <= sec.heTo.trimDist + 0.05;

        if (cValid) {
          const dFrom = Math.max(0, sec.heFrom.trimDist - projFrom);
          const dTo = Math.max(0, sec.heTo.trimDist - projTo);
          const rStep = Math.min(cornerRadius, dFrom, dTo);
          if (rStep > 0.04) {
            const tFrom = addV3(c, scaleV3(sec.heFrom.outDir, rStep));
            const tTo = addV3(c, scaleV3(sec.heTo.outDir, rStep));
            if (distXZ(sec.heFrom.rightVert, tFrom) > 1e-3) pts.push(tFrom);
            for (const u of [0.25, 0.5, 0.75]) {
              pts.push(evalBezier(tFrom, c, tTo, u));
            }
            if (distXZ(tTo, sec.heTo.leftVert) > 1e-3) pts.push(tTo);
          } else {
            pts.push(c);
          }
        }
      }
      pts.push(sec.heTo.leftVert);
      sec.perimeterPts = dedupePointRing(pts, 1e-4);
      ring.push(...sec.perimeterPts);
    }
    jMeta.perimeterRing = dedupePointRing(ring, 1e-4);
  }

  emitJointGeometry(
    node: RoadNode,
    _halfEdges: HalfEdge[],
    ctx: JointContext
  ): void {
    const jMeta = ctx.junctionMap.get(node.id)!;
    const jRingIndices: number[] = [];
    const jCenterU = 0.25;
    const jCenterV = 0.25;
    const { yOffset } = ctx.options;

    for (const he of jMeta.sortedHalfEdges) {
      he.patchLeftIdx = ctx.builder.addVertex(he.leftVert, jCenterU, jCenterV, yOffset);
      he.patchRightIdx = ctx.builder.addVertex(he.rightVert, jCenterU, jCenterV, yOffset);
      ctx.debugTrimPoints.push(he.leftVert, he.rightVert);
    }

    for (const sec of jMeta.sectors) {
      if (sec.intersection) ctx.debugMiterPoints.push(sec.intersection);

      const borderPts: Vec3[] = [sec.heFrom.rightVert];
      jRingIndices.push(sec.heFrom.patchRightIdx);

      if (sec.perimeterPts.length > 2) {
        for (let k = 1; k < sec.perimeterPts.length - 1; k++) {
          const p = sec.perimeterPts[k];
          const vIdx = ctx.builder.addVertex(p, jCenterU, jCenterV, yOffset);
          jRingIndices.push(vIdx);
          borderPts.push(p);
        }
      }
      jRingIndices.push(sec.heTo.patchLeftIdx);
      borderPts.push(sec.heTo.leftVert);

      if (borderPts.length >= 2) {
        ctx.edgePolylines.push(borderPts.map((p) => v3(p.x, p.y + yOffset, p.z)));
      }
    }

    ctx.builder.emitPolygonWithCenterOrEarClip(
      jRingIndices,
      node,
      jCenterU,
      jCenterV,
      yOffset
    );
    ctx.debugJunctionPolygons.push(
      jMeta.perimeterRing.map((p) => v3(p.x, p.y + yOffset, p.z))
    );
  }
}
