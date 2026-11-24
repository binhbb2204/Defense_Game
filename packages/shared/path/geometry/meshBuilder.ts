import type { Vec3 } from '../../types/protocol';
import { AREA_EPS, distSqXZ, signedAreaXZ } from './math2d';
import type { IMeshBuilder } from './types';

function pointInTriXZ(p: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const s1 = signedAreaXZ(a, b, p);
  const s2 = signedAreaXZ(b, c, p);
  const s3 = signedAreaXZ(c, a, p);
  return s1 >= -1e-6 && s2 >= -1e-6 && s3 >= -1e-6;
}

export function earClipXZ(
  polyIndices: number[],
  getPos: (idx: number) => Vec3
): Array<[number, number, number]> {
  const ring = polyIndices.slice();
  if (ring.length < 3) return [];

  let totalArea = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = getPos(ring[i]);
    const b = getPos(ring[(i + 1) % ring.length]);
    totalArea += a.z * b.x - a.x * b.z;
  }
  if (totalArea < 0) ring.reverse();

  const tris: Array<[number, number, number]> = [];
  let guard = 0;
  const maxIter = ring.length * ring.length + 10;
  while (ring.length >= 3 && guard++ < maxIter) {
    let clipped = false;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const prev = ring[(i - 1 + n) % n];
      const curr = ring[i];
      const next = ring[(i + 1) % n];
      const a = getPos(prev);
      const b = getPos(curr);
      const c = getPos(next);
      if (signedAreaXZ(a, b, c) <= AREA_EPS) continue;

      let containsOther = false;
      for (let j = 0; j < n; j++) {
        const idx = ring[j];
        if (idx === prev || idx === curr || idx === next) continue;
        if (pointInTriXZ(getPos(idx), a, b, c)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;

      tris.push([prev, curr, next]);
      ring.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  return tris;
}

export class MeshBuilder implements IMeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  addVertex(pos: Vec3, u: number, v: number, yOffset: number): number {
    const idx = this.positions.length / 3;
    this.positions.push(pos.x, pos.y + yOffset, pos.z);
    this.normals.push(0, 1, 0);
    this.uvs.push(u, v);
    return idx;
  }

  getPos(idx: number): Vec3 {
    const base = idx * 3;
    return {
      x: this.positions[base],
      y: this.positions[base + 1],
      z: this.positions[base + 2],
    };
  }

  emitTriUp(i0: number, i1: number, i2: number): boolean {
    if (i0 === i1 || i1 === i2 || i2 === i0) return false;
    const a = this.getPos(i0);
    const b = this.getPos(i1);
    const c = this.getPos(i2);
    const area = signedAreaXZ(a, b, c);
    if (Math.abs(area) <= AREA_EPS) return false;
    if (area > 0) {
      this.indices.push(i0, i1, i2);
    } else {
      this.indices.push(i0, i2, i1);
    }
    return true;
  }

  emitPolygonWithCenterOrEarClip(
    ringIndices: number[],
    centerPos: Vec3,
    centerU: number,
    centerV: number,
    yOffset: number
  ): void {
    const clean: number[] = [];
    for (const idx of ringIndices) {
      if (clean.length === 0) {
        clean.push(idx);
      } else {
        const prev = clean[clean.length - 1];
        if (idx !== prev && distSqXZ(this.getPos(idx), this.getPos(prev)) > 1e-8) {
          clean.push(idx);
        }
      }
    }
    if (
      clean.length > 2 &&
      (clean[0] === clean[clean.length - 1] ||
        distSqXZ(this.getPos(clean[0]), this.getPos(clean[clean.length - 1])) <= 1e-8)
    ) {
      clean.pop();
    }
    if (clean.length < 3) return;

    let ringArea = 0;
    for (let i = 0; i < clean.length; i++) {
      const a = this.getPos(clean[i]);
      const b = this.getPos(clean[(i + 1) % clean.length]);
      ringArea += a.z * b.x - a.x * b.z;
    }
    if (ringArea < 0) clean.reverse();

    let canFan = true;
    for (let i = 0; i < clean.length; i++) {
      const a = this.getPos(clean[i]);
      const b = this.getPos(clean[(i + 1) % clean.length]);
      if (signedAreaXZ(centerPos, a, b) <= AREA_EPS) {
        canFan = false;
        break;
      }
    }

    if (canFan) {
      const centerIdx = this.addVertex(centerPos, centerU, centerV, yOffset);
      for (let i = 0; i < clean.length; i++) {
        this.emitTriUp(centerIdx, clean[i], clean[(i + 1) % clean.length]);
      }
      return;
    }

    const tris = earClipXZ(clean, (idx) => this.getPos(idx));
    for (const [i0, i1, i2] of tris) {
      this.emitTriUp(i0, i1, i2);
    }
  }
}
