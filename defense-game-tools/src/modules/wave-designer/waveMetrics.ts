import { ENEMY_CONFIGS, type WaveDefinition, type ZombieTypeId } from '@tactical-td/shared';

export const ZOMBIE_TYPES: readonly ZombieTypeId[] = ['normal', 'speedy', 'armored', 'boss'];

export const ENEMY_META: Record<
  ZombieTypeId,
  { dot: string; fill: string; border: string; text: string; short: string }
> = {
  normal: {
    dot: '#4ade80',
    fill: 'rgba(74, 222, 128, 0.14)',
    border: 'rgba(74, 222, 128, 0.42)',
    text: '#86efac',
    short: 'Walker',
  },
  speedy: {
    dot: '#fbbf24',
    fill: 'rgba(251, 191, 36, 0.14)',
    border: 'rgba(251, 191, 36, 0.42)',
    text: '#fde68a',
    short: 'Sprinter',
  },
  armored: {
    dot: '#60a5fa',
    fill: 'rgba(96, 165, 250, 0.14)',
    border: 'rgba(96, 165, 250, 0.42)',
    text: '#bfdbfe',
    short: 'Brute',
  },
  boss: {
    dot: '#fb7185',
    fill: 'rgba(251, 113, 133, 0.14)',
    border: 'rgba(251, 113, 133, 0.42)',
    text: '#fecdd3',
    short: 'Boss',
  },
};

export interface WaveEnemyShare {
  type: ZombieTypeId;
  count: number;
  pct: number;
}

export interface WaveStats {
  totalCount: number;
  rawHp: number;
  effectiveHp: number;
  killCash: number;
  totalReward: number;
  durationSec: number;
  shares: WaveEnemyShare[];
}

export interface WaveWithCampaignStats extends WaveStats {
  cashAfterWave: number;
}

export function computeWaveStats(wave: WaveDefinition): WaveStats {
  let totalCount = 0;
  let rawHp = 0;
  let effectiveHp = 0;
  let killCash = 0;
  let durationSec = 0;
  const counts: Record<ZombieTypeId, number> = { normal: 0, speedy: 0, armored: 0, boss: 0 };

  for (const g of wave.groups) {
    const cfg = ENEMY_CONFIGS[g.zombieType];
    totalCount += g.count;
    counts[g.zombieType] += g.count;
    rawHp += cfg.maxHp * g.count;
    effectiveHp += (cfg.maxHp / Math.max(0.15, 1 - cfg.armor)) * g.count;
    killCash += cfg.cashReward * g.count;
    durationSec = Math.max(durationSec, g.startDelay + Math.max(0, g.count - 1) * g.interval);
  }

  const shares: WaveEnemyShare[] = [];
  if (totalCount > 0) {
    for (const type of ZOMBIE_TYPES) {
      if (counts[type] > 0) {
        shares.push({ type, count: counts[type], pct: (counts[type] / totalCount) * 100 });
      }
    }
  }

  return {
    totalCount,
    rawHp: Math.round(rawHp),
    effectiveHp: Math.round(effectiveHp),
    killCash,
    totalReward: killCash + wave.clearBonus,
    durationSec: Number(durationSec.toFixed(1)),
    shares,
  };
}

export function computeCampaignStats(
  waves: WaveDefinition[],
  startingCash: number,
): WaveWithCampaignStats[] {
  let cashSoFar = startingCash;
  return waves.map((w) => {
    const s = computeWaveStats(w);
    cashSoFar += s.totalReward;
    return { ...s, cashAfterWave: cashSoFar };
  });
}
