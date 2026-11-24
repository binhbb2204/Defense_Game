import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { CustomModelFormat } from '@tactical-td/shared';

export { exportCompositeSceneGlb } from './glbExporter';

export interface ImportedAssetEntry {
  assetName: string;
  format: CustomModelFormat;
  fileSize: number;
  meshCount: number;
  dimensions: { x: number; y: number; z: number };
  autoNormalizedScale: number;
  template: THREE.Group;
  uploadedToServer: boolean;
}

export function detectModelFormat(fileName: string): CustomModelFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'glb' || ext === 'gltf' || ext === 'fbx' || ext === 'obj') {
    return ext;
  }
  return null;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Parses an imported 3D file (.glb, .gltf, .fbx, .obj), strips embedded cameras/lights,
 * centers X/Z around origin with bottom resting at Y = 0, and normalizes gigantic Mixamo/FBX units.
 */
export async function parseImportedModelBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<ImportedAssetEntry> {
  const format = detectModelFormat(fileName);
  if (!format) {
    throw new Error(`Unsupported 3D model extension: "${fileName}". Use .glb, .gltf, .fbx, or .obj.`);
  }

  let loadedRoot: THREE.Object3D;

  if (format === 'glb' || format === 'gltf') {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(buffer, '');
    loadedRoot = gltf.scene;
  } else if (format === 'fbx') {
    const loader = new FBXLoader();
    loadedRoot = loader.parse(buffer, '');
  } else {
    const loader = new OBJLoader();
    const text = new TextDecoder().decode(buffer);
    loadedRoot = loader.parse(text);
  }

  const toRemove: THREE.Object3D[] = [];
  let meshCount = 0;

  loadedRoot.traverse((child) => {
    if ((child as THREE.Light).isLight || (child as THREE.Camera).isCamera) {
      toRemove.push(child);
      return;
    }
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      meshCount += 1;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!mesh.material || (Array.isArray(mesh.material) && mesh.material.length === 0)) {
        mesh.material = new THREE.MeshStandardMaterial({
          color: 0x9aa4b4,
          roughness: 0.65,
          metalness: 0.15,
        });
      }
    }
  });
  for (const item of toRemove) {
    item.parent?.remove(item);
  }

  const wrapper = new THREE.Group();
  wrapper.name = fileName;

  loadedRoot.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(loadedRoot);
  const rawSize = new THREE.Vector3();
  rawBox.getSize(rawSize);
  const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z, 0.001);

  let normalizeScale = 1;
  if (maxDim > 25) {
    normalizeScale = 4 / maxDim;
  } else if (maxDim < 0.25) {
    normalizeScale = 2 / maxDim;
  }

  if (normalizeScale !== 1) {
    loadedRoot.scale.multiplyScalar(normalizeScale);
    loadedRoot.updateMatrixWorld(true);
  }

  const normBox = new THREE.Box3().setFromObject(loadedRoot);
  const center = new THREE.Vector3();
  const normSize = new THREE.Vector3();
  normBox.getCenter(center);
  normBox.getSize(normSize);

  loadedRoot.position.x -= center.x;
  loadedRoot.position.z -= center.z;
  loadedRoot.position.y -= normBox.min.y;
  wrapper.add(loadedRoot);
  wrapper.updateMatrixWorld(true);

  return {
    assetName: fileName,
    format,
    fileSize: buffer.byteLength,
    meshCount,
    dimensions: {
      x: Number(normSize.x.toFixed(2)),
      y: Number(normSize.y.toFixed(2)),
      z: Number(normSize.z.toFixed(2)),
    },
    autoNormalizedScale: normalizeScale,
    template: wrapper,
    uploadedToServer: false,
  };
}

/** Clones an imported template cleanly with independent materials so instance tinting works. */
export function instantiateImportedTemplate(template: THREE.Group, tintColor?: string): THREE.Group {
  const clone = template.clone(true);
  clone.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => {
          const clonedMat = m.clone();
          if (tintColor && 'color' in clonedMat && (clonedMat as THREE.MeshStandardMaterial).color) {
            (clonedMat as THREE.MeshStandardMaterial).color.lerp(new THREE.Color(tintColor), 0.45);
          }
          return clonedMat;
        });
      } else if (mesh.material) {
        const clonedMat = mesh.material.clone();
        if (tintColor && 'color' in clonedMat && (clonedMat as THREE.MeshStandardMaterial).color) {
          (clonedMat as THREE.MeshStandardMaterial).color.lerp(new THREE.Color(tintColor), 0.45);
        }
        mesh.material = clonedMat;
      }
    }
  });
  return clone;
}
