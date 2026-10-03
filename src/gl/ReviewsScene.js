import * as THREE from 'three';

/* ------------------------------------------------------------------
   "Ils nous ont fait confiance" — a ray-traced scene (one fullscreen
   shader, no meshes):
   - the liquid rises over the end of the gallery; small bubbles fizz;
   - seven bubbles (one per review) rise and merge (smooth union of
     spheres) into one sphere, which turns to glass and lights a halo;
   - from the sphere, the reviews spread out to the left on two rows
     that keep drifting (in opposite directions). The rows sit on the
     background, so the sphere shows them upside down, like a lens ball.
   Positions, radii and timings are driven from main.js (initReviews).
------------------------------------------------------------------ */

export const BLOBS = 8; // 7 bubbles + the sphere they merge into

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
uniform vec3 uCam;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec3 uCamF;
uniform float uFovT;       // tan(fov / 2)
uniform vec4 uBlobs[${BLOBS}]; // xyz centre, w radius
uniform vec4 uShape[${BLOBS}]; // x vertical scale, y surface life, z seed
uniform float uK;          // smooth union radius (the bridges while merging)
uniform float uIor;
uniform float uAbsorb;
// the halo: a glowing ring on a horizontal plane around the sphere
uniform vec2 uHaloC;
uniform float uHaloY;
uniform float uHaloR;
uniform float uGlow;
// the reviews: two rows (an atlas, one row per half), in CSS px
uniform sampler2D uRows;
uniform float uRowsOn;
uniform float uRowLoop;    // length of one loop of a row
uniform float uRowH;       // height of a row
uniform vec2 uRowY;        // centre of each row (screen space)
uniform vec2 uRowOff;      // how far each row has drifted
uniform float uVh;         // viewport height
uniform float uSrcX;       // the sphere, where the rows come from (screen space)
uniform float uSrcR;       // its radius on screen (CSS px)
uniform float uSrcY;       // (its height on screen)
uniform vec2 uFront;       // left edge of each row's text (CSS px): the text comes out of the sphere
uniform vec2 uRowBlur;     // a little blur while a row still moves fast (mip bias)
uniform float uMobile;     // phone layout (see rows())
uniform float uRowLod;     // the texture is drawn for texDpr: a lower rendering resolution reads a smaller mip
// the liquid
uniform float uLevel;      // surface (screen y); above it the canvas is clear
uniform float uUnder;      // underwater light
uniform float uFizz;       // the small bubbles
uniform float uFizzY;      // their scroll-driven rise

const vec3 INK = vec3(0.063, 0.047, 0.039);
const vec3 IVORY = vec3(0.925, 0.902, 0.863);
const vec3 EMBER = vec3(1.0, 0.357, 0.141);
const vec3 COOL = vec3(0.64, 0.73, 0.95);
const vec3 AMBER = vec3(1.0, 0.56, 0.3);

// the reviews: two rows that slide out of the sphere, sharp once they rest
vec4 rows(vec2 p, float lod) {
  float x = (p.x + 0.5 * uAspect) * uVh;
  float src = (uSrcX + 0.5 * uAspect) * uVh;
  float h = uRowH / uVh;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float v = (p.y - (i == 0 ? uRowY.x : uRowY.y)) / h + 0.5;
    if (v <= 0.0 || v >= 1.0) continue;
    float u = fract((x + (i == 0 ? uRowOff.x : uRowOff.y)) / uRowLoop);
    vec4 tx = textureLod(uRows, vec2(u, (v + 1.0 - fi) * 0.5), lod + uRowLod + (i == 0 ? uRowBlur.x : uRowBlur.y));
    float front = i == 0 ? uFront.x : uFront.y;
    float m;
    if (uMobile > 0.5) {
      // (phone: the sphere is above the rows, they unroll from under it to both sides)
      m = smoothstep(0.0, 60.0, front - abs(x - src));
    } else {
      m = smoothstep(front, front + 70.0, x); // the text that has come out so far
      m *= 1.0 - smoothstep(src - uSrcR * 1.4, src - uSrcR * 0.7, x); // born at the sphere's edge
      m *= smoothstep(0.0, 80.0, x);                    // soft left edge
    }
    acc += tx * m * (1.0 - acc.a);
  }
  return acc * uRowsOn;
}

// same light rig as the pricing drops (the next section): the two scenes join
vec3 background(vec2 p, float lod) {
  vec3 col = INK;
  vec2 l1 = vec2(-0.34 * uAspect + 0.07 * sin(uTime * 0.19), -0.3 + 0.05 * cos(uTime * 0.15));
  vec2 l2 = vec2(0.3 * uAspect + 0.06 * cos(uTime * 0.13), 0.34 + 0.04 * sin(uTime * 0.17));
  vec2 l3 = vec2(0.4 * uAspect + 0.05 * sin(uTime * 0.14), -0.16 + 0.06 * cos(uTime * 0.11));
  float deep = 1.0 - 0.4 * uUnder; // under the surface the room goes deeper
  col += EMBER * 0.3 * deep * exp(-dot(p - l1, p - l1) * 3.0);
  col += COOL * 0.06 * exp(-dot(p - l2, p - l2) * 5.0);
  col += AMBER * 0.22 * deep * exp(-dot(p - l3, p - l3) * 3.6);
  float px = 1.0 / uRes.y;
  float gx = (p.x / uAspect + 0.5) * 12.0;
  float dx = abs(fract(gx + 0.5) - 0.5) * (uAspect / 12.0);
  col += IVORY * 0.04 * (1.0 - smoothstep(0.0, px * 1.2, dx));
  // under the surface: slanted light shafts
  if (uUnder > 0.001) {
    float a = p.x * 1.35 + p.y * 0.5;
    float s = (0.5 + 0.5 * sin(a * 10.0 + uTime * 0.35)) * (0.5 + 0.5 * sin(a * 23.0 - uTime * 0.27 + 1.3));
    s = s * s * s * smoothstep(-0.75, 0.55, p.y);
    col += (AMBER * 0.11 + IVORY * 0.03) * s * uUnder;
    col += EMBER * 0.02 * smoothstep(-0.3, 0.6, p.y) * uUnder;
  }
  if (uRowsOn > 0.001) {
    vec4 r = rows(p, lod);
    col = r.rgb + col * (1.0 - r.a);
  }
  return col;
}

// a direction seen from the camera → its place on the (infinitely far) background
vec2 dirToScreen(vec3 d) {
  float z = 0.5 / uFovT;
  return vec2(dot(d, uCamR), dot(d, uCamU)) * z / max(dot(d, uCamF), 0.25);
}

// soft studio lights, only seen in reflections
vec3 studio(vec3 d) {
  float key = smoothstep(0.8, 0.975, dot(d, normalize(vec3(-0.5, 0.75, 0.45))));
  float fill = smoothstep(0.7, 0.96, dot(d, normalize(vec3(0.85, 0.05, 0.5))));
  return IVORY * key * 0.6 + AMBER * fill * 0.22;
}

// the room around the glass, for the directions the background doesn't cover
// (behind the camera): light from above — the liquid's surface
vec3 env(vec3 d) {
  float up = smoothstep(-0.1, 0.9, d.y);
  vec3 c = mix(INK * 1.3, AMBER * 0.16 + IVORY * 0.06, up);
  c += (IVORY * 0.35 + AMBER * 0.2) * smoothstep(0.55, 0.95, d.y) * uUnder;
  c += EMBER * 0.22 * pow(max(dot(d, normalize(vec3(-0.6, -0.45, 0.4))), 0.0), 3.0);
  return c + studio(d);
}

vec3 look(vec3 d, float lod) {
  float ahead = smoothstep(0.15, 0.55, dot(d, uCamF));
  vec3 c = env(d);
  if (ahead > 0.0) c = mix(c, background(dirToScreen(d), lod), ahead);
  return c;
}

// the halo's light where a ray crosses its plane (before tMax)
vec3 halo(vec3 ro, vec3 rd, float tMax) {
  if (uGlow < 0.001 || abs(rd.y) < 1e-3) return vec3(0.0);
  float tp = (uHaloY - ro.y) / rd.y;
  if (tp <= 0.0 || tp > tMax) return vec3(0.0);
  vec3 P = ro + rd * tp;
  float dr = abs(length(P.xz - uHaloC) - uHaloR);
  return (IVORY * 0.85 * exp(-dr / 0.0035) + EMBER * 0.5 * exp(-dr / 0.035) + EMBER * 0.25 * exp(-dr / 0.12)) * uGlow;
}

vec3 traceOut(vec3 o, vec3 d) {
  return look(d, 1.2) + halo(o, d, 1e3);
}

// ---- the bubbles / the sphere --------------------------------------------
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sdBody(vec3 p) {
  float d = 1e3;
  for (int i = 0; i < ${BLOBS}; i++) {
    vec4 b = uBlobs[i];
    if (b.w < 1e-4) continue;
    vec4 s = uShape[i];
    vec3 q = p - b.xyz;
    q.y /= s.x;
    float l = max(length(q), 1e-5);
    vec3 nq = q / l;
    // a living surface (low frequency, relative to the size)
    float life = s.y * b.w * (0.03 * sin(nq.x * 3.0 + uTime * 1.6 + s.z) * sin(nq.y * 2.5 - uTime * 1.2 + s.z * 1.7)
                            + 0.018 * sin(nq.z * 4.0 + uTime * 2.1 + s.z * 0.6));
    float di = (l - b.w - life) * min(s.x, 1.0);
    d = smin(d, di, uK);
  }
  return d;
}

vec3 bodyNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0015;
  return normalize(k.xyy * sdBody(p + k.xyy * e) + k.yyx * sdBody(p + k.yyx * e) +
                   k.yxy * sdBody(p + k.yxy * e) + k.xxx * sdBody(p + k.xxx * e));
}

bool hitBody(vec3 ro, vec3 rd, out float t) {
  // march only between the padded spheres the ray actually crosses
  float t0 = 1e5;
  float t1 = -1.0;
  for (int i = 0; i < ${BLOBS}; i++) {
    vec4 b = uBlobs[i];
    if (b.w < 1e-4) continue;
    float R = b.w * max(uShape[i].x, 1.0) * 1.12 + uK;
    vec3 oc = ro - b.xyz;
    float bb = dot(oc, rd);
    float h = bb * bb - (dot(oc, oc) - R * R);
    if (h > 0.0) {
      h = sqrt(h);
      t0 = min(t0, -bb - h);
      t1 = max(t1, -bb + h);
    }
  }
  t = 0.0;
  if (t1 < 0.0) return false;
  t = max(t0, 0.0);
  for (int i = 0; i < 64; i++) {
    float d = sdBody(ro + rd * t);
    if (d < 0.0006) return true;
    t += d * 0.9;
    if (t > t1) return false;
  }
  return false;
}

vec3 shadeBody(vec3 ro, vec3 rd, float t) {
  vec3 P = ro + rd * t;
  vec3 n = bodyNormal(P);
  float cosi = clamp(-dot(rd, n), 0.0, 1.0);
  float f0 = pow((1.0 - uIor) / (1.0 + uIor), 2.0);
  float F = f0 + (1.0 - f0) * pow(1.0 - cosi, 5.0);
  vec3 refl = reflect(rd, n);
  vec3 rr = refract(rd, n, 1.0 / uIor);
  vec3 cRefr = vec3(0.0);
  if (dot(rr, rr) < 1e-4) {
    F = 1.0;
  } else {
    // through the body to its far side
    vec3 q = P - n * 0.004;
    float len = 0.0;
    for (int i = 0; i < 30; i++) {
      float d = sdBody(q);
      if (d > -0.0006) break;
      float st = max(-d, 0.003);
      q += rr * st;
      len += st;
    }
    vec3 n2 = bodyNormal(q);
    vec3 od = refract(rr, -n2, uIor);
    if (dot(od, od) < 1e-4) od = reflect(rr, -n2);
    // dispersion around the green ray: the rainbow edges
    vec3 bend = od - rd;
    vec3 dR = normalize(od - bend * 0.022);
    vec3 dB = normalize(od + bend * 0.032);
    cRefr.r = traceOut(q, dR).r;
    cRefr.g = traceOut(q, od).g;
    cRefr.b = traceOut(q, dB).b;
    cRefr *= exp(-len * vec3(0.22, 0.42, 0.68) * uAbsorb * 0.35);
  }
  vec3 cRefl = traceOut(P, refl) + studio(refl) * 0.6;
  // the hero's glass recipe: a lifted refraction, an ivory rim, the ember back light
  vec3 col = mix(cRefr * 1.3 + IVORY * 0.075, cRefl, F);
  vec3 L = normalize(vec3(-0.5, 0.72, 0.5));
  float spec = pow(max(dot(refl, L), 0.0), 110.0);
  col += vec3(1.0, 0.96, 0.9) * spec * 1.5;
  float fres = pow(1.0 - cosi, 1.5);
  col += IVORY * fres * 0.42;
  col += EMBER * fres * max(dot(n, normalize(vec3(0.55, -0.6, -0.2))), 0.0) * 0.8;
  return col;
}

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

// small bubbles: outlines with a glint, rising in the liquid, gone just under the surface
vec3 fizz(vec2 p, float px, float level) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 28; i++) {
    float fi = float(i);
    float h1 = hash(fi * 1.7 + 0.3);
    float h2 = hash(fi * 3.1 + 1.1);
    float h3 = hash(fi * 5.3 + 2.7);
    float r = (1.6 + 5.0 * h2 * h2) * px;
    float y = -0.56 + fract(h3 + uTime * (0.02 + 0.04 * h2) + uFizzY * (0.5 + 0.7 * h2)) * 1.25;
    float x = (h1 - 0.5) * uAspect * 0.96 + sin(uTime * (0.7 + h2) + fi * 2.3) * 0.006;
    vec2 d = p - vec2(x, y);
    float l = length(d);
    if (l > r + 3.0 * px) continue;
    float rim = smoothstep(r + px, r, l) * smoothstep(r - 2.2 * px, r - 0.8 * px, l);
    float glint = smoothstep(r * 0.42, r * 0.12, length(d - vec2(-0.32, 0.34) * r));
    float fade = smoothstep(level - 0.005, level - 0.05, y) * (0.45 + 0.55 * h2);
    c += (IVORY * 0.55 * rim + IVORY * 0.9 * glint) * fade;
  }
  return c;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float px = 1.0 / uRes.y;
  vec3 ro = uCam;
  vec3 rd = normalize(p.x * uCamR + p.y * uCamU + (0.5 / uFovT) * uCamF);

  vec3 col = background(p, 0.0);
  float tb;
  bool body = hitBody(ro, rd, tb);
  if (body) col = shadeBody(ro, rd, tb);
  col += halo(ro, rd, body ? tb : 1e3);
  if (uFizz > 0.001) col += fizz(p, px, uLevel) * uFizz;

  vec2 q = p / vec2(uAspect, 1.0);
  col *= 1.0 - 0.26 * dot(q, q);
  float gr = fract(sin(dot(vUv * uRes, vec2(12.9898, 78.233))) * 43758.5453);
  col += (gr - 0.5) * 0.012; // a still grain: nothing flickers over the text

  // the liquid rises from the bottom; above its surface the page shows through
  float A = 1.0;
  if (uLevel < 0.75) {
    float s = uLevel + 0.011 * sin(p.x * 6.0 + uTime * 1.3) + 0.006 * sin(p.x * 13.0 - uTime * 1.9 + 1.0);
    float below = smoothstep(s + px, s - px, p.y);
    float line = exp(-pow((p.y - s) / (px * 1.4), 2.0));
    col += EMBER * 0.2 * exp(-max(s - p.y, 0.0) / 0.04) * below; // light caught just under the surface
    col = col * below + IVORY * 0.7 * line + EMBER * 0.1 * exp(-abs(p.y - s) / 0.012);
    A = max(below, line * 0.85);
  }
  gl_FragColor = vec4(col, A);
}`;

export class ReviewsScene {
  // opts.dpr: the rendering resolution (the reviews' texture keeps it: crisp text);
  // opts.mobile: the phone layout (the rows unroll from the sphere above them)
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.mobile = !!opts.mobile;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('WebGL indisponible');
    this.texDpr = opts.dpr || Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(this.texDpr);
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blobs = Array.from({ length: BLOBS }, () => new THREE.Vector4());
    this.shapes = Array.from({ length: BLOBS }, () => new THREE.Vector4(1, 1, 0, 0));
    this.uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3(0, 0.5, 3.3) },
      uCamR: { value: new THREE.Vector3(1, 0, 0) },
      uCamU: { value: new THREE.Vector3(0, 1, 0) },
      uCamF: { value: new THREE.Vector3(0, 0, -1) },
      uFovT: { value: Math.tan(THREE.MathUtils.degToRad(15)) },
      uBlobs: { value: this.blobs },
      uShape: { value: this.shapes },
      uK: { value: 0.12 },
      uIor: { value: 1.45 },
      uAbsorb: { value: 1 },
      uHaloC: { value: new THREE.Vector2(0, 0) },
      uHaloY: { value: 0 },
      uHaloR: { value: 0.5 },
      uGlow: { value: 0 },
      uRows: { value: null },
      uRowsOn: { value: 0 },
      uRowLoop: { value: 1 },
      uRowH: { value: 1 },
      uRowY: { value: new THREE.Vector2(0.1, -0.15) },
      uRowOff: { value: new THREE.Vector2(0, 0) },
      uVh: { value: window.innerHeight },
      uSrcX: { value: 0.3 },
      uSrcR: { value: 100 },
      uSrcY: { value: 0 },
      uFront: { value: new THREE.Vector2(1e5, 1e5) },
      uRowBlur: { value: new THREE.Vector2(0, 0) },
      uMobile: { value: opts.mobile ? 1 : 0 },
      uRowLod: { value: 0 },
      uLevel: { value: 1 },
      uUnder: { value: 0 },
      uFizz: { value: 0 },
      uFizzY: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this.active = false;
    this.resize();
  }

  resize() {
    const w = Math.max(this.canvas.clientWidth || window.innerWidth, 2);
    const h = Math.max(this.canvas.clientHeight || window.innerHeight, 2);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.uniforms.uRes.value.set(w * pr, h * pr);
    this.uniforms.uAspect.value = w / h;
    this.uniforms.uVh.value = h;
  }

  // the rendering resolution only (it follows the device's speed): the drawing buffer is
  // resized once (three's setPixelRatio), the layout is not measured again
  setPixelRatio(pr) {
    this.renderer.setPixelRatio(pr);
    this.uniforms.uRes.value.set(this.width * pr, this.height * pr);
    this.uniforms.uRowLod.value = Math.max(0, Math.log2(this.texDpr / pr));
  }

  setCamera(px, py, pz, tx, ty, tz, fovDeg) {
    const U = this.uniforms;
    U.uCam.value.set(px, py, pz);
    const f = this._f.set(tx - px, ty - py, tz - pz).normalize();
    const r = this._r.crossVectors(f, THREE.Object3D.DEFAULT_UP).normalize();
    const u = this._u.crossVectors(r, f);
    U.uCamF.value.copy(f);
    U.uCamR.value.copy(r);
    U.uCamU.value.copy(u);
    U.uFovT.value = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  }

  // world point → screen space (x in [-aspect/2, aspect/2], y up in [-0.5, 0.5])
  project(x, y, z) {
    const U = this.uniforms;
    const d = this._d.set(x, y, z).sub(U.uCam.value);
    const k = 0.5 / U.uFovT.value / Math.max(d.dot(U.uCamF.value), 1e-3);
    return { x: d.dot(U.uCamR.value) * k, y: d.dot(U.uCamU.value) * k };
  }

  setBlob(i, x, y, z, r, squash = 1, life = 1, seed = 0) {
    this.blobs[i].set(x, y, z, Math.max(r, 0));
    this.shapes[i].set(squash, life, seed, 0);
  }

  // the two rows of reviews, drawn once (sizes in CSS px, texture at the canvas' resolution)
  setRows(list) {
    const dpr = this.texDpr;
    const vw = (this.canvas.clientWidth || window.innerWidth) / 100;
    const cl = (a, v, b) => Math.min(b, Math.max(a, v));
    // (on a phone: a card is most of the screen's width, the text a little smaller)
    // (a short phone: wider cards, so fewer lines: the two rows fit under the sphere)
    const short = this.mobile && (this.canvas.clientHeight || window.innerHeight) / (vw * 100) < 1.95;
    const quoteFs = this.mobile ? cl(13.5, (short ? 3.5 : 3.6) * vw, 17) : cl(15, 1.15 * vw, 21);
    const lh = quoteFs * 1.32;
    const cardW = this.mobile ? cl(250, (short ? 80 : 70) * vw, 340) : cl(290, 24 * vw, 430);
    let gap = this.mobile ? cl(36, 10 * vw, 60) : cl(48, 4.4 * vw, 90);
    // (phone layout on a wide portrait screen: a loop long enough that a review is never in both rows at once)
    if (this.mobile) gap = Math.max(gap, (2 * vw * 100 + 2 * cardW + 120) / list.length - cardW);
    const starR = quoteFs * 0.34;
    const nameFs = quoteFs * 1.06;
    const roleFs = cl(9.5, 0.62 * vw, 12);
    const pad = quoteFs * 0.9;
    const per = cardW + gap;
    const loop = per * list.length;

    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const wrap = (text) => {
      const words = text.split(/\s+/);
      const lines = [];
      let line = '';
      words.forEach((w) => {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > cardW && line) {
          lines.push(line);
          line = w;
        } else line = test;
      });
      if (line) lines.push(line);
      return lines;
    };
    ctx.font = `400 ${quoteFs}px "Instrument Serif"`;
    const wrapped = list.map((rv) => wrap(rv.quote));
    const maxLines = Math.max(...wrapped.map((l) => l.length));
    const H = Math.ceil(pad * 2 + starR * 2 + quoteFs * 0.8 + maxLines * lh + quoteFs * 0.75 + nameFs);

    const maxTex = this.renderer.capabilities.maxTextureSize || 4096;
    const scale = Math.min(dpr, maxTex / loop);
    c.width = Math.ceil(loop * scale);
    c.height = Math.ceil(H * 2 * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, loop, H * 2);

    const IVORY = '#ece6dc';
    const EMBER = '#ff5b24';
    const star = (cx, cy, R) => {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? R * 0.45 : R;
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    };
    const spark = (cx, cy, R) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - R);
      ctx.quadraticCurveTo(cx, cy, cx + R, cy);
      ctx.quadraticCurveTo(cx, cy, cx, cy + R);
      ctx.quadraticCurveTo(cx, cy, cx - R, cy);
      ctx.quadraticCurveTo(cx, cy, cx, cy - R);
      ctx.fill();
    };
    const setSpacing = (v) => {
      if ('letterSpacing' in ctx) ctx.letterSpacing = v;
    };

    // two orders that never put the same review at the same place in both rows
    // (phone: the second row is the first one backwards — drifting the other way at the same
    // pace, a review then only ever meets its twin at two fixed points, kept off screen: see
    // initReviews in main.js)
    const orders = [list.map((_, i) => i), this.mobile ? list.map((_, i) => list.length - 1 - i) : [4, 6, 1, 5, 0, 2, 3].filter((i) => i < list.length)];
    orders.forEach((order, row) => {
      const y0 = row * H;
      order.forEach((idx, k) => {
        const rv = list[idx];
        const x0 = k * per + gap / 2;
        let y = y0 + pad;
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = EMBER;
        for (let i = 0; i < 5; i++) star(x0 + starR + i * starR * 2.7, y + starR, starR);
        y += starR * 2 + quoteFs * 0.8;

        // a soft ink halo under the words: they stay legible over the lights
        ctx.shadowColor = 'rgba(12, 11, 10, 0.7)';
        ctx.shadowBlur = 10 * scale;
        ctx.fillStyle = IVORY;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = `400 ${quoteFs}px "Instrument Serif"`;
        setSpacing('0px');
        wrapped[idx].forEach((l, i) => ctx.fillText(l, x0, y + i * lh + (lh - quoteFs) * 0.35));
        y += wrapped[idx].length * lh + quoteFs * 0.75;

        // the client: name in italic, sector in mono
        ctx.font = `italic 400 ${nameFs}px "Instrument Serif"`;
        ctx.fillText(rv.name, x0, y);
        if (rv.role) {
          const nameW = ctx.measureText(rv.name).width;
          ctx.fillStyle = EMBER;
          ctx.beginPath();
          ctx.arc(x0 + nameW + 11, y + nameFs * 0.55, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = `400 ${roleFs}px "DM Mono"`;
          setSpacing(`${(roleFs * 0.12).toFixed(2)}px`);
          ctx.fillStyle = 'rgba(236, 230, 220, 0.6)';
          ctx.fillText(rv.role.toUpperCase(), x0 + nameW + 22, y + (nameFs - roleFs) * 0.6);
          setSpacing('0px');
        }

        // ✦ between two reviews, like the band above the projects
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = 'rgba(255, 91, 36, 0.75)';
        spark(k * per, y0 + H / 2, 6);
      });
    });

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.premultiplyAlpha = true;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const U = this.uniforms;
    if (U.uRows.value) U.uRows.value.dispose();
    U.uRows.value = tex;
    U.uRowLoop.value = loop;
    U.uRowH.value = H;
    this.rowH = H;
    this.rowPer = per;
    this.rowCard = cardW;
    this.rowLoop = loop;
    this.rowCount = list.length;
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
