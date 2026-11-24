import { BaseMapGenerator, type DsaAlgorithmMeta } from './BaseMapGenerator';
import { MinHeap } from './MinHeap';
import { buildElevationField, COLS, DIRS, ROWS, inBounds, keyOf } from './gridHelpers';

export class DijkstraContourGenerator extends BaseMapGenerator {
  readonly meta: DsaAlgorithmMeta = {
    id: 'dijkstra_contour',
    label: 'Dijkstra Elevation Contour',
    summary:
      'Builds a synthetic terrain heightfield and runs Dijkstra shortest-path through valleys, elevating ridge crossings into bridges & tunnels.',
    complexity: 'O(E log V)',
  };

  protected generatePathCells(rng: () => number) {
    const elevation = buildElevationField(rng);
    const total = COLS * ROWS;
    const dist = new Float32Array(total).fill(Infinity);
    const prev = new Int32Array(total).fill(-1);
    const visited = new Uint8Array(total);

    const startR = 3 + Math.floor(rng() * (ROWS - 6));
    const goalR = 3 + Math.floor(rng() * (ROWS - 6));
    const startIdx = keyOf(0, startR);
    const goalIdx = keyOf(COLS - 1, goalR);

    dist[startIdx] = 0;
    const heap = new MinHeap<number>();
    heap.push(0, startIdx);

    while (heap.size > 0) {
      const cur = heap.pop()!.value;
      if (cur === goalIdx) break;
      if (visited[cur]) continue;
      visited[cur] = 1;

      const cc = cur % COLS;
      const cr = Math.floor(cur / COLS);
      const curH = elevation[cur];

      for (const [dc, dr] of DIRS) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (!inBounds(nc, nr)) continue;
        const nIdx = keyOf(nc, nr);
        if (visited[nIdx]) continue;

        const climb = Math.abs(elevation[nIdx] - curH);
        const edgeCost = 1 + elevation[nIdx] * 0.65 + climb * 1.4;
        if (dist[cur] + edgeCost < dist[nIdx]) {
          dist[nIdx] = dist[cur] + edgeCost;
          prev[nIdx] = cur;
          heap.push(dist[nIdx], nIdx);
        }
      }
    }

    const path: [number, number][] = [];
    let p = goalIdx;
    while (p !== -1) {
      path.push([p % COLS, Math.floor(p / COLS)]);
      p = prev[p];
    }
    path.reverse();
    return { cells: path, elevation };
  }
}
