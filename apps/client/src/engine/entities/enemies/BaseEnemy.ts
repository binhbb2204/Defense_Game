import type { ZombieArchetypeConfig, ZombieTypeId } from '@tactical-td/shared';
import type { AssetLoader, LoadedModelAsset } from '../../core/AssetLoader';
import type { ZombieRecord } from '../Zombie';

/**
 * Abstract Base Class for all Enemy archetypes (SOLID: Single Responsibility & Liskov Substitution).
 *
 * Subclasses encapsulate their own 3D model loading options, armor mitigation formulas,
 * and special per-tick abilities (e.g. Boss ground-slam stun) so GameEngine and ZombiePool
 * never hardcode `if (type === 'normal')` branches.
 */
export abstract class BaseEnemy {
  public readonly config: ZombieArchetypeConfig;

  /**
   * Set to true once the 3D model file (.glb / .fbx) exists in `public/models/enemies/`.
   * While false, ZombiePool automatically renders this enemy via fast InstancedMesh boxes.
   */
  public abstract readonly has3DModel: boolean;

  protected constructor(config: ZombieArchetypeConfig) {
    this.config = config;
  }

  public get id(): ZombieTypeId {
    return this.config.id;
  }

  /** Optional fallback texture path when loading .fbx files with legacy texture references. */
  protected getFallbackTextureUrl(): string | undefined {
    return undefined;
  }

  public async preloadModel(assetLoader: AssetLoader): Promise<LoadedModelAsset | null> {
    if (!this.has3DModel || !this.config.modelPath) {
      return null;
    }
    return assetLoader.loadModel(this.config.modelPath, {
      targetHeight: this.config.height,
      fallbackTextureUrl: this.getFallbackTextureUrl(),
    });
  }

  /** Lifecycle hook invoked when a pooled instance of this enemy spawns. */
  public onSpawn(_record: ZombieRecord): void {
    // Default no-op; subclasses may initialize ability timers or buffs.
  }

  /** 60Hz deterministic simulation hook for archetype-specific behavior (zero allocations). */
  public onFixedTick(_record: ZombieRecord, _fixedDt: number): void {
    // Default no-op; overridden by BossEnemy / SpeedyEnemy as needed.
  }

  /** Polymorphic damage calculation factoring in physical armor & armor penetration. */
  public computeDamageTaken(
    _record: Readonly<ZombieRecord>,
    rawDamage: number,
    armorPenetration = 0,
  ): number {
    const effectiveArmor = Math.max(0, this.config.armor * (1 - armorPenetration));
    return Math.max(1, rawDamage * (1 - effectiveArmor));
  }
}
