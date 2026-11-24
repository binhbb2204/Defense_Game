import { BaseMapGenerator, type DsaAlgorithmMeta } from './BaseMapGenerator';
import { MinHeap } from './MinHeap';
import { COLS, DIRS, ROWS, keyOf } from './gridHelpers';

export class PrimMstGenerator extends BaseMapGenerator {
  readonly meta: DsaAlgorithmMeta = {
    id: 'prim_mst',
    label: "Prim's MST + BFS Distance Field",
    summary:
      "Constructs a minimum spanning tree via Prim's Algorithm + Binary Heap, then places LoS chokes & sniper rooftops via Multi-Source BFS.",
    complexity: 'O(E log V)',
  };

  protected generatePathCells(rng: () => number) {
    const oddCols = Math.floor((COLS - 2) / 2);
    const oddRows = Math.floor((ROWS - 2) / 2);
    const inTree = new Uint8Array(COLS * ROWS);
    const adj = Array.from({ length: COLS * ROWS }, () => [] as number[]);

    const startR = 1 + 2 * Math.floor(rng() * oddRows);
    const startCell = keyOf(1, startR);
    inTree[startCell] = 1;

    const heap = new MinHeap<{ from: number; mid: number; to: number }>();
    const pushFrontier = (u: number) => {
      const uc = u % COLS;
      const ur = Math.floor(u / COLS);
      for (const [dc, dr] of DIRS) {
        const vc = uc + dc * 2;
        const vr = ur + dr * 2;
        if (vc >= 1 && vc < COLS - 1 && vr >= 1 && vr < ROWS - 1) {
          const v = keyOf(vc, vr);
          if (!inTree[v]) {
            heap.push(rng(), { from: u, mid: keyOf(uc + dc, ur + dr), to: v });
          }
        }
      }
    };
    pushFrontier(startCell);

    while (heap.size > 0) {
      const edge = heap.pop()!.value;
      if (inTree[edge.to]) continue;
      inTree[edge.mid] = 1;
      inTree[edge.to] = 1;
      adj[edge.from].push(edge.mid);
      adj[edge.mid].push(edge.from, edge.to);
      adj[edge.to].push(edge.mid);
      pushFrontier(edge.to);
    }

    const eastCol = 1 + 2 * (oddCols - 1);
    const dist = new Int32Array(COLS * ROWS).fill(-1);
    const parent = new Int32Array(COLS * ROWS).fill(-1);
    const queue: number[] = [startCell];
    dist[startCell] = 0;

    let bestEast = startCell;
    let bestDist = -1;
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      if (cur % COLS === eastCol && dist[cur] > bestDist) {
        bestDist = dist[cur];
        bestEast = cur;
      }
      for (const nxt of adj[cur]) {
        if (dist[nxt] === -1) {
          dist[nxt] = dist[cur] + 1;
          parent[nxt] = cur;
          queue.push(nxt);
        }
      }
    }

    const path: [number, number][] = [[0, startR]];
    const trunk: [number, number][] = [];
    let p = bestEast;
    while (p !== -1) {
      trunk.push([p % COLS, Math.floor(p / COLS)]);
      p = parent[p];
    }
    trunk.reverse();
    path.push(...trunk);
    const exitR = trunk[trunk.length - 1]?.[1] ?? startR;
    for (let c = eastCol + 1; c < COLS; c++) {
      path.push([c, exitR]);
    }
    return { cells: path };
  }
}
