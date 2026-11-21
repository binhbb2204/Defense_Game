import * as THREE from 'three';
import type { ZombieArchetypeConfig, ZombieTypeId } from '@tactical-td/shared';
import type { AssetLoader, LoadedModelAsset } from '../core/AssetLoader';
import type { PathSystem } from '../systems/PathSystem';
import { enemyRegistry, type EnemyRegistry } from './enemies/EnemyRegistry';

export interface ZombieRecord {
  readonly poolIndex: number;
  active: boolean;
  id: number;
  type: ZombieTypeId;
  hp: number;
  maxHp: number;
  armor: number;
  speed: number;
  distance: number;
  laneOffset: number;
  radius: number;
  height: number;
  cashReward: number;
  baseDamage: number;
  inTunnel: boolean;
  readonly prevPos: THREE.Vector3;
  readonly currPos: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly baseColor: THREE.Color;
}

interface ZombieRigInstance {
  type: ZombieTypeId;
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
}

const DEFAULT_MAX_ZOMBIES = 1024;
const FORWARD_Z = new THREE.Vector3(0, 0, 1);

/**
 * Pooled Zombie Renderer & Movement Simulator.
 *
 * Uses loaded 3D animated rigs (FBX/GLB) when registered for a ZombieTypeId,
 * and falls back to 2-draw-call InstancedMesh boxes for types without models yet.
 */
export class ZombiePool {
  public readonly maxCapacity: number;
  public readonly group = new THREE.Group();

  private readonly records: ZombieRecord[];
  private readonly freeIndices: number[];
  private readonly activeIndices: number[] = [];

  private readonly bodyMesh: THREE.InstancedMesh;
  private readonly headMesh: THREE.InstancedMesh;

  // Optional animated 3D rigs per poolIndex (for types that have a loaded model)
  private readonly modelGroup = new THREE.Group();
  private readonly modelAssets = new Map<ZombieTypeId, LoadedModelAsset>();
  private readonly rigFreePools = new Map<ZombieTypeId, ZombieRigInstance[]>();
  private readonly activeRigs: (ZombieRigInstance | null)[];
  private readonly assetLoader: AssetLoader | null;
  private readonly registry: EnemyRegistry;

  private nextEntityId = 1;

  // Pre-allocated scratch math objects (zero GC in 60Hz / 144Hz loops)
  private readonly _interpPos = new THREE.Vector3();
  private readonly _headPos = new THREE.Vector3();
  private readonly _flatForward = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _matrix = new THREE.Matrix4();
  private readonly _colorScratch = new THREE.Color();

  constructor(
    maxCapacity = DEFAULT_MAX_ZOMBIES,
    assetLoader?: AssetLoader,
    registry: EnemyRegistry = enemyRegistry,
  ) {
    this.maxCapacity = maxCapacity;
    this.assetLoader = assetLoader ?? null;
    this.registry = registry;
    this.group.name = 'ZombiePool';
    this.modelGroup.name = 'ZombiePool_3DModels';

    this.records = new Array(maxCapacity);
    this.freeIndices = new Array(maxCapacity);
    this.activeRigs = new Array(maxCapacity).fill(null);

    for (let i = 0; i < maxCapacity; i++) {
      this.records[i] = {
        poolIndex: i,
        active: false,
        id: 0,
        type: 'normal',
        hp: 0,
        maxHp: 0,
        armor: 0,
        speed: 0,
        distance: 0,
        laneOffset: 0,
        radius: 0.45,
        height: 1.75,
        cashReward: 0,
        baseDamage: 0,
        inTunnel: false,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        forward: new THREE.Vector3(0, 0, 1),
        baseColor: new THREE.Color(0x5ea867),
      };
      this.freeIndices[i] = maxCapacity - 1 - i;
    }

    const bodyGeo = new THREE.BoxGeometry(1, 1, 0.72);
    bodyGeo.translate(0, 0.5, 0);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.12,
    });

    const headGeo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.65,
      metalness: 0.18,
    });

    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, maxCapacity);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.bodyMesh.frustumCulled = false;
    this.bodyMesh.count = 0;

    this.headMesh = new THREE.InstancedMesh(headGeo, headMat, maxCapacity);
    this.headMesh.castShadow = true;
    this.headMesh.frustumCulled = false;
    this.headMesh.count = 0;

    this.group.add(this.bodyMesh, this.headMesh, this.modelGroup);

    if (this.assetLoader) {
      this.registry.preloadModels(this.assetLoader, (type, asset) => {
        this.registerModel(type, asset);
      });
    }
  }

  public registerModel(type: ZombieTypeId, asset: LoadedModelAsset): void {
    this.modelAssets.set(type, asset);
    if (!this.rigFreePools.has(type)) {
      this.rigFreePools.set(type, []);
    }

    // Upgrade any already-active zombies of this type if the model finished loading mid-wave
    for (let i = 0; i < this.activeIndices.length; i++) {
      const poolIdx = this.activeIndices[i];
      const z = this.records[poolIdx];
      if (z.type === type && !this.activeRigs[poolIdx]) {
        this.attachRigToPoolIndex(poolIdx, type);
      }
    }
  }

  public getActiveCount(): number {
    return this.activeIndices.length;
  }

  public spawnByType(
    type: ZombieTypeId,
    laneOffset: number,
    pathSystem: PathSystem,
  ): ZombieRecord | null {
    const archetype = this.registry.get(type);
    const record = this.spawn(archetype.config, laneOffset, pathSystem);
    if (record) {
      archetype.onSpawn(record);
    }
    return record;
  }

  public spawn(
    config: ZombieArchetypeConfig,
    laneOffset: number,
    pathSystem: PathSystem,
  ): ZombieRecord | null {
    const poolIndex = this.freeIndices.pop();
    if (poolIndex === undefined) return null;

    const z = this.records[poolIndex];
    z.active = true;
    z.id = this.nextEntityId++;
    z.type = config.id;
    z.hp = config.maxHp;
    z.maxHp = config.maxHp;
    z.armor = config.armor;
    z.speed = config.speed;
    z.distance = 0;
    z.laneOffset = laneOffset;
    z.radius = config.radius;
    z.height = config.height;
    z.cashReward = config.cashReward;
    z.baseDamage = config.baseDamage;
    z.baseColor.set(config.color);

    pathSystem.sampleAtDistance(0, laneOffset, z.currPos, z.forward);
    z.prevPos.copy(z.currPos);
    z.inTunnel = pathSystem.isInTunnel(0);

    if (this.modelAssets.has(config.id)) {
      this.attachRigToPoolIndex(poolIndex, config.id);
    }

    this.activeIndices.push(poolIndex);
    return z;
  }

  private attachRigToPoolIndex(poolIndex: number, type: ZombieTypeId): void {
    const asset = this.modelAssets.get(type);
    if (!asset || !this.assetLoader) return;

    const pool = this.rigFreePools.get(type)!;
    let rig = pool.pop();
    if (!rig) {
      const inst = this.assetLoader.instantiate(asset);
      rig = {
        type,
        root: inst.root,
        mixer: inst.mixer,
        action: inst.action,
      };
      this.modelGroup.add(rig.root);
    }

    rig.root.visible = true;
    if (rig.action) {
      rig.action.reset().play();
      // Slight random phase offset so zombies don't march in robotic lockstep
      rig.mixer?.setTime((poolIndex * 0.17) % Math.max(rig.action.getClip().duration, 0.1));
    }
    this.activeRigs[poolIndex] = rig;
  }

  /**
   * 60Hz fixed simulation step: advances every active zombie along PathSystem.
   * Strictly zero heap allocations.
   */
  public fixedUpdate(
    fixedDt: number,
    pathSystem: PathSystem,
    onReachedBase: (zombie: Readonly<ZombieRecord>) => void,
  ): void {
    for (let i = this.activeIndices.length - 1; i >= 0; i--) {
      const poolIdx = this.activeIndices[i];
      const z = this.records[poolIdx];

      z.prevPos.copy(z.currPos);
      z.distance += z.speed * fixedDt;
      this.registry.get(z.type).onFixedTick(z, fixedDt);

      const reachedEnd = pathSystem.sampleAtDistance(
        z.distance,
        z.laneOffset,
        z.currPos,
        z.forward,
      );
      z.inTunnel = pathSystem.isInTunnel(z.distance);

      if (reachedEnd) {
        onReachedBase(z);
        this.despawnAtActiveSlot(i);
      }
    }
  }

  /**
   * Variable-rate render sync: interpolates between prevPos and currPos with `alpha`
   * and advances skeletal animations by `frameDt`.
   */
  public syncRender(alpha: number, frameDt = 0): void {
    const count = this.activeIndices.length;
    let instancedSlot = 0;

    for (let i = 0; i < count; i++) {
      const poolIdx = this.activeIndices[i];
      const z = this.records[poolIdx];

      this._interpPos.lerpVectors(z.prevPos, z.currPos, alpha);
      this._flatForward.set(z.forward.x, 0, z.forward.z);
      if (this._flatForward.lengthSq() > 1e-6) {
        this._flatForward.normalize();
        this._quat.setFromUnitVectors(FORWARD_Z, this._flatForward);
      } else {
        this._quat.identity();
      }

      const rig = this.activeRigs[poolIdx];
      if (rig) {
        rig.root.position.copy(this._interpPos);
        rig.root.quaternion.copy(this._quat);
        if (rig.mixer && frameDt > 0) {
          rig.mixer.update(frameDt);
        }
        continue;
      }

      // Fallback InstancedMesh box rendering for archetypes without 3D models yet
      const bodyHeight = z.height * 0.72;
      const bodyWidth = z.radius * 1.65;
      this._scale.set(bodyWidth, bodyHeight, bodyWidth);
      this._matrix.compose(this._interpPos, this._quat, this._scale);
      this.bodyMesh.setMatrixAt(instancedSlot, this._matrix);

      const headSize = z.radius * 1.15;
      this._headPos.set(
        this._interpPos.x,
        this._interpPos.y + bodyHeight + headSize * 0.36,
        this._interpPos.z,
      );
      this._scale.set(headSize, headSize, headSize);
      this._matrix.compose(this._headPos, this._quat, this._scale);
      this.headMesh.setMatrixAt(instancedSlot, this._matrix);

      this._colorScratch.copy(z.baseColor);
      if (z.inTunnel) {
        this._colorScratch.multiplyScalar(0.55);
      }
      this.bodyMesh.setColorAt(instancedSlot, this._colorScratch);

      this._colorScratch.multiplyScalar(1.18);
      this.headMesh.setColorAt(instancedSlot, this._colorScratch);
      instancedSlot++;
    }

    this.bodyMesh.count = instancedSlot;
    this.headMesh.count = instancedSlot;

    if (instancedSlot > 0) {
      this.bodyMesh.instanceMatrix.needsUpdate = true;
      this.headMesh.instanceMatrix.needsUpdate = true;
      if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;
      if (this.headMesh.instanceColor) this.headMesh.instanceColor.needsUpdate = true;
    }
  }

  public clearAll(): void {
    for (let i = this.activeIndices.length - 1; i >= 0; i--) {
      this.despawnAtActiveSlot(i);
    }
    this.bodyMesh.count = 0;
    this.headMesh.count = 0;
  }

  private despawnAtActiveSlot(activeSlot: number): void {
    const lastSlot = this.activeIndices.length - 1;
    const poolIdx = this.activeIndices[activeSlot];
    this.records[poolIdx].active = false;

    const rig = this.activeRigs[poolIdx];
    if (rig) {
      rig.root.visible = false;
      this.rigFreePools.get(rig.type)?.push(rig);
      this.activeRigs[poolIdx] = null;
    }

    this.freeIndices.push(poolIdx);

    if (activeSlot !== lastSlot) {
      this.activeIndices[activeSlot] = this.activeIndices[lastSlot];
    }
    this.activeIndices.pop();
  }

  public dispose(): void {
    this.bodyMesh.geometry.dispose();
    (this.bodyMesh.material as THREE.Material).dispose();
    this.headMesh.geometry.dispose();
    (this.headMesh.material as THREE.Material).dispose();
  }
}
