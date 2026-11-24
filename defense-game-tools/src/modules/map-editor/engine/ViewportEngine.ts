import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Vec3 } from '@tactical-td/shared';
import { buildShapePreviewGroup } from '../rendering';
import { selectionKey, type EditorTool, type SelectionItem, type ToolboxAssetChoice } from '../types';
import { GizmoDragCoordinator } from './GizmoDragCoordinator';
import { rebuildSceneObjects, type SceneSyncTargets } from './SceneObjectBuilder';
import { ScenePickingService } from './ScenePickingService';
import { disposeObjectResources } from './threeDispose';
import { ViewportCameraController } from './ViewportCameraController';
import { ViewportInteractionController } from './ViewportInteractionController';
import type { ViewportEngineHost } from './ViewportTypes';

/**
 * Owns Three.js scene, camera, transform gizmo, RAF render loop, and delegates
 * drag rebuilding & pointer interactions to specialized controllers.
 */
export class ViewportEngine {
  private readonly container: HTMLElement;
  private readonly host: ViewportEngineHost;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camCtrl: ViewportCameraController;
  private readonly transformControls: TransformControls;
  private readonly picker = new ScenePickingService();
  private readonly gizmoDrag: GizmoDragCoordinator;
  private readonly interaction: ViewportInteractionController;

  private readonly roadMeshesGroup = new THREE.Group();
  private readonly dynamicGroup = new THREE.Group();
  private readonly hoverGroup = new THREE.Group();
  private readonly roadPreviewGroup = new THREE.Group();
  private readonly shapePreviewGroup = new THREE.Group();
  private readonly ghostGroup = new THREE.Group();
  private readonly losGroup = new THREE.Group();
  private readonly snapRingMesh: THREE.Mesh;
  private readonly snapDotMesh: THREE.Mesh;

  private readonly targets: SceneSyncTargets;
  private readonly ro: ResizeObserver;
  private gridHelper!: THREE.GridHelper;
  private rafId = 0;

  constructor(container: HTMLElement, host: ViewportEngineHost) {
    this.container = container;
    this.host = host;
    this.scene.background = new THREE.Color(0x0c0d10);

    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    this.camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 700);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.scene.add(this.transformControls.getHelper());

    this.roadPreviewGroup.visible = false;
    this.ghostGroup.visible = false;
    this.scene.add(
      this.roadMeshesGroup,
      this.dynamicGroup,
      this.hoverGroup,
      this.roadPreviewGroup,
      this.shapePreviewGroup,
      this.ghostGroup,
      this.losGroup,
    );

    this.setupLightingAndGrid();

    this.snapRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.12, 28),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, side: THREE.DoubleSide }),
    );
    this.snapRingMesh.rotation.x = -Math.PI / 2;
    this.snapRingMesh.visible = false;
    this.scene.add(this.snapRingMesh);

    this.snapDotMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x93c5fd }),
    );
    this.snapDotMesh.visible = false;
    this.scene.add(this.snapDotMesh);

    this.targets = {
      roadMeshesGroup: this.roadMeshesGroup,
      dynamicGroup: this.dynamicGroup,
      transformControls: this.transformControls,
      blockerMeshes: [],
      entityObjectMap: new Map(),
      componentGroups: new Map(),
      segmentToComponent: new Map(),
      flowDirections: new Map(),
    };

    this.gizmoDrag = new GizmoDragCoordinator(this.transformControls, this.targets, this.host);

    this.camCtrl = new ViewportCameraController(this.camera, this.renderer.domElement, {
      shouldYieldToGizmo: () =>
        Boolean(this.transformControls.axis !== null || this.gizmoDrag.isDragging),
      onPointerMoveHover: (cx, cy, alt, shift) =>
        this.interaction.handlePointerMoveHover(cx, cy, alt, shift),
      onLeftClick: (ev) => this.interaction.handleLeftClick(ev),
      onRightClick: () => this.interaction.finishChain('right-click'),
      onDoubleClick: () => this.interaction.finishChain('double-click'),
    });

    this.interaction = new ViewportInteractionController(
      this.camera,
      this.renderer.domElement,
      this.camCtrl,
      this.picker,
      this.targets,
      {
        roadMeshesGroup: this.roadMeshesGroup,
        hoverGroup: this.hoverGroup,
        roadPreviewGroup: this.roadPreviewGroup,
        ghostGroup: this.ghostGroup,
        losGroup: this.losGroup,
        snapRingMesh: this.snapRingMesh,
        snapDotMesh: this.snapDotMesh,
      },
      this.host,
    );

    this.ro = new ResizeObserver(() => this.handleResize());
    this.ro.observe(container);

    let lastTime = performance.now();
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      this.camCtrl.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  private setupLightingAndGrid(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.75);
    const dir = new THREE.DirectionalLight(0xffffff, 1.35);
    dir.position.set(30, 50, 26);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -65;
    dir.shadow.camera.right = 65;
    dir.shadow.camera.top = 65;
    dir.shadow.camera.bottom = -65;
    this.scene.add(hemi, dir);

    this.gridHelper = new THREE.GridHelper(160, 80, 0x222630, 0x191d26);
    this.gridHelper.position.y = 0.01;
    this.gridHelper.visible = false;
    this.scene.add(this.gridHelper);

    const groundVisual = new THREE.Mesh(
      new THREE.PlaneGeometry(320, 320),
      new THREE.MeshStandardMaterial({ color: 0x101217, roughness: 0.96, metalness: 0.02 }),
    );
    groundVisual.rotation.x = -Math.PI / 2;
    groundVisual.receiveShadow = true;
    this.scene.add(groundVisual);
  }

  private handleResize(): void {
    const cw = Math.max(this.container.clientWidth, 1);
    const ch = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = cw / ch;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(cw, ch);
  }

  public rebuildGhostProp(
    selectedAsset: ToolboxAssetChoice | null,
    activeTool: EditorTool,
    ghostRotDeg: number,
  ): void {
    this.interaction.rebuildGhostProp(selectedAsset, activeTool, ghostRotDeg);
  }

  public syncScene(): void {
    const rc = this.host.getRoadConfig();
    const activeTool = this.host.getActiveTool();
    this.gridHelper.visible = activeTool === 'road';
    const shapePreviewData = activeTool === 'shape' ? this.host.getShapePreviewData() : null;

    rebuildSceneObjects(this.targets, {
      map: this.host.getMap(),
      selection: this.host.getSelection(),
      activeTool,
      roadState: this.host.getRoadState(),
      gridEnabled: rc.gridEnabled,
      gridStep: rc.gridStep,
      anarchyEnabled: rc.anarchyEnabled,
      roadJoinStyle: rc.roadJoinStyle,
      showRoadDebug: rc.showRoadDebug,
      hiddenIds: this.host.getHiddenIds(),
      lockedIds: this.host.getLockedIds(),
      assetCache: this.host.getAssetCache(),
      shapePreviewData,
    });

    while (this.shapePreviewGroup.children.length > 0) {
      const c = this.shapePreviewGroup.children[0]!;
      this.shapePreviewGroup.remove(c);
      disposeObjectResources(c);
    }
    if (shapePreviewData) {
      this.shapePreviewGroup.add(buildShapePreviewGroup(shapePreviewData, rc.roadJoinStyle));
      this.shapePreviewGroup.visible = true;
    } else {
      this.shapePreviewGroup.visible = false;
    }
  }

  public focusOn(pos: Vec3, distance = 22): void {
    this.camCtrl.focusOn(pos, distance);
  }

  public focusSelection(item: SelectionItem | undefined): void {
    if (!item) return;
    const obj = this.targets.entityObjectMap.get(selectionKey(item));
    if (obj) {
      const wp = new THREE.Vector3();
      obj.getWorldPosition(wp);
      this.camCtrl.focusOn(wp, 20);
    }
  }

  public snapView(mode: 'top' | 'iso'): void {
    this.camCtrl.snapView(mode);
  }

  public refreshHover(): void {
    this.camCtrl.refreshHover();
  }

  public dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.gizmoDrag.dispose();
    this.ro.disconnect();
    this.camCtrl.dispose();
    this.transformControls.detach();
    this.transformControls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
