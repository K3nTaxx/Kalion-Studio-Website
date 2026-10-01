import * as THREE from 'three';

/* ------------------------------------------------------------------
   "Pourquoi nous ?" — a flight through four liquid-glass drops.

   Each engagement is a drop of glass floating in a warm, hazy space.
   As the camera approaches, the drop opens into a ring (the same
   drop → portal idea as the hero), its figure appears inside, and the
   camera flies through it towards the next one. The light shifts from
   ember to amber, copper and gold, then opens onto the ivory page.

   The drop → ring morph is a torus whose major radius grows from 0
   (a sphere) to its final size, computed in the vertex shader with
   exact analytic normals.
------------------------------------------------------------------ */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export const STOPS = 4;
// path parameter: 0 start · 2i+1 in front of ring i · 2i+2 through ring i · 10 far beyond
export const PATH_END = 2 * STOPS + 1;

const FIRST_Z = -12;
const GAP = 13;
const HOLD = 7.4; // camera distance in front of a ring while reading
const RING_R = 1.55; // opened ring radius
const RING_T = 0.16; // opened tube radius
const DROP_R = 0.9; // closed drop radius

const RINGS = [
  { x: 0, y: 0, tilt: 0.16 },
  { x: 1.5, y: 0.4, tilt: -0.2 },
  { x: -1.4, y: -0.35, tilt: 0.22 },
  { x: 0.7, y: 0.25, tilt: -0.14 },
];

// one mood per engagement, then the light (stage 4) that matches the ivory page below
const PALETTE = [
  { base: '#1a0f0b', glow: '#ff5b24', glow2: '#7a2a12', amt: 0.9 },
  { base: '#1c1209', glow: '#ff9440', glow2: '#8a5418', amt: 0.9 },
  { base: '#1d0e10', glow: '#f05a3c', glow2: '#6e2233', amt: 0.9 },
  { base: '#21150b', glow: '#ffb862', glow2: '#9a6a2a', amt: 1.0 },
  { base: '#3a2414', glow: '#ffd2a0', glow2: '#e89a5a', amt: 1.0 },
].map((p) => ({
  base: new THREE.Color(p.base),
  glow: new THREE.Color(p.glow),
  glow2: new THREE.Color(p.glow2),
  amt: p.amt,
}));

const BG_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BG_FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uGlow;
uniform vec3 uGlow2;
uniform float uAmt;
uniform float uLight;
uniform float uFlood;
uniform float uWash;
uniform vec3 uIvory;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 d = normalize(vDir);
  vec3 col = uBase;
  // the light at the end of the corridor: a small core and a soft halo
  float f = max(dot(d, normalize(vec3(0.0, -0.03, -1.0))), 0.0);
  col += uGlow * (pow(f, 70.0) * 0.42 + pow(f, 16.0) * 0.12) * uAmt;
  // wandering lights inside the field of view, like the rest of the site
  vec3 b1 = normalize(vec3(-0.42 + 0.06 * sin(uTime * 0.07), -0.26, -1.0));
  col += uGlow * exp((dot(d, b1) - 1.0) * 26.0) * 0.26 * uAmt;
  vec3 b2 = normalize(vec3(0.46, 0.2 + 0.05 * cos(uTime * 0.05), -1.0));
  col += uGlow2 * exp((dot(d, b2) - 1.0) * 20.0) * 0.34;
  vec3 b3 = normalize(vec3(0.15, 0.5, -1.0));
  col += vec3(0.33, 0.45, 0.85) * exp((dot(d, b3) - 1.0) * 18.0) * 0.025 * (1.0 - uLight);
  // below the horizon, a touch deeper
  col *= mix(1.0, 0.75 + 0.25 * smoothstep(-0.35, 0.05, d.y), 1.0 - uLight);
  // after the last ring the light at the end opens up and floods the screen...
  col += uGlow * pow(f, mix(70.0, 2.0, uFlood)) * uFlood * 1.6;
  // ...and settles into the ivory of the page below, keeping a warm glow at its heart
  col = mix(col, uIvory, uWash);
  col += uGlow * pow(f, 5.0) * 0.16 * uWash;
  // dither against banding
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 160.0;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <colorspace_fragment>
}`;

const DUST_VERT = /* glsl */ `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uScale;
varying float vA;
varying float vS;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.23 + aSeed * 40.0) * 0.25;
  p.y += sin(uTime * 0.31 + aSeed * 23.0) * 0.3;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  gl_PointSize = clamp(aSize * uScale / max(depth, 0.1), 1.0, 70.0);
  float tw = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 1.6) + aSeed * 60.0);
  vA = tw * smoothstep(0.8, 3.5, depth) * (1.0 - smoothstep(30.0, 60.0, depth));
  vS = aSeed;
  gl_Position = projectionMatrix * mv;
}`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uGain;
varying float vA;
varying float vS;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  gl_FragColor = vec4(mix(uColA, uColB, vS), a * vA * uGain);
  #include <colorspace_fragment>
}`;

export class JourneyScene {
  // opts.dpr: the rendering resolution
  constructor(canvas, figures, opts = {}) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(opts.dpr || Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.transmissionResolutionScale = 0.6;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 240);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.028);
    this.uTime = { value: 0 };

    this.buildEnvironment();
    this.buildBackground();
    this.buildPath();
    this.buildRings(figures);
    this.buildDust();

    this.s = 0;
    this.pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    this.roll = 0;
    this.active = false;
    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
    this.v4 = new THREE.Vector3();
    this.c1 = new THREE.Color();
    this.resize();
  }

  /* ---------------- warm studio environment for the glass ---------------- */
  buildEnvironment() {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: '#1a100b', side: THREE.BackSide })));
    const panel = (w, h, color, gain, x, y, z) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(gain), side: THREE.DoubleSide })
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(9, 5, '#ff5b24', 3.2, -6, -3, 3); // ember key, low left
    panel(6, 7, '#ff9a4d', 2.2, 7, 1, -2); // amber fill, right
    panel(8, 2.2, '#fff1e2', 5.5, 0, 7, 2); // soft box above: long highlight on the glass
    panel(3, 3, '#a3baf2', 1.1, 4, 5, -6); // cool rim
    panel(5, 1.2, '#fff1e2', 2.6, -2, 1, 8); // strip behind the camera
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(env, 0.035);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();
  }

  buildBackground() {
    this.bgU = {
      uBase: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uGlow2: { value: new THREE.Color() },
      uAmt: { value: 0.6 },
      uLight: { value: 0 },
      uFlood: { value: 0 },
      uWash: { value: 0 },
      uIvory: { value: new THREE.Color('#ece6dc') },
      uTime: this.uTime,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.bgU,
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.bg = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), mat);
    this.bg.renderOrder = -10;
    this.bg.frustumCulled = false;
    this.scene.add(this.bg);
  }

  buildPath() {
    this.ringPos = RINGS.map((r, i) => new THREE.Vector3(r.x, r.y, FIRST_Z - i * GAP));
    const pts = [new THREE.Vector3(0, 0.5, FIRST_Z + HOLD + 10)];
    this.ringPos.forEach((p) => {
      pts.push(new THREE.Vector3(p.x, p.y, p.z + HOLD));
      pts.push(p.clone());
    });
    const last = this.ringPos[STOPS - 1];
    pts.push(new THREE.Vector3(last.x * 0.3, last.y * 0.5, last.z - 10));
    pts.push(new THREE.Vector3(0, 0, last.z - 32));
    this.path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.pathLast = pts.length - 1;
  }

  pathAt(s, target) {
    return this.path.getPoint(clamp(s, 0, this.pathLast) / this.pathLast, target);
  }

  /* ---------------- drops → rings ---------------- */
  buildRings(figures) {
    const geo = new THREE.TorusGeometry(1, 1, 64, 180);
    this.rings = this.ringPos.map((p, i) => {
      const u = {
        uR: { value: 0 },
        uTube: { value: DROP_R },
        uWob: { value: 0.05 },
        uSeed: { value: i * 1.7 },
        uTime: this.uTime,
      };
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.035,
        transmission: 1,
        thickness: 1.6,
        ior: 1.42,
        dispersion: 0.3,
        attenuationColor: new THREE.Color('#ffd9b8'),
        attenuationDistance: 4.5,
        clearcoat: 0.8,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.35,
        specularIntensity: 1,
      });
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, u);
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform float uR;\nuniform float uTube;\nuniform float uWob;\nuniform float uSeed;\nuniform float uTime;'
          )
          .replace(
            '#include <beginnormal_vertex>',
            `float tU = uv.x * 6.28318530718;
            float tV = uv.y * 6.28318530718;
            vec3 objectNormal = vec3(cos(tV) * cos(tU), cos(tV) * sin(tU), sin(tV));
            #ifdef USE_TANGENT
              vec3 objectTangent = vec3(tangent.xyz);
            #endif`
          )
          .replace(
            '#include <begin_vertex>',
            `float wob = uWob * (sin(tU * 3.0 + uTime * 1.3 + tV + uSeed) * 0.55 + sin(tV * 2.0 - uTime * 1.7 + tU * 2.0 + uSeed) * 0.45);
            float tubeR = uTube * (1.0 + wob);
            vec3 transformed = vec3((uR + tubeR * cos(tV)) * cos(tU), (uR + tubeR * cos(tV)) * sin(tU), tubeR * sin(tV));`
          );
      };
      mat.customProgramCacheKey = () => 'kalion-drop-ring';
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(p);
      mesh.frustumCulled = false;
      this.scene.add(mesh);

      const fig = this.makeFigure(figures[i] || { main: '', suffix: '', caption: '' });
      fig.position.copy(p);
      this.scene.add(fig);
      return { mesh, mat, u, fig, base: p.clone(), tilt: RINGS[i].tilt };
    });
  }

  // the engagement's figure (Instrument Serif), drawn once on a canvas
  makeFigure({ main, suffix, caption }) {
    const W = 1024;
    const H = 560;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const big = 330;
    const small = big * 0.42;
    const serif = (px) => `400 ${px}px "Instrument Serif", serif`;
    ctx.font = serif(big);
    const mw = ctx.measureText(main).width;
    ctx.font = serif(small);
    const gap = suffix ? 10 : 0;
    const sw = suffix ? ctx.measureText(suffix).width : 0;
    const x0 = (W - mw - gap - sw) / 2;
    const base = H * 0.6;
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(255, 120, 60, 0.55)';
    ctx.shadowBlur = 42;
    ctx.fillStyle = '#f4efe7';
    ctx.font = serif(big);
    ctx.fillText(main, x0, base);
    if (suffix) {
      ctx.fillStyle = '#ff5b24';
      ctx.font = serif(small);
      ctx.fillText(suffix, x0 + mw + gap, base);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(244, 239, 231, 0.82)';
    ctx.font = '400 36px "DM Mono", monospace';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.textAlign = 'center';
    ctx.fillText(caption.toUpperCase(), W / 2, base + 96);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.5, (2.5 * H) / W), mat);
    mesh.visible = false;
    return mesh;
  }

  /* ---------------- floating embers ---------------- */
  buildDust() {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const size = new Float32Array(N);
    const zMax = FIRST_Z + HOLD + 16;
    const zMin = FIRST_Z - (STOPS - 1) * GAP - 42;
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.3 + Math.pow(Math.random(), 0.6) * 9;
      pos[i * 3] = Math.cos(a) * r * 1.3;
      pos[i * 3 + 1] = Math.sin(a) * r * 0.8;
      pos[i * 3 + 2] = lerp(zMax, zMin, Math.random());
      seed[i] = Math.random();
      size[i] = 0.018 + Math.pow(Math.random(), 4) * 0.14;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.dustU = {
      uTime: this.uTime,
      uScale: { value: 500 },
      uColA: { value: new THREE.Color('#ff7a3d') },
      uColB: { value: new THREE.Color('#ffe2c2') },
      uGain: { value: 0.9 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.dustU,
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  resize() {
    const w = Math.max(this.canvas.clientWidth || window.innerWidth, 2);
    const h = Math.max(this.canvas.clientHeight || window.innerHeight, 2);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // a tall screen (phone): the lens widens until the ring fits across it
    this.portrait = w / h < 1;
    // (and on a short one, until it takes no more than ~42 % of the height: the text is under it)
    this.camera.fov = this.portrait ? THREE.MathUtils.radToDeg(2 * Math.atan(0.235 / Math.min(w / h, 0.47))) : 38;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.dustU.uScale.value = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }

  // the rendering resolution only (it follows the device's speed)
  setPixelRatio(pr) {
    this.renderer.setPixelRatio(pr);
    this.resize();
  }

  async warmup() {
    this.update(0, 1 / 60);
    if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
    // the figures' textures go to the GPU now, not when each ring first comes into view
    this.scene.traverse((o) => {
      if (o.material && o.material.map) this.renderer.initTexture(o.material.map);
    });
    this.renderer.render(this.scene, this.camera);
  }

  /* ---------------- per frame ---------------- */
  update(s, dt) {
    this.uTime.value += dt;
    const t = this.uTime.value;
    const P = this.pointer;
    P.sx = lerp(P.sx, P.x, 0.05);
    P.sy = lerp(P.sy, P.y, 0.05);

    // camera on the path, looking one step ahead (= the next ring while reading)
    const cam = this.camera;
    const pos = this.pathAt(s, this.v1);
    const look = this.pathAt(s + 1, this.v2);
    pos.x += P.sx * 0.32;
    pos.y += P.sy * 0.2 + Math.sin(t * 0.5) * 0.03;
    look.x += P.sx * 0.1;
    look.y += P.sy * 0.07;
    cam.position.copy(pos);
    cam.lookAt(look);
    // bank gently into the curves
    const ahead = this.pathAt(s + 0.35, this.v3).x - this.pathAt(s, this.v4).x;
    this.roll = lerp(this.roll, clamp(ahead * -0.3, -0.1, 0.1), 0.05);
    cam.rotateZ(this.roll);
    // lens shift: while reading, the ring sits right of centre and leaves room for the text
    // (on a phone: in the upper part of the screen, the text is under it)
    const reading = smooth(0.25, 0.95, s) * (1 - smooth(7.6, 8.6, s));
    // (less on a near-square screen, where the rail on the right would meet the ring)
    const shift = this.portrait ? 0 : 0.075 * reading * clamp((this.camera.aspect - 1) / 0.45, 0.25, 1);
    // at the very start the first drop sits a little lower, clear of the title above it
    const drop = this.portrait ? 0.12 * (1 - smooth(0.1, 0.85, s)) - 0.14 * reading : 0.11 * (1 - smooth(0.1, 0.85, s));
    if (shift > 0.0005 || Math.abs(drop) > 0.0005) {
      cam.setViewOffset(this.width, this.height, -shift * this.width, -drop * this.height, this.width, this.height);
    } else cam.clearViewOffset();
    this.bg.position.copy(cam.position);

    // light: one mood per engagement, then into the ivory light
    const stage = s <= 1 ? 0 : s <= 7 ? (s - 1) / 2 : 3 + smooth(7.3, 8.9, s);
    const k0 = Math.min(Math.floor(stage), PALETTE.length - 2);
    const f = smooth(0, 1, stage - k0);
    const A = PALETTE[k0];
    const B = PALETTE[k0 + 1];
    const light = smooth(3, 4, stage);
    this.bgU.uBase.value.copy(A.base).lerp(B.base, f);
    this.bgU.uGlow.value.copy(A.glow).lerp(B.glow, f);
    this.bgU.uGlow2.value.copy(A.glow2).lerp(B.glow2, f);
    this.bgU.uAmt.value = lerp(A.amt, B.amt, f);
    this.bgU.uLight.value = light;
    const flood = smooth(7.5, 8.7, s);
    const wash = smooth(8.35, 9, s);
    this.bgU.uFlood.value = flood;
    this.bgU.uWash.value = wash;
    this.c1.copy(this.bgU.uBase.value).lerp(this.bgU.uGlow.value, 0.22 * this.bgU.uAmt.value + 0.5 * flood);
    this.c1.lerp(this.bgU.uIvory.value, wash);
    this.scene.fog.color.copy(this.c1);
    this.scene.fog.density = lerp(0.028, 0.06, flood);
    this.dustU.uColA.value.copy(this.bgU.uGlow.value);
    this.dustU.uGain.value = 0.9 * (1 - light * 0.8);

    // drops open into rings as the camera arrives; figures appear inside
    this.rings.forEach((r, i) => {
      const o = smooth(2 * i + 0.2, 2 * i + 0.95, s);
      // liquid overshoot while the hole opens
      const R = RING_R * (1 - Math.exp(-5.5 * o) * Math.cos(8.5 * o));
      r.u.uR.value = R;
      r.u.uTube.value = lerp(DROP_R, RING_T, easeOut(o));
      r.u.uWob.value = 0.05 + 0.1 * Math.sin(Math.PI * o);
      r.mat.thickness = lerp(1.7, 0.45, o);

      const dz = cam.position.z - r.base.z; // > 0 : ring ahead
      // the next drop only condenses once we have flown through the previous ring,
      // so nothing floats behind the figure being read
      const born = i === 0 ? lerp(0.55, 1, smooth(0, 0.7, s)) : smooth(2 * i - 0.25, 2 * i + 0.45, s);
      r.mesh.visible = dz > -3 && born > 0.001;
      const bob = Math.sin(t * 0.55 + i * 1.9) * 0.07;
      r.mesh.position.set(r.base.x, r.base.y + bob, r.base.z);
      r.mesh.scale.setScalar(easeOut(born));
      const near = smooth(18, 6, dz);
      r.mesh.rotation.set(
        -0.1 * near + P.sy * 0.12 * near + Math.sin(t * 0.3 + i) * 0.05,
        r.tilt * near + P.sx * 0.16 * near + Math.cos(t * 0.25 + i) * 0.06,
        t * 0.12 + i
      );

      const fo = smooth(0.5, 0.95, o) * smooth(0.9, 3.6, dz);
      r.fig.visible = fo > 0.002;
      r.fig.material.opacity = fo;
      r.fig.position.set(r.base.x, r.base.y + bob, r.base.z);
      r.fig.scale.setScalar(lerp(0.78, 1, easeOut(smooth(0.4, 1, o))));
      r.fig.quaternion.copy(cam.quaternion); // always square to the screen, even while banking
    });
  }

  render(dt = 1 / 60) {
    if (!this.active) return;
    this.update(this.s, Math.min(dt, 0.05));
    this.renderer.render(this.scene, this.camera);
  }
}
