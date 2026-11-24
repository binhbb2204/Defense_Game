import * as THREE from 'three';
import {
  DEFAULT_FREE_MAX_DEFLECTION_DEG,
  DEFAULT_MIN_SEGMENT_LENGTH,
  evaluateCurveCandidate,
  evaluateFreeCandidate,
  evaluateStraightCandidate,
  getMapGraph,
  snapCurveControlToTangent,
  syncGraphToLegacyWaypoints,
  updateRoadSegment,
  type RoadCandidateEval,
  type RoadNode,
  type RoadSegment,
  type Vec3,
} from '@tactical-td/shared';
import {
  buildCurveControlStageOverlay,
  buildElevationDropGuide,
  buildRoadToolOverlay,
  type RoadPreviewVisualStatus,
} from '../rendering';
import {
  buildGhostPreviewGraph,
  checkRoadSegmentPlacement,
  handleRoadClick,
  resolveRoadCursorSnap,
  type RoadClickOutcome,
  type RoadSnapResult,
  type RoadToolState,
} from '../tools';
import type { SceneSyncTargets } from './SceneObjectBuilder';
import { ScenePickingService } from './ScenePickingService';
import { disposeObjectResources } from './threeDispose';
import type { ViewportCameraController } from './ViewportCameraController';
import type { RoadPreviewHudState, RoadRuntimeConfig, ViewportEngineHost } from './ViewportTypes';

/** Handles Road Tool hover previews, 3D tangent overlays, cursor telemetry HUD, Upgrade clicks, and drawing commits. */
export class RoadInteractionService {
  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
    private readonly camCtrl: ViewportCameraController,
    private readonly picker: ScenePickingService,
    private readonly targets: SceneSyncTargets,
    private readonly hoverGroup: THREE.Group,
    private readonly roadPreviewGroup: THREE.Group,
    private readonly snapRingMesh: THREE.Mesh,
    private readonly snapDotMesh: THREE.Mesh,
    private readonly host: ViewportEngineHost,
  ) {}

  public clearPreviewMeshes(): void {
    while (this.roadPreviewGroup.children.length > 0) {
      const c = this.roadPreviewGroup.children[0]!;
      this.roadPreviewGroup.remove(c);
      disposeObjectResources(c);
    }
    this.roadPreviewGroup.visible = false;
  }

  private toLocalScreen(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.domElement.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private projectWorld(pos: Vec3): { x: number; y: number } | null {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const v = new THREE.Vector3(pos.x, pos.y + 0.2, pos.z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
  }

  private resolveSnapWithElevatedPick(
    clientX: number,
    clientY: number,
    groundPt: Vec3,
    nodes: readonly RoadNode[],
    segments: readonly RoadSegment[],
    rc: RoadRuntimeConfig,
    curState: RoadToolState,
    altHeld: boolean,
  ): RoadSnapResult {
    if (curState.status === 'idle' && rc.drawElevation === 0 && !altHeld && rc.snapEnabled) {
      const picked = this.picker.pickSelectableAt(
        clientX,
        clientY,
        this.domElement,
        this.camera,
        this.targets.entityObjectMap,
        this.targets.roadMeshesGroup,
        this.host.getMap(),
      );
      if (picked?.type === 'road_node') {
        const n = nodes.find((node) => node.id === picked.id);
        if (n) {
          return { kind: 'node', pos: { x: n.x, y: n.y, z: n.z }, nodeId: n.id };
        }
      }
    }

    return resolveRoadCursorSnap({ x: groundPt.x, z: groundPt.z }, nodes, segments, {
      snapEnabled: rc.snapEnabled,
      gridEnabled: rc.gridEnabled,
      gridStep: rc.gridStep,
      snapRadius: rc.snapRadius,
      drawElevation: rc.drawElevation,
      elevationMode: rc.drawElevationMode,
      altHeld,
      excludeNodeId: curState.status === 'drawing' ? curState.anchorNodeId : undefined,
      isDrawing: curState.status === 'drawing',
    });
  }

  public handleHover(clientX: number, clientY: number, groundPt: Vec3, altHeld: boolean, shiftHeld: boolean): void {
    const rc = this.host.getRoadConfig();
    const map = this.host.getMap();
    const localPt = this.toLocalScreen(clientX, clientY);
    this.clearPreviewMeshes();

    if (rc.roadUpgradeMode) {
      this.snapRingMesh.visible = false;
      this.snapDotMesh.visible = false;
      const picked = this.picker.pickSelectableAt(
        clientX,
        clientY,
        this.domElement,
        this.camera,
        this.targets.entityObjectMap,
        this.targets.roadMeshesGroup,
        map,
      );
      const segHit = picked?.type === 'road_segment' ? picked : null;
      this.picker.updateHoverHighlight(segHit, this.hoverGroup, this.targets.entityObjectMap, map);
      this.host.onSetRoadBlockedReason(null);

      if (!segHit) {
        this.host.onSetRoadPreviewHud(null);
        return;
      }
      const seg = getMapGraph(map).segments.find((s) => s.id === segHit.id);
      if (!seg) return;
      const sameWidth = Math.abs(seg.width - rc.roadWidth) < 0.05;
      this.host.onSetRoadPreviewHud({
        visible: true,
        screenX: localPt.x,
        screenY: localPt.y,
        mode: rc.roadBuildMode,
        stage: 'upgrade',
        length: null,
        angleDeg: null,
        minRadius: null,
        roadWidth: rc.roadWidth,
        controlPoint: null,
        status: sameWidth ? 'warn' : 'ok',
        statusText: sameWidth ? `Already ${rc.roadWidth} m` : `Set width ${seg.width} m -> ${rc.roadWidth} m`,
      });
      return;
    }

    this.picker.updateHoverHighlight(null, this.hoverGroup, this.targets.entityObjectMap, map);
    const { nodes, segments } = getMapGraph(map);
    const curState = this.host.getRoadState();
    const snap = this.resolveSnapWithElevatedPick(
      clientX,
      clientY,
      groundPt,
      nodes,
      segments,
      rc,
      curState,
      altHeld,
    );
    this.host.onSetActiveSnapKind(snap.kind);

    const ringColor = snap.kind === 'node' ? 0x22c55e : snap.kind === 'segment' ? 0x3b82f6 : 0x6b7280;
    (this.snapRingMesh.material as THREE.MeshBasicMaterial).color.setHex(ringColor);
    this.snapRingMesh.position.set(snap.pos.x, snap.pos.y + 0.06, snap.pos.z);
    this.snapRingMesh.visible = true;
    (this.snapDotMesh.material as THREE.MeshBasicMaterial).color.setHex(ringColor);
    this.snapDotMesh.position.set(snap.pos.x, snap.pos.y + 0.14, snap.pos.z);
    this.snapDotMesh.visible = true;

    if (curState.status !== 'drawing') {
      this.host.onSetRoadBlockedReason(null);
      if (snap.pos.y > 0.15) {
        this.roadPreviewGroup.add(buildElevationDropGuide(snap.pos, ringColor));
        this.roadPreviewGroup.visible = true;
        this.host.onSetRoadPreviewHud({
          visible: true,
          screenX: localPt.x,
          screenY: localPt.y,
          mode: rc.roadBuildMode,
          stage: 'idle',
          length: null,
          angleDeg: null,
          minRadius: null,
          roadWidth: rc.roadWidth,
          controlPoint: null,
          elevationY: snap.pos.y,
          slopePct: null,
          status: 'ok',
          statusText: 'Elevated · PgUp/Dn or [ ]',
        });
      } else {
        this.host.onSetRoadPreviewHud(null);
      }
      return;
    }

    const anchor = nodes.find((n) => n.id === curState.anchorNodeId);
    if (!anchor) return;

    // Curve Stage 2: picking explicit control point
    if (rc.roadBuildMode === 'curve' && !curState.curveControl) {
      const snappedCtrl = snapCurveControlToTangent(anchor, snap.pos, curState.prevTangent, {
        altHeld,
        angleSnap: rc.angleSnap,
      });
      this.snapRingMesh.position.set(snappedCtrl.pos.x, snappedCtrl.pos.y + 0.06, snappedCtrl.pos.z);
      this.snapDotMesh.position.set(snappedCtrl.pos.x, snappedCtrl.pos.y + 0.14, snappedCtrl.pos.z);
      this.roadPreviewGroup.add(
        buildCurveControlStageOverlay(anchor, snappedCtrl.pos, curState.prevTangent, snappedCtrl.snappedToTangent),
      );
      if (snappedCtrl.pos.y > 0.15) {
        this.roadPreviewGroup.add(buildElevationDropGuide(snappedCtrl.pos, 0x8db8ff));
      }
      this.roadPreviewGroup.visible = true;

      const handleLen = Number(Math.hypot(snappedCtrl.pos.x - anchor.x, snappedCtrl.pos.z - anchor.z).toFixed(1));
      const tooClose = handleLen < 1.0;
      this.host.onSetRoadBlockedReason(tooClose ? 'Control point too close to start' : null);
      const hudState: RoadPreviewHudState = {
        visible: true,
        screenX: localPt.x,
        screenY: localPt.y,
        mode: 'curve',
        stage: 'control',
        length: handleLen,
        angleDeg: null,
        minRadius: null,
        roadWidth: rc.roadWidth,
        controlPoint: snappedCtrl.pos,
        elevationY: snappedCtrl.pos.y,
        snappedToTangent: snappedCtrl.snappedToTangent,
        status: tooClose ? 'error' : 'ok',
        statusText: tooClose ? 'Move control farther' : snappedCtrl.snappedToTangent ? 'Tangent aligned' : 'Click control point',
      };
      this.host.onSetRoadPreviewHud(hudState);
      return;
    }

    let cand: RoadCandidateEval;
    let effectiveSnap = snap;
    if (rc.roadBuildMode === 'curve' && curState.curveControl) {
      cand = evaluateCurveCandidate(anchor, curState.curveControl, snap.pos, rc.roadWidth, curState.prevTangent);
    } else if (rc.roadBuildMode === 'free') {
      cand = evaluateFreeCandidate(anchor, snap.pos, nodes, segments, rc.roadWidth, curState.prevTangent, {
        shiftHeld,
        maxDeflectionDeg: DEFAULT_FREE_MAX_DEFLECTION_DEG,
      });
    } else {
      cand = evaluateStraightCandidate(anchor, snap.pos, curState.prevTangent, {
        angleSnap: rc.angleSnap,
        altHeld,
        allowAngleSnap: snap.kind !== 'node' && snap.kind !== 'segment',
      });
      if (cand.usedAngleSnap) {
        effectiveSnap = { ...snap, kind: 'free', pos: cand.endPos };
        this.snapRingMesh.position.set(cand.endPos.x, cand.endPos.y + 0.06, cand.endPos.z);
        this.snapDotMesh.position.set(cand.endPos.x, cand.endPos.y + 0.14, cand.endPos.z);
      }
    }

    const check = checkRoadSegmentPlacement(
      nodes,
      segments,
      map.obstacles,
      anchor,
      effectiveSnap,
      cand.control,
      rc.roadWidth,
      rc.anarchyEnabled,
      {
        minLength: DEFAULT_MIN_SEGMENT_LENGTH,
        minAngleDeg: 25,
        autoIntersect: rc.autoIntersect,
        radiusOverride: rc.roadBuildMode === 'free' ? cand.minRadius : undefined,
      },
    );

    const visualStatus: RoadPreviewVisualStatus = !check.allowed
      ? 'blocked'
      : cand.cornerFallback || check.warning
        ? 'warn'
        : 'valid';

    this.host.onSetRoadBlockedReason(check.allowed ? null : check.reason);
    const ghostGraph = buildGhostPreviewGraph(nodes, segments, anchor, effectiveSnap, cand.control, rc.roadWidth, rc.drawElevationMode);
    this.roadPreviewGroup.add(
      buildRoadToolOverlay({
        previewGraph: ghostGraph,
        joinStyle: rc.roadJoinStyle,
        status: visualStatus,
        anchorPos: anchor,
        endPos: cand.endPos,
        controlPoint: cand.control,
        incomingTangent: cand.incomingTangent,
        showControlHandle: rc.roadBuildMode === 'curve' && Boolean(cand.control),
        cornerFallback: cand.cornerFallback,
      }),
    );
    this.roadPreviewGroup.visible = true;

    const statusText = !check.allowed
      ? check.reason
      : cand.cornerHint ?? check.warning ?? (cand.kind === 'straight' ? (shiftHeld ? 'Straight (Shift)' : 'Straight') : null);

    this.host.onSetRoadPreviewHud({
      visible: true,
      screenX: localPt.x,
      screenY: localPt.y,
      controlScreenPos: cand.control && rc.roadBuildMode === 'curve' ? this.projectWorld(cand.control) : null,
      mode: rc.roadBuildMode,
      stage: 'end',
      length: cand.length,
      angleDeg: cand.angleDeg,
      minRadius: cand.minRadius,
      roadWidth: rc.roadWidth,
      controlPoint: cand.control,
      elevationY: cand.endPos.y,
      slopePct: check.maxSlopePct ?? null,
      usedAngleSnap: cand.usedAngleSnap,
      status: visualStatus === 'blocked' ? 'error' : visualStatus === 'warn' ? 'warn' : 'ok',
      statusText,
    });
  }

  public handleClick(ev: PointerEvent): void {
    const map = this.host.getMap();
    const rc = this.host.getRoadConfig();

    if (rc.roadUpgradeMode) {
      const picked = this.picker.pickSelectableAt(
        ev.clientX,
        ev.clientY,
        this.domElement,
        this.camera,
        this.targets.entityObjectMap,
        this.targets.roadMeshesGroup,
        map,
      );
      if (picked?.type !== 'road_segment') return;
      const { segments } = getMapGraph(map);
      const nextSegs = updateRoadSegment(segments, picked.id, { width: rc.roadWidth });
      this.host.onCommitMap(syncGraphToLegacyWaypoints({ ...map, segments: nextSegs }));
      this.host.onNotify('ok', `Updated road width to ${rc.roadWidth} m`);
      this.host.onPushLog('Road', 'action', `Upgraded segment width to ${rc.roadWidth} m.`);
      return;
    }

    const planeY = Math.max(0, rc.drawElevation);
    const groundPt =
      this.camCtrl.raycastGroundPlane(ev.clientX, ev.clientY, planeY) ??
      (planeY > 0 ? this.camCtrl.raycastGroundPlane(ev.clientX, ev.clientY, 0) : null);
    if (!groundPt) return;
    const { nodes, segments } = getMapGraph(map);
    const curState = this.host.getRoadState();
    const snap = this.resolveSnapWithElevatedPick(
      ev.clientX,
      ev.clientY,
      groundPt,
      nodes,
      segments,
      rc,
      curState,
      ev.altKey,
    );

    const outcome: RoadClickOutcome = handleRoadClick(map, curState, snap, {
      roadWidth: rc.roadWidth,
      buildMode: rc.roadBuildMode,
      newNodeRole: rc.newNodeRole,
      elevationMode: rc.drawElevationMode,
      slopeMode: 'straight_slope',
      drawElevation: rc.drawElevation,
      angleSnap: rc.angleSnap,
      altHeld: ev.altKey,
      shiftHeld: ev.shiftKey,
      roadPartAsset: rc.selectedRoadPart || undefined,
      anarchyEnabled: rc.anarchyEnabled,
      minLength: DEFAULT_MIN_SEGMENT_LENGTH,
      maxDeflectionDeg: DEFAULT_FREE_MAX_DEFLECTION_DEG,
      minAngleDeg: 25,
      autoIntersect: rc.autoIntersect,
      joinStyle: rc.roadJoinStyle,
    });

    this.host.onSetRoadState(outcome.nextState);
    if (outcome.blockedReason) {
      this.host.onSetRoadBlockedReason(outcome.blockedReason);
      this.host.onNotify('err', outcome.blockedReason);
      return;
    }
    if (
      curState.status === 'idle' &&
      rc.drawElevation === 0 &&
      snap.pos.y > 0.5 &&
      outcome.nextState.status === 'drawing'
    ) {
      this.host.onAdoptRoadElevation?.(snap.pos.y);
    }
    this.host.onSetRoadBlockedReason(null);
    if (outcome.committed) {
      this.host.onCommitMap(outcome.nextMap);
      this.host.onDismissWelcome();
    }
    if (outcome.selectedNodeId) {
      this.host.onSetSelection([{ type: 'road_node', id: outcome.selectedNodeId }]);
    }
    if (outcome.warning) {
      this.host.onNotify('err', outcome.warning);
    }
    this.host.onPushLog('Road', outcome.committed ? 'ok' : 'info', outcome.message);
  }
}
