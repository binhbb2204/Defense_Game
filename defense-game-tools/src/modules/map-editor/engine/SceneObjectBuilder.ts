import * as THREE from 'three';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  getMapGraph,
  type MapDefinition,
  type RoadJoinStyle,
} from '@tactical-td/shared';
import {
  buildRoadNetworkMeshes,
  instantiateImportedTemplate,
  type ImportedAssetEntry,
  type ShapePreviewRenderData,
} from '../rendering';
import type { RoadToolState } from '../tools';
import { selectionKey, type EditorTool, type SelectionItem } from '../types';
import { disposeObjectResources } from './threeDispose';

export interface SceneSyncParams {
  map: MapDefinition;
  selection: SelectionItem[];
  activeTool: EditorTool;
  roadState: RoadToolState;
  gridEnabled: boolean;
  gridStep: number;
  anarchyEnabled: boolean;
  roadJoinStyle: RoadJoinStyle;
  showRoadDebug: boolean;
  hiddenIds: ReadonlySet<string>;
  lockedIds: ReadonlySet<string>;
  assetCache: Map<string, ImportedAssetEntry>;
  shapePreviewData?: ShapePreviewRenderData | null;
}

export interface SceneSyncTargets {
  roadMeshesGroup: THREE.Group;
  dynamicGroup: THREE.Group;
  transformControls: TransformControls;
  blockerMeshes: THREE.Object3D[];
  entityObjectMap: Map<string, THREE.Object3D>;
  componentGroups: Map<string, THREE.Group>;
  segmentToComponent: Map<string, string>;
  flowDirections: Map<string, 1 | -1>;
}

/** Rebuilds Three.js road networks, nodes, curve handles, obstacles, zones, models, and gizmos. */
export function rebuildSceneObjects(
  targets: SceneSyncTargets,
  params: SceneSyncParams,
): void {
  const { roadMeshesGroup, dynamicGroup, transformControls } = targets;
  const {
    map,
    selection,
    activeTool,
    roadState,
    gridEnabled,
    gridStep,
    anarchyEnabled,
    roadJoinStyle,
    showRoadDebug,
    hiddenIds,
    lockedIds,
    assetCache,
  } = params;

  transformControls.detach();
  while (roadMeshesGroup.children.length > 0) {
    const c = roadMeshesGroup.children[0]!;
    roadMeshesGroup.remove(c);
    disposeObjectResources(c);
  }
  while (dynamicGroup.children.length > 0) {
    const c = dynamicGroup.children[0]!;
    dynamicGroup.remove(c);
    disposeObjectResources(c);
  }
  targets.blockerMeshes.length = 0;
  targets.entityObjectMap.clear();
  targets.componentGroups.clear();
  targets.segmentToComponent.clear();

  const boundsGeo = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(map.bounds.width, 0.2, map.bounds.depth),
  );
  const boundsLine = new THREE.LineSegments(
    boundsGeo,
    new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45 }),
  );
  boundsLine.position.y = 0.1;
  dynamicGroup.add(boundsLine);

  const graph = getMapGraph(map);
  const selectedSet = new Set(selection.map((s) => selectionKey(s)));
  const selectedSegmentIds = new Set(
    selection.filter((s) => s.type === 'road_segment').map((s) => s.id),
  );

  const effectiveHiddenSegments = new Set<string>(hiddenIds);
  if (
    activeTool === 'shape' &&
    params.shapePreviewData &&
    !params.shapePreviewData.isParallel &&
    params.shapePreviewData.preview?.allowed
  ) {
    for (const sid of params.shapePreviewData.replacedSegmentIds) {
      effectiveHiddenSegments.add(sid);
    }
  }

  const built = buildRoadNetworkMeshes(map, {
    selectedSegmentIds,
    hoveredSegmentId: null,
    hiddenSegmentIds: effectiveHiddenSegments,
    anarchyEnabled,
    joinStyle: roadJoinStyle,
    showRoadDebug,
    assetCache,
  });
  roadMeshesGroup.add(built.root);
  built.componentGroups.forEach((v, k) => targets.componentGroups.set(k, v));
  built.segmentToComponent.forEach((v, k) => targets.segmentToComponent.set(k, v));
  built.flowDirections.forEach((v, k) => targets.flowDirections.set(k, v));

  const normalGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.34, 16);
  const spawnGeo = new THREE.CylinderGeometry(0.84, 0.92, 0.44, 18);
  const baseGeo = new THREE.OctahedronGeometry(0.85, 0);
  const ringGeo = new THREE.RingGeometry(1.05, 1.32, 24);
  const handleGeo = new THREE.SphereGeometry(0.48, 12, 12);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const node of graph.nodes) {
    if (hiddenIds.has(node.id)) continue;
    const isSelected = selectedSet.has(`road_node:${node.id}`);
    const isDrawingAnchor = roadState.status === 'drawing' && roadState.anchorNodeId === node.id;

    const geo = node.role === 'spawn' ? spawnGeo : node.role === 'base' ? baseGeo : normalGeo;
    const baseColor =
      isSelected || isDrawingAnchor
        ? 0x3b82f6
        : node.role === 'spawn'
          ? 0x22c55e
          : node.role === 'base'
            ? 0xef4444
            : 0x9ca3af;

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: isSelected || isDrawingAnchor ? 0x1d4ed8 : 0x000000,
        roughness: 0.4,
      }),
    );
    mesh.position.set(node.x, node.y + (node.role === 'base' ? 0.65 : 0.17), node.z);
    mesh.userData = { entityKind: 'road_node', entityId: node.id };
    dynamicGroup.add(mesh);
    targets.entityObjectMap.set(`road_node:${node.id}`, mesh);

    if (node.role === 'spawn' || node.role === 'base' || isDrawingAnchor) {
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: node.role === 'spawn' ? 0x22c55e : node.role === 'base' ? 0xef4444 : 0x3b82f6,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(node.x, node.y + 0.08, node.z);
      dynamicGroup.add(ring);
    }
  }

  for (const seg of graph.segments) {
    if (hiddenIds.has(seg.id) || seg.kind !== 'curve' || !seg.control) continue;
    const a = nodeMap.get(seg.a);
    const b = nodeMap.get(seg.b);
    if (!a || !b) continue;
    const handleSel = selectedSet.has(`curve_handle:${seg.id}`);
    const hMesh = new THREE.Mesh(
      handleGeo,
      new THREE.MeshStandardMaterial({
        color: handleSel ? 0xfacc15 : 0x3b82f6,
        roughness: 0.35,
      }),
    );
    hMesh.position.set(seg.control.x, seg.control.y + 0.35, seg.control.z);
    hMesh.userData = { entityKind: 'curve_handle', entityId: seg.id };
    dynamicGroup.add(hMesh);
    targets.entityObjectMap.set(`curve_handle:${seg.id}`, hMesh);

    dynamicGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a.x, a.y + 0.22, a.z),
          new THREE.Vector3(seg.control.x, seg.control.y + 0.35, seg.control.z),
          new THREE.Vector3(b.x, b.y + 0.22, b.z),
        ]),
        new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.65 }),
      ),
    );
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  for (const obs of map.obstacles) {
    if (obs.visible === false || hiddenIds.has(obs.id)) continue;
    const isSelected = selectedSet.has(`obstacle:${obs.id}`);
    const mesh = new THREE.Mesh(
      boxGeo,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(obs.color ?? '#64748b'),
        roughness: 0.65,
        metalness: 0.16,
        emissive: isSelected ? 0x2563eb : 0x000000,
        emissiveIntensity: isSelected ? 0.55 : 0,
      }),
    );
    mesh.position.set(obs.position.x, obs.position.y, obs.position.z);
    mesh.scale.set(obs.size.x, obs.size.y, obs.size.z);
    mesh.rotation.y = obs.rotationY ?? 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { entityKind: 'obstacle', entityId: obs.id };
    dynamicGroup.add(mesh);
    targets.entityObjectMap.set(`obstacle:${obs.id}`, mesh);
    if (obs.blocksLoS) targets.blockerMeshes.push(mesh);
  }

  for (const zone of map.elevatedZones) {
    if (zone.visible === false || hiddenIds.has(zone.id)) continue;
    const isSelected = selectedSet.has(`zone:${zone.id}`);
    const mesh = new THREE.Mesh(
      boxGeo,
      new THREE.MeshStandardMaterial({
        color: zone.kind === 'watchtower' ? 0xd97706 : 0x0284c7,
        roughness: 0.6,
        metalness: 0.15,
        emissive: isSelected ? 0x2563eb : 0x000000,
        emissiveIntensity: isSelected ? 0.5 : 0,
      }),
    );
    mesh.position.set(zone.position.x, zone.position.y, zone.position.z);
    mesh.scale.set(zone.size.x, zone.size.y, zone.size.z);
    mesh.rotation.y = zone.rotationY ?? 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { entityKind: 'zone', entityId: zone.id };
    dynamicGroup.add(mesh);
    targets.entityObjectMap.set(`zone:${zone.id}`, mesh);
    targets.blockerMeshes.push(mesh);
  }

  for (const model of map.customModels ?? []) {
    if (model.visible === false || hiddenIds.has(model.id)) continue;
    const isSelected = selectedSet.has(`custom_model:${model.id}`);
    const cached = assetCache.get(model.assetName);
    const node: THREE.Object3D = cached
      ? instantiateImportedTemplate(cached.template, model.color)
      : new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 2.4, 2.4),
          new THREE.MeshStandardMaterial({ color: model.color ?? '#a855f7', roughness: 0.5 }),
        );
    if (isSelected) node.add(new THREE.BoxHelper(node, 0x3b82f6));
    node.position.set(model.position.x, model.position.y, model.position.z);
    node.scale.set(model.scale.x, model.scale.y, model.scale.z);
    node.rotation.y = model.rotationY;
    node.userData = { entityKind: 'custom_model', entityId: model.id };
    dynamicGroup.add(node);
    targets.entityObjectMap.set(`custom_model:${model.id}`, node);
    if (model.blocksLoS) targets.blockerMeshes.push(node);
  }

  if (selection.length === 1) {
    const primary = selection[0]!;
    const locked = lockedIds.has(primary.id);
    const shouldAttach =
      !locked &&
      primary.type !== 'road_segment' &&
      (activeTool === 't-move' ||
        activeTool === 't-rotate' ||
        activeTool === 't-scale' ||
        (activeTool === 't-select' &&
          (primary.type === 'road_node' || primary.type === 'curve_handle')));

    if (shouldAttach) {
      const targetObj = targets.entityObjectMap.get(selectionKey(primary));
      if (targetObj) {
        const mode =
          primary.type === 'road_node' || primary.type === 'curve_handle'
            ? 'translate'
            : activeTool === 't-rotate'
              ? 'rotate'
              : activeTool === 't-scale'
                ? 'scale'
                : 'translate';
        transformControls.setMode(mode);
        transformControls.setTranslationSnap(gridEnabled ? gridStep : null);
        transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
        transformControls.attach(targetObj);
      }
    }
  }
}
