import * as THREE from 'three';
import { GUN_VFX_PRESETS, type GunVfxPreset, type GunVfxPresetId } from './presets';
import {
  FIREBALL_FRAG,
  FIREBALL_VERT,
  MUZZLE_JET_FRAG,
  MUZZLE_JET_VERT,
  SPARK_FRAG,
  SPARK_VERT,
} from './shaders';
import { createGunsmokeBurstAtlasPixels, GunsmokeBurstSystem } from './gunsmokeBurst';
import { createTileableSmokeFlowPixels } from './smokeFlowTexture';
import {
  createFireballAtlasPixels,
  createOpticalHaloPixels,
  createSparkStreakPixels,
  type RgbaImageData,
} from './textures';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

interface SharedGunTextures {
  fireballAtlas: THREE.DataTexture;
  smokeAtlas: THREE.DataTexture;
  smokeFlow: THREE.DataTexture;
  opticalHalo: THREE.DataTexture;
  sparkStreak: THREE.DataTexture;
}

let cachedTextures: SharedGunTextures | null = null;

function makeRgbaTexture(img: RgbaImageData, wrap: THREE.Wrapping = THREE.ClampToEdgeWrapping): THREE.DataTexture {
  const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function getSharedGunTextures(): SharedGunTextures {
  if (!cachedTextures) {
    cachedTextures = {
      fireballAtlas: makeRgbaTexture(createFireballAtlasPixels(256)),
      smokeAtlas: makeRgbaTexture(createGunsmokeBurstAtlasPixels(256)),
      smokeFlow: makeRgbaTexture(createTileableSmokeFlowPixels(256), THREE.RepeatWrapping),
      opticalHalo: makeRgbaTexture(createOpticalHaloPixels(128)),
      sparkStreak: makeRgbaTexture(createSparkStreakPixels(64, 128)),
    };
  }
  return cachedTextures;
}

export interface GunShotParams {
  muzzlePos: THREE.Vector3;
  muzzleDir: THREE.Vector3;
  targetPos: THREE.Vector3 | null;
  projectileSpeed: number;
  ejectPos?: THREE.Vector3;
  ejectRight?: THREE.Vector3;
  ejectUp?: THREE.Vector3;
  ejectBack?: THREE.Vector3;
  scaleMul?: number;
}

interface ActiveFireballLobe {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  localOffset: THREE.Vector3;
  roll: number;
  rollVel: number;
  startScale: number;
  endScale: number;
  age: number;
  maxLife: number;
}

interface ActiveJet {
  group: THREE.Group;
  mat: THREE.ShaderMaterial;
  localOffset: THREE.Vector3;
  localDir: THREE.Vector3;
  age: number;
  maxLife: number;
}

interface ActiveSpark {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  vel: THREE.Vector3;
  drag: number;
  gravity: number;
  width: number;
  baseLength: number;
  age: number;
  maxLife: number;
  baseOpacity: number;
}

interface ActiveTracer {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

interface ActiveCasing {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
  mat: THREE.MeshStandardMaterial;
}

interface ActiveRailBeam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  baseRadius: number;
  length: number;
  expandFactor: number;
  age: number;
  maxLife: number;
  baseOpacity: number;
}

interface ActiveRailRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  startScale: number;
  endScale: number;
  age: number;
  maxLife: number;
  baseOpacity: number;
}

/**
 * Reusable volumetric gunshot & continuous fluid gunsmoke VFX controller shared across gun towers.
 * Combines turbulent HDR blackbody fireball clouds, barrel & baffle exhaust jets, optical bloom halo,
 * high-velocity burning gunpowder spark streaks, viscous multi-layer volumetric fluid smoke ribbons
 * advected through coherent 3D curl wind, tracer bolts, and brass shell ejection.
 */
export class GunshotVfxSystem {
  private readonly scene: THREE.Scene;
  private readonly textures: SharedGunTextures;
  private preset: GunVfxPreset;

  private readonly billboardGeo: THREE.PlaneGeometry;
  private readonly jetPlaneGeo: THREE.PlaneGeometry;
  private readonly tracerGeo: THREE.CylinderGeometry;
  private readonly casingGeo: THREE.CylinderGeometry;
  private readonly railBeamGeo: THREE.CylinderGeometry;
  private readonly railRingGeo: THREE.TorusGeometry;

  private readonly haloMesh: THREE.Mesh;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly flashLight: THREE.PointLight;
  private readonly tracerMat: THREE.MeshBasicMaterial;

  private readonly gunsmoke: GunsmokeBurstSystem;

  private readonly fireballs: ActiveFireballLobe[] = [];
  private readonly jets: ActiveJet[] = [];
  private readonly sparks: ActiveSpark[] = [];
  private readonly tracers: ActiveTracer[] = [];
  private readonly casings: ActiveCasing[] = [];
  private readonly railBeams: ActiveRailBeam[] = [];
  private readonly railRings: ActiveRailRing[] = [];

  private elapsedTime = 0;
  private haloAge = 1;
  private haloMaxLife = 0.09;
  private haloStartScale = 0.7;
  private haloEndScale = 1.8;

  private lightTimer = 0;
  private lightDuration = 0.1;
  private lightPeakIntensity = 10;

  private readonly _lastMuzzlePos = new THREE.Vector3();
  private readonly _lastMuzzleDir = new THREE.Vector3(0, 0, 1);
  private readonly _shotQuat = new THREE.Quaternion();
  private readonly _tmpDir = new THREE.Vector3();
  private readonly _tmpRight = new THREE.Vector3();
  private readonly _tmpUp = new THREE.Vector3();
  private readonly _tmpToCam = new THREE.Vector3();
  private readonly _tmpBasis = new THREE.Matrix4();
  private readonly _tmpVec = new THREE.Vector3();
  private readonly _jetQuat = new THREE.Quaternion();
  private readonly _sampleFlowBound: (pos: THREE.Vector3, time: number, out: THREE.Vector3) => void;

  constructor(scene: THREE.Scene, presetId: GunVfxPresetId = 'autocannon') {
    this.scene = scene;
    this.textures = getSharedGunTextures();
    this.preset = GUN_VFX_PRESETS[presetId];
    this._sampleFlowBound = this.sampleCoherentSmokeFlow.bind(this);

    this.billboardGeo = new THREE.PlaneGeometry(1, 1);
    this.jetPlaneGeo = new THREE.PlaneGeometry(1, 1);
    this.jetPlaneGeo.translate(0.5, 0, 0);

    this.tracerGeo = new THREE.CylinderGeometry(1, 0.45, 1, 8);
    this.tracerGeo.rotateX(Math.PI / 2);

    this.casingGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.095, 8);
    this.casingGeo.rotateZ(Math.PI / 2);

    this.railBeamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    this.railBeamGeo.rotateX(Math.PI / 2);
    this.railBeamGeo.translate(0, 0, 0.5);

    this.railRingGeo = new THREE.TorusGeometry(1, 0.055, 8, 28);

    this.haloMat = new THREE.MeshBasicMaterial({
      map: this.textures.opticalHalo,
      color: this.preset.flashTint ?? 0xffa642,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.haloMesh = new THREE.Mesh(this.billboardGeo, this.haloMat);
    this.haloMesh.renderOrder = 11;
    this.haloMesh.visible = false;
    this.scene.add(this.haloMesh);

    this.flashLight = new THREE.PointLight(this.preset.flashTint ?? 0xffa43c, 0, this.preset.lightDistance, 2);
    this.scene.add(this.flashLight);

    this.tracerMat = new THREE.MeshBasicMaterial({
      color: this.preset.tracerColor,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Per-shot explosive cauliflower gunsmoke burst renderer
    this.gunsmoke = new GunsmokeBurstSystem(
      this.scene,
      this.textures.smokeAtlas,
      this.textures.smokeFlow,
      0xedf1f6,
      0x5c6674,
    );
  }

  public setPreset(presetId: GunVfxPresetId): void {
    this.preset = GUN_VFX_PRESETS[presetId];
    const tint = this.preset.flashTint ?? 0xffa43c;
    this.flashLight.color.setHex(tint);
    this.flashLight.distance = this.preset.lightDistance;
    this.haloMat.color.setHex(this.preset.flashTint ?? 0xffa642);
    this.tracerMat.color.setHex(this.preset.tracerColor);
  }

  public triggerShot(params: GunShotParams): void {
    const p = this.preset;
    const s = params.scaleMul ?? 1;

    this._lastMuzzlePos.copy(params.muzzlePos);
    this._lastMuzzleDir.copy(params.muzzleDir).normalize();
    this._shotQuat.setFromUnitVectors(Z_AXIS, this._lastMuzzleDir);

    // Build orthonormal basis around barrel axis
    const upRef = Math.abs(this._lastMuzzleDir.y) > 0.92 ? X_AXIS : Y_AXIS;
    this._tmpRight.crossVectors(this._lastMuzzleDir, upRef).normalize();
    this._tmpUp.crossVectors(this._tmpRight, this._lastMuzzleDir).normalize();

    // Per-shot explosive gunsmoke burst (skipped for pure electromagnetic weapons)
    if (!p.electromagnetic && (p.blastSmokeCount > 0 || p.baffleSmokeCount > 0)) {
      this.gunsmoke.spawnShotBurst({
        muzzlePos: this._lastMuzzlePos,
        muzzleDir: this._lastMuzzleDir,
        right: this._tmpRight,
        up: this._tmpUp,
        preset: p,
        scaleMul: s,
        ejectPos: params.ejectPos,
        ejectRight: params.ejectRight,
        ejectUp: params.ejectUp,
        flashGlow: 0.92,
      });
    }

    // 1. Dynamic muzzle PointLight + soft atmospheric optical bloom halo
    this.lightDuration = p.lightDuration;
    this.lightTimer = p.lightDuration;
    this.lightPeakIntensity = p.lightIntensity * s;
    this.flashLight.position.copy(this._lastMuzzlePos).addScaledVector(this._lastMuzzleDir, 0.25 * s);
    this.flashLight.distance = p.lightDistance * s;
    this.flashLight.intensity = this.lightPeakIntensity;

    this.haloAge = 0;
    this.haloMaxLife = p.fireballDuration * 1.15;
    this.haloStartScale = p.haloScale * 0.48 * s;
    this.haloEndScale = p.haloScale * 1.18 * s;
    this.haloMesh.position.copy(this._lastMuzzlePos).addScaledVector(this._lastMuzzleDir, 0.24 * s);
    this.haloMesh.scale.setScalar(this.haloStartScale);
    this.haloMat.opacity = 0.85;
    this.haloMesh.visible = true;

    // 2. Barrel-mouth ignition jet + twin lateral baffle exhaust plumes (combustion weapons only)
    if (!p.electromagnetic && p.jetLength > 0.01) {
      this.spawnJet(
        new THREE.Vector3(0, 0, -0.02 * s),
        new THREE.Vector3(0, 0, 1),
        p.jetLength * s,
        p.fireballScale * 0.44 * s,
        p.fireballDuration * 0.78,
      );

      if (p.baffleStrength > 0.05) {
        const bLen = p.jetLength * 0.56 * p.baffleStrength * s;
        const bWid = p.fireballScale * 0.34 * p.baffleStrength * s;
        const bLife = p.fireballDuration * 0.72;
        this.spawnJet(
          new THREE.Vector3(-0.08 * s, 0, -0.09 * s),
          new THREE.Vector3(-0.96, (Math.random() - 0.5) * 0.14, -0.22).normalize(),
          bLen,
          bWid,
          bLife,
        );
        this.spawnJet(
          new THREE.Vector3(0.08 * s, 0, -0.09 * s),
          new THREE.Vector3(0.96, (Math.random() - 0.5) * 0.14, -0.22).normalize(),
          bLen,
          bWid,
          bLife,
        );
      }
    }

    // 3. Asymmetric volumetric turbulent fireball cluster (HDR blackbody white->gold->orange)
    for (let i = 0; i < p.fireballLobes; i++) {
      const isHero = i === 0;
      const localOffset = isHero
        ? new THREE.Vector3(
            (Math.random() - 0.5) * 0.08 * s,
            (Math.random() - 0.5) * 0.08 * s,
            0.26 * p.fireballScale * s,
          )
        : new THREE.Vector3(
            (Math.random() - 0.5) * 0.3 * p.fireballScale * s,
            (Math.random() - 0.42) * 0.3 * p.fireballScale * s,
            (0.14 + Math.random() * 0.28) * p.fireballScale * s,
          );
      const maxScale = (isHero ? 1.0 : 0.58 + Math.random() * 0.42) * p.fireballScale * s;
      this.spawnFireballLobe(
        localOffset,
        maxScale * 0.35,
        maxScale,
        p.fireballDuration * (isHero ? 1.0 : 0.78 + Math.random() * 0.35),
        isHero ? 1.0 : 0.85,
      );
    }

    // 4. Radial burst of razor-thin white-hot gunpowder spark streaks
    for (let i = 0; i < p.sparkCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const spread = Math.pow(Math.random(), 0.72) * p.sparkSpreadRad;
      const sinS = Math.sin(spread);
      const dir = new THREE.Vector3()
        .addScaledVector(this._lastMuzzleDir, Math.cos(spread))
        .addScaledVector(this._tmpRight, Math.cos(theta) * sinS)
        .addScaledVector(this._tmpUp, Math.sin(theta) * sinS)
        .normalize();

      const speed = p.sparkSpeedMin + Math.random() * (p.sparkSpeedMax - p.sparkSpeedMin);
      const startPos = this._lastMuzzlePos
        .clone()
        .addScaledVector(this._lastMuzzleDir, (0.14 + Math.random() * 0.22) * p.fireballScale * s);

      this.spawnSparkStreak(
        startPos,
        dir.multiplyScalar(speed * s),
        p.sparkWidth * (0.7 + Math.random() * 0.65) * s,
        p.sparkLength * (0.65 + Math.random() * 0.85) * s,
        p.sparkLifeMin + Math.random() * (p.sparkLifeMax - p.sparkLifeMin),
        8.5,
        6.0,
        0.98,
      );
    }

    // 5. Elongated tracer bolt toward target (+ pure electromagnetic blue-neon pulse beam & shock rings)
    const shotDir = params.targetPos
      ? new THREE.Vector3().subVectors(params.targetPos, params.muzzlePos).normalize()
      : this._lastMuzzleDir.clone();

    if (p.electromagnetic) {
      const beamLen = params.targetPos ? params.muzzlePos.distanceTo(params.targetPos) : 22 * s;
      this.spawnRailBeam(params.muzzlePos, shotDir, 0.032 * s, beamLen, 0xd8f8ff, -0.45, 0.16, 0.98);
      this.spawnRailBeam(params.muzzlePos, shotDir, 0.115 * s, beamLen, 0x0088ff, 0.75, 0.30, 0.72);

      this.spawnRailRing(
        params.muzzlePos.clone().addScaledVector(shotDir, 0.10 * s),
        shotDir,
        0.12 * s,
        0.78 * s,
        0x7dd3fc,
        0.20,
        0.92,
      );
      this.spawnRailRing(
        params.muzzlePos.clone().addScaledVector(shotDir, 0.55 * s),
        shotDir,
        0.15 * s,
        0.95 * s,
        0x00b4ff,
        0.24,
        0.80,
      );
      this.spawnRailRing(
        params.muzzlePos.clone().addScaledVector(shotDir, 1.25 * s),
        shotDir,
        0.18 * s,
        1.10 * s,
        0x0077ff,
        0.28,
        0.65,
      );
      if (params.targetPos) {
        this.spawnRailRing(params.targetPos, shotDir, 0.16 * s, 1.15 * s, 0x38d9ff, 0.24, 0.88);
      }
    }

    const maxSpd = p.electromagnetic ? 160 : 75;
    const tracer = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    tracer.position.copy(params.muzzlePos);
    tracer.quaternion.setFromUnitVectors(Z_AXIS, shotDir);
    tracer.scale.set(p.tracerWidth * s, p.tracerWidth * s, p.tracerLength * s);
    this.scene.add(tracer);
    this.tracers.push({
      mesh: tracer,
      vel: shotDir.multiplyScalar(Math.min(Math.max(12, params.projectileSpeed), maxSpd)),
      life: 0.65,
    });

    // 6. Brass shell casing ejection
    if (p.casingScale > 0 && params.ejectPos && params.ejectRight && params.ejectUp && params.ejectBack) {
      const cMat = new THREE.MeshStandardMaterial({
        color: 0xf4c44e,
        roughness: 0.26,
        metalness: 0.88,
        transparent: true,
        opacity: 1,
      });
      const shell = new THREE.Mesh(this.casingGeo, cMat);
      shell.position.copy(params.ejectPos);
      shell.scale.setScalar(p.casingScale);
      shell.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(shell);

      const vel = new THREE.Vector3()
        .addScaledVector(params.ejectRight, 2.2 + Math.random() * 0.9)
        .addScaledVector(params.ejectUp, 1.5 + Math.random() * 0.7)
        .addScaledVector(params.ejectBack, 0.4 + Math.random() * 0.5);
      this.casings.push({
        mesh: shell,
        vel,
        angVel: new THREE.Vector3(14 + Math.random() * 10, 9 + Math.random() * 10, 18 + Math.random() * 12),
        life: 1.25,
        mat: cMat,
      });
    }
  }

  private sampleCoherentSmokeFlow(pos: THREE.Vector3, time: number, out: THREE.Vector3): void {
    const px = pos.x * 0.85 + time * 0.65;
    const py = pos.y * 0.85 - time * 0.35;
    const pz = pos.z * 0.85 + time * 0.5;
    const vx = 0.28 + 0.36 * Math.sin(py * 1.9 + pz * 1.4) + 0.16 * Math.cos(pz * 3.1 - px * 1.7);
    const vy = 0.18 * Math.cos(px * 1.8 - pz * 1.5) + 0.09 * Math.sin(px * 3.2 + py * 2.1);
    const vz = 0.16 + 0.34 * Math.cos(px * 1.7 - py * 2.1) + 0.15 * Math.sin(py * 2.9 + px * 1.4);
    out.set(vx, vy, vz);
  }

  private spawnJet(
    localOffset: THREE.Vector3,
    localDir: THREE.Vector3,
    length: number,
    width: number,
    maxLife: number,
  ): void {
    const mat = new THREE.ShaderMaterial({
      vertexShader: MUZZLE_JET_VERT,
      fragmentShader: MUZZLE_JET_FRAG,
      uniforms: {
        uAtlas: { value: this.textures.fireballAtlas },
        uSeed: { value: Math.random() * 10 },
        uAge: { value: 0 },
        uOpacity: { value: 1 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const group = new THREE.Group();
    const p1 = new THREE.Mesh(this.jetPlaneGeo, mat);
    const p2 = new THREE.Mesh(this.jetPlaneGeo, mat);
    p2.rotation.x = Math.PI / 2;
    p1.renderOrder = 12;
    p2.renderOrder = 12;
    group.add(p1, p2);
    group.scale.set(length, width, width);

    this.applyJetPose(group, localOffset, localDir);
    this.scene.add(group);
    this.jets.push({ group, mat, localOffset, localDir, age: 0, maxLife });
  }

  private applyJetPose(group: THREE.Group, localOffset: THREE.Vector3, localDir: THREE.Vector3): void {
    this._tmpVec.copy(localOffset).applyQuaternion(this._shotQuat).add(this._lastMuzzlePos);
    group.position.copy(this._tmpVec);
    this._tmpDir.copy(localDir).applyQuaternion(this._shotQuat).normalize();
    this._jetQuat.setFromUnitVectors(X_AXIS, this._tmpDir);
    group.quaternion.copy(this._jetQuat);
  }

  private spawnFireballLobe(
    localOffset: THREE.Vector3,
    startScale: number,
    endScale: number,
    maxLife: number,
    opacity: number,
  ): void {
    const tileIdx = Math.floor(Math.random() * 4);
    const tx = (tileIdx % 2) * 0.5;
    const ty = Math.floor(tileIdx / 2) * 0.5;
    const mat = new THREE.ShaderMaterial({
      vertexShader: FIREBALL_VERT,
      fragmentShader: FIREBALL_FRAG,
      uniforms: {
        uAtlas: { value: this.textures.fireballAtlas },
        uTileOffset: { value: new THREE.Vector2(tx, ty) },
        uFlipX: { value: Math.random() < 0.5 ? -1 : 1 },
        uAge: { value: 0 },
        uOpacity: { value: opacity },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(this.billboardGeo, mat);
    mesh.renderOrder = 12;
    mesh.scale.setScalar(startScale);
    this._tmpVec.copy(localOffset).applyQuaternion(this._shotQuat).add(this._lastMuzzlePos);
    mesh.position.copy(this._tmpVec);
    this.scene.add(mesh);

    this.fireballs.push({
      mesh,
      mat,
      localOffset,
      roll: Math.random() * Math.PI * 2,
      rollVel: (Math.random() - 0.5) * 4.5,
      startScale,
      endScale,
      age: 0,
      maxLife,
    });
  }

  private spawnSparkStreak(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    width: number,
    baseLength: number,
    maxLife: number,
    drag: number,
    gravity: number,
    baseOpacity: number,
  ): void {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      uniforms: {
        uTex: { value: this.textures.sparkStreak },
        uHeat: { value: 1 },
        uOpacity: { value: baseOpacity },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(this.billboardGeo, mat);
    mesh.renderOrder = 12;
    mesh.position.copy(pos);
    mesh.scale.set(width, baseLength, 1);
    this.scene.add(mesh);

    this.sparks.push({
      mesh,
      mat,
      vel,
      drag,
      gravity,
      width,
      baseLength,
      age: 0,
      maxLife,
      baseOpacity,
    });
  }

  private spawnImpactSparks(hitPos: THREE.Vector3): void {
    for (let k = 0; k < 12; k++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 11,
        1.8 + Math.random() * 5.2,
        (Math.random() - 0.5) * 11,
      );
      this.spawnSparkStreak(hitPos.clone(), vel, 0.018, 0.34, 0.14 + Math.random() * 0.14, 4.5, 11.0, 0.95);
    }
  }

  private spawnRailBeam(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    baseRadius: number,
    length: number,
    color: number,
    expandFactor: number,
    maxLife: number,
    baseOpacity: number,
  ): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: baseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.railBeamGeo, mat);
    mesh.renderOrder = 13;
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(Z_AXIS, dir);
    mesh.scale.set(baseRadius, baseRadius, length);
    this.scene.add(mesh);
    this.railBeams.push({ mesh, mat, baseRadius, length, expandFactor, age: 0, maxLife, baseOpacity });
  }

  private spawnRailRing(
    pos: THREE.Vector3,
    dir: THREE.Vector3,
    startScale: number,
    endScale: number,
    color: number,
    maxLife: number,
    baseOpacity: number,
  ): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: baseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.railRingGeo, mat);
    mesh.renderOrder = 13;
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(Z_AXIS, dir);
    mesh.scale.setScalar(startScale);
    this.scene.add(mesh);
    this.railRings.push({ mesh, mat, startScale, endScale, age: 0, maxLife, baseOpacity });
  }

  public update(
    dt: number,
    camera: THREE.Camera,
    muzzlePos: THREE.Vector3 | null,
    muzzleDir: THREE.Vector3 | null,
    targetWorldPos: THREE.Vector3 | null,
  ): void {
    if (muzzlePos && muzzleDir) {
      this._lastMuzzlePos.copy(muzzlePos);
      this._lastMuzzleDir.copy(muzzleDir).normalize();
      this._shotQuat.setFromUnitVectors(Z_AXIS, this._lastMuzzleDir);
    }

    // Orient optical halo & billboards even while paused so camera orbit remains seamless
    if (this.haloMesh.visible) {
      this.haloMesh.position.copy(this._lastMuzzlePos).addScaledVector(this._lastMuzzleDir, 0.24);
      this.haloMesh.quaternion.copy(camera.quaternion);
    }
    for (const fb of this.fireballs) {
      fb.mesh.quaternion.copy(camera.quaternion);
      fb.mesh.rotateZ(fb.roll);
    }
    for (const sp of this.sparks) {
      this.orientSparkToCamera(sp, camera);
    }

    if (dt <= 0) {
      this.gunsmoke.update(0, camera, this.elapsedTime, this._lastMuzzlePos, 0, this._sampleFlowBound);
      return;
    }

    this.elapsedTime += dt;

    // Advance optical bloom halo
    if (this.haloAge < 1) {
      this.haloAge = Math.min(1, this.haloAge + dt / Math.max(0.01, this.haloMaxLife));
      const grow = 1 - Math.pow(1 - this.haloAge, 3);
      this.haloMesh.scale.setScalar(THREE.MathUtils.lerp(this.haloStartScale, this.haloEndScale, grow));
      this.haloMat.opacity = 0.85 * Math.pow(1 - this.haloAge, 1.8);
      if (this.haloAge >= 1) this.haloMesh.visible = false;
    }

    // Advance PointLight
    let activeLightNorm = 0;
    if (this.lightTimer > 0) {
      this.lightTimer = Math.max(0, this.lightTimer - dt);
      activeLightNorm = this.lightTimer / Math.max(0.01, this.lightDuration);
      this.flashLight.intensity = this.lightPeakIntensity * activeLightNorm * activeLightNorm;
    } else {
      this.flashLight.intensity = 0;
    }

    // Advance jets attached to active barrel mouth
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const jet = this.jets[i]!;
      jet.age += dt;
      const u = jet.age / jet.maxLife;
      if (u >= 1) {
        this.scene.remove(jet.group);
        jet.mat.dispose();
        this.jets.splice(i, 1);
        continue;
      }
      this.applyJetPose(jet.group, jet.localOffset, jet.localDir);
      jet.mat.uniforms.uAge!.value = u;
      jet.mat.uniforms.uOpacity!.value = Math.max(0, 1 - u * 0.7);
    }

    // Advance fireball cauliflower clouds
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const fb = this.fireballs[i]!;
      fb.age += dt;
      const u = fb.age / fb.maxLife;
      if (u >= 1) {
        this.scene.remove(fb.mesh);
        fb.mat.dispose();
        this.fireballs.splice(i, 1);
        continue;
      }
      fb.roll += fb.rollVel * dt;
      const expand = 1 - Math.pow(1 - Math.min(1, u * 1.4), 2.6);
      fb.mesh.scale.setScalar(THREE.MathUtils.lerp(fb.startScale, fb.endScale, expand));
      this._tmpVec.copy(fb.localOffset).applyQuaternion(this._shotQuat).add(this._lastMuzzlePos);
      fb.mesh.position.copy(this._tmpVec);
      fb.mesh.quaternion.copy(camera.quaternion);
      fb.mesh.rotateZ(fb.roll);
      fb.mat.uniforms.uAge!.value = u;
    }

    // Advance active explosive gunsmoke burst puffs (zero continuous hose)
    this.gunsmoke.update(dt, camera, this.elapsedTime, this._lastMuzzlePos, activeLightNorm, this._sampleFlowBound);

    // Advance velocity-stretched gunpowder spark streaks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i]!;
      sp.age += dt;
      const u = sp.age / sp.maxLife;
      if (u >= 1) {
        this.scene.remove(sp.mesh);
        sp.mat.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      const damp = Math.exp(-sp.drag * dt);
      sp.vel.multiplyScalar(damp);
      sp.vel.y -= sp.gravity * dt;
      sp.mesh.position.addScaledVector(sp.vel, dt);

      const spd = sp.vel.length();
      const lenFactor = THREE.MathUtils.clamp(spd / 22, 0.28, 1.35);
      sp.mesh.scale.set(sp.width, sp.baseLength * lenFactor, 1);
      sp.mat.uniforms.uHeat!.value = Math.max(0.15, 1 - u * 0.85);
      sp.mat.uniforms.uOpacity!.value = sp.baseOpacity * (1 - u * u);
      this.orientSparkToCamera(sp, camera);
    }

    // Advance tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]!;
      tr.mesh.position.addScaledVector(tr.vel, dt);
      tr.life -= dt;
      const hitTarget = targetWorldPos && tr.mesh.position.distanceToSquared(targetWorldPos) < 0.85 * 0.85;
      if (hitTarget || tr.life <= 0) {
        if (hitTarget && targetWorldPos && !this.preset.electromagnetic) this.spawnImpactSparks(tr.mesh.position);
        this.scene.remove(tr.mesh);
        this.tracers.splice(i, 1);
      }
    }

    // Advance electromagnetic blue-neon beams
    for (let i = this.railBeams.length - 1; i >= 0; i--) {
      const rb = this.railBeams[i]!;
      rb.age += dt;
      const u = rb.age / rb.maxLife;
      if (u >= 1) {
        this.scene.remove(rb.mesh);
        rb.mat.dispose();
        this.railBeams.splice(i, 1);
        continue;
      }
      const r = rb.baseRadius * Math.max(0.15, 1 + rb.expandFactor * u);
      rb.mesh.scale.set(r, r, rb.length);
      rb.mat.opacity = rb.baseOpacity * Math.pow(1 - u, 1.6);
    }

    // Advance electromagnetic blue-neon shockwave rings
    for (let i = this.railRings.length - 1; i >= 0; i--) {
      const rr = this.railRings[i]!;
      rr.age += dt;
      const u = rr.age / rr.maxLife;
      if (u >= 1) {
        this.scene.remove(rr.mesh);
        rr.mat.dispose();
        this.railRings.splice(i, 1);
        continue;
      }
      const ease = 1 - Math.pow(1 - u, 2.6);
      rr.mesh.scale.setScalar(THREE.MathUtils.lerp(rr.startScale, rr.endScale, ease));
      rr.mat.opacity = rr.baseOpacity * Math.pow(1 - u, 1.8);
    }

    // Advance spinning shell casings
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i]!;
      c.vel.y -= 14 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      if (c.mesh.position.y < 0.022) {
        c.mesh.position.y = 0.022;
        c.vel.y = -c.vel.y * 0.36;
        c.vel.x *= 0.68;
        c.vel.z *= 0.68;
        c.angVel.multiplyScalar(0.55);
      }
      c.mesh.rotation.x += c.angVel.x * dt;
      c.mesh.rotation.y += c.angVel.y * dt;
      c.mesh.rotation.z += c.angVel.z * dt;
      c.life -= dt;
      if (c.life < 0.3) {
        c.mat.opacity = Math.max(0, c.life / 0.3);
      }
      if (c.life <= 0) {
        this.scene.remove(c.mesh);
        c.mat.dispose();
        this.casings.splice(i, 1);
      }
    }
  }

  private orientSparkToCamera(sp: ActiveSpark, camera: THREE.Camera): void {
    const up = this._tmpUp.copy(sp.vel);
    if (up.lengthSq() < 1e-6) up.copy(Z_AXIS);
    else up.normalize();

    this._tmpToCam.subVectors(camera.position, sp.mesh.position);
    if (this._tmpToCam.lengthSq() < 1e-6) this._tmpToCam.copy(Y_AXIS);
    else this._tmpToCam.normalize();

    const side = this._tmpRight.crossVectors(up, this._tmpToCam);
    if (side.lengthSq() < 1e-6) side.copy(X_AXIS);
    else side.normalize();

    const fwd = this._tmpDir.crossVectors(side, up).normalize();
    this._tmpBasis.makeBasis(side, up, fwd);
    sp.mesh.quaternion.setFromRotationMatrix(this._tmpBasis);
  }

  public dispose(): void {
    this.scene.remove(this.haloMesh, this.flashLight);

    this.gunsmoke.dispose();

    for (const fb of this.fireballs) {
      this.scene.remove(fb.mesh);
      fb.mat.dispose();
    }
    this.fireballs.length = 0;

    for (const jet of this.jets) {
      this.scene.remove(jet.group);
      jet.mat.dispose();
    }
    this.jets.length = 0;

    for (const sp of this.sparks) {
      this.scene.remove(sp.mesh);
      sp.mat.dispose();
    }
    this.sparks.length = 0;

    for (const tr of this.tracers) {
      this.scene.remove(tr.mesh);
    }
    this.tracers.length = 0;

    for (const c of this.casings) {
      this.scene.remove(c.mesh);
      c.mat.dispose();
    }
    this.casings.length = 0;

    for (const rb of this.railBeams) {
      this.scene.remove(rb.mesh);
      rb.mat.dispose();
    }
    this.railBeams.length = 0;

    for (const rr of this.railRings) {
      this.scene.remove(rr.mesh);
      rr.mat.dispose();
    }
    this.railRings.length = 0;

    this.billboardGeo.dispose();
    this.jetPlaneGeo.dispose();
    this.tracerGeo.dispose();
    this.casingGeo.dispose();
    this.railBeamGeo.dispose();
    this.railRingGeo.dispose();
    this.haloMat.dispose();
    this.tracerMat.dispose();
  }
}
