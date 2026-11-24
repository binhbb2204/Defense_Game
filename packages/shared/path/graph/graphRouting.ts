import type { RoadNode, RoadSegment } from '../../types/protocol';

export interface RoadComponent {
  id: string;
  index: number;
  nodeIds: string[];
  segmentIds: string[];
  spawnIds: string[];
  baseIds: string[];
}

export interface RoadRoute {
  spawnId: string;
  baseId: string;
  nodeIds: string[];
  segmentIds: string[];
  probability: number;
}

/** Computes connected road networks from the graph (used by Scene Explorer tree & validation). */
export function connectedComponents(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
): RoadComponent[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, Array<{ neighborId: string; segmentId: string }>>();
  for (const n of nodes) adj.set(n.id, []);
  for (const seg of segments) {
    if (!nodeMap.has(seg.a) || !nodeMap.has(seg.b)) continue;
    adj.get(seg.a)!.push({ neighborId: seg.b, segmentId: seg.id });
    adj.get(seg.b)!.push({ neighborId: seg.a, segmentId: seg.id });
  }

  const visited = new Set<string>();
  const components: RoadComponent[] = [];

  for (const startNode of nodes) {
    if (visited.has(startNode.id)) continue;
    const queue = [startNode.id];
    visited.add(startNode.id);

    const compNodeIds: string[] = [];
    const compSegSet = new Set<string>();
    const spawnIds: string[] = [];
    const baseIds: string[] = [];

    let head = 0;
    while (head < queue.length) {
      const curId = queue[head++]!;
      const node = nodeMap.get(curId)!;
      compNodeIds.push(curId);
      if (node.role === 'spawn') spawnIds.push(curId);
      if (node.role === 'base') baseIds.push(curId);

      for (const edge of adj.get(curId) ?? []) {
        compSegSet.add(edge.segmentId);
        if (!visited.has(edge.neighborId)) {
          visited.add(edge.neighborId);
          queue.push(edge.neighborId);
        }
      }
    }

    const index = components.length;
    components.push({
      id: `net_${index + 1}`,
      index,
      nodeIds: compNodeIds,
      segmentIds: Array.from(compSegSet),
      spawnIds,
      baseIds,
    });
  }

  return components;
}

/**
 * Enumerates simple routes from every `spawn` node to any `base` node in the road graph.
 * Computes normalized branching split probabilities using `segment.weight ?? 1`.
 */
export function findRoutes(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
  maxRoutesPerSpawn = 16,
): RoadRoute[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const baseSet = new Set(nodes.filter((n) => n.role === 'base').map((n) => n.id));
  const spawns = nodes.filter((n) => n.role === 'spawn');
  if (baseSet.size === 0 || spawns.length === 0) return [];

  const adj = new Map<string, Array<{ nextId: string; segment: RoadSegment }>>();
  const revAdj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
    revAdj.set(n.id, []);
  }
  for (const s of segments) {
    if (!nodeMap.has(s.a) || !nodeMap.has(s.b)) continue;
    adj.get(s.a)!.push({ nextId: s.b, segment: s });
    revAdj.get(s.b)!.push(s.a);
    if (!s.oneWay) {
      adj.get(s.b)!.push({ nextId: s.a, segment: s });
      revAdj.get(s.a)!.push(s.b);
    }
  }

  const distToBase = new Map<string, number>();
  const bfsQueue: string[] = [];
  for (const bId of baseSet) {
    distToBase.set(bId, 0);
    bfsQueue.push(bId);
  }
  let head = 0;
  while (head < bfsQueue.length) {
    const cur = bfsQueue[head++]!;
    const d = distToBase.get(cur)!;
    for (const prevId of revAdj.get(cur) ?? []) {
      if (!distToBase.has(prevId)) {
        distToBase.set(prevId, d + 1);
        bfsQueue.push(prevId);
      }
    }
  }

  const canReachBase = (startId: string, visited: Set<string>): boolean => {
    if (baseSet.has(startId)) return true;
    const seen = new Set(visited);
    seen.add(startId);
    const q = [startId];
    let h = 0;
    while (h < q.length) {
      const c = q[h++]!;
      for (const edge of adj.get(c) ?? []) {
        if (seen.has(edge.nextId)) continue;
        if (baseSet.has(edge.nextId)) return true;
        seen.add(edge.nextId);
        q.push(edge.nextId);
      }
    }
    return false;
  };

  const routes: RoadRoute[] = [];

  for (const sp of spawns) {
    let emitted = 0;
    const pathNodes: string[] = [sp.id];
    const pathSegs: string[] = [];
    const visited = new Set<string>([sp.id]);

    const dfs = (curId: string, prob: number) => {
      if (emitted >= maxRoutesPerSpawn) return;
      if (baseSet.has(curId) && pathNodes.length >= 2) {
        routes.push({
          spawnId: sp.id,
          baseId: curId,
          nodeIds: [...pathNodes],
          segmentIds: [...pathSegs],
          probability: prob,
        });
        emitted++;
        return;
      }

      const candidates = (adj.get(curId) ?? []).filter(
        (e) =>
          !visited.has(e.nextId) &&
          distToBase.has(e.nextId) &&
          canReachBase(e.nextId, visited),
      );
      if (candidates.length === 0) return;

      const totalW = candidates.reduce((acc, e) => acc + Math.max(0.01, e.segment.weight ?? 1), 0);

      for (const edge of candidates) {
        if (emitted >= maxRoutesPerSpawn) break;
        const branchProb = Math.max(0.01, edge.segment.weight ?? 1) / totalW;
        visited.add(edge.nextId);
        pathNodes.push(edge.nextId);
        pathSegs.push(edge.segment.id);
        dfs(edge.nextId, prob * branchProb);
        pathSegs.pop();
        pathNodes.pop();
        visited.delete(edge.nextId);
      }
    };

    dfs(sp.id, 1);
  }

  return routes;
}

/**
 * Computes flow direction (`1` = `a -> b`, `-1` = `b -> a`) per segment so viewport arrows
 * point consistently from Spawn toward Base across multi-branch graphs.
 */
export function computeSegmentFlowDirections(
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
): Map<string, 1 | -1> {
  const dirs = new Map<string, 1 | -1>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const s of segments) {
    if (!nodeMap.has(s.a) || !nodeMap.has(s.b)) continue;
    adj.get(s.a)!.push(s.b);
    adj.get(s.b)!.push(s.a);
  }

  const bfsFrom = (starts: string[]) => {
    const dist = new Map<string, number>();
    const q: string[] = [];
    for (const id of starts) {
      dist.set(id, 0);
      q.push(id);
    }
    let head = 0;
    while (head < q.length) {
      const u = q[head++]!;
      const d = dist.get(u)!;
      for (const v of adj.get(u) ?? []) {
        if (!dist.has(v)) {
          dist.set(v, d + 1);
          q.push(v);
        }
      }
    }
    return dist;
  };

  const toBase = bfsFrom(nodes.filter((n) => n.role === 'base').map((n) => n.id));
  const fromSpawn = bfsFrom(nodes.filter((n) => n.role === 'spawn').map((n) => n.id));

  for (const seg of segments) {
    if (seg.oneWay) {
      dirs.set(seg.id, 1);
      continue;
    }
    const dA = toBase.get(seg.a);
    const dB = toBase.get(seg.b);
    if (dA !== undefined && dB !== undefined && dA !== dB) {
      dirs.set(seg.id, dB < dA ? 1 : -1);
      continue;
    }
    const sA = fromSpawn.get(seg.a);
    const sB = fromSpawn.get(seg.b);
    if (sA !== undefined && sB !== undefined && sA !== sB) {
      dirs.set(seg.id, sA < sB ? 1 : -1);
      continue;
    }
    dirs.set(seg.id, 1);
  }

  return dirs;
}
