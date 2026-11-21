import * as THREE from 'three';
import type { ZombieArchetypeConfig, ZombieTypeId } from '@tactical-td/shared';
import type { PathSystem } from '../systems/PathSystem';

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

const DEFAULT_MAX_ZOMBIES = 1024;
const FORWARD_Z = new THREE.Vector3(0, 0, 1);

/**
 * Pooled + InstancedMesh Zombie Renderer & Movement Simulator.
 *
 * Uses 2 InstancedMeshes (body + head) for up to 1,024 concurrent zombies (2 draw calls total)
 * and zero per-frame allocations inside fixedUpdate() and syncRender().
 */
export class ZombiePool {
  public readonly maxCapacity: number;
  public readonly group = new THREE.Group();

  private readonly records: ZombieRecord[];
  private readonly freeIndices: number[];
  private readonly activeIndices: number[] = [];

  private readonly bodyMesh: THREE.InstancedMesh;
  private readonly headMesh: THREE.InstancedMesh;

  private nextEntityId = 1;

  // Pre-allocated scratch math objects (zero GC in 60Hz / 144Hz loops)
  private readonly _interpPos = new THREE.Vector3();
  private readonly _headPos = new THREE.Vector3();
  private readonly _flatForward = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _matrix = new THREE.Matrix4();
  private readonly _colorScratch = new THREE.Color();

  constructor(maxCapacity = DEFAULT_MAX_ZOMBIES) {
    this.maxCapacity = maxCapacity;
    this.group.name = 'ZombiePool_Instanced';

    this.records = new Array(maxCapacity);
    this.freeIndices = new Array(maxCapacity);

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

    // Unit torso box anchored at feet (y in [0, 1]) so scaling height lifts cleanly off road
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

    this.group.add(this.bodyMesh, this.headMesh);
  }

  public getActiveCount(): number {
    return this.activeIndices.length;
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

    this.activeIndices.push(poolIndex);
    return z;
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
   * so 120Hz/144Hz monitors stay fluid from the 60Hz simulation.
   */
  public syncRender(alpha: number): void {
    const count = this.activeIndices.length;

    for (let slot = 0; slot < count; slot++) {
      const z = this.records[this.activeIndices[slot]];

      this._interpPos.lerpVectors(z.prevPos, z.currPos, alpha);
      // Keep character upright horizontally while facing movement direction
      this._flatForward.set(z.forward.x, 0, z.forward.z);
      if (this._flatForward.lengthSq() > 1e-6) {
        this._flatForward.normalize();
        this._quat.setFromUnitVectors(FORWARD_Z, this._flatForward);
      } else {
        this._quat.identity();
      }

      const bodyHeight = z.height * 0.72;
      const bodyWidth = z.radius * 1.65;
      this._scale.set(bodyWidth, bodyHeight, bodyWidth);
      this._matrix.compose(this._interpPos, this._quat, this._scale);
      this.bodyMesh.setMatrixAt(slot, this._matrix);

      // Head sits on top of torso
      const headSize = z.radius * 1.15;
      this._headPos.set(
        this._interpPos.x,
        this._interpPos.y + bodyHeight + headSize * 0.36,
        this._interpPos.z,
      );
      this._scale.set(headSize, headSize, headSize);
      this._matrix.compose(this._headPos, this._quat, this._scale);
      this.headMesh.setMatrixAt(slot, this._matrix);

      // Visual indicator: slightly darken tint when sheltered inside a tunnel
      this._colorScratch.copy(z.baseColor);
      if (z.inTunnel) {
        this._colorScratch.multiplyScalar(0.55);
      }
      this.bodyMesh.setColorAt(slot, this._colorScratch);

      this._colorScratch.multiplyScalar(1.18);
      this.headMesh.setColorAt(slot, this._colorScratch);
    }

    this.bodyMesh.count = count;
    this.headMesh.count = count;

    if (count > 0) {
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
