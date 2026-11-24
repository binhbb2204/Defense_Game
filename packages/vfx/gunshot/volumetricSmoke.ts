import * as THREE from 'three';

export const VOLUMETRIC_SMOKE_VERT = /* glsl */ `
attribute vec4 aCenterScale;
attribute vec4 aSpriteParams;
attribute vec4 aSmokeState;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vWorldUp;
varying vec4 vSpriteParams;
varying vec4 vSmokeState;

void main() {
  vUv = uv;
  vSpriteParams = aSpriteParams;
  vSmokeState = aSmokeState;

  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

  float roll = aSpriteParams.x;
  float c = cos(roll);
  float s = sin(roll);
  vec2 rotLocal = vec2(position.x * c - position.y * s, position.x * s + position.y * c);

  vec3 worldPos = aCenterScale.xyz + (camRight * rotLocal.x + camUp * rotLocal.y) * aCenterScale.w;
  vWorldPos = worldPos;
  vWorldUp = (camRight.y * rotLocal.x + camUp.y * rotLocal.y) * 2.0;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

export const VOLUMETRIC_SMOKE_FRAG = /* glsl */ `
uniform sampler2D uSmokeAtlas;
uniform sampler2D uFlowTex;
uniform float uTime;
uniform vec3 uLitColor;
uniform vec3 uShadowColor;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vWorldUp;
varying vec4 vSpriteParams;
varying vec4 vSmokeState;

void main() {
  float age = clamp(vSmokeState.x, 0.0, 1.0);
  float opacity = clamp(vSmokeState.y, 0.0, 1.0);
  float flashGlow = clamp(vSmokeState.z, 0.0, 1.5);
  float flowCoord = vSmokeState.w;

  if (opacity < 0.003 || age >= 0.998) discard;

  float tileIdx = floor(vSpriteParams.y + 0.5);
  float flipX = vSpriteParams.z;
  float seed = vSpriteParams.w;

  // World-coherent fluid turbulence shared across overlapping billows
  vec2 worldUvA = vec2(vWorldPos.x * 0.28 + vWorldPos.z * 0.19 + flowCoord * 0.04, vWorldPos.y * 0.30 - uTime * 0.16);
  vec2 worldUvB = vec2(vWorldPos.z * 0.34 - vWorldPos.x * 0.21 - seed * 0.37, vWorldPos.y * 0.38 - uTime * 0.24);
  vec4 wf1 = texture2D(uFlowTex, worldUvA);
  vec4 wf2 = texture2D(uFlowTex, worldUvB);

  vec2 localUv = vec2(flipX < 0.0 ? 1.0 - vUv.x : vUv.x, vUv.y);
  localUv = clamp(localUv + (wf1.ra - 0.5) * 0.11, vec2(0.03), vec2(0.97));

  vec2 tileOffset = vec2(mod(tileIdx, 2.0) * 0.5, floor(tileIdx * 0.5) * 0.5);
  vec4 atlas = texture2D(uSmokeAtlas, tileOffset + localUv * 0.5);

  vec2 p = (vUv - 0.5) * 2.0;
  float r2 = dot(p, p);
  float radialSoft = exp(-r2 * 2.35) * smoothstep(1.0, 0.55, sqrt(r2));

  float cloudField = atlas.r * 0.54 + atlas.g * 0.22 + wf1.r * 0.24 + wf2.g * 0.18;
  float erode = mix(0.14, 0.62, pow(age, 1.15));
  float wispy = smoothstep(erode, erode + 0.54, cloudField);

  float birthFade = smoothstep(0.0, 0.05, age);
  float deathFade = pow(max(0.0, 1.0 - age), 1.35);

  float alpha = atlas.a * radialSoft * wispy * birthFade * deathFade * opacity;
  if (alpha < 0.003) discard;

  float billowLight = clamp(atlas.b * 0.48 + wf1.b * 0.30 + vWorldUp * 0.42 + 0.22, 0.0, 1.0);
  vec3 col = mix(uShadowColor, uLitColor, billowLight);

  if (flashGlow > 0.002) {
    vec3 blastLight = vec3(1.0, 0.49, 0.13) * flashGlow * (0.42 + 0.88 * (1.0 - atlas.r * 0.65));
    col += blastLight;
  }

  gl_FragColor = vec4(col, alpha);
}
`;

export interface SmokeSpineConfig {
  maxNodes: number;
  sampleInterval: number;
  minStepDist: number;
  drag: number;
  buoyancy: number;
  curlStrength: number;
  viscosity: number;
  opacity: number;
  bulgeFactor: number;
}

interface SpineNode {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  bulgeDir: THREE.Vector3;
  age: number;
  maxLife: number;
  startWidth: number;
  endWidth: number;
  density: number;
  flowCoord: number;
  flashGlow: number;
  roll: number;
  rollVel: number;
  tileIdx: number;
  flipX: number;
  seed: number;
}

export interface SmokeBillowSample {
  x: number;
  y: number;
  z: number;
  scale: number;
  roll: number;
  tileIdx: number;
  flipX: number;
  seed: number;
  age: number;
  opacity: number;
  flashGlow: number;
  flowCoord: number;
  distSq: number;
}

function assignRandomUnitDir(out: THREE.Vector3, prevDir?: THREE.Vector3): void {
  const theta = Math.random() * Math.PI * 2;
  const u = Math.random() * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - u * u));
  out.set(r * Math.cos(theta), u * 0.7 + 0.15, r * Math.sin(theta));
  if (prevDir && prevDir.lengthSq() > 0.01) {
    out.multiplyScalar(0.7).addScaledVector(prevDir, 0.3);
  }
  if (out.lengthSq() < 1e-5) {
    out.set(0, 1, 0);
  } else {
    out.normalize();
  }
}

/**
 * Viscous 3D fluid spine driving coherent muzzle-to-tail smoke advection,
 * aerodynamic blast wakes, and Catmull-Rom bridge interpolation for overlapping billows.
 */
export class SmokeFluidSpine {
  private readonly config: SmokeSpineConfig;
  private readonly nodes: SpineNode[] = [];
  private readonly jacobiVel: Float32Array;
  private readonly jacobiPos: Float32Array;
  private activeCount = 0;
  private emitTimer = 0;

  private readonly _flow = new THREE.Vector3();
  private readonly _wakeToNode = new THREE.Vector3();
  private readonly _wakeRadial = new THREE.Vector3();
  private readonly _tmpMid = new THREE.Vector3();
  private readonly _tmpBulge = new THREE.Vector3();

  constructor(config: SmokeSpineConfig) {
    this.config = { ...config };
    const maxNodes = Math.max(4, config.maxNodes);

    for (let i = 0; i < maxNodes; i++) {
      this.nodes.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        bulgeDir: new THREE.Vector3(0, 1, 0),
        age: 0,
        maxLife: 1,
        startWidth: 0.15,
        endWidth: 0.8,
        density: 0,
        flowCoord: 0,
        flashGlow: 0,
        roll: 0,
        rollVel: 0,
        tileIdx: i & 3,
        flipX: i % 2 === 0 ? 1 : -1,
        seed: (i * 0.37) % 1,
      });
    }
    this.jacobiVel = new Float32Array(maxNodes * 3);
    this.jacobiPos = new Float32Array(maxNodes * 3);
  }

  public reset(): void {
    this.activeCount = 0;
    this.emitTimer = 0;
  }

  public setMotionParams(drag: number, buoyancy: number, opacity?: number): void {
    this.config.drag = drag;
    this.config.buoyancy = buoyancy;
    if (opacity !== undefined) {
      this.config.opacity = opacity;
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
      this.initNode(n0, pos, vel, startWidth, endWidth, density, maxLife, 0, initialFlashGlow);
      this.initNode(n1, pos, vel, startWidth, endWidth, density, maxLife, 0, initialFlashGlow, n0.bulgeDir);
      this.activeCount = 2;
      this.emitTimer = 0;
      return;
    }

    const head = this.nodes[0]!;
    const neck = this.nodes[1]!;

    if (pos.distanceToSquared(neck.pos) > 2.5 * 2.5) {
      head.density = 0;
      neck.density = 0;
      head.pos.copy(pos);
      head.vel.copy(vel);
      return;
    }

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
      this.initNode(
        recycled,
        pos,
        vel,
        startWidth,
        endWidth,
        density,
        maxLife,
        head.flowCoord,
        initialFlashGlow,
        neck.bulgeDir,
      );
      this.nodes.splice(1, 0, recycled);
      if (this.activeCount < this.nodes.length) {
        this.activeCount++;
      }
    }
  }

  private initNode(
    node: SpineNode,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    startWidth: number,
    endWidth: number,
    density: number,
    maxLife: number,
    flowCoord: number,
    flashGlow: number,
    prevBulgeDir?: THREE.Vector3,
  ): void {
    node.pos.copy(pos);
    node.vel.copy(vel);
    assignRandomUnitDir(node.bulgeDir, prevBulgeDir);
    node.age = 0;
    node.maxLife = maxLife;
    node.startWidth = startWidth;
    node.endWidth = endWidth;
    node.density = density;
    node.flowCoord = flowCoord;
    node.flashGlow = flashGlow;
    node.roll = Math.random() * Math.PI * 2;
    node.rollVel = (Math.random() - 0.5) * 0.85;
    node.tileIdx = Math.floor(Math.random() * 4);
    node.flipX = Math.random() < 0.5 ? -1 : 1;
    node.seed = Math.random();
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

  public stepPhysics(
    dt: number,
    elapsedTime: number,
    flashOrigin: THREE.Vector3,
    flashIntensity: number,
    sampleFlowFn: (pos: THREE.Vector3, time: number, out: THREE.Vector3) => void,
  ): void {
    if (dt <= 0 || this.activeCount === 0) return;

    const dragFactor = Math.exp(-this.config.drag * dt);
    for (let i = 1; i < this.activeCount; i++) {
      const node = this.nodes[i]!;
      sampleFlowFn(node.pos, elapsedTime, this._flow);
      node.vel.addScaledVector(this._flow, this.config.curlStrength * dt);
      node.vel.multiplyScalar(dragFactor);
      node.vel.y += this.config.buoyancy * dt;
      node.pos.addScaledVector(node.vel, dt);
      node.roll += node.rollVel * dt;
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

    while (this.activeCount > 0 && this.nodes[this.activeCount - 1]!.age >= this.nodes[this.activeCount - 1]!.maxLife) {
      this.activeCount--;
    }

    let maxDensity = 0;
    for (let i = 0; i < this.activeCount; i++) {
      if (this.nodes[i]!.density > maxDensity) maxDensity = this.nodes[i]!.density;
    }
    if (maxDensity < 0.004) {
      this.activeCount = 0;
    }
  }

  public collectBillows(
    samples: SmokeBillowSample[],
    maxSamples: number,
    writeCursor: number,
    camPos: THREE.Vector3,
  ): number {
    const n = this.activeCount;
    if (n < 2) return writeCursor;

    let count = writeCursor;
    for (let i = 0; i < n && count < maxSamples; i++) {
      const node = this.nodes[i]!;
      if (node.density <= 0.004) continue;

      const uAge = Math.min(1, node.age / Math.max(0.01, node.maxLife));
      const grow = 1 - Math.pow(1 - uAge, 1.85);
      const scale = THREE.MathUtils.lerp(node.startWidth, node.endWidth, grow);

      const hasNext = i < n - 1;
      const segDist = hasNext
        ? node.pos.distanceTo(this.nodes[i + 1]!.pos)
        : node.pos.distanceTo(this.nodes[i - 1]!.pos);
      const spacingNorm = THREE.MathUtils.clamp(segDist / Math.max(0.04, scale * 0.2), 0.22, 1.0);
      const bulgeMag = scale * this.config.bulgeFactor * (0.04 + 0.2 * uAge);

      const sMain = samples[count++]!;
      sMain.x = node.pos.x + node.bulgeDir.x * bulgeMag;
      sMain.y = node.pos.y + node.bulgeDir.y * bulgeMag;
      sMain.z = node.pos.z + node.bulgeDir.z * bulgeMag;
      sMain.scale = scale;
      sMain.roll = node.roll;
      sMain.tileIdx = node.tileIdx;
      sMain.flipX = node.flipX;
      sMain.seed = node.seed;
      sMain.age = uAge;
      sMain.opacity = this.config.opacity * node.density * spacingNorm;
      sMain.flashGlow = node.flashGlow;
      sMain.flowCoord = node.flowCoord;
      const dx = camPos.x - sMain.x;
      const dy = camPos.y - sMain.y;
      const dz = camPos.z - sMain.z;
      sMain.distSq = dx * dx + dy * dy + dz * dz;

      // Catmull-Rom midpoint bridge lobe guarantees dense overlapping cloud cohesion without cotton balls
      if (hasNext && count < maxSamples) {
        const next = this.nodes[i + 1]!;
        if (next.density > 0.004 && segDist < 1.6) {
          const p0 = this.nodes[Math.max(0, i - 1)]!.pos;
          const p1 = node.pos;
          const p2 = next.pos;
          const p3 = this.nodes[Math.min(n - 1, i + 2)]!.pos;

          this._tmpMid.set(
            (-p0.x + 9 * p1.x + 9 * p2.x - p3.x) * 0.0625,
            (-p0.y + 9 * p1.y + 9 * p2.y - p3.y) * 0.0625,
            (-p0.z + 9 * p1.z + 9 * p2.z - p3.z) * 0.0625,
          );

          const uAgeNext = Math.min(1, next.age / Math.max(0.01, next.maxLife));
          const midAge = 0.5 * (uAge + uAgeNext);
          const midGrow = 1 - Math.pow(1 - midAge, 1.85);
          const midScale = THREE.MathUtils.lerp(
            0.5 * (node.startWidth + next.startWidth),
            0.5 * (node.endWidth + next.endWidth),
            midGrow,
          );
          const midDensity = 0.5 * (node.density + next.density);
          const midFlash = 0.5 * (node.flashGlow + next.flashGlow);

          this._tmpBulge.addVectors(node.bulgeDir, next.bulgeDir).multiplyScalar(-0.5);
          const midBulgeMag = midScale * this.config.bulgeFactor * (0.03 + 0.16 * midAge);

          const sBridge = samples[count++]!;
          sBridge.x = this._tmpMid.x + this._tmpBulge.x * midBulgeMag;
          sBridge.y = this._tmpMid.y + this._tmpBulge.y * midBulgeMag;
          sBridge.z = this._tmpMid.z + this._tmpBulge.z * midBulgeMag;
          sBridge.scale = midScale * 0.96;
          sBridge.roll = node.roll + 1.5707963;
          sBridge.tileIdx = (node.tileIdx + 1) & 3;
          sBridge.flipX = -node.flipX;
          sBridge.seed = (node.seed + 0.43) % 1;
          sBridge.age = midAge;
          sBridge.opacity = this.config.opacity * midDensity * spacingNorm * 0.82;
          sBridge.flashGlow = midFlash;
          sBridge.flowCoord = 0.5 * (node.flowCoord + next.flowCoord);
          const bdx = camPos.x - sBridge.x;
          const bdy = camPos.y - sBridge.y;
          const bdz = camPos.z - sBridge.z;
          sBridge.distSq = bdx * bdx + bdy * bdy + bdz * bdz;
        }
      }
    }

    return count;
  }
}

/**
 * Single-draw-call back-to-front sorted InstancedBufferGeometry renderer uniting multiple
 * viscous fluid smoke spines into continuous volumetric billowy clouds.
 */
export class VolumetricSmokePlumeSystem {
  private static readonly MAX_INSTANCES = 384;

  public readonly mesh: THREE.Mesh;

  private readonly scene: THREE.Scene;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  private readonly centerScaleAttr: THREE.InstancedBufferAttribute;
  private readonly spriteParamsAttr: THREE.InstancedBufferAttribute;
  private readonly smokeStateAttr: THREE.InstancedBufferAttribute;

  private readonly spines: SmokeFluidSpine[] = [];
  private readonly samples: SmokeBillowSample[] = [];
  private readonly sortIndices: number[] = [];

  constructor(
    scene: THREE.Scene,
    smokeAtlas: THREE.DataTexture,
    flowTex: THREE.DataTexture,
    litColor = 0xd2dce8,
    shadowColor = 0x505a68,
  ) {
    this.scene = scene;
    const maxInst = VolumetricSmokePlumeSystem.MAX_INSTANCES;

    for (let i = 0; i < maxInst; i++) {
      this.samples.push({
        x: 0,
        y: 0,
        z: 0,
        scale: 1,
        roll: 0,
        tileIdx: 0,
        flipX: 1,
        seed: 0,
        age: 0,
        opacity: 0,
        flashGlow: 0,
        flowCoord: 0,
        distSq: 0,
      });
      this.sortIndices.push(i);
    }

    const baseGeo = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = baseGeo.index!.clone();
    this.geometry.setAttribute('position', baseGeo.getAttribute('position').clone());
    this.geometry.setAttribute('uv', baseGeo.getAttribute('uv').clone());
    baseGeo.dispose();

    const centerScaleArr = new Float32Array(maxInst * 4);
    const spriteParamsArr = new Float32Array(maxInst * 4);
    const smokeStateArr = new Float32Array(maxInst * 4);

    this.centerScaleAttr = new THREE.InstancedBufferAttribute(centerScaleArr, 4);
    this.centerScaleAttr.setUsage(THREE.DynamicDrawUsage);
    this.spriteParamsAttr = new THREE.InstancedBufferAttribute(spriteParamsArr, 4);
    this.spriteParamsAttr.setUsage(THREE.DynamicDrawUsage);
    this.smokeStateAttr = new THREE.InstancedBufferAttribute(smokeStateArr, 4);
    this.smokeStateAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('aCenterScale', this.centerScaleAttr);
    this.geometry.setAttribute('aSpriteParams', this.spriteParamsAttr);
    this.geometry.setAttribute('aSmokeState', this.smokeStateAttr);
    this.geometry.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VOLUMETRIC_SMOKE_VERT,
      fragmentShader: VOLUMETRIC_SMOKE_FRAG,
      uniforms: {
        uSmokeAtlas: { value: smokeAtlas },
        uFlowTex: { value: flowTex },
        uTime: { value: 0 },
        uLitColor: { value: new THREE.Color(litColor) },
        uShadowColor: { value: new THREE.Color(shadowColor) },
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

  public addSpine(config: SmokeSpineConfig): SmokeFluidSpine {
    const spine = new SmokeFluidSpine(config);
    this.spines.push(spine);
    return spine;
  }

  public reset(): void {
    for (const spine of this.spines) {
      spine.reset();
    }
    this.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  public update(
    dt: number,
    camera: THREE.Camera,
    elapsedTime: number,
    flashOrigin: THREE.Vector3,
    flashIntensity: number,
    sampleFlowFn: (pos: THREE.Vector3, time: number, out: THREE.Vector3) => void,
  ): void {
    if (dt > 0) {
      for (const spine of this.spines) {
        spine.stepPhysics(dt, elapsedTime, flashOrigin, flashIntensity, sampleFlowFn);
      }
    }

    const maxInst = VolumetricSmokePlumeSystem.MAX_INSTANCES;
    let totalCount = 0;
    for (const spine of this.spines) {
      if (totalCount >= maxInst) break;
      totalCount = spine.collectBillows(this.samples, maxInst, totalCount, camera.position);
    }

    if (totalCount === 0) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return;
    }

    // Sort active billow indices back-to-front by distanceSq descending (insertion sort keeps O(N) on near-sorted frames)
    for (let i = 0; i < totalCount; i++) {
      this.sortIndices[i] = i;
    }
    const samples = this.samples;
    const indices = this.sortIndices;
    for (let i = 1; i < totalCount; i++) {
      const key = indices[i]!;
      const keyDist = samples[key]!.distSq;
      let j = i - 1;
      while (j >= 0 && samples[indices[j]!]!.distSq < keyDist) {
        indices[j + 1] = indices[j]!;
        j--;
      }
      indices[j + 1] = key;
    }

    const csArr = this.centerScaleAttr.array as Float32Array;
    const spArr = this.spriteParamsAttr.array as Float32Array;
    const stArr = this.smokeStateAttr.array as Float32Array;

    for (let slot = 0; slot < totalCount; slot++) {
      const s = samples[indices[slot]!]!;
      const off = slot * 4;

      csArr[off] = s.x;
      csArr[off + 1] = s.y;
      csArr[off + 2] = s.z;
      csArr[off + 3] = s.scale;

      spArr[off] = s.roll;
      spArr[off + 1] = s.tileIdx;
      spArr[off + 2] = s.flipX;
      spArr[off + 3] = s.seed;

      stArr[off] = s.age;
      stArr[off + 1] = s.opacity;
      stArr[off + 2] = s.flashGlow;
      stArr[off + 3] = s.flowCoord;
    }

    this.centerScaleAttr.needsUpdate = true;
    this.spriteParamsAttr.needsUpdate = true;
    this.smokeStateAttr.needsUpdate = true;
    this.geometry.instanceCount = totalCount;

    this.material.uniforms.uTime!.value = elapsedTime;
    this.mesh.visible = true;
  }

  public dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
