import { BaseMapGenerator, type DsaAlgorithmMeta } from './BaseMapGenerator';
import { COLS, DIRS, ROWS, keyOf } from './gridHelpers';

export class DfsCanyonGenerator extends BaseMapGenerator {
  readonly meta: DsaAlgorithmMeta = {
    id: 'dfs_canyon',
    label: 'Randomized DFS + BFS Path',
    summary:
      'Carves a winding canyon spanning tree via Randomized Depth-First Search, then extracts the longest West->East path using BFS.',
    complexity: 'O(V + E)',
  };

  protected generatePathCells(rng: () => number) {
    const visited = new Uint8Array(COLS * ROWS);
    const adj = Array.from({ length: COLS * ROWS }, () => [] as number[]);

    const startR = 1 + 2 * Math.floor(rng() * Math.floor((ROWS - 2) / 2));
    const startCell = keyOf(1, startR);
    const stack: number[] = [startCell];
    visited[startCell] = 1;

    while (stack.length > 0) {
      const cur = stack[stack.length - 1];
      const cc = cur % COLS;
      const cr = Math.floor(cur / COLS);

      const neighbors: [number, number, number, number][] = [];
      for (const [dc, dr] of DIRS) {
        const nc = cc + dc * 2;
        const nr = cr + dr * 2;
        if (nc >= 1 && nc < COLS - 1 && nr >= 1 && nr < ROWS - 1 && !visited[keyOf(nc, nr)]) {
          neighbors.push([nc, nr, cc + dc, cr + dr]);
        }
      }

      if (neighbors.length === 0) {
        stack.pop();
        continue;
      }

      const [nc, nr, mc, mr] = neighbors[Math.floor(rng() * neighbors.length)];
      const midIdx = keyOf(mc, mr);
      const nextIdx = keyOf(nc, nr);

      visited[midIdx] = 1;
      visited[nextIdx] = 1;
      adj[cur].push(midIdx);
      adj[midIdx].push(cur, nextIdx);
      adj[nextIdx].push(midIdx);
      stack.push(nextIdx);
    }

    const dist = new Int32Array(COLS * ROWS).fill(-1);
    const parent = new Int32Array(COLS * ROWS).fill(-1);
    const queue: number[] = [startCell];
    dist[startCell] = 0;

    let bestEastCell = startCell;
    let bestDist = -1;
    let head = 0;

    while (head < queue.length) {
      const cur = queue[head++];
      if (cur % COLS === COLS - 2 && dist[cur] > bestDist) {
        bestDist = dist[cur];
        bestEastCell = cur;
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
    const treePath: [number, number][] = [];
    let p = bestEastCell;
    while (p !== -1) {
      treePath.push([p % COLS, Math.floor(p / COLS)]);
      p = parent[p];
    }
    treePath.reverse();
    path.push(...treePath);
    const exitR = treePath[treePath.length - 1]?.[1] ?? startR;
    path.push([COLS - 1, exitR]);
    return { cells: path };
  }
}
