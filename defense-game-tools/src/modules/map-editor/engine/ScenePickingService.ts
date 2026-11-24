import * as THREE from 'three';
import {
  evaluateRoadSegmentAt,
  getMapGraph,
  snapToSegment,
  type MapDefinition,
} from '@tactical-td/shared';
import { selectionKey, type SelectionItem } from '../types';
import { disposeObjectResources } from './threeDispose';

export class ScenePickingService {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNDC = new THREE.Vector2();
  private lastHoverKey: string | null = null;

  pickSelectableAt(
    clientX: number,
    clientY: number,
    domElement: HTMLElement,
    camera: THREE.Camera,
    entityObjectMap: Map<string, THREE.Object3D>,
    roadMeshesGroup: THREE.Group,
    map: MapDefinition,
  ): SelectionItem | null {
    const rect = domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNDC.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNDC, camera);
    const hits = this.raycaster.intersectObjects(
      [...Array.from(entityObjectMap.values()), roadMeshesGroup],
      true,
    );

    let segmentHit: SelectionItem | null = null;
    for (const hit of hits) {
      let cur: THREE.Object3D | null = hit.object;
      while (cur) {
        const ud = cur.userData as {
          entityKind?: SelectionItem['type'] | 'road_component';
          entityId?: string;
          segmentIds?: string[];
        };
        if (ud.entityKind === 'road_component' && Array.isArray(ud.segmentIds)) {
          const g = getMapGraph(map);
          const segSet = new Set(ud.segmentIds);
          const compSegs = g.segments.filter((s) => segSet.has(s.id));
          const near = snapToSegment(g.nodes, compSegs, { x: hit.point.x, z: hit.point.z }, 8);
          if (near && !segmentHit) {
            segmentHit = { type: 'road_segment', id: near.segment.id };
          }
          break;
        }
        if (ud.entityKind && ud.entityKind !== 'road_component' && ud.entityId) {
          if (ud.entityKind !== 'road_segment') {
            return { type: ud.entityKind, id: ud.entityId };
          }
          if (!segmentHit) segmentHit = { type: 'road_segment', id: ud.entityId };
          break;
        }
        cur = cur.parent;
      }
    }
    return segmentHit;
  }

  updateHoverHighlight(
    item: SelectionItem | null,
    hoverGroup: THREE.Group,
    entityObjectMap: Map<string, THREE.Object3D>,
    map: MapDefinition,
  ): void {
    const nextKey = item ? selectionKey(item) : null;
    if (nextKey === this.lastHoverKey) return;
    this.lastHoverKey = nextKey;

    while (hoverGroup.children.length > 0) {
      const c = hoverGroup.children[0]!;
      hoverGroup.remove(c);
      disposeObjectResources(c);
    }

    if (!item) return;

    if (item.type === 'road_segment') {
      const { nodes, segments } = getMapGraph(map);
      const seg = segments.find((s) => s.id === item.id);
      const a = seg ? nodes.find((n) => n.id === seg.a) : undefined;
      const b = seg ? nodes.find((n) => n.id === seg.b) : undefined;
      if (seg && a && b) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 16; k++) {
          const p = evaluateRoadSegmentAt(a, b, seg, k / 16, nodes, segments).position;
          pts.push(new THREE.Vector3(p.x, p.y + 0.16, p.z));
        }
        hoverGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0x93c5fd }),
          ),
        );
      }
      return;
    }

    const obj = entityObjectMap.get(selectionKey(item));
    if (obj) {
      hoverGroup.add(new THREE.BoxHelper(obj, 0x60a5fa));
    }
  }
}
