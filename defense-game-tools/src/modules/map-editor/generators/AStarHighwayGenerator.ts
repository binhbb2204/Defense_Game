import { BaseMapGenerator, type DsaAlgorithmMeta } from './BaseMapGenerator';
import { COLS, DIRS, ROWS, inBounds, keyOf, runAStar } from './gridHelpers';

export class AStarHighwayGenerator extends BaseMapGenerator {
  readonly meta: DsaAlgorithmMeta = {
    id: 'astar_highway',
    label: 'A* Search Highway',
    summary:
      'Routes sweeping S-curves through tactical checkpoints using A* + Binary Min-Heap & turn penalties, with overpass & tunnel spans.',
    complexity: 'O(E log V)',
  };

  protected generatePathCells(rng: () => number) {
    const costGrid = new Float32Array(COLS * ROWS);
    for (let i = 0; i < costGrid.length; i++) {
      costGrid[i] = 1 + rng() * 1.6;
    }
    const blocked = new Uint8Array(COLS * ROWS);

    const rStart = 2 + Math.floor(rng() * (ROWS - 4));
    const rEnd = 2 + Math.floor(rng() * (ROWS - 4));
    const cp1r = rStart < ROWS / 2 ? ROWS - 3 - Math.floor(rng() * 3) : 2 + Math.floor(rng() * 3);
    const cp2r = cp1r > ROWS / 2 ? 2 + Math.floor(rng() * 3) : ROWS - 3 - Math.floor(rng() * 3);

    const checkpoints: [number, number][] = [
      [0, rStart],
      [6 + Math.floor(rng() * 3), cp1r],
      [13 + Math.floor(rng() * 3), cp2r],
      [COLS - 1, rEnd],
    ];

    const fullPath: [number, number][] = [];
    for (let s = 0; s < checkpoints.length - 1; s++) {
      const a = checkpoints[s];
      const b = checkpoints[s + 1];
      const seg = runAStar(a, b, costGrid, blocked) ?? runAStar(a, b, costGrid, new Uint8Array(COLS * ROWS));
      if (!seg) continue;

      for (let k = s === 0 ? 0 : 1; k < seg.length; k++) {
        fullPath.push([seg[k][0], seg[k][1]]);
      }
      for (let k = 0; k < seg.length - 2; k++) {
        const [sc, sr] = seg[k];
        blocked[keyOf(sc, sr)] = 1;
        for (const [dc, dr] of DIRS) {
          if (inBounds(sc + dc, sr + dr)) {
            costGrid[keyOf(sc + dc, sr + dr)] += 4.5;
          }
        }
      }
    }
    return { cells: fullPath };
  }
}
