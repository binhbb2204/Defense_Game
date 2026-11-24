import type { ZombieArchetypeConfig } from '@tactical-td/shared';
import type { ZombieRecord } from '../Zombie';
import { BaseEnemy } from './BaseEnemy';

/** Optional behavior override for Boss enemies (ground-slam tower stun). */
export class BossEnemy extends BaseEnemy {
  public readonly slamIntervalSec = 8.0;

  constructor(config: ZombieArchetypeConfig, modelUrl: string | null) {
    super(config, modelUrl);
  }

  public override onFixedTick(_record: ZombieRecord, _fixedDt: number): void {
    // Phase 2 hook: periodic ground-slam shockwave that stuns nearby towers
  }
}
