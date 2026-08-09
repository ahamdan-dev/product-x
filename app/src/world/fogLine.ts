/**
 * The Fog Line — the product's signature visual.
 *
 * A thin band of drifting grain sits at the exact height of a district's `estimateConfidence`.
 * Below it the world is solid material. Above it, geometry dissolves into fog.
 *
 * This encodes the hardest idea in the source material as a physical property rather than a
 * tooltip: the difference between "you are weak here" and "I don't know whether you're strong here."
 * A tall district with a low fog line reads as "you've built a lot and I still can't verify it."
 *
 * Cost: one shader on one plane per visible district. No particles, no post-processing, resolution
 * independent. Two octaves of value noise with a domain warp — enough structure to read as
 * atmosphere, cheap enough to run on integrated graphics.
 */

import * as THREE from 'three';

export const fogLineVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const fogLineFragmentShader = /* glsl */ `
  precision mediump float;

  uniform float uTime;
  uniform float uConfidence;   // 0..1 — where the line sits
  uniform float uBandWidth;    // thickness of the transition band, in uv units
  uniform vec3  uFogColor;
  uniform vec3  uLightColor;   // the iodine glow that appears as fog burns off
  uniform float uBurn;         // 0..1 — animates a descent when new evidence lands
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vWorldPos;

  // Cheap hash-based value noise. Two octaves is plenty at this scale.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);      // smoothstep interpolant
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    return noise(p) * 0.62 + noise(p * 2.17 + 4.3) * 0.38;
  }

  void main() {
    // Domain warp: displace the sample point by another noise lookup. This is what turns
    // flat static into something that reads as moving vapour rather than TV snow.
    vec2 drift = vec2(uTime * 0.04, uTime * 0.017);
    vec2 warp  = vec2(fbm(vUv * 2.4 + drift), fbm(vUv * 2.4 + drift + 11.7));
    float n    = fbm(vUv * 4.6 + warp * 0.55 + drift);

    // The line itself. Below uConfidence: nothing. Above: fog ramps in.
    // Noise perturbs the boundary so it never reads as a straight CSS edge.
    float line   = uConfidence + (n - 0.5) * uBandWidth * 1.6;
    float above  = smoothstep(line, line + uBandWidth, vUv.y);

    // The burn: an evidence event sweeps the line downward, and the sweep front glows.
    float front  = smoothstep(0.0, 0.06, abs(vUv.y - line)) ;
    float glow   = (1.0 - front) * uBurn;

    // Silhouette falloff. This plane is a billboard, so without it the fog has a rectangle's own
    // outline — which reads as a grey slab pasted over the district rather than as atmosphere
    // sitting in it. Worst at low confidence, where the whole quad is "above the line": that is
    // precisely the unformed case, and it must read as haze, not as a bar.
    float sides = smoothstep(0.0, 0.30, vUv.x) * smoothstep(0.0, 0.30, 1.0 - vUv.x);
    // The top thins rather than truncating — fog has no ceiling in the real world either.
    float crown = mix(1.0, 0.34, smoothstep(0.55, 1.0, vUv.y));

    float density = above * (0.45 + n * 0.55) * sides * crown;
    vec3  col     = mix(uFogColor, uLightColor, clamp(glow * 1.4, 0.0, 1.0));

    float alpha = density * uOpacity + glow * 0.35 * sides;
    if (alpha < 0.004) discard;                       // early-out, saves fill rate
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export interface FogLineOptions {
  confidence: number;
  fogColor: THREE.ColorRepresentation;
  lightColor: THREE.ColorRepresentation;
  bandWidth?: number;
  opacity?: number;
}

export function createFogLineMaterial(opts: FogLineOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: fogLineVertexShader,
    fragmentShader: fogLineFragmentShader,
    transparent: true,
    depthWrite: false,           // fog must not occlude the geometry behind it
    side: THREE.DoubleSide,
    uniforms: {
      uTime:        { value: 0 },
      uConfidence:  { value: clamp01(opts.confidence) },
      uBandWidth:   { value: opts.bandWidth ?? 0.16 },
      uFogColor:    { value: new THREE.Color(opts.fogColor) },
      uLightColor:  { value: new THREE.Color(opts.lightColor) },
      uBurn:        { value: 0 },
      uOpacity:     { value: opts.opacity ?? 0.82 },
    },
  });
}

/**
 * Drive the burn animation. Call once when evidence lands; then advance it each frame.
 * The line descends to its new value while the front glows, then the glow fades.
 */
export class FogBurn {
  private from: number;
  private to: number;
  private elapsed = 0;
  private readonly duration: number;
  private running = false;

  /**
   * Uniform slots are resolved once, in the constructor, and held as direct references.
   * Three's `uniforms` is an index signature, so every `uniforms.uBurn.value` in a hot loop is both
   * an unchecked access the compiler rightly rejects and a repeated property lookup. Binding them
   * here fails loudly at construction if the material isn't ours, instead of silently no-op'ing the
   * animation at runtime — which would look like "the fog just doesn't move" with nothing to debug.
   */
  private readonly uTime: THREE.IUniform<number>;
  private readonly uConfidence: THREE.IUniform<number>;
  private readonly uBurn: THREE.IUniform<number>;

  constructor(material: THREE.ShaderMaterial, durationMs = 1800) {
    this.duration = durationMs;
    this.uTime = bind(material, 'uTime');
    this.uConfidence = bind(material, 'uConfidence');
    this.uBurn = bind(material, 'uBurn');
    this.from = this.uConfidence.value;
    this.to = this.from;
  }

  /** Start a descent to a new confidence value. Ignores upward moves under 1% as noise. */
  start(newConfidence: number): boolean {
    const target = clamp01(newConfidence);
    const current = this.uConfidence.value;
    if (Math.abs(target - current) < 0.01) return false;
    this.from = current;
    this.to = target;
    this.elapsed = 0;
    this.running = true;
    return true;
  }

  /** Advance. Returns true while still animating. */
  update(deltaMs: number, timeSeconds: number): boolean {
    this.uTime.value = timeSeconds;
    if (!this.running) {
      // Ambient drift continues even when nothing is burning — the fog is always alive.
      this.uBurn.value *= 0.92;
      return false;
    }
    this.elapsed += deltaMs;
    const t = Math.min(1, this.elapsed / this.duration);
    // Matches the house curve: fast out, long settle.
    const eased = easeOutQuint(t);
    this.uConfidence.value = this.from + (this.to - this.from) * eased;
    // Glow peaks mid-sweep and fades — the light is the *event*, not a permanent decoration.
    this.uBurn.value = Math.sin(t * Math.PI);
    if (t >= 1) {
      this.running = false;
      this.uBurn.value = 0;
      return false;
    }
    return true;
  }

  get isRunning(): boolean { return this.running; }
}

/** Resolve one numeric uniform, or fail with a name you can actually act on. */
function bind(material: THREE.ShaderMaterial, name: string): THREE.IUniform<number> {
  const u = material.uniforms[name] as THREE.IUniform<number> | undefined;
  if (!u) throw new Error(`fogLine: material is missing uniform "${name}"`);
  return u;
}

function easeOutQuint(t: number): number { return 1 - Math.pow(1 - t, 5); }
function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }
