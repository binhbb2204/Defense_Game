import type { Vec2, WaypointNode } from '../types/protocol';
import type { IHorizontalSegment } from './types';

const EPS = 1e-6;

function buildArcTable(
  steps: number,
  evalPt: (t: number) => Vec2,
): { cumLen: Float64Array; total: number } {
  const cumLen = new Float64Array(steps + 1);
  let prev = evalPt(0);
  let total = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cur = evalPt(t);
    total += Math.hypot(cur.x - prev.x, cur.z - prev.z);
    cumLen[i] = total;
    prev = cur;
  }
  return { cumLen, total };
}

function lookupT(cumLen: Float64Array, total: number, localS: number): number {
  const steps = cumLen.length - 1;
  if (total < EPS || steps <= 0) return 0;
  const s = Math.max(0, Math.min(total, localS));
  let lo = 0;
  let hi = steps;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumLen[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const s0 = cumLen[lo]!;
  const s1 = cumLen[hi]!;
  const frac = s1 > s0 + EPS ? (s - s0) / (s1 - s0) : 0;
  return (lo + frac) / steps;
}

function lookupLocalS(cumLen: Float64Array, t: number): number {
  const steps = cumLen.length - 1;
  if (steps <= 0) return 0;
  const ct = Math.max(0, Math.min(1, t));
  const f = ct * steps;
  const i0 = Math.min(Math.floor(f), steps - 1);
  const frac = f - i0;
  return cumLen[i0]! + (cumLen[i0 + 1]! - cumLen[i0]!) * frac;
}

/** Exact straight-line horizontal segment. Zero lateral wobble regardless of neighbors. */
export class StraightHorizontalSegment implements IHorizontalSegment {
  public readonly kind = 'straight' as const;
  public readonly length: number;
  private readonly dx: number;
  private readonly dz: number;

  constructor(
    public readonly start: Vec2,
    public readonly end: Vec2,
  ) {
    this.dx = end.x - start.x;
    this.dz = end.z - start.z;
    this.length = Math.hypot(this.dx, this.dz);
  }

  public evaluatePoint(t: number): Vec2 {
    const ct = Math.max(0, Math.min(1, t));
    return {
      x: this.start.x + this.dx * ct,
      z: this.start.z + this.dz * ct,
    };
  }

  public evaluateTangent(_t: number): Vec2 {
    if (this.length < EPS) return { x: 1, z: 0 };
    return { x: this.dx / this.length, z: this.dz / this.length };
  }

  public evaluateCurvatureRadius(_t: number): number {
    return Infinity;
  }

  public getMinTurnRadius(): number {
    return Infinity;
  }

  public localDistanceAt(t: number): number {
    return Math.max(0, Math.min(1, t)) * this.length;
  }

  public tAtLocalDistance(localS: number): number {
    if (this.length < EPS) return 0;
    return Math.max(0, Math.min(1, localS / this.length));
  }
}

/** Quadratic Bezier horizontal segment with analytic curvature + arc-length table. */
export class QuadraticBezierHorizontalSegment implements IHorizontalSegment {
  public readonly kind = 'curve' as const;
  public readonly length: number;
  private readonly cumLen: Float64Array;
  private readonly minRadius: number;

  constructor(
    public readonly start: Vec2,
    public readonly control: Vec2,
    public readonly end: Vec2,
  ) {
    const { cumLen, total } = buildArcTable(48, (t) => this.evaluatePoint(t));
    this.cumLen = cumLen;
    this.length = total;

    let minR = Infinity;
    for (let i = 0; i <= 24; i++) {
      const r = this.evaluateCurvatureRadius(i / 24);
      if (r < minR) minR = r;
    }
    this.minRadius = minR;
  }

  public evaluatePoint(t: number): Vec2 {
    const u = Math.max(0, Math.min(1, t));
    const inv = 1 - u;
    return {
      x: inv * inv * this.start.x + 2 * inv * u * this.control.x + u * u * this.end.x,
      z: inv * inv * this.start.z + 2 * inv * u * this.control.z + u * u * this.end.z,
    };
  }

  public evaluateTangent(t: number): Vec2 {
    const d1 = this.firstDerivative(t);
    const len = Math.hypot(d1.x, d1.z);
    if (len < EPS) {
      const fallback = Math.hypot(this.end.x - this.start.x, this.end.z - this.start.z);
      if (fallback < EPS) return { x: 1, z: 0 };
      return {
        x: (this.end.x - this.start.x) / fallback,
        z: (this.end.z - this.start.z) / fallback,
      };
    }
    return { x: d1.x / len, z: d1.z / len };
  }

  public evaluateCurvatureRadius(t: number): number {
    const d1 = this.firstDerivative(t);
    const d2 = this.secondDerivative();
    const speed2 = d1.x * d1.x + d1.z * d1.z;
    const speed3 = speed2 * Math.sqrt(speed2);
    const cross = Math.abs(d1.x * d2.z - d1.z * d2.x);
    if (cross < 1e-6) return Infinity;
    return speed3 / cross;
  }

  public getMinTurnRadius(): number {
    return this.minRadius;
  }

  public localDistanceAt(t: number): number {
    return lookupLocalS(this.cumLen, t);
  }

  public tAtLocalDistance(localS: number): number {
    return lookupT(this.cumLen, this.length, localS);
  }

  /** De Casteljau subdivision preserving exact Bezier shape when inserting a midpoint. */
  public splitAt(t: number): { leftControl: Vec2; midPoint: Vec2; rightControl: Vec2 } {
    const u = Math.max(0.01, Math.min(0.99, t));
    const leftControl = {
      x: this.start.x + (this.control.x - this.start.x) * u,
      z: this.start.z + (this.control.z - this.start.z) * u,
    };
    const rightControl = {
      x: this.control.x + (this.end.x - this.control.x) * u,
      z: this.control.z + (this.end.z - this.control.z) * u,
    };
    const midPoint = {
      x: leftControl.x + (rightControl.x - leftControl.x) * u,
      z: leftControl.z + (rightControl.z - leftControl.z) * u,
    };
    return { leftControl, midPoint, rightControl };
  }

  private firstDerivative(t: number): Vec2 {
    const u = Math.max(0, Math.min(1, t));
    return {
      x: 2 * (1 - u) * (this.control.x - this.start.x) + 2 * u * (this.end.x - this.control.x),
      z: 2 * (1 - u) * (this.control.z - this.start.z) + 2 * u * (this.end.z - this.control.z),
    };
  }

  private secondDerivative(): Vec2 {
    return {
      x: 2 * (this.end.x - 2 * this.control.x + this.start.x),
      z: 2 * (this.end.z - 2 * this.control.z + this.start.z),
    };
  }
}

/**
 * 2D Centripetal Catmull-Rom fallback ONLY for legacy waypoints whose `segmentMode` is omitted.
 * Crucially omits Y coordinates so bridges never suffer vertical spline overshoot.
 */
export class SmoothLegacyHorizontalSegment implements IHorizontalSegment {
  public readonly kind = 'legacy_smooth' as const;
  public readonly start: Vec2;
  public readonly end: Vec2;
  public readonly length: number;
  private readonly p0: Vec2;
  private readonly p1: Vec2;
  private readonly p2: Vec2;
  private readonly p3: Vec2;
  private readonly cumLen: Float64Array;
  private readonly minRadius: number;

  constructor(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2) {
    this.p0 = p0;
    this.p1 = p1;
    this.p2 = p2;
    this.p3 = p3;
    this.start = p1;
    this.end = p2;

    const { cumLen, total } = buildArcTable(40, (t) => this.evaluatePoint(t));
    this.cumLen = cumLen;
    this.length = total;

    let minR = Infinity;
    for (let i = 1; i < 20; i++) {
      const r = this.evaluateCurvatureRadius(i / 20);
      if (r < minR) minR = r;
    }
    this.minRadius = minR;
  }

  public evaluatePoint(t: number): Vec2 {
    const u = Math.max(0, Math.min(1, t));
    const alpha = 0.35;
    const distPow = (a: Vec2, b: Vec2) => Math.max(1e-3, Math.pow(Math.hypot(b.x - a.x, b.z - a.z), alpha));
    const t0 = 0;
    const t1 = t0 + distPow(this.p0, this.p1);
    const t2 = t1 + distPow(this.p1, this.p2);
    const t3 = t2 + distPow(this.p2, this.p3);
    const tt = t1 + u * (t2 - t1);

    const mix = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
      const denom = Math.max(EPS, tb - ta);
      const w = (tt - ta) / denom;
      return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
    };

    const a1 = mix(this.p0, this.p1, t0, t1);
    const a2 = mix(this.p1, this.p2, t1, t2);
    const a3 = mix(this.p2, this.p3, t2, t3);
    const b1 = mix(a1, a2, t0, t2);
    const b2 = mix(a2, a3, t1, t3);
    return mix(b1, b2, t1, t2);
  }

  public evaluateTangent(t: number): Vec2 {
    const h = 1e-3;
    const a = this.evaluatePoint(Math.max(0, t - h));
    const b = this.evaluatePoint(Math.min(1, t + h));
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < EPS) {
      const baseLen = Math.hypot(this.end.x - this.start.x, this.end.z - this.start.z);
      return baseLen < EPS
        ? { x: 1, z: 0 }
        : { x: (this.end.x - this.start.x) / baseLen, z: (this.end.z - this.start.z) / baseLen };
    }
    return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
  }

  public evaluateCurvatureRadius(t: number): number {
    const h = 0.02;
    const t0 = Math.max(0, t - h);
    const t2 = Math.min(1, t + h);
    const a = this.evaluatePoint(t0);
    const b = this.evaluatePoint((t0 + t2) * 0.5);
    const c = this.evaluatePoint(t2);
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ac = Math.hypot(c.x - a.x, c.z - a.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (area2 < 1e-5) return Infinity;
    return (ab * bc * ac) / (2 * area2);
  }

  public getMinTurnRadius(): number {
    return this.minRadius;
  }

  public localDistanceAt(t: number): number {
    return lookupLocalS(this.cumLen, t);
  }

  public tAtLocalDistance(localS: number): number {
    return lookupT(this.cumLen, this.length, localS);
  }
}

/** Factory selecting the horizontal strategy for segment `segIdx -> segIdx + 1`. */
export function createHorizontalSegment(
  waypoints: readonly WaypointNode[],
  segIdx: number,
): IHorizontalSegment {
  const a = waypoints[segIdx]!;
  const b = waypoints[segIdx + 1]!;
  const pA: Vec2 = { x: a.x, z: a.z };
  const pB: Vec2 = { x: b.x, z: b.z };

  if (a.segmentMode === 'straight') {
    return new StraightHorizontalSegment(pA, pB);
  }

  if (a.segmentMode === 'curve') {
    const ctrl: Vec2 = a.curveControl ?? {
      x: (a.x + b.x) * 0.5,
      z: (a.z + b.z) * 0.5,
    };
    return new QuadraticBezierHorizontalSegment(pA, ctrl, pB);
  }

  // Legacy waypoints without explicit `segmentMode`: extrapolated phantom endpoints
  const prev = waypoints[segIdx - 1];
  const next = waypoints[segIdx + 2];
  const p0: Vec2 = prev ? { x: prev.x, z: prev.z } : { x: a.x - (b.x - a.x), z: a.z - (b.z - a.z) };
  const p3: Vec2 = next ? { x: next.x, z: next.z } : { x: b.x + (b.x - a.x), z: b.z + (b.z - a.z) };
  return new SmoothLegacyHorizontalSegment(p0, pA, pB, p3);
}
