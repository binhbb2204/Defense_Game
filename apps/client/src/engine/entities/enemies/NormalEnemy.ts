import { ENEMY_CONFIGS } from '@tactical-td/shared';
import { BaseEnemy } from './BaseEnemy';

export class NormalEnemy extends BaseEnemy {
  public readonly has3DModel = true;

  constructor() {
    super(ENEMY_CONFIGS.normal);
  }
}
