import type { WaypointNode } from '@tactical-td/shared';
import { MinHeap } from './MinHeap';

export { populateObstaclesAndHighGround } from './gridPropPopulator';

export const COLS = 23;
export const ROWS = 17;
export const CELL = 4;
export const HALF_W = ((COLS - 1) * CELL) / 2;
export const HALF_D = ((ROWS - 1) * CELL) / 2;

export const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const keyOf = (c: number, r: number): number => r * COLS + c;

export function inBounds(c: number, r: number): boolean {
  return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}

export function cellToWorld(c: number, r: number): { x: number; z: number } {
  return {
    x: Number((c * CELL - HALF_W).toFixed(1)),
    z: Number((r * CELL - HALF_D).toFixed(1)),
  };
}

export function createRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runAStar(
  start: [number, number],
  goal: [number, number],
  costGrid: Float32Array,
  blocked: Uint8Array,
): [number, number][] | null {
  const total = COLS * ROWS;
  const gScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  const startIdx = keyOf(start[0], start[1]);
  const goalIdx = keyOf(goal[0], goal[1]);

  gScore[startIdx] = 0;
  const heap = new MinHeap<number>();
  heap.push(Math.abs(goal[0] - start[0]) + Math.abs(goal[1] - start[1]), startIdx);

  while (heap.size > 0) {
    const cur = heap.pop()!.value;
    if (cur === goalIdx) {
      const path: [number, number][] = [];
      let p = goalIdx;
      while (p !== -1) {
        path.push([p % COLS, Math.floor(p / COLS)]);
        p = cameFrom[p];
      }
      path.reverse();
      return path;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;

    const cc = cur % COLS;
    const cr = Math.floor(cur / COLS);
    const parent = cameFrom[cur];
    const prevDc = parent !== -1 ? cc - (parent % COLS) : 1;
    const prevDr = parent !== -1 ? cr - Math.floor(parent / COLS) : 0;

    for (const [dc, dr] of DIRS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (!inBounds(nc, nr)) continue;
      const nIdx = keyOf(nc, nr);
      if (closed[nIdx]) continue;
      if (blocked[nIdx] && nIdx !== goalIdx) continue;

      const turnPenalty = dc === prevDc && dr === prevDr ? 0 : 0.45;
      const tentativeG = gScore[cur] + costGrid[nIdx] + turnPenalty;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = cur;
        gScore[nIdx] = tentativeG;
        const h = (Math.abs(goal[0] - nc) + Math.abs(goal[1] - nr)) * 1.05;
        heap.push(tentativeG + h, nIdx);
      }
    }
  }

  return null;
}

export function buildElevationField(rng: () => number): Float32Array {
  const elev = new Float32Array(COLS * ROWS);
  const hills = Array.from({ length: 5 }, () => ({
    cx: 3 + rng() * (COLS - 6),
    cy: 2 + rng() * (ROWS - 4),
    amp: 2.5 + rng() * 4.5,
    radSq: 9 + rng() * 14,
  }));

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let h = 0;
      for (const hill of hills) {
        const d2 = (c - hill.cx) ** 2 + (r - hill.cy) ** 2;
        h += hill.amp * Math.exp(-d2 / hill.radSq);
      }
      elev[keyOf(c, r)] = h;
    }
  }
  return elev;
}

export function pathCellsToWaypoints(
  cells: [number, number][],
  elevation?: Float32Array,
): { waypoints: WaypointNode[]; roadMask: Uint8Array } {
  const roadMask = new Uint8Array(COLS * ROWS);
  for (const [c, r] of cells) {
    roadMask[keyOf(c, r)] = 1;
  }

  const n = cells.length;
  const overpassStart = Math.floor(n * 0.32);
  const overpassEnd = Math.floor(n * 0.48);
  const tunnelStart = Math.floor(n * 0.66);
  const tunnelEnd = Math.floor(n * 0.80);

  const corners: number[] = [0];
  for (let i = 1; i < n - 1; i++) {
    const prev = cells[i - 1];
    const cur = cells[i];
    const next = cells[i + 1];
    const isCorner = cur[0] - prev[0] !== next[0] - cur[0] || cur[1] - prev[1] !== next[1] - cur[1];
    const isSpanBoundary =
      i === overpassStart ||
      i === overpassStart + 2 ||
      i === overpassEnd - 2 ||
      i === overpassEnd ||
      i === tunnelStart ||
      i === tunnelEnd;
    if (isCorner || isSpanBoundary) corners.push(i);
  }
  if (corners[corners.length - 1] !== n - 1) corners.push(n - 1);

  const waypoints: WaypointNode[] = corners.map((idx) => {
    const [c, r] = cells[idx];
    const w = cellToWorld(c, r);
    const inOverpass = idx >= overpassStart && idx <= overpassEnd;
    const inTunnel = idx >= tunnelStart && idx <= tunnelEnd;

    let y = 0;
    if (inOverpass) {
      y = idx === overpassStart || idx === overpassEnd ? 2.1 : 4.6;
    } else if (elevation && !inTunnel) {
      y = Number(Math.min(1.8, elevation[keyOf(c, r)] * 0.2).toFixed(2));
    }

    const wp: WaypointNode = { x: w.x, y, z: w.z, roadWidth: 5.2 };
    if (inOverpass) wp.isOverpass = true;
    if (inTunnel) wp.isTunnel = true;
    return wp;
  });

  return { waypoints, roadMask };
}
