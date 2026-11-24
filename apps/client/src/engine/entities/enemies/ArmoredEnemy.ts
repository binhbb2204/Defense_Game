import type { ZombieArchetypeConfig } from '@tactical-td/shared';
import type { ZombieRecord } from '../Zombie';
import { BaseEnemy } from './BaseEnemy';

/** Optional behavior override for Armored enemies (extra flat bullet deflection). */
export class ArmoredEnemy extends BaseEnemy {
  constructor(config: ZombieArchetypeConfig, modelUrl: string | null) {
    super(config, modelUrl);
  }

  public override computeDamageTaken(
    record: Readonly<ZombieRecord>,
    rawDamage: number,
    armorPenetration = 0,
  ): number {
    const mitigated = super.computeDamageTaken(record, rawDamage, armorPenetration);
    return armorPenetration > 0 ? mitigated : Math.max(1, mitigated - 2);
  }
}
