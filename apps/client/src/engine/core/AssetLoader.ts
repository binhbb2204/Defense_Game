import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedObject } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface LoadedModelAsset {
  template: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface LoadModelOptions {
  /** Normalize uniform scale so model bounding-box height matches this value (meters). */
  targetHeight?: number;
  /** Explicit diffuse texture URL to bind onto the model (overrides broken FBX paths). */
  fallbackTextureUrl?: string;
}

/**
 * Unified 3D Asset Loader & Cache (.glb/.gltf with Draco + .fbx).
 * Normalizes scale/pivot (feet at y = 0, centered XZ), sanitizes glowing FBX materials,
 * and caches templates in memory.
 */
export class AssetLoader {
  private readonly cache = new Map<string, Promise<LoadedModelAsset>>();
  private readonly textureCache = new Map<string, Promise<THREE.Texture>>();
  private readonly dracoLoader: DRACOLoader;
  private readonly textureLoader = new THREE.TextureLoader();

  constructor() {
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath(
      'https://www.gstatic.com/draco/versioned/decoders/1.5.7/',
    );
  }

  public loadModel(
    url: string,
    options: LoadModelOptions = {},
  ): Promise<LoadedModelAsset> {
    const cacheKey = `${url}|h=${options.targetHeight ?? 'auto'}|tex=${options.fallbackTextureUrl ?? ''}`;
    const existing = this.cache.get(cacheKey);
    if (existing) return existing;

    const promise = this.fetchAndNormalize(url, options);
    this.cache.set(cacheKey, promise);
    return promise;
  }

  private loadTextureCached(url: string): Promise<THREE.Texture> {
    const existing = this.textureCache.get(url);
    if (existing) return existing;

    const promise = this.textureLoader.loadAsync(url).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    });
    this.textureCache.set(url, promise);
    return promise;
  }

  public instantiate(asset: LoadedModelAsset): {
    root: THREE.Group;
    mixer: THREE.AnimationMixer | null;
    action: THREE.AnimationAction | null;
  } {
    const root = cloneSkinnedObject(asset.template) as THREE.Group;
    let mixer: THREE.AnimationMixer | null = null;
    let action: THREE.AnimationAction | null = null;

    if (asset.animations.length > 0) {
      mixer = new THREE.AnimationMixer(root);
      const walkClip =
        asset.animations.find((c) => /walk|run|move/i.test(c.name)) ??
        asset.animations.reduce((best, cur) =>
          cur.tracks.length > best.tracks.length ? cur : best,
        );
      action = mixer.clipAction(walkClip);
      action.play();
    }

    return { root, mixer, action };
  }

  private async fetchAndNormalize(
    url: string,
    options: LoadModelOptions,
  ): Promise<LoadedModelAsset> {
    const isFbx = url.toLowerCase().endsWith('.fbx');
    let rawRoot: THREE.Group;
    let animations: THREE.AnimationClip[] = [];

    // Load explicit diffuse texture in parallel if configured
    const explicitTexturePromise = options.fallbackTextureUrl
      ? this.loadTextureCached(options.fallbackTextureUrl).catch((err) => {
          console.warn(`[AssetLoader] Could not load texture ${options.fallbackTextureUrl}:`, err);
          return null;
        })
      : Promise.resolve(null);

    if (isFbx) {
      const manager = new THREE.LoadingManager();
      if (options.fallbackTextureUrl) {
        const fallback = options.fallbackTextureUrl;
        manager.setURLModifier((requestedUrl) => {
          if (!requestedUrl.toLowerCase().endsWith('.fbx')) {
            return fallback;
          }
          return requestedUrl;
        });
      }
      const fbxLoader = new FBXLoader(manager);
      rawRoot = await fbxLoader.loadAsync(url);
      animations = rawRoot.animations ?? [];
    } else {
      const gltfLoader = new GLTFLoader();
      gltfLoader.setDRACOLoader(this.dracoLoader);
      const gltf = await gltfLoader.loadAsync(url);
      rawRoot = gltf.scene;
      animations = gltf.animations ?? [];
    }

    const explicitTexture = await explicitTexturePromise;

    // Strip any Blender/FBX scene Lights or Cameras accidentally exported inside the model
    // (a single Blender Light in FBX carries ~1000 intensity and blows out the entire map when cloned!)
    const unwantedNodes: THREE.Object3D[] = [];
    rawRoot.traverse((obj) => {
      if ((obj as THREE.Light).isLight || (obj as THREE.Camera).isCamera) {
        unwantedNodes.push(obj);
      }
    });
    for (const node of unwantedNodes) {
      node.parent?.remove(node);
    }

    const wrapper = new THREE.Group();
    wrapper.add(rawRoot);

    // Sanitize meshes & materials: enable shadows and ensure FBX Phong materials don't glow
    rawRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (!isFbx && !explicitTexture) {
        // GLTF/GLB already provides a valid PBR MeshStandardMaterial with embedded texture & flipY=false
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          const std = mat as THREE.MeshStandardMaterial;
          if (std && std.emissive) {
            std.emissive.setHex(0x000000);
            std.emissiveIntensity = 0;
          }
        }
        return;
      }

      const sourceMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cleanedMats = sourceMats.map((mat) => {
        const oldMat = mat as THREE.MeshPhongMaterial & THREE.MeshStandardMaterial;
        const map = oldMat?.map ?? explicitTexture ?? null;
        if (map) {
          map.colorSpace = THREE.SRGBColorSpace;
          map.needsUpdate = true;
        }

        return new THREE.MeshStandardMaterial({
          map,
          color: 0xffffff,
          emissive: 0x000000,
          emissiveIntensity: 0,
          roughness: 0.82,
          metalness: 0.06,
          vertexColors: false,
        });
      });

      mesh.material = cleanedMats.length === 1 ? cleanedMats[0] : cleanedMats;
    });

    wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rawRoot);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    if (options.targetHeight && size.y > 1e-4) {
      const scaleFactor = options.targetHeight / size.y;
      rawRoot.scale.multiplyScalar(scaleFactor);
      rawRoot.updateMatrixWorld(true);
      box.setFromObject(rawRoot);
      box.getCenter(center);
    }

    // Place feet flush on y = 0 and center X/Z
    rawRoot.position.x -= center.x;
    rawRoot.position.z -= center.z;
    rawRoot.position.y -= box.min.y;

    this.stripRootMotion(animations);

    return { template: wrapper, animations };
  }

  /**
   * Converts Mixamo/Blender root-motion walk/run clips into seamless in-place loops.
   * Locks the forward-drifting translation axis on the Hips/Root bone to its frame-0 origin
   * while preserving vertical hip bounce and lateral sway.
   */
  private stripRootMotion(animations: THREE.AnimationClip[]): void {
    for (const clip of animations) {
      for (const track of clip.tracks) {
        if (!/(hips|root|pelvis).*\.position$/i.test(track.name)) continue;

        const values = track.values;
        const count = Math.floor(values.length / 3);
        if (count < 2) continue;

        const lastBase = (count - 1) * 3;
        for (let axis = 0; axis < 3; axis++) {
          const startVal = values[axis];
          const endVal = values[lastBase + axis];
          const drift = endVal - startVal;

          // If this axis translates significantly over the clip, it's forward root motion -> lock to startVal
          if (Math.abs(drift) > 0.25) {
            for (let i = 0; i < count; i++) {
              values[i * 3 + axis] = startVal;
            }
          }
        }
      }
    }
  }

  public dispose(): void {
    this.dracoLoader.dispose();
    this.cache.clear();
    this.textureCache.clear();
  }
}
