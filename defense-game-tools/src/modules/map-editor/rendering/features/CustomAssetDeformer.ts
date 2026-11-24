import * as THREE from 'three';
import { evaluateRoadSegmentAt, type RoadNode, type RoadSegment } from '@tactical-td/shared';
import type { ImportedAssetEntry } from '../modelPipeline';
import { BaseRoadFeatureBuilder } from './BaseRoadFeatureBuilder';

export interface CustomAssetDeformInput {
  nodeA: RoadNode;
  nodeB: RoadNode;
  segment: RoadSegment;
  graphNodes?: readonly RoadNode[];
  graphSegments?: readonly RoadSegment[];
  metricsLength: number;
  cachedPart: ImportedAssetEntry;
}

/** 1-to-4 midpoint triangle subdivision for imported meshes along curves. */
function subdivideNonIndexedGeometry(
  source: THREE.BufferGeometry,
  iterations: number,
): THREE.BufferGeometry {
  let current = source.index ? source.toNonIndexed() : source.clone();
  for (let iter = 0; iter < iterations; iter++) {
    const pos = current.getAttribute('position') as THREE.BufferAttribute;
    const norm = current.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = current.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const triCount = Math.floor(pos.count / 3);
    const nextPos = new Float32Array(triCount * 4 * 9);
    const nextNorm = norm ? new Float32Array(triCount * 4 * 9) : null;
    const nextUv = uv ? new Float32Array(triCount * 4 * 6) : null;

    for (let t = 0; t < triCount; t++) {
      const i0 = t * 3;
      const i1 = t * 3 + 1;
      const i2 = t * 3 + 2;
      const x0 = pos.getX(i0), y0 = pos.getY(i0), z0 = pos.getZ(i0);
      const x1 = pos.getX(i1), y1 = pos.getY(i1), z1 = pos.getZ(i1);
      const x2 = pos.getX(i2), y2 = pos.getY(i2), z2 = pos.getZ(i2);
      const x01 = (x0 + x1) * 0.5, y01 = (y0 + y1) * 0.5, z01 = (z0 + z1) * 0.5;
      const x12 = (x1 + x2) * 0.5, y12 = (y1 + y2) * 0.5, z12 = (z1 + z2) * 0.5;
      const x20 = (x2 + x0) * 0.5, y20 = (y2 + y0) * 0.5, z20 = (z2 + z0) * 0.5;

      nextPos.set(
        [
          x0, y0, z0, x01, y01, z01, x20, y20, z20,
          x01, y01, z01, x1, y1, z1, x12, y12, z12,
          x20, y20, z20, x12, y12, z12, x2, y2, z2,
          x01, y01, z01, x12, y12, z12, x20, y20, z20,
        ],
        t * 36,
      );

      if (nextNorm && norm) {
        const nx0 = norm.getX(i0), ny0 = norm.getY(i0), nz0 = norm.getZ(i0);
        const nx1 = norm.getX(i1), ny1 = norm.getY(i1), nz1 = norm.getZ(i1);
        const nx2 = norm.getX(i2), ny2 = norm.getY(i2), nz2 = norm.getZ(i2);
        const n01x = (nx0 + nx1) * 0.5, n01y = (ny0 + ny1) * 0.5, n01z = (nz0 + nz1) * 0.5;
        const n12x = (nx1 + nx2) * 0.5, n12y = (ny1 + ny2) * 0.5, n12z = (nz1 + nz2) * 0.5;
        const n20x = (nx2 + nx0) * 0.5, n20y = (ny2 + ny0) * 0.5, n20z = (nz2 + nz0) * 0.5;
        nextNorm.set(
          [
            nx0, ny0, nz0, n01x, n01y, n01z, n20x, n20y, n20z,
            n01x, n01y, n01z, nx1, ny1, nz1, n12x, n12y, n12z,
            n20x, n20y, n20z, n12x, n12y, n12z, nx2, ny2, nz2,
            n01x, n01y, n01z, n12x, n12y, n12z, n20x, n20y, n20z,
          ],
          t * 36,
        );
      }

      if (nextUv && uv) {
        const u0 = uv.getX(i0), v0 = uv.getY(i0);
        const u1 = uv.getX(i1), v1 = uv.getY(i1);
        const u2 = uv.getX(i2), v2 = uv.getY(i2);
        const u01 = (u0 + u1) * 0.5, v01 = (v0 + v1) * 0.5;
        const u12 = (u1 + u2) * 0.5, v12 = (v1 + v2) * 0.5;
        const u20 = (u2 + u0) * 0.5, v20 = (v2 + v0) * 0.5;
        nextUv.set(
          [
            u0, v0, u01, v01, u20, v20,
            u01, v01, u1, v1, u12, v12,
            u20, v20, u12, v12, u2, v2,
            u01, v01, u12, v12, u20, v20,
          ],
          t * 24,
        );
      }
    }

    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(nextPos, 3));
    if (nextNorm) next.setAttribute('normal', new THREE.BufferAttribute(nextNorm, 3));
    if (nextUv) next.setAttribute('uv', new THREE.BufferAttribute(nextUv, 2));
    current = next;
  }
  return current;
}

/** Deforms an imported `.glb/.fbx/.obj` road mesh along a single RoadSegment. */
export class CustomAssetDeformer extends BaseRoadFeatureBuilder<CustomAssetDeformInput> {
  build({ nodeA, nodeB, segment, graphNodes, graphSegments, metricsLength, cachedPart }: CustomAssetDeformInput): THREE.Group | null {
    const group = new THREE.Group();
    cachedPart.template.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cachedPart.template);
    const boxSize = new THREE.Vector3();
    box.getSize(boxSize);

    const alongX = boxSize.x > boxSize.z * 1.35;
    const partLongLen = Math.max(0.5, alongX ? boxSize.x : boxSize.z);
    const partCrossWidth = Math.max(0.5, alongX ? boxSize.z : boxSize.x);
    const minAlong = alongX ? box.min.x : box.min.z;
    const baseY = box.min.y;
    const repeatCount = Math.max(1, Math.min(48, Math.round(metricsLength / partLongLen)));

    const srcMeshes: Array<{
      geometry: THREE.BufferGeometry;
      material: THREE.Material | THREE.Material[];
    }> = [];
    cachedPart.template.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        const iter =
          m.geometry.attributes.position.count < 80
            ? 2
            : m.geometry.attributes.position.count < 400
              ? 1
              : 0;
        const baked = subdivideNonIndexedGeometry(m.geometry, iter);
        baked.applyMatrix4(m.matrixWorld);
        srcMeshes.push({ geometry: baked, material: m.material });
      }
    });

    const upVec = new THREE.Vector3(0, 1, 0);
    const basisN = new THREE.Vector3();
    const fwdV = new THREE.Vector3();
    const rightV = new THREE.Vector3();

    for (let tileIdx = 0; tileIdx < repeatCount; tileIdx++) {
      const tStart = tileIdx / repeatCount;
      const tSpan = 1 / repeatCount;
      for (const src of srcMeshes) {
        const geo = src.geometry.clone();
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        const norm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;

        for (let v = 0; v < pos.count; v++) {
          const lx = pos.getX(v);
          const ly = pos.getY(v) - baseY;
          const lz = pos.getZ(v);
          const alongCoord = alongX ? lx : lz;
          const lateralCoord = alongX ? lz : lx;
          const uFrac = Math.max(0, Math.min(1, (alongCoord - minAlong) / partLongLen));
          const t = tStart + uFrac * tSpan;
          const sample = evaluateRoadSegmentAt(nodeA, nodeB, segment, t, graphNodes, graphSegments);
          const wScale = Math.min(2.6, Math.max(0.45, segment.width / partCrossWidth));

          pos.setXYZ(
            v,
            sample.position.x + sample.right.x * (lateralCoord * wScale),
            sample.position.y + ly * wScale,
            sample.position.z + sample.right.z * (lateralCoord * wScale),
          );

          if (norm) {
            const nx = norm.getX(v);
            const ny = norm.getY(v);
            const nz = norm.getZ(v);
            const latN = alongX ? nz : nx;
            const fwdN = alongX ? nx : nz;
            rightV.set(sample.right.x, sample.right.y, sample.right.z);
            fwdV.set(sample.tangent.x, sample.tangent.y, sample.tangent.z);
            basisN
              .set(0, 0, 0)
              .addScaledVector(rightV, latN)
              .addScaledVector(upVec, ny)
              .addScaledVector(fwdV, fwdN)
              .normalize();
            norm.setXYZ(v, basisN.x, basisN.y, basisN.z);
          }
        }
        pos.needsUpdate = true;
        if (norm) norm.needsUpdate = true;
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, src.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { entityKind: 'road_segment', entityId: segment.id };
        group.add(mesh);
      }
    }

    return group.children.length > 0 ? group : null;
  }
}
