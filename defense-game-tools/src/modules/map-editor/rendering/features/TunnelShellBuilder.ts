import * as THREE from 'three';
import {
  evaluateRoadSegmentAt,
  type RoadNode,
  type RoadSegment,
  type Vec3,
} from '@tactical-td/shared';
import { BaseRoadFeatureBuilder } from './BaseRoadFeatureBuilder';

export interface TunnelShellInput {
  nodeA: RoadNode;
  nodeB: RoadNode;
  segment: RoadSegment;
  graphNodes?: readonly RoadNode[];
  graphSegments?: readonly RoadSegment[];
  length: number;
}

/** Enclosed tunnel arch shell over tunnel segments (blocks LoS). */
export class TunnelShellBuilder extends BaseRoadFeatureBuilder<TunnelShellInput> {
  build({ nodeA, nodeB, segment, graphNodes, graphSegments, length }: TunnelShellInput): THREE.Mesh | null {
    const ringCount = Math.max(6, Math.min(32, Math.ceil(length / 2.2)));
    const samples: Array<{ position: Vec3; right: Vec3 }> = [];
    for (let k = 0; k <= ringCount; k++) {
      samples.push(evaluateRoadSegmentAt(nodeA, nodeB, segment, k / ringCount, graphNodes, graphSegments));
    }
    if (samples.length < 2) return null;

    const positions: number[] = [];
    const indices: number[] = [];
    const wallHeight = 3.8;

    for (let k = 0; k < samples.length; k++) {
      const s = samples[k]!;
      const halfW = segment.width * 0.5 + 0.5;
      const rx = s.right.x * halfW;
      const rz = s.right.z * halfW;
      const p = s.position;
      positions.push(
        p.x - rx, p.y, p.z - rz,
        p.x - rx * 0.82, p.y + wallHeight, p.z - rz * 0.82,
        p.x + rx * 0.82, p.y + wallHeight, p.z + rz * 0.82,
        p.x + rx, p.y, p.z + rz,
      );
      if (k < samples.length - 1) {
        const a = k * 4;
        const b = (k + 1) * 4;
        indices.push(a + 0, b + 0, b + 1, a + 0, b + 1, a + 1);
        indices.push(a + 1, b + 1, b + 2, a + 1, b + 2, a + 2);
        indices.push(a + 2, b + 2, b + 3, a + 2, b + 3, a + 3);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const shell = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x333842,
        roughness: 0.78,
        metalness: 0.15,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.86,
      }),
    );
    shell.name = `TunnelShell_${segment.id}`;
    shell.castShadow = true;
    shell.receiveShadow = true;
    shell.userData = { entityKind: 'road_segment', entityId: segment.id, blocksLoS: true };
    return shell;
  }
}
