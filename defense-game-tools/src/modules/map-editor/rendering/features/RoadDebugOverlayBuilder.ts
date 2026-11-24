import * as THREE from 'three';
import type { RoadGeometryResult } from '@tactical-td/shared';
import { buildPolylinesMesh } from '../RoadAsphaltMaterial';
import { BaseRoadFeatureBuilder } from './BaseRoadFeatureBuilder';

export interface RoadDebugOverlayInput {
  geom: RoadGeometryResult;
  surfaceGeo: THREE.BufferGeometry;
}

/** Renders road debug visualization: centrelines, offset edges, trim/miter points, junction polygons, wireframe. */
export class RoadDebugOverlayBuilder extends BaseRoadFeatureBuilder<RoadDebugOverlayInput> {
  build({ geom, surfaceGeo }: RoadDebugOverlayInput): THREE.Group {
    const debugGroup = new THREE.Group();
    debugGroup.name = 'RoadDebugGroup';

    const wire = new THREE.Mesh(
      surfaceGeo,
      new THREE.MeshBasicMaterial({
        color: 0x10b981,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        depthTest: true,
      }),
    );
    wire.position.y = 0.012;
    debugGroup.add(wire);

    const centreMesh = buildPolylinesMesh(geom.debug.centrelines, 0x22d3ee, 0.07, 0.95);
    if (centreMesh) debugGroup.add(centreMesh);

    const leftRaw = geom.debug.offsetEdges.map((o) => o.left);
    const rightRaw = geom.debug.offsetEdges.map((o) => o.right);
    const offsetL = buildPolylinesMesh(leftRaw, 0x94a3b8, 0.06, 0.65);
    const offsetR = buildPolylinesMesh(rightRaw, 0x94a3b8, 0.06, 0.65);
    if (offsetL) debugGroup.add(offsetL);
    if (offsetR) debugGroup.add(offsetR);

    const closedRings = geom.debug.junctionPolygons.map((poly) =>
      poly.length >= 2 ? [...poly, poly[0]!] : poly,
    );
    const jMesh = buildPolylinesMesh(closedRings, 0xa855f7, 0.085, 0.95);
    if (jMesh) debugGroup.add(jMesh);

    if (geom.debug.trimPoints.length > 0) {
      const trimGeo = new THREE.BoxGeometry(0.18, 0.14, 0.18);
      const trimMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
      const inst = new THREE.InstancedMesh(trimGeo, trimMat, geom.debug.trimPoints.length);
      const dummy = new THREE.Object3D();
      geom.debug.trimPoints.forEach((p, idx) => {
        dummy.position.set(p.x, p.y + 0.11, p.z);
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      debugGroup.add(inst);
    }

    if (geom.debug.miterPoints.length > 0) {
      const mGeo = new THREE.OctahedronGeometry(0.16, 0);
      const mMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
      const inst = new THREE.InstancedMesh(mGeo, mMat, geom.debug.miterPoints.length);
      const dummy = new THREE.Object3D();
      geom.debug.miterPoints.forEach((p, idx) => {
        dummy.position.set(p.x, p.y + 0.14, p.z);
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      debugGroup.add(inst);
    }

    return debugGroup;
  }
}
