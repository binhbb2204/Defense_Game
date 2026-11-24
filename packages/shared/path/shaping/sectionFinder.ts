import type { RoadNode, RoadSegment } from '../../types/protocol';
import { sampleCenterline } from './centerline';
import type { FindSectionResult, RoadSection } from './types';

function measureChainLength(
  nodeIds: readonly string[],
  segmentIds: readonly string[],
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
): number {
  const samples = sampleCenterline({ nodeIds, segmentIds, nodes, segments }, 2.0, (8 * Math.PI) / 180);
  return samples.length > 0 ? samples[samples.length - 1]!.s : 0;
}

/**
 * Finds degree-2 road chains between `startNodeId` and `endNodeId`.
 * Endpoints may have any degree (1, 2, or 3+); all interior nodes must have degree 2.
 * Returns candidate chains sorted by shortest centerline length and selects the matching `viaNodeId` chain when supplied.
 */
export function findSection(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  startNodeId: string,
  endNodeId: string,
  viaNodeId?: string,
): FindSectionResult {
  if (startNodeId === endNodeId) {
    return { section: null, alternatives: [], warning: 'Start and end node must be different.' };
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  if (!nodeMap.has(startNodeId) || !nodeMap.has(endNodeId)) {
    return { section: null, alternatives: [], warning: 'Start or end node does not exist.' };
  }

  const adj = new Map<string, Array<{ nextId: string; segId: string }>>();
  for (const n of nodes) adj.set(n.id, []);
  for (const s of segments) {
    if (!nodeMap.has(s.a) || !nodeMap.has(s.b)) continue;
    adj.get(s.a)!.push({ nextId: s.b, segId: s.id });
    adj.get(s.b)!.push({ nextId: s.a, segId: s.id });
  }

  const degreeOf = (id: string) => (adj.get(id) ?? []).length;
  const alternatives: RoadSection[] = [];
  const visited = new Set<string>([startNodeId]);
  const curNodes: string[] = [startNodeId];
  const curSegs: string[] = [];

  const dfs = (curId: string) => {
    if (alternatives.length >= 12) return;
    for (const edge of adj.get(curId) ?? []) {
      if (visited.has(edge.nextId)) continue;
      if (edge.nextId === endNodeId) {
        const nodeIds = [...curNodes, edge.nextId];
        const segmentIds = [...curSegs, edge.segId];
        const interiorSpecialNodeIds = nodeIds
          .slice(1, -1)
          .filter((id) => {
            const role = nodeMap.get(id)?.role;
            return role === 'spawn' || role === 'base';
          });
        alternatives.push({
          startNodeId,
          endNodeId,
          nodeIds,
          segmentIds,
          length: measureChainLength(nodeIds, segmentIds, nodes, segments),
          hasInteriorSpawnOrBase: interiorSpecialNodeIds.length > 0,
          interiorSpecialNodeIds,
        });
        continue;
      }

      // Interior nodes must strictly have degree 2 (no junctions in middle of section)
      if (degreeOf(edge.nextId) !== 2) continue;

      visited.add(edge.nextId);
      curNodes.push(edge.nextId);
      curSegs.push(edge.segId);
      dfs(edge.nextId);
      curSegs.pop();
      curNodes.pop();
      visited.delete(edge.nextId);
    }
  };

  dfs(startNodeId);
  alternatives.sort((a, b) => a.length - b.length);

  if (alternatives.length > 0) {
    const picked = viaNodeId
      ? alternatives.find((alt) => alt.nodeIds.includes(viaNodeId)) ?? alternatives[0]!
      : alternatives[0]!;
    return { section: picked, alternatives };
  }

  // Check if reachable only by passing through an interior degree 3+ junction
  const bfsSeen = new Set<string>([startNodeId]);
  const queue: string[] = [startNodeId];
  let head = 0;
  let reachableViaJunction = false;
  while (head < queue.length) {
    const u = queue[head++]!;
    for (const e of adj.get(u) ?? []) {
      if (e.nextId === endNodeId) {
        reachableViaJunction = true;
        break;
      }
      if (!bfsSeen.has(e.nextId)) {
        bfsSeen.add(e.nextId);
        queue.push(e.nextId);
      }
    }
    if (reachableViaJunction) break;
  }

  return {
    section: null,
    alternatives: [],
    warning: reachableViaJunction
      ? 'Section crosses a junction (degree 3+ interior node). End at the junction instead.'
      : 'No connected road chain between start and end node.',
  };
}
