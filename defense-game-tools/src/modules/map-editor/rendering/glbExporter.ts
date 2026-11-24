import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { findRoutes, getMapGraph, type MapDefinition } from '@tactical-td/shared';
import { buildRoadNetworkMeshes } from './RoadNetworkRenderer';
import { instantiateImportedTemplate, type ImportedAssetEntry } from './modelPipeline';

/** Ensures all userData values are plain JSON primitives/records so GLTFExporter serializes glTF extras cleanly. */
function toSafeJsonRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      v === null
    ) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        typeof item === 'object' && item !== null ? toSafeJsonRecord(item as Record<string, unknown>) : item,
      );
    } else if (typeof v === 'object' && v !== undefined) {
      out[k] = toSafeJsonRecord(v as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * Packs the entire tactical map (ground + procedural road + obstacles + elevated pads + ALL
 * imported 3D model instances) into a single unified binary `.glb` file where every object's
 * full properties & customProperties live inside glTF `node.extras` (via `object.userData`).
 */
export async function exportCompositeSceneGlb(
  map: MapDefinition,
  assetCache: Map<string, ImportedAssetEntry>,
): Promise<{ glbBuffer: ArrayBuffer; exportedNodeCount: number; customModelCount: number }> {
  const root = new THREE.Group();
  root.name = map.id || 'composite_map';
  root.userData = toSafeJsonRecord({
    generator: 'DefenseGameStudio',
    format: 'tactical-td-composite-scene',
    id: map.id,
    name: map.name,
    version: map.version,
    boundsWidth: map.bounds.width,
    boundsDepth: map.bounds.depth,
    baseHp: map.baseHp,
    startingCash: map.startingCash,
    defaultRoadWidth: map.defaultRoadWidth,
    exportedAt: new Date().toISOString(),
  });

  const groundGeo = new THREE.BoxGeometry(map.bounds.width, 0.2, map.bounds.depth);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x3b4938, roughness: 0.92, metalness: 0.04 });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.name = 'GroundPlane';
  groundMesh.position.set(0, -0.1, 0);
  groundMesh.userData = { entityType: 'ground', width: map.bounds.width, depth: map.bounds.depth };
  root.add(groundMesh);

  const { nodes, segments } = getMapGraph(map);
  const routes = findRoutes(nodes, segments);
  const graphRoot = new THREE.Group();
  graphRoot.name = 'RoadGraph';
  graphRoot.userData = toSafeJsonRecord({
    entityType: 'road_graph',
    nodeCount: nodes.length,
    segmentCount: segments.length,
    routeCount: routes.length,
    defaultRoadWidth: map.defaultRoadWidth,
  });

  const markerGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.3, 14);
  for (const node of nodes) {
    const color = node.role === 'spawn' ? 0x22c55e : node.role === 'base' ? 0xef4444 : 0x94a3b8;
    const nodeMesh = new THREE.Mesh(
      markerGeo,
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
    );
    nodeMesh.name = node.label || node.id;
    nodeMesh.position.set(node.x, node.y + 0.15, node.z);
    nodeMesh.userData = toSafeJsonRecord({
      entityType: 'road_node',
      id: node.id,
      role: node.role,
      label: node.label ?? '',
      x: node.x,
      y: node.y,
      z: node.z,
    });
    graphRoot.add(nodeMesh);
  }

  const builtGraph = buildRoadNetworkMeshes(map, {
    selectedSegmentIds: new Set(),
    hoveredSegmentId: null,
    anarchyEnabled: true,
    assetCache,
  });
  graphRoot.add(builtGraph.root);
  root.add(graphRoot);

  const obsGroup = new THREE.Group();
  obsGroup.name = 'Obstacles_LoS';
  for (const obs of map.obstacles) {
    const geo = new THREE.BoxGeometry(obs.size.x, obs.size.y, obs.size.z);
    const mat = new THREE.MeshStandardMaterial({
      color: obs.color ? new THREE.Color(obs.color) : new THREE.Color(0x64748b),
      roughness: 0.72,
      metalness: 0.18,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = obs.id;
    mesh.position.set(obs.position.x, obs.position.y, obs.position.z);
    mesh.rotation.y = obs.rotationY ?? 0;
    mesh.userData = toSafeJsonRecord({
      entityType: 'obstacle',
      id: obs.id,
      kind: obs.kind,
      blocksLoS: obs.blocksLoS,
      color: obs.color ?? '#64748b',
      size: obs.size,
      rotationY: obs.rotationY ?? 0,
      customProperties: obs.customProperties ?? {},
      ...(obs.customProperties ?? {}),
    });
    obsGroup.add(mesh);
  }
  root.add(obsGroup);

  const zoneGroup = new THREE.Group();
  zoneGroup.name = 'ElevatedZones';
  for (const zone of map.elevatedZones) {
    const geo = new THREE.BoxGeometry(zone.size.x, zone.size.y, zone.size.z);
    const mat = new THREE.MeshStandardMaterial({
      color: zone.kind === 'watchtower' ? 0xd97706 : 0x0284c7,
      roughness: 0.65,
      metalness: 0.12,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = zone.id;
    mesh.position.set(zone.position.x, zone.position.y, zone.position.z);
    mesh.rotation.y = zone.rotationY ?? 0;
    mesh.userData = toSafeJsonRecord({
      entityType: 'elevated_zone',
      id: zone.id,
      label: zone.label,
      kind: zone.kind,
      size: zone.size,
      rotationY: zone.rotationY ?? 0,
      allowedCategories: zone.allowedCategories ?? ['infantry', 'sniper', 'explosive', 'support'],
      customProperties: zone.customProperties ?? {},
      ...(zone.customProperties ?? {}),
    });
    zoneGroup.add(mesh);
  }
  root.add(zoneGroup);

  const modelsGroup = new THREE.Group();
  modelsGroup.name = 'ImportedModels';
  const customModels = map.customModels ?? [];

  for (const model of customModels) {
    const cached = assetCache.get(model.assetName);
    let node: THREE.Object3D;
    if (cached) {
      node = instantiateImportedTemplate(cached.template, model.color);
    } else {
      const proxyGeo = new THREE.BoxGeometry(2, 2, 2);
      const proxyMat = new THREE.MeshStandardMaterial({ color: model.color ?? '#a855f7' });
      node = new THREE.Mesh(proxyGeo, proxyMat);
    }
    node.name = model.name || model.id;
    node.position.set(model.position.x, model.position.y, model.position.z);
    node.scale.set(model.scale.x, model.scale.y, model.scale.z);
    node.rotation.y = model.rotationY;
    node.userData = toSafeJsonRecord({
      entityType: 'custom_model',
      id: model.id,
      name: model.name,
      assetName: model.assetName,
      format: model.format,
      blocksLoS: model.blocksLoS,
      isHighGround: Boolean(model.isHighGround),
      color: model.color ?? '',
      rotationY: model.rotationY,
      scale: model.scale,
      customProperties: model.customProperties ?? {},
      ...(model.customProperties ?? {}),
    });
    modelsGroup.add(node);
  }
  root.add(modelsGroup);

  root.updateMatrixWorld(true);

  let exportedNodeCount = 0;
  root.traverse(() => {
    exportedNodeCount += 1;
  });

  const exporter = new GLTFExporter();
  const glbBuffer = await exporter.parseAsync(root, { binary: true });
  if (!(glbBuffer instanceof ArrayBuffer)) {
    throw new Error('GLTFExporter did not return a binary ArrayBuffer.');
  }

  return {
    glbBuffer,
    exportedNodeCount,
    customModelCount: customModels.length,
  };
}
