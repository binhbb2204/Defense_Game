import type { RoadNode } from '../../types/protocol';
import type { HalfEdge, SegmentCache } from './types';

/**
 * Traces connected degree-2 road chains and closed loops to assign continuous metric UV-v offsets.
 */
export function traceChainUvOffsets(
  nodes: readonly RoadNode[],
  segCaches: readonly SegmentCache[],
  cacheBySegIdx: Map<number, SegmentCache>,
  halfEdgesByNode: Map<string, HalfEdge[]>
): Map<number, { vStart: number; vEnd: number }> {
  const segFlowEndV = new Map<number, { vStart: number; vEnd: number }>();
  const visitedSegs = new Set<number>();
  const getDegree = (nodeId: string) => halfEdgesByNode.get(nodeId)!.length;

  const traceChain = (startSegIdx: number, startFromNodeId: string) => {
    let curSegIdx = startSegIdx;
    let curFromNodeId = startFromNodeId;
    let accumV = 0;

    while (!visitedSegs.has(curSegIdx)) {
      visitedSegs.add(curSegIdx);
      const cache = cacheBySegIdx.get(curSegIdx)!;
      const forwardInSeg = cache.nodeA.id === curFromNodeId;
      const nextNodeId = forwardInSeg ? cache.nodeB.id : cache.nodeA.id;
      const v0 = accumV;
      const v1 = accumV + cache.totalLen;
      segFlowEndV.set(
        curSegIdx,
        forwardInSeg ? { vStart: v0, vEnd: v1 } : { vStart: v1, vEnd: v0 }
      );
      accumV = v1;

      if (getDegree(nextNodeId) !== 2) break;
      const inc = halfEdgesByNode.get(nextNodeId)!;
      const nextHe = inc.find((h) => h.segIdx !== curSegIdx);
      if (!nextHe || visitedSegs.has(nextHe.segIdx)) break;
      curSegIdx = nextHe.segIdx;
      curFromNodeId = nextNodeId;
    }
  };

  for (const node of nodes) {
    if (getDegree(node.id) === 2) continue;
    for (const he of halfEdgesByNode.get(node.id)!) {
      if (!visitedSegs.has(he.segIdx)) {
        traceChain(he.segIdx, node.id);
      }
    }
  }

  for (const cache of segCaches) {
    if (!visitedSegs.has(cache.segIdx)) {
      traceChain(cache.segIdx, cache.nodeA.id);
    }
  }

  return segFlowEndV;
}
