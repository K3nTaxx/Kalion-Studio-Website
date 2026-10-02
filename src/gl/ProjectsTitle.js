import * as THREE from 'three';
import GLYPHS from './projectsTitleGlyphs.js';

/* ------------------------------------------------------------------
   "Projets réalisés" — extruded 3D letters that fly apart.

   1. ink    : a dark liquid rises from the bottom of the ivory page,
               with a glowing ember lip (the band's words sink into it)
   2. form   : the letters rise out of the ink and settle
   3. break  : the camera pushes into the middle of the word and the
               letters fly off in every direction, spinning

   "Projets" is solid ivory, "réalisés" keeps its outline style: a
   near-transparent body whose edges light up (fresnel).
------------------------------------------------------------------ */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

const CAM_Z = 7;
const FOV = 32;
// the two lines (em, y up). "réalisés" steps a little to the right, like the
// "Kalion / Studio" lockup, so the descender of the j clears the l below it
const LINE_Y = [0.08, -0.76];
const LINE_X = [0, 0.3];
const BLOCK = (() => {
  const l = GLYPHS.lines.map((line, i) => [LINE_X[i] - line.width / 2, LINE_X[i] + line.width / 2]);
  const left = Math.min(...l.map((v) => v[0]));
  const right = Math.max(...l.map((v) => v[1]));
  return { width: right - left, shift: -(left + right) / 2 };
})();

// the liquid front, shared by the ink and by the letters (which only exist inside the ink)
const WAVE = /* glsl */ `
float kNoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float a = fract(sin(i * 127.1) * 43758.5453);
  float b = fract(sin((i + 1.0) * 127.1) * 43758.5453);
  return mix(a, b, f * f * (3.0 - 2.0 * f));
}
float inkEdge(float x, float ink, float t) {
  // a slow swell and finer ripples, calm once the ink has covered everything
  float swell = sin(clamp(ink, 0.0, 1.0) * 3.14159);
  float wave = 0.05 * sin(x * 2.1 + t * 0.9) + 0.022 * sin(x * 5.3 - t * 1.4) + 0.035 * (kNoise1(x * 3.0 + t * 0.45) - 0.5);
  return mix(-0.16, 1.16, ink) + wave * (0.25 + 0.75 * swell);
}`;

const INK_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const INK_FRAG = /* glsl */ `
uniform float uInk;
uniform float uTime;
uniform float uAspect;
uniform float uFlash;
uniform vec3 uBase;
uniform vec3 uEmber;
uniform vec3 uAmber;
varying vec2 vUv;
${WAVE}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float blob(vec2 p, vec2 c, float k) { vec2 d = p - c; return exp(-dot(d, d) * k); }

void main() {
  float x = vUv.x * uAspect;
  float d = inkEdge(x, uInk, uTime) - vUv.y; // > 0 : inside the ink
  float a = smoothstep(-0.0022, 0.0022, d);

  // the ink is the site's dark background with its warm lights
  vec2 p = vec2(x, vUv.y);
  vec3 col = uBase;
  col += uEmber * 0.3 * blob(p, vec2(0.06 * uAspect, -0.16), 3.4);
  col += uAmber * 0.16 * blob(p, vec2(1.02 * uAspect, 0.7), 3.6);
  col += uEmber * (0.035 + uFlash) * blob(p, vec2(0.5 * uAspect, 0.52), 3.2);

  // glowing lip along the front
  float lip = exp(-abs(d) * 60.0) * (1.0 - smoothstep(0.86, 1.0, uInk));
  vec3 lipCol = mix(uEmber, vec3(1.0, 0.78, 0.58), 0.3);
  vec3 outc = col * a + lipCol * lip * 0.85;
  float outa = max(a, lip * 0.5);
  outc += (hash(gl_FragCoord.xy + fract(uTime) * 71.0) - 0.5) / 200.0 * a;
  gl_FragColor = vec4(outc, outa);
  #include <colorspace_fragment>
}`;

// letters: only drawn inside the ink, fade out while flying away; "réalisés" keeps
// its outline style (near-transparent body, edges lit by a fresnel term)
function patchLetter(material, U, outline, inkU) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uFade = U.uFade;
    sh.uniforms.uRes = U.uRes;
    sh.uniforms.uInk = inkU.uInk;
    sh.uniforms.uTime = inkU.uTime;
    sh.uniforms.uAspect = inkU.uAspect;
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFade;
        uniform vec2 uRes;
        uniform float uInk;
        uniform float uTime;
        uniform float uAspect;
        ${WAVE}`
      )
      // the letters only exist inside the ink: they surface through its front
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        vec2 kUv = gl_FragCoord.xy / uRes;
        if (kUv.y > inkEdge(kUv.x * uAspect, uInk, uTime) + 0.001) discard;`
      )
      .replace(
        '#include <opaque_fragment>',
        outline
          ? `float kF = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);
            outgoingLight += vec3(1.0, 0.93, 0.85) * kF * 1.1;
            diffuseColor.a = clamp(0.07 + kF * 1.4, 0.0, 1.0) * uFade;
            #include <opaque_fragment>`
          : `diffuseColor.a *= uFade;
            #include <opaque_fragment>`
      );
  };
  material.customProgramCacheKey = () => (outline ? 'kalion-letter-outline' : 'kalion-letter-solid');
}

function shapesOf(cmds) {
  const sp = new THREE.ShapePath();
  cmds.forEach((c) => {
    if (c[0] === 'M') sp.moveTo(c[1], -c[2]);
    else if (c[0] === 'L') sp.lineTo(c[1], -c[2]);
    else if (c[0] === 'Q') sp.quadraticCurveTo(c[1], -c[2], c[3], -c[4]);
    else if (c[0] === 'C') sp.bezierCurveTo(c[1], -c[2], c[3], -c[4], c[5], -c[6]);
  });
  return sp.toShapes(false);
}

export class ProjectsTitle {
  // opts.dpr: the rendering resolution
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true });
    renderer.setPixelRatio(opts.dpr || Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 60);
    this.camera.position.set(0, 0, CAM_Z);

    // ink layer, drawn first in its own pass
    this.bgScene = new THREE.Scene();
    this.bgCam = new THREE.Camera();
    this.inkU = {
      uInk: { value: 0 },
      uTime: { value: 0 },
      uAspect: { value: 16 / 9 },
      uFlash: { value: 0 },
      uBase: { value: new THREE.Color('#100c0a') },
      uEmber: { value: new THREE.Color('#ff5b24') },
      uAmber: { value: new THREE.Color('#ff8f4d') },
    };
    const inkMat = new THREE.ShaderMaterial({
      uniforms: this.inkU,
      vertexShader: INK_VERT,
      fragmentShader: INK_FRAG,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), inkMat);
    quad.frustumCulled = false;
    this.bgScene.add(quad);

    // (the lighting is built in warmup(): it is the heaviest step, it gets its own frame)
    this.buildLetters();

    this.state = { ink: 0, form: 0, brk: 0 };
    this.pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    this.time = 0;
    this.active = false;
    this.resize();
  }

  buildLights() {
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
    panel(9, 5, '#ff5b24', 3.0, -6, -3, 3); // ember key, low left
    panel(6, 7, '#ff9a4d', 2.0, 7, 1, -2); // amber fill, right
    panel(8, 2.4, '#fff1e2', 5.0, 0, 7, 3); // soft box above
    panel(6, 1.6, '#fff1e2', 3.0, -1, 1, 9); // strip in front: long highlight on the faces
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(env, 0.035);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();

    const key = new THREE.DirectionalLight('#fff1e2', 1.6);
    key.position.set(-3, 4, 6);
    const rim = new THREE.DirectionalLight('#ff6a30', 2.4);
    rim.position.set(4, -2, -4);
    this.scene.add(key, rim);
  }

  buildLetters() {
    this.U = { uFade: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) } };
    const solid = new THREE.MeshStandardMaterial({
      color: '#ece6dc',
      roughness: 0.36,
      metalness: 0,
      envMapIntensity: 1.1,
      transparent: true,
    });
    patchLetter(solid, this.U, false, this.inkU);
    const outline = new THREE.MeshStandardMaterial({
      color: '#ece6dc',
      roughness: 0.22,
      metalness: 0,
      envMapIntensity: 1.5,
      transparent: true,
      depthWrite: false,
    });
    patchLetter(outline, this.U, true, this.inkU);

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.letters = [];
    const extrude = {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.0045,
      bevelSegments: 3,
      curveSegments: 9,
    };
    const rnd = () => Math.random();
    let order = 0;
    GLYPHS.lines.forEach((line, li) => {
      const x0 = LINE_X[li] + BLOCK.shift - line.width / 2;
      line.glyphs.forEach((g) => {
        const shapes = shapesOf(g.cmds);
        if (!shapes.length) return;
        const geo = new THREE.ExtrudeGeometry(shapes, extrude);
        geo.computeBoundingBox();
        const c = new THREE.Vector3();
        geo.boundingBox.getCenter(c);
        geo.translate(-c.x, -c.y, -c.z);
        const delay = rnd();
        const mesh = new THREE.Mesh(geo, li === 0 ? solid : outline);
        mesh.renderOrder = li; // the outline line after the solid one
        this.group.add(mesh);
        const home = new THREE.Vector3(x0 + c.x, LINE_Y[li] + c.y, 0);
        // where it flies when we go through the word: away from the middle, in disorder
        const out = new THREE.Vector2(home.x + (rnd() - 0.5) * 0.4, home.y * 1.7 + (rnd() - 0.5) * 0.9).normalize();
        this.letters.push({
          mesh,
          home,
          order: order++,
          delay,
          dir: out.normalize(),
          dist: 1.7 + rnd() * 2.2,
          push: 1.0 + rnd() * 3.2,
          axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, (rnd() - 0.5) * 0.8).normalize(),
          spin: 2.0 + rnd() * 3.4,
          phase: rnd() * Math.PI * 2,
        });
      });
    });
    this.count = order;
  }

  resize() {
    const w = Math.max(this.canvas.clientWidth || window.innerWidth, 2);
    const h = Math.max(this.canvas.clientHeight || window.innerHeight, 2);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.inkU.uAspect.value = w / h;
    this.renderer.getDrawingBufferSize(this.U.uRes.value);
    // the word fills about 62% of the width, like the typographic title it replaces
    // (on a tall screen, most of it)
    const visH = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const visW = visH * (w / h);
    this.scale = Math.min((visW * (w < h ? 0.86 : 0.64)) / BLOCK.width, (visH * 0.62) / 1.5);
    this.group.scale.setScalar(this.scale);
  }

  // the rendering resolution only (it follows the device's speed): the drawing buffer is
  // resized once (three's setPixelRatio), the layout is not measured again
  setPixelRatio(pr) {
    this.renderer.setPixelRatio(pr);
    this.renderer.getDrawingBufferSize(this.U.uRes.value);
  }

  // nextFrame: lets the page paint between the heavy steps (the preloader keeps moving);
  // onHeavyDone: called once the blocking part (the lighting) is behind
  async warmup(nextFrame = () => Promise.resolve(), onHeavyDone = () => {}) {
    await nextFrame();
    this.buildLights();
    onHeavyDone();
    await nextFrame();
    this.active = true;
    this.state.ink = 1;
    this.state.form = 1;
    // compiled in the background first: the first render then doesn't block the page
    if (this.renderer.compileAsync) {
      await this.renderer.compileAsync(this.scene, this.camera);
      await this.renderer.compileAsync(this.bgScene, this.bgCam);
    }
    this.render(1 / 60);
    this.state.ink = 0;
    this.state.form = 0;
    this.render(1 / 60);
    this.active = false;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const { ink, form, brk } = this.state;
    const P = this.pointer;
    P.sx = lerp(P.sx, P.x, 0.06);
    P.sy = lerp(P.sy, P.y, 0.06);

    this.inkU.uInk.value = ink;
    this.inkU.uTime.value = t;
    // a flash of light behind the word as we go through it
    this.inkU.uFlash.value = 0.32 * Math.sin(Math.PI * smooth(0.02, 0.45, brk));

    // camera pushes into the word
    const push = brk * brk;
    this.camera.position.set(P.sx * 0.25 * (1 - brk), P.sy * 0.15 * (1 - brk), lerp(CAM_Z, 1.6, push));
    this.camera.fov = lerp(FOV, 44, push);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0, -2);

    // the whole word leans towards the cursor
    this.group.rotation.set(-P.sy * 0.12, P.sx * 0.2, 0);

    this.U.uFade.value = 1 - smooth(0.62, 0.98, brk);

    this.letters.forEach((l) => {
      // rise out of the ink, one letter after the other
      const f = easeOut(clamp((form - l.order * 0.032) / 0.52, 0, 1));
      const rise = 1 - f;
      // away from the middle and towards the camera, spinning
      const k = clamp((brk - l.delay * 0.12) / (1 - l.delay * 0.12), 0, 1);
      const e = k * k;
      const bob = Math.sin(t * 0.8 + l.phase) * 0.012 * (1 - brk);
      const m = l.mesh;
      m.position.set(
        l.home.x + l.dir.x * e * l.dist,
        l.home.y + l.dir.y * e * l.dist - rise * rise * 2.4 + bob,
        l.home.z + e * l.push - rise * 1.4
      );
      m.rotation.set(rise * 1.1 + l.axis.x * e * l.spin, l.axis.y * e * l.spin, l.axis.z * e * l.spin);
      m.visible = f > 0.001;
    });
  }

  render(dt = 1 / 60) {
    if (!this.active) return;
    this.update(Math.min(dt, 0.05));
    const r = this.renderer;
    r.clear();
    r.render(this.bgScene, this.bgCam);
    r.render(this.scene, this.camera);
  }
}
