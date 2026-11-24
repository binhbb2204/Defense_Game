import type { MapDefinition } from '@tactical-td/shared';
import { AStarHighwayGenerator } from './AStarHighwayGenerator';
import { BaseMapGenerator, type DsaAlgorithmMeta, type DsaMapAlgorithm, type DsaMapGenParams } from './BaseMapGenerator';
import { DfsCanyonGenerator } from './DfsCanyonGenerator';
import { DijkstraContourGenerator } from './DijkstraContourGenerator';
import { PrimMstGenerator } from './PrimMstGenerator';

export type { DsaMapAlgorithm, DsaMapGenParams, DsaAlgorithmMeta };
export { BaseMapGenerator };

const GENERATORS: readonly BaseMapGenerator[] = [
  new AStarHighwayGenerator(),
  new DfsCanyonGenerator(),
  new DijkstraContourGenerator(),
  new PrimMstGenerator(),
];

export const GENERATOR_REGISTRY = new Map<DsaMapAlgorithm, BaseMapGenerator>(
  GENERATORS.map((g) => [g.meta.id, g]),
);

export const DSA_ALGORITHMS: DsaAlgorithmMeta[] = GENERATORS.map((g) => g.meta);

export function generateProceduralMap(params: DsaMapGenParams): MapDefinition {
  const generator = GENERATOR_REGISTRY.get(params.algorithm) ?? GENERATORS[0]!;
  return generator.generate(params);
}
