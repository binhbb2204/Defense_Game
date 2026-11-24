import type { RoadNode, RoadSegment, Vec3 } from '../../types/protocol';
import type { RoadRoute } from '../graph/graphRouting';

export interface CubicBezier3D {
  p0: Vec3;
  c1: Vec3;
  c2: Vec3;
  p3: Vec3;
  isCurved: boolean;
}

export interface CenterlineSample {
  x: number;
  y: number;
  z: number;
  tangent: Vec3;
  /** Cumulative arc length in meters along the sampled segment or chain. */
  s: number;
  /** Normalized parameter [0..1] within `segmentId`. */
  t: number;
  segmentId: string;
  width: number;
  isOverpass?: boolean;
  isTunnel?: boolean;
  roadPartAsset?: string;
}

export type CenterlineInput =
  | {
      segment: RoadSegment;
      nodes: readonly RoadNode[];
      segments?: readonly RoadSegment[];
      reversed?: boolean;
    }
  | {
      route: Pick<RoadRoute, 'nodeIds' | 'segmentIds'>;
      nodes: readonly RoadNode[];
      segments: readonly RoadSegment[];
    }
  | {
      nodeIds: readonly string[];
      segmentIds: readonly string[];
      nodes: readonly RoadNode[];
      segments: readonly RoadSegment[];
    };

export interface RoadSection {
  startNodeId: string;
  endNodeId: string;
  nodeIds: string[];
  segmentIds: string[];
  length: number;
  hasInteriorSpawnOrBase: boolean;
  interiorSpecialNodeIds: string[];
}

export interface FindSectionResult {
  section: RoadSection | null;
  alternatives: RoadSection[];
  warning?: string;
}

export type ShapeMode =
  | 'smooth'
  | 'curve'
  | 'straighten'
  | 'reverse'
  | 'round_corner'
  | 'connect'
  | 'parallel';

export interface CurvatureViolation {
  segmentId: string;
  position: Vec3;
  radius: number;
  minAllowedRadius: number;
}

export interface ShapePreviewHandle {
  anchor: Vec3;
  handle: Vec3;
}

export interface ShapeOperationResult {
  allowed: boolean;
  blockedReason?: string;
  warnings: string[];
  nodes: RoadNode[];
  segments: RoadSegment[];
  affectedNodeIds: string[];
  affectedSegmentIds: string[];
  minRadius: number;
  length: number;
  violations: CurvatureViolation[];
  handles: ShapePreviewHandle[];
}

export interface SmoothSectionOptions {
  tension?: number;
  anarchyEnabled?: boolean;
}

export interface CurveBetweenOptions {
  handleFactor?: number;
  spacing?: number;
  nodeCount?: number;
  tension?: number;
  anarchyEnabled?: boolean;
}

export interface StraightenSectionOptions {
  equaliseSpacing?: boolean;
  anarchyEnabled?: boolean;
}

export interface RoundCornerOptions {
  radius?: number;
  arcSegments?: number;
  anarchyEnabled?: boolean;
}

export interface ConnectSegmentsOptions {
  radius?: number;
  anarchyEnabled?: boolean;
}

export interface ParallelSectionOptions {
  offset?: number;
  side?: 'left' | 'right';
  spacing?: number;
  anarchyEnabled?: boolean;
}
