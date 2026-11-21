import { ENEMY_CONFIGS } from '@tactical-td/shared';
import type { ZombieRecord } from '../Zombie';
import { BaseEnemy } from './BaseEnemy';

export class BossEnemy extends BaseEnemy {
  public readonly has3DModel = false;
  public readonly slamIntervalSec = 8.0;

  constructor() {
    super(ENEMY_CONFIGS.boss);
  }

  public override onFixedTick(_record: ZombieRecord, _fixedDt: number): void {
    // Phase 2 hook: periodic ground-slam shockwave that stuns nearby towers
  }
}
