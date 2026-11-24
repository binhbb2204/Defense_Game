import * as THREE from 'three';
import { evaluateRoadSegmentAt, type RoadNode, type RoadSegment } from '@tactical-td/shared';
import { BaseRoadFeatureBuilder } from './BaseRoadFeatureBuilder';

export interface BridgePillarInput {
  nodeA: RoadNode;
  nodeB: RoadNode;
  segment: RoadSegment;
  graphNodes?: readonly RoadNode[];
  graphSegments?: readonly RoadSegment[];
  length: number;
}

/** Attaches bridge support pillars below elevated road segments down to y = 0. */
export class BridgePillarBuilder extends BaseRoadFeatureBuilder<BridgePillarInput> {
  build({ nodeA, nodeB, segment, graphNodes, graphSegments, length }: BridgePillarInput): THREE.Group | null {
    const group = new THREE.Group();
    const count = Math.max(1, Math.floor(length / 12));
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x525866,
      roughness: 0.85,
      metalness: 0.1,
    });

    for (let k = 0; k <= count; k++) {
      const t = k / Math.max(1, count);
      const sample = evaluateRoadSegmentAt(nodeA, nodeB, segment, t, graphNodes, graphSegments);
      if (sample.position.y < 0.75) continue;
      const h = sample.position.y - 0.15;
      if (h <= 0.3) continue;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.58, h, 10), pillarMat);
      pillar.name = `Pillar_${segment.id}_${k}`;
      pillar.position.set(sample.position.x, h * 0.5, sample.position.z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      pillar.userData = { entityKind: 'road_segment', entityId: segment.id, blocksLoS: true };
      group.add(pillar);
    }

    return group.children.length > 0 ? group : null;
  }
}
