import highway01 from './highway_01.json';
import roadGeometryTestScene from './road_geometry_test_scene.json';
import type { MapDefinition } from '../types/protocol';

export const HIGHWAY_01_MAP = highway01 as MapDefinition;
export const ROAD_GEOMETRY_TEST_MAP = roadGeometryTestScene as MapDefinition;

export const MAPS: Record<string, MapDefinition> = {
  highway_01: HIGHWAY_01_MAP,
  road_geometry_test_scene: ROAD_GEOMETRY_TEST_MAP,
};
