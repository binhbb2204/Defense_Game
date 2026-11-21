import normal from './normal.json';
import speedy from './speedy.json';
import armored from './armored.json';
import boss from './boss.json';
import type { ZombieArchetypeConfig, ZombieTypeId } from '../types/protocol';

export const ENEMY_CONFIGS: Record<ZombieTypeId, ZombieArchetypeConfig> = {
  normal: normal as ZombieArchetypeConfig,
  speedy: speedy as ZombieArchetypeConfig,
  armored: armored as ZombieArchetypeConfig,
  boss: boss as ZombieArchetypeConfig,
};

/** Backwards-compatible alias for ENEMY_CONFIGS. */
export const ZOMBIE_CONFIGS = ENEMY_CONFIGS;
