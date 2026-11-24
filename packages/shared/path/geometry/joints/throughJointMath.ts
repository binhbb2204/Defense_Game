import type { RoadNode, Vec3 } from '../../../types/protocol';
import {
  addV3,
  distXZ,
  intersectLinesXZ,
  normXZ,
  perpLeftXZ,
  perpRightXZ,
  sampleCacheByS,
  scaleV3,
  subV3,
} from '../math2d';
import type { HalfEdge, JointContext } from '../types';

export function registerCollinearJoint(
  node: RoadNode,
  h0: HalfEdge,
  h1: HalfEdge,
  widthDiff: number,
  ctx: JointContext
): void {
  if (widthDiff < 1e-4) {
    h0.trimDist = 0;
    h1.trimDist = 0;
    const avgDir = normXZ(subV3(h1.outDir, h0.outDir));
    const nLeft = perpLeftXZ(avgDir);
    const nRight = perpRightXZ(avgDir);
    h1.leftVert = addV3(node, scaleV3(nLeft, h1.halfW));
    h1.rightVert = addV3(node, scaleV3(nRight, h1.halfW));
    h0.leftVert = h1.rightVert;
    h0.rightVert = h1.leftVert;
    ctx.degree2Map.set(node.id, {
      kind: 'collinear_equal',
      he0: h0,
      he1: h1,
      outerPts: [],
      innerPt: h1.leftVert,
      outerJoinPt: h1.rightVert,
    });
    return;
  }

  const taper = Math.min(1.6, Math.max(0.45, widthDiff * 1.4));
  h0.trimDist = taper * 0.5;
  h1.trimDist = taper * 0.5;
  ctx.degree2Map.set(node.id, {
    kind: 'collinear_taper',
    he0: h0,
    he1: h1,
    outerPts: [],
    innerPt: node,
    outerJoinPt: null,
  });
}

export function resolveInnerOffsetCorner(
  node: RoadNode,
  h0: HalfEdge,
  h1: HalfEdge,
  h0In: Vec3,
  h1In: Vec3
): { innerPt: Vec3; t0Inner: number; t1Inner: number } {
  const innerHit = intersectLinesXZ(
    addV3(node, scaleV3(h0In, h0.halfW)),
    h0.outDir,
    addV3(node, scaleV3(h1In, h1.halfW)),
    h1.outDir
  );

  let innerPt = innerHit ? innerHit.point : addV3(node, scaleV3(h0In, h0.halfW));
  let t0Inner = innerHit ? Math.max(0, innerHit.t1) : 0;
  let t1Inner = innerHit ? Math.max(0, innerHit.t2) : 0;

  const maxReasonableInner = Math.max(h0.halfW, h1.halfW) * 9.0;
  if (t0Inner > maxReasonableInner || t1Inner > maxReasonableInner) {
    const capScale = maxReasonableInner / Math.max(t0Inner, t1Inner);
    t0Inner *= capScale;
    t1Inner *= capScale;
    innerPt = addV3(
      scaleV3(addV3(addV3(node, scaleV3(h0.outDir, t0Inner)), scaleV3(h0In, h0.halfW)), 0.5),
      scaleV3(addV3(addV3(node, scaleV3(h1.outDir, t1Inner)), scaleV3(h1In, h1.halfW)), 0.5)
    );
  }
  return { innerPt, t0Inner, t1Inner };
}

export function resolveScaledInnerPoint(
  node: RoadNode,
  he0: HalfEdge,
  he1: HalfEdge,
  h0In: Vec3,
  h1In: Vec3,
  ctx: JointContext
): Vec3 {
  const cache0 = ctx.cacheBySegIdx.get(he0.segIdx)!;
  const cache1 = ctx.cacheBySegIdx.get(he1.segIdx)!;
  const s0Center = sampleCacheByS(
    cache0,
    he0.end === 'a' ? he0.trimDist : cache0.totalLen - he0.trimDist
  );
  const s1Center = sampleCacheByS(
    cache1,
    he1.end === 'a' ? he1.trimDist : cache1.totalLen - he1.trimDist
  );

  const end0In = addV3(s0Center.pos, scaleV3(h0In, he0.halfW));
  const end1In = addV3(s1Center.pos, scaleV3(h1In, he1.halfW));
  if (distXZ(end0In, end1In) < 0.05) {
    return scaleV3(addV3(end0In, end1In), 0.5);
  }

  const innerHit = intersectLinesXZ(
    addV3(node, scaleV3(h0In, he0.halfW)),
    he0.outDir,
    addV3(node, scaleV3(h1In, he1.halfW)),
    he1.outDir
  );
  const maxAllowedDist =
    Math.max(he0.trimDist, he1.trimDist) + Math.max(he0.halfW, he1.halfW) * 1.25;
  if (
    innerHit &&
    distXZ(node, innerHit.point) <= maxAllowedDist &&
    innerHit.t1 >= 0 &&
    innerHit.t2 >= 0
  ) {
    return innerHit.point;
  }
  return scaleV3(addV3(end0In, end1In), 0.5);
}

export function buildOuterBevelOrRoundPts(
  node: RoadNode,
  outer0: Vec3,
  outer1: Vec3,
  innerPt: Vec3,
  isRound: boolean,
  roundSegments: number
): Vec3[] {
  const arcPts: Vec3[] = [outer0];
  if (isRound) {
    const ang0 = Math.atan2(outer0.z - node.z, outer0.x - node.x);
    const ang1 = Math.atan2(outer1.z - node.z, outer1.x - node.x);
    const innerAng = Math.atan2(innerPt.z - node.z, innerPt.x - node.x);
    let sweep = ang1 - ang0;
    while (sweep <= -Math.PI) sweep += Math.PI * 2;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    const midCheck = ang0 + sweep * 0.5;
    const diffInner = Math.abs(
      Math.atan2(Math.sin(midCheck - innerAng), Math.cos(midCheck - innerAng))
    );
    if (diffInner < Math.PI * 0.45) {
      sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
    }
    const r0 = distXZ(node, outer0);
    const r1 = distXZ(node, outer1);
    for (let s = 1; s < roundSegments; s++) {
      const u = s / roundSegments;
      const ang = ang0 + sweep * u;
      const r = r0 + (r1 - r0) * u;
      arcPts.push({
        x: node.x + Math.cos(ang) * r,
        y: node.y,
        z: node.z + Math.sin(ang) * r,
      });
    }
  }
  arcPts.push(outer1);
  return arcPts;
}
