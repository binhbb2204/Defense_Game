import normal from './Normal/config.json';
import speedy from './Speedy/config.json';
import armored from './Armored/config.json';
import boss from './Boss/config.json';
import type { ZombieArchetypeConfig, ZombieTypeId } from '../types/protocol';

export const ENEMY_CONFIGS: Record<ZombieTypeId, ZombieArchetypeConfig> = {
  normal: normal as ZombieArchetypeConfig,
  speedy: speedy as ZombieArchetypeConfig,
  armored: armored as ZombieArchetypeConfig,
  boss: boss as ZombieArchetypeConfig,
};

/** Backwards-compatible alias for ENEMY_CONFIGS. */
export const ZOMBIE_CONFIGS = ENEMY_CONFIGS;
