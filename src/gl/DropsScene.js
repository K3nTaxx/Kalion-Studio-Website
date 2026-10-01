import * as THREE from 'three';

/* ------------------------------------------------------------------
   "Nos tarifs" — liquid-glass drops. Same glass as the hero (gaussian
   metaballs → signed distance → dome profile → refraction with
   dispersion over a lit background with hairlines, specular, fresnel,
   ember back light, soft shadow), plus:
   - a liquid inside the drops: a level per drop, four warm layers
     (one per thing included in every site), a meniscus, waves when a
     droplet falls in;
   - a hand-over from the reviews: the background can be see-through
     (the reviews show under it) while the drop that takes over their
     sphere is already drawn, then it fades in around it;
   - the reviews' sphere itself ("orb"): ray-traced here with the very
     same code, camera and values as in ReviewsScene, so taking it over
     changes no pixel. It then melts into the drop while it leaps.
   The drops themselves (positions, radii, fill) are driven from main.js.
------------------------------------------------------------------ */

export const MAX = 8;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uAspect;
uniform float uTime;
uniform vec4 uBlobs[${MAX}]; // x, y, radius, wobble
uniform vec4 uLiq[${MAX}];   // fill (0–1), bottom y, height, tint (0: layers, k + 1: layer k, 5: ember)
uniform vec2 uLines;         // y of the two horizontal hairlines
uniform float uSlosh;        // waves on the liquid (a droplet just fell in)
uniform float uGlowIn;       // the full drop glows from inside
uniform float uBgA;          // the background (0: see-through, the reviews still show under it)
uniform float uDropA;        // the drops
uniform float uSpan;         // height of the four layers (1: the whole drop, as it fills)
// the reviews' sphere (see ReviewsScene: same camera, same values)
uniform float uOrb;          // how much of it is drawn over the drop (1: all of it)
uniform vec3 uCam;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec3 uCamF;
uniform float uFovT;
uniform vec4 uOrbB;          // xyz centre, w radius
uniform vec3 uOrbS;          // vertical scale, surface life, seed
uniform float uIor;
uniform float uAbsorb;

const vec3 INK = vec3(0.063, 0.047, 0.039);
const vec3 IVORY = vec3(0.925, 0.902, 0.863);
const vec3 EMBER = vec3(1.0, 0.357, 0.141);
const vec3 COOL = vec3(0.64, 0.73, 0.95);
const vec3 AMBER = vec3(1.0, 0.56, 0.3);
const float T = 0.5;
const float K = 0.12; // (the reviews' smooth union radius: it pads the sphere's bounds)

// the four layers, from the bottom: deep ember → amber
vec3 tint(float k) {
  if (k < 0.5) return vec3(0.32, 0.06, 0.03);
  if (k < 1.5) return vec3(0.55, 0.14, 0.045);
  if (k < 2.5) return vec3(0.78, 0.3, 0.085);
  if (k < 3.5) return vec3(0.95, 0.58, 0.22);
  return vec3(0.95, 0.3, 0.1);
}

// field value, gradient, and the liquid seen by the drops around p
void field(vec2 p, out float f, out vec2 g, out float fill, out float h, out float ov, out vec3 ovCol) {
  f = 0.0;
  g = vec2(0.0);
  fill = 0.0;
  h = 0.0;
  ov = 0.0;
  ovCol = vec3(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    vec4 b = uBlobs[i];
    if (b.z < 1e-4) continue;
    vec2 d = p - b.xy;
    float s2 = b.z * b.z * 1.4427;
    // a living outline, like the hero's drop
    float a = atan(d.y, d.x);
    s2 *= 1.0 + b.w * (0.035 * sin(a * 4.0 + uTime * 1.1 + float(i)) + 0.02 * sin(a * 3.0 - uTime * 0.8));
    float e = exp(-dot(d, d) / s2);
    f += e;
    g += e * (-2.0 * d / s2);
    vec4 q = uLiq[i];
    fill += e * q.x;
    h += e * (p.y - q.y) / max(q.z, 1e-4);
    if (q.w > 0.5) {
      ov += e;
      ovCol += e * tint(q.w - 1.0);
    }
  }
  float inv = 1.0 / max(f, 1e-5);
  fill *= inv;
  h *= inv;
  ovCol /= max(ov, 1e-5);
  ov *= inv;
}

vec3 background(vec2 p, float frost) {
  vec3 col = INK;
  vec2 l1 = vec2(-0.34 * uAspect + 0.07 * sin(uTime * 0.19), -0.3 + 0.05 * cos(uTime * 0.15));
  vec2 l2 = vec2(0.3 * uAspect + 0.06 * cos(uTime * 0.13), 0.34 + 0.04 * sin(uTime * 0.17));
  vec2 l3 = vec2(0.4 * uAspect + 0.05 * sin(uTime * 0.14), -0.16 + 0.06 * cos(uTime * 0.11));
  col += EMBER * 0.3 * exp(-dot(p - l1, p - l1) * 3.0);
  col += COOL * 0.06 * exp(-dot(p - l2, p - l2) * 5.0);
  col += AMBER * 0.22 * exp(-dot(p - l3, p - l3) * 3.6);
  // architectural hairlines: they reveal every bend of the glass
  float px = 1.0 / uRes.y;
  float gx = (p.x / uAspect + 0.5) * 12.0;
  float dx = abs(fract(gx + 0.5) - 0.5) * (uAspect / 12.0);
  float dy = min(abs(p.y - uLines.x), abs(p.y - uLines.y));
  float lines = max(1.0 - smoothstep(0.0, px * 1.2, dx), 1.0 - smoothstep(0.0, px * 1.2, dy));
  col += IVORY * 0.045 * lines * (1.0 - frost);
  return col;
}

// ---- the reviews' sphere: ReviewsScene's code, as it is when they hand it over
// (no rows, no halo, no underwater light left) ------------------------------
vec3 orbBackground(vec2 p) {
  vec3 col = INK;
  vec2 l1 = vec2(-0.34 * uAspect + 0.07 * sin(uTime * 0.19), -0.3 + 0.05 * cos(uTime * 0.15));
  vec2 l2 = vec2(0.3 * uAspect + 0.06 * cos(uTime * 0.13), 0.34 + 0.04 * sin(uTime * 0.17));
  vec2 l3 = vec2(0.4 * uAspect + 0.05 * sin(uTime * 0.14), -0.16 + 0.06 * cos(uTime * 0.11));
  col += EMBER * 0.3 * exp(-dot(p - l1, p - l1) * 3.0);
  col += COOL * 0.06 * exp(-dot(p - l2, p - l2) * 5.0);
  col += AMBER * 0.22 * exp(-dot(p - l3, p - l3) * 3.6);
  float px = 1.0 / uRes.y;
  float gx = (p.x / uAspect + 0.5) * 12.0;
  float dx = abs(fract(gx + 0.5) - 0.5) * (uAspect / 12.0);
  col += IVORY * 0.04 * (1.0 - smoothstep(0.0, px * 1.2, dx));
  return col;
}

vec2 dirToScreen(vec3 d) {
  float z = 0.5 / uFovT;
  return vec2(dot(d, uCamR), dot(d, uCamU)) * z / max(dot(d, uCamF), 0.25);
}

vec3 studio(vec3 d) {
  float key = smoothstep(0.8, 0.975, dot(d, normalize(vec3(-0.5, 0.75, 0.45))));
  float fill = smoothstep(0.7, 0.96, dot(d, normalize(vec3(0.85, 0.05, 0.5))));
  return IVORY * key * 0.6 + AMBER * fill * 0.22;
}

vec3 env(vec3 d) {
  float up = smoothstep(-0.1, 0.9, d.y);
  vec3 c = mix(INK * 1.3, AMBER * 0.16 + IVORY * 0.06, up);
  c += EMBER * 0.22 * pow(max(dot(d, normalize(vec3(-0.6, -0.45, 0.4))), 0.0), 3.0);
  return c + studio(d);
}

vec3 look(vec3 d) {
  float ahead = smoothstep(0.15, 0.55, dot(d, uCamF));
  vec3 c = env(d);
  if (ahead > 0.0) c = mix(c, orbBackground(dirToScreen(d)), ahead);
  return c;
}

float sdOrb(vec3 p) {
  vec3 q = p - uOrbB.xyz;
  q.y /= uOrbS.x;
  float l = max(length(q), 1e-5);
  vec3 nq = q / l;
  float life = uOrbS.y * uOrbB.w * (0.03 * sin(nq.x * 3.0 + uTime * 1.6 + uOrbS.z) * sin(nq.y * 2.5 - uTime * 1.2 + uOrbS.z * 1.7)
                                  + 0.018 * sin(nq.z * 4.0 + uTime * 2.1 + uOrbS.z * 0.6));
  return (l - uOrbB.w - life) * min(uOrbS.x, 1.0);
}

vec3 orbNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0015;
  return normalize(k.xyy * sdOrb(p + k.xyy * e) + k.yyx * sdOrb(p + k.yyx * e) +
                   k.yxy * sdOrb(p + k.yxy * e) + k.xxx * sdOrb(p + k.xxx * e));
}

bool hitOrb(vec3 ro, vec3 rd, out float t) {
  t = 0.0;
  float R = uOrbB.w * max(uOrbS.x, 1.0) * 1.12 + K;
  vec3 oc = ro - uOrbB.xyz;
  float bb = dot(oc, rd);
  float h = bb * bb - (dot(oc, oc) - R * R);
  if (h <= 0.0) return false;
  h = sqrt(h);
  float t1 = -bb + h;
  if (t1 < 0.0) return false;
  t = max(-bb - h, 0.0);
  for (int i = 0; i < 64; i++) {
    float d = sdOrb(ro + rd * t);
    if (d < 0.0006) return true;
    t += d * 0.9;
    if (t > t1) return false;
  }
  return false;
}

vec3 shadeOrb(vec3 ro, vec3 rd, float t) {
  vec3 P = ro + rd * t;
  vec3 n = orbNormal(P);
  float cosi = clamp(-dot(rd, n), 0.0, 1.0);
  float f0 = pow((1.0 - uIor) / (1.0 + uIor), 2.0);
  float F = f0 + (1.0 - f0) * pow(1.0 - cosi, 5.0);
  vec3 refl = reflect(rd, n);
  vec3 rr = refract(rd, n, 1.0 / uIor);
  vec3 cRefr = vec3(0.0);
  if (dot(rr, rr) < 1e-4) {
    F = 1.0;
  } else {
    vec3 q = P - n * 0.004;
    float len = 0.0;
    for (int i = 0; i < 30; i++) {
      float d = sdOrb(q);
      if (d > -0.0006) break;
      float st = max(-d, 0.003);
      q += rr * st;
      len += st;
    }
    vec3 n2 = orbNormal(q);
    vec3 od = refract(rr, -n2, uIor);
    if (dot(od, od) < 1e-4) od = reflect(rr, -n2);
    vec3 bend = od - rd;
    vec3 dR = normalize(od - bend * 0.022);
    vec3 dB = normalize(od + bend * 0.032);
    cRefr.r = look(dR).r;
    cRefr.g = look(od).g;
    cRefr.b = look(dB).b;
    cRefr *= exp(-len * vec3(0.22, 0.42, 0.68) * uAbsorb * 0.35);
  }
  vec3 cRefl = look(refl) + studio(refl) * 0.6;
  vec3 col = mix(cRefr * 1.3 + IVORY * 0.075, cRefl, F);
  vec3 L = normalize(vec3(-0.5, 0.72, 0.5));
  float spec = pow(max(dot(refl, L), 0.0), 110.0);
  col += vec3(1.0, 0.96, 0.9) * spec * 1.5;
  float fres = pow(1.0 - cosi, 1.5);
  col += IVORY * fres * 0.42;
  col += EMBER * fres * max(dot(n, normalize(vec3(0.55, -0.6, -0.2))), 0.0) * 0.8;
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float px = 1.0 / uRes.y;

  float F, fill, h, ov;
  vec2 grad;
  vec3 ovCol;
  field(p, F, grad, fill, h, ov, ovCol);
  float gl = max(length(grad), 1e-3);
  float dist = (F - T) / gl; // ≈ signed distance, > 0 inside
  float mask = smoothstep(-px, px, dist);

  // deep dome: real water drops, with a calm flat core for the text on top
  float W = 0.075;
  float u = clamp(dist / W, 0.0, 1.0);
  float slope = (1.0 - u) / sqrt(max(1.0 - (1.0 - u) * (1.0 - u), 0.04));
  vec2 gdir = grad / gl;
  vec3 n = normalize(vec3(-gdir * slope * 0.85, 1.0));

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

  vec3 glass = refr * 1.25 + IVORY * 0.06;
  glass *= mix(1.0, 0.82, frost); // a touch darker in the core: the text reads on it

  // the liquid inside: its level, its waves, its four layers and its meniscus
  if (fill > 0.002) {
    float aa = max(fwidth(h), 1e-4);
    float lvl = fill + 0.006 * sin(p.x * 9.0 + uTime * 1.7) + uSlosh * (0.035 * sin(p.x * 23.0 - uTime * 7.5) + 0.02 * sin(p.x * 41.0 + uTime * 11.0));
    float wet = smoothstep(lvl + aa, lvl - aa, h);
    // one layer per droplet poured in; the seams between them sway a little
    float span = max(uSpan, 0.04);
    float s = h / span * 4.0 + 0.05 * sin(p.x * 17.0 + uTime * 0.9) + 0.035 * sin(p.x * 31.0 - uTime * 1.3);
    float k = clamp(floor(s), 0.0, 3.0);
    vec3 lc = tint(k) * mix(0.8, 1.1, clamp(s - k, 0.0, 1.0)); // each layer lighter at its top
    // a thin darker seam between two layers
    float seam = abs(fract(s + 0.5) - 0.5) * span * 0.25;
    lc *= 1.0 - 0.3 * (1.0 - smoothstep(aa * 0.6, aa * 1.8, seam)) * step(0.5, s) * step(s, 3.5);
    lc = mix(lc, ovCol, ov);
    // depth: rich in the thick middle, clearer where the drop gets thin
    vec3 through = background(p + off * 2.4 + vec2(0.0, 0.02), frost);
    float thick = smoothstep(0.0, 0.85, u);
    vec3 liq = mix(through * 1.3 + lc * 0.45, lc * (0.72 + 0.6 * through.r), 0.5 + 0.5 * thick);
    liq += EMBER * uGlowIn * 0.3 * (1.0 - h) * thick;
    // light caught under the surface, and the meniscus itself
    liq += AMBER * 0.35 * exp(-max(lvl - h, 0.0) / 0.035) * wet;
    float menis = exp(-pow((h - lvl) / (aa * 1.4), 2.0));
    glass = mix(glass, liq, wet * smoothstep(0.0, 0.25, u + 0.1));
    glass += (IVORY * 0.55 + AMBER * 0.2) * menis * smoothstep(0.02, 0.2, u);
  }

  glass += IVORY * fres * 0.5;
  glass += vec3(1.0, 0.96, 0.9) * spec * 1.2;
  glass += EMBER * back * fres * 0.5;

  vec2 so = vec2(0.012, -0.022);
  float Fs, fs_, hs_, ovs_;
  vec2 gs_;
  vec3 cs_;
  field(p - so, Fs, gs_, fs_, hs_, ovs_, cs_);
  float sh = smoothstep(0.12, 0.75, Fs * 0.9);
  vec3 base = background(p, 0.0) * (1.0 - sh * 0.4);

  // the reviews' sphere over the drop, on the same place (it melts into it)
  float om = 0.0;
  vec3 orbCol = vec3(0.0);
  if (uOrb > 0.001) {
    vec3 ro = uCam;
    vec3 rd = normalize(p.x * uCamR + p.y * uCamU + (0.5 / uFovT) * uCamF);
    float tb;
    if (hitOrb(ro, rd, tb)) {
      orbCol = shadeOrb(ro, rd, tb);
      om = uOrb;
    }
  }

  // premultiplied: the background may still be see-through (hand-over from the reviews)
  vec3 dropCol = mix(glass * mask, orbCol, om);
  float dm = mix(mask, 1.0, om) * uDropA;
  vec3 col = dropCol * uDropA + base * uBgA * (1.0 - dm);
  float A = dm + uBgA * (1.0 - dm);
  col *= 1.0 - 0.26 * dot(p / vec2(uAspect, 1.0), p / vec2(uAspect, 1.0));
  // a still grain, the reviews' one: nothing flickers, and the sphere they hand over matches
  float gr = fract(sin(dot(vUv * uRes, vec2(12.9898, 78.233))) * 43758.5453);
  col += (gr - 0.5) * 0.012 * A;
  gl_FragColor = vec4(col, A);
}`;

export class DropsScene {
  // opts.dpr: the rendering resolution
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('WebGL indisponible');
    renderer.setPixelRatio(opts.dpr || Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blobs = Array.from({ length: MAX }, () => new THREE.Vector4());
    this.liq = Array.from({ length: MAX }, () => new THREE.Vector4(0, 0, 1, 0));
    this.uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uBlobs: { value: this.blobs },
      uLiq: { value: this.liq },
      uLines: { value: new THREE.Vector2(0.3, -0.3) },
      uSlosh: { value: 0 },
      uGlowIn: { value: 0 },
      uBgA: { value: 1 },
      uDropA: { value: 1 },
      uSpan: { value: 1 },
      uOrb: { value: 0 },
      uCam: { value: new THREE.Vector3(0, 0.5, 3.3) },
      uCamR: { value: new THREE.Vector3(1, 0, 0) },
      uCamU: { value: new THREE.Vector3(0, 1, 0) },
      uCamF: { value: new THREE.Vector3(0, 0, -1) },
      uFovT: { value: Math.tan(THREE.MathUtils.degToRad(15)) },
      uOrbB: { value: new THREE.Vector4() },
      uOrbS: { value: new THREE.Vector3(1, 0, 0) },
      uIor: { value: 1.47 },
      uAbsorb: { value: 1 },
    };
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._e1 = new THREE.Vector3();
    this._e2 = new THREE.Vector3();
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.active = false;
    this.resize();
  }

  resize() {
    const w = Math.max(this.canvas.clientWidth || window.innerWidth, 2);
    const h = Math.max(this.canvas.clientHeight || window.innerHeight, 2);
    this.width = w;
    this.height = h;
    this.aspect = w / h;
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.uniforms.uRes.value.set(w * pr, h * pr);
    this.uniforms.uAspect.value = this.aspect;
  }

  // the rendering resolution only (it follows the device's speed)
  setPixelRatio(pr) {
    this.renderer.setPixelRatio(pr);
    this.resize();
  }

  // screen px (from the top-left) ↔ shader space (x in [-aspect/2, aspect/2], y up in [-0.5, 0.5])
  toScreen(x, y) {
    return { x: (x / this.aspect + 0.5) * this.width, y: (0.5 - y) * this.height };
  }

  setBlob(i, x, y, r, wobble = 1) {
    this.blobs[i].set(x, y, Math.max(r, 0), wobble);
  }

  // the liquid in drop i: how full (0–1), where its bottom and top are, and its colour
  // (0: the four layers, k + 1: all of layer k, 5: ember)
  setLiquid(i, fill, bottom, height, tint = 0) {
    this.liq[i].set(clamp01(fill), bottom, Math.max(height, 1e-4), tint);
  }

  // the reviews' sphere, drawn with their camera (their uniforms) and their values
  // (ball: world centre, radius, shape, glass). It can be moved on screen: (x, y, r) in
  // shader space puts its centre there, at the same depth. Seen in perspective, its
  // outline is a little larger and off its centre: `fit` (0–1) moves it so that its
  // outline, rather than its centre, lands on (x, y, r). Returns that outline
  // (shader space: centre x, y, mean radius r, smallest radius rMin).
  setOrb(amount, cam, ball, x = null, y = null, r = null, fit = 0) {
    const U = this.uniforms;
    U.uOrb.value = amount;
    if (amount <= 0 || !cam || !ball) return null;
    U.uCam.value.copy(cam.uCam.value);
    U.uCamR.value.copy(cam.uCamR.value);
    U.uCamU.value.copy(cam.uCamU.value);
    U.uCamF.value.copy(cam.uCamF.value);
    U.uFovT.value = cam.uFovT.value;
    U.uIor.value = ball.ior;
    U.uAbsorb.value = ball.absorb;
    U.uOrbS.value.set(ball.squash, ball.life, ball.seed);
    const P = this._p.set(ball.wx, ball.wy, ball.wz);
    let R = ball.wr;
    if (x !== null) {
      // same depth, another place on screen
      const D = this._q.subVectors(P, U.uCam.value).dot(U.uCamF.value);
      const put = (px, py, pr) => {
        const k = 0.5 / (U.uFovT.value * D);
        P.copy(U.uCam.value)
          .addScaledVector(U.uCamF.value, D)
          .addScaledVector(U.uCamR.value, px / k)
          .addScaledVector(U.uCamU.value, py / k);
        R = ball.wr * (pr / ball.r);
      };
      put(x, y, r);
      if (fit > 0) {
        const s = this.outline(P, R, ball.squash);
        put(x - (s.x - x) * fit, y - (s.y - y) * fit, r * Math.pow(r / s.r, fit));
      }
    }
    U.uOrbB.value.set(P.x, P.y, P.z, R);
    return this.outline(P, R, ball.squash);
  }

  // the outline of a sphere seen by the orb's camera: the circle where the view grazes
  // it, projected (shader space)
  outline(C, R, squash = 1) {
    const U = this.uniforms;
    const O = U.uCam.value;
    const n = this._q.subVectors(C, O);
    const d = n.length();
    n.divideScalar(d);
    const back = (R * R) / d;
    const rho = R * Math.sqrt(Math.max(1 - (R * R) / (d * d), 0));
    const e1 = this._e1.crossVectors(n, U.uCamU.value).normalize();
    const e2 = this._e2.crossVectors(e1, n);
    const Q = this._t;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      Q.copy(C)
        .addScaledVector(n, -back)
        .addScaledVector(e1, rho * Math.cos(a))
        .addScaledVector(e2, rho * Math.sin(a));
      Q.sub(O);
      const k = 0.5 / U.uFovT.value / Math.max(Q.dot(U.uCamF.value), 1e-3);
      const px = Q.dot(U.uCamR.value) * k;
      const py = Q.dot(U.uCamU.value) * k;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    const rx = (x1 - x0) / 2;
    const ry = ((y1 - y0) / 2) * squash;
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: (rx + ry) / 2, rMin: Math.min(rx, ry) };
  }

  async warmup() {
    if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  render(t) {
    if (!this.active) return;
    this.uniforms.uTime.value = t;
    this.renderer.render(this.scene, this.camera);
  }
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
