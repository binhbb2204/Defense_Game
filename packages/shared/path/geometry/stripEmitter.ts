import type { Vec3 } from '../../types/protocol';
import {
  addV3,
  dotXZ,
  normXZ,
  perpLeftXZ,
  perpRightXZ,
  sampleCacheByS,
  scaleV3,
  subV3,
  v3,
} from './math2d';
import type {
  HalfEdge,
  IMeshBuilder,
  ResolvedRoadGeometryOptions,
  RoadArrowStrip,
  SegmentCache,
} from './types';

export interface StripEmissionOutput {
  centrelines: Vec3[][];
  offsetEdges: Array<{ segmentId: string; left: Vec3[]; right: Vec3[] }>;
  segmentTrimDistances: Record<string, { startTrim: number; endTrim: number; length: number }>;
  arrowStrips: RoadArrowStrip[];
}

export function emitSegmentStripsAndArrows(
  segCaches: readonly SegmentCache[],
  halfEdgePairBySeg: Map<number, { a: HalfEdge; b: HalfEdge }>,
  halfEdgesByNode: Map<string, HalfEdge[]>,
  segFlowEndV: Map<number, { vStart: number; vEnd: number }>,
  builder: IMeshBuilder,
  edgePolylines: Vec3[][],
  options: ResolvedRoadGeometryOptions
): StripEmissionOutput {
  const {
    yOffset,
    uvVPeriodMeters,
    curveSubdivisions,
    arrowLength,
    arrowSpacing,
    arrowWidthRatio,
  } = options;

  const getDegree = (nodeId: string) => halfEdgesByNode.get(nodeId)!.length;
  const centrelines: Vec3[][] = [];
  const offsetEdges: Array<{ segmentId: string; left: Vec3[]; right: Vec3[] }> = [];
  const segmentTrimDistances: Record<
    string,
    { startTrim: number; endTrim: number; length: number }
  > = {};
  const arrowStrips: RoadArrowStrip[] = [];

  for (const cache of segCaches) {
    const pair = halfEdgePairBySeg.get(cache.segIdx)!;
    const heA = pair.a;
    const heB = pair.b;
    const uvInfo = segFlowEndV.get(cache.segIdx)!;

    const startTrim = heA.trimDist;
    const endTrim = heB.trimDist;
    const len = cache.totalLen;
    segmentTrimDistances[cache.seg.id] = { startTrim, endTrim, length: len };

    const rawPts: Vec3[] = [];
    const rawLeft: Vec3[] = [];
    const rawRight: Vec3[] = [];
    const dbgSteps = cache.isCurved ? Math.min(24, Math.max(8, cache.lut.length - 1)) : 1;
    for (let k = 0; k <= dbgSteps; k++) {
      const s = (k / dbgSteps) * len;
      const smp = sampleCacheByS(cache, s);
      const lft = perpLeftXZ(smp.tangent);
      const rgt = perpRightXZ(smp.tangent);
      rawPts.push(v3(smp.pos.x, smp.pos.y + yOffset + 0.03, smp.pos.z));
      rawLeft.push(
        v3(smp.pos.x + lft.x * cache.halfW, smp.pos.y + yOffset + 0.03, smp.pos.z + lft.z * cache.halfW)
      );
      rawRight.push(
        v3(smp.pos.x + rgt.x * cache.halfW, smp.pos.y + yOffset + 0.03, smp.pos.z + rgt.z * cache.halfW)
      );
    }
    centrelines.push(rawPts);
    offsetEdges.push({ segmentId: cache.seg.id, left: rawLeft, right: rawRight });

    const s0 = startTrim;
    const s1 = Math.max(s0, len - endTrim);
    const uvDir = uvInfo.vEnd >= uvInfo.vStart ? 1 : -1;
    const sToV = (s: number) => (uvInfo.vStart + uvDir * s) / uvVPeriodMeters;

    const startIsDeg3 = getDegree(heA.nodeId) >= 3;
    const startIdxL =
      !startIsDeg3 && heA.patchLeftIdx >= 0
        ? heA.patchLeftIdx
        : builder.addVertex(heA.leftVert, 1, sToV(s0), yOffset);
    const startIdxR =
      !startIsDeg3 && heA.patchRightIdx >= 0
        ? heA.patchRightIdx
        : builder.addVertex(heA.rightVert, 0, sToV(s0), yOffset);

    const endIsDeg3 = getDegree(heB.nodeId) >= 3;
    const endIdxL =
      !endIsDeg3 && heB.patchRightIdx >= 0
        ? heB.patchRightIdx
        : builder.addVertex(heB.rightVert, 1, sToV(s1), yOffset);
    const endIdxR =
      !endIsDeg3 && heB.patchLeftIdx >= 0
        ? heB.patchLeftIdx
        : builder.addVertex(heB.leftVert, 0, sToV(s1), yOffset);

    const leftBorderPts: Vec3[] = [
      v3(heA.leftVert.x, heA.leftVert.y + yOffset, heA.leftVert.z),
    ];
    const rightBorderPts: Vec3[] = [
      v3(heA.rightVert.x, heA.rightVert.y + yOffset, heA.rightVert.z),
    ];

    if (!cache.isCurved) {
      builder.emitTriUp(startIdxL, startIdxR, endIdxR);
      builder.emitTriUp(startIdxL, endIdxR, endIdxL);
      leftBorderPts.push(v3(heB.rightVert.x, heB.rightVert.y + yOffset, heB.rightVert.z));
      rightBorderPts.push(v3(heB.leftVert.x, heB.leftVert.y + yOffset, heB.leftVert.z));
    } else {
      const minClearStart = Math.max(
        s0,
        dotXZ(subV3(heA.leftVert, cache.nodeA), cache.outDirA) + 0.15,
        dotXZ(subV3(heA.rightVert, cache.nodeA), cache.outDirA) + 0.15
      );
      const minClearEnd = Math.min(
        s1,
        len - Math.max(0, dotXZ(subV3(heB.leftVert, cache.nodeB), cache.outDirB) + 0.15),
        len - Math.max(0, dotXZ(subV3(heB.rightVert, cache.nodeB), cache.outDirB) + 0.15)
      );

      // Build interior polyline samples directly from sampleCenterline LUT with through-sample miter joins
      const polySamples: Array<{ s: number; pos: Vec3 }> = [];
      if (minClearEnd > minClearStart + 0.25) {
        const minGap = Math.max(0.15, (minClearEnd - minClearStart) / Math.max(8, curveSubdivisions));
        for (const e of cache.lut) {
          if (e.s > minClearStart + 0.05 && e.s < minClearEnd - 0.05) {
            if (polySamples.length === 0 || e.s - polySamples[polySamples.length - 1]!.s >= minGap) {
              polySamples.push({ s: e.s, pos: e.pos });
            }
          }
        }
      }

      const rows: Array<{ lIdx: number; rIdx: number }> = [
        { lIdx: startIdxL, rIdx: startIdxR },
      ];

      for (let idx = 0; idx < polySamples.length; idx++) {
        const cur = polySamples[idx]!;
        const d0 =
          idx > 0 ? normXZ(subV3(cur.pos, polySamples[idx - 1]!.pos)) : cache.outDirA;
        const d1 =
          idx < polySamples.length - 1
            ? normXZ(subV3(polySamples[idx + 1]!.pos, cur.pos))
            : { x: -cache.outDirB.x, y: 0, z: -cache.outDirB.z };
        const n0 = perpLeftXZ(d0);
        const n1 = perpLeftXZ(d1);
        const m = normXZ(addV3(n0, n1));
        const mLen = cache.halfW / Math.max(0.55, dotXZ(m, n0));
        const lPos = addV3(cur.pos, scaleV3(m, mLen));
        const rPos = addV3(cur.pos, scaleV3(m, -mLen));
        const vCoord = sToV(cur.s);
        rows.push({
          lIdx: builder.addVertex(lPos, 1, vCoord, yOffset),
          rIdx: builder.addVertex(rPos, 0, vCoord, yOffset),
        });
        leftBorderPts.push(v3(lPos.x, lPos.y + yOffset, lPos.z));
        rightBorderPts.push(v3(rPos.x, rPos.y + yOffset, rPos.z));
      }

      rows.push({ lIdx: endIdxL, rIdx: endIdxR });
      leftBorderPts.push(v3(heB.rightVert.x, heB.rightVert.y + yOffset, heB.rightVert.z));
      rightBorderPts.push(v3(heB.leftVert.x, heB.leftVert.y + yOffset, heB.leftVert.z));

      for (let r = 0; r < rows.length - 1; r++) {
        const cur = rows[r]!;
        const nxt = rows[r + 1]!;
        builder.emitTriUp(cur.lIdx, cur.rIdx, nxt.rIdx);
        builder.emitTriUp(cur.lIdx, nxt.rIdx, nxt.lIdx);
      }
    }

    edgePolylines.push(leftBorderPts, rightBorderPts);

    const drawableLen = s1 - s0;
    if (drawableLen >= arrowLength * 0.75) {
      const margin = Math.min(drawableLen * 0.25, Math.max(0.6, arrowLength * 0.6));
      const usableStart = s0 + margin;
      const usableEnd = s1 - margin;
      const usableSpan = Math.max(0, usableEnd - usableStart);
      const count = Math.max(1, Math.floor(usableSpan / arrowSpacing) + 1);
      const step = count > 1 ? usableSpan / (count - 1) : 0;

      for (let k = 0; k < count; k++) {
        const sPos = count === 1 ? (usableStart + usableEnd) * 0.5 : usableStart + k * step;
        const smp = sampleCacheByS(cache, sPos);
        const dir =
          cache.flowSign === 1
            ? smp.tangent
            : v3(-smp.tangent.x, 0, -smp.tangent.z);
        arrowStrips.push({
          segmentId: cache.seg.id,
          position: v3(smp.pos.x, smp.pos.y + yOffset + 0.014, smp.pos.z),
          direction: dir,
          width: Math.min(2.0, cache.halfW * 2 * arrowWidthRatio),
          length: arrowLength,
        });
      }
    }
  }

  return { centrelines, offsetEdges, segmentTrimDistances, arrowStrips };
}
