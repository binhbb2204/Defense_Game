import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { TowerCategory, TowerLevelConfig } from '@tactical-td/shared';
import { TurretRigController } from '@tactical-td/shared/towers/Turret';
import { GunshotVfxSystem, resolveGunPresetForCategory } from '@tactical-td/vfx';

interface TurretPreviewCanvasProps {
  towerId: string;
  towerName: string;
  towerModelPath?: string;
  category: TowerCategory;
  totalInvestedCost: number;
  levelCfg: TowerLevelConfig;
  targetOrbitSpeed: number;
  muzzleOffset: { x: number; y: number; z: number };
  onChangeOrbitSpeed: (speed: number) => void;
}

const DEFAULT_CAM = { yaw: 0.78, pitch: 0.42, dist: 12.5 };

const TOWER_GLB_LOADERS = import.meta.glob(
  ['../../../../packages/shared/towers/**/*.glb', '!**/draft*/**'],
  {
    query: '?url',
    import: 'default',
  },
) as Record<string, () => Promise<string>>;

function findTowerGlbLoader(modelPath?: string): (() => Promise<string>) | null {
  if (!modelPath) return null;
  const normalized = modelPath
    .replace(/\\/g, '/')
    .replace(/^\/?models\/towers\//, '')
    .replace(/^\/+/, '');
  if (!normalized) return null;

  const entries = Object.entries(TOWER_GLB_LOADERS);
  const bySuffix = entries.find(([key]) => key.replace(/\\/g, '/').endsWith(`/${normalized}`));
  if (bySuffix) return bySuffix[1];

  const baseName = normalized.split('/').pop();
  if (!baseName) return null;
  const byBase = entries.find(([key]) => key.replace(/\\/g, '/').endsWith(`/${baseName}`));
  return byBase ? byBase[1] : null;
}

const turretTemplateCache = new Map<string, Promise<THREE.Group>>();
function loadTowerTemplate(cacheKey: string, urlLoader: () => Promise<string>): Promise<THREE.Group> {
  let cached = turretTemplateCache.get(cacheKey);
  if (!cached) {
    const loader = new GLTFLoader();
    cached = urlLoader()
      .then((url) => loader.loadAsync(url))
      .then((gltf) => {
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        return gltf.scene;
      });
    turretTemplateCache.set(cacheKey, cached);
  }
  return cached;
}

function buildProceduralTurretRig(category: TowerCategory): {
  root: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
} {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const root = new THREE.Group();
  root.name = 'Tower_Root';

  const baseGeo = new THREE.CylinderGeometry(0.95, 1.18, 0.56, 18);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x333c4d, roughness: 0.65, metalness: 0.25 });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.name = 'Base_Static';
  baseMesh.position.y = 0.28;
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;

  const yawGroup = new THREE.Group();
  yawGroup.name = 'Turret_Yaw';
  yawGroup.position.y = 0.58;

  const carriageGeo = new THREE.BoxGeometry(1.1, 0.5, 1.25);
  const carriageMat = new THREE.MeshStandardMaterial({ color: 0x293242, roughness: 0.5, metalness: 0.35 });
  const carriage = new THREE.Mesh(carriageGeo, carriageMat);
  carriage.position.y = 0.25;
  carriage.castShadow = true;
  carriage.receiveShadow = true;
  yawGroup.add(carriage);

  const pitchGroup = new THREE.Group();
  pitchGroup.name = 'Turret_Pitch';
  pitchGroup.position.set(0, 0.56, -0.04);

  const headGeo = new THREE.BoxGeometry(0.92, 0.58, 1.28);
  const headMat = new THREE.MeshStandardMaterial({
    color: category === 'explosive' ? 0xd97706 : 0x3b82f6,
    roughness: 0.42,
    metalness: 0.35,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.castShadow = true;
  head.receiveShadow = true;
  pitchGroup.add(head);

  const ejectSocket = new THREE.Object3D();
  ejectSocket.name = 'Eject_Socket';
  ejectSocket.position.set(-0.48, 0.08, -0.05);
  pitchGroup.add(ejectSocket);

  const barrelGroup = new THREE.Group();
  barrelGroup.name = 'Barrel_Recoil';
  barrelGroup.position.set(0, 0.06, 0.52);

  const radius = category === 'explosive' ? 0.24 : 0.11;
  const len = category === 'sniper' ? 1.95 : 1.45;
  const tubeGeo = new THREE.CylinderGeometry(radius * 0.85, radius, len, 14);
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.32, metalness: 0.7 });
  const tube = new THREE.Mesh(tubeGeo, tubeMat);
  tube.rotation.x = Math.PI / 2;
  tube.position.z = len * 0.5;
  tube.castShadow = true;
  barrelGroup.add(tube);

  const muzzleSocket = new THREE.Object3D();
  muzzleSocket.name = 'Muzzle_Socket';
  muzzleSocket.position.set(0, 0, len - 1.55);
  barrelGroup.add(muzzleSocket);

  pitchGroup.add(barrelGroup);
  yawGroup.add(pitchGroup);
  root.add(baseMesh, yawGroup);

  geometries.push(baseGeo, carriageGeo, headGeo, tubeGeo);
  materials.push(baseMat, carriageMat, headMat, tubeMat);
  return { root, geometries, materials };
}

/**
 * Interactive 3D Three.js turret studio stage with real rigged GLB showcase,
 * 2nd-order recoil/shock spring kinematics, autonomous scan/track modes,
 * visible 3D bone gizmos, and autocannon firing VFX.
 */
export function TurretPreviewCanvas({
  towerId,
  towerName,
  towerModelPath,
  category,
  totalInvestedCost,
  levelCfg,
  targetOrbitSpeed,
  muzzleOffset,
  onChangeOrbitSpeed,
}: TurretPreviewCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const telemetryRef = useRef<HTMLSpanElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [motionMode, setMotionMode] = useState<'track' | 'scan'>('track');
  const [showRig, setShowRig] = useState(false);
  const [loadingModel, setLoadingModel] = useState(() =>
    Boolean(findTowerGlbLoader(levelCfg.modelPath ?? towerModelPath)),
  );

  const camRef = useRef({ ...DEFAULT_CAM });
  const manualShotQueueRef = useRef(0);
  const rigCtrlRef = useRef<TurretRigController | null>(null);
  const paramsRef = useRef({
    towerId,
    towerModelPath,
    levelCfg,
    category,
    targetOrbitSpeed,
    muzzleOffset,
    paused,
    motionMode,
    showRig,
  });
  paramsRef.current = {
    towerId,
    towerModelPath,
    levelCfg,
    category,
    targetOrbitSpeed,
    muzzleOffset,
    paused,
    motionMode,
    showRig,
  };

  useEffect(() => {
    rigCtrlRef.current?.setRigOverlayVisible(showRig);
  }, [showRig]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    let disposed = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1016);

    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);

    const applyCamera = () => {
      const { yaw, pitch, dist } = camRef.current;
      const cp = Math.cos(pitch);
      camera.position.set(
        Math.sin(yaw) * cp * dist,
        1.05 + Math.sin(pitch) * dist,
        Math.cos(yaw) * cp * dist,
      );
      camera.lookAt(0, 1.05, 0);
    };
    applyCamera();

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    // 3-point armory lighting + soft shadow-receiving floor disc
    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.95));
    const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.2);
    keyLight.position.set(8, 16, 10);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 48;
    keyLight.shadow.camera.left = -12;
    keyLight.shadow.camera.right = 12;
    keyLight.shadow.camera.top = 12;
    keyLight.shadow.camera.bottom = -12;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.75);
    rimLight.position.set(-10, 8, -9);
    scene.add(rimLight);

    const floorGeo = new THREE.CircleGeometry(24, 64);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: 0.9, metalness: 0.1 });
    const floorDisc = new THREE.Mesh(floorGeo, floorMat);
    floorDisc.position.y = -0.005;
    floorDisc.receiveShadow = true;
    scene.add(floorDisc);

    const grid = new THREE.GridHelper(60, 30, 0x2a3242, 0x1a1f29);
    scene.add(grid);

    // Soft translucent range disc + perimeter ring + explosive ring
    const ringGeo = new THREE.RingGeometry(0.985, 1.0, 72);
    ringGeo.rotateX(-Math.PI / 2);
    const discGeo = new THREE.CircleGeometry(1.0, 72);
    discGeo.rotateX(-Math.PI / 2);

    const rangeMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, side: THREE.DoubleSide });
    const rangeDiscMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rangeRing = new THREE.Mesh(ringGeo, rangeMat);
    rangeRing.position.y = 0.03;
    const rangeDisc = new THREE.Mesh(discGeo, rangeDiscMat);
    rangeDisc.position.y = 0.02;
    scene.add(rangeDisc, rangeRing);

    const stunMat = new THREE.MeshBasicMaterial({ color: 0xf97316, side: THREE.DoubleSide });
    const stunRing = new THREE.Mesh(ringGeo, stunMat);
    stunRing.position.y = 0.04;
    scene.add(stunRing);

    const dummyGeo = new THREE.BoxGeometry(0.85, 1.75, 0.65);
    const dummyMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.55 });
    const dummy = new THREE.Mesh(dummyGeo, dummyMat);
    dummy.position.set(10, 0.9, 0);
    dummy.castShadow = true;
    dummy.receiveShadow = true;
    scene.add(dummy);

    const vfx = new GunshotVfxSystem(
      scene,
      resolveGunPresetForCategory(
        paramsRef.current.towerId,
        paramsRef.current.category,
        paramsRef.current.levelCfg.vfxPreset,
      ),
    );

    // Mount active tower rig (cached level-specific rigged GLB for 'turret', articulated procedural fallback otherwise)
    const towerHolder = new THREE.Group();
    scene.add(towerHolder);

    const localDisposables: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } = {
      geometries: [],
      materials: [],
    };
    let activeRig: TurretRigController | null = null;
    const activeModelKeyRef = { current: '' };
    const activePresetRef = {
      current: resolveGunPresetForCategory(
        paramsRef.current.towerId,
        paramsRef.current.category,
        paramsRef.current.levelCfg.vfxPreset,
      ),
    };

    const getModelKey = (tid: string, fallbackPath: string | undefined, lv: TowerLevelConfig) =>
      `${tid}:${lv.modelPath ?? fallbackPath ?? lv.level}`;

    const mountArchetype = (
      tid: string,
      fallbackPath: string | undefined,
      cat: TowerCategory,
      lv: TowerLevelConfig,
    ) => {
      const modelKey = getModelKey(tid, fallbackPath, lv);
      activeModelKeyRef.current = modelKey;
      while (towerHolder.children.length > 0) {
        towerHolder.remove(towerHolder.children[0]!);
      }
      activeRig?.dispose();
      activeRig = null;
      rigCtrlRef.current = null;
      for (const g of localDisposables.geometries) g.dispose();
      for (const m of localDisposables.materials) m.dispose();
      localDisposables.geometries = [];
      localDisposables.materials = [];

      const effectivePath = lv.modelPath ?? fallbackPath;
      const glbLoader = findTowerGlbLoader(effectivePath);
      if (glbLoader) {
        setLoadingModel(true);
        void loadTowerTemplate(effectivePath ?? modelKey, glbLoader)
          .then((tpl) => {
            if (disposed || activeModelKeyRef.current !== modelKey) return;
            const instance = tpl.clone(true);
            towerHolder.add(instance);
            const ctrl = new TurretRigController(instance);
            ctrl.setRigOverlayVisible(paramsRef.current.showRig);
            ctrl.applyMuzzleTrim(paramsRef.current.muzzleOffset);
            activeRig = ctrl;
            rigCtrlRef.current = ctrl;
            setLoadingModel(false);
          })
          .catch(() => {
            if (disposed || activeModelKeyRef.current !== modelKey) return;
            const proc = buildProceduralTurretRig(cat);
            localDisposables.geometries.push(...proc.geometries);
            localDisposables.materials.push(...proc.materials);
            towerHolder.add(proc.root);
            const ctrl = new TurretRigController(proc.root);
            ctrl.setRigOverlayVisible(paramsRef.current.showRig);
            ctrl.applyMuzzleTrim(paramsRef.current.muzzleOffset);
            activeRig = ctrl;
            rigCtrlRef.current = ctrl;
            setLoadingModel(false);
          });
        return;
      }

      setLoadingModel(false);
      const proc = buildProceduralTurretRig(cat);
      localDisposables.geometries.push(...proc.geometries);
      localDisposables.materials.push(...proc.materials);
      towerHolder.add(proc.root);
      const ctrl = new TurretRigController(proc.root);
      ctrl.setRigOverlayVisible(paramsRef.current.showRig);
      ctrl.applyMuzzleTrim(paramsRef.current.muzzleOffset);
      activeRig = ctrl;
      rigCtrlRef.current = ctrl;
    };

    mountArchetype(
      paramsRef.current.towerId,
      paramsRef.current.towerModelPath,
      paramsRef.current.category,
      paramsRef.current.levelCfg,
    );

    // Interactive orbit camera controls
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: MouseEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      camRef.current.yaw -= dx * 0.008;
      camRef.current.pitch = THREE.MathUtils.clamp(camRef.current.pitch + dy * 0.007, 0.14, 1.38);
      applyCamera();
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camRef.current.dist = THREE.MathUtils.clamp(camRef.current.dist + e.deltaY * 0.012, 4.5, 38);
      applyCamera();
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousedown', onPointerDown);
    dom.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    let orbitAngle = 0;
    let fireCooldown = 0;
    let lastTime = performance.now();
    const muzzleWorldPos = new THREE.Vector3();
    const muzzleWorldDir = new THREE.Vector3();
    const ejectPos = new THREE.Vector3();
    const ejectRight = new THREE.Vector3();
    const ejectUp = new THREE.Vector3();
    const ejectBack = new THREE.Vector3();
    const targetWorldPos = new THREE.Vector3();

    let rafId = 0;
    const animate = (now: number) => {
      const rawDt = Math.min((now - lastTime) * 0.001, 0.05);
      lastTime = now;
      const {
        towerId: curTowerId,
        towerModelPath: curTowerModelPath,
        levelCfg: lv,
        category: cat,
        targetOrbitSpeed: spd,
        muzzleOffset: mo,
        paused: isPaused,
        motionMode: mode,
      } = paramsRef.current;

      const nextPreset = resolveGunPresetForCategory(curTowerId, cat, lv.vfxPreset);
      if (nextPreset !== activePresetRef.current) {
        activePresetRef.current = nextPreset;
        vfx.setPreset(nextPreset);
      }

      const nextModelKey = getModelKey(curTowerId, curTowerModelPath, lv);
      if (nextModelKey !== activeModelKeyRef.current) {
        mountArchetype(curTowerId, curTowerModelPath, cat, lv);
      }

      const dt = isPaused ? 0 : rawDt;

      rangeRing.scale.setScalar(lv.range);
      rangeDisc.scale.setScalar(lv.range);
      const splash = lv.splashRadius ?? 0;
      stunRing.visible = splash > 0;
      if (splash > 0) stunRing.scale.setScalar(splash);

      const orbitRadius = Math.min(lv.range * 0.72, 16);
      orbitAngle += (spd / Math.max(orbitRadius, 1)) * dt;
      dummy.position.set(Math.cos(orbitAngle) * orbitRadius, 0.9, Math.sin(orbitAngle) * orbitRadius);
      dummy.visible = mode === 'track';

      let hasMuzzle = false;
      if (activeRig) {
        activeRig.applyMuzzleTrim(mo);
        const telemetry =
          mode === 'track'
            ? activeRig.updateTrackTarget(dummy.position, lv.turnSpeedRad, cat, dt)
            : activeRig.updateIdleScan(dt, lv.turnSpeedRad);

        activeRig.updatePhysics(dt);
        hasMuzzle = activeRig.getMuzzleWorldPose(muzzleWorldPos, muzzleWorldDir);

        if (telemetryRef.current) {
          const spinSuffix = telemetry.spinRpm !== undefined ? ` · SPIN ${telemetry.spinRpm} RPM` : '';
          telemetryRef.current.textContent = `YAW ${telemetry.yawDeg >= 0 ? '+' : ''}${telemetry.yawDeg} deg · ELEV ${telemetry.pitchDeg >= 0 ? '+' : ''}${telemetry.pitchDeg} deg · RECOIL ${telemetry.recoilMm} mm${spinSuffix}`;
        }

        const fireQueued = manualShotQueueRef.current > 0;
        if (fireQueued) {
          manualShotQueueRef.current--;
        }

        fireCooldown -= dt;
        const autoReady = mode === 'track' && dt > 0 && telemetry.aligned && fireCooldown <= 0;
        if ((autoReady || fireQueued) && hasMuzzle) {
          fireCooldown = 1 / Math.max(0.1, lv.fireRate);
          const recoilMul = cat === 'explosive' ? 1.35 : cat === 'sniper' ? 1.25 : 1.0;
          activeRig.triggerRecoil(recoilMul);
          // Re-read muzzle immediately after micro-kick so VFX aligns crisply
          activeRig.updatePhysics(0);
          activeRig.getMuzzleWorldPose(muzzleWorldPos, muzzleWorldDir);
          const hasEject = activeRig.getEjectWorldPose(ejectPos, ejectRight, ejectUp, ejectBack);

          targetWorldPos.copy(dummy.position);
          vfx.triggerShot({
            muzzlePos: muzzleWorldPos,
            muzzleDir: muzzleWorldDir,
            targetPos: mode === 'track' ? targetWorldPos : null,
            projectileSpeed: lv.projectileSpeed,
            ejectPos: hasEject ? ejectPos : undefined,
            ejectRight: hasEject ? ejectRight : undefined,
            ejectUp: hasEject ? ejectUp : undefined,
            ejectBack: hasEject ? ejectBack : undefined,
            scaleMul: cat === 'explosive' ? 1.3 : 1.0,
          });
        }
      }

      applyCamera();
      vfx.update(
        dt,
        camera,
        hasMuzzle ? muzzleWorldPos : null,
        hasMuzzle ? muzzleWorldDir : null,
        mode === 'track' ? dummy.position : null,
      );

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    const ro = new ResizeObserver(() => {
      const nw = Math.max(container.clientWidth, 1);
      const nh = Math.max(container.clientHeight, 1);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh, false);
    });
    ro.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      dom.removeEventListener('mousedown', onPointerDown);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      activeRig?.dispose();
      rigCtrlRef.current = null;
      vfx.dispose();
      for (const g of localDisposables.geometries) g.dispose();
      for (const m of localDisposables.materials) m.dispose();
      [floorGeo, ringGeo, discGeo, dummyGeo].forEach((g) => g.dispose());
      [floorMat, rangeMat, rangeDiscMat, stunMat, dummyMat].forEach((m) => m.dispose());
      renderer.dispose();
      if (dom.parentElement === container) container.removeChild(dom);
    };
  }, []);

  const dps = levelCfg.damage * levelCfg.fireRate;
  const effPer100 = totalInvestedCost > 0 ? ((dps / totalInvestedCost) * 100).toFixed(1) : '0.0';

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden bg-[#0d1016]">
      <div ref={mountRef} className="h-full w-full cursor-grab active:cursor-grabbing" />

      {/* Top-left Studio Telemetry Pill + Live Rig Readout */}
      <div className="pointer-events-none absolute top-3.5 left-3.5 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-white/10 bg-[#14171f]/88 px-3.5 py-2 text-[12.5px] shadow-lg backdrop-blur-md">
          <span className="font-semibold text-white">{towerName}</span>
          <span className="mono-num rounded-md bg-[#1d2c4a] px-2 py-0.5 text-[11px] font-medium text-[#93c5fd]">
            Lv.{levelCfg.level}
            {levelCfg.pathName ? ` · ${levelCfg.pathName}` : ''}
          </span>
          <span className="mono-num text-[#e5e7eb]">{dps.toFixed(1)} DPS</span>
          <span className="text-[#404859]">·</span>
          <span className="mono-num text-[#949db0]">{effPer100} DPS/$100</span>
          <span className="text-[#404859]">·</span>
          <span className="mono-num text-[#93c5fd]">Range {levelCfg.range}m</span>
          {levelCfg.splashRadius ? (
            <>
              <span className="text-[#404859]">·</span>
              <span className="mono-num text-[#fdba74]">Splash {levelCfg.splashRadius}m</span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 self-start rounded-lg border border-white/[0.08] bg-[#14171f]/82 px-3 py-1 text-[11px] text-[#94a3b8] backdrop-blur-md">
          <span ref={telemetryRef} className="mono-num">
            YAW +0 deg · ELEV 0.0 deg · RECOIL 0 mm
          </span>
          {loadingModel && <span className="text-[#93c5fd]">Loading 3D rig...</span>}
        </div>
      </div>

      {/* Bottom-center Stage Controls Pill */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-[#14171f]/90 px-3.5 py-2 text-[12px] shadow-lg backdrop-blur-md">
        <button
          type="button"
          onClick={() => setPaused((v) => !v)}
          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 font-medium text-[#eef1f6] hover:bg-white/[0.1]"
        >
          {paused ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="currentColor">
              <path d="M3 2.2 9.5 6 3 9.8V2.2Z" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2.75" y="2.5" width="2.2" height="7" rx="0.5" />
              <rect x="7" y="2.5" width="2.2" height="7" rx="0.5" />
            </svg>
          )}
          <span>{paused ? 'Resume' : 'Pause'}</span>
        </button>

        <button
          type="button"
          title="Trigger test recoil & firing VFX"
          onClick={() => {
            manualShotQueueRef.current += 1;
          }}
          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[#f59e0b]/45 bg-[#f59e0b]/15 px-3 font-semibold text-[#fcd34d] hover:bg-[#f59e0b]/25"
        >
          <span className="h-2 w-2 rounded-full bg-[#fbbf24]" />
          <span>Fire</span>
        </button>

        <button
          type="button"
          title="Switch between Target Tracking and Autonomous Sentry Scan"
          onClick={() => setMotionMode((m) => (m === 'track' ? 'scan' : 'track'))}
          className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 font-medium transition-colors ${
            motionMode === 'scan'
              ? 'border-[#3b82f6]/60 bg-[#2563eb]/20 text-[#93c5fd]'
              : 'border-white/10 bg-white/[0.06] text-[#e5e7eb] hover:bg-white/[0.1]'
          }`}
        >
          <span>{motionMode === 'track' ? 'Track' : 'Scan'}</span>
        </button>

        <button
          type="button"
          title="Show/hide 3D bone pivots & axes"
          onClick={() => setShowRig((v) => !v)}
          className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 font-medium transition-colors ${
            showRig
              ? 'border-[#22d3ee]/60 bg-[#0891b2]/25 text-[#67e8f9]'
              : 'border-white/10 bg-white/[0.06] text-[#a1a8b5] hover:bg-white/[0.1] hover:text-white'
          }`}
        >
          <span>Rig</span>
        </button>

        <div className="flex items-center gap-2 pl-1">
          <span className="text-[#8b95a7]">Dummy</span>
          <input
            type="range"
            min={0}
            max={12}
            step={0.4}
            value={targetOrbitSpeed}
            onChange={(e) => onChangeOrbitSpeed(Number(e.target.value))}
            className="dcc-slider w-24"
          />
          <span className="mono-num w-11 text-right font-medium text-[#d1d6e0]">
            {targetOrbitSpeed.toFixed(1)}m/s
          </span>
        </div>

        <button
          type="button"
          title="Reset camera angle"
          onClick={() => {
            camRef.current = { ...DEFAULT_CAM };
          }}
          className="flex h-8 cursor-pointer items-center rounded-lg border border-white/10 bg-white/[0.06] px-3 font-medium text-[#a1a8b5] hover:bg-white/[0.1] hover:text-white"
        >
          Reset View
        </button>
      </div>
    </div>
  );
}
