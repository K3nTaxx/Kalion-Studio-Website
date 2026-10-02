import * as THREE from 'three';
import gsap from 'gsap';

/* =====================================================================
   Liquid glass typography
   ---------------------------------------------------------------------
   The "Kalion Studio" lockup is a liquid-glass surface (metaball field made of a
   blurred text mask + gaussian droplets). Droplets merge with the letters
   (gooey), the surface refracts a softly lit background with chromatic
   dispersion, and the whole thing is driven by the cursor and the scroll:
     hero  : a big drop falls onto the word, splashes and swallows it,
     portal: then opens like a lens onto the next section.
   Coordinates ("p-space"): x ∈ [-aspect/2, aspect/2], y ∈ [-0.5, 0.5].
   ===================================================================== */

// droplet slots: 0 cursor · 1 hero drop · 2-5 ambient · 6-11 click splash · 12-19 impact splash
const MAX = 20;
const WORD = 'Kalion';
const SUB = 'Studio';
const SUB_SCALE = 0.36; // "Studio" size relative to "Kalion"
const SUB_OFFSET = 0.72; // "Studio" starts at 72 % of the "Kalion" width (staircase)

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uText;
uniform vec2 uRes;
uniform float uAspect;
uniform float uTime;
uniform vec4 uBlobs[${MAX}];
uniform int uN;        // the droplet slots in use: 0 .. uN-1 (the others are empty)
uniform vec2 uL[4];    // the light rig's four lights (they only depend on the time: see update)
uniform vec2 uStretch;
uniform float uTextShift;
uniform float uTextScale;
uniform float uTextW;
uniform float uMelt;
uniform vec2 uDropShape;
uniform float uPull;
uniform vec2 uPullC;
uniform vec4 uWave;
uniform vec4 uImpact;
uniform float uWobble;
uniform float uPortal;
uniform float uBevel;
uniform vec2 uSweep;   // the opening: the letters appear behind this front (x, softness)
uniform vec3 uDot;     // the dot of the "i" (text space x, y, radius)
uniform float uDotTint; // 1: that dot is an ember glass bead, as on the logo (dev visuals; 0 on the site)
uniform float uCutout;  // 1: the glass and its shadow alone, on transparency (dev visuals; 0 on the site)

const vec3 INK = vec3(0.063, 0.047, 0.039);
const vec3 IVORY = vec3(0.925, 0.902, 0.863);
const vec3 EMBER = vec3(1.0, 0.357, 0.141);
const vec3 COOL = vec3(0.64, 0.73, 0.95);
const vec3 AMBER = vec3(1.0, 0.56, 0.3);
const float T = 0.5;

vec2 ripple(vec2 q, vec4 w, float reach, float freq, float width) {
  if (w.w == 0.0 || w.z >= 1.0) return vec2(0.0); // (no wave, or it has died out: exactly what the formula gives)
  vec2 d = q - w.xy;
  float l = length(d) + 1e-5;
  float ring = w.z * reach;
  return d / l * sin((l - ring) * freq) * exp(-abs(l - ring) * width) * w.w * (1.0 - w.z);
}

vec2 warp(vec2 p, float m) {
  vec2 q = uPullC + (p - uPullC) * (1.0 + uPull * uPull * 3.2) / uTextScale;
  // click shockwave + the big splash when the drop lands on the word
  q += ripple(q, uWave, 0.95, 55.0, 15.0);
  q += ripple(q, uImpact, 1.25, 30.0, 7.0);
  // liquid shimmer around the cursor drop
  vec2 dc = q - uBlobs[0].xy;
  float cw = exp(-dot(dc, dc) * 20.0) * uWobble;
  q += vec2(sin(q.y * 70.0 + uTime * 4.0), cos(q.x * 60.0 - uTime * 3.2)) * 0.0045 * cw;
  // drip while melting
  q.y += m * (0.02 + 0.014 * sin(q.x * 21.0 + uTime * 0.8));
  return q;
}

// the opening's front: it runs along the word, "Kalion" then "Studio" (one step lower)
float sweep(vec2 p) {
  return smoothstep(uSweep.x + uSweep.y, uSweep.x - uSweep.y, p.x - 1.5 * (p.y - uTextShift));
}

float textAt(vec2 p, float m) {
  if (uTextW <= 0.0) return 0.0; // (the word swallowed: exactly what the formula gives)
  vec2 q = warp(p, m);
  vec2 uv = vec2(q.x / uAspect + 0.5, q.y - uTextShift + 0.5);
  vec2 t = texture2D(uText, uv).rg;
  return mix(t.r, min(t.g * 1.9, 1.0), m) * uTextW * sweep(p);
}

float textSoft(vec2 p) {
  if (uTextW <= 0.0) return 0.0;
  vec2 q = uPullC + (p - uPullC) * (1.0 + uPull * uPull * 3.2) / uTextScale;
  vec2 uv = vec2(q.x / uAspect + 0.5, q.y - uTextShift + 0.5);
  return texture2D(uText, uv).g * uTextW * sweep(p);
}

// value + analytic gradient of the droplets
vec3 blobs(vec2 p) {
  float f = 0.0;
  vec2 g = vec2(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uN) break;
    vec4 b = uBlobs[i];
    if (b.z < 1e-4) continue;
    vec2 d = p - b.xy;
    float s2 = b.z * b.z * 1.4427;
    if (i == 0) {
      float sp = length(uStretch);
      if (sp > 1e-3) {
        vec2 dir = uStretch / sp;
        vec2 per = vec2(-dir.y, dir.x);
        float k = clamp(sp * 0.35, 0.0, 0.85);
        float sa = 1.0 / (1.0 + k);
        float sb = 1.0 + k * 0.3;
        vec2 sd = dir * (dot(d, dir) * sa) + per * (dot(d, per) * sb);
        float e = exp(-dot(sd, sd) / s2);
        vec2 ssd = dir * (dot(sd, dir) * sa) + per * (dot(sd, per) * sb);
        f += e;
        g += e * (-2.0 * ssd / s2);
        continue;
      }
    }
    if (i == 1) {
      // falling tear-drop / impact squash, plus a living outline
      float a = atan(d.y, d.x);
      s2 *= 1.0 + (0.045 * sin(a * 5.0 + uTime * 1.3) + 0.03 * sin(a * 3.0 - uTime * 0.9)) * (0.5 + uPortal);
      vec2 dd = d / uDropShape;
      float e1 = exp(-dot(dd, dd) / s2);
      f += e1;
      g += e1 * (-2.0 * dd / uDropShape / s2);
      continue;
    }
    float e = exp(-dot(d, d) / s2);
    f += e;
    g += e * (-2.0 * d / s2);
  }
  return vec3(f, g);
}

vec3 background(vec2 p, float frost) {
  vec3 col = INK;
  // light rig: ember key light (left), amber fill (right), cool rim (top), warm kicker (top-left)
  vec2 l1 = uL[0];
  vec2 l2 = uL[1];
  vec2 l3 = uL[2];
  vec2 l4 = uL[3];
  col += EMBER * 0.36 * exp(-dot(p - l1, p - l1) * 3.0);
  col += COOL * 0.07 * exp(-dot(p - l2, p - l2) * 5.0);
  col += AMBER * 0.27 * exp(-dot(p - l3, p - l3) * 3.6);
  col += EMBER * 0.08 * exp(-dot(p - l4, p - l4) * 6.0);
  vec2 dc = p - uBlobs[0].xy;
  col += EMBER * 0.09 * exp(-dot(dc, dc) * 16.0);

  // architectural hairlines — they reveal every bend of the glass
  float px = 1.0 / uRes.y;
  float cols = 12.0;
  float gx = (p.x / uAspect + 0.5) * cols;
  float dx = abs(fract(gx + 0.5) - 0.5) * (uAspect / cols);
  float yTop = uTextShift + 0.245;
  float yBot = uTextShift - 0.245;
  float dy = min(abs(p.y - yTop), abs(p.y - yBot));
  float lines = max(1.0 - smoothstep(0.0, px * 1.2, dx), 1.0 - smoothstep(0.0, px * 1.2, dy));
  col += IVORY * 0.05 * lines * (1.0 - frost);
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float px = 1.0 / uRes.y;
  float m = uMelt;

  // field + gradient
  float e = px * 1.5;
  float tc = textAt(p, m);
  float tx = (textAt(p + vec2(e, 0.0), m) - textAt(p - vec2(e, 0.0), m)) / (2.0 * e);
  float ty = (textAt(p + vec2(0.0, e), m) - textAt(p - vec2(0.0, e), m)) / (2.0 * e);
  vec3 b = blobs(p);
  float F = tc + b.x;
  vec2 grad = vec2(tx, ty) + b.yz;
  float gl = max(length(grad), 1e-3);
  float dist = (F - T) / gl;                     // ≈ signed distance, > 0 inside
  float mask = smoothstep(-px, px, dist);

  // liquid-glass bevel: letters get a rounded edge with a flat core,
  // droplets get a deep dome so they read as real water drops
  float dropShare = smoothstep(0.35, 0.9, b.x / max(F, 1e-3));
  float W = mix(uBevel, 0.07, dropShare) + uPortal * 0.03;
  float u = clamp(dist / W, 0.0, 1.0);
  float slope = (1.0 - u) / sqrt(max(1.0 - (1.0 - u) * (1.0 - u), 0.04));
  vec2 gdir = grad / gl;
  vec3 n = normalize(vec3(-gdir * slope * 0.85, 1.0));

  // (the i's dot as the logo's ember orb: a glass bead, domed like the drops — dev visuals,
  // uDotTint is 0 on the site)
  float bead = 0.0;
  vec2 dq = vec2(0.0);
  if (uDotTint > 0.0 && uDot.z > 0.0) {
    vec2 q = warp(p, m);
    dq = (vec2(q.x, q.y - uTextShift) - uDot.xy) / uDot.z;
    bead = uDotTint * (1.0 - smoothstep(1.0, 1.3, length(dq)));
    vec3 ns = normalize(vec3(dq * 0.9, sqrt(max(1.0 - dot(dq, dq), 0.0)) + 0.12));
    n = normalize(mix(n, ns, bead));
  }

  // refraction with dispersion
  float frost = smoothstep(0.35, 1.0, u);
  vec2 off = -n.xy * 0.055;
  vec3 refr;
  refr.r = background(p + off * 0.9, frost).r;
  refr.g = background(p + off * 1.0, frost).g;
  refr.b = background(p + off * 1.12, frost).b;

  vec3 L = normalize(vec3(-0.55, 0.65, 0.75));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), 80.0);
  float fres = pow(1.0 - n.z, 1.5);
  float back = max(dot(n.xy, normalize(vec2(0.55, -0.65))), 0.0);

  vec3 glass = refr * 1.3 + IVORY * 0.075;
  glass += IVORY * fres * 0.5;
  glass += vec3(1.0, 0.96, 0.9) * spec * 1.2;
  glass += EMBER * back * fres * 0.45;

  // soft shadow cast below-right
  vec2 so = vec2(0.012, -0.022);
  float sh = smoothstep(0.12, 0.75, textSoft(p - so) * 1.4 + blobs(p - so).x * 0.9);
  vec3 base = background(p, 0.0) * (1.0 - sh * 0.45);

  if (uDotTint > 0.0 && uDot.z > 0.0) {
    // the "i" dotted with the logo's ember orb, in glass: lit from the top left like the
    // orb (#FF8A55 → #C73A10), the room seen through it, the same highlights, and its
    // warm glow on the room around it
    float dd = length(dq);
    // orange glass: the room seen through it, tinted; the light that crosses the bead
    // gathers on its far side (bottom right); a bright rim; a small sharp highlight
    float lit = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
    float caus = smoothstep(0.1, 0.85, dot(dq, normalize(vec2(0.55, -0.6)))) * (1.0 - smoothstep(0.8, 1.0, dd));
    vec3 ember = EMBER * (0.62 + refr * 1.2) * (0.75 + 0.35 * lit);
    ember += vec3(1.0, 0.6, 0.32) * caus * 0.55;
    ember += mix(EMBER, IVORY, 0.35) * fres * 0.55;
    ember += vec3(1.0, 0.96, 0.9) * pow(max(dot(n, H), 0.0), 220.0) * 1.6;
    glass = mix(glass, ember, bead);
    base += EMBER * 0.16 * uDotTint * exp(-max(dd - 1.0, 0.0) * 2.0);
  }

  if (uCutout > 0.5) {
    // (the glass alone and its soft shadow, to lay on another picture)
    gl_FragColor = vec4(glass * mask, mask + sh * 0.5 * (1.0 - mask));
    return;
  }

  vec3 col = mix(base, glass, mask);

  // vignette + grain
  col *= 1.0 - 0.28 * dot(p / vec2(uAspect, 1.0), p / vec2(uAspect, 1.0));
  float gr = fract(sin(dot(vUv * uRes + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (gr - 0.5) * 0.022;

  // portal: the flat core of the big drop becomes a window
  float hole = uPortal * smoothstep(0.15, 1.0, u) * mask;
  float alpha = 1.0 - hole;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

// Staircase lockup: "Kalion" large, "Studio" smaller, one step down and to the right,
// centred in a W × H frame
function lockupRuns(ctx, W, H, { family, weight, width }, word = WORD, sub = SUB) {
  const font = (size) => `${weight} ${size}px "${family}"`;
  ctx.font = font(100);
  const fs = (100 * W * width) / ctx.measureText(word).width;
  ctx.font = font(fs);
  const mW = ctx.measureText(word);
  const fsSub = fs * SUB_SCALE;
  ctx.font = font(fsSub);
  const mS = ctx.measureText(sub);

  const wordW = mW.width;
  const subX = wordW * SUB_OFFSET; // where "Studio" starts, relative to "Kalion"
  const totalW = Math.max(wordW, subX + mS.width);
  const capW = mW.actualBoundingBoxAscent;
  const capS = mS.actualBoundingBoxAscent;
  const gap = sub ? fs * 0.1 : 0;
  const blockH = capW + gap + capS;
  const x0 = (W - totalW) / 2;
  const yWord = H / 2 - blockH / 2 + capW; // baseline of "Kalion"
  const ySub = yWord + gap + capS; // baseline of "Studio"
  return {
    runs: [
      { text: word, size: fs, x: x0, y: yWord },
      { text: sub, size: fsSub, x: x0 + subX, y: ySub },
    ],
    top: yWord - capW, // top of the capitals
    bottom: ySub, // baseline of "Studio"
    font,
  };
}

// Can this browser blur a canvas (ctx.filter)? Older Safari lacks it, or ignores it: a
// test square is drawn blurred and the pixels next to it are read.
let canBlur = null;
function canvasBlurWorks() {
  if (canBlur !== null) return canBlur;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!('filter' in x)) return (canBlur = false);
    x.filter = 'blur(2px)';
    x.fillStyle = '#fff';
    x.fillRect(6, 6, 4, 4);
    canBlur = x.getImageData(3, 8, 1, 1).data[3] > 0;
  } catch (e) {
    canBlur = false;
  }
  return canBlur;
}

// a gaussian blur in JS (three box blurs), on the shape's alpha (its colour: rgb), for
// the browsers above
function blurAlpha(shape, sigma, rgb) {
  const W = shape.width;
  const H = shape.height;
  const ctx = shape.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  let a = new Float32Array(W * H);
  let b = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = d[i * 4 + 3];
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5));
  const pass = (src, dst, len, count, stride, step) => {
    const k = 1 / (2 * r + 1);
    for (let n = 0; n < count; n++) {
      const o = n * stride;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[o + clamp(i, 0, len - 1) * step];
      for (let i = 0; i < len; i++) {
        dst[o + i * step] = acc * k;
        acc += src[o + Math.min(i + r + 1, len - 1) * step] - src[o + Math.max(i - r, 0) * step];
      }
    }
  };
  for (let it = 0; it < 3; it++) {
    pass(a, b, W, H, W, 1);
    pass(b, a, H, W, 1, W);
  }
  for (let i = 0; i < W * H; i++) {
    d[i * 4] = rgb[0];
    d[i * 4 + 1] = rgb[1];
    d[i * 4 + 2] = rgb[2];
    d[i * 4 + 3] = a[i];
  }
  ctx.putImageData(img, 0, 0);
  return shape;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const seg = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;

export class LiquidScene {
  // opts.mobile: the phone layout (the drops scale with the word); opts.dpr: the resolution
  constructor(canvas, font = { family: 'Clash Display', weight: 600, width: 0.66 }, opts = {}) {
    this.font = font;
    this.canvas = canvas;
    this.mobile = !!opts.mobile;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    if (!renderer.getContext()) throw new Error('WebGL indisponible');
    renderer.setPixelRatio(opts.dpr || Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.textCanvas = document.createElement('canvas');
    this.textTex = new THREE.CanvasTexture(this.textCanvas);
    this.textTex.colorSpace = THREE.NoColorSpace;
    this.textTex.generateMipmaps = false;
    this.textTex.minFilter = THREE.LinearFilter;
    this.textTex.magFilter = THREE.LinearFilter;

    this.blobs = Array.from({ length: MAX }, () => new THREE.Vector4());
    this.uniforms = {
      uText: { value: this.textTex },
      uRes: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uBlobs: { value: this.blobs },
      uN: { value: MAX },
      uL: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
      uStretch: { value: new THREE.Vector2() },
      uTextShift: { value: 0.07 },
      uTextScale: { value: 1 },
      uTextW: { value: 0 },
      uMelt: { value: 1 },
      uDropShape: { value: new THREE.Vector2(1, 1) },
      uPull: { value: 0 },
      uPullC: { value: new THREE.Vector2() },
      uWave: { value: new THREE.Vector4(0, 0, 1, 0) },
      uImpact: { value: new THREE.Vector4(0, 0, 1, 0) },
      uWobble: { value: 0 },
      uPortal: { value: 0 },
      uBevel: { value: 0.03 },
      uDot: { value: new THREE.Vector3(0, 0, 0) },
      uDotTint: { value: 0 },
      uCutout: { value: 0 },
      uSweep: { value: new THREE.Vector2(1e3, 0.1) },
    };
    // impact splash: fixed directions so the scroll choreography is reversible
    this.impactDrops = Array.from({ length: 8 }, (_, k) => {
      const up = k < 6;
      const a = up ? Math.PI * (0.08 + (0.84 * k) / 5) + (k % 2 ? 0.1 : -0.1) : Math.PI * (1.25 + 0.5 * (k - 6));
      return { a, v: 0.34 + ((k * 37) % 10) * 0.028, r: 0.016 + ((k * 13) % 7) * 0.0045 };
    });
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    // vertical position (p-space) and scale of the word
    this.layout = { hero: 0, footer: -0.17, footerScale: 0.82 };

    this.state = {
      mode: 'hero',
      hero: 0,
      portal: 0,
      footer: 0,
      intro: 0,
      time: 0,
    };
    this.pointer = { x: 0, y: -0.25, has: false, pressed: false, hold: 0, downAt: 0 };
    this.cursor = { x: 0, y: -0.25, vx: 0, vy: 0, r: 0, speed: 0 };
    this.ambient = [
      { r: 0.03, ax: 0.44, ay: 0.2, w1: 0.11, w2: 0.17, p1: 0.4, p2: 1.3 },
      { r: 0.022, ax: 0.4, ay: 0.24, w1: 0.08, w2: 0.13, p1: 2.1, p2: 0.2 },
      { r: 0.034, ax: 0.46, ay: 0.18, w1: 0.06, w2: 0.19, p1: 4.0, p2: 2.6 },
      { r: 0.018, ax: 0.36, ay: 0.26, w1: 0.13, w2: 0.09, p1: 5.2, p2: 4.1 },
    ].map((d) => ({ ...d, x: 0, y: 0, vx: 0, vy: 0, init: false }));
    this.splash = [];
    this.wave = { x: 0, y: 0, age: 1, amp: 0 };

    this.resize();
    this.lights(0, this.aspect);
    this.bindPointer();
    this.last = performance.now();
    this.active = true;
    this.hold = false;
  }

  /* ---------------- text field texture ---------------- */
  drawText() {
    const dpr = this.renderer.getPixelRatio(); // (the resolution it renders at: min(screen, 1.5))
    const W = Math.min(2048, Math.max(640, Math.round(this.width * dpr)));
    const H = Math.max(360, Math.round(W / this.aspect));
    const c = this.textCanvas;
    // GPU storage is immutable: a new size needs a fresh texture allocation
    if (c.width !== W || c.height !== H) this.textTex.dispose();
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // (this.word / this.sub: other words in the same glass — dev visuals only)
    const { runs, font } = lockupRuns(ctx, W, H, this.font, this.word, this.sub);
    // (dev visuals only: the lockup moved sideways, in a share of the width)
    if (this.offsetX) runs.forEach((r) => (r.x += this.offsetX * W));
    const fs = runs[0].size;
    // the centre of every letter (p-space, word at rest) and its size: where the drops of
    // the opening go to make the word
    this.letters = [];
    runs.forEach((r) => {
      ctx.font = font(r.size);
      const cap = ctx.measureText(r.text).actualBoundingBoxAscent;
      for (let i = 0; i < r.text.length; i++) {
        const left = r.x + ctx.measureText(r.text.slice(0, i)).width;
        const w = ctx.measureText(r.text[i]).width;
        this.letters.push({
          x: ((left + w / 2) / W - 0.5) * this.aspect,
          y: 0.5 - (r.y - cap * 0.5) / H,
          size: cap / H,
        });
      }
    });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.globalCompositeOperation = 'lighter';

    const drawRuns = (target, color) => {
      target.fillStyle = color;
      target.textAlign = 'left';
      target.textBaseline = 'alphabetic';
      runs.forEach((r) => {
        target.font = font(r.size);
        target.fillText(r.text, r.x, r.y);
      });
    };
    // the words as one sharp shape in one colour, the "i" of "Kalion" dotted with a round
    // dot as on the logo (the font's dot is square): 1.18 × the stem, where the square was
    const dot = this.iDot(ctx, runs[0], font);
    if (dot) this.uniforms.uDot.value.set(((dot.x + dot.w / 2) / W - 0.5) * this.aspect, 0.5 - (dot.y + dot.h / 2) / H, (dot.w * 0.59) / H);
    else this.uniforms.uDot.value.z = 0; // (a word without an "i")
    const shapeOf = (color) => {
      const sh = document.createElement('canvas');
      sh.width = W;
      sh.height = H;
      const sc = sh.getContext('2d');
      drawRuns(sc, color);
      if (dot) {
        sc.globalCompositeOperation = 'destination-out';
        sc.fillRect(dot.x - 2, dot.y - 2, dot.w + 4, dot.h + 4);
        sc.globalCompositeOperation = 'source-over';
        sc.fillStyle = color;
        sc.beginPath();
        sc.arc(dot.x + dot.w / 2, dot.y + dot.h / 2, dot.w * 0.59, 0, Math.PI * 2);
        sc.fill();
      }
      return sh;
    };
    const blurred = (shape, sigma, rgb) => {
      if (canvasBlurWorks()) {
        ctx.filter = `blur(${sigma}px)`;
        ctx.drawImage(shape, 0, 0);
        ctx.filter = 'none';
      } else {
        // (older Safari: the same gaussian, computed here; the wide one on a quarter-size
        // copy, it is soft anyway)
        const q = sigma > 6 ? 4 : 1;
        const t = document.createElement('canvas');
        t.width = Math.ceil(W / q);
        t.height = Math.ceil(H / q);
        t.getContext('2d', { willReadFrequently: true }).drawImage(shape, 0, 0, t.width, t.height);
        blurAlpha(t, sigma / q, rgb);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(t, 0, 0, W, H);
      }
    };
    blurred(shapeOf('rgb(255,0,0)'), fs * 0.011, [255, 0, 0]);
    blurred(shapeOf('rgb(0,255,0)'), fs * 0.07, [0, 255, 0]);
    ctx.globalCompositeOperation = 'source-over';
    this.textTex.needsUpdate = true;
    // the glass bevel follows the size of the letters (on a phone they are much smaller
    // on the screen's height): 12 % of the capitals, as on a wide screen (where it is 0.03)
    const capP = (runs[0].size * 0.7) / H;
    // (phones only: the computer version keeps its tuned 0.03 on every screen)
    this.uniforms.uBevel.value = this.mobile ? Math.min(0.03, 0.12 * capP) : 0.03;
  }

  // where the font puts the dot of the "i" in a run (canvas px): the glyph is drawn alone
  // and its first block of ink from the top is the dot
  iDot(ctx, run, font) {
    const i = run.text.indexOf('i');
    if (i < 0) return null;
    const size = run.size;
    const S = Math.ceil(size * 1.4);
    const pad = Math.round(size * 0.2);
    const base = Math.round(size * 1.1);
    const g = document.createElement('canvas');
    g.width = S;
    g.height = S;
    const gc = g.getContext('2d', { willReadFrequently: true });
    gc.font = font(size);
    gc.textBaseline = 'alphabetic';
    gc.fillStyle = '#fff';
    gc.fillText('i', pad, base);
    const d = gc.getImageData(0, 0, S, S).data;
    const ink = (y) => {
      let x0 = S;
      let x1 = -1;
      for (let x = 0; x < S; x++) {
        if (d[(y * S + x) * 4 + 3] > 128) {
          if (x < x0) x0 = x;
          x1 = x;
        }
      }
      return x1 >= 0 ? [x0, x1] : null;
    };
    let y = 0;
    while (y < S && !ink(y)) y++;
    const top = y;
    let x0 = S;
    let x1 = -1;
    for (; y < S; y++) {
      const r = ink(y);
      if (!r) break;
      x0 = Math.min(x0, r[0]);
      x1 = Math.max(x1, r[1]);
    }
    if (top >= S || y - top < 2 || x1 < x0) return null;
    ctx.font = font(size);
    const left = run.x + ctx.measureText(run.text.slice(0, i)).width;
    return { x: left + (x0 - pad), y: run.y + (top - base), w: x1 - x0 + 1, h: y - top };
  }

  resize() {
    this.width = Math.max(this.canvas.clientWidth || window.innerWidth, 2);
    this.height = Math.max(this.canvas.clientHeight || window.innerHeight, 2);
    this.aspect = this.width / this.height;
    // the size of the drops (falling drop, splashes, droplets) relative to a wide screen:
    // on a phone the word is narrow, they shrink with it
    this.k = this.mobile ? clamp(this.aspect * 1.05, 0.45, 1) : 1;
    this.renderer.setSize(this.width, this.height, false);
    const pr = this.renderer.getPixelRatio();
    this.uniforms.uRes.value.set(this.width * pr, this.height * pr);
    this.uniforms.uAspect.value = this.aspect;
    this.drawText();
  }

  // the rendering resolution only (the quality follows the device's speed): the text
  // field stays as it is (three's setPixelRatio resizes the drawing buffer itself, once)
  setPixelRatio(pr) {
    this.renderer.setPixelRatio(pr);
    this.uniforms.uRes.value.set(this.width * pr, this.height * pr);
  }

  async warmup() {
    if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  /* ---------------- interaction ---------------- */
  toP(cx, cy) {
    return { x: (cx / this.width - 0.5) * this.aspect, y: 0.5 - cy / this.height };
  }

  bindPointer() {
    const ptr = this.pointer;
    const moveTo = (e) => {
      const p = this.toP(e.clientX, e.clientY);
      ptr.x = p.x;
      ptr.y = p.y;
      if (!ptr.has) {
        this.cursor.x = p.x;
        this.cursor.y = p.y;
      }
      ptr.has = true;
    };
    // a finger: the drop is born under it when it touches the screen, a tap (or a hold)
    // bursts it into droplets; once the page scrolls, the drop goes
    let touchOff = 0;
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (ptr.pressed) moveTo(e);
        return;
      }
      moveTo(e);
    });
    document.addEventListener('pointerleave', () => (ptr.has = false));
    window.addEventListener('blur', () => (ptr.has = false));
    window.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0) return;
      const t = e.target;
      if (t && t.closest && t.closest('a, button, input, textarea, label, form, .nav, .menu')) return;
      if (e.pointerType === 'touch') {
        clearTimeout(touchOff);
        ptr.has = false;
        moveTo(e);
      }
      ptr.pressed = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (!ptr.pressed) return;
      ptr.pressed = false;
      this.release();
      if (e.pointerType === 'touch') touchOff = setTimeout(() => (ptr.has = false), 60);
    });
    window.addEventListener('pointercancel', () => {
      ptr.pressed = false;
      ptr.has = false;
      gsap.to(ptr, { hold: 0, duration: 0.4 });
    });
  }

  release() {
    const power = this.pointer.hold;
    const n = 5 + Math.round(power * 6);
    const k = this.k;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.35 + Math.random() * (0.5 + power * 0.9)) * k;
      this.splash.push({
        x: this.cursor.x + Math.cos(a) * 0.02,
        y: this.cursor.y + Math.sin(a) * 0.02,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + 0.15,
        r0: (0.012 + Math.random() * (0.016 + power * 0.012)) * k,
        life: 1.1 + Math.random() * 0.8,
        age: 0,
      });
    }
    if (this.splash.length > 6) this.splash.splice(0, this.splash.length - 6);
    this.wave.x = this.cursor.x;
    this.wave.y = this.cursor.y;
    this.wave.age = 0;
    this.wave.amp = 0.007 + power * 0.012;
    gsap.to(this.pointer, { hold: 0, duration: 1.1, ease: 'elastic.out(1, 0.35)' });
  }

  intro(duration = 2.8) {
    gsap.fromTo(this.state, { intro: 0 }, { intro: 1, duration, ease: 'power3.inOut' });
  }

  // The opening: small drops burst out of a point (ox, oy: the preloader's ember orb),
  // one per letter in reading order ("Kalion", then "Studio"); each flies in an arc and
  // splashes onto its letter, and the word appears behind them, letter after letter
  // (a front runs along it), soft at first, then sharp. A ripple ends it.
  assemble(ox, oy) {
    const st = this.state;
    gsap.killTweensOf(st, 'intro');
    st.intro = 0;
    const hash = (n) => {
      const s = Math.sin(n * 127.1) * 43758.5453;
      return s - Math.floor(s);
    };
    const order = (l) => l.x - 1.5 * l.y; // (the same measure as the front, in the shader)
    const letters = (this.letters || []).slice(0, 14).sort((p, q) => order(p) - order(q));
    this.burst = {
      ox,
      oy,
      t: 0,
      from: letters.length ? order(letters[0]) : 0,
      to: letters.length ? order(letters[letters.length - 1]) : 0,
      drops: letters.map((l, i) => ({
        l,
        delay: 0.055 * i,
        lift: 0.08 + 0.16 * hash(i + 7),
        side: (hash(i + 3) - 0.5) * 0.16,
      })),
    };
    gsap.to(st, { intro: 1, duration: 1.6, delay: 0.5, ease: 'power2.inOut' });
  }

  setHero(p) { this.state.hero = p; }
  setPortal(p) { this.state.portal = p; }
  setFooter(p) { this.state.footer = p; }
  // how far the footer still is from the top of the screen (share of its height): the word rides with it
  setFooterShift(s) { this.footerShift = s; }
  setMode(m) { this.state.mode = m; }

  /* ---------------- simulation ---------------- */
  update(dt) {
    const st = this.state;
    const U = this.uniforms;
    const A = this.aspect;
    st.time += dt;
    U.uTime.value = st.time;

    const footer = st.mode === 'footer';
    const wordY = footer ? this.layout.footer - (this.footerShift || 0) : this.layout.hero;
    U.uTextShift.value = wordY;
    U.uTextScale.value = footer ? this.layout.footerScale : 1;
    U.uPullC.value.set(0, wordY);

    // --- cursor drop (spring) ---
    const c = this.cursor;
    const ptr = this.pointer;
    if (ptr.pressed) ptr.hold = Math.min(1, ptr.hold + dt / 0.9);
    const kx = 140;
    const damp = 16;
    c.vx += (kx * (ptr.x - c.x) - damp * c.vx) * dt;
    c.vy += (kx * (ptr.y - c.y) - damp * c.vy) * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    const speed = Math.hypot(c.vx, c.vy);
    c.speed = lerp(c.speed, speed, 0.12);
    const portalFade = 1 - seg(st.portal, 0.7, 1);
    const rTarget = ptr.has ? 0.05 * this.k * (1 + ptr.hold * 0.8) * portalFade : 0;
    c.r = lerp(c.r, rTarget, 0.12);
    this.blobs[0].set(c.x, c.y, c.r, 0);
    U.uStretch.value.set(c.vx, c.vy);
    U.uWobble.value = clamp(c.speed * 0.9, 0.15, 1);

    // --- scroll choreography (hero) ---
    // 1. a big drop falls from above the screen onto the flat word
    // 2. impact: squash, shockwave through the letters, splash
    // 3. the drop swallows the whole word and settles
    // 4. (portal) it opens like a lens onto the next section
    const s = footer ? 0 : st.hero;
    const q = footer ? 0 : st.portal;
    const T0 = 0.05; // drop enters
    const TI = 0.32; // impact
    const fall = seg(s, T0, TI);
    const hit = seg(s, TI, 0.7);
    const K = this.k;
    const R0 = 0.15 * K;
    let hx = 0;
    let hy = wordY;
    let hr = 0;
    let sx = 1;
    let sy = 1;
    if (s > T0 && hit <= 0) {
      hy = lerp(0.5 + R0 * 2.2, wordY, fall * fall); // gravity
      hr = R0;
      sx = 1 - 0.2 * fall; // tear-drop stretch while falling
      sy = 1 + 0.42 * fall;
    } else if (hit > 0) {
      hr = lerp(R0, 0.235 * K, easeOut(seg(s, 0.36, 0.9)));
      const osc = Math.exp(-4.2 * hit) * Math.cos(hit * 15);
      const blend = seg(hit, 0, 0.05);
      sx = lerp(0.8, 1 + 0.6 * osc, blend);
      sy = lerp(1.42, 1 - 0.42 * osc, blend);
    }
    if (q > 0) {
      hy = lerp(wordY, 0, easeOut(seg(q, 0, 0.6)));
      hr = lerp(0.235 * K, 1.4, easeIn(q));
      sx = 1;
      sy = 1;
    }
    if (footer) hr = 0;
    this.blobs[1].set(hx, hy, hr, 0);
    U.uDropShape.value.set(sx, sy);
    U.uImpact.value.set(0, wordY, hit > 0 ? hit : 1, hit > 0 ? 0.034 : 0);

    // splash droplets thrown out by the impact, then swallowed back
    const fly = seg(s, TI, 0.56);
    const back = seg(s, 0.5, 0.76);
    const splashing = fly > 0 && back < 1 && !footer;
    this.impactDrops.forEach((d, k) => {
      const out = easeOut(fly);
      const fx = hx + Math.cos(d.a) * d.v * K * out;
      const fy = wordY + Math.sin(d.a) * d.v * K * out - 0.28 * K * fly * fly;
      const bk = easeInOut(back);
      const r = splashing ? d.r * K * (1 - 0.3 * fly) * (1 - 0.7 * bk) : 0;
      this.blobs[12 + k].set(lerp(fx, hx, bk), lerp(fy, hy, bk), r, 0);
    });

    const pull = seg(s, 0.36, 0.84);
    U.uPull.value = footer ? 0 : pull;

    // --- text weight / melt (intro, absorb, footer condense) ---
    let textW;
    let melt;
    if (footer) {
      const f = easeOut(st.footer);
      textW = seg(st.footer, 0, 0.35);
      melt = 1 - f;
    } else {
      // (during the opening the letters are whole as soon as its front reaches them: the
      // front draws them, the melt sharpens them)
      textW = (this.burst ? 1 : seg(st.intro, 0, 0.35)) * (1 - seg(pull, 0.5, 0.95));
      melt = Math.max(1 - easeInOut(st.intro), pull * 0.9);
    }
    U.uTextW.value = textW;
    U.uMelt.value = melt;
    U.uPortal.value = seg(q, 0, 0.16);

    // --- ambient droplets ---
    const gather = footer ? 0 : seg(s, TI, 0.75);
    const introR = footer ? seg(st.footer, 0.2, 0.8) : easeOut(st.intro);
    this.ambient.forEach((d, i) => {
      const t = st.time;
      let tx = Math.sin(t * d.w1 + d.p1) * d.ax * A;
      let ty = wordY + Math.sin(t * d.w2 + d.p2) * d.ay;
      if (!d.init) {
        d.x = tx;
        d.y = ty;
        d.init = true;
      }
      // magnetic cursor
      if (ptr.has) {
        const dx = c.x - d.x;
        const dy = c.y - d.y;
        const dist = Math.hypot(dx, dy);
        const pullC = 1 - seg(dist, 0.06, 0.24);
        tx = lerp(tx, c.x - dx * 0.25, pullC * 0.85);
        ty = lerp(ty, c.y - dy * 0.25, pullC * 0.85);
      }
      tx = lerp(tx, hx, gather);
      ty = lerp(ty, hy, gather);
      d.vx += (9 * (tx - d.x) - 4.2 * d.vx) * dt;
      d.vy += (9 * (ty - d.y) - 4.2 * d.vy) * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const r = d.r * K * introR * (1 - seg(q, 0.3, 0.8));
      this.blobs[2 + i].set(d.x, d.y, r, 0);
    });

    // --- splash droplets ---
    this.splash = this.splash.filter((d) => d.age < d.life);
    this.splash.forEach((d) => {
      d.age += dt;
      d.vy -= 0.45 * dt;
      const fr = Math.exp(-2.3 * dt);
      d.vx *= fr;
      d.vy *= fr;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    });
    for (let i = 6; i < 12; i++) {
      const d = this.splash[i - 6];
      if (d) {
        const k = d.age / d.life;
        this.blobs[i].set(d.x, d.y, d.r0 * (1 - k * k), 0);
      } else this.blobs[i].set(0, 0, 0, 0);
    }

    // --- the opening (see assemble): its drops take the splash slots for a moment ---
    const b = this.burst;
    if (b) {
      b.t += dt;
      const FLY = 0.62;
      const n = b.drops.length;
      b.drops.forEach((d, i) => {
        const u = clamp((b.t - d.delay) / FLY, 0, 1);
        const a = clamp((b.t - d.delay - FLY * 0.9) / 0.42, 0, 1); // melting into its letter
        // a quick start out of the orb, then it slows down onto its letter (an arc)
        const e = 1 - Math.pow(1 - u, 2.2);
        const tx = d.l.x;
        const ty = d.l.y + wordY;
        const mx = (b.ox + tx) / 2 + d.side;
        const my = Math.max(b.oy, ty) + d.lift;
        const x = (1 - e) * (1 - e) * b.ox + 2 * (1 - e) * e * mx + e * e * tx;
        const y = (1 - e) * (1 - e) * b.oy + 2 * (1 - e) * e * my + e * e * ty;
        const R = d.l.size * 0.4;
        // small and separate in the air, it splashes (grows) as it lands, then melts in
        const land = clamp((u - 0.82) / 0.18, 0, 1);
        const melt = a * a * (3 - 2 * a);
        const r = u > 0 ? R * (0.26 + 0.3 * land * land) * (1 - melt) : 0;
        // (a visitor who scrolls straight away: once the big drop has hit the word, its splash
        // owns slots 12-19 — the opening's last drops have melted into their letters by then)
        if (6 + i >= 12 && splashing) return;
        this.blobs[6 + i].set(x, y, r, 0);
      });
      // the front: it reaches each letter as its drop lands
      const first = b.drops.length ? b.drops[0].delay + FLY * 0.85 : 0;
      const last = b.drops.length ? b.drops[n - 1].delay + FLY * 0.85 : 1;
      const k = clamp((b.t - first) / Math.max(last - first, 1e-3), 0, 1);
      U.uSweep.value.set(lerp(b.from - 0.06, b.to + 0.06, k) + (k >= 1 ? clamp(b.t - last, 0, 1) * 4 : 0), 0.07);
      // a ripple runs through the word once it has formed
      const ra = clamp((b.t - last + 0.1) / 1.4, 0, 1);
      // (not over the impact's own shockwave, if the drop has already hit the word)
      if (ra > 0 && ra < 1 && hit <= 0) U.uImpact.value.set(0, wordY, ra, 0.018);
      if (b.t > last + 1.6) {
        this.burst = null; // (the slots go back to the splashes)
        U.uSweep.value.set(1e3, 0.07);
      }
    }

    // --- shockwave ---
    const w = this.wave;
    w.age = Math.min(1, w.age + dt / 1.3);
    U.uWave.value.set(w.x, w.y, w.age, w.amp);

    // (computed here once, not for every pixel: the light rig, and the slots in use)
    this.lights(st.time, A);
    let n = 0;
    for (let i = 0; i < MAX; i++) if (this.blobs[i].z >= 1e-4) n = i + 1;
    U.uN.value = n;
  }

  // the background's four lights: they drift slowly with the time
  lights(t, A) {
    const L = this.uniforms.uL.value;
    L[0].set(-0.3 * A + 0.08 * Math.sin(t * 0.21), -0.24 + 0.06 * Math.cos(t * 0.17));
    L[1].set(0.22 * A + 0.06 * Math.cos(t * 0.13), 0.36 + 0.04 * Math.sin(t * 0.19));
    L[2].set(0.36 * A + 0.05 * Math.sin(t * 0.16), -0.1 + 0.07 * Math.cos(t * 0.12));
    L[3].set(-0.18 * A + 0.05 * Math.cos(t * 0.1), 0.44);
  }

  render() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 1 / 30);
    this.last = now;
    if (!this.active) return;
    this.update(dt);
    // (hold: still hidden under the preloader — its state goes on, nothing is drawn)
    if (this.hold) return;
    this.renderer.render(this.scene, this.camera);
  }
}
