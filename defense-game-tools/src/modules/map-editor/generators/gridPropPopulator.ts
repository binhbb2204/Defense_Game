import type { ElevatedZone, MapObstacle, WaypointNode } from '@tactical-td/shared';
import { COLS, DIRS, ROWS, cellToWorld, inBounds, keyOf } from './gridHelpers';

export function populateObstaclesAndHighGround(
  roadMask: Uint8Array,
  waypoints: WaypointNode[],
  density: number,
  rng: () => number,
): { obstacles: MapObstacle[]; elevatedZones: ElevatedZone[] } {
  const total = COLS * ROWS;
  const dist = new Int32Array(total).fill(-1);
  const queue: number[] = [];

  for (let i = 0; i < total; i++) {
    if (roadMask[i]) {
      dist[i] = 0;
      queue.push(i);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cc = cur % COLS;
    const cr = Math.floor(cur / COLS);
    for (const [dc, dr] of DIRS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (!inBounds(nc, nr)) continue;
      const nIdx = keyOf(nc, nr);
      if (dist[nIdx] === -1) {
        dist[nIdx] = dist[cur] + 1;
        queue.push(nIdx);
      }
    }
  }

  const obstacles: MapObstacle[] = [];
  const elevatedZones: ElevatedZone[] = [];
  const occupied = new Uint8Array(total);
  const containerColors = ['#9b332c', '#2f5778', '#4f6246', '#8f6928'];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (a.isTunnel && b.isTunnel) {
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.max(4, Math.hypot(dx, dz));
      const rotY = Math.atan2(dx, dz);
      const nx = Math.cos(rotY);
      const nz = -Math.sin(rotY);
      const offset = 3.3;

      obstacles.push(
        {
          id: `tunnel_wall_l_${i}`,
          kind: 'tunnel_shell',
          position: { x: Number((mx - nx * offset).toFixed(2)), y: 2.1, z: Number((mz - nz * offset).toFixed(2)) },
          size: { x: 0.85, y: 4.2, z: Number(len.toFixed(2)) },
          rotationY: Number(rotY.toFixed(3)),
          blocksLoS: true,
          color: '#484d54',
        },
        {
          id: `tunnel_wall_r_${i}`,
          kind: 'tunnel_shell',
          position: { x: Number((mx + nx * offset).toFixed(2)), y: 2.1, z: Number((mz + nz * offset).toFixed(2)) },
          size: { x: 0.85, y: 4.2, z: Number(len.toFixed(2)) },
          rotationY: Number(rotY.toFixed(3)),
          blocksLoS: true,
          color: '#484d54',
        },
        {
          id: `tunnel_roof_${i}`,
          kind: 'tunnel_shell',
          position: { x: Number(mx.toFixed(2)), y: 4.5, z: Number(mz.toFixed(2)) },
          size: { x: 7.4, y: 0.65, z: Number(len.toFixed(2)) },
          rotationY: Number(rotY.toFixed(3)),
          blocksLoS: true,
          color: '#3d4249',
        },
      );
      break;
    }
  }

  const targetZones = Math.max(2, Math.round(2 + density * 2));
  const zoneCandidates: { c: number; r: number; score: number }[] = [];
  for (let r = 2; r < ROWS - 2; r++) {
    for (let c = 2; c < COLS - 2; c++) {
      const d = dist[keyOf(c, r)];
      if (d < 2 || d > 3) continue;
      let roadNearby = 0;
      for (let rr = -3; rr <= 3; rr++) {
        for (let cc = -3; cc <= 3; cc++) {
          if (inBounds(c + cc, r + rr) && roadMask[keyOf(c + cc, r + rr)]) roadNearby++;
        }
      }
      zoneCandidates.push({ c, r, score: roadNearby + rng() * 2 });
    }
  }
  zoneCandidates.sort((a, b) => b.score - a.score);

  for (const cand of zoneCandidates) {
    if (elevatedZones.length >= targetZones) break;
    const w = cellToWorld(cand.c, cand.r);
    if (elevatedZones.some((e) => Math.hypot(e.position.x - w.x, e.position.z - w.z) < 24)) continue;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (inBounds(cand.c + dc, cand.r + dr)) occupied[keyOf(cand.c + dc, cand.r + dr)] = 1;
      }
    }

    const isWatchtower = elevatedZones.length === targetZones - 1;
    const height = isWatchtower ? 7.2 : 5.2;
    const idx = elevatedZones.length + 1;
    elevatedZones.push({
      id: isWatchtower ? `watchtower_${idx}` : `rooftop_${idx}`,
      label: isWatchtower ? `Overlook Watchtower ${idx}` : `High Ground Roof ${idx}`,
      kind: isWatchtower ? 'watchtower' : 'rooftop',
      position: { x: w.x, y: height, z: w.z },
      size: { x: isWatchtower ? 6.5 : 10.5, y: height, z: isWatchtower ? 6.5 : 9.5 },
      rotationY: 0,
      allowedCategories: isWatchtower ? ['sniper', 'support'] : ['sniper', 'explosive', 'support'],
    });
  }

  const maxObstacles = Math.round(4 + density * 8);
  const obsCandidates: [number, number][] = [];
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      const idx = keyOf(c, r);
      if ((dist[idx] === 1 || dist[idx] === 2) && !occupied[idx]) obsCandidates.push([c, r]);
    }
  }
  for (let i = obsCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [obsCandidates[i], obsCandidates[j]] = [obsCandidates[j], obsCandidates[i]];
  }

  let obsCount = 0;
  for (const [c, r] of obsCandidates) {
    if (obsCount >= maxObstacles) break;
    const idx = keyOf(c, r);
    if (occupied[idx]) continue;
    const w = cellToWorld(c, r);
    if (obstacles.some((o) => Math.hypot(o.position.x - w.x, o.position.z - w.z) < 8.5)) continue;

    occupied[idx] = 1;
    const isContainer = rng() > 0.35;
    const rotY = Number(((rng() - 0.5) * 0.7).toFixed(2));
    obsCount++;

    if (isContainer) {
      const color = containerColors[obsCount % containerColors.length];
      obstacles.push({
        id: `dsa_container_${obsCount}`,
        kind: 'container',
        position: { x: w.x, y: 1.5, z: w.z },
        size: { x: 6.2, y: 3.0, z: 2.6 },
        rotationY: rotY,
        blocksLoS: true,
        color,
      });
      if (rng() > 0.65) {
        obstacles.push({
          id: `dsa_container_top_${obsCount}`,
          kind: 'container',
          position: { x: w.x, y: 4.5, z: w.z },
          size: { x: 6.2, y: 3.0, z: 2.6 },
          rotationY: Number((rotY + 0.08).toFixed(2)),
          blocksLoS: true,
          color: containerColors[(obsCount + 1) % containerColors.length],
        });
      }
    } else {
      obstacles.push({
        id: `dsa_wall_${obsCount}`,
        kind: 'wall',
        position: { x: w.x, y: 1.4, z: w.z },
        size: { x: 8.5, y: 2.8, z: 1.0 },
        rotationY: rotY,
        blocksLoS: true,
        color: '#656a70',
      });
    }
  }

  return { obstacles, elevatedZones };
}
