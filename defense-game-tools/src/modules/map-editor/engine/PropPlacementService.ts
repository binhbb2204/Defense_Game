import * as THREE from 'three';
import type { Vec3 } from '@tactical-td/shared';
import { instantiateImportedTemplate, type ImportedAssetEntry } from '../rendering';
import type { EditorTool, ToolboxAssetChoice } from '../types';
import type { ViewportEngineHost } from './ViewportTypes';

/** Commits a placed obstacle, elevated zone, or imported 3D model into the active map. */
export function placePropAt(
  asset: ToolboxAssetChoice,
  pos: Vec3,
  host: ViewportEngineHost,
): void {
  const cur = host.getMap();
  const rotY = Number(THREE.MathUtils.degToRad(host.getGhostRotDeg()).toFixed(3));
  const rx = Number(pos.x.toFixed(2));
  const rz = Number(pos.z.toFixed(2));

  if (asset.kind === 'obstacle') {
    const id = `${asset.preset}_${Date.now().toString(36).slice(-4)}`;
    host.onCommitMap({
      ...cur,
      obstacles: [
        ...cur.obstacles,
        {
          id,
          kind: asset.preset,
          position: { x: rx, y: asset.size.y * 0.5, z: rz },
          size: { ...asset.size },
          rotationY: rotY,
          blocksLoS: true,
          color: asset.color,
        },
      ],
    });
    host.onSelectItem({ type: 'obstacle', id }, false);
  } else if (asset.kind === 'zone') {
    const id = `${asset.preset}_${Date.now().toString(36).slice(-4)}`;
    host.onCommitMap({
      ...cur,
      elevatedZones: [
        ...cur.elevatedZones,
        {
          id,
          label: asset.label,
          kind: asset.preset,
          position: { x: rx, y: asset.size.y * 0.5, z: rz },
          size: { ...asset.size },
          rotationY: rotY,
          allowedCategories: ['infantry', 'sniper', 'explosive', 'support'],
        },
      ],
    });
    host.onSelectItem({ type: 'zone', id }, false);
  } else {
    const entry = host.getAssetCache().get(asset.assetName);
    const id = `mdl_${Date.now().toString(36).slice(-4)}`;
    host.onCommitMap({
      ...cur,
      customModels: [
        ...(cur.customModels ?? []),
        {
          id,
          name: asset.label,
          assetName: asset.assetName,
          format: entry?.format ?? 'glb',
          position: { x: rx, y: 0, z: rz },
          scale: { x: 1, y: 1, z: 1 },
          rotationY: rotY,
          blocksLoS: true,
          isHighGround: false,
        },
      ],
    });
    host.onSelectItem({ type: 'custom_model', id }, false);
  }

  host.onDismissWelcome();
  if (host.getPlaceOnce()) {
    host.onSetActiveTool('t-select');
  }
}

/** Rebuilds the translucent cursor ghost mesh used during Prop placement mode. */
export function rebuildGhostPropMesh(
  ghostGroup: THREE.Group,
  selectedAsset: ToolboxAssetChoice | null,
  activeTool: EditorTool,
  ghostRotDeg: number,
  assetCache: Map<string, ImportedAssetEntry>,
): void {
  while (ghostGroup.children.length > 0) {
    ghostGroup.remove(ghostGroup.children[0]!);
  }
  if (!selectedAsset || activeTool !== 'place') {
    ghostGroup.visible = false;
    return;
  }

  let previewObj: THREE.Object3D;
  if (selectedAsset.kind === 'custom_model') {
    const cached = assetCache.get(selectedAsset.assetName);
    previewObj = cached
      ? instantiateImportedTemplate(cached.template)
      : new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 2.4, 2.4),
          new THREE.MeshStandardMaterial({ color: 0xa855f7 }),
        );
  } else {
    previewObj = new THREE.Mesh(
      new THREE.BoxGeometry(selectedAsset.size.x, selectedAsset.size.y, selectedAsset.size.z),
      new THREE.MeshStandardMaterial({ color: selectedAsset.color }),
    );
  }

  previewObj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.material) {
      const makeGhost = (m: THREE.Material) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.42;
        return c;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(makeGhost)
        : makeGhost(mesh.material);
    }
  });

  ghostGroup.add(previewObj);
  ghostGroup.rotation.y = THREE.MathUtils.degToRad(ghostRotDeg);
}
