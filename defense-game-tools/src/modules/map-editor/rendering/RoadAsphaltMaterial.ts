import * as THREE from 'three';
import type { Vec3 } from '@tactical-td/shared';

let cachedAsphaltTexture: THREE.CanvasTexture | null = null;

/**
 * Shared procedural top-down asphalt CanvasTexture driven by road UVs:
 * - `u` across width [0..1] (shoulder lines + center dashed line)
 * - `v` in world metric repeats (smooth across through-chains)
 */
export function getRoadAsphaltTexture(): THREE.CanvasTexture {
  if (cachedAsphaltTexture) return cachedAsphaltTexture;

  const w = 128;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#2c323b';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.024)';
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        if (((x * 13 + y * 29) & 7) === 0) {
          ctx.fillRect(x, y, 2, 2);
        }
      }
    }

    ctx.fillStyle = 'rgba(203, 213, 225, 0.28)';
    ctx.fillRect(4, 0, 3, h);
    ctx.fillRect(w - 7, 0, 3, h);

    ctx.fillStyle = 'rgba(241, 245, 249, 0.42)';
    ctx.fillRect(w * 0.5 - 2, 10, 4, Math.floor(h * 0.48));
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cachedAsphaltTexture = tex;
  return tex;
}

/** Converts edgePolylines arrays into ONE batched THREE.LineSegments geometry. */
export function buildPolylinesMesh(
  polylines: readonly Vec3[][],
  colorHex: number,
  yRaise = 0.035,
  opacity = 1.0,
): THREE.LineSegments | null {
  const verts: number[] = [];
  for (const poly of polylines) {
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1]!;
      const b = poly[i]!;
      verts.push(a.x, a.y + yRaise, a.z, b.x, b.y + yRaise, b.z);
    }
  }
  if (verts.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: opacity < 1,
    opacity,
  });
  return new THREE.LineSegments(geo, mat);
}
