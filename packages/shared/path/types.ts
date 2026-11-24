import type { Vec2, Vec3, WaypointElevationMode, WaypointSlopeMode } from '../types/protocol';

export interface PathSample {
  position: Vec3;
  tangent: Vec3;
  right: Vec3;
  roadWidth: number;
  distance: number;
  segmentIndex: number;
  localT: number;
  isTunnel: boolean;
  isOverpass: boolean;
}

export interface SegmentValidationIssue {
  segmentIndex: number;
  code: 'SHARP_CURVE' | 'STEEP_SLOPE';
  severity: 'warn' | 'error';
  message: string;
}

export interface SegmentMetrics {
  segmentIndex: number;
  length: number;
  startDistance: number;
  endDistance: number;
  minTurnRadius: number;
  maxSlopePct: number;
  startY: number;
  endY: number;
  elevationMode: WaypointElevationMode;
  slopeMode: WaypointSlopeMode;
  issues: SegmentValidationIssue[];
}

export interface BakedPathLut {
  readonly lutSegments: number;
  readonly totalLength: number;
  readonly positions: Float32Array;
  readonly tangents: Float32Array;
  readonly rightVectors: Float32Array;
  readonly roadWidths: Float32Array;
  readonly tunnelMask: Uint8Array;
  readonly overpassMask: Uint8Array;
  readonly segmentIndices: Uint16Array;
}

/** ISP: 2D horizontal alignment strategy for a single road span (independent of height Y). */
export interface IHorizontalSegment {
  readonly kind: 'straight' | 'curve' | 'legacy_smooth';
  readonly start: Vec2;
  readonly end: Vec2;
  readonly length: number;
  evaluatePoint(t: number): Vec2;
  evaluateTangent(t: number): Vec2;
  evaluateCurvatureRadius(t: number): number;
  getMinTurnRadius(): number;
  localDistanceAt(t: number): number;
  tAtLocalDistance(localS: number): number;
}

/** ISP: 1D vertical elevation solver over cumulative arc-length station s. */
export interface IVerticalProfile {
  evaluateHeight(stationS: number, segmentIndexHint?: number): number;
  evaluateSlope(stationS: number, segmentIndexHint?: number): number;
}

/** ISP: Pluggable geometric constraint checker (Network Anarchy). */
export interface IPathValidator {
  validateSegment(
    segIndex: number,
    horizontal: IHorizontalSegment,
    vertical: IVerticalProfile,
    startS: number,
    endS: number,
    avgRoadWidth: number,
    anarchyEnabled: boolean,
  ): SegmentValidationIssue[];
}
