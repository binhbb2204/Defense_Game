import * as THREE from 'three';
import type { EditorTool, ToolboxAssetChoice } from '../types';
import { runLosProbeQuery } from './LosProbeService';
import { placePropAt, rebuildGhostPropMesh } from './PropPlacementService';
import { RoadInteractionService } from './RoadInteractionService';
import type { SceneSyncTargets } from './SceneObjectBuilder';
import { ScenePickingService } from './ScenePickingService';
import { ViewportCameraController } from './ViewportCameraController';
import type { ViewportEngineHost } from './ViewportTypes';

export interface InteractionGroups {
  roadMeshesGroup: THREE.Group;
  hoverGroup: THREE.Group;
  roadPreviewGroup: THREE.Group;
  ghostGroup: THREE.Group;
  losGroup: THREE.Group;
  snapRingMesh: THREE.Mesh;
  snapDotMesh: THREE.Mesh;
}

/**
 * Dispatches viewport hover previews, road interactions, LoS probing, prop stamping,
 * and entity picking without coupling directly to renderer setup.
 */
export class ViewportInteractionController {
  private readonly roadService: RoadInteractionService;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
    private readonly camCtrl: ViewportCameraController,
    private readonly picker: ScenePickingService,
    private readonly targets: SceneSyncTargets,
    private readonly groups: InteractionGroups,
    private readonly host: ViewportEngineHost,
  ) {
    this.roadService = new RoadInteractionService(
      camera,
      domElement,
      camCtrl,
      picker,
      targets,
      groups.hoverGroup,
      groups.roadPreviewGroup,
      groups.snapRingMesh,
      groups.snapDotMesh,
      host,
    );
  }

  public clearTransientRoadVisuals(): void {
    this.groups.snapRingMesh.visible = false;
    this.groups.snapDotMesh.visible = false;
    this.roadService.clearPreviewMeshes();
    this.host.onSetRoadPreviewHud(null);
  }

  public finishChain(source: string): void {
    if (this.host.getActiveTool() === 'road' && this.host.getRoadState().status === 'drawing') {
      this.host.onSetRoadState({ status: 'idle' });
      this.host.onSetRoadBlockedReason(null);
      this.clearTransientRoadVisuals();
      this.host.onPushLog('Road', 'action', `Finished drawing road chain (${source}).`);
    }
  }

  public handlePointerMoveHover(
    clientX: number,
    clientY: number,
    altHeld: boolean,
    shiftHeld: boolean,
  ): void {
    const rc = this.host.getRoadConfig();
    const map = this.host.getMap();
    const tool = this.host.getActiveTool();
    const planeY = tool === 'road' && !rc.roadUpgradeMode ? Math.max(0, rc.drawElevation) : 0;
    const groundPt =
      this.camCtrl.raycastGroundPlane(clientX, clientY, planeY) ??
      (planeY > 0 ? this.camCtrl.raycastGroundPlane(clientX, clientY, 0) : null);
    if (!groundPt) {
      this.clearTransientRoadVisuals();
      this.groups.ghostGroup.visible = false;
      this.picker.updateHoverHighlight(null, this.groups.hoverGroup, this.targets.entityObjectMap, map);
      return;
    }

    const step = Math.max(0.5, rc.gridStep);
    const sx =
      !altHeld && rc.gridEnabled
        ? Number((Math.round(groundPt.x / step) * step).toFixed(2))
        : Number(groundPt.x.toFixed(1));
    const sz =
      !altHeld && rc.gridEnabled
        ? Number((Math.round(groundPt.z / step) * step).toFixed(2))
        : Number(groundPt.z.toFixed(1));
    this.host.onSetCursorCoords({ x: sx, z: sz });

    if (tool === 'road') {
      this.groups.ghostGroup.visible = false;
      this.roadService.handleHover(clientX, clientY, groundPt, altHeld, shiftHeld);
      return;
    }

    this.clearTransientRoadVisuals();
    this.host.onSetRoadBlockedReason(null);

    const selectedAsset = this.host.getSelectedAsset();
    if (tool === 'place' && selectedAsset) {
      this.picker.updateHoverHighlight(null, this.groups.hoverGroup, this.targets.entityObjectMap, map);
      const baseY = selectedAsset.kind === 'custom_model' ? 0 : selectedAsset.size.y * 0.5;
      this.groups.ghostGroup.position.set(sx, baseY, sz);
      this.groups.ghostGroup.rotation.y = THREE.MathUtils.degToRad(this.host.getGhostRotDeg());
      this.groups.ghostGroup.visible = true;
      return;
    }

    this.groups.ghostGroup.visible = false;
    const picked = this.picker.pickSelectableAt(
      clientX,
      clientY,
      this.domElement,
      this.camera,
      this.targets.entityObjectMap,
      this.groups.roadMeshesGroup,
      map,
    );
    this.picker.updateHoverHighlight(picked, this.groups.hoverGroup, this.targets.entityObjectMap, map);
  }

  public handleLeftClick(ev: PointerEvent): void {
    const map = this.host.getMap();
    if (this.host.getLosMode()) {
      const groundPt = this.camCtrl.raycastGroundPlane(ev.clientX, ev.clientY, 0);
      if (groundPt) {
        const res = runLosProbeQuery(
          new THREE.Vector3(groundPt.x, 2.2, groundPt.z),
          map,
          this.targets.blockerMeshes,
          this.groups.losGroup,
        );
        this.host.onSetLosProbe(res);
        this.host.onPushLog('LoS', 'info', `LoS probe at (${groundPt.x.toFixed(1)}, ${groundPt.z.toFixed(1)}).`);
      }
      return;
    }

    const tool = this.host.getActiveTool();
    if (tool === 'road') {
      this.roadService.handleClick(ev);
      return;
    }

    const selectedAsset = this.host.getSelectedAsset();
    if (tool === 'place' && selectedAsset) {
      const groundPt = this.camCtrl.raycastGroundPlane(ev.clientX, ev.clientY, 0);
      if (!groundPt) return;
      const rc = this.host.getRoadConfig();
      const step = Math.max(0.5, rc.gridStep);
      const px =
        !ev.altKey && rc.gridEnabled
          ? Number((Math.round(groundPt.x / step) * step).toFixed(2))
          : Number(groundPt.x.toFixed(1));
      const pz =
        !ev.altKey && rc.gridEnabled
          ? Number((Math.round(groundPt.z / step) * step).toFixed(2))
          : Number(groundPt.z.toFixed(1));
      placePropAt(selectedAsset, { x: px, y: 0, z: pz }, this.host);
      return;
    }

    const picked = this.picker.pickSelectableAt(
      ev.clientX,
      ev.clientY,
      this.domElement,
      this.camera,
      this.targets.entityObjectMap,
      this.groups.roadMeshesGroup,
      map,
    );
    if (tool === 'erase') {
      if (picked) this.host.onDeleteItems([picked]);
      return;
    }
    if (tool === 'shape') {
      this.host.onShapePick(picked);
      return;
    }
    this.host.onSelectItem(picked, ev.shiftKey || ev.ctrlKey || ev.metaKey);
  }

  public rebuildGhostProp(
    selectedAsset: ToolboxAssetChoice | null,
    activeTool: EditorTool,
    ghostRotDeg: number,
  ): void {
    rebuildGhostPropMesh(
      this.groups.ghostGroup,
      selectedAsset,
      activeTool,
      ghostRotDeg,
      this.host.getAssetCache(),
    );
  }
}
