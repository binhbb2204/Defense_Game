import * as THREE from 'three';
import type { RoadGeometryResult } from '@tactical-td/shared';
import { BaseRoadFeatureBuilder } from './BaseRoadFeatureBuilder';

export interface RoadArrowsInput {
  arrows: RoadGeometryResult['arrowStrips'];
  colorHex: number;
  opacity: number;
}

/** Merges all directional arrowStrips into ONE THREE.Mesh geometry. */
export class RoadArrowsBuilder extends BaseRoadFeatureBuilder<RoadArrowsInput> {
  build({ arrows, colorHex, opacity }: RoadArrowsInput): THREE.Mesh | null {
    if (arrows.length === 0) return null;

    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < arrows.length; i++) {
      const arr = arrows[i]!;
      const dx = arr.direction.x;
      const dz = arr.direction.z;
      const rx = -dz;
      const rz = dx;
      const hw = arr.width * 0.5;
      const hl = arr.length * 0.5;
      const y = arr.position.y + 0.025;

      const tipX = arr.position.x + dx * hl;
      const tipZ = arr.position.z + dz * hl;
      const rwX = arr.position.x - dx * hl * 0.65 + rx * hw;
      const rwZ = arr.position.z - dz * hl * 0.65 + rz * hw;
      const notchX = arr.position.x - dx * hl * 0.12;
      const notchZ = arr.position.z - dz * hl * 0.12;
      const lwX = arr.position.x - dx * hl * 0.65 - rx * hw;
      const lwZ = arr.position.z - dz * hl * 0.65 - rz * hw;

      const base = i * 4;
      positions.push(tipX, y, tipZ, rwX, y, rwZ, notchX, y, notchZ, lwX, y, lwZ);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: colorHex,
        side: THREE.DoubleSide,
        transparent: opacity < 1,
        opacity,
      }),
    );
    mesh.name = 'RoadFlowChevrons';
    return mesh;
  }
}
