import * as THREE from 'three';
import type { GunVfxPreset } from './presets';
import type { RgbaImageData } from './textures';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function hash2(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2.04;
  }
  return sum / norm;
}

function billowFbm2(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = noise2(x * freq, y * freq, seed + i * 47);
    sum += amp * (1 - Math.abs(n * 2 - 1));
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

function twoStageWarpedFbm(x: number, y: number, seed: number): number {
  const qx = fbm2(x + 1.3, y + 4.7, seed + 13, 4) - 0.5;
  const qy = fbm2(x + 6.9, y + 2.1, seed + 29, 4) - 0.5;
  const rx = fbm2(x + qx * 1.45 + 3.1, y + qy * 1.45 + 0.7, seed + 53, 4) - 0.5;
  const ry = fbm2(x + qx * 1.45 + 5.4, y + qy * 1.45 + 4.2, seed + 79, 4) - 0.5;
  return fbm2(x + rx * 1.15, y + ry * 1.15, seed + 109, 5);
}

interface SubLobeSpec {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

const TILE_LOBES: readonly SubLobeSpec[][] = [
  [
    { cx: 0.48, cy: 0.52, rx: 0.27, ry: 0.25 },
    { cx: 0.63, cy: 0.44, rx: 0.21, ry: 0.23 },
    { cx: 0.36, cy: 0.39, rx: 0.20, ry: 0.19 },
    { cx: 0.53, cy: 0.66, rx: 0.22, ry: 0.19 },
  ],
  [
    { cx: 0.52, cy: 0.49, rx: 0.26, ry: 0.26 },
    { cx: 0.37, cy: 0.56, rx: 0.21, ry: 0.22 },
    { cx: 0.64, cy: 0.59, rx: 0.19, ry: 0.19 },
    { cx: 0.45, cy: 0.34, rx: 0.21, ry: 0.18 },
  ],
  [
    { cx: 0.49, cy: 0.47, rx: 0.26, ry: 0.25 },
    { cx: 0.62, cy: 0.38, rx: 0.22, ry: 0.20 },
    { cx: 0.35, cy: 0.48, rx: 0.19, ry: 0.22 },
    { cx: 0.58, cy: 0.63, rx: 0.20, ry: 0.20 },
  ],
  [
    { cx: 0.51, cy: 0.53, rx: 0.25, ry: 0.26 },
    { cx: 0.39, cy: 0.37, rx: 0.22, ry: 0.21 },
    { cx: 0.65, cy: 0.49, rx: 0.19, ry: 0.21 },
    { cx: 0.43, cy: 0.65, rx: 0.20, ry: 0.18 },
  ],
];

function evalLobeField(u: number, v: number, lobes: readonly SubLobeSpec[]): number {
  let maxField = 0;
  let softSum = 0;
  for (let i = 0; i < lobes.length; i++) {
    const l = lobes[i]!;
    const dx = (u - l.cx) / l.rx;
    const dy = (v - l.cy) / l.ry;
    const d = Math.hypot(dx, dy);
    const f = smoothstep(1.38, 0.18, d);
    if (f > maxField) maxField = f;
    softSum += f * f;
  }
  return clamp01(maxField * 0.72 + Math.sqrt(softSum * 0.45) * 0.42);
}

/**
 * Generates a 2x2 high-contrast, deeply sculpted asymmetric cauliflower gunsmoke burst atlas.
 * R: cauliflower ridge density, G: curly wispy filaments, B: volumetric relief lighting, A: silhouette mask.
 */
export function createGunsmokeBurstAtlasPixels(tileSize = 256): RgbaImageData {
  const width = tileSize * 2;
  const height = tileSize * 2;
  const data = new Uint8Array(width * height * 4);

  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const tileIdx = ty * 2 + tx;
      const seed = 1103 + tileIdx * 193;
      const lobes = TILE_LOBES[tileIdx]!;
      const x0 = tx * tileSize;
      const y0 = ty * tileSize;

      for (let py = 0; py < tileSize; py++) {
        const v = (py + 0.5) / tileSize;
        for (let px = 0; px < tileSize; px++) {
          const u = (px + 0.5) / tileSize;

          const warpScale = 3.3;
          const macroCloud = twoStageWarpedFbm(u * warpScale + tx * 4.7, v * warpScale + ty * 5.3, seed);
          const fineCurl = billowFbm2(
            u * 6.8 + macroCloud * 1.35 + tx * 3.1,
            v * 6.8 - macroCloud * 1.15 + ty * 2.9,
            seed + 61,
            4,
          );
          const wispDetail = billowFbm2(u * 12.5 - fineCurl * 0.8, v * 12.5 + macroCloud * 0.9, seed + 149, 3);

          const baseField = evalLobeField(u, v, lobes);
          const sculpted = baseField + (macroCloud - 0.5) * 0.52 + (fineCurl - 0.5) * 0.26 - 0.14;
          const borderFade = smoothstep(0.95, 0.66, Math.max(Math.abs(u * 2 - 1), Math.abs(v * 2 - 1)));

          const alphaMask = clamp01(Math.pow(smoothstep(0.04, 0.88, sculpted), 1.35) * borderFade);
          const ridgeDensity = clamp01(smoothstep(0.10, 0.88, sculpted) * (0.42 + macroCloud * 0.44 + fineCurl * 0.32));
          const filamentVal = clamp01((fineCurl * 0.62 + wispDetail * 0.44) * smoothstep(0.04, 0.55, sculpted));

          // Multi-tap finite difference lighting relief for authentic 3D cauliflower depth pockets
          const eps = 0.022;
          const sUp =
            evalLobeField(u, v + eps, lobes) +
            (twoStageWarpedFbm(u * warpScale + tx * 4.7, (v + eps) * warpScale + ty * 5.3, seed) - 0.5) * 0.52;
          const sRight =
            evalLobeField(u + eps, v, lobes) +
            (twoStageWarpedFbm((u + eps) * warpScale + tx * 4.7, v * warpScale + ty * 5.3, seed) - 0.5) * 0.52;
          const gradLight = (sUp - sculpted) * 2.4 + (sRight - sculpted) * 1.1;
          const reliefLight = clamp01(0.46 + gradLight + (macroCloud - 0.48) * 0.52 + (v - 0.5) * 0.28);

          const o = ((y0 + py) * width + (x0 + px)) * 4;
          data[o] = Math.round(ridgeDensity * 255);
          data[o + 1] = Math.round(filamentVal * 255);
          data[o + 2] = Math.round(reliefLight * 255);
          data[o + 3] = Math.round(alphaMask * 255);
        }
      }
    }
  }

  return { width, height, data };
}

export const GUNSMOKE_BURST_VERT = /* glsl */ `
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

export const GUNSMOKE_BURST_FRAG = /* glsl */ `
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

  if (opacity < 0.003 || age >= 0.998) discard;

  float tileIdx = floor(vSpriteParams.y + 0.5);
  float flipX = vSpriteParams.z;
  float seed = vSpriteParams.w;

  // Coherent world turbulence + progressive age-driven curl expansion
  vec2 worldUvA = vec2(vWorldPos.x * 0.42 + vWorldPos.z * 0.27 + seed, vWorldPos.y * 0.46 - uTime * 0.22);
  vec2 worldUvB = vec2(vWorldPos.z * 0.55 - vWorldPos.x * 0.33 - seed * 1.7, vWorldPos.y * 0.58 - uTime * 0.34);
  vec4 wf1 = texture2D(uFlowTex, worldUvA);
  vec4 wf2 = texture2D(uFlowTex, worldUvB);

  float warpAmp = mix(0.03, 0.15, age);
  vec2 localUv = vec2(flipX < 0.0 ? 1.0 - vUv.x : vUv.x, vUv.y);
  localUv += vec2(wf1.r - 0.5, wf1.a - 0.5) * warpAmp + vec2(wf2.g - 0.5, wf2.b - 0.5) * (warpAmp * 0.55);
  localUv = clamp(localUv, vec2(0.025), vec2(0.975));

  vec2 tileOffset = vec2(mod(tileIdx, 2.0) * 0.5, floor(tileIdx * 0.5) * 0.5);
  vec4 atlas = texture2D(uSmokeAtlas, tileOffset + localUv * 0.5);

  float r = length((vUv - 0.5) * 2.0);
  float borderGuard = smoothstep(1.0, 0.42, r);

  // Peak crisp cauliflower early -> lacy internal wispy shredding -> soft airy dissipation
  float wispField = atlas.r * 0.44 + atlas.g * 0.24 + wf1.r * 0.22 + wf2.g * 0.24;
  float erodeLow = mix(0.08, 0.76, pow(age, 1.05));
  float breakup = smoothstep(erodeLow, erodeLow + 0.36, wispField);

  float birthFade = smoothstep(0.0, 0.035, age);
  float deathFade = pow(max(0.0, 1.0 - age), 1.45);

  float alpha = atlas.a * borderGuard * breakup * birthFade * deathFade * opacity;
  if (alpha < 0.004) discard;

  float relief = clamp(atlas.b * 0.68 + wf1.b * 0.20 + vWorldUp * 0.38 + 0.14, 0.0, 1.0);
  vec3 col = mix(uShadowColor, uLitColor, smoothstep(0.12, 0.90, relief));

  if (flashGlow > 0.002) {
    vec3 blastLight = vec3(1.0, 0.52, 0.15) * flashGlow * (0.45 + 0.90 * (1.0 - atlas.r * 0.72));
    col += blastLight;
  }

  gl_FragColor = vec4(col, alpha);
}
`;

export interface GunsmokeBurstParams {
  muzzlePos: THREE.Vector3;
  muzzleDir: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  preset: GunVfxPreset;
  scaleMul: number;
  ejectPos?: THREE.Vector3;
  ejectRight?: THREE.Vector3;
  ejectUp?: THREE.Vector3;
  flashGlow: number;
}

interface BurstPuff {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxLife: number;
  startScale: number;
  endScale: number;
  baseOpacity: number;
  drag: number;
  buoyancy: number;
  curlGain: number;
  roll: number;
  rollVel: number;
  tileIdx: number;
  flipX: number;
  seed: number;
  flashGlow: number;
  distSq: number;
}

/**
 * Single-draw-call instanced explosive gunsmoke burst system calibrated to real firearm blasts:
 * shoots crisp asymmetric cauliflower puffs on triggerShot() only (zero continuous hose),
 * breaks up via coherent curl advection, and reacts to consecutive muzzle blast wakes.
 */
export class GunsmokeBurstSystem {
  private static readonly MAX_PUFFS = 256;

  public readonly mesh: THREE.Mesh;

  private readonly scene: THREE.Scene;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  private readonly centerScaleAttr: THREE.InstancedBufferAttribute;
  private readonly spriteParamsAttr: THREE.InstancedBufferAttribute;
  private readonly smokeStateAttr: THREE.InstancedBufferAttribute;

  private readonly puffs: BurstPuff[] = [];
  private readonly activeIndices: number[] = [];
  private writeCursor = 0;

  private readonly _flow = new THREE.Vector3();
  private readonly _wakeToPuff = new THREE.Vector3();
  private readonly _wakeRadial = new THREE.Vector3();
  private readonly _tmpPos = new THREE.Vector3();
  private readonly _tmpVel = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    smokeAtlas: THREE.DataTexture,
    flowTex: THREE.DataTexture,
    litColor = 0xedf1f6,
    shadowColor = 0x5c6674,
  ) {
    this.scene = scene;
    const maxPuffs = GunsmokeBurstSystem.MAX_PUFFS;

    for (let i = 0; i < maxPuffs; i++) {
      this.puffs.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        maxLife: 0.45,
        startScale: 0.25,
        endScale: 1.2,
        baseOpacity: 0.55,
        drag: 6.4,
        buoyancy: 0.45,
        curlGain: 1.1,
        roll: 0,
        rollVel: 0,
        tileIdx: i & 3,
        flipX: 1,
        seed: 0,
        flashGlow: 0,
        distSq: 0,
      });
    }

    const baseGeo = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = baseGeo.index!.clone();
    this.geometry.setAttribute('position', baseGeo.getAttribute('position').clone());
    this.geometry.setAttribute('uv', baseGeo.getAttribute('uv').clone());
    baseGeo.dispose();

    this.centerScaleAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxPuffs * 4), 4);
    this.centerScaleAttr.setUsage(THREE.DynamicDrawUsage);
    this.spriteParamsAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxPuffs * 4), 4);
    this.spriteParamsAttr.setUsage(THREE.DynamicDrawUsage);
    this.smokeStateAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxPuffs * 4), 4);
    this.smokeStateAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('aCenterScale', this.centerScaleAttr);
    this.geometry.setAttribute('aSpriteParams', this.spriteParamsAttr);
    this.geometry.setAttribute('aSmokeState', this.smokeStateAttr);
    this.geometry.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      vertexShader: GUNSMOKE_BURST_VERT,
      fragmentShader: GUNSMOKE_BURST_FRAG,
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

  public spawnShotBurst(params: GunsmokeBurstParams): void {
    const { muzzlePos, muzzleDir, right, up, preset: p, scaleMul: s, flashGlow } = params;

    // 1. Blast shockwave disturbs & scatters any still-fading wisps from prior rapid shots
    this.applyBlastWake(muzzlePos, muzzleDir, p.smokeWakePush * s, 2.3 * s, flashGlow * 0.55);

    // 2. Primary nested explosive cauliflower burst lobes at muzzle throat
    const coreCount = Math.max(1, p.blastSmokeCount);
    const basePhi = Math.random() * Math.PI * 2;

    for (let i = 0; i < coreCount; i++) {
      const isHero = i === 0;
      const phi = basePhi + ((i - 1) / Math.max(1, coreCount - 1)) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
      const rad = isHero ? 0.03 * s : (0.05 + Math.random() * 0.08) * s;
      const fwdDist = isHero ? 0.14 * s : (0.10 + Math.random() * 0.22) * s;

      this._tmpPos
        .copy(muzzlePos)
        .addScaledVector(muzzleDir, fwdDist)
        .addScaledVector(right, Math.cos(phi) * rad)
        .addScaledVector(up, Math.sin(phi) * rad);

      const fwdSpeed = p.smokeJetSpeed * (isHero ? 1.12 : 0.72 + Math.random() * 0.45) * s;
      const radialSpeed = isHero ? 0.18 * s : (0.95 + Math.random() * 1.15) * s;

      this._tmpVel
        .copy(muzzleDir)
        .multiplyScalar(fwdSpeed)
        .addScaledVector(right, Math.cos(phi) * radialSpeed)
        .addScaledVector(up, Math.sin(phi) * radialSpeed);
      this._tmpVel.y += (0.28 + Math.random() * 0.25) * s;

      const life = p.smokeLifeMin + Math.random() * (p.smokeLifeMax - p.smokeLifeMin);
      const startScale = p.smokeStartScale * (isHero ? 1.08 : 0.78 + Math.random() * 0.34) * s;
      const endScale = p.smokeEndScale * (isHero ? 1.05 : 0.76 + Math.random() * 0.36) * s;
      const opacity = p.smokeOpacity * (isHero ? 1.0 : 0.72 + Math.random() * 0.22);

      this.allocPuff(
        this._tmpPos,
        this._tmpVel,
        life * (isHero ? 1.04 : 0.85 + Math.random() * 0.25),
        startScale,
        endScale,
        opacity,
        p.smokeDrag * (isHero ? 0.94 : 0.96 + Math.random() * 0.16),
        p.smokeBuoyancy,
        1.15,
        flashGlow * (isHero ? 1.0 : 0.82),
      );
    }

    // 3. Crisp twin muzzle-brake side vent puffs
    if (p.baffleStrength > 0.15 && p.baffleSmokeCount > 0) {
      for (const sideSign of [-1, 1] as const) {
        for (let k = 0; k < p.baffleSmokeCount; k++) {
          this._tmpPos
            .copy(muzzlePos)
            .addScaledVector(muzzleDir, (-0.06 - k * 0.04) * s)
            .addScaledVector(right, sideSign * (0.10 + k * 0.05) * s)
            .addScaledVector(up, (Math.random() - 0.5) * 0.05 * s);

          this._tmpVel
            .copy(right)
            .multiplyScalar(sideSign * p.smokeJetSpeed * (0.72 + Math.random() * 0.25) * s)
            .addScaledVector(muzzleDir, -0.22 * p.smokeJetSpeed * s)
            .addScaledVector(up, (Math.random() - 0.4) * 0.85 * s);
          this._tmpVel.y += 0.25 * s;

          this.allocPuff(
            this._tmpPos,
            this._tmpVel,
            p.smokeLifeMin * (0.64 + Math.random() * 0.20),
            p.smokeStartScale * 0.65 * s,
            p.smokeEndScale * 0.56 * s,
            p.smokeOpacity * 0.72 * p.baffleStrength,
            p.smokeDrag * 1.15,
            p.smokeBuoyancy * 0.9,
            0.9,
            flashGlow * 0.78,
          );
        }
      }
    }

    // 4. Delicate brief breech wisp accompanying shell ejection
    if (params.ejectPos && params.ejectRight) {
      this._tmpVel
        .copy(params.ejectRight)
        .multiplyScalar(0.95 * s)
        .addScaledVector(params.ejectUp ?? up, 0.55 * s);
      this.allocPuff(
        params.ejectPos,
        this._tmpVel,
        0.34,
        0.13 * s,
        0.44 * s,
        0.28,
        5.5,
        0.48,
        0.8,
        flashGlow * 0.22,
      );
    }
  }

  private allocPuff(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    maxLife: number,
    startScale: number,
    endScale: number,
    baseOpacity: number,
    drag: number,
    buoyancy: number,
    curlGain: number,
    flashGlow: number,
  ): void {
    const maxPuffs = GunsmokeBurstSystem.MAX_PUFFS;
    let slot = -1;
    for (let k = 0; k < maxPuffs; k++) {
      const idx = (this.writeCursor + k) % maxPuffs;
      if (!this.puffs[idx]!.active) {
        slot = idx;
        this.writeCursor = (idx + 1) % maxPuffs;
        break;
      }
    }
    if (slot === -1) {
      slot = this.writeCursor;
      this.writeCursor = (slot + 1) % maxPuffs;
    }

    const puff = this.puffs[slot]!;
    puff.active = true;
    puff.pos.copy(pos);
    puff.vel.copy(vel);
    puff.age = 0;
    puff.maxLife = Math.max(0.08, maxLife);
    puff.startScale = startScale;
    puff.endScale = endScale;
    puff.baseOpacity = baseOpacity;
    puff.drag = drag;
    puff.buoyancy = buoyancy;
    puff.curlGain = curlGain;
    puff.roll = Math.random() * Math.PI * 2;
    puff.rollVel = (Math.random() - 0.5) * 1.65;
    puff.tileIdx = Math.floor(Math.random() * 4);
    puff.flipX = Math.random() < 0.5 ? -1 : 1;
    puff.seed = Math.random();
    puff.flashGlow = flashGlow;
    puff.distSq = 0;
  }

  private applyBlastWake(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    pushStrength: number,
    maxDist: number,
    flashKick: number,
  ): void {
    const maxDistSq = maxDist * maxDist;
    for (let i = 0; i < this.puffs.length; i++) {
      const puff = this.puffs[i]!;
      if (!puff.active) continue;

      this._wakeToPuff.subVectors(puff.pos, origin);
      const distSq = this._wakeToPuff.lengthSq();
      if (distSq >= maxDistSq) continue;

      const dist = Math.sqrt(distSq);
      const axialProj = this._wakeToPuff.dot(dir);
      const fwdDot = axialProj / Math.max(0.05, dist);
      if (fwdDot <= -0.15) continue;

      const falloff = Math.pow(Math.max(0, 1 - dist / maxDist), 1.35) * (0.4 + 0.6 * Math.max(0, fwdDot));
      puff.vel.addScaledVector(dir, falloff * pushStrength);

      this._wakeRadial.copy(this._wakeToPuff).addScaledVector(dir, -axialProj);
      const rLen = this._wakeRadial.length();
      if (rLen > 1e-4) {
        puff.vel.addScaledVector(this._wakeRadial, (falloff * 0.55 * pushStrength) / rLen);
      }
      puff.flashGlow = Math.max(puff.flashGlow, flashKick * falloff);
    }
  }

  public reset(): void {
    for (let i = 0; i < this.puffs.length; i++) {
      this.puffs[i]!.active = false;
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
    this.activeIndices.length = 0;
    const camPos = camera.position;

    for (let i = 0; i < this.puffs.length; i++) {
      const puff = this.puffs[i]!;
      if (!puff.active) continue;

      if (dt > 0) {
        puff.age += dt;
        if (puff.age >= puff.maxLife) {
          puff.active = false;
          continue;
        }

        sampleFlowFn(puff.pos, elapsedTime, this._flow);
        puff.vel.addScaledVector(this._flow, puff.curlGain * dt);
        puff.vel.multiplyScalar(Math.exp(-puff.drag * dt));
        puff.vel.y += puff.buoyancy * dt;
        puff.pos.addScaledVector(puff.vel, dt);

        puff.roll += puff.rollVel * dt;
        puff.rollVel *= Math.exp(-3.5 * dt);
        puff.flashGlow *= Math.exp(-26 * dt);

        if (flashIntensity > 0.01) {
          const dSq = puff.pos.distanceToSquared(flashOrigin);
          if (dSq < 6.25) {
            const prox = 1 - dSq / 6.25;
            puff.flashGlow = Math.max(puff.flashGlow, flashIntensity * prox * 0.85);
          }
        }
      }

      const dx = camPos.x - puff.pos.x;
      const dy = camPos.y - puff.pos.y;
      const dz = camPos.z - puff.pos.z;
      puff.distSq = dx * dx + dy * dy + dz * dz;
      this.activeIndices.push(i);
    }

    const totalCount = this.activeIndices.length;
    if (totalCount === 0) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return;
    }

    // Back-to-front sort by distanceSq descending
    for (let i = 1; i < totalCount; i++) {
      const key = this.activeIndices[i]!;
      const keyDist = this.puffs[key]!.distSq;
      let j = i - 1;
      while (j >= 0 && this.puffs[this.activeIndices[j]!]!.distSq < keyDist) {
        this.activeIndices[j + 1] = this.activeIndices[j]!;
        j--;
      }
      this.activeIndices[j + 1] = key;
    }

    const csArr = this.centerScaleAttr.array as Float32Array;
    const spArr = this.spriteParamsAttr.array as Float32Array;
    const stArr = this.smokeStateAttr.array as Float32Array;

    for (let slot = 0; slot < totalCount; slot++) {
      const p = this.puffs[this.activeIndices[slot]!]!;
      const uAge = Math.min(1, p.age / p.maxLife);
      // Fast explosive blast expansion in the first ~100ms, then gently drifts out
      const grow = 1 - Math.pow(1 - uAge, 2.75);
      const scale = THREE.MathUtils.lerp(p.startScale, p.endScale, grow);

      const off = slot * 4;
      csArr[off] = p.pos.x;
      csArr[off + 1] = p.pos.y;
      csArr[off + 2] = p.pos.z;
      csArr[off + 3] = scale;

      spArr[off] = p.roll;
      spArr[off + 1] = p.tileIdx;
      spArr[off + 2] = p.flipX;
      spArr[off + 3] = p.seed;

      stArr[off] = uAge;
      stArr[off + 1] = p.baseOpacity;
      stArr[off + 2] = p.flashGlow;
      stArr[off + 3] = 0;
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
