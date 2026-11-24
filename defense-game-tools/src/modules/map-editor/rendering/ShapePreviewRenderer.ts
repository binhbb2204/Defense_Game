import * as THREE from 'three';
import {
  buildRoadGeometry,
  sampleCenterline,
  type CurvatureViolation,
  type RoadJoinStyle,
  type RoadNode,
  type RoadSegment,
  type ShapeOperationResult,
} from '@tactical-td/shared';
import { buildPolylinesMesh, getRoadAsphaltTexture } from './RoadAsphaltMaterial';
import { RoadArrowsBuilder } from './features/RoadArrowsBuilder';

export interface ShapePreviewRenderData {
  originalNodes: readonly RoadNode[];
  originalSegments: readonly RoadSegment[];
  replacedSegmentIds: ReadonlySet<string>;
  startNodeId: string | null;
  endNodeId: string | null;
  connectSegIds: readonly string[];
  originalSectionNodeIds: readonly string[];
  originalSectionSegIds: readonly string[];
  isParallel: boolean;
  preview: ShapeOperationResult | null;
}

const arrowsBuilder = new RoadArrowsBuilder();

/**
 * Renders live Shape tool preview meshes using the same `buildRoadGeometry` pipeline,
 * along with original-chain ghost comparison, Bezier handles/tangents, and curvature violations.
 */
export function buildShapePreviewGroup(
  data: ShapePreviewRenderData,
  joinStyle: RoadJoinStyle,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'ShapePreviewGroup';
  const origNodeMap = new Map(data.originalNodes.map((n) => [n.id, n]));

  // Start / End / Connect markers
  const ringGeo = new THREE.RingGeometry(1.05, 1.38, 28);
  const drawNodeRing = (id: string | null, color: number) => {
    if (!id) return;
    const nd = origNodeMap.get(id);
    if (!nd) return;
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(nd.x, nd.y + 0.14, nd.z);
    root.add(ring);
  };
  drawNodeRing(data.startNodeId, 0x22c55e);
  drawNodeRing(data.endNodeId, 0x3b82f6);

  // Connect mode picked segment outlines
  for (const sid of data.connectSegIds) {
    const seg = data.originalSegments.find((s) => s.id === sid);
    if (!seg) continue;
    const pts = sampleCenterline({ segment: seg, nodes: data.originalNodes, segments: data.originalSegments }, 1.2);
    if (pts.length >= 2) {
      root.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y + 0.16, p.z))),
          new THREE.LineBasicMaterial({ color: 0xf59e0b }),
        ),
      );
    }
  }

  // Thin ghost of original chain for before/after comparison
  if (data.originalSectionSegIds.length > 0 && data.originalSectionNodeIds.length >= 2) {
    const ghostPts = sampleCenterline(
      {
        nodeIds: data.originalSectionNodeIds,
        segmentIds: data.originalSectionSegIds,
        nodes: data.originalNodes,
        segments: data.originalSegments,
      },
      1.5,
      (6 * Math.PI) / 180,
    );
    if (ghostPts.length >= 2) {
      root.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(
            ghostPts.map((p) => new THREE.Vector3(p.x, p.y + 0.12, p.z)),
          ),
          new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.45 }),
        ),
      );
    }
  }

  const pv = data.preview;
  if (!pv || !pv.allowed || pv.affectedSegmentIds.length === 0) return root;

  // Render preview road meshes via the same buildRoadGeometry builder + directional chevrons
  const affectedSegSet = new Set(pv.affectedSegmentIds);
  const includedSegs = pv.segments.filter((s) => {
    if (affectedSegSet.has(s.id)) return true;
    return pv.affectedNodeIds.some((nid) => s.a === nid || s.b === nid);
  });
  const previewMeshData = buildRoadGeometry(
    { nodes: pv.nodes, segments: includedSegs },
    { joinStyle, yOffset: 0.08 },
  );

  if (previewMeshData.positions.length > 0 && previewMeshData.indices.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(previewMeshData.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(previewMeshData.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(previewMeshData.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(previewMeshData.indices, 1));

    const tintColor = pv.violations.length > 0 ? 0xfca5a5 : 0xdbeafe;
    const roadMesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        map: getRoadAsphaltTexture(),
        color: tintColor,
        roughness: 0.84,
        metalness: 0.06,
      }),
    );
    root.add(roadMesh);

    const border = buildPolylinesMesh(
      previewMeshData.edgePolylines,
      pv.violations.length > 0 ? 0xef4444 : 0x38bdf8,
      0.045,
      0.95,
    );
    if (border) root.add(border);

    const arrows = arrowsBuilder.build({
      arrows: previewMeshData.arrowStrips,
      colorHex: 0x93c5fd,
      opacity: 0.85,
    });
    if (arrows) root.add(arrows);
  }

  // Show newly generated interior preview nodes
  const newNodeDot = new THREE.SphereGeometry(0.32, 10, 10);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  for (const nid of pv.affectedNodeIds) {
    if (nid === data.startNodeId || nid === data.endNodeId) continue;
    const nd = pv.nodes.find((n) => n.id === nid);
    if (!nd) continue;
    const m = new THREE.Mesh(newNodeDot, dotMat);
    m.position.set(nd.x, nd.y + 0.25, nd.z);
    root.add(m);
  }

  // Show cubic Bezier handles & tangent lines while mode is active
  if (pv.handles.length > 0) {
    const hGeo = new THREE.SphereGeometry(0.32, 10, 10);
    const hMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const lineVerts: number[] = [];
    for (const h of pv.handles) {
      lineVerts.push(h.anchor.x, h.anchor.y + 0.28, h.anchor.z, h.handle.x, h.handle.y + 0.28, h.handle.z);
      const s = new THREE.Mesh(hGeo, hMat);
      s.position.set(h.handle.x, h.handle.y + 0.28, h.handle.z);
      root.add(s);
    }
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
    root.add(
      new THREE.LineSegments(
        tGeo,
        new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.72 }),
      ),
    );
  }

  // Highlight curvature violations red
  addViolationMarkers(root, pv.violations);
  return root;
}

function addViolationMarkers(root: THREE.Group, violations: readonly CurvatureViolation[]): void {
  if (violations.length === 0) return;
  const vGeo = new THREE.RingGeometry(1.1, 1.5, 24);
  const vMat = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide });
  for (const v of violations) {
    const ring = new THREE.Mesh(vGeo, vMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(v.position.x, v.position.y + 0.22, v.position.z);
    root.add(ring);
  }
}
