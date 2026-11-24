import * as THREE from 'three';
import {
  RoadPathEvaluator,
  type BakedPathLut,
  type WaypointNode,
} from '@tactical-td/shared';

/**
 * Arc-length parameterized spline & road-lane lookup system.
 *
 * Delegates math to `@tactical-td/shared` `RoadPathEvaluator` (Decoupled 2D Horizontal
 * Straight/Quadratic-Bezier + 1D Vertical StraightSlope/Fritsch-Carlson PCHIP) so
 * Zombie pathing and turret Lead Target prediction match Map Studio 1:1 with zero
 * vertical overshoot and O(1) runtime lookup.
 */
export class PathSystem {
  public readonly waypoints: readonly WaypointNode[];
  public readonly defaultRoadWidth: number;
  public readonly lutSegments: number;
  public readonly evaluator: RoadPathEvaluator;

  private readonly lut: BakedPathLut;
  private readonly totalLength: number;
  private readonly invTotalLength: number;

  private readonly positions: Float32Array;
  private readonly tangents: Float32Array;
  private readonly rightVectors: Float32Array;
  private readonly roadWidths: Float32Array;
  private readonly tunnelMask: Uint8Array;
  private readonly overpassMask: Uint8Array;

  constructor(
    waypoints: readonly WaypointNode[],
    defaultRoadWidth = 5.2,
    lutSegments = 512,
  ) {
    if (waypoints.length < 2) {
      throw new Error('PathSystem requires at least 2 waypoints.');
    }

    this.waypoints = waypoints;
    this.defaultRoadWidth = defaultRoadWidth;
    this.lutSegments = lutSegments;

    this.evaluator = new RoadPathEvaluator(waypoints, { defaultRoadWidth });
    this.lut = this.evaluator.bakeLut(lutSegments);

    this.totalLength = this.lut.totalLength;
    this.invTotalLength = this.totalLength > 0 ? 1 / this.totalLength : 0;

    this.positions = this.lut.positions;
    this.tangents = this.lut.tangents;
    this.rightVectors = this.lut.rightVectors;
    this.roadWidths = this.lut.roadWidths;
    this.tunnelMask = this.lut.tunnelMask;
    this.overpassMask = this.lut.overpassMask;
  }

  public getTotalLength(): number {
    return this.totalLength;
  }

  public getProgress(distance: number): number {
    const p = distance * this.invTotalLength;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  /**
   * Samples exact world position & forward tangent at `distance` along the path
   * with a lateral lane offset `laneOffsetNormalized` in [-1, +1].
   */
  public sampleAtDistance(
    distance: number,
    laneOffsetNormalized: number,
    outPosition: THREE.Vector3,
    outForward?: THREE.Vector3,
    curbMargin = 0.65,
  ): boolean {
    const reachedEnd = distance >= this.totalLength;
    const clampedDist =
      distance <= 0 ? 0 : reachedEnd ? this.totalLength : distance;

    const u = clampedDist * this.invTotalLength;
    const fIdx = u * this.lutSegments;
    const i0 = Math.min(Math.floor(fIdx), this.lutSegments - 1);
    const i1 = i0 + 1;
    const frac = fIdx - i0;

    const p0 = i0 * 3;
    const p1 = i1 * 3;

    const px = this.positions[p0]! + (this.positions[p1]! - this.positions[p0]!) * frac;
    const py = this.positions[p0 + 1]! + (this.positions[p1 + 1]! - this.positions[p0 + 1]!) * frac;
    const pz = this.positions[p0 + 2]! + (this.positions[p1 + 2]! - this.positions[p0 + 2]!) * frac;

    const rx = this.rightVectors[p0]! + (this.rightVectors[p1]! - this.rightVectors[p0]!) * frac;
    const ry = this.rightVectors[p0 + 1]! + (this.rightVectors[p1 + 1]! - this.rightVectors[p0 + 1]!) * frac;
    const rz = this.rightVectors[p0 + 2]! + (this.rightVectors[p1 + 2]! - this.rightVectors[p0 + 2]!) * frac;

    const width = this.roadWidths[i0]! + (this.roadWidths[i1]! - this.roadWidths[i0]!) * frac;
    const maxLateral = Math.max(0.25, width * 0.5 - curbMargin);
    const clampedLane =
      laneOffsetNormalized < -1 ? -1 : laneOffsetNormalized > 1 ? 1 : laneOffsetNormalized;
    const lateralMeters = clampedLane * maxLateral;

    outPosition.set(
      px + rx * lateralMeters,
      py + ry * lateralMeters,
      pz + rz * lateralMeters,
    );

    if (outForward) {
      const tx = this.tangents[p0]! + (this.tangents[p1]! - this.tangents[p0]!) * frac;
      const ty = this.tangents[p0 + 1]! + (this.tangents[p1 + 1]! - this.tangents[p0 + 1]!) * frac;
      const tz = this.tangents[p0 + 2]! + (this.tangents[p1 + 2]! - this.tangents[p0 + 2]!) * frac;
      outForward.set(tx, ty, tz).normalize();
    }

    return reachedEnd;
  }

  public isInTunnel(distance: number): boolean {
    const idx = this.distanceToLutIndex(distance);
    return this.tunnelMask[idx] === 1;
  }

  public isOnOverpass(distance: number): boolean {
    const idx = this.distanceToLutIndex(distance);
    return this.overpassMask[idx] === 1;
  }

  public readLutSample(
    index: number,
    outPos: THREE.Vector3,
    outRight: THREE.Vector3,
    outTangent?: THREE.Vector3,
  ): number {
    const clamped = index < 0 ? 0 : index > this.lutSegments ? this.lutSegments : index;
    const i3 = clamped * 3;
    outPos.set(this.positions[i3]!, this.positions[i3 + 1]!, this.positions[i3 + 2]!);
    outRight.set(this.rightVectors[i3]!, this.rightVectors[i3 + 1]!, this.rightVectors[i3 + 2]!);
    if (outTangent) {
      outTangent.set(this.tangents[i3]!, this.tangents[i3 + 1]!, this.tangents[i3 + 2]!);
    }
    return this.roadWidths[clamped]!;
  }

  public isLutSampleTunnel(index: number): boolean {
    return this.tunnelMask[index] === 1;
  }

  public isLutSampleOverpass(index: number): boolean {
    return this.overpassMask[index] === 1;
  }

  public createDebugVisual(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'PathSystem_DebugVisual';

    const centerPts: THREE.Vector3[] = [];
    const leftPts: THREE.Vector3[] = [];
    const rightPts: THREE.Vector3[] = [];
    const tunnelPts: THREE.Vector3[] = [];

    const p = new THREE.Vector3();
    const r = new THREE.Vector3();
    const step = 4;

    for (let i = 0; i <= this.lutSegments; i += step) {
      const width = this.readLutSample(i, p, r);
      const half = width * 0.5;

      centerPts.push(new THREE.Vector3(p.x, p.y + 0.22, p.z));
      leftPts.push(new THREE.Vector3(p.x - r.x * half, p.y + 0.18, p.z - r.z * half));
      rightPts.push(new THREE.Vector3(p.x + r.x * half, p.y + 0.18, p.z + r.z * half));

      if (this.tunnelMask[i] === 1) {
        tunnelPts.push(new THREE.Vector3(p.x, p.y + 0.32, p.z));
      }
    }

    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(centerPts),
        new THREE.LineBasicMaterial({ color: 0x38bdf8 }),
      ),
    );

    const curbMat = new THREE.LineBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.5,
    });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), curbMat));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), curbMat));

    if (tunnelPts.length >= 2) {
      group.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(tunnelPts),
          new THREE.LineBasicMaterial({ color: 0xf59e0b }),
        ),
      );
    }

    const markerGeo = new THREE.SphereGeometry(0.32, 10, 8);
    const defaultMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    const overpassMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
    const tunnelMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });

    for (const wp of this.waypoints) {
      const mat = wp.isTunnel ? tunnelMat : wp.isOverpass ? overpassMat : defaultMat;
      const marker = new THREE.Mesh(markerGeo, mat);
      marker.position.set(wp.x, wp.y + 0.35, wp.z);
      group.add(marker);
    }

    return group;
  }

  private distanceToLutIndex(distance: number): number {
    if (distance <= 0) return 0;
    if (distance >= this.totalLength) return this.lutSegments;
    return Math.round(distance * this.invTotalLength * this.lutSegments);
  }
}
