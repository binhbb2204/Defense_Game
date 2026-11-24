import * as THREE from 'three';
import {
  buildRoadGeometry,
  collectDirtyRegion,
  computeSegmentFlowDirections,
  connectedComponents,
  getMapGraph,
  measureRoadSegment,
  type MapDefinition,
  type RoadJoinStyle,
  type RoadNode,
  type RoadSegment,
  type WaypointElevationMode,
} from '@tactical-td/shared';
import type { ImportedAssetEntry } from './modelPipeline';
import { buildPolylinesMesh, getRoadAsphaltTexture } from './RoadAsphaltMaterial';
import { BridgePillarBuilder } from './features/BridgePillarBuilder';
import { CustomAssetDeformer } from './features/CustomAssetDeformer';
import { RoadArrowsBuilder } from './features/RoadArrowsBuilder';
import { RoadDebugOverlayBuilder } from './features/RoadDebugOverlayBuilder';
import { SegmentHighlightBuilder } from './features/SegmentHighlightBuilder';
import { TunnelShellBuilder } from './features/TunnelShellBuilder';

export interface RoadNetworkVisualOptions {
  selectedSegmentIds: ReadonlySet<string>;
  hoveredSegmentId: string | null;
  hiddenSegmentIds?: ReadonlySet<string>;
  anarchyEnabled: boolean;
  joinStyle?: RoadJoinStyle;
  showRoadDebug?: boolean;
  assetCache?: Map<string, ImportedAssetEntry>;
}

export interface BuiltRoadNetwork {
  root: THREE.Group;
  componentGroups: Map<string, THREE.Group>;
  segmentToComponent: Map<string, string>;
  flowDirections: Map<string, 1 | -1>;
}

/**
 * Orchestrates Three.js mesh construction for connected road components using modular feature builders.
 */
export class RoadNetworkRenderer {
  private readonly bridgePillars = new BridgePillarBuilder();
  private readonly tunnelShells = new TunnelShellBuilder();
  private readonly customDeformer = new CustomAssetDeformer();
  private readonly highlights = new SegmentHighlightBuilder();
  private readonly arrows = new RoadArrowsBuilder();
  private readonly debugOverlay = new RoadDebugOverlayBuilder();

  private buildComponentGroup(
    compId: string,
    compNodes: RoadNode[],
    compSegments: RoadSegment[],
    nodeMap: Map<string, RoadNode>,
    options: RoadNetworkVisualOptions,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `RoadComponent_${compId}`;
    group.userData = {
      entityKind: 'road_component',
      componentId: compId,
      segmentIds: compSegments.map((s) => s.id),
    };

    const visibleSegments = compSegments.filter((s) => !options.hiddenSegmentIds?.has(s.id));
    if (visibleSegments.length === 0) return group;

    const proceduralSegs: RoadSegment[] = [];
    for (const s of visibleSegments) {
      if (!(s.roadPartAsset && options.assetCache?.get(s.roadPartAsset))) {
        proceduralSegs.push(s);
      }
    }

    if (proceduralSegs.length > 0) {
      const geomData = buildRoadGeometry(
        { nodes: compNodes, segments: proceduralSegs },
        { joinStyle: options.joinStyle ?? 'miter' },
      );

      if (geomData.positions.length > 0 && geomData.indices.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(geomData.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(geomData.normals, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(geomData.uvs, 2));
        geo.setIndex(new THREE.BufferAttribute(geomData.indices, 1));
        geo.computeBoundingBox();
        geo.computeBoundingSphere();

        const roadMesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            map: getRoadAsphaltTexture(),
            color: 0xffffff,
            roughness: 0.88,
            metalness: 0.06,
          }),
        );
        roadMesh.name = `RoadSurface_${compId}`;
        roadMesh.receiveShadow = true;
        roadMesh.userData = {
          entityKind: 'road_component',
          componentId: compId,
          segmentIds: proceduralSegs.map((s) => s.id),
        };
        group.add(roadMesh);

        const borderMesh = buildPolylinesMesh(geomData.edgePolylines, 0x64748b, 0.035, 0.92);
        if (borderMesh) {
          borderMesh.name = `RoadBorders_${compId}`;
          group.add(borderMesh);
        }

        const arrowsMesh = this.arrows.build({
          arrows: geomData.arrowStrips,
          colorHex: 0x94a3b8,
          opacity: 0.78,
        });
        if (arrowsMesh) group.add(arrowsMesh);

        if (options.showRoadDebug) {
          group.add(this.debugOverlay.build({ geom: geomData, surfaceGeo: geo }));
        }
      }
    }

    for (const seg of visibleSegments) {
      const a = nodeMap.get(seg.a);
      const b = nodeMap.get(seg.b);
      if (!a || !b) continue;

      const metrics = measureRoadSegment(a, b, seg, compNodes, compSegments);
      if (metrics.length < 0.05) continue;

      const cachedPart = seg.roadPartAsset && options.assetCache?.get(seg.roadPartAsset);
      if (cachedPart) {
        const deformed = this.customDeformer.build({
          nodeA: a,
          nodeB: b,
          segment: seg,
          graphNodes: compNodes,
          graphSegments: compSegments,
          metricsLength: metrics.length,
          cachedPart,
        });
        if (deformed) group.add(deformed);
      }

      const isBridge =
        seg.isOverpass ||
        seg.elevationMode === 'bridge' ||
        seg.elevationMode === 'elevated' ||
        a.y > 0.6 ||
        b.y > 0.6;
      const isTunnel = Boolean(seg.isTunnel || seg.elevationMode === 'tunnel');

      if (isBridge) {
        const pillars = this.bridgePillars.build({ nodeA: a, nodeB: b, segment: seg, graphNodes: compNodes, graphSegments: compSegments, length: metrics.length });
        if (pillars) group.add(pillars);
      }
      if (isTunnel) {
        const shell = this.tunnelShells.build({ nodeA: a, nodeB: b, segment: seg, graphNodes: compNodes, graphSegments: compSegments, length: metrics.length });
        if (shell) group.add(shell);
      }

      const safeMinR = Math.max(0.5, seg.width * 0.5);
      const hasGeomIssue =
        !options.anarchyEnabled &&
        (metrics.maxSlopePct > 22 ||
          (Number.isFinite(metrics.minTurnRadius) && metrics.minTurnRadius < safeMinR));

      let highlight: THREE.Group | null = null;
      if (options.selectedSegmentIds.has(seg.id)) {
        highlight = this.highlights.build({ nodeA: a, nodeB: b, segment: seg, graphNodes: compNodes, graphSegments: compSegments, colorHex: 0x3b82f6, opacity: 0.34, yRaise: 0.055 });
      } else if (options.hoveredSegmentId === seg.id) {
        highlight = this.highlights.build({ nodeA: a, nodeB: b, segment: seg, graphNodes: compNodes, graphSegments: compSegments, colorHex: 0x60a5fa, opacity: 0.2, yRaise: 0.048 });
      } else if (hasGeomIssue) {
        highlight = this.highlights.build({ nodeA: a, nodeB: b, segment: seg, graphNodes: compNodes, graphSegments: compSegments, colorHex: 0xef4444, opacity: 0.32, yRaise: 0.05 });
      }
      if (highlight) group.add(highlight);
    }

    return group;
  }

  buildNetwork(map: MapDefinition, options: RoadNetworkVisualOptions): BuiltRoadNetwork {
    const root = new THREE.Group();
    root.name = 'RoadGraphGroup';
    const componentGroups = new Map<string, THREE.Group>();
    const segmentToComponent = new Map<string, string>();

    const { nodes, segments } = getMapGraph(map);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const flowDirections = computeSegmentFlowDirections(nodes, segments);
    const components = connectedComponents(nodes, segments);

    for (const comp of components) {
      if (comp.segmentIds.length === 0) continue;
      const compNodeSet = new Set(comp.nodeIds);
      const compSegSet = new Set(comp.segmentIds);
      const compNodes = nodes.filter((n) => compNodeSet.has(n.id));
      const compSegs = segments.filter((s) => compSegSet.has(s.id));

      for (const sid of comp.segmentIds) segmentToComponent.set(sid, comp.id);

      const compGroup = this.buildComponentGroup(comp.id, compNodes, compSegs, nodeMap, options);
      componentGroups.set(comp.id, compGroup);
      root.add(compGroup);
    }

    return { root, componentGroups, segmentToComponent, flowDirections };
  }

  rebuildDirty(
    roadRoot: THREE.Group,
    componentGroups: Map<string, THREE.Group>,
    segmentToComponent: Map<string, string>,
    draftMap: MapDefinition,
    movedNodeIds: ReadonlySet<string>,
    mutatedSegId: string | null,
    options: RoadNetworkVisualOptions,
    disposeFn: (obj: THREE.Object3D) => void,
  ): void {
    const { nodes, segments } = getMapGraph(draftMap);
    const dirtyRegion = collectDirtyRegion(nodes, segments, movedNodeIds, 2);
    if (mutatedSegId) dirtyRegion.segmentIds.add(mutatedSegId);

    const dirtyCompIds = new Set<string>();
    for (const sid of dirtyRegion.segmentIds) {
      const cid = segmentToComponent.get(sid);
      if (cid) dirtyCompIds.add(cid);
    }
    if (dirtyCompIds.size === 0) return;

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const components = connectedComponents(nodes, segments);
    for (const comp of components) {
      const touchesDirty = comp.segmentIds.some((sid) =>
        dirtyCompIds.has(segmentToComponent.get(sid) ?? comp.id),
      );
      if (!touchesDirty && !dirtyCompIds.has(comp.id)) continue;

      const oldGroup = componentGroups.get(comp.id);
      const targetParent = oldGroup?.parent ?? roadRoot;
      if (oldGroup) {
        targetParent.remove(oldGroup);
        disposeFn(oldGroup);
        componentGroups.delete(comp.id);
      }

      const compNodeSet = new Set(comp.nodeIds);
      const compSegSet = new Set(comp.segmentIds);
      const compNodes = nodes.filter((n) => compNodeSet.has(n.id));
      const compSegs = segments.filter((s) => compSegSet.has(s.id));
      const rebuilt = this.buildComponentGroup(comp.id, compNodes, compSegs, nodeMap, options);
      componentGroups.set(comp.id, rebuilt);
      targetParent.add(rebuilt);
      for (const sid of comp.segmentIds) segmentToComponent.set(sid, comp.id);
    }
  }
}

const defaultRenderer = new RoadNetworkRenderer();

export function buildRoadNetworkMeshes(
  map: MapDefinition,
  options: RoadNetworkVisualOptions,
): BuiltRoadNetwork {
  return defaultRenderer.buildNetwork(map, options);
}

export function buildRoadGraphGroup(
  map: MapDefinition,
  options: RoadNetworkVisualOptions,
): BuiltRoadNetwork {
  return defaultRenderer.buildNetwork(map, options);
}

export function rebuildDirtyRoadComponents(
  roadRoot: THREE.Group,
  componentGroups: Map<string, THREE.Group>,
  segmentToComponent: Map<string, string>,
  draftMap: MapDefinition,
  movedNodeIds: ReadonlySet<string>,
  mutatedSegId: string | null,
  options: RoadNetworkVisualOptions,
  disposeFn: (obj: THREE.Object3D) => void,
): void {
  defaultRenderer.rebuildDirty(
    roadRoot,
    componentGroups,
    segmentToComponent,
    draftMap,
    movedNodeIds,
    mutatedSegId,
    options,
    disposeFn,
  );
}

export function buildRoadPreviewFromGraph(
  previewGraph: { nodes: readonly RoadNode[]; segments: readonly RoadSegment[] },
  joinStyle: RoadJoinStyle,
  elevationMode: WaypointElevationMode,
  isBlocked: boolean,
): THREE.Group {
  const group = new THREE.Group();
  const res = buildRoadGeometry(previewGraph, { joinStyle, yOffset: 0.09 });
  if (res.positions.length === 0 || res.indices.length === 0) return group;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(res.indices, 1));

  const colorHex = isBlocked
    ? 0xef4444
    : elevationMode === 'tunnel'
      ? 0x8b5cf6
      : elevationMode === 'bridge' || elevationMode === 'elevated'
        ? 0xf59e0b
        : 0x22c55e;

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    }),
  );
  group.add(mesh);

  const border = buildPolylinesMesh(res.edgePolylines, colorHex, 0.025, 0.92);
  if (border) group.add(border);
  return group;
}
