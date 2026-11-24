import * as THREE from 'three';
import type { TowerCategory } from '../../types/protocol';

const UP = new THREE.Vector3(0, 1, 0);

function wrapAngleRad(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function stepDampedSpring(
  val: number,
  vel: number,
  omega: number,
  zeta: number,
  dt: number,
): [number, number] {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  let x = val;
  let v = vel;
  for (let i = 0; i < steps; i++) {
    const accel = -omega * omega * x - 2 * zeta * omega * v;
    v += accel * h;
    x += v * h;
  }
  return [x, v];
}

export interface TurretTelemetry {
  yawDeg: number;
  pitchDeg: number;
  recoilMm: number;
  aligned: boolean;
  spinRpm?: number;
}

interface BarrelSlot {
  recoilNode: THREE.Object3D;
  basePos: THREE.Vector3;
  muzzleSocket: THREE.Object3D;
  baseMuzzleLocal: THREE.Vector3;
  recoilOffset: number;
  recoilVel: number;
}

interface SpinNodeSpec {
  node: THREE.Object3D;
  sign: 1 | -1;
}

/**
 * Drives articulated turret rigs (`Base_Static`, `Turret_Yaw`, `Turret_Pitch`,
 * single `Barrel_Recoil` or twin `Barrel_Recoil_L/R`, rotary minigun `Barrel_Spin*`,
 * continuous `Radar_Spin`, `Muzzle_Socket*`, `Eject_Socket`) with rate-limited target
 * tracking, autonomous sentry scan, and 2nd-order spring-damper recoil kinematics.
 */
export class TurretRigController {
  private readonly root: THREE.Object3D;
  private readonly baseNode: THREE.Object3D | null;
  private readonly yawNode: THREE.Object3D | null;
  private readonly pitchNode: THREE.Object3D | null;
  private readonly radarNode: THREE.Object3D | null;
  private readonly ejectSocket: THREE.Object3D | null;

  private readonly barrelSlots: BarrelSlot[] = [];
  private readonly spinNodes: SpinNodeSpec[] = [];
  private readonly dischargeMats: THREE.MeshStandardMaterial[] = [];

  private readonly baseYawPos = new THREE.Vector3();
  private readonly basePitchPos = new THREE.Vector3();

  private currentYaw = 0;
  private currentPitch = 0;
  private scanTime = 0;
  private activeShotIdx = 0;
  private lastFiredIdx = 0;

  // Rotary minigun angular kinematics & electromagnetic railgun discharge flash
  private barrelSpinAngle = 0;
  private barrelSpinVel = 0;
  private dischargeFlash = 0;

  // 2nd-order pitch & chassis spring states
  private pitchShock = 0;
  private pitchShockVel = 0;
  private chassisRoll = 0;
  private chassisRollVel = 0;
  private chassisDip = 0;
  private chassisDipVel = 0;
  private rollSign = 1;

  // Rig visualization gizmos
  private rigMarkers: THREE.Object3D[] = [];
  private readonly overlayDisposables: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } = {
    geometries: [],
    materials: [],
  };
  private rigVisible = false;

  private readonly _tmpQuat = new THREE.Quaternion();
  private readonly _pitchWorld = new THREE.Vector3();

  constructor(root: THREE.Object3D) {
    this.root = root;
    this.baseNode = root.getObjectByName('Base_Static') ?? null;
    this.yawNode = root.getObjectByName('Turret_Yaw') ?? null;
    this.pitchNode = root.getObjectByName('Turret_Pitch') ?? null;
    this.radarNode = root.getObjectByName('Radar_Spin') ?? null;
    this.ejectSocket = root.getObjectByName('Eject_Socket') ?? null;

    if (this.yawNode) {
      this.yawNode.rotation.order = 'YXZ';
      this.baseYawPos.copy(this.yawNode.position);
    }
    if (this.pitchNode) {
      this.pitchNode.rotation.order = 'XYZ';
      this.basePitchPos.copy(this.pitchNode.position);
    }

    // Collect either twin alternating barrels (`_L`/`_R`) or single barrel (`Barrel_Recoil`)
    const recoilL = root.getObjectByName('Barrel_Recoil_L');
    const recoilR = root.getObjectByName('Barrel_Recoil_R');
    const muzzleL = root.getObjectByName('Muzzle_Socket_L');
    const muzzleR = root.getObjectByName('Muzzle_Socket_R');

    if (recoilL && muzzleL && recoilR && muzzleR) {
      this.barrelSlots.push(
        {
          recoilNode: recoilL,
          basePos: recoilL.position.clone(),
          muzzleSocket: muzzleL,
          baseMuzzleLocal: muzzleL.position.clone(),
          recoilOffset: 0,
          recoilVel: 0,
        },
        {
          recoilNode: recoilR,
          basePos: recoilR.position.clone(),
          muzzleSocket: muzzleR,
          baseMuzzleLocal: muzzleR.position.clone(),
          recoilOffset: 0,
          recoilVel: 0,
        },
      );
    } else {
      const barrel = root.getObjectByName('Barrel_Recoil');
      const muzzle = root.getObjectByName('Muzzle_Socket');
      if (barrel && muzzle) {
        this.barrelSlots.push({
          recoilNode: barrel,
          basePos: barrel.position.clone(),
          muzzleSocket: muzzle,
          baseMuzzleLocal: muzzle.position.clone(),
          recoilOffset: 0,
          recoilVel: 0,
        });
      }
    }

    // Collect single or counter-rotating twin rotary minigun barrel clusters
    const spinSingle = root.getObjectByName('Barrel_Spin');
    const spinL = root.getObjectByName('Barrel_Spin_L');
    const spinR = root.getObjectByName('Barrel_Spin_R');
    if (spinL && spinR) {
      this.spinNodes.push({ node: spinL, sign: 1 }, { node: spinR, sign: -1 });
    } else if (spinSingle) {
      this.spinNodes.push({ node: spinSingle, sign: 1 });
    }

    // Clone railgun discharge neon material per instance so cached template is never mutated
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => {
          if (m instanceof THREE.MeshStandardMaterial && m.name === 'railgun_discharge_neon') {
            const cloned = m.clone();
            this.dischargeMats.push(cloned);
            return cloned;
          }
          return m;
        });
      } else if (
        mesh.material instanceof THREE.MeshStandardMaterial &&
        mesh.material.name === 'railgun_discharge_neon'
      ) {
        const cloned = mesh.material.clone();
        this.dischargeMats.push(cloned);
        mesh.material = cloned;
      }
    });
  }

  public hasArticulatedRig(): boolean {
    return Boolean(this.yawNode && this.pitchNode && this.barrelSlots.length > 0);
  }

  public hasRotaryBarrels(): boolean {
    return this.spinNodes.length > 0;
  }

  /** Applies user fine-trim offset (`Muzzle Offset (m)`) cleanly over calibrated socket positions. */
  public applyMuzzleTrim(offset: { x: number; y: number; z: number }): void {
    for (const slot of this.barrelSlots) {
      slot.muzzleSocket.position.set(
        slot.baseMuzzleLocal.x + offset.x,
        slot.baseMuzzleLocal.y + offset.y,
        slot.baseMuzzleLocal.z + offset.z,
      );
    }
  }

  /** Triggers barrel hydraulic kickback (round-robin across twin barrels), spin-up, muzzle climb & chassis shock. */
  public triggerRecoil(intensity = 1.0): void {
    if (this.barrelSlots.length > 0) {
      const idx = this.activeShotIdx % this.barrelSlots.length;
      const slot = this.barrelSlots[idx]!;
      slot.recoilOffset = THREE.MathUtils.clamp(slot.recoilOffset - 0.035 * intensity, -0.22, 0.015);
      slot.recoilVel -= 3.8 * intensity;
      this.lastFiredIdx = idx;
      this.activeShotIdx = (idx + 1) % this.barrelSlots.length;
    }

    if (this.spinNodes.length > 0) {
      this.barrelSpinVel = Math.min(28, Math.max(this.barrelSpinVel + 9.5 * intensity, 16 * intensity));
    }

    if (this.dischargeMats.length > 0) {
      this.dischargeFlash = Math.min(1.4, Math.max(this.dischargeFlash, intensity));
    }

    this.pitchShockVel -= 1.65 * intensity;
    this.rollSign = -this.rollSign;
    this.chassisRollVel += this.rollSign * 0.35 * intensity;
    this.chassisDip = THREE.MathUtils.clamp(this.chassisDip - 0.007 * intensity, -0.024, 0.006);
    this.chassisDipVel -= 0.42 * intensity;
  }

  /** Updates damped recoil/shock springs, rotary barrel spin-down, and radar sweep without drift. */
  public updatePhysics(dt: number): void {
    if (dt > 0) {
      for (const slot of this.barrelSlots) {
        [slot.recoilOffset, slot.recoilVel] = stepDampedSpring(slot.recoilOffset, slot.recoilVel, 26, 0.72, dt);
        slot.recoilOffset = THREE.MathUtils.clamp(slot.recoilOffset, -0.22, 0.015);
      }

      if (this.spinNodes.length > 0) {
        this.barrelSpinAngle = (this.barrelSpinAngle + this.barrelSpinVel * dt) % (Math.PI * 200);
        this.barrelSpinVel *= Math.exp(-2.1 * dt);
      }

      if (this.radarNode) {
        this.radarNode.rotation.y = (this.radarNode.rotation.y + 1.65 * dt) % (Math.PI * 2);
      }

      if (this.dischargeMats.length > 0) {
        this.dischargeFlash *= Math.exp(-5.8 * dt);
        if (this.dischargeFlash < 0.002) this.dischargeFlash = 0;
      }

      [this.pitchShock, this.pitchShockVel] = stepDampedSpring(this.pitchShock, this.pitchShockVel, 27, 0.46, dt);
      [this.chassisRoll, this.chassisRollVel] = stepDampedSpring(this.chassisRoll, this.chassisRollVel, 36, 0.38, dt);
      [this.chassisDip, this.chassisDipVel] = stepDampedSpring(this.chassisDip, this.chassisDipVel, 34, 0.55, dt);
      this.chassisDip = THREE.MathUtils.clamp(this.chassisDip, -0.024, 0.006);
    }

    if (this.dischargeMats.length > 0) {
      const g = Math.min(1, this.dischargeFlash);
      for (const m of this.dischargeMats) {
        m.emissive.setRGB(0.03 + 0.14 * g, 0.14 + 0.72 * g, 0.30 + 0.70 * g);
        m.emissiveIntensity = 0.22 + 6.5 * g;
      }
    }

    if (this.yawNode) {
      this.yawNode.position.set(this.baseYawPos.x, this.baseYawPos.y + this.chassisDip, this.baseYawPos.z);
      this.yawNode.rotation.set(Math.abs(this.chassisRoll) * 0.25, this.currentYaw, this.chassisRoll);
    }
    if (this.pitchNode) {
      this.pitchNode.position.copy(this.basePitchPos);
      this.pitchNode.rotation.set(this.currentPitch + this.pitchShock, 0, 0);
    }
    for (const slot of this.barrelSlots) {
      slot.recoilNode.position.set(slot.basePos.x, slot.basePos.y, slot.basePos.z + slot.recoilOffset);
    }
    for (const spin of this.spinNodes) {
      spin.node.rotation.z = this.barrelSpinAngle * spin.sign;
    }
  }

  /** Slew-limited yaw tracking + realistic elevation tilt toward a world target. */
  public updateTrackTarget(
    targetWorldPos: THREE.Vector3,
    turnSpeedRad: number,
    category: TowerCategory,
    dt: number,
  ): TurretTelemetry {
    this.root.updateMatrixWorld(true);
    const dx = targetWorldPos.x - this.root.position.x;
    const dz = targetWorldPos.z - this.root.position.z;
    const desiredYaw = Math.atan2(dx, dz);
    const err = wrapAngleRad(desiredYaw - this.currentYaw);

    if (dt > 0) {
      const maxStep = Math.max(0.1, turnSpeedRad) * dt;
      this.currentYaw = wrapAngleRad(this.currentYaw + THREE.MathUtils.clamp(err, -maxStep, maxStep));
    }

    let targetPitch = -0.04;
    if (category === 'explosive') {
      targetPitch = -Math.PI * 0.28;
    } else if (this.pitchNode) {
      this.pitchNode.getWorldPosition(this._pitchWorld);
      const dy = targetWorldPos.y - this._pitchWorld.y;
      const horiz = Math.max(0.35, Math.hypot(targetWorldPos.x - this._pitchWorld.x, targetWorldPos.z - this._pitchWorld.z));
      targetPitch = THREE.MathUtils.clamp(-Math.atan2(dy, horiz), -0.38, 0.24);
    }

    if (dt > 0) {
      const alpha = 1 - Math.exp(-12 * dt);
      this.currentPitch = THREE.MathUtils.lerp(this.currentPitch, targetPitch, alpha);
    }

    return this.getTelemetry(Math.abs(err) < THREE.MathUtils.degToRad(8.5));
  }

  /** Autonomous sentry sweep across +-45 deg with gentle elevation breathing. */
  public updateIdleScan(dt: number, turnSpeedRad = 3.5): TurretTelemetry {
    if (dt > 0) {
      this.scanTime += dt;
      const rawSin = Math.sin(this.scanTime * 1.05);
      const desiredYaw = (Math.tanh(1.5 * rawSin) / Math.tanh(1.5)) * THREE.MathUtils.degToRad(45);
      const err = wrapAngleRad(desiredYaw - this.currentYaw);
      const maxStep = Math.max(1.2, turnSpeedRad * 0.45) * dt;
      this.currentYaw = wrapAngleRad(this.currentYaw + THREE.MathUtils.clamp(err, -maxStep, maxStep));

      const desiredPitch = -0.035 + Math.sin(this.scanTime * 2.1) * 0.04;
      const alpha = 1 - Math.exp(-5 * dt);
      this.currentPitch = THREE.MathUtils.lerp(this.currentPitch, desiredPitch, alpha);
    }
    return this.getTelemetry(false);
  }

  public getTelemetry(aligned = false): TurretTelemetry {
    let maxRecoilMm = 0;
    for (const slot of this.barrelSlots) {
      const mm = Math.round(Math.abs(slot.recoilOffset) * 1000);
      if (mm > maxRecoilMm) maxRecoilMm = mm;
    }
    return {
      yawDeg: Math.round(THREE.MathUtils.radToDeg(this.currentYaw)),
      pitchDeg: Number((-THREE.MathUtils.radToDeg(this.currentPitch + this.pitchShock)).toFixed(1)),
      recoilMm: maxRecoilMm,
      aligned,
      spinRpm: this.spinNodes.length > 0 ? Math.round((this.barrelSpinVel * 60) / (Math.PI * 2)) : undefined,
    };
  }

  public getMuzzleWorldPose(posOut: THREE.Vector3, dirOut: THREE.Vector3): boolean {
    const slot = this.barrelSlots[this.lastFiredIdx] ?? this.barrelSlots[0];
    if (!slot) return false;
    this.root.updateMatrixWorld(true);
    slot.muzzleSocket.getWorldPosition(posOut);
    slot.muzzleSocket.getWorldQuaternion(this._tmpQuat);
    dirOut.set(0, 0, 1).applyQuaternion(this._tmpQuat).normalize();
    return true;
  }

  public getEjectWorldPose(
    posOut: THREE.Vector3,
    rightOut: THREE.Vector3,
    upOut: THREE.Vector3,
    backOut: THREE.Vector3,
  ): boolean {
    if (!this.ejectSocket) return false;
    this.root.updateMatrixWorld(true);
    this.ejectSocket.getWorldPosition(posOut);
    this.ejectSocket.getWorldQuaternion(this._tmpQuat);
    rightOut.set(-1, 0, 0).applyQuaternion(this._tmpQuat).normalize();
    upOut.set(0, 1, 0).applyQuaternion(this._tmpQuat).normalize();
    backOut.set(0, 0, -1).applyQuaternion(this._tmpQuat).normalize();
    return true;
  }

  /** Shows or hides color-coded 3D bone pivots & coordinate axes directly attached to each rig node. */
  public setRigOverlayVisible(visible: boolean): void {
    this.rigVisible = visible;
    if (visible && this.rigMarkers.length === 0) {
      this.buildRigOverlay();
    }
    for (const m of this.rigMarkers) {
      m.visible = this.rigVisible;
    }
  }

  private buildRigOverlay(): void {
    const specs: Array<{ node: THREE.Object3D | null; color: number; radius: number; axes: number }> = [
      { node: this.baseNode, color: 0xf87171, radius: 0.09, axes: 0.42 },
      { node: this.yawNode, color: 0x60a5fa, radius: 0.10, axes: 0.55 },
      { node: this.pitchNode, color: 0x4ade80, radius: 0.09, axes: 0.48 },
      { node: this.radarNode, color: 0x38bdf8, radius: 0.065, axes: 0.34 },
      { node: this.ejectSocket, color: 0xc084fc, radius: 0.06, axes: 0.28 },
    ];
    for (const slot of this.barrelSlots) {
      specs.push({ node: slot.recoilNode, color: 0xfbbf24, radius: 0.075, axes: 0.40 });
      specs.push({ node: slot.muzzleSocket, color: 0x22d3ee, radius: 0.065, axes: 0.35 });
    }
    for (const spin of this.spinNodes) {
      specs.push({ node: spin.node, color: 0xfb923c, radius: 0.08, axes: 0.36 });
    }

    for (const s of specs) {
      if (!s.node) continue;
      const g = new THREE.Group();
      g.renderOrder = 99;

      const geo = new THREE.SphereGeometry(s.radius, 12, 10);
      const mat = new THREE.MeshBasicMaterial({
        color: s.color,
        depthTest: false,
        transparent: true,
        opacity: 0.92,
      });
      this.overlayDisposables.geometries.push(geo);
      this.overlayDisposables.materials.push(mat);

      const orb = new THREE.Mesh(geo, mat);
      orb.renderOrder = 99;
      g.add(orb);

      const axes = new THREE.AxesHelper(s.axes);
      axes.renderOrder = 99;
      const axesMat = axes.material as THREE.Material;
      axesMat.depthTest = false;
      axesMat.transparent = true;
      axesMat.opacity = 0.85;
      this.overlayDisposables.geometries.push(axes.geometry);
      this.overlayDisposables.materials.push(axesMat);
      g.add(axes);

      if (s.node === this.yawNode || s.node === this.pitchNode) {
        const ringGeo = new THREE.TorusGeometry(s.radius * 3.1, 0.014, 8, 32);
        if (s.node === this.yawNode) ringGeo.rotateX(Math.PI / 2);
        else ringGeo.rotateY(Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: s.color,
          depthTest: false,
          transparent: true,
          opacity: 0.65,
        });
        this.overlayDisposables.geometries.push(ringGeo);
        this.overlayDisposables.materials.push(ringMat);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.renderOrder = 99;
        g.add(ring);
      }

      s.node.add(g);
      this.rigMarkers.push(g);
    }

    void UP;
  }

  public dispose(): void {
    for (const m of this.rigMarkers) {
      m.parent?.remove(m);
    }
    this.rigMarkers = [];
    for (const g of this.overlayDisposables.geometries) g.dispose();
    for (const m of this.overlayDisposables.materials) m.dispose();
    this.overlayDisposables.geometries = [];
    this.overlayDisposables.materials = [];
    for (const m of this.dischargeMats) m.dispose();
    this.dischargeMats.length = 0;
  }
}
