export * from './types/protocol';

import highway01Raw from './maps/highway_01.json';
import zombiesRaw from './config/zombies.json';
import wavesRaw from './config/waves.json';
import towersRaw from './config/towers.json';
import type {
  MapDefinition,
  TowerArchetypeConfig,
  WaveDefinition,
  ZombieArchetypeConfig,
  ZombieTypeId,
} from './types/protocol';

export const HIGHWAY_01_MAP = highway01Raw as MapDefinition;
export const ZOMBIE_CONFIGS = zombiesRaw as Record<ZombieTypeId, ZombieArchetypeConfig>;
export const WAVE_DEFINITIONS = wavesRaw as WaveDefinition[];
export const TOWER_CONFIGS = towersRaw as Record<string, TowerArchetypeConfig>;
