import highway01Waves from './highway_01.json';
import type { WaveDefinition } from '../types/protocol';

export const WAVE_DEFINITIONS = highway01Waves as WaveDefinition[];

export const MAP_WAVES: Record<string, WaveDefinition[]> = {
  highway_01: WAVE_DEFINITIONS,
};
