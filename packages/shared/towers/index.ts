import rifleman from './rifleman.json';
import sniper from './sniper.json';
import mortar from './mortar.json';
import type { TowerArchetypeConfig } from '../types/protocol';

export const TOWER_CONFIGS: Record<string, TowerArchetypeConfig> = {
  rifleman: rifleman as TowerArchetypeConfig,
  sniper: sniper as TowerArchetypeConfig,
  mortar: mortar as TowerArchetypeConfig,
};
