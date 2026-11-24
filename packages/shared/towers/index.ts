import turret from './Turret/turret.json';
import sniper from './Sniper/sniper.json';
import mortar from './Mortar/mortar.json';
import rifleman from './Rifleman/rifleman.json';
import type { TowerArchetypeConfig } from '../types/protocol';

export const TOWER_CONFIGS: Record<string, TowerArchetypeConfig> = {
  turret: turret as TowerArchetypeConfig,
  sniper: sniper as TowerArchetypeConfig,
  mortar: mortar as TowerArchetypeConfig,
  rifleman: rifleman as TowerArchetypeConfig,
};
