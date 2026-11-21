import highway01 from './highway_01.json';
import type { MapDefinition } from '../types/protocol';

export const HIGHWAY_01_MAP = highway01 as MapDefinition;

export const MAPS: Record<string, MapDefinition> = {
  highway_01: HIGHWAY_01_MAP,
};
