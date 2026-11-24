export const FIREBALL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const FIREBALL_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uTileOffset;
uniform float uFlipX;
uniform float uAge;
uniform float uOpacity;
varying vec2 vUv;

vec3 blackbodyRamp(float t) {
  vec3 ember  = vec3(0.70, 0.08, 0.01) * 1.15;
  vec3 orange = vec3(1.00, 0.36, 0.04) * 1.45;
  vec3 gold   = vec3(1.00, 0.82, 0.28) * 1.95;
  vec3 white  = vec3(1.00, 0.99, 0.94) * 2.90;

  vec3 col = mix(ember, orange, smoothstep(0.05, 0.34, t));
  col = mix(col, gold, smoothstep(0.34, 0.68, t));
  col = mix(col, white, smoothstep(0.68, 1.08, t));
  return col;
}

void main() {
  vec2 centered = vUv - 0.5;
  // Subtle turbulent outward puff expansion over lifespan
  vec2 localUv = 0.5 + centered * (1.0 - 0.14 * uAge);
  if (uFlipX < 0.0) {
    localUv.x = 1.0 - localUv.x;
  }
  localUv = clamp(localUv, vec2(0.025), vec2(0.975));
  vec4 tex = texture2D(uAtlas, uTileOffset + localUv * 0.5);

  float core = tex.r;
  float detail = tex.g;
  float outer = tex.b;
  float mask = tex.a;

  // Dissolve edge slightly with age while inner core stays incandescent longest
  float cut = smoothstep(uAge * 0.55, uAge * 0.55 + 0.32, outer * 0.82 + detail * 0.42);
  float alpha = mask * cut * pow(max(0.0, 1.0 - uAge), 1.35) * uOpacity;
  if (alpha < 0.004) discard;

  float heat = clamp(core * (1.30 - uAge * 0.88) + detail * 0.34 - uAge * 0.36, 0.0, 1.45);
  vec3 col = blackbodyRamp(heat);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export const MUZZLE_JET_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const MUZZLE_JET_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uSeed;
uniform float uAge;
uniform float uOpacity;
varying vec2 vUv;

void main() {
  // vUv.x: 0 (barrel port) -> 1 (jet tip), vUv.y: 0..1 cross width
  float x = vUv.x;
  float dy = abs(vUv.y - 0.5) * 2.0;

  // Tapered soft flame envelope (widest near muzzle throat, pointed streak at tip)
  float taper = mix(0.65, 0.12, pow(x, 0.72));
  float radial = exp(-pow(dy / max(0.04, taper), 2.2)) * smoothstep(1.0, 0.72, dy);
  float axial = smoothstep(0.0, 0.07, x) * pow(max(0.0, 1.0 - x), 1.25);

  vec2 noiseUv = clamp(vec2(fract(x * 0.85 - uAge * 0.35 + uSeed), fract(vUv.y * 0.8 + uSeed * 1.7)), vec2(0.025), vec2(0.475));
  float turb = texture2D(uAtlas, noiseUv).g;

  float intensity = axial * radial * (0.68 + turb * 0.68) * pow(max(0.0, 1.0 - uAge), 1.2) * uOpacity;
  if (intensity < 0.004) discard;

  vec3 hotCore = vec3(1.0, 0.98, 0.90) * 2.7;
  vec3 orangeTail = vec3(1.0, 0.42, 0.06) * 1.5;
  vec3 col = mix(orangeTail, hotCore, smoothstep(0.65, 0.05, x) * smoothstep(0.65, 0.0, dy));
  gl_FragColor = vec4(col * intensity, intensity);
}
`;

export const SMOKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SMOKE_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uTileOffset;
uniform float uFlipX;
uniform float uErode;
uniform float uOpacity;
uniform float uFlashGlow;
uniform float uTime;
uniform float uFlowSeed;
uniform vec3 uLitColor;
uniform vec3 uShadowColor;
varying vec2 vUv;

void main() {
  vec2 localUv = vec2(uFlipX < 0.0 ? 1.0 - vUv.x : vUv.x, vUv.y);

  // Dual-layer internal advection: sample tile (0,0) G-channel safely to churn smoke internally
  vec2 advUv1 = 0.04 + fract(localUv * 0.72 + vec2(uTime * 0.11 + uFlowSeed, -uTime * 0.16 + uFlowSeed * 0.63)) * 0.42;
  vec2 advUv2 = 0.04 + fract(localUv * 0.58 + vec2(-uTime * 0.09 + uFlowSeed * 1.37, -uTime * 0.21)) * 0.42;
  float churnX = texture2D(uAtlas, advUv1).g - 0.5;
  float churnY = texture2D(uAtlas, advUv2).g - 0.5;
  localUv = clamp(localUv + vec2(churnX, churnY) * 0.095, vec2(0.025), vec2(0.975));

  vec4 tex = texture2D(uAtlas, uTileOffset + localUv * 0.5);

  float density = tex.r;
  float wisp = tex.g;
  float topShade = tex.b;
  float alphaMask = tex.a;

  // Broad feathered organic breakup so adjacent parcels fuse into a continuous stream
  float eroded = smoothstep(uErode, uErode + 0.60, density * 0.80 + wisp * 0.42) * alphaMask;
  float alpha = eroded * uOpacity;
  if (alpha < 0.004) discard;

  float shadeMix = clamp(topShade * 0.85 + vUv.y * 0.25, 0.0, 1.0);
  vec3 col = mix(uShadowColor, uLitColor, shadeMix);

  // Warm orange-gold subsurface scatter while muzzle flash is active
  if (uFlashGlow > 0.002) {
    vec3 blastLight = vec3(1.0, 0.48, 0.12) * uFlashGlow * (0.45 + 0.85 * (1.0 - density));
    col += blastLight;
  }

  gl_FragColor = vec4(col, alpha);
}
`;

export const SPARK_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SPARK_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uHeat;
uniform float uOpacity;
varying vec2 vUv;

void main() {
  vec4 tex = texture2D(uTex, vUv);
  float alpha = tex.a * uOpacity;
  if (alpha < 0.004) discard;

  vec3 ember = vec3(1.0, 0.30, 0.04) * 1.85;
  vec3 whiteHot = vec3(1.0, 0.97, 0.80) * 3.1;
  vec3 col = mix(ember, whiteHot, clamp(tex.r * uHeat, 0.0, 1.0));
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export { SMOKE_RIBBON_FRAG, SMOKE_RIBBON_VERT } from './smokeRibbon';
