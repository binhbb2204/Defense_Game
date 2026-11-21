import type { ZombieTypeId } from '@tactical-td/shared';
import type { AssetLoader, LoadedModelAsset } from '../../core/AssetLoader';
import { ArmoredEnemy } from './ArmoredEnemy';
import { BaseEnemy } from './BaseEnemy';
import { BossEnemy } from './BossEnemy';
import { NormalEnemy } from './NormalEnemy';
import { SpeedyEnemy } from './SpeedyEnemy';

/**
 * Central Map-based Enemy Registry (SOLID: Open/Closed & Dependency Inversion).
 *
 * Adding a new enemy type only requires registering its class in `ENEMY_MAP` —
 * `GameEngine`, `WaveManager`, and `ZombiePool` remain 100% untouched.
 */
export class EnemyRegistry {
  private readonly map: ReadonlyMap<ZombieTypeId, BaseEnemy>;

  constructor() {
    const entries: BaseEnemy[] = [
      new NormalEnemy(),
      new SpeedyEnemy(),
      new ArmoredEnemy(),
      new BossEnemy(),
    ];
    this.map = new Map(entries.map((enemy) => [enemy.id, enemy]));
  }

  public get(type: ZombieTypeId): BaseEnemy {
    const enemy = this.map.get(type);
    if (!enemy) {
      throw new Error(`[EnemyRegistry] Unregistered enemy type: "${type}"`);
    }
    return enemy;
  }

  public getAll(): IterableIterator<BaseEnemy> {
    return this.map.values();
  }

  /** Iterates over the registry Map and preloads every enemy with `has3DModel = true`. */
  public preloadModels(
    assetLoader: AssetLoader,
    onLoaded: (type: ZombieTypeId, asset: LoadedModelAsset) => void,
  ): void {
    for (const enemy of this.map.values()) {
      enemy
        .preloadModel(assetLoader)
        .then((asset) => {
          if (asset) {
            onLoaded(enemy.id, asset);
          }
        })
        .catch((err) => {
          console.warn(
            `[EnemyRegistry] Failed to load 3D model for "${enemy.id}", using InstancedMesh fallback:`,
            err,
          );
        });
    }
  }
}

export const enemyRegistry = new EnemyRegistry();
export { BaseEnemy };
