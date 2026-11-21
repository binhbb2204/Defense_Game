import type { WaveDefinition, ZombieTypeId } from '@tactical-td/shared';

interface GroupRuntimeState {
  zombieType: ZombieTypeId;
  remaining: number;
  interval: number;
  nextSpawnTime: number;
}

interface WaveRun {
  wave: WaveDefinition;
  elapsed: number;
  groups: GroupRuntimeState[];
}

export interface WaveManagerCallbacks {
  onSpawnZombie: (zombieType: ZombieTypeId, laneOffset: number) => void;
  onWaveStarted?: (wave: WaveDefinition) => void;
  onWaveAllSpawned?: (wave: WaveDefinition) => void;
}

/**
 * Deterministic timeline-driven wave spawner running inside the 60Hz fixed loop.
 * Supports overlapping waves (calling the next wave early while one is still spawning).
 * Uses a seeded Mulberry32 PRNG for lane offsets so Phase 5 Co-op clients stay in lockstep.
 */
export class WaveManager {
  private readonly waves: readonly WaveDefinition[];
  private readonly callbacks: WaveManagerCallbacks;

  private currentWaveIndex = -1;
  private rngState = 0x1337c0de;
  private runs: WaveRun[] = [];

  constructor(waves: readonly WaveDefinition[], callbacks: WaveManagerCallbacks) {
    this.waves = waves;
    this.callbacks = callbacks;
  }

  public getCurrentWaveNumber(): number {
    return this.currentWaveIndex + 1;
  }

  public getTotalWaves(): number {
    return this.waves.length;
  }

  public getCurrentWave(): WaveDefinition | null {
    return this.currentWaveIndex >= 0 && this.currentWaveIndex < this.waves.length
      ? this.waves[this.currentWaveIndex]
      : null;
  }

  /** True while any started wave still has zombies left to spawn. */
  public isSpawning(): boolean {
    return this.runs.length > 0;
  }

  public hasMoreWaves(): boolean {
    return this.currentWaveIndex + 1 < this.waves.length;
  }

  public startNextWave(seed?: number): WaveDefinition | null {
    if (!this.hasMoreWaves()) {
      return null;
    }

    this.currentWaveIndex++;
    const wave = this.waves[this.currentWaveIndex];
    this.rngState = (seed ?? (0x9e3779b9 ^ (wave.waveNumber * 2654435761))) >>> 0;

    this.runs.push({
      wave,
      elapsed: 0,
      groups: wave.groups.map((g) => ({
        zombieType: g.zombieType,
        remaining: g.count,
        interval: g.interval,
        nextSpawnTime: g.startDelay,
      })),
    });

    this.callbacks.onWaveStarted?.(wave);
    return wave;
  }

  public fixedUpdate(fixedDt: number): void {
    for (let r = this.runs.length - 1; r >= 0; r--) {
      const run = this.runs[r];
      run.elapsed += fixedDt;
      let totalRemaining = 0;

      for (let i = 0; i < run.groups.length; i++) {
        const group = run.groups[i];
        while (group.remaining > 0 && run.elapsed >= group.nextSpawnTime) {
          const laneOffset = this.nextDeterministicFloat() * 1.64 - 0.82; // [-0.82, +0.82]
          this.callbacks.onSpawnZombie(group.zombieType, laneOffset);
          group.remaining--;
          group.nextSpawnTime += group.interval;
        }
        totalRemaining += group.remaining;
      }

      if (totalRemaining === 0) {
        const last = this.runs.length - 1;
        if (r !== last) this.runs[r] = this.runs[last];
        this.runs.pop();
        this.callbacks.onWaveAllSpawned?.(run.wave);
      }
    }
  }

  public reset(): void {
    this.currentWaveIndex = -1;
    this.runs = [];
  }

  /** Mulberry32 deterministic PRNG in [0, 1). */
  private nextDeterministicFloat(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(this.rngState ^ (this.rngState >>> 15), 1 | this.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
