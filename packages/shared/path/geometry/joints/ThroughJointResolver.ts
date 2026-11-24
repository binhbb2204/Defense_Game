import type { RoadNode } from '../../../types/protocol';
import {
  COLLINEAR_DOT_THRESHOLD,
  addV3,
  distSqXZ,
  distXZ,
  dotXZ,
  intersectLinesXZ,
  sampleCacheByS,
  scaleV3,
  v3,
} from '../math2d';
import type { HalfEdge, JointContext } from '../types';
import { BaseJointResolver } from './BaseJointResolver';
import {
  buildOuterBevelOrRoundPts,
  registerCollinearJoint,
  resolveInnerOffsetCorner,
  resolveScaledInnerPoint,
} from './throughJointMath';

export class ThroughJointResolver extends BaseJointResolver {
  canHandle(degree: number): boolean {
    return degree === 2;
  }

  computeRequestedTrims(
    node: RoadNode,
    halfEdges: HalfEdge[],
    ctx: JointContext
  ): void {
    const h0 = halfEdges[0];
    const h1 = halfEdges[1];
    const d0 = h0.outDir;
    const d1 = h1.outDir;
    const dot = Math.max(-1, Math.min(1, dotXZ(d0, d1)));
    const widthDiff = Math.abs(h0.halfW - h1.halfW);

    if (dot <= -COLLINEAR_DOT_THRESHOLD) {
      registerCollinearJoint(node, h0, h1, widthDiff, ctx);
      return;
    }

    const d1OnLeftOf0 = dotXZ(d1, h0.outLeft) >= 0;
    const h0In = d1OnLeftOf0 ? h0.outLeft : h0.outRight;
    const h0Out = d1OnLeftOf0 ? h0.outRight : h0.outLeft;
    const h1In = d1OnLeftOf0 ? h1.outRight : h1.outLeft;
    const h1Out = d1OnLeftOf0 ? h1.outLeft : h1.outRight;

    const { innerPt, t0Inner, t1Inner } = resolveInnerOffsetCorner(node, h0, h1, h0In, h1In);
    const outerHit = intersectLinesXZ(
      addV3(node, scaleV3(h0Out, h0.halfW)),
      d0,
      addV3(node, scaleV3(h1Out, h1.halfW)),
      d1
    );

    const maxH = Math.max(h0.halfW, h1.halfW);
    const outerDist = outerHit ? distXZ(node, outerHit.point) : Infinity;
    const useMiterOuter =
      ctx.options.joinStyle === 'miter' &&
      outerHit !== null &&
      outerDist <= ctx.options.miterLimit * maxH;

    h0.trimDist = Math.max(t0Inner, 0);
    h1.trimDist = Math.max(t1Inner, 0);

    if (useMiterOuter && outerHit) {
      ctx.degree2Map.set(node.id, {
        kind: 'miter',
        he0: h0,
        he1: h1,
        outerPts: [outerHit.point],
        innerPt,
        outerJoinPt: outerHit.point,
      });
    } else {
      const effStyle: 'bevel' | 'round' =
        ctx.options.joinStyle === 'bevel' ? 'bevel' : 'round';
      ctx.degree2Map.set(node.id, {
        kind: effStyle,
        he0: h0,
        he1: h1,
        outerPts: [],
        innerPt,
        outerJoinPt: null,
      });
    }
  }

  recomputeScaledEndpoints(
    node: RoadNode,
    _halfEdges: HalfEdge[],
    ctx: JointContext
  ): void {
    const meta = ctx.degree2Map.get(node.id)!;
    const { he0, he1 } = meta;

    if (meta.kind === 'collinear_equal') return;

    if (meta.kind === 'collinear_taper') {
      const c0 = ctx.cacheBySegIdx.get(he0.segIdx)!;
      const c1 = ctx.cacheBySegIdx.get(he1.segIdx)!;
      const s0 = sampleCacheByS(c0, he0.end === 'a' ? he0.trimDist : c0.totalLen - he0.trimDist);
      const s1 = sampleCacheByS(c1, he1.end === 'a' ? he1.trimDist : c1.totalLen - he1.trimDist);
      he0.leftVert = addV3(s0.pos, scaleV3(he0.outLeft, he0.halfW));
      he0.rightVert = addV3(s0.pos, scaleV3(he0.outRight, he0.halfW));
      he1.leftVert = addV3(s1.pos, scaleV3(he1.outLeft, he1.halfW));
      he1.rightVert = addV3(s1.pos, scaleV3(he1.outRight, he1.halfW));
      meta.outerPts = [he0.rightVert, he1.leftVert];
      return;
    }

    const d1OnLeftOf0 = dotXZ(he1.outDir, he0.outLeft) >= 0;
    const h0In = d1OnLeftOf0 ? he0.outLeft : he0.outRight;
    const h0Out = d1OnLeftOf0 ? he0.outRight : he0.outLeft;
    const h1In = d1OnLeftOf0 ? he1.outRight : he1.outLeft;
    const h1Out = d1OnLeftOf0 ? he1.outLeft : he1.outRight;

    const innerPt = resolveScaledInnerPoint(node, he0, he1, h0In, h1In, ctx);
    meta.innerPt = innerPt;

    const assignCornerVerts = (outerA: typeof innerPt, outerB: typeof innerPt) => {
      if (d1OnLeftOf0) {
        he0.leftVert = innerPt;
        he0.rightVert = outerA;
        he1.leftVert = outerB;
        he1.rightVert = innerPt;
      } else {
        he0.rightVert = innerPt;
        he0.leftVert = outerA;
        he1.rightVert = outerB;
        he1.leftVert = innerPt;
      }
    };

    if (meta.kind === 'miter' && meta.outerJoinPt) {
      assignCornerVerts(meta.outerJoinPt, meta.outerJoinPt);
      meta.outerPts = [meta.outerJoinPt];
      return;
    }

    const outer0 = addV3(node, scaleV3(h0Out, he0.halfW));
    const outer1 = addV3(node, scaleV3(h1Out, he1.halfW));
    assignCornerVerts(outer0, outer1);
    meta.outerPts = buildOuterBevelOrRoundPts(
      node,
      outer0,
      outer1,
      innerPt,
      meta.kind === 'round',
      ctx.options.roundSegments
    );
  }

  emitJointGeometry(
    node: RoadNode,
    _halfEdges: HalfEdge[],
    ctx: JointContext
  ): void {
    const meta = ctx.degree2Map.get(node.id)!;
    const { he0, he1 } = meta;
    const uv0 = ctx.segFlowEndV.get(he0.segIdx)!;
    const uv1 = ctx.segFlowEndV.get(he1.segIdx)!;
    const endV0 = he0.end === 'a' ? uv0.vStart : uv0.vEnd;
    const endV1 = he1.end === 'a' ? uv1.vStart : uv1.vEnd;
    const isLoopClosure = Math.abs(endV0 - endV1) > 1e-3;
    const needsUvSeam = isLoopClosure || he0.end === he1.end;
    const { yOffset, uvVPeriodMeters } = ctx.options;
    const u0L = he0.end === 'a' ? 1 : 0;
    const u0R = he0.end === 'a' ? 0 : 1;
    const u1L = he1.end === 'a' ? 1 : 0;
    const u1R = he1.end === 'a' ? 0 : 1;
    const v0Norm = endV0 / uvVPeriodMeters;
    const v1Norm = endV1 / uvVPeriodMeters;

    if (meta.kind === 'collinear_equal') {
      he0.patchLeftIdx = ctx.builder.addVertex(he0.leftVert, u0L, v0Norm, yOffset);
      he0.patchRightIdx = ctx.builder.addVertex(he0.rightVert, u0R, v0Norm, yOffset);
      if (!needsUvSeam) {
        if (distSqXZ(ctx.builder.getPos(he0.patchLeftIdx), he1.leftVert) <= 1e-6) {
          he1.patchLeftIdx = he0.patchLeftIdx;
          he1.patchRightIdx = he0.patchRightIdx;
        } else {
          he1.patchLeftIdx = he0.patchRightIdx;
          he1.patchRightIdx = he0.patchLeftIdx;
        }
      } else {
        he1.patchLeftIdx = ctx.builder.addVertex(he1.leftVert, u1L, v1Norm, yOffset);
        he1.patchRightIdx = ctx.builder.addVertex(he1.rightVert, u1R, v1Norm, yOffset);
      }
      return;
    }

    if (meta.kind === 'collinear_taper') {
      he0.patchLeftIdx = ctx.builder.addVertex(he0.leftVert, u0L, v0Norm, yOffset);
      he0.patchRightIdx = ctx.builder.addVertex(he0.rightVert, u0R, v0Norm, yOffset);
      he1.patchLeftIdx = ctx.builder.addVertex(he1.leftVert, u1L, v1Norm, yOffset);
      he1.patchRightIdx = ctx.builder.addVertex(he1.rightVert, u1R, v1Norm, yOffset);

      ctx.builder.emitPolygonWithCenterOrEarClip(
        [he0.patchLeftIdx, he0.patchRightIdx, he1.patchLeftIdx, he1.patchRightIdx],
        node,
        0.5,
        (v0Norm + v1Norm) * 0.5,
        yOffset
      );
      ctx.edgePolylines.push(
        [
          v3(he0.leftVert.x, he0.leftVert.y + yOffset, he0.leftVert.z),
          v3(he1.rightVert.x, he1.rightVert.y + yOffset, he1.rightVert.z),
        ],
        [
          v3(he0.rightVert.x, he0.rightVert.y + yOffset, he0.rightVert.z),
          v3(he1.leftVert.x, he1.leftVert.y + yOffset, he1.leftVert.z),
        ]
      );
      ctx.debugTrimPoints.push(he0.leftVert, he0.rightVert, he1.leftVert, he1.rightVert);
      return;
    }

    ctx.debugMiterPoints.push(meta.innerPt);
    if (meta.outerJoinPt) ctx.debugMiterPoints.push(meta.outerJoinPt);

    const midV = (isLoopClosure ? endV0 : (endV0 + endV1) * 0.5) / uvVPeriodMeters;
    const d1OnLeftOf0 = dotXZ(he1.outDir, he0.outLeft) >= 0;

    const assignPatchIndices = (
      in0: number,
      out0: number,
      out1: number,
      in1: number
    ) => {
      if (d1OnLeftOf0) {
        he0.patchLeftIdx = in0;
        he0.patchRightIdx = out0;
        he1.patchLeftIdx = out1;
        he1.patchRightIdx = in1;
      } else {
        he0.patchRightIdx = in0;
        he0.patchLeftIdx = out0;
        he1.patchRightIdx = out1;
        he1.patchLeftIdx = in1;
      }
    };

    if (meta.kind === 'miter' && meta.outerPts.length === 1 && !needsUvSeam) {
      const innerIdx = ctx.builder.addVertex(meta.innerPt, d1OnLeftOf0 ? u0L : u0R, midV, yOffset);
      const outerIdx = ctx.builder.addVertex(meta.outerPts[0], d1OnLeftOf0 ? u0R : u0L, midV, yOffset);
      assignPatchIndices(innerIdx, outerIdx, outerIdx, innerIdx);
      ctx.debugTrimPoints.push(meta.innerPt, meta.outerPts[0]);
      return;
    }

    const outerPts = meta.outerPts;
    const vArcEnd = isLoopClosure ? v0Norm : v1Norm;
    const outerU0 = d1OnLeftOf0 ? u0R : u0L;
    const innerU0 = d1OnLeftOf0 ? u0L : u0R;
    const outerU1 = d1OnLeftOf0 ? u1L : u1R;
    const innerU1 = d1OnLeftOf0 ? u1R : u1L;

    const innerPatchIdx = ctx.builder.addVertex(meta.innerPt, innerU0, v0Norm, yOffset);
    const outerFirstIdx = ctx.builder.addVertex(outerPts[0], outerU0, v0Norm, yOffset);
    const outerLastPos = outerPts[outerPts.length - 1];
    const outerLastPatchIdx =
      outerPts.length === 1
        ? outerFirstIdx
        : ctx.builder.addVertex(outerLastPos, outerU0, vArcEnd, yOffset);

    const outerLastSegIdx = !needsUvSeam
      ? outerLastPatchIdx
      : ctx.builder.addVertex(outerLastPos, outerU1, v1Norm, yOffset);
    const innerSeg1Idx = !needsUvSeam
      ? innerPatchIdx
      : ctx.builder.addVertex(meta.innerPt, innerU1, v1Norm, yOffset);

    assignPatchIndices(innerPatchIdx, outerFirstIdx, outerLastSegIdx, innerSeg1Idx);

    if (outerPts.length >= 2) {
      const arcIndices: number[] = [outerFirstIdx];
      for (let k = 1; k < outerPts.length - 1; k++) {
        const frac = k / (outerPts.length - 1);
        arcIndices.push(
          ctx.builder.addVertex(outerPts[k], outerU0, v0Norm + (vArcEnd - v0Norm) * frac, yOffset)
        );
      }
      arcIndices.push(outerLastPatchIdx);

      ctx.builder.emitPolygonWithCenterOrEarClip(
        [innerPatchIdx, ...arcIndices],
        node,
        0.5,
        (v0Norm + vArcEnd) * 0.5,
        yOffset
      );

      ctx.edgePolylines.push(outerPts.map((p) => v3(p.x, p.y + yOffset, p.z)));
      ctx.debugJunctionPolygons.push(
        [meta.innerPt, ...outerPts].map((p) => v3(p.x, p.y + yOffset, p.z))
      );
    }
    ctx.debugTrimPoints.push(meta.innerPt, outerPts[0], outerPts[outerPts.length - 1]);
  }
}
