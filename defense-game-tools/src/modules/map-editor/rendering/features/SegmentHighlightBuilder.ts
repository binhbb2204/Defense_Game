import * as THREE from 'three';
import {
  sampleCenterline,
  type RoadNode,
  type RoadSegment,
} from '@tactical-td/shared';
import { buildPolylinesMesh } from '../RoadAsphaltMaterial';
import { BaseRoadFeatureBuilder } from './BaseRoadFeatureBuilder';

export interface SegmentHighlightInput {
  nodeA: RoadNode;
  nodeB: RoadNode;
  segment: RoadSegment;
  graphNodes?: readonly RoadNode[];
  graphSegments?: readonly RoadSegment[];
  colorHex: number;
  opacity: number;
  yRaise: number;
}

/** Builds a selection / hover / hazard highlight ribbon overlay for a single segment along its exact derived curve. */
export class SegmentHighlightBuilder extends BaseRoadFeatureBuilder<SegmentHighlightInput> {
  build({
    nodeA,
    nodeB,
    segment,
    graphNodes,
    graphSegments,
    colorHex,
    opacity,
    yRaise,
  }: SegmentHighlightInput): THREE.Group | null {
    const samples = sampleCenterline(
      {
        segment,
        nodes: graphNodes ?? [nodeA, nodeB],
        segments: graphSegments ?? [segment],
      },
      1.2,
      (5 * Math.PI) / 180,
    );
    if (samples.length < 2) return null;

    const halfW = Math.max(0.25, segment.width * 0.5);
    const positions: number[] = [];
    const indices: number[] = [];
    const leftEdge: Array<{ x: number; y: number; z: number }> = [];
    const rightEdge: Array<{ x: number; y: number; z: number }> = [];

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!;
      const len = Math.hypot(s.tangent.x, s.tangent.z) || 1;
      const lx = (s.tangent.z / len) * halfW;
      const lz = (-s.tangent.x / len) * halfW;
      const y = s.y + yRaise;
      const lp = { x: s.x + lx, y, z: s.z + lz };
      const rp = { x: s.x - lx, y, z: s.z - lz };
      positions.push(lp.x, lp.y, lp.z, rp.x, rp.y, rp.z);
      leftEdge.push(lp);
      rightEdge.push(rp);

      if (i < samples.length - 1) {
        const b = i * 2;
        indices.push(b, b + 1, b + 3, b, b + 3, b + 2);
      }
    }

    const g = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.userData = { entityKind: 'road_segment', entityId: segment.id };
    g.add(mesh);

    const edgeLines = buildPolylinesMesh([leftEdge, rightEdge], colorHex, 0.025, 0.95);
    if (edgeLines) g.add(edgeLines);
    return g;
  }
}
