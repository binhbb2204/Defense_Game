import * as THREE from 'three';
import type { ElevatedZone, ObstacleKind } from '@tactical-td/shared';

/**
 * Offscreen 128x128 Three.js thumbnail renderer (ported from MapKit Studio pattern)
 * so both built-in tactical prefabs and user-imported 3D assets show rich 3D cards.
 */
class ThumbnailStudio {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private cache = new Map<string, string>();

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    const ambient = new THREE.AmbientLight(0xffffff, 1.15);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 5, 3);
    this.scene.add(ambient, dir);
  }

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.setSize(128, 128);
      r.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer = r;
      return r;
    } catch {
      return null;
    }
  }

  renderObjectThumbnail(key: string, object3d: THREE.Object3D): string {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const renderer = this.ensureRenderer();
    if (!renderer) return '';

    const clone = object3d.clone(true);
    clone.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.9 / maxDim;

    clone.scale.multiplyScalar(scale);
    clone.position.sub(center.multiplyScalar(scale));

    this.scene.add(clone);
    this.camera.position.set(2.1, 2.2, 2.9);
    this.camera.lookAt(0, 0, 0);

    renderer.render(this.scene, this.camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    this.scene.remove(clone);

    this.cache.set(key, dataUrl);
    return dataUrl;
  }

  renderPrefabThumbnail(
    key: string,
    kind: ObstacleKind | ElevatedZone['kind'] | 'waypoint',
    size: { x: number; y: number; z: number },
    colorHex: string,
  ): string {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const group = new THREE.Group();
    if (kind === 'waypoint') {
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 0.45, 20),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.4 }),
      );
      const pin = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 1.1, 14),
        new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.4 }),
      );
      pin.rotation.x = Math.PI;
      pin.position.y = 1.1;
      group.add(cyl, pin);
    } else if (kind === 'tunnel_shell') {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.65 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y * 0.25, size.z), mat);
      top.position.y = size.y * 0.37;
      const sideL = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.18, size.y, size.z), mat);
      sideL.position.x = -size.x * 0.4;
      const sideR = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.18, size.y, size.z), mat);
      sideR.position.x = size.x * 0.4;
      group.add(top, sideL, sideR);
    } else {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        roughness: 0.6,
        metalness: 0.15,
      });
      const box = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }),
      );
      group.add(box, edge);
    }

    return this.renderObjectThumbnail(key, group);
  }
}

export const thumbnailStudio = new ThumbnailStudio();
