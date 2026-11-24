import type * as THREE from 'three';
import {
  getMapGraph,
  moveRoadNode,
  updateRoadSegment,
  type MapDefinition,
  type Vec3,
} from '@tactical-td/shared';
import type { SelectionItem } from '../types';

export interface GizmoDraftResult {
  nextMap: MapDefinition;
  mutatedNodeId: string | null;
  mutatedSegId: string | null;
}

/** Projects live TransformControls gizmo transforms onto an immutable MapDefinition draft. */
export function applyGizmoObjectToDraft(
  base: MapDefinition,
  obj: THREE.Object3D,
): GizmoDraftResult {
  const ud = obj.userData as { entityKind?: SelectionItem['type']; entityId?: string };
  if (!ud.entityKind || !ud.entityId) {
    return { nextMap: base, mutatedNodeId: null, mutatedSegId: null };
  }

  const { nodes, segments } = getMapGraph(base);
  const p: Vec3 = {
    x: Number(obj.position.x.toFixed(2)),
    y: Number(obj.position.y.toFixed(2)),
    z: Number(obj.position.z.toFixed(2)),
  };
  const rotY = Number(obj.rotation.y.toFixed(3));

  if (ud.entityKind === 'road_node') {
    const targetNode = nodes.find((n) => n.id === ud.entityId);
    const yOff = targetNode?.role === 'base' ? 0.65 : 0.17;
    const safeY = Math.max(0, Number((p.y - yOff).toFixed(2)));
    return {
      nextMap: { ...base, nodes: moveRoadNode(nodes, ud.entityId, { x: p.x, y: safeY, z: p.z }) },
      mutatedNodeId: ud.entityId,
      mutatedSegId: null,
    };
  }

  if (ud.entityKind === 'curve_handle') {
    return {
      nextMap: {
        ...base,
        segments: updateRoadSegment(segments, ud.entityId, {
          kind: 'curve',
          control: { x: p.x, y: Math.max(0, Number((p.y - 0.35).toFixed(2))), z: p.z },
        }),
      },
      mutatedNodeId: null,
      mutatedSegId: ud.entityId,
    };
  }

  if (ud.entityKind === 'obstacle') {
    const sz = {
      x: Math.max(0.5, Number(obj.scale.x.toFixed(2))),
      y: Math.max(0.4, Number(obj.scale.y.toFixed(2))),
      z: Math.max(0.5, Number(obj.scale.z.toFixed(2))),
    };
    return {
      nextMap: {
        ...base,
        obstacles: base.obstacles.map((o) =>
          o.id === ud.entityId ? { ...o, position: p, size: sz, rotationY: rotY } : o,
        ),
      },
      mutatedNodeId: null,
      mutatedSegId: null,
    };
  }

  if (ud.entityKind === 'zone') {
    const sz = {
      x: Math.max(1, Number(obj.scale.x.toFixed(2))),
      y: Math.max(0.5, Number(obj.scale.y.toFixed(2))),
      z: Math.max(1, Number(obj.scale.z.toFixed(2))),
    };
    return {
      nextMap: {
        ...base,
        elevatedZones: base.elevatedZones.map((z) =>
          z.id === ud.entityId ? { ...z, position: p, size: sz, rotationY: rotY } : z,
        ),
      },
      mutatedNodeId: null,
      mutatedSegId: null,
    };
  }

  if (ud.entityKind === 'custom_model') {
    const sc = {
      x: Math.max(0.05, Number(obj.scale.x.toFixed(3))),
      y: Math.max(0.05, Number(obj.scale.y.toFixed(3))),
      z: Math.max(0.05, Number(obj.scale.z.toFixed(3))),
    };
    return {
      nextMap: {
        ...base,
        customModels: (base.customModels ?? []).map((m) =>
          m.id === ud.entityId ? { ...m, position: p, scale: sc, rotationY: rotY } : m,
        ),
      },
      mutatedNodeId: null,
      mutatedSegId: null,
    };
  }

  return { nextMap: base, mutatedNodeId: null, mutatedSegId: null };
}
