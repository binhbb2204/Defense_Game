import {
  ENEMY_CONFIGS,
  findRoutes,
  getMapGraph,
  measureRoadSegment,
  type MapDefinition,
  type TowerArchetypeConfig,
  type WaveDefinition,
} from '@tactical-td/shared';

export interface SquadSlot {
  towerId: string;
  count: number;
  level: number;
}

export interface SimWaveResult {
  waveNumber: number;
  waveName: string;
  totalEnemies: number;
  totalEhp: number;
  killed: number;
  leaked: number;
  baseHpAfter: number;
  durationSec: number;
  status: 'CLEARED' | 'BREACHED';
}

export interface SimSummary {
  results: SimWaveResult[];
  rawDps: number;
  effectiveDps: number;
  squadCost: number;
  totalCampaignCash: number;
  pathLength: number;
  totalSimTimeSec: number;
  breachedWave: number | null;
}

/** Measures true curve-aware path length from v4 Road Graph, falling back to legacy waypoints. */
export function estimatePathLength(map: MapDefinition): number {
  const { nodes, segments } = getMapGraph(map);
  if (nodes.length >= 2 && segments.length >= 1) {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const segMap = new Map(segments.map((s) => [s.id, s]));
    const routes = findRoutes(nodes, segments, 4);
    const segIds = routes[0]?.segmentIds ?? segments.map((s) => s.id);

    let graphLen = 0;
    for (const segId of segIds) {
      const seg = segMap.get(segId);
      if (!seg) continue;
      const a = nodeMap.get(seg.a);
      const b = nodeMap.get(seg.b);
      if (!a || !b) continue;
      graphLen += measureRoadSegment(a, b, seg, nodes, segments).length;
    }
    if (graphLen > 1) return Math.max(40, graphLen);
  }

  let legacyLen = 0;
  for (let i = 1; i < map.waypoints.length; i++) {
    const a = map.waypoints[i - 1]!;
    const b = map.waypoints[i]!;
    legacyLen += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return Math.max(40, legacyLen);
}

/**
 * Pure headless 60Hz DPS vs Zombie HP wave simulation (zero 3D overhead).
 */
export function runHeadlessSim(
  map: MapDefinition,
  waves: WaveDefinition[],
  towers: Record<string, TowerArchetypeConfig>,
  squad: SquadSlot[],
  losUptimePct: number,
  stunPenaltyPct: number,
): SimSummary {
  const pathLength = estimatePathLength(map);
  const losFactor = losUptimePct / 100;
  const stunFactor = 1 - stunPenaltyPct / 100;

  let squadCost = 0;
  let rawDps = 0;
  let effectiveDps = 0;
  const weaponUnits: { dps: number; rangeFactor: number; splash: boolean }[] = [];

  for (const slot of squad) {
    const cfg = towers[slot.towerId];
    if (!cfg || slot.count <= 0) continue;
    let unitCost = cfg.baseCost;
    for (let l = 1; l <= slot.level; l++) {
      unitCost += cfg.levels[l]?.upgradeCost ?? 0;
    }
    squadCost += unitCost * slot.count;

    const lv = cfg.levels[slot.level] ?? cfg.levels[0];
    const unitDps = lv.damage * lv.fireRate;
    rawDps += unitDps * slot.count;

    const rangeFactor = Math.max(0.2, Math.min(1, (lv.range * 2.1) / pathLength) * losFactor);
    const effectiveUnitDps =
      unitDps * (cfg.category === 'explosive' ? stunFactor : stunFactor * 0.92 + 0.08);
    effectiveDps += effectiveUnitDps * rangeFactor * slot.count;

    for (let c = 0; c < slot.count; c++) {
      weaponUnits.push({
        dps: effectiveUnitDps,
        rangeFactor,
        splash: cfg.category === 'explosive',
      });
    }
  }

  let baseHp = map.baseHp;
  let totalCampaignCash = map.startingCash;
  let totalSimTimeSec = 0;
  let breachedWave: number | null = null;
  const dt = 1 / 60;
  const results: SimWaveResult[] = [];

  for (const wave of waves) {
    interface SimUnit {
      hp: number;
      armor: number;
      speed: number;
      dist: number;
      baseDamage: number;
    }
    const pending: { spawnTime: number; unit: SimUnit }[] = [];
    let totalEhp = 0;
    totalCampaignCash += wave.clearBonus;

    for (const g of wave.groups) {
      const e = ENEMY_CONFIGS[g.zombieType];
      totalCampaignCash += e.cashReward * g.count;
      totalEhp += (e.maxHp / Math.max(0.15, 1 - e.armor)) * g.count;
      for (let i = 0; i < g.count; i++) {
        pending.push({
          spawnTime: g.startDelay + i * g.interval,
          unit: { hp: e.maxHp, armor: e.armor, speed: e.speed, dist: 0, baseDamage: e.baseDamage },
        });
      }
    }
    pending.sort((a, b) => a.spawnTime - b.spawnTime);

    const active: SimUnit[] = [];
    let spawnPtr = 0;
    let t = 0;
    let killed = 0;
    let leaked = 0;

    while ((spawnPtr < pending.length || active.length > 0) && t < 300) {
      t += dt;
      while (spawnPtr < pending.length && pending[spawnPtr]!.spawnTime <= t) {
        active.push(pending[spawnPtr++]!.unit);
      }

      for (let i = active.length - 1; i >= 0; i--) {
        active[i]!.dist += active[i]!.speed * dt;
        if (active[i]!.dist >= pathLength) {
          baseHp = Math.max(0, baseHp - active[i]!.baseDamage);
          leaked++;
          active.splice(i, 1);
        }
      }

      if (active.length === 0) continue;
      active.sort((a, b) => b.dist - a.dist);

      for (const w of weaponUnits) {
        if (active.length === 0) break;
        const target = active[0]!;
        const armorMult = w.splash ? 1 - target.armor * 0.45 : 1 - target.armor;
        const dmg = w.dps * w.rangeFactor * armorMult * dt;
        target.hp -= dmg;

        if (w.splash) {
          for (let s = 1; s < Math.min(4, active.length); s++) {
            if (Math.abs(active[s]!.dist - target.dist) <= 5.5) {
              active[s]!.hp -= dmg * 0.75;
            }
          }
        }
      }

      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i]!.hp <= 0) {
          killed++;
          active.splice(i, 1);
        }
      }
    }

    const status: SimWaveResult['status'] = baseHp > 0 && leaked < pending.length ? 'CLEARED' : 'BREACHED';
    if (status === 'BREACHED' && breachedWave === null) breachedWave = wave.waveNumber;
    totalSimTimeSec += t;

    results.push({
      waveNumber: wave.waveNumber,
      waveName: wave.name,
      totalEnemies: pending.length,
      totalEhp: Math.round(totalEhp),
      killed,
      leaked,
      baseHpAfter: baseHp,
      durationSec: Number(t.toFixed(1)),
      status,
    });
  }

  return {
    results,
    rawDps: Math.round(rawDps),
    effectiveDps: Math.round(effectiveDps),
    squadCost,
    totalCampaignCash,
    pathLength,
    totalSimTimeSec: Number(totalSimTimeSec.toFixed(1)),
    breachedWave,
  };
}
