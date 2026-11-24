import type { ZombieArchetypeConfig, ZombieTypeId } from '@tactical-td/shared';
import type { LoadedModelAsset } from '../../core/AssetLoader';
import { ArmoredEnemy } from './ArmoredEnemy';
import { BaseEnemy, type IModelLoader } from './BaseEnemy';
import { BossEnemy } from './BossEnemy';

/** Dependency Inversion interface consumed by ZombiePool and GameEngine. */
export interface IEnemyRegistry {
  get(type: ZombieTypeId): BaseEnemy;
  getAll(): IterableIterator<BaseEnemy>;
  preloadModels(
    modelLoader: IModelLoader,
    onLoaded: (type: ZombieTypeId, asset: LoadedModelAsset) => void,
  ): void;
}

type EnemyConstructor = new (config: ZombieArchetypeConfig, modelUrl: string | null) => BaseEnemy;

/**
 * Only enemies with unique custom code need an entry here.
 * Every other enemy folder in `packages/shared/enemies/<Name>/` is auto-instantiated as `BaseEnemy`!
 */
const BEHAVIOR_OVERRIDES: Partial<Record<ZombieTypeId, EnemyConstructor>> = {
  armored: ArmoredEnemy,
  boss: BossEnemy,
};

// Auto-discover every `packages/shared/enemies/<Folder>/config.json` and `*.glb` at build time
const discoveredConfigs = import.meta.glob<ZombieArchetypeConfig>(
  '@enemies-assets/*/config.json',
  { eager: true, import: 'default' },
);

const discoveredModels = import.meta.glob<string>('@enemies-assets/*/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
});

function extractFolderAndFile(globPath: string): { folder: string; file: string } | null {
  const normalized = globPath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length < 2) return null;
  return {
    folder: parts[parts.length - 2],
    file: parts[parts.length - 1],
  };
}

function buildAutoDiscoveredEnemies(): Map<ZombieTypeId, BaseEnemy> {
  // Index available .glb URLs by folder name
  const modelsByFolder = new Map<string, Map<string, string>>();
  for (const [path, url] of Object.entries(discoveredModels)) {
    const parsed = extractFolderAndFile(path);
    if (!parsed) continue;
    let folderMap = modelsByFolder.get(parsed.folder);
    if (!folderMap) {
      folderMap = new Map();
      modelsByFolder.set(parsed.folder, folderMap);
    }
    folderMap.set(parsed.file, url);
  }

  const registry = new Map<ZombieTypeId, BaseEnemy>();

  for (const [path, config] of Object.entries(discoveredConfigs)) {
    const parsed = extractFolderAndFile(path);
    if (!parsed) continue;

    const folderModels = modelsByFolder.get(parsed.folder);
    let modelUrl: string | null = null;

    if (folderModels && folderModels.size > 0) {
      // 1. Prefer exact filename specified in config.modelPath (e.g. "Speedy_Zombie.glb")
      const requestedFile = config.modelPath?.split('/').pop();
      if (requestedFile) {
        if (folderModels.has(requestedFile)) {
          modelUrl = folderModels.get(requestedFile)!;
        } else {
          console.warn(
            `[EnemyRegistry] "${parsed.folder}/config.json" requested "${requestedFile}", ` +
              `not found in Vite glob (${[...folderModels.keys()].join(', ')}). Restart dev server if just added.`,
          );
        }
      } else {
        // 2. Fallback when config omits modelPath: pick first non-base .glb inside the folder
        for (const [fileName, url] of folderModels.entries()) {
          if (!/_base\.glb$/i.test(fileName)) {
            modelUrl = url;
            break;
          }
        }
      }
    }

    const EnemyClass = BEHAVIOR_OVERRIDES[config.id] ?? BaseEnemy;
    registry.set(config.id, new EnemyClass(config, modelUrl));
  }

  return registry;
}

/**
 * Auto-Discovering Data-Driven Enemy Registry.
 * Add 100 new enemies = add 100 folders in `packages/shared/enemies/<Name>/` (config.json + .glb),
 * with ZERO new TypeScript files required.
 */
export class EnemyRegistry implements IEnemyRegistry {
  private readonly map: ReadonlyMap<ZombieTypeId, BaseEnemy>;

  constructor() {
    this.map = buildAutoDiscoveredEnemies();
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

  public preloadModels(
    modelLoader: IModelLoader,
    onLoaded: (type: ZombieTypeId, asset: LoadedModelAsset) => void,
  ): void {
    for (const enemy of this.map.values()) {
      enemy
        .preloadModel(modelLoader)
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

export const enemyRegistry: IEnemyRegistry = new EnemyRegistry();
export { BaseEnemy, type IModelLoader };
