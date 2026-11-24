import * as THREE from 'three';

export const SMOKE_RIBBON_VERT = /* glsl */ `
attribute vec4 aRibbonData;
varying vec2 vUv;
varying vec4 vRibbonData;

void main() {
  vUv = uv;
  vRibbonData = aRibbonData;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SMOKE_RIBBON_FRAG = /* glsl */ `
uniform sampler2D uFlowTex;
uniform float uTime;
uniform float uSeed;
uniform float uOpacity;
uniform vec3 uLitColor;
uniform vec3 uShadowColor;

varying vec2 vUv;
varying vec4 vRibbonData;

void main() {
  float flowCoord = vRibbonData.x;
  float age = clamp(vRibbonData.y, 0.0, 1.0);
  float density = clamp(vRibbonData.z, 0.0, 1.0);
  float flashGlow = clamp(vRibbonData.w, 0.0, 1.5);
  float crossV = vUv.y;

  if (density < 0.003 || age >= 0.998) discard;

  vec2 warp = texture2D(uFlowTex, vec2(flowCoord * 0.28 - uTime * 0.14 + uSeed, crossV * 0.65 + uSeed * 0.7)).ra - 0.5;
  vec4 f1 = texture2D(uFlowTex, vec2(flowCoord * 0.48 - uTime * 0.20 + warp.x * 0.18, crossV * 0.85 + warp.y * 0.22 + uSeed));
  vec4 f2 = texture2D(uFlowTex, vec2(flowCoord * 1.05 - uTime * 0.32 - warp.y * 0.22, crossV * 1.30 + warp.x * 0.18 - uSeed * 0.5));

  // Organic wavy cross-section edge carving (zero flat ribbon tape edges)
  float dEdge = abs(crossV - 0.5) * 2.0;
  float edgeNoise = (f1.g - 0.5) * 0.54 + (f2.b - 0.5) * 0.30;
  float crossMask = smoothstep(1.0, 0.20, dEdge + edgeNoise) * smoothstep(1.0, 0.65, dEdge);

  float headFade = smoothstep(0.0, 0.04, vUv.x);
  float tailTipFade = smoothstep(1.0, 0.78, vUv.x);
  float tailFade = pow(max(0.0, 1.0 - age), 1.45);

  float erode = mix(0.08, 0.58, pow(age, 1.25));
  float wispy = smoothstep(erode, erode + 0.54, f1.r * 0.55 + f2.g * 0.60);

  float alpha = density * uOpacity * crossMask * headFade * tailTipFade * tailFade * wispy;
  if (alpha < 0.003) discard;

  float shadeMix = clamp(f1.b * 0.72 + crossV * 0.32, 0.0, 1.0);
  vec3 col = mix(uShadowColor, uLitColor, shadeMix);

  if (flashGlow > 0.002) {
    vec3 blastLight = vec3(1.0, 0.50, 0.14) * flashGlow * (0.42 + 0.85 * (1.0 - f1.r));
    col += blastLight;
  }

  gl_FragColor = vec4(col, alpha);
}
`;

export interface SmokeRibbonConfig {
  maxNodes: number;
  sampleInterval: number;
  minStepDist: number;
  drag: number;
  buoyancy: number;
  curlStrength: number;
  viscosity: number;
  opacity: number;
  seed: number;
  litColor: number;
  shadowColor: number;
}

interface RibbonNode {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxLife: number;
  startWidth: number;
  endWidth: number;
  density: number;
  flowCoord: number;
  flashGlow: number;
}

/**
 * Continuous volumetric gunsmoke ribbon backed by a viscous, curl-advected 3D fluid spine
 * and dynamically built camera-facing quad strips with twist-proof side vectors.
 */
export class VolumetricSmokeRibbon {
  public readonly mesh: THREE.Mesh;

  private readonly scene: THREE.Scene;
  private readonly config: SmokeRibbonConfig;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  private readonly posAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;
  private readonly dataAttr: THREE.BufferAttribute;

  private readonly nodes: RibbonNode[] = [];
  private readonly jacobiVel: Float32Array;
  private readonly jacobiPos: Float32Array;
  private readonly rawSide: Float32Array;
  private readonly smoothSide: Float32Array;
  private activeCount = 0;
  private emitTimer = 0;

  private readonly _tangent = new THREE.Vector3();
  private readonly _toCam = new THREE.Vector3();
  private readonly _side = new THREE.Vector3();
  private readonly _prevSide = new THREE.Vector3();
  private readonly _camUp = new THREE.Vector3();
  private readonly _flow = new THREE.Vector3();
  private readonly _wakeToNode = new THREE.Vector3();
  private readonly _wakeRadial = new THREE.Vector3();
  private readonly _segDir = new THREE.Vector3();
  private readonly _prevL = new THREE.Vector3();
  private readonly _prevR = new THREE.Vector3();
  private readonly _curL = new THREE.Vector3();
  private readonly _curR = new THREE.Vector3();

  constructor(scene: THREE.Scene, flowTex: THREE.DataTexture, config: SmokeRibbonConfig) {
    this.scene = scene;
    this.config = { ...config };
    const maxNodes = Math.max(4, config.maxNodes);

    for (let i = 0; i < maxNodes; i++) {
      this.nodes.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        maxLife: 1,
        startWidth: 0.15,
        endWidth: 0.8,
        density: 0,
        flowCoord: 0,
        flashGlow: 0,
      });
    }
    this.jacobiVel = new Float32Array(maxNodes * 3);
    this.jacobiPos = new Float32Array(maxNodes * 3);
    this.rawSide = new Float32Array(maxNodes * 3);
    this.smoothSide = new Float32Array(maxNodes * 3);

    const vertCount = maxNodes * 2;
    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const ribbonData = new Float32Array(vertCount * 4);
    const indices = new Uint16Array((maxNodes - 1) * 6);

    for (let i = 0; i < maxNodes - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      const base = i * 6;
      indices[base] = a;
      indices[base + 1] = b;
      indices[base + 2] = c;
      indices[base + 3] = b;
      indices[base + 4] = d;
      indices[base + 5] = c;
    }

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.BufferAttribute(uvs, 2);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);
    this.dataAttr = new THREE.BufferAttribute(ribbonData, 4);
    this.dataAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('uv', this.uvAttr);
    this.geometry.setAttribute('aRibbonData', this.dataAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: SMOKE_RIBBON_VERT,
      fragmentShader: SMOKE_RIBBON_FRAG,
      uniforms: {
        uFlowTex: { value: flowTex },
        uTime: { value: 0 },
        uSeed: { value: config.seed },
        uOpacity: { value: config.opacity },
        uLitColor: { value: new THREE.Color(config.litColor) },
        uShadowColor: { value: new THREE.Color(config.shadowColor) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  public reset(): void {
    this.activeCount = 0;
    this.emitTimer = 0;
    this.mesh.visible = false;
    this.geometry.setDrawRange(0, 0);
  }

  public setMotionParams(drag: number, buoyancy: number, opacity?: number): void {
    this.config.drag = drag;
    this.config.buoyancy = buoyancy;
    if (opacity !== undefined) {
      this.config.opacity = opacity;
      this.material.uniforms.uOpacity!.value = opacity;
    }
  }

  public feedEmitter(
    dt: number,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    startWidth: number,
    endWidth: number,
    density: number,
    maxLife: number,
    initialFlashGlow: number,
  ): void {
    if (this.activeCount === 0) {
      if (density <= 0.004) return;
      const n0 = this.nodes[0]!;
      const n1 = this.nodes[1]!;
      n0.pos.copy(pos);
      n0.vel.copy(vel);
      n0.age = 0;
      n0.maxLife = maxLife;
      n0.startWidth = startWidth;
      n0.endWidth = endWidth;
      n0.density = density;
      n0.flowCoord = 0;
      n0.flashGlow = initialFlashGlow;

      n1.pos.copy(pos);
      n1.vel.copy(vel);
      n1.age = 0;
      n1.maxLife = maxLife;
      n1.startWidth = startWidth;
      n1.endWidth = endWidth;
      n1.density = density;
      n1.flowCoord = 0;
      n1.flashGlow = initialFlashGlow;

      this.activeCount = 2;
      this.emitTimer = 0;
      return;
    }

    const head = this.nodes[0]!;
    const neck = this.nodes[1]!;

    // Prevent rubber-band stretch on teleportation
    if (pos.distanceToSquared(neck.pos) > 2.5 * 2.5) {
      head.density = 0;
      neck.density = 0;
      head.pos.copy(pos);
      head.vel.copy(vel);
      return;
    }

    // Keep head anchored live at the active barrel mouth
    head.pos.copy(pos);
    head.vel.copy(vel);
    head.age = 0;
    head.maxLife = maxLife;
    head.startWidth = startWidth;
    head.endWidth = endWidth;
    head.density = density;
    head.flashGlow = Math.max(head.flashGlow, initialFlashGlow);

    const stepDist = pos.distanceTo(neck.pos);
    head.flowCoord = neck.flowCoord + stepDist * 0.85;

    this.emitTimer += dt;
    const shouldEmit =
      (this.emitTimer >= this.config.sampleInterval || stepDist >= this.config.minStepDist) &&
      (density > 0.004 || neck.density > 0.004);

    if (shouldEmit) {
      this.emitTimer = 0;
      const reuseIdx = this.activeCount < this.nodes.length ? this.activeCount : this.nodes.length - 1;
      const recycled = this.nodes.splice(reuseIdx, 1)[0]!;
      recycled.pos.copy(pos);
      recycled.vel.copy(vel);
      recycled.age = 0;
      recycled.maxLife = maxLife;
      recycled.startWidth = startWidth;
      recycled.endWidth = endWidth;
      recycled.density = density;
      recycled.flowCoord = head.flowCoord;
      recycled.flashGlow = initialFlashGlow;
      this.nodes.splice(1, 0, recycled);
      if (this.activeCount < this.nodes.length) {
        this.activeCount++;
      }
    }
  }

  public applyBlastWake(origin: THREE.Vector3, dir: THREE.Vector3, pushStrength: number, maxDist: number): void {
    const maxDistSq = maxDist * maxDist;
    for (let i = 1; i < this.activeCount; i++) {
      const node = this.nodes[i]!;
      this._wakeToNode.subVectors(node.pos, origin);
      const distSq = this._wakeToNode.lengthSq();
      if (distSq >= maxDistSq) continue;

      const dist = Math.sqrt(distSq);
      const axialProj = this._wakeToNode.dot(dir);
      const fwdDot = axialProj / Math.max(0.05, dist);
      if (fwdDot <= -0.2) continue;

      const falloff = Math.pow(Math.max(0, 1 - dist / maxDist), 1.4) * (0.45 + 0.55 * Math.max(0, fwdDot));
      node.vel.addScaledVector(dir, falloff * pushStrength);

      this._wakeRadial.copy(this._wakeToNode).addScaledVector(dir, -axialProj);
      const rLen = this._wakeRadial.length();
      if (rLen > 1e-4) {
        node.vel.addScaledVector(this._wakeRadial, (falloff * 0.45 * pushStrength) / rLen);
      }
    }
  }

  public update(
    dt: number,
    camera: THREE.Camera,
    elapsedTime: number,
    flashOrigin: THREE.Vector3,
    flashIntensity: number,
    sampleFlowFn: (pos: THREE.Vector3, time: number, out: THREE.Vector3) => void,
  ): void {
    if (dt > 0 && this.activeCount > 0) {
      const dragFactor = Math.exp(-this.config.drag * dt);

      // Advect trailing spine nodes through coherent curl wind & buoyancy
      for (let i = 1; i < this.activeCount; i++) {
        const node = this.nodes[i]!;
        sampleFlowFn(node.pos, elapsedTime, this._flow);
        node.vel.addScaledVector(this._flow, this.config.curlStrength * dt);
        node.vel.multiplyScalar(dragFactor);
        node.vel.y += this.config.buoyancy * dt;
        node.pos.addScaledVector(node.vel, dt);
        node.age += dt;

        node.flashGlow *= Math.exp(-16 * dt);
        if (flashIntensity > 0.01) {
          const dSq = node.pos.distanceToSquared(flashOrigin);
          if (dSq < 10.24) {
            const prox = 1 - dSq / 10.24;
            node.flashGlow = Math.max(node.flashGlow, flashIntensity * prox * 0.92);
          }
        }
      }

      // Viscous fluid cohesion pass: couple neighboring velocities + smooth spine curvature cleanly
      if (this.activeCount >= 3 && this.config.viscosity > 0) {
        const blend = this.config.viscosity * Math.min(1, dt * 15);
        for (let i = 1; i < this.activeCount - 1; i++) {
          const prev = this.nodes[i - 1]!.vel;
          const cur = this.nodes[i]!.vel;
          const next = this.nodes[i + 1]!.vel;
          this.jacobiVel[i * 3] = cur.x + (0.5 * (prev.x + next.x) - cur.x) * blend;
          this.jacobiVel[i * 3 + 1] = cur.y + (0.5 * (prev.y + next.y) - cur.y) * blend;
          this.jacobiVel[i * 3 + 2] = cur.z + (0.5 * (prev.z + next.z) - cur.z) * blend;
        }
        for (let i = 1; i < this.activeCount - 1; i++) {
          this.nodes[i]!.vel.set(this.jacobiVel[i * 3]!, this.jacobiVel[i * 3 + 1]!, this.jacobiVel[i * 3 + 2]!);
        }

        // Laplacian spine relaxation prevents wake overtaking kinks & quad fold creases
        const posRelax = Math.min(0.45, 0.28 * Math.min(1, dt * 22));
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 1; i < this.activeCount - 1; i++) {
            const pPrev = this.nodes[i - 1]!.pos;
            const pCur = this.nodes[i]!.pos;
            const pNext = this.nodes[i + 1]!.pos;
            this.jacobiPos[i * 3] = pCur.x + (0.5 * (pPrev.x + pNext.x) - pCur.x) * posRelax;
            this.jacobiPos[i * 3 + 1] = pCur.y + (0.5 * (pPrev.y + pNext.y) - pCur.y) * posRelax;
            this.jacobiPos[i * 3 + 2] = pCur.z + (0.5 * (pPrev.z + pNext.z) - pCur.z) * posRelax;
          }
          for (let i = 1; i < this.activeCount - 1; i++) {
            this.nodes[i]!.pos.set(this.jacobiPos[i * 3]!, this.jacobiPos[i * 3 + 1]!, this.jacobiPos[i * 3 + 2]!);
          }
        }
      }

      // Prune expired trailing tail nodes
      while (this.activeCount > 0 && this.nodes[this.activeCount - 1]!.age >= this.nodes[this.activeCount - 1]!.maxLife) {
        this.activeCount--;
      }
    }

    let maxDensity = 0;
    for (let i = 0; i < this.activeCount; i++) {
      if (this.nodes[i]!.density > maxDensity) maxDensity = this.nodes[i]!.density;
    }

    if (this.activeCount < 2 || maxDensity < 0.004) {
      if (maxDensity < 0.004) this.activeCount = 0;
      this.mesh.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }

    this.mesh.visible = true;
    this.material.uniforms.uTime!.value = elapsedTime;
    this.rebuildStrip(camera);
  }

  private rebuildStrip(camera: THREE.Camera): void {
    const posArr = this.posAttr.array as Float32Array;
    const uvArr = this.uvAttr.array as Float32Array;
    const dataArr = this.dataAttr.array as Float32Array;

    this._camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    let hasPrevSide = false;
    const n = this.activeCount;

    for (let i = 0; i < n; i++) {
      const node = this.nodes[i]!;
      const iBack = Math.max(0, i - 2);
      const iFwd = Math.min(n - 1, i + 2);
      this._tangent.subVectors(this.nodes[iFwd]!.pos, this.nodes[iBack]!.pos);

      if (this._tangent.lengthSq() < 1e-8) {
        if (hasPrevSide) this._tangent.copy(this._camUp);
        else this._tangent.set(0, 0, 1);
      } else {
        this._tangent.normalize();
      }

      this._toCam.subVectors(camera.position, node.pos);
      if (this._toCam.lengthSq() < 1e-8) {
        this._toCam.set(0, 0, 1);
      } else {
        this._toCam.normalize();
      }

      this._side.crossVectors(this._tangent, this._toCam);
      if (this._side.lengthSq() < 1e-6) {
        this._side.crossVectors(this._tangent, this._camUp);
      }
      if (this._side.lengthSq() < 1e-6) {
        this._side.set(1, 0, 0);
      } else {
        this._side.normalize();
      }

      if (hasPrevSide && this._side.dot(this._prevSide) < 0) {
        this._side.negate();
      }
      this._prevSide.copy(this._side);
      hasPrevSide = true;

      this.rawSide[i * 3] = this._side.x;
      this.rawSide[i * 3 + 1] = this._side.y;
      this.rawSide[i * 3 + 2] = this._side.z;
    }

    // Smooth miter side vectors across neighboring nodes so wide tails never pinch or crease
    for (let i = 0; i < n; i++) {
      const iPrev = i > 0 ? i - 1 : 0;
      const iNext = i < n - 1 ? i + 1 : n - 1;
      const sx = this.rawSide[iPrev * 3]! * 0.25 + this.rawSide[i * 3]! * 0.5 + this.rawSide[iNext * 3]! * 0.25;
      const sy = this.rawSide[iPrev * 3 + 1]! * 0.25 + this.rawSide[i * 3 + 1]! * 0.5 + this.rawSide[iNext * 3 + 1]! * 0.25;
      const sz = this.rawSide[iPrev * 3 + 2]! * 0.25 + this.rawSide[i * 3 + 2]! * 0.5 + this.rawSide[iNext * 3 + 2]! * 0.25;
      const sLen = Math.hypot(sx, sy, sz) || 1;
      this.smoothSide[i * 3] = sx / sLen;
      this.smoothSide[i * 3 + 1] = sy / sLen;
      this.smoothSide[i * 3 + 2] = sz / sLen;
    }

    for (let i = 0; i < n; i++) {
      const node = this.nodes[i]!;
      const sx = this.smoothSide[i * 3]!;
      const sy = this.smoothSide[i * 3 + 1]!;
      const sz = this.smoothSide[i * 3 + 2]!;

      const uAge = Math.min(1, node.age / Math.max(0.01, node.maxLife));
      const grow = 1 - Math.pow(1 - uAge, 1.9);
      const halfW = THREE.MathUtils.lerp(node.startWidth, node.endWidth, grow) * 0.5;
      const ribbonU = i / (n - 1);

      this._curL.set(node.pos.x - sx * halfW, node.pos.y - sy * halfW, node.pos.z - sz * halfW);
      this._curR.set(node.pos.x + sx * halfW, node.pos.y + sy * halfW, node.pos.z + sz * halfW);

      // Non-overtaking edge guard prevents inside-turn quad folds and starburst pinches
      if (i > 0) {
        this._segDir.subVectors(node.pos, this.nodes[i - 1]!.pos);
        const segLen = this._segDir.length();
        if (segLen > 1e-5) {
          this._segDir.divideScalar(segLen);
          const dL =
            (this._curL.x - this._prevL.x) * this._segDir.x +
            (this._curL.y - this._prevL.y) * this._segDir.y +
            (this._curL.z - this._prevL.z) * this._segDir.z;
          if (dL < 0.002) {
            this._curL.addScaledVector(this._segDir, 0.002 - dL);
          }
          const dR =
            (this._curR.x - this._prevR.x) * this._segDir.x +
            (this._curR.y - this._prevR.y) * this._segDir.y +
            (this._curR.z - this._prevR.z) * this._segDir.z;
          if (dR < 0.002) {
            this._curR.addScaledVector(this._segDir, 0.002 - dR);
          }
        }
      }
      this._prevL.copy(this._curL);
      this._prevR.copy(this._curR);

      const vLeft = i * 2;
      const vRight = vLeft + 1;

      posArr[vLeft * 3] = this._curL.x;
      posArr[vLeft * 3 + 1] = this._curL.y;
      posArr[vLeft * 3 + 2] = this._curL.z;

      posArr[vRight * 3] = this._curR.x;
      posArr[vRight * 3 + 1] = this._curR.y;
      posArr[vRight * 3 + 2] = this._curR.z;

      uvArr[vLeft * 2] = ribbonU;
      uvArr[vLeft * 2 + 1] = 0;
      uvArr[vRight * 2] = ribbonU;
      uvArr[vRight * 2 + 1] = 1;

      dataArr[vLeft * 4] = node.flowCoord;
      dataArr[vLeft * 4 + 1] = uAge;
      dataArr[vLeft * 4 + 2] = node.density;
      dataArr[vLeft * 4 + 3] = node.flashGlow;

      dataArr[vRight * 4] = node.flowCoord;
      dataArr[vRight * 4 + 1] = uAge;
      dataArr[vRight * 4 + 2] = node.density;
      dataArr[vRight * 4 + 3] = node.flashGlow;
    }

    this.posAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.dataAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, (n - 1) * 6);
  }

  public dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
