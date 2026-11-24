import type { RoadNode, RoadSegment, Vec3 } from '../../types/protocol';

export type RoadJoinStyle = 'miter' | 'bevel' | 'round';

export interface RoadGeometryInput {
  nodes: readonly RoadNode[];
  segments: readonly RoadSegment[];
}

export interface RoadGeometryOptions {
  joinStyle?: RoadJoinStyle;
  miterLimit?: number;
  cornerRadius?: number;
  curveSubdivisions?: number;
  yOffset?: number;
  arrowSpacing?: number;
  arrowLength?: number;
  arrowWidthRatio?: number;
  uvVPeriodMeters?: number;
  minAngleDeg?: number;
  maxCornerDistMultiplier?: number;
  roundSegments?: number;
}

export interface ResolvedRoadGeometryOptions {
  joinStyle: RoadJoinStyle;
  miterLimit: number;
  cornerRadius: number;
  curveSubdivisions: number;
  yOffset: number;
  arrowSpacing: number;
  arrowLength: number;
  arrowWidthRatio: number;
  uvVPeriodMeters: number;
  maxCornerDistMult: number;
  roundSegments: number;
}

export interface RoadArrowStrip {
  segmentId: string;
  position: Vec3;
  direction: Vec3;
  width: number;
  length: number;
}

export interface RoadGeometryDebugData {
  centrelines: Vec3[][];
  offsetEdges: Array<{ segmentId: string; left: Vec3[]; right: Vec3[] }>;
  miterPoints: Vec3[];
  trimPoints: Vec3[];
  junctionPolygons: Vec3[][];
  segmentTrimDistances: Record<
    string,
    { startTrim: number; endTrim: number; length: number }
  >;
}

export interface RoadGeometryResult {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  edgePolylines: Vec3[][];
  arrowStrips: RoadArrowStrip[];
  debug: RoadGeometryDebugData;
}

export interface DirtyRoadRegion {
  nodeIds: Set<string>;
  segmentIds: Set<string>;
}

export interface CurveLutEntry {
  t: number;
  s: number;
  pos: Vec3;
  tangent: Vec3;
}

export interface SegmentCache {
  segIdx: number;
  seg: RoadSegment;
  nodeA: RoadNode;
  nodeB: RoadNode;
  halfW: number;
  totalLen: number;
  isCurved: boolean;
  lut: CurveLutEntry[];
  outDirA: Vec3;
  outDirB: Vec3;
  flowSign: 1 | -1;
}

export interface HalfEdge {
  segIdx: number;
  end: 'a' | 'b';
  nodeId: string;
  otherNodeId: string;
  halfW: number;
  outDir: Vec3;
  outLeft: Vec3;
  outRight: Vec3;
  angle: number;
  trimDist: number;
  leftVert: Vec3;
  rightVert: Vec3;
  patchLeftIdx: number;
  patchRightIdx: number;
}

export interface Degree2Meta {
  kind: 'collinear_equal' | 'collinear_taper' | 'miter' | 'bevel' | 'round';
  he0: HalfEdge;
  he1: HalfEdge;
  outerPts: Vec3[];
  innerPt: Vec3;
  outerJoinPt: Vec3 | null;
}

export interface SectorCorner {
  heFrom: HalfEdge;
  heTo: HalfEdge;
  intersection: Vec3 | null;
  usedFallback: boolean;
  perimeterPts: Vec3[];
}

export interface JunctionMeta {
  node: RoadNode;
  sortedHalfEdges: HalfEdge[];
  sectors: SectorCorner[];
  perimeterRing: Vec3[];
}

export interface IMeshBuilder {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
  addVertex(pos: Vec3, u: number, v: number, yOffset: number): number;
  getPos(idx: number): Vec3;
  emitTriUp(i0: number, i1: number, i2: number): boolean;
  emitPolygonWithCenterOrEarClip(
    ringIndices: number[],
    centerPos: Vec3,
    centerU: number,
    centerV: number,
    yOffset: number
  ): void;
}

export interface JointContext {
  builder: IMeshBuilder;
  cacheBySegIdx: Map<number, SegmentCache>;
  segFlowEndV: Map<number, { vStart: number; vEnd: number }>;
  degree2Map: Map<string, Degree2Meta>;
  junctionMap: Map<string, JunctionMeta>;
  edgePolylines: Vec3[][];
  debugMiterPoints: Vec3[];
  debugTrimPoints: Vec3[];
  debugJunctionPolygons: Vec3[][];
  options: ResolvedRoadGeometryOptions;
}
