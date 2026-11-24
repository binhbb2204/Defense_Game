import type { WaypointSlopeMode } from '../types/protocol';
import type { IVerticalProfile } from './types';

const EPS = 1e-6;

function findInterval(stations: readonly number[], s: number): number {
  const n = stations.length - 1;
  if (n <= 0) return 0;
  if (s <= stations[0]!) return 0;
  if (s >= stations[n]!) return n - 1;
  let lo = 0;
  let hi = n;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (stations[mid]! <= s) lo = mid;
    else hi = mid;
  }
  return Math.min(lo, n - 1);
}

/**
 * Network Anarchy `Straight Slope`: piecewise linear elevation ramp between waypoints.
 * Zero overshoot, flat horizontal bridge decks (y_i == y_{i+1}), and crisp uniform ramps.
 */
export class StraightSlopeProfile implements IVerticalProfile {
  constructor(
    private readonly stations: readonly number[],
    private readonly elevations: readonly number[],
  ) {}

  public evaluateHeight(stationS: number, segmentIndexHint?: number): number {
    if (this.elevations.length === 0) return 0;
    if (this.elevations.length === 1) return this.elevations[0]!;
    const i =
      segmentIndexHint !== undefined
        ? Math.max(0, Math.min(this.stations.length - 2, segmentIndexHint))
        : findInterval(this.stations, stationS);
    const s0 = this.stations[i]!;
    const s1 = this.stations[i + 1]!;
    const ds = s1 - s0;
    if (ds < EPS) return this.elevations[i]!;
    const t = Math.max(0, Math.min(1, (stationS - s0) / ds));
    return this.elevations[i]! + (this.elevations[i + 1]! - this.elevations[i]!) * t;
  }

  public evaluateSlope(stationS: number, segmentIndexHint?: number): number {
    if (this.elevations.length < 2) return 0;
    const i =
      segmentIndexHint !== undefined
        ? Math.max(0, Math.min(this.stations.length - 2, segmentIndexHint))
        : findInterval(this.stations, stationS);
    const ds = this.stations[i + 1]! - this.stations[i]!;
    if (ds < EPS) return 0;
    return (this.elevations[i + 1]! - this.elevations[i]!) / ds;
  }
}

/**
 * Fritsch-Carlson Monotone Cubic Hermite (PCHIP) vertical road profile.
 * Smoothly rounds top/bottom transitions of ramps while proving ZERO overshoot below y_min
 * or above y_max, and honoring per-segment `straight_slope` overrides cleanly.
 */
export class PchipMonotoneProfile implements IVerticalProfile {
  private readonly h: Float64Array;
  private readonly d: Float64Array;
  private readonly m: Float64Array;
  private readonly spanModes: readonly WaypointSlopeMode[];

  constructor(
    private readonly stations: readonly number[],
    private readonly elevations: readonly number[],
    segmentSlopeModes?: readonly WaypointSlopeMode[],
  ) {
    const n = stations.length;
    const spanCount = Math.max(0, n - 1);
    this.h = new Float64Array(spanCount);
    this.d = new Float64Array(spanCount);
    this.m = new Float64Array(n);
    this.spanModes = Array.from({ length: spanCount }, (_, idx) => segmentSlopeModes?.[idx] ?? 'pchip_smooth');

    if (n < 2) return;

    for (let i = 0; i < spanCount; i++) {
      const ds = Math.max(1e-4, stations[i + 1]! - stations[i]!);
      this.h[i] = ds;
      this.d[i] = (elevations[i + 1]! - elevations[i]!) / ds;
    }

    // Interior tangent slopes via weighted harmonic mean; sign flip => tangent = 0 (no extremum bulge)
    for (let i = 1; i < n - 1; i++) {
      const dPrev = this.d[i - 1]!;
      const dNext = this.d[i]!;
      if (dPrev * dNext <= 0 || Math.abs(dPrev) < EPS || Math.abs(dNext) < EPS) {
        this.m[i] = 0;
      } else {
        const w1 = 2 * this.h[i]! + this.h[i - 1]!;
        const w2 = this.h[i]! + 2 * this.h[i - 1]!;
        this.m[i] = (w1 + w2) / (w1 / dPrev + w2 / dNext);
      }
    }

    // Endpoint slopes (one-sided shape-preserving)
    if (n === 2) {
      this.m[0] = this.d[0]!;
      this.m[1] = this.d[0]!;
    } else {
      this.m[0] = PchipMonotoneProfile.endSlope(this.h[0]!, this.h[1]!, this.d[0]!, this.d[1]!);
      this.m[n - 1] = PchipMonotoneProfile.endSlope(
        this.h[spanCount - 1]!,
        this.h[spanCount - 2]!,
        this.d[spanCount - 1]!,
        this.d[spanCount - 2]!,
      );
    }

    // Fritsch-Carlson circle monotonicity clamp: alpha^2 + beta^2 <= 9
    for (let i = 0; i < spanCount; i++) {
      const di = this.d[i]!;
      if (Math.abs(di) < EPS || this.spanModes[i] === 'straight_slope') {
        if (Math.abs(di) < EPS) {
          this.m[i] = 0;
          this.m[i + 1] = 0;
        }
        continue;
      }
      const alpha = this.m[i]! / di;
      const beta = this.m[i + 1]! / di;
      const r2 = alpha * alpha + beta * beta;
      if (r2 > 9) {
        const tau = 3 / Math.sqrt(r2);
        this.m[i] = tau * alpha * di;
        this.m[i + 1] = tau * beta * di;
      }
    }
  }

  private static endSlope(h0: number, h1: number, d0: number, d1: number): number {
    if (Math.abs(d0) < EPS) return 0;
    let m = ((2 * h0 + h1) * d0 - h0 * d1) / Math.max(1e-4, h0 + h1);
    if (Math.sign(m) !== Math.sign(d0)) return 0;
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(m) > Math.abs(3 * d0)) {
      m = 3 * d0;
    }
    return m;
  }

  public evaluateHeight(stationS: number, segmentIndexHint?: number): number {
    const n = this.elevations.length;
    if (n === 0) return 0;
    if (n === 1) return this.elevations[0]!;
    const i =
      segmentIndexHint !== undefined
        ? Math.max(0, Math.min(n - 2, segmentIndexHint))
        : findInterval(this.stations, stationS);
    const ds = this.h[i]!;
    if (ds < EPS) return this.elevations[i]!;
    const t = Math.max(0, Math.min(1, (stationS - this.stations[i]!) / ds));

    if (this.spanModes[i] === 'straight_slope') {
      return this.elevations[i]! + (this.elevations[i + 1]! - this.elevations[i]!) * t;
    }

    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return (
      h00 * this.elevations[i]! +
      h10 * ds * this.m[i]! +
      h01 * this.elevations[i + 1]! +
      h11 * ds * this.m[i + 1]!
    );
  }

  public evaluateSlope(stationS: number, segmentIndexHint?: number): number {
    const n = this.elevations.length;
    if (n < 2) return 0;
    const i =
      segmentIndexHint !== undefined
        ? Math.max(0, Math.min(n - 2, segmentIndexHint))
        : findInterval(this.stations, stationS);
    const ds = this.h[i]!;
    if (ds < EPS) return 0;

    if (this.spanModes[i] === 'straight_slope') {
      return this.d[i]!;
    }

    const t = Math.max(0, Math.min(1, (stationS - this.stations[i]!) / ds));
    const t2 = t * t;
    const dh00 = 6 * t2 - 6 * t;
    const dh10 = 3 * t2 - 4 * t + 1;
    const dh01 = -6 * t2 + 6 * t;
    const dh11 = 3 * t2 - 2 * t;

    return (
      (dh00 * this.elevations[i]! + dh01 * this.elevations[i + 1]!) / ds +
      dh10 * this.m[i]! +
      dh11 * this.m[i + 1]!
    );
  }
}
