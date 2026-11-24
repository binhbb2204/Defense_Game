import type { ZombieArchetypeConfig, ZombieTypeId } from '@tactical-td/shared';
import type { LoadedModelAsset, LoadModelOptions } from '../../core/AssetLoader';
import type { ZombieRecord } from '../Zombie';

/** Dependency Inversion contract: Enemy classes depend on an abstraction, not concrete AssetLoader. */
export interface IModelLoader {
  loadModel(url: string, options?: LoadModelOptions): Promise<LoadedModelAsset>;
}

/**
 * Data-driven Base Enemy class (SOLID: SRP, OCP, LSP, DIP).
 *
 * 95% of enemies need ZERO custom TypeScript class — `EnemyRegistry` auto-discovers
 * `packages/shared/enemies/<Folder>/config.json` + `.glb` and instantiates `BaseEnemy` directly.
 * Subclass only when an enemy needs unique custom combat/ability code (e.g. Boss slam).
 */
export class BaseEnemy {
  public readonly config: ZombieArchetypeConfig;
  public readonly modelUrl: string | null;

  constructor(config: ZombieArchetypeConfig, modelUrl: string | null = null) {
    this.config = config;
    this.modelUrl = modelUrl;
  }

  public get id(): ZombieTypeId {
    return this.config.id;
  }

  public async preloadModel(modelLoader: IModelLoader): Promise<LoadedModelAsset | null> {
    if (!this.modelUrl) {
      return null;
    }
    return modelLoader.loadModel(this.modelUrl, {
      targetHeight: this.config.height,
    });
  }

  public onSpawn(_record: ZombieRecord): void {
    // Subclasses override for custom spawn logic.
  }

  public onFixedTick(_record: ZombieRecord, _fixedDt: number): void {
    // Subclasses override for custom 60Hz abilities.
  }

  public computeDamageTaken(
    _record: Readonly<ZombieRecord>,
    rawDamage: number,
    armorPenetration = 0,
  ): number {
    const effectiveArmor = Math.max(0, this.config.armor * (1 - armorPenetration));
    return Math.max(1, rawDamage * (1 - effectiveArmor));
  }
}
