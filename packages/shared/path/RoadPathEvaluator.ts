import type {
  WaypointElevationMode,
  WaypointNode,
  WaypointSlopeMode,
} from '../types/protocol';
import { createHorizontalSegment } from './horizontalSegments';
import { RoadPathValidator } from './pathValidator';
import type {
  BakedPathLut,
  IHorizontalSegment,
  IPathValidator,
  IVerticalProfile,
  PathSample,
  SegmentMetrics,
} from './types';
import { PchipMonotoneProfile, StraightSlopeProfile } from './verticalProfiles';

export interface RoadPathEvaluatorOptions {
  defaultRoadWidth?: number;
  anarchyEnabled?: boolean;
  defaultSlopeMode?: WaypointSlopeMode;
  validator?: IPathValidator;
  loop?: boolean;
}

/**
 * Decoupled 2D Horizontal + 1D Vertical road spline evaluator.
 * Shared single source of truth between DefenseKit Studio (`defense-game-tools`)
 * and runtime `PathSystem` (`apps/client`).
 */
export class RoadPathEvaluator {
  public readonly waypoints: readonly WaypointNode[];
  public readonly defaultRoadWidth: number;
  public readonly anarchyEnabled: boolean;
  public readonly loop: boolean;
  public readonly horizontalSegments: readonly IHorizontalSegment[];
  public readonly stations: readonly number[];
  public readonly elevations: readonly number[];
  public readonly totalLength: number;
  public readonly verticalProfile: IVerticalProfile;
  private readonly validator: IPathValidator;

  constructor(waypoints: readonly WaypointNode[], options: RoadPathEvaluatorOptions = {}) {
    if (waypoints.length < 2) {
      throw new Error('RoadPathEvaluator requires at least 2 waypoints.');
    }

    const useLoop = Boolean(options.loop) && waypoints.length >= 3;
    const effectiveWaypoints = useLoop ? [...waypoints, waypoints[0]!] : waypoints;

    this.loop = useLoop;
    this.waypoints = effectiveWaypoints;
    this.defaultRoadWidth = options.defaultRoadWidth ?? 5.2;
    this.anarchyEnabled = options.anarchyEnabled ?? false;
    this.validator = options.validator ?? new RoadPathValidator();

    const segs: IHorizontalSegment[] = [];
    const stations: number[] = [0];
    const elevations: number[] = [effectiveWaypoints[0]!.y];
    const spanSlopeModes: WaypointSlopeMode[] = [];
    let cumS = 0;

    for (let i = 0; i < effectiveWaypoints.length - 1; i++) {
      const seg = createHorizontalSegment(effectiveWaypoints, i);
      segs.push(seg);
      cumS += seg.length;
      stations.push(cumS);
      elevations.push(effectiveWaypoints[i + 1]!.y);

      const defaultSpanSlope: WaypointSlopeMode =
        options.defaultSlopeMode ??
        (effectiveWaypoints[i]!.segmentMode ? 'pchip_smooth' : 'straight_slope');
      spanSlopeModes.push(effectiveWaypoints[i]!.slopeMode ?? defaultSpanSlope);
    }

    this.horizontalSegments = segs;
    this.stations = stations;
    this.elevations = elevations;
    this.totalLength = cumS;

    // Choose overall profile: pure linear if all spans are straight_slope, otherwise Fritsch-Carlson PCHIP
    const allLinear = spanSlopeModes.every((m) => m === 'straight_slope');
    this.verticalProfile = allLinear
      ? new StraightSlopeProfile(stations, elevations)
      : new PchipMonotoneProfile(stations, elevations, spanSlopeModes);
  }

  public sampleAtDistance(distance: number): PathSample {
    const segCount = this.horizontalSegments.length;
    const clampedDist = Math.max(0, Math.min(this.totalLength, distance));

    let segIdx = 0;
    while (segIdx < segCount - 1 && clampedDist > this.stations[segIdx + 1]!) {
      segIdx++;
    }

    const seg = this.horizontalSegments[segIdx]!;
    const segStartS = this.stations[segIdx]!;
    const localS = clampedDist - segStartS;
    const t = seg.tAtLocalDistance(localS);

    return this.sampleAtSegmentParameter(segIdx, t, clampedDist);
  }

  public sampleAtSegmentParameter(segIdx: number, t: number, precomputedDist?: number): PathSample {
    const seg = this.horizontalSegments[segIdx]!;
    const ct = Math.max(0, Math.min(1, t));
    const pt = seg.evaluatePoint(ct);
    const tanXZ = seg.evaluateTangent(ct);

    const dist =
      precomputedDist !== undefined
        ? precomputedDist
        : this.stations[segIdx]! + seg.localDistanceAt(ct);

    const y = this.verticalProfile.evaluateHeight(dist, segIdx);
    const slope = this.verticalProfile.evaluateSlope(dist, segIdx);

    // Build normalized 3D forward tangent & horizontal Y-up locked right vector
    const tanLen = Math.hypot(tanXZ.x, slope, tanXZ.z) || 1;
    const tx = tanXZ.x / tanLen;
    const ty = slope / tanLen;
    const tz = tanXZ.z / tanLen;

    // right = normalize(tangentXZ x (0,1,0)) = (-tanXZ.z, 0, tanXZ.x)
    const rx = -tanXZ.z;
    const rz = tanXZ.x;
    const rLen = Math.hypot(rx, rz) || 1;

    const wpA = this.waypoints[segIdx]!;
    const wpB = this.waypoints[segIdx + 1]!;
    const wA = wpA.roadWidth ?? this.defaultRoadWidth;
    const wB = wpB.roadWidth ?? this.defaultRoadWidth;

    const elevModeA = this.resolveElevationMode(wpA);
    const elevModeB = this.resolveElevationMode(wpB);

    return {
      position: { x: pt.x, y, z: pt.z },
      tangent: { x: tx, y: ty, z: tz },
      right: { x: rx / rLen, y: 0, z: rz / rLen },
      roadWidth: wA + (wB - wA) * ct,
      distance: dist,
      segmentIndex: segIdx,
      localT: ct,
      isTunnel:
        elevModeA === 'tunnel' && elevModeB === 'tunnel'
          ? true
          : Boolean(wpA.isTunnel && wpB.isTunnel),
      isOverpass:
        elevModeA === 'bridge' ||
        elevModeA === 'elevated' ||
        Boolean(wpA.isOverpass && wpB.isOverpass),
    };
  }

  public bakeLut(lutSegments = 512): BakedPathLut {
    const count = lutSegments + 1;
    const positions = new Float32Array(count * 3);
    const tangents = new Float32Array(count * 3);
    const rightVectors = new Float32Array(count * 3);
    const roadWidths = new Float32Array(count);
    const tunnelMask = new Uint8Array(count);
    const overpassMask = new Uint8Array(count);
    const segmentIndices = new Uint16Array(count);

    for (let i = 0; i <= lutSegments; i++) {
      const dist = (this.totalLength * i) / lutSegments;
      const sample = this.sampleAtDistance(dist);
      const i3 = i * 3;
      positions[i3] = sample.position.x;
      positions[i3 + 1] = sample.position.y;
      positions[i3 + 2] = sample.position.z;

      tangents[i3] = sample.tangent.x;
      tangents[i3 + 1] = sample.tangent.y;
      tangents[i3 + 2] = sample.tangent.z;

      rightVectors[i3] = sample.right.x;
      rightVectors[i3 + 1] = sample.right.y;
      rightVectors[i3 + 2] = sample.right.z;

      roadWidths[i] = sample.roadWidth;
      tunnelMask[i] = sample.isTunnel ? 1 : 0;
      overpassMask[i] = sample.isOverpass ? 1 : 0;
      segmentIndices[i] = sample.segmentIndex;
    }

    return {
      lutSegments,
      totalLength: this.totalLength,
      positions,
      tangents,
      rightVectors,
      roadWidths,
      tunnelMask,
      overpassMask,
      segmentIndices,
    };
  }

  public evaluateSegmentMetrics(): SegmentMetrics[] {
    return this.horizontalSegments.map((seg, i) => {
      const wpA = this.waypoints[i]!;
      const wpB = this.waypoints[i + 1]!;
      const startS = this.stations[i]!;
      const endS = this.stations[i + 1]!;
      const avgW = ((wpA.roadWidth ?? this.defaultRoadWidth) + (wpB.roadWidth ?? this.defaultRoadWidth)) * 0.5;
      const issues = this.validator.validateSegment(
        i,
        seg,
        this.verticalProfile,
        startS,
        endS,
        avgW,
        this.anarchyEnabled,
      );

      let maxSlopePct = 0;
      for (let k = 0; k <= 10; k++) {
        const s = startS + ((endS - startS) * k) / 10;
        const pct = Math.abs(this.verticalProfile.evaluateSlope(s, i)) * 100;
        if (pct > maxSlopePct) maxSlopePct = pct;
      }

      return {
        segmentIndex: i,
        length: seg.length,
        startDistance: startS,
        endDistance: endS,
        minTurnRadius: seg.getMinTurnRadius(),
        maxSlopePct,
        startY: wpA.y,
        endY: wpB.y,
        elevationMode: this.resolveElevationMode(wpA),
        slopeMode: wpA.slopeMode ?? (wpA.segmentMode ? 'pchip_smooth' : 'straight_slope'),
        issues,
      };
    });
  }

  /** Finds closest point on any road segment in XZ plane (used for Insert WP on Segment). */
  public findClosestPointXZ(
    x: number,
    z: number,
  ): { segIndex: number; t: number; sample: PathSample; distanceXZ: number } | null {
    if (this.horizontalSegments.length === 0) return null;
    let bestSeg = 0;
    let bestT = 0;
    let bestDistSq = Infinity;

    for (let i = 0; i < this.horizontalSegments.length; i++) {
      const seg = this.horizontalSegments[i]!;
      const steps = 28;
      let coarseT = 0;
      let coarseDistSq = Infinity;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const p = seg.evaluatePoint(t);
        const dSq = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (dSq < coarseDistSq) {
          coarseDistSq = dSq;
          coarseT = t;
        }
      }

      // Ternary refinement around coarse minimum
      let lo = Math.max(0, coarseT - 1 / steps);
      let hi = Math.min(1, coarseT + 1 / steps);
      for (let it = 0; it < 12; it++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        const p1 = seg.evaluatePoint(m1);
        const p2 = seg.evaluatePoint(m2);
        const d1 = (p1.x - x) * (p1.x - x) + (p1.z - z) * (p1.z - z);
        const d2 = (p2.x - x) * (p2.x - x) + (p2.z - z) * (p2.z - z);
        if (d1 < d2) hi = m2;
        else lo = m1;
      }
      const refinedT = (lo + hi) * 0.5;
      const rp = seg.evaluatePoint(refinedT);
      const rDistSq = (rp.x - x) * (rp.x - x) + (rp.z - z) * (rp.z - z);

      if (rDistSq < bestDistSq) {
        bestDistSq = rDistSq;
        bestSeg = i;
        bestT = refinedT;
      }
    }

    return {
      segIndex: bestSeg,
      t: bestT,
      sample: this.sampleAtSegmentParameter(bestSeg, bestT),
      distanceXZ: Math.sqrt(bestDistSq),
    };
  }

  private resolveElevationMode(wp: WaypointNode): WaypointElevationMode {
    if (wp.elevationMode) return wp.elevationMode;
    if (wp.isTunnel) return 'tunnel';
    if (wp.isOverpass || wp.y > 0.5) return 'bridge';
    return 'ground';
  }
}
