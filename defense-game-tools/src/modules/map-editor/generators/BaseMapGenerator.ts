import { migrateMapDefinition, type MapDefinition } from '@tactical-td/shared';
import {
  createRng,
  pathCellsToWaypoints,
  populateObstaclesAndHighGround,
} from './gridHelpers';

export type DsaMapAlgorithm =
  | 'astar_highway'
  | 'dfs_canyon'
  | 'dijkstra_contour'
  | 'prim_mst';

export interface DsaMapGenParams {
  algorithm: DsaMapAlgorithm;
  seed: number;
  obstacleDensity: number;
  mapId?: string;
  mapName?: string;
}

export interface DsaAlgorithmMeta {
  id: DsaMapAlgorithm;
  label: string;
  summary: string;
  complexity: string;
}

/**
 * Template-Method abstract base class for all procedural DSA map generators.
 */
export abstract class BaseMapGenerator {
  abstract readonly meta: DsaAlgorithmMeta;

  protected abstract generatePathCells(
    rng: () => number,
  ): { cells: [number, number][]; elevation?: Float32Array };

  generate(params: DsaMapGenParams): MapDefinition {
    const rng = createRng(params.seed);
    const { cells, elevation } = this.generatePathCells(rng);
    const { waypoints, roadMask } = pathCellsToWaypoints(cells, elevation);
    const { obstacles, elevatedZones } = populateObstaclesAndHighGround(
      roadMask,
      waypoints,
      params.obstacleDensity,
      rng,
    );

    return migrateMapDefinition({
      id: params.mapId ?? 'procedural_map',
      name: params.mapName ?? `${this.meta.label} #${params.seed}`,
      version: 1,
      bounds: { width: 96, depth: 72 },
      baseHp: 100,
      startingCash: 450,
      defaultRoadWidth: 5.2,
      waypoints,
      obstacles,
      elevatedZones,
    });
  }
}
