import { ENEMY_CONFIGS } from '@tactical-td/shared';
import { BaseEnemy } from './BaseEnemy';

export class SpeedyEnemy extends BaseEnemy {
  /** Flip to true once `/models/enemies/speedy.glb` (or `.fbx`) is placed in `public/`. */
  public readonly has3DModel = false;

  constructor() {
    super(ENEMY_CONFIGS.speedy);
  }
}
