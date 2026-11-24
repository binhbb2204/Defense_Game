import * as THREE from 'three';
import {
  buildRoadGeometry,
  sampleCenterline,
  type RoadJoinStyle,
  type RoadNode,
  type RoadSegment,
  type Vec2,
  type Vec3,
} from '@tactical-td/shared';
import { buildPolylinesMesh } from './RoadAsphaltMaterial';

export type RoadPreviewVisualStatus = 'valid' | 'warn' | 'blocked';

const PALETTE: Record<RoadPreviewVisualStatus, { fill: number; line: number; opacity: number }> = {
  valid: { fill: 0x4c8dff, line: 0x8db8ff, opacity: 0.36 },
  warn: { fill: 0xf59e0b, line: 0xfbbf24, opacity: 0.36 },
  blocked: { fill: 0xef4444, line: 0xf87171, opacity: 0.42 },
};

function makeDashedLine(points: THREE.Vector3[], colorHex: number, opacity = 0.9, dash = 1.2, gap = 1.0): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineDashedMaterial({
    color: colorHex,
    dashSize: dash,
    gapSize: gap,
    transparent: true,
    opacity,
  });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  return line;
}

function makeDiamondHandle(pos: Vec3, colorHex: number): THREE.Group {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.14, 1.15),
    new THREE.MeshBasicMaterial({ color: colorHex }),
  );
  outer.rotation.y = Math.PI / 4;
  outer.position.set(pos.x, pos.y + 0.14, pos.z);

  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 0.18, 0.68),
    new THREE.MeshBasicMaterial({ color: 0x0c0d0f }),
  );
  inner.rotation.y = Math.PI / 4;
  inner.position.set(pos.x, pos.y + 0.15, pos.z);
  g.add(outer, inner);
  return g;
}

/** Vertical dashed drop-line + ground footprint ring visualizing elevation above y = 0. */
export function buildElevationDropGuide(pos: Vec3, colorHex = 0x60a5fa): THREE.Group {
  const g = new THREE.Group();
  if (pos.y <= 0.15) return g;
  g.add(
    makeDashedLine(
      [new THREE.Vector3(pos.x, pos.y, pos.z), new THREE.Vector3(pos.x, 0.04, pos.z)],
      colorHex,
      0.85,
      0.45,
      0.35,
    ),
  );
  const baseRing = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.65, 20),
    new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  baseRing.rotation.x = -Math.PI / 2;
  baseRing.position.set(pos.x, 0.04, pos.z);
  g.add(baseRing);
  return g;
}

/** Builds Curve stage-2 preview overlay (anchor -> cursor diamond + tangent continuation ray). */
export function buildCurveControlStageOverlay(
  anchor: Vec3,
  cursorControl: Vec3,
  prevTangent: Vec2 | null,
  snappedToTangent: boolean,
): THREE.Group {
  const group = new THREE.Group();
  const lineCol = snappedToTangent ? 0x4c8dff : 0x8db8ff;

  if (prevTangent) {
    const rayPts = [
      new THREE.Vector3(anchor.x, anchor.y + 0.16, anchor.z),
      new THREE.Vector3(anchor.x + prevTangent.x * 24, anchor.y + 0.16, anchor.z + prevTangent.z * 24),
    ];
    group.add(makeDashedLine(rayPts, lineCol, snappedToTangent ? 0.92 : 0.42, 0.8, 0.7));
  }

  const handlePts = [
    new THREE.Vector3(anchor.x, anchor.y + 0.18, anchor.z),
    new THREE.Vector3(cursorControl.x, cursorControl.y + 0.18, cursorControl.z),
  ];
  group.add(makeDashedLine(handlePts, 0x8db8ff, 0.88, 0.7, 0.6));
  group.add(makeDiamondHandle(cursorControl, lineCol));
  return group;
}

/**
 * Builds the complete ghost road mesh + centerline + tangent handles/rays for Straight, Curve & Free modes.
 * Reuses `buildRoadGeometry` so preview matches the committed per-node joint surface.
 */
export function buildRoadToolOverlay(params: {
  previewGraph: { nodes: readonly RoadNode[]; segments: readonly RoadSegment[] };
  joinStyle: RoadJoinStyle;
  status: RoadPreviewVisualStatus;
  anchorPos: Vec3;
  endPos: Vec3;
  controlPoint: Vec3 | null;
  incomingTangent: Vec2 | null;
  showControlHandle: boolean;
  cornerFallback: boolean;
}): THREE.Group {
  const group = new THREE.Group();
  const pal = PALETTE[params.status];

  const geom = buildRoadGeometry(params.previewGraph, { joinStyle: params.joinStyle, yOffset: 0.09 });
  if (geom.positions.length > 0 && geom.indices.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(geom.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(geom.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(geom.indices, 1));
    group.add(
      new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: pal.fill,
          transparent: true,
          opacity: pal.opacity,
          depthWrite: false,
        }),
      ),
    );
    const border = buildPolylinesMesh(geom.edgePolylines, pal.line, 0.025, 0.92);
    if (border) group.add(border);
  }

  // Dashed centerline and ghost bridge pillars along elevated preview segments
  const ghostSeg = params.previewGraph.segments.find((s) => s.id === '__ghost_seg__');
  if (ghostSeg) {
    const samples = sampleCenterline(
      { segment: ghostSeg, nodes: params.previewGraph.nodes, segments: params.previewGraph.segments },
      1.5,
      (5 * Math.PI) / 180,
    );
    if (samples.length >= 2) {
      const cPts = samples.map((p) => new THREE.Vector3(p.x, p.y + 0.14, p.z));
      group.add(makeDashedLine(cPts, pal.line, 0.92, 1.3, 1.0));

      if (params.anchorPos.y > 0.6 || params.endPos.y > 0.6) {
        const totalLen = samples[samples.length - 1]!.s;
        const count = Math.max(1, Math.floor(totalLen / 12));
        const pillarMat = new THREE.MeshBasicMaterial({
          color: pal.line,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        });
        let idx = 0;
        for (let k = 0; k <= count; k++) {
          const targetS = (k / Math.max(1, count)) * totalLen;
          while (idx + 1 < samples.length && samples[idx + 1]!.s < targetS) idx++;
          const p0 = samples[idx]!;
          const p1 = samples[Math.min(idx + 1, samples.length - 1)]!;
          const span = p1.s - p0.s;
          const u = span > 1e-4 ? (targetS - p0.s) / span : 0;
          const px = p0.x + (p1.x - p0.x) * u;
          const py = p0.y + (p1.y - p0.y) * u;
          const pz = p0.z + (p1.z - p0.z) * u;
          if (py < 0.75) continue;
          const h = py - 0.12;
          if (h <= 0.3) continue;
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, h, 8), pillarMat);
          col.position.set(px, h * 0.5, pz);
          group.add(col);
        }
      }
    }
  }

  if (params.endPos.y > 0.15) {
    group.add(buildElevationDropGuide(params.endPos, pal.line));
  }

  // Thin incoming tangent guide for Free / tangent-continued Curve
  if (params.incomingTangent) {
    const tPts = [
      new THREE.Vector3(params.anchorPos.x, params.anchorPos.y + 0.15, params.anchorPos.z),
      new THREE.Vector3(
        params.anchorPos.x + params.incomingTangent.x * 16,
        params.anchorPos.y + 0.15,
        params.anchorPos.z + params.incomingTangent.z * 16,
      ),
    ];
    group.add(makeDashedLine(tPts, 0x8db8ff, 0.48, 0.6, 0.7));
  }

  // Explicit quadratic control polygon & diamond handle
  if (params.showControlHandle && params.controlPoint) {
    const polyPts = [
      new THREE.Vector3(params.anchorPos.x, params.anchorPos.y + 0.18, params.anchorPos.z),
      new THREE.Vector3(params.controlPoint.x, params.controlPoint.y + 0.18, params.controlPoint.z),
      new THREE.Vector3(params.endPos.x, params.endPos.y + 0.18, params.endPos.z),
    ];
    group.add(makeDashedLine(polyPts, 0x8db8ff, 0.85, 0.7, 0.6));
    group.add(makeDiamondHandle(params.controlPoint, pal.line));
  }

  // Corner fallback indicator around anchor
  if (params.cornerFallback) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.45, 24),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(params.anchorPos.x, params.anchorPos.y + 0.12, params.anchorPos.z);
    group.add(ring);
  }

  return group;
}
