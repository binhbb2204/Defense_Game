import * as THREE from 'three';
import type { WaypointNode } from '@tactical-td/shared';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Arc-length parameterized spline & road-lane lookup system.
 *
 * Pre-bakes a uniform-distance Lookup Table (LUT) into typed arrays on map load so
 * every 60Hz zombie movement & Lead Target prediction query executes in O(1) time
 * with ZERO heap allocations.
 */
export class PathSystem {
  public readonly waypoints: readonly WaypointNode[];
  public readonly defaultRoadWidth: number;
  public readonly lutSegments: number;

  private readonly curve: THREE.CatmullRomCurve3;
  private readonly totalLength: number;
  private readonly invTotalLength: number;

  // Packed typed arrays for cache-friendly O(1) sampling
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

    const controlPoints = waypoints.map((wp) => new THREE.Vector3(wp.x, wp.y, wp.z));
    // Centripetal Catmull-Rom prevents cusp/overshoot artifacts around tight corners & ramps.
    this.curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal', 0.35);
    this.curve.arcLengthDivisions = Math.max(400, lutSegments * 2);

    this.totalLength = this.curve.getLength();
    this.invTotalLength = this.totalLength > 0 ? 1 / this.totalLength : 0;

    const sampleCount = lutSegments + 1;
    this.positions = new Float32Array(sampleCount * 3);
    this.tangents = new Float32Array(sampleCount * 3);
    this.rightVectors = new Float32Array(sampleCount * 3);
    this.roadWidths = new Float32Array(sampleCount);
    this.tunnelMask = new Uint8Array(sampleCount);
    this.overpassMask = new Uint8Array(sampleCount);

    this.bakeLookupTable();
  }

  private bakeLookupTable(): void {
    const tmpPos = new THREE.Vector3();
    const tmpTan = new THREE.Vector3();
    const tmpRight = new THREE.Vector3();
    const segCount = this.waypoints.length - 1;

    for (let i = 0; i <= this.lutSegments; i++) {
      const u = i / this.lutSegments;
      const t = this.curve.getUtoTmapping(u, 0);

      this.curve.getPoint(t, tmpPos);
      this.curve.getTangent(t, tmpTan).normalize();

      // Horizontal right vector for lateral zombie horde lanes (stays level on ramps)
      tmpRight.crossVectors(tmpTan, WORLD_UP);
      if (tmpRight.lengthSq() < 1e-6) {
        tmpRight.set(1, 0, 0);
      } else {
        tmpRight.normalize();
      }

      const idx3 = i * 3;
      this.positions[idx3] = tmpPos.x;
      this.positions[idx3 + 1] = tmpPos.y;
      this.positions[idx3 + 2] = tmpPos.z;

      this.tangents[idx3] = tmpTan.x;
      this.tangents[idx3 + 1] = tmpTan.y;
      this.tangents[idx3 + 2] = tmpTan.z;

      this.rightVectors[idx3] = tmpRight.x;
      this.rightVectors[idx3 + 1] = tmpRight.y;
      this.rightVectors[idx3 + 2] = tmpRight.z;

      // Map spline parameter t back to waypoint interval metadata
      const segFloat = t * segCount;
      const segIdx = Math.min(Math.floor(segFloat), segCount - 1);
      const segAlpha = segFloat - segIdx;
      const wpA = this.waypoints[segIdx];
      const wpB = this.waypoints[segIdx + 1];

      const widthA = wpA.roadWidth ?? this.defaultRoadWidth;
      const widthB = wpB.roadWidth ?? this.defaultRoadWidth;
      this.roadWidths[i] = widthA + (widthB - widthA) * segAlpha;

      this.tunnelMask[i] = wpA.isTunnel && wpB.isTunnel ? 1 : 0;
      this.overpassMask[i] = wpA.isOverpass && wpB.isOverpass ? 1 : 0;
    }
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
   *
   * Writes directly into caller-provided `outPosition` and optional `outForward`.
   * Returns `true` when `distance >= totalLength` (entity reached the defense base).
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

    const px = this.positions[p0] + (this.positions[p1] - this.positions[p0]) * frac;
    const py =
      this.positions[p0 + 1] + (this.positions[p1 + 1] - this.positions[p0 + 1]) * frac;
    const pz =
      this.positions[p0 + 2] + (this.positions[p1 + 2] - this.positions[p0 + 2]) * frac;

    const rx =
      this.rightVectors[p0] + (this.rightVectors[p1] - this.rightVectors[p0]) * frac;
    const ry =
      this.rightVectors[p0 + 1] +
      (this.rightVectors[p1 + 1] - this.rightVectors[p0 + 1]) * frac;
    const rz =
      this.rightVectors[p0 + 2] +
      (this.rightVectors[p1 + 2] - this.rightVectors[p0 + 2]) * frac;

    const width =
      this.roadWidths[i0] + (this.roadWidths[i1] - this.roadWidths[i0]) * frac;
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
      const tx = this.tangents[p0] + (this.tangents[p1] - this.tangents[p0]) * frac;
      const ty =
        this.tangents[p0 + 1] + (this.tangents[p1 + 1] - this.tangents[p0 + 1]) * frac;
      const tz =
        this.tangents[p0 + 2] + (this.tangents[p1 + 2] - this.tangents[p0 + 2]) * frac;
      outForward.set(tx, ty, tz).normalize();
    }

    return reachedEnd;
  }

  /** O(1) check whether a unit at `distance` is currently sheltered inside a tunnel. */
  public isInTunnel(distance: number): boolean {
    const idx = this.distanceToLutIndex(distance);
    return this.tunnelMask[idx] === 1;
  }

  /** O(1) check whether a unit at `distance` is currently on an elevated overpass deck. */
  public isOnOverpass(distance: number): boolean {
    const idx = this.distanceToLutIndex(distance);
    return this.overpassMask[idx] === 1;
  }

  /** Direct LUT sample access for procedural 3D road geometry generation in World.ts. */
  public readLutSample(
    index: number,
    outPos: THREE.Vector3,
    outRight: THREE.Vector3,
    outTangent?: THREE.Vector3,
  ): number {
    const clamped = index < 0 ? 0 : index > this.lutSegments ? this.lutSegments : index;
    const i3 = clamped * 3;
    outPos.set(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2]);
    outRight.set(
      this.rightVectors[i3],
      this.rightVectors[i3 + 1],
      this.rightVectors[i3 + 2],
    );
    if (outTangent) {
      outTangent.set(this.tangents[i3], this.tangents[i3 + 1], this.tangents[i3 + 2]);
    }
    return this.roadWidths[clamped];
  }

  public isLutSampleTunnel(index: number): boolean {
    return this.tunnelMask[index] === 1;
  }

  public isLutSampleOverpass(index: number): boolean {
    return this.overpassMask[index] === 1;
  }

  /** Builds toggleable debug lines showing spline centerline, lane curbs, tunnel & waypoints. */
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

    const centerLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(centerPts),
      new THREE.LineBasicMaterial({ color: 0x38bdf8 }),
    );
    group.add(centerLine);

    const curbMat = new THREE.LineBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.5,
    });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), curbMat));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), curbMat));

    if (tunnelPts.length >= 2) {
      const tunnelLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(tunnelPts),
        new THREE.LineBasicMaterial({ color: 0xf59e0b }),
      );
      group.add(tunnelLine);
    }

    // Waypoint node markers
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
