import * as THREE from 'three';
import { getMapGraph, type MapDefinition } from '@tactical-td/shared';
import { disposeObjectResources } from './threeDispose';

export function runLosProbeQuery(
  origin: THREE.Vector3,
  map: MapDefinition,
  blockerMeshes: readonly THREE.Object3D[],
  losGroup: THREE.Group,
): { visible: number; blocked: number } {
  while (losGroup.children.length > 0) {
    const child = losGroup.children[0]!;
    losGroup.remove(child);
    disposeObjectResources(child);
  }

  const originMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xeab308 }),
  );
  originMarker.position.copy(origin);
  losGroup.add(originMarker);

  const raycaster = new THREE.Raycaster();
  let visible = 0;
  let blocked = 0;
  const { nodes } = getMapGraph(map);

  for (const n of nodes) {
    const target = new THREE.Vector3(n.x, n.y + 0.9, n.z);
    const dir = target.clone().sub(origin);
    const dist = dir.length();
    if (dist < 0.1) continue;
    dir.normalize();
    raycaster.set(origin, dir);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects([...blockerMeshes], true);
    const isBlocked = hits.length > 0;
    if (isBlocked) blocked++;
    else visible++;
    losGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([origin, isBlocked ? hits[0]!.point : target]),
        new THREE.LineBasicMaterial({ color: isBlocked ? 0xef4444 : 0x22c55e }),
      ),
    );
  }

  return { visible, blocked };
}
