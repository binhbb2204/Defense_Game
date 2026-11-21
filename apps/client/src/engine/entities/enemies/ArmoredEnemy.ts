import { ENEMY_CONFIGS } from '@tactical-td/shared';
import type { ZombieRecord } from '../Zombie';
import { BaseEnemy } from './BaseEnemy';

export class ArmoredEnemy extends BaseEnemy {
  public readonly has3DModel = false;

  constructor() {
    super(ENEMY_CONFIGS.armored);
  }

  public override computeDamageTaken(
    record: Readonly<ZombieRecord>,
    rawDamage: number,
    armorPenetration = 0,
  ): number {
    // Riot Brute: standard non-AP bullets suffer extra flat deflection after percentage armor
    const mitigated = super.computeDamageTaken(record, rawDamage, armorPenetration);
    return armorPenetration > 0 ? mitigated : Math.max(1, mitigated - 2);
  }
}
