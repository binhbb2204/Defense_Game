import * as THREE from 'three';
import type { ElevatedZone, MapDefinition, MapObstacle } from '@tactical-td/shared';
import type { PathSystem } from '../systems/PathSystem';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const MIN_ZOOM_DISTANCE = 3.5;
const MAX_ZOOM_DISTANCE = 88;
const MIN_PITCH_RAD = THREE.MathUtils.degToRad(10);
const MAX_PITCH_RAD = THREE.MathUtils.degToRad(80);

/**
 * Pure Three.js 3D World controller (strictly isolated from React).
 *
 * Manages Scene, Camera (tactical RTS orbit/pan/zoom), Lighting, Renderer,
 * and semantic map groups structured for Phase 2 `three-mesh-bvh` Line-of-Sight
 * and high-ground Placement raycasting.
 */
export class World {
  public readonly container: HTMLElement;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;

  // Semantic scene hierarchy (Phase 2 LoS & Placement hook into these directly)
  public readonly mapRoot = new THREE.Group();
  public readonly groundGroup = new THREE.Group();
  public readonly roadGroup = new THREE.Group();
  public readonly obstaclesGroup = new THREE.Group();
  public readonly elevatedZonesGroup = new THREE.Group();
  public readonly landmarksGroup = new THREE.Group();
  public readonly entitiesGroup = new THREE.Group();
  public readonly debugGroup = new THREE.Group();

  private readonly resizeObserver: ResizeObserver;

  // Tactical Camera State
  private mapHalfWidth = 48;
  private mapHalfDepth = 36;
  private target = new THREE.Vector3(0, 0, 0);
  private desiredTarget = new THREE.Vector3(0, 0, 0);
  private yaw = Math.PI * 0.22;
  private desiredYaw = Math.PI * 0.22;
  private pitchOffset = 0;
  private desiredPitchOffset = 0;
  private zoomDistance = 54;
  private desiredZoomDistance = 54;

  // Input flags
  private readonly keysPressed = new Set<string>();
  private pointerMode: 'none' | 'orbit' | 'pan' = 'none';
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Zero-allocation scratch vectors for 60Hz/144Hz camera updates
  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _moveDelta = new THREE.Vector3();
  private readonly _desiredPos = new THREE.Vector3();
  private readonly _lookTarget = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene + Tactical Dusk Atmosphere
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c121c);
    this.scene.fog = new THREE.FogExp2(0x0c121c, 0.0065);

    this.mapRoot.name = 'MapRoot';
    this.groundGroup.name = 'GroundGroup';
    this.roadGroup.name = 'RoadGroup';
    this.obstaclesGroup.name = 'ObstaclesGroup_LoS';
    this.elevatedZonesGroup.name = 'ElevatedZonesGroup_HighGround';
    this.landmarksGroup.name = 'LandmarksGroup';
    this.entitiesGroup.name = 'EntitiesGroup';
    this.debugGroup.name = 'DebugGroup';

    this.mapRoot.add(
      this.groundGroup,
      this.roadGroup,
      this.obstaclesGroup,
      this.elevatedZonesGroup,
      this.landmarksGroup,
    );
    this.scene.add(this.mapRoot, this.entitiesGroup, this.debugGroup);

    // 2. Camera
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 320);

    // 3. Renderer (tuned for crisp visuals within tight Desktop/Tauri RAM budget)
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    // 4. Lighting
    this.setupLighting();

    // 5. Initial Camera placement
    this.snapCamera();

    // 6. Responsive ResizeObserver & Tactical Controls
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.container);
    this.attachInputListeners();
  }

  private setupLighting(): void {
    const hemiLight = new THREE.HemisphereLight(0x9bb8d8, 0x1e242c, 0.72);
    hemiLight.position.set(0, 60, 0);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff1dc, 1.85);
    sunLight.position.set(34, 58, 28);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 160;
    const d = 56;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.03;
    this.scene.add(sunLight);

    // Subtle cool tactical rim light from opposite horizon
    const rimLight = new THREE.DirectionalLight(0x4f83b8, 0.45);
    rimLight.position.set(-40, 26, -32);
    this.scene.add(rimLight);
  }

  /**
   * Builds Phase 1 prototype geometry (ground, extruded 3D overpass highway,
   * LoS-blocking obstacles/containers/tunnel, elevated rooftops, spawn & base gates).
   */
  public buildPrototypeMap(mapData: MapDefinition, pathSystem: PathSystem): void {
    this.clearGroup(this.groundGroup);
    this.clearGroup(this.roadGroup);
    this.clearGroup(this.obstaclesGroup);
    this.clearGroup(this.elevatedZonesGroup);
    this.clearGroup(this.landmarksGroup);
    this.clearGroup(this.debugGroup);

    this.mapHalfWidth = mapData.bounds.width * 0.5;
    this.mapHalfDepth = mapData.bounds.depth * 0.5;

    this.buildGround(mapData);
    this.buildRoadRibbon(pathSystem);

    for (const obstacle of mapData.obstacles) {
      this.buildObstacle(obstacle);
    }

    for (const zone of mapData.elevatedZones) {
      this.buildElevatedZone(zone);
    }

    this.buildSpawnAndBaseGates(pathSystem);

    const debugVisual = pathSystem.createDebugVisual();
    this.debugGroup.add(debugVisual);
  }

  public setDebugVisible(visible: boolean): void {
    this.debugGroup.visible = visible;
  }

  public resetCamera(): void {
    this.desiredTarget.set(0, 0, 0);
    this.desiredYaw = Math.PI * 0.22;
    this.desiredPitchOffset = 0;
    this.desiredZoomDistance = 54;
  }

  /**
   * Smooth damped RTS camera update called once per render frame.
   * Zero allocations per frame.
   */
  public updateCamera(frameDt: number): void {
    const dt = Math.min(frameDt, 0.05);

    // Keyboard Yaw rotation (Q / E)
    const rotateSpeed = 1.6;
    if (this.keysPressed.has('KeyQ')) this.desiredYaw += rotateSpeed * dt;
    if (this.keysPressed.has('KeyE')) this.desiredYaw -= rotateSpeed * dt;

    // Keyboard Pan (WASD / Arrows) scaled smoothly from close-up inspection to tactical overview
    const panSpeed = 4 + this.zoomDistance * 0.65;
    let moveForward = 0;
    let moveRight = 0;
    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) moveForward += 1;
    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) moveForward -= 1;
    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) moveRight += 1;
    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) moveRight -= 1;

    if (moveForward !== 0 || moveRight !== 0) {
      this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this._right.crossVectors(this._forward, UP_AXIS).normalize();
      this._moveDelta
        .set(0, 0, 0)
        .addScaledVector(this._forward, moveForward)
        .addScaledVector(this._right, moveRight)
        .normalize()
        .multiplyScalar(panSpeed * dt);

      this.desiredTarget.add(this._moveDelta);
      this.clampDesiredTarget();
    }

    // Exponential damping (framerate independent)
    const damp = 1 - Math.exp(-10 * dt);
    this.target.lerp(this.desiredTarget, damp);
    this.yaw += (this.desiredYaw - this.yaw) * damp;
    this.pitchOffset += (this.desiredPitchOffset - this.pitchOffset) * damp;
    this.zoomDistance += (this.desiredZoomDistance - this.zoomDistance) * damp;

    this.applyCameraTransform();
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private snapCamera(): void {
    this.target.copy(this.desiredTarget);
    this.yaw = this.desiredYaw;
    this.pitchOffset = this.desiredPitchOffset;
    this.zoomDistance = this.desiredZoomDistance;
    this.applyCameraTransform();
  }

  private applyCameraTransform(): void {
    // Pitch dynamically flattens when zooming close for street-level model & LoS inspection
    const zoomAlpha =
      (this.zoomDistance - MIN_ZOOM_DISTANCE) / (MAX_ZOOM_DISTANCE - MIN_ZOOM_DISTANCE);
    const clampedZoom = Math.max(0, Math.min(1, zoomAlpha));
    const basePitchRad = THREE.MathUtils.lerp(
      THREE.MathUtils.degToRad(18),
      THREE.MathUtils.degToRad(60),
      Math.pow(clampedZoom, 0.72),
    );
    const pitchRad = THREE.MathUtils.clamp(
      basePitchRad + this.pitchOffset,
      MIN_PITCH_RAD,
      MAX_PITCH_RAD,
    );

    // Raise focus slightly to character chest height (~1m) when zoomed in close
    const closeAlpha = 1 - Math.min(1, (this.zoomDistance - MIN_ZOOM_DISTANCE) / 14);
    this._lookTarget.set(this.target.x, this.target.y + closeAlpha * 0.95, this.target.z);

    const horizontalDist = Math.cos(pitchRad) * this.zoomDistance;
    const verticalDist = Math.sin(pitchRad) * this.zoomDistance;

    this._desiredPos.set(
      this._lookTarget.x + Math.sin(this.yaw) * horizontalDist,
      Math.max(0.45, this._lookTarget.y + verticalDist),
      this._lookTarget.z + Math.cos(this.yaw) * horizontalDist,
    );

    this.camera.position.copy(this._desiredPos);
    this.camera.lookAt(this._lookTarget);
  }

  private clampDesiredTarget(): void {
    const limitX = this.mapHalfWidth - 6;
    const limitZ = this.mapHalfDepth - 6;
    this.desiredTarget.x = Math.max(-limitX, Math.min(limitX, this.desiredTarget.x));
    this.desiredTarget.z = Math.max(-limitZ, Math.min(limitZ, this.desiredTarget.z));
  }

  private buildGround(mapData: MapDefinition): void {
    const { width, depth } = mapData.bounds;

    // Playable tactical ground plane
    const groundGeo = new THREE.BoxGeometry(width, 1.2, depth);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1d2530,
      roughness: 0.94,
      metalness: 0.05,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.set(0, -0.6, 0);
    groundMesh.receiveShadow = true;
    groundMesh.userData = { isBuildableGround: true, surfaceY: 0 };
    this.groundGroup.add(groundMesh);

    // Subtle tactical grid overlay (2m cells)
    const gridSize = Math.max(width, depth);
    const grid = new THREE.GridHelper(gridSize, Math.round(gridSize / 2), 0x334155, 0x243040);
    grid.position.y = 0.02;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const mat of gridMaterials) {
      mat.transparent = true;
      mat.opacity = 0.35;
    }
    this.groundGroup.add(grid);

    // Perimeter border trim
    const borderMat = new THREE.MeshStandardMaterial({
      color: 0x2b3646,
      roughness: 0.85,
      metalness: 0.15,
    });
    const wallThickness = 0.8;
    const wallHeight = 0.45;
    const northSouthGeo = new THREE.BoxGeometry(width + wallThickness * 2, wallHeight, wallThickness);
    const eastWestGeo = new THREE.BoxGeometry(wallThickness, wallHeight, depth);

    const north = new THREE.Mesh(northSouthGeo, borderMat);
    north.position.set(0, wallHeight * 0.5, -depth * 0.5 - wallThickness * 0.5);
    const south = new THREE.Mesh(northSouthGeo, borderMat);
    south.position.set(0, wallHeight * 0.5, depth * 0.5 + wallThickness * 0.5);
    const west = new THREE.Mesh(eastWestGeo, borderMat);
    west.position.set(-width * 0.5 - wallThickness * 0.5, wallHeight * 0.5, 0);
    const east = new THREE.Mesh(eastWestGeo, borderMat);
    east.position.set(width * 0.5 + wallThickness * 0.5, wallHeight * 0.5, 0);

    this.groundGroup.add(north, south, west, east);
  }

  /**
   * Procedurally extrudes a 3D highway ribbon (top deck + side barrier lips +
   * overpass bridge deck thickness) matching PathSystem's arc-length LUT.
   */
  private buildRoadRibbon(pathSystem: PathSystem): void {
    const step = 2;
    const sampleIndices: number[] = [];
    for (let i = 0; i <= pathSystem.lutSegments; i += step) {
      sampleIndices.push(i);
    }
    if (sampleIndices[sampleIndices.length - 1] !== pathSystem.lutSegments) {
      sampleIndices.push(pathSystem.lutSegments);
    }

    const ringCount = sampleIndices.length;
    const deckThickness = 0.38;
    const deckLift = 0.06;

    // 4 vertices per ring: topLeft, topRight, bottomLeft, bottomRight
    const positions = new Float32Array(ringCount * 4 * 3);
    const indices: number[] = [];

    const p = new THREE.Vector3();
    const r = new THREE.Vector3();

    for (let k = 0; k < ringCount; k++) {
      const lutIdx = sampleIndices[k];
      const width = pathSystem.readLutSample(lutIdx, p, r);
      const halfW = width * 0.5;
      const topY = p.y + deckLift;
      const botY = Math.max(-0.08, topY - deckThickness);

      const base = k * 12;
      // 0: topLeft
      positions[base] = p.x - r.x * halfW;
      positions[base + 1] = topY;
      positions[base + 2] = p.z - r.z * halfW;
      // 1: topRight
      positions[base + 3] = p.x + r.x * halfW;
      positions[base + 4] = topY;
      positions[base + 5] = p.z + r.z * halfW;
      // 2: bottomLeft
      positions[base + 6] = p.x - r.x * halfW;
      positions[base + 7] = botY;
      positions[base + 8] = p.z - r.z * halfW;
      // 3: bottomRight
      positions[base + 9] = p.x + r.x * halfW;
      positions[base + 10] = botY;
      positions[base + 11] = p.z + r.z * halfW;

      if (k < ringCount - 1) {
        const a = k * 4;
        const b = (k + 1) * 4;
        // Top asphalt face (CCW viewed from +Y)
        indices.push(a + 0, a + 1, b + 1, a + 0, b + 1, b + 0);
        // Left concrete curb skirt
        indices.push(a + 2, a + 0, b + 0, a + 2, b + 0, b + 2);
        // Right concrete curb skirt
        indices.push(a + 1, a + 3, b + 3, a + 1, b + 3, b + 1);
        // Underside bridge soffit
        indices.push(a + 3, a + 2, b + 2, a + 3, b + 2, b + 3);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    roadGeo.setIndex(indices);
    roadGeo.computeVertexNormals();

    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x2c313a,
      roughness: 0.9,
      metalness: 0.08,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    roadMesh.castShadow = true;
    roadMesh.userData = { isRoad: true, blocksLoS: true };
    this.roadGroup.add(roadMesh);

    // Center tactical road dashes (instanced for minimal draw calls)
    const dashGeo = new THREE.BoxGeometry(0.18, 0.02, 1.3);
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0xd4a93b,
      roughness: 0.6,
      emissive: 0x3a2d0a,
      emissiveIntensity: 0.25,
    });

    const totalLen = pathSystem.getTotalLength();
    const dashSpacing = 3.2;
    const dashCount = Math.floor(totalLen / dashSpacing);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, Math.max(1, dashCount));
    const dashPos = new THREE.Vector3();
    const dashFwd = new THREE.Vector3();
    const dashQuat = new THREE.Quaternion();
    const dashScale = new THREE.Vector3(1, 1, 1);
    const dashMat4 = new THREE.Matrix4();
    const zAxis = new THREE.Vector3(0, 0, 1);

    let placed = 0;
    for (let d = 1.6; d < totalLen - 1.6 && placed < dashCount; d += dashSpacing) {
      pathSystem.sampleAtDistance(d, 0, dashPos, dashFwd);
      dashPos.y += deckLift + 0.02;
      dashQuat.setFromUnitVectors(zAxis, dashFwd);
      dashMat4.compose(dashPos, dashQuat, dashScale);
      dashes.setMatrixAt(placed++, dashMat4);
    }
    dashes.count = placed;
    dashes.instanceMatrix.needsUpdate = true;
    this.roadGroup.add(dashes);
  }

  private buildObstacle(obstacle: MapObstacle): void {
    const geo = new THREE.BoxGeometry(obstacle.size.x, obstacle.size.y, obstacle.size.z);
    const mat = new THREE.MeshStandardMaterial({
      color: obstacle.color ?? '#5b626c',
      roughness: obstacle.kind === 'container' ? 0.65 : 0.88,
      metalness: obstacle.kind === 'container' ? 0.3 : 0.08,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = obstacle.id;
    mesh.position.set(obstacle.position.x, obstacle.position.y, obstacle.position.z);
    if (obstacle.rotationY) {
      mesh.rotation.y = obstacle.rotationY;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      obstacleId: obstacle.id,
      kind: obstacle.kind,
      blocksLoS: obstacle.blocksLoS,
    };

    this.obstaclesGroup.add(mesh);

    // Subtle warning stripe on tunnel portals for clear spatial readability
    if (obstacle.id === 'tunnel_roof') {
      const trimGeo = new THREE.BoxGeometry(obstacle.size.x + 0.2, 0.22, 0.25);
      const trimMat = new THREE.MeshStandardMaterial({
        color: 0xeab308,
        emissive: 0x713f12,
        emissiveIntensity: 0.45,
        roughness: 0.5,
      });
      const halfZ = obstacle.size.z * 0.5;
      const frontTrim = new THREE.Mesh(trimGeo, trimMat);
      frontTrim.position.set(
        obstacle.position.x,
        obstacle.position.y - obstacle.size.y * 0.5 - 0.05,
        obstacle.position.z - halfZ,
      );
      const backTrim = new THREE.Mesh(trimGeo, trimMat);
      backTrim.position.set(
        obstacle.position.x,
        obstacle.position.y - obstacle.size.y * 0.5 - 0.05,
        obstacle.position.z + halfZ,
      );
      this.landmarksGroup.add(frontTrim, backTrim);
    }
  }

  private buildElevatedZone(zone: ElevatedZone): void {
    const height = zone.size.y;

    // Main structural building / tower column (also blocks ground-level LoS!)
    const bodyGeo = new THREE.BoxGeometry(zone.size.x, height, zone.size.z);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: zone.kind === 'watchtower' ? 0x394554 : 0x333c48,
      roughness: 0.85,
      metalness: 0.15,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.name = `${zone.id}_structure`;
    bodyMesh.position.set(zone.position.x, height * 0.5, zone.position.z);
    if (zone.rotationY) bodyMesh.rotation.y = zone.rotationY;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    bodyMesh.userData = {
      obstacleId: `${zone.id}_structure`,
      kind: 'building',
      blocksLoS: true,
    };
    this.obstaclesGroup.add(bodyMesh);

    // Highlighted buildable tactical rooftop pad (targeted by Phase 2 Placement.ts)
    const padGeo = new THREE.BoxGeometry(zone.size.x - 0.5, 0.18, zone.size.z - 0.5);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a4c,
      emissive: 0x0e2a3a,
      emissiveIntensity: 0.5,
      roughness: 0.65,
      metalness: 0.2,
    });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.name = zone.id;
    padMesh.position.set(zone.position.x, height + 0.09, zone.position.z);
    if (zone.rotationY) padMesh.rotation.y = zone.rotationY;
    padMesh.receiveShadow = true;
    padMesh.userData = {
      elevatedZoneId: zone.id,
      label: zone.label,
      isBuildableHighGround: true,
      surfaceY: height + 0.18,
      allowedCategories: zone.allowedCategories ?? ['sniper', 'explosive', 'support'],
    };
    this.elevatedZonesGroup.add(padMesh);

    // Rooftop perimeter tactical edge glow line
    const edges = new THREE.EdgesGeometry(padGeo);
    const outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x38bdf8 }),
    );
    outline.position.copy(padMesh.position);
    outline.rotation.copy(padMesh.rotation);
    this.elevatedZonesGroup.add(outline);
  }

  private buildSpawnAndBaseGates(pathSystem: PathSystem): void {
    const startPos = new THREE.Vector3();
    const startFwd = new THREE.Vector3();
    pathSystem.sampleAtDistance(0, 0, startPos, startFwd);

    const endPos = new THREE.Vector3();
    const endFwd = new THREE.Vector3();
    pathSystem.sampleAtDistance(pathSystem.getTotalLength(), 0, endPos, endFwd);

    const spawnGate = this.createGateArch(0xef4444, 0x7f1d1d);
    spawnGate.position.copy(startPos);
    spawnGate.rotation.y = Math.atan2(startFwd.x, startFwd.z);
    this.landmarksGroup.add(spawnGate);

    const baseGate = this.createGateArch(0x22c55e, 0x14532d);
    baseGate.position.copy(endPos);
    baseGate.rotation.y = Math.atan2(endFwd.x, endFwd.z);
    this.landmarksGroup.add(baseGate);
  }

  private createGateArch(accentHex: number, emissiveHex: number): THREE.Group {
    const group = new THREE.Group();
    const pillarGeo = new THREE.BoxGeometry(0.7, 4.2, 0.7);
    const beamGeo = new THREE.BoxGeometry(6.8, 0.65, 0.9);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.6,
      metalness: 0.4,
    });
    const beaconMat = new THREE.MeshStandardMaterial({
      color: accentHex,
      emissive: emissiveHex,
      emissiveIntensity: 1.4,
      roughness: 0.3,
    });

    const leftPillar = new THREE.Mesh(pillarGeo, frameMat);
    leftPillar.position.set(-3.1, 2.1, 0);
    leftPillar.castShadow = true;

    const rightPillar = new THREE.Mesh(pillarGeo, frameMat);
    rightPillar.position.set(3.1, 2.1, 0);
    rightPillar.castShadow = true;

    const topBeam = new THREE.Mesh(beamGeo, frameMat);
    topBeam.position.set(0, 4.3, 0);
    topBeam.castShadow = true;

    const beaconBar = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.25, 0.25), beaconMat);
    beaconBar.position.set(0, 4.3, 0.48);

    group.add(leftPillar, rightPillar, topBeam, beaconBar);
    return group;
  }

  private attachInputListeners(): void {
    const dom = this.renderer.domElement;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContextMenu);
  }

  private detachInputListeners(): void {
    const dom = this.renderer.domElement;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keysPressed.add(e.code);
    if (e.code === 'KeyR') {
      this.resetCamera();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keysPressed.delete(e.code);
  };

  private readonly onWindowBlur = (): void => {
    this.keysPressed.clear();
    this.pointerMode = 'none';
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) {
      this.pointerMode = 'orbit';
    } else if (e.button === 1) {
      this.pointerMode = 'pan';
    } else {
      return;
    }
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.pointerMode === 'none') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.pointerMode === 'orbit') {
      this.desiredYaw -= dx * 0.0065;
      this.desiredPitchOffset = THREE.MathUtils.clamp(
        this.desiredPitchOffset + dy * 0.0045,
        THREE.MathUtils.degToRad(-35),
        THREE.MathUtils.degToRad(35),
      );
    } else if (this.pointerMode === 'pan') {
      const panFactor = this.zoomDistance * 0.0018;
      this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this._right.crossVectors(this._forward, UP_AXIS).normalize();
      this.desiredTarget
        .addScaledVector(this._right, -dx * panFactor)
        .addScaledVector(this._forward, dy * panFactor);
      this.clampDesiredTarget();
    }
  };

  private readonly onPointerUp = (): void => {
    this.pointerMode = 'none';
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.14 : 1 / 1.14;
    this.desiredZoomDistance = Math.max(
      MIN_ZOOM_DISTANCE,
      Math.min(MAX_ZOOM_DISTANCE, this.desiredZoomDistance * factor),
    );
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private readonly handleResize = (): void => {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      this.disposeObject3D(child);
    }
  }

  private disposeObject3D(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          for (const mat of mesh.material) mat.dispose();
        } else {
          mesh.material.dispose();
        }
      }
    });
  }

  public dispose(): void {
    this.detachInputListeners();
    this.resizeObserver.disconnect();
    this.disposeObject3D(this.scene);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
