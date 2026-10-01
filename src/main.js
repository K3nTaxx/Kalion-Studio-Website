import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource/dm-mono/400.css';
import './styles.css';
import './mobile.css';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { LiquidScene } from './gl/LiquidScene.js';
import { JourneyScene, STOPS } from './gl/JourneyScene.js';
import { ProjectsTitle } from './gl/ProjectsTitle.js';
import { DropsScene } from './gl/DropsScene.js';
import { ReviewsScene } from './gl/ReviewsScene.js';

gsap.registerPlugin(ScrollTrigger);

// dev only: the time each per-frame callback takes (window.__tickProf())
if (import.meta.env.DEV) {
  const add = gsap.ticker.add.bind(gsap.ticker);
  const remove = gsap.ticker.remove.bind(gsap.ticker);
  const prof = [];
  const wraps = new Map();
  gsap.ticker.remove = (fn) => remove(wraps.get(fn) || fn);
  gsap.ticker.add = (fn, ...rest) => {
    const rec = { at: new Error().stack.split('\n')[2].trim().replace(/^.*main\.js[^:]*:/, 'main:').replace(/\)$/, ''), ms: 0, n: 0, max: 0 };
    prof.push(rec);
    const wrapped = (...a) => {
      const t = performance.now();
      fn(...a);
      const d = performance.now() - t;
      rec.ms += d;
      rec.n++;
      if (d > rec.max) rec.max = d;
    };
    wraps.set(fn, wrapped);
    return add(wrapped, ...rest);
  };
  window.__tickProf = (reset) => {
    const out = prof.filter((r) => r.n).map((r) => `${r.at} avg ${(r.ms / r.n).toFixed(2)} max ${r.max.toFixed(1)}`).join('\n');
    if (reset) prof.forEach((r) => (r.ms = r.n = r.max = 0));
    return out;
  };
}

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Inline styles written every frame by the scroll scenes: only when they change (an
// unchanged write still makes the browser restyle the element, and its children for an
// inherited property — on a phone that adds up)
const styleMemo = new WeakMap();
const memoOf = (el) => {
  let m = styleMemo.get(el);
  if (!m) styleMemo.set(el, (m = {}));
  return m;
};
const css = (el, prop, v) => {
  const m = memoOf(el);
  if (m[prop] === v) return;
  m[prop] = v;
  el.style[prop] = v;
};
const cssVar = (el, name, v) => {
  const m = memoOf(el);
  if (m[name] === v) return;
  m[name] = v;
  el.style.setProperty(name, v);
};

const root = document.documentElement;
window.__kalionStarted = true; // (public/boot-guard.js: the script runs)
// dev only: http://localhost:5188/?fast skips the preloader choreography
const FAST = import.meta.env.DEV && new URLSearchParams(location.search).has('fast');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

// Two layouts: the computer one (landscape) and the phone one (portrait screens, small
// windows, and phones held sideways — those are asked to turn back, see .rotate). Crossing
// from one to the other (a tablet turned, a window resized past it) reloads the page.
const MQ_MOBILE = '(max-aspect-ratio: 1/1), (max-width: 760px), (pointer: coarse) and (max-height: 500px)';
const MOBILE = matchMedia(MQ_MOBILE).matches;
const TOUCH = !finePointer;
root.classList.toggle('is-mobile', MOBILE);
root.classList.toggle('is-touch', TOUCH);
matchMedia(MQ_MOBILE).addEventListener('change', () => {
  // (never while someone is typing in the form: a keyboard can change the screen's shape)
  const f = document.activeElement;
  if (f && /^(INPUT|TEXTAREA)$/.test(f.tagName)) return;
  location.reload();
});

// The viewport the choreographies are laid out on. On phones the browser bars come and go
// while scrolling (the visible height changes all the time): the scenes keep the full
// height (100vh, the bars hidden) and only a change of width (turning the phone) counts
// as a resize.
const vp = { w: window.innerWidth, h: window.innerHeight };
const vhProbe = document.createElement('i');
vhProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100vh;visibility:hidden;pointer-events:none';
document.body.append(vhProbe);
const measureVp = () => {
  vp.w = window.innerWidth;
  vp.h = ((MOBILE || TOUCH) && vhProbe.offsetHeight) || window.innerHeight;
};
measureVp();
ScrollTrigger.config({ ignoreMobileResize: true });
// a real resize (not the bars of a phone's browser): fn() runs on it
const realResizeFns = [];
const onRealResize = (fn) => realResizeFns.push(fn);
{
  let lw = window.innerWidth;
  let lh = window.innerHeight;
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const real = w !== lw || (!TOUCH && h !== lh);
    lw = w;
    lh = h;
    if (!real) return;
    measureVp();
    realResizeFns.forEach((fn) => fn());
  });
}

// WebGL resolution: capped (the shaders are heavy). On phones and tablets a governor
// watches the frame rate and lowers it (then raises it again) so that nothing stutters.
// (dev only: ?dpr=3 renders the scenes at full resolution, for the social visuals)
const DEV_DPR = import.meta.env.DEV ? +new URLSearchParams(location.search).get('dpr') : 0;
const glDpr = (max, mobileMax = max) => DEV_DPR || Math.min(window.devicePixelRatio || 1, MOBILE ? mobileMax : max);
const glScenes = []; // { scene, max, min }: scene.setPixelRatio(pr)
const quality = { scale: 1 };
function applyQuality(scale) {
  quality.scale = scale;
  glScenes.forEach((g) => g.scene && g.scene.setPixelRatio(Math.max(g.min, g.max * scale)));
}
function initQuality() {
  if (import.meta.env.DEV) window.__q = () => quality.scale; // dev only: the tests read it
  if (!TOUCH && !MOBILE) return; // (computers: the fixed caps are fine)
  let acc = 0;
  let n = 0;
  let good = 0;
  let settle = 60;
  let before = 0; // the average frame before the last step down
  let capped = false; // the screen runs at 30 Hz (power saving): lowering doesn't help
  gsap.ticker.add((t, dms) => {
    if (document.hidden || dms > 250) return;
    if (settle > 0) {
      settle--;
      return;
    }
    acc += dms;
    n++;
    if (n < 40) return;
    const avg = acc / n;
    acc = 0;
    n = 0;
    if (before && avg > before * 0.93 && avg > 24) capped = true; // it did not get faster
    before = 0;
    if (avg > (capped ? 40 : 21) && quality.scale > 0.5) {
      before = avg;
      applyQuality(Math.max(0.5, quality.scale * 0.8));
      settle = 20;
      good = 0;
    } else if (avg < 14.5) {
      if (++good >= 5 && quality.scale < 1) {
        applyQuality(Math.min(1, quality.scale * 1.12));
        settle = 20;
        good = 0;
      }
    } else good = 0;
  });
}

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

/* ------------------------------------------------------------------
   Smooth scroll
------------------------------------------------------------------ */
const lenis = new Lenis({ lerp: reduced ? 1 : 0.085, wheelMultiplier: 0.9, smoothWheel: !reduced });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();
if (import.meta.env.DEV) window.__lenis = lenis; // dev only: lets the preview tests drive the scroll

function scrollToTarget(href) {
  // the manifesto: land once all of it is lit (the lens has opened, every word read)
  if (href === '#apropos' && aboutY) {
    lenis.scrollTo(aboutY(), { duration: 2.2, easing: (t) => 1 - Math.pow(1 - t, 4) });
    return;
  }
  // the reviews: land once they have spread out of the sphere
  if (href === '#avis' && reviewsY) {
    lenis.scrollTo(reviewsY(), { duration: 2.2, easing: (t) => 1 - Math.pow(1 - t, 4) });
    return;
  }
  if (href === '#contact' && contactY) {
    lenis.scrollTo(contactY(), { duration: 2.2, easing: (t) => 1 - Math.pow(1 - t, 4) });
    return;
  }
  if (href === '#tarifs' && pricingY) {
    lenis.scrollTo(pricingY(), { duration: 2.2, easing: (t) => 1 - Math.pow(1 - t, 4) });
    return;
  }
  if (href === '#projets' && projectsGalleryY) {
    lenis.scrollTo(projectsGalleryY(), { duration: 2.2, easing: (t) => 1 - Math.pow(1 - t, 4) });
    return;
  }
  const target = href === '#top' ? 0 : $(href);
  if (target === null) return;
  lenis.scrollTo(target, { duration: 2.2, easing: (t) => 1 - Math.pow(1 - t, 4) });
}

$$('[data-scroll]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('#')) return;
    e.preventDefault();
    if (a.dataset.project) preselect('type', a.dataset.project);
    // (from the bar while the phone menu is open: the menu closes first)
    if (menu.open) menu.hide(() => scrollToTarget(href));
    else scrollToTarget(href);
  });
});

/* ------------------------------------------------------------------
   Small global details
------------------------------------------------------------------ */
function makeGrain() {
  const size = 180;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 20;
  }
  ctx.putImageData(img, 0, 0);
  // (encoded off the main thread)
  c.toBlob((blob) => {
    if (blob) $('.grain').style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
  });
}

let toastTimer;
function toast(msg) {
  const t = $('.toast');
  t.textContent = msg;
  t.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-show'), 2600);
}

function initCursor() {
  if (!finePointer) return;
  root.classList.add('has-cursor');
  const c = $('.cursor');
  const d = $('.cursor-dot');
  const label = $('.cursor__label');
  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  let cx = mx;
  let cy = my;
  window.addEventListener('mousemove', (e) => {
    mx = e.clientX;
    my = e.clientY;
    d.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
    root.classList.remove('cursor-hidden');
  });
  document.addEventListener('mouseleave', () => root.classList.add('cursor-hidden'));
  window.addEventListener('mousedown', () => c.classList.add('is-down'));
  window.addEventListener('mouseup', () => c.classList.remove('is-down'));
  gsap.ticker.add(() => {
    cx = lerp(cx, mx, 0.17);
    cy = lerp(cy, my, 0.17);
    c.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
  });
  document.addEventListener('mouseover', (e) => {
    const labelled = e.target.closest('[data-cursor]');
    const interactive = e.target.closest('a, button, .chips label, input, textarea');
    c.classList.toggle('is-label', !!labelled);
    c.classList.toggle('is-hover', !labelled && !!interactive && !e.target.closest('input, textarea'));
    d.style.opacity = labelled ? '0' : '';
    if (labelled) label.textContent = labelled.dataset.cursor;
  });
}

function initMagnetic() {
  if (!finePointer) return;
  $$('[data-magnetic]').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.9, ease: 'elastic.out(1, 0.4)' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.9, ease: 'elastic.out(1, 0.4)' });
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * 0.32);
      yTo((e.clientY - r.top - r.height / 2) * 0.4);
    });
    el.addEventListener('mouseleave', () => {
      xTo(0);
      yTo(0);
    });
  });
}

// the bar leaves together with the hero texts (first pixels of scroll),
// and comes back as soon as the visitor scrolls up
function initNav() {
  const nav = $('.nav');
  lenis.on('scroll', ({ scroll, direction }) => {
    if (scroll < 6) nav.classList.remove('is-hidden');
    else if (direction === 1) nav.classList.add('is-hidden');
    else if (direction === -1) nav.classList.remove('is-hidden');
  });
}

// Phone menu: the page opens from the button as a growing circle (like "Découvrir plus"),
// the links rise one after the other; a link closes it, then the page travels there
// the phone menu's state: the bar's own links close it before they travel (see [data-scroll])
const menu = { open: false, hide: (then) => then && then() };

function initMenu() {
  const panel = $('#menu');
  const btn = $('.nav__burger');
  const nav = $('.nav');
  const links = $$('.menu__links a');
  const foot = $$('.menu__foot > *');
  const behind = [$('main'), $('.footer')].filter(Boolean);
  let tl = null;
  const circle = (r) => {
    const b = btn.getBoundingClientRect();
    return `circle(${r}px at ${(b.left + b.width / 2).toFixed(1)}px ${(b.top + b.height / 2).toFixed(1)}px)`;
  };
  const reach = () => Math.hypot(window.innerWidth, window.innerHeight) + 40;
  const show = () => {
    menu.open = true;
    lenis.stop();
    root.classList.add('menu-open');
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-label', 'Fermer le menu');
    panel.hidden = false;
    panel.scrollTop = 0;
    behind.forEach((el) => (el.inert = true)); // (the page under it can't be reached)
    if (tl) tl.kill();
    tl = gsap
      .timeline()
      .fromTo(panel, { clipPath: circle(0) }, { clipPath: circle(reach()), duration: 0.9, ease: 'expo.inOut' }, 0)
      .fromTo(links, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.9, stagger: 0.05, ease: 'expo.out' }, 0.28)
      .fromTo(foot, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.08, ease: 'expo.out' }, 0.55);
    links[0].focus({ preventScroll: true });
  };
  const hide = (then) => {
    if (!menu.open) {
      if (then) then();
      return;
    }
    menu.open = false;
    root.classList.remove('menu-open');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Ouvrir le menu');
    behind.forEach((el) => (el.inert = false));
    if (tl) tl.kill();
    tl = gsap
      .timeline({
        onComplete: () => {
          panel.hidden = true;
          lenis.start();
          if (then) then();
          else btn.focus({ preventScroll: true });
        },
      })
      .to(links, { yPercent: -60, opacity: 0, duration: 0.35, stagger: 0.02, ease: 'power2.in' }, 0)
      .to(foot, { opacity: 0, duration: 0.25 }, 0)
      .to(panel, { clipPath: circle(0), duration: 0.7, ease: 'expo.inOut' }, 0.12);
  };
  menu.hide = hide;
  btn.addEventListener('click', () => (menu.open ? hide() : show()));
  $$('[data-menu-link]', panel).forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = a.getAttribute('href');
      hide(() => scrollToTarget(href));
    })
  );
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) hide();
  });
  // (the bar stays on screen while the menu is open)
  lenis.on('scroll', () => menu.open && nav.classList.remove('is-hidden'));
}

// Phones: the light rig is drawn small on a canvas and stretched over the screen (soft
// gradients lose nothing): five huge blurred layers would cost the phone's memory
function initLightsCanvas() {
  const host = $('.lights');
  const c = document.createElement('canvas');
  c.className = 'lights__cv';
  host.append(c);
  const ctx = c.getContext('2d');
  const size = () => {
    c.width = 72;
    c.height = Math.round((72 * vp.h) / vp.w);
  };
  size();
  onRealResize(size);
  // the five lights (as in the CSS): centre and radius in screen widths/heights, colour,
  // drift with the scroll, slow wander
  const L = [
    { x: -0.2, y: 1.1, r: 1.1, c: [255, 91, 36], a: [0.5, 0.16], sx: 0.3, sy: -0.25, w: 26 },
    { x: 1.1, y: 0.3, r: 0.8, c: [255, 143, 77], a: [0.34, 0.1], sx: -0.18, sy: 0.3, w: 32 },
    { x: 0.75, y: -0.15, r: 0.7, c: [163, 186, 242], a: [0.12, 0], sx: 0, sy: 0, w: 38 },
    { x: 0.3, y: -0.1, r: 0.65, c: [255, 110, 60], a: [0.16, 0], sx: 0.4, sy: 0, w: 29 },
    { x: 0.6, y: 0.75, r: 0.6, c: [214, 64, 30], a: [0.2, 0], sx: -0.3, sy: -0.4, w: 36 },
  ];
  let sp = 0;
  lenis.on('scroll', ({ scroll, limit }) => (sp = limit > 0 ? scroll / limit : 0));
  let frame = 0;
  gsap.ticker.add((t) => {
    if (frame++ % 2) return; // (30 fps is plenty for lights this slow)
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    L.forEach((l, i) => {
      const wob = Math.sin((t / l.w) * Math.PI * 2 + i) * 0.5 + 0.5;
      const x = (l.x + l.sx * sp + 0.08 * wob) * W;
      const y = (l.y + l.sy * sp - 0.06 * wob) * H;
      const r = l.r * Math.max(W, H) * (1 + 0.1 * wob);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const [R, G, B] = l.c;
      g.addColorStop(0, `rgba(${R},${G},${B},${l.a[0]})`);
      g.addColorStop(0.45, `rgba(${R},${G},${B},${l.a[1] || l.a[0] * 0.35})`);
      g.addColorStop(1, `rgba(${R},${G},${B},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    });
  });
}

// After a window resize, once ScrollTrigger has laid the pinned sections out again: a
// canvas inside a pinned block only has its new size then (before, it keeps the old one)
const resizedFns = [];
let resizedPending = false;
onRealResize(() => (resizedPending = true));
ScrollTrigger.addEventListener('refresh', () => {
  if (!resizedPending) return;
  resizedPending = false;
  resizedFns.forEach((fn) => fn());
});
const onResized = (fn) => resizedFns.push(fn);

// A resize keeps the visitor where they were: the sections are made of screens (their
// pinned scenes last so many window heights), so we note which section we are in and how
// many screens into it, and come back to the same point once the page is laid out again.
function initResizeKeep() {
  const parts = [...$$('main > *'), $('.footer')].filter(Boolean);
  let tops = [];
  let vh = vp.h;
  let last = window.scrollY;
  let anchor = null;
  const measure = () => {
    tops = parts.map((el) => el.getBoundingClientRect().top + window.scrollY);
    vh = vp.h;
  };
  measure();
  lenis.on('scroll', ({ scroll }) => {
    if (!anchor) last = scroll;
  });
  onRealResize(() => {
    if (anchor) return;
    let i = 0;
    tops.forEach((t, k) => {
      if (t <= last + 1) i = k;
    });
    anchor = { i, screens: (last - tops[i]) / vh };
  });
  ScrollTrigger.addEventListener('refresh', () => {
    measure();
    if (!anchor) return;
    const y = tops[anchor.i] + anchor.screens * vp.h;
    anchor = null;
    lenis.scrollTo(clamp(y, 0, ScrollTrigger.maxScroll(window)), { immediate: true, force: true });
  });
}

// the fixed light rig drifts as the page goes by
function initLights() {
  if (TOUCH || MOBILE) return initLightsCanvas();
  const lights = $('.lights');
  lenis.on('scroll', ({ scroll, limit }) => {
    lights.style.setProperty('--sp', limit > 0 ? (scroll / limit).toFixed(4) : '0');
  });
}

/* ------------------------------------------------------------------
   WebGL — liquid glass typography
   hero   : a drop falls onto "Kalion Studio", splashes and swallows it
   portal : the drop opens like a lens onto the manifesto (no fade)
   footer : the liquid condenses back into the word
------------------------------------------------------------------ */
const canvas = $('.gl');
let gl = null;
let footerH = 0;
const measureFooter = () => (footerH = $('.footer').offsetHeight);
ScrollTrigger.addEventListener('refresh', measureFooter);
const glState = { hero: 0, portal: 0, footer: 0 };

function syncGL() {
  if (!gl) return;
  let visible;
  if (glState.footer > 0.001) {
    gl.setMode('footer');
    // (phone: the word sits in the band kept for it at the bottom of the footer, whatever
    // the footer's height — 150 px above its end, under the links)
    if (MOBILE && footerH) gl.layout.footer = 0.5 - (footerH - 150) / vp.h;
    gl.setFooter(glState.footer);
    visible = true;
    // sections are transparent (lit background): the liquid only shows inside the footer,
    // fading in over its first lines (no seam with the contact above)
    const top = Math.max(0, $('.footer').getBoundingClientRect().top);
    // (always a gradient, even once the footer fills the screen: switching the mask off
    // makes the browser rebuild the layer, a hitch right at the end of the page)
    const mask = top > 0 ? `linear-gradient(to bottom, transparent ${top.toFixed(0)}px, #000 ${(top + 180).toFixed(0)}px)` : 'linear-gradient(#000, #000)';
    css(canvas, 'webkitMaskImage', mask);
    css(canvas, 'maskImage', mask);
    gl.setFooterShift(top / vp.h); // the word comes up with the footer
  } else {
    gl.setMode('hero');
    gl.setHero(glState.hero);
    gl.setPortal(glState.portal);
    visible = glState.portal < 0.999;
    css(canvas, 'webkitMaskImage', 'none');
    css(canvas, 'maskImage', 'none');
  }
  css(canvas, 'visibility', visible ? 'visible' : 'hidden');
  gl.active = visible;
  // over the liquid, the glass drop replaces the cursor ring
  const liquidCursor = glState.footer > 0.001 ? glState.footer > 0.2 : glState.portal < 0.05;
  root.classList.toggle('cursor-liquid', liquidCursor);
  // while the big liquid "Kalion Studio" is on screen, the nav only shows the K symbol
  const liquidName = glState.footer > 0.001 ? glState.footer > 0.3 : glState.portal < 0.5;
  root.classList.toggle('liquid-on', liquidName);
}

// the liquid word is set in Clash Display (Fontshare, free for commercial use)
const WORD_FONT = { family: 'Clash Display', weight: 600, width: 0.66 };

async function initGL() {
  try {
    // (on a phone the word takes most of the width)
    let font = MOBILE ? { ...WORD_FONT, width: 0.8 } : WORD_FONT;
    // dev only: ?wordw=0.86&wordy=0.02 (width and height of the word, for the social visuals)
    const devQ = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
    if (devQ && devQ.get('wordw')) font = { ...font, width: +devQ.get('wordw') };
    await document.fonts.load(`${font.weight} 120px "${font.family}"`);
    gl = new LiquidScene(canvas, font, { mobile: MOBILE, dpr: glDpr(1.5, 1.5) });
    if (MOBILE) Object.assign(gl.layout, { hero: 0.03, footer: -0.25, footerScale: 0.94 });
    if (devQ && devQ.get('wordy')) gl.layout.hero = +devQ.get('wordy');
    if (import.meta.env.DEV) window.__gl = gl; // dev only: the visuals place its droplets
    if (devQ && devQ.get('wordx')) {
      gl.offsetX = +devQ.get('wordx');
      gl.drawText();
    }
    if (devQ && devQ.get('bevel')) gl.uniforms.uBevel.value = +devQ.get('bevel');
    glScenes.push({ scene: gl, max: glDpr(1.5, 1.5), min: 0.8 });
    await gl.warmup();
    gsap.ticker.add(() => gl.render());
    let rt;
    onRealResize(() => {
      clearTimeout(rt);
      rt = setTimeout(() => gl.resize(), 150);
    });
  } catch (err) {
    console.warn(err);
    gl = null;
    root.classList.add('no-webgl');
  }
}

/* ------------------------------------------------------------------
   Preloader — the logo (ink on ivory) and a small counter rising from 0
   to 100. The counter's digits roll on the browser's compositor (CSS, see
   index.html): the heavy work of loading can't make it stall. Once the
   site is ready, it speeds up to 100, and the page opens: a cartoon
   run-up (the logo draws back, the orb of the "i" squashes and springs),
   then we dive into the orb: the logo zooms past, the orb fills the
   screen with ember, its middle opens and its rim rushes out — we are
   through. Out of it, drops burst and fly onto the letters of the liquid
   "Kalion Studio", which writes itself under them. Then the menu, the
   button and the side indicator come in.
------------------------------------------------------------------ */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the counter: speeds up to the end (within `within` s), then shows 100
function finishCounter(within = 0.4) {
  const strips = $$('.loader__strip--t, .loader__strip--u');
  const anims = strips.flatMap((el) => (el.getAnimations ? el.getAnimations() : []));
  const done = () => {
    strips.forEach((el) => (el.style.animation = 'none'));
    const cell = 1.15; // em (index.html)
    $('.loader__strip--h').style.transform = `translateY(${-cell}em)`; // 1
    $('.loader__strip--t').style.transform = `translateY(${-10 * cell}em)`; // 0
    $('.loader__strip--u').style.transform = 'translateY(0)'; // 0
  };
  if (!anims.length) {
    done();
    return Promise.resolve();
  }
  anims.forEach((a) => {
    const total = a.effect.getComputedTiming().duration;
    const left = (total - (a.currentTime || 0)) / 1000;
    if (left > within) a.updatePlaybackRate(left / Math.max(within, 0.01));
  });
  return Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(done);
}

function playIntro() {
  window.__kalionOpened = true; // (public/boot-guard.js: nothing to do)
  const W = window.innerWidth;
  const H = window.innerHeight;
  const el = $('.loader');
  const brand = $('.loader__brand');
  const orbEl = $('.loader__orb');
  const box = orbEl.getBoundingClientRect();
  const o = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const r0 = box.width / 2;
  const reach = Math.hypot(Math.max(o.x, W - o.x), Math.max(o.y, H - o.y)) + 30;

  // The orb becomes a full-screen ember layer cut to its disc (a mask: it can grow as
  // big as the screen and stay crisp). Later a hole opens in its middle: we go through.
  const ember = document.createElement('i');
  ember.style.cssText = 'position:fixed;inset:0;z-index:10001;pointer-events:none;background:#ff5b24';
  document.body.append(ember);
  orbEl.style.opacity = '0';
  const orb = { R: r0, sx: 1, sy: 1, hole: 0 };
  const draw = () => {
    const rx = Math.max(orb.R * orb.sx, 0.5);
    const ry = Math.max(orb.R * orb.sy, 0.5);
    const e = Math.min(100 / rx, 8); // ≈ 1 px of soft edge, in % of the radius
    const k = Math.min((orb.hole / Math.max(orb.R, 1)) * 100, 99);
    const inner = orb.hole > 0.5 ? `transparent ${k.toFixed(3)}%, #000 ${Math.min(k + e * 3, 99.5).toFixed(3)}%, ` : '#000 0%, ';
    const m = `radial-gradient(${rx.toFixed(1)}px ${ry.toFixed(1)}px at ${o.x.toFixed(1)}px ${o.y.toFixed(1)}px, ${inner}#000 ${(100 - e).toFixed(3)}%, transparent 100%)`;
    ember.style.webkitMaskImage = m;
    ember.style.maskImage = m;
    // the hole goes through the preloader too: the page shows in it
    if (orb.hole > 0.5) {
      const lm = `radial-gradient(circle ${orb.hole.toFixed(1)}px at ${o.x.toFixed(1)}px ${o.y.toFixed(1)}px, transparent calc(100% - 1px), #000 100%)`;
      el.style.webkitMaskImage = lm;
      el.style.maskImage = lm;
    }
  };
  draw();
  gsap.ticker.add(draw);

  // the logo zooms around the orb: we dive into the dot of the "i"
  const bb = brand.getBoundingClientRect();
  gsap.set(brand, { transformOrigin: `${o.x - bb.left}px ${o.y - bb.top}px`, willChange: 'transform' });
  const zoom = { z: 1 };
  const applyZoom = () => {
    gsap.set(brand, { scale: zoom.z });
    orb.R = r0 * zoom.z;
  };

  // the hero's drops burst out of the orb, as we come through it
  const startWord = () => gl && gl.assemble((o.x / vp.w - 0.5) * (vp.w / vp.h), 0.5 - o.y / vp.h);

  const DIVE = 0.36; // after the run-up, the dive
  const DIVE_T = 0.85;
  const THROUGH = DIVE + DIVE_T - 0.2; // a hole opens in the orb: we go through it
  const WORD = THROUGH + 0.12;
  const UI = WORD + 1.45; // the word has formed: the interface comes in
  const zMax = reach / r0;
  const tl = gsap.timeline({
    onComplete: () => {
      gsap.ticker.remove(draw);
      ember.remove();
    },
  });
  tl
    // the counter has done its job
    .to('.loader__count', { y: 10, opacity: 0, duration: 0.3, ease: 'power2.in' }, 0)
    // run-up (a cartoon anticipation): the logo draws back, the orb squashes, then
    // springs up tall
    .to(zoom, { z: 0.9, duration: DIVE, ease: 'power2.out', onUpdate: applyZoom }, 0)
    .to(orb, { sx: 1.35, sy: 0.72, duration: 0.2, ease: 'power2.out' }, 0.04)
    .to(orb, { sx: 0.84, sy: 1.22, duration: 0.18, ease: 'power2.inOut' }, 0.24)
    .to(orb, { sx: 1, sy: 1, duration: 0.5, ease: 'elastic.out(1, 0.5)' }, DIVE)
    // the dive: faster and faster into the dot; the letters fly past
    .to(zoom, { z: zMax, duration: DIVE_T, ease: 'expo.in', onUpdate: applyZoom }, DIVE)
    .to(brand, { opacity: 0, duration: 0.25, ease: 'power1.in' }, DIVE + DIVE_T * 0.62)
    .add(() => (el.style.visibility = 'hidden'), DIVE + DIVE_T + 0.05) // (all ember around the hole by now)
    // through the orb: its middle opens and its rim rushes out past the edges
    .to(orb, { hole: reach * 1.02, duration: 0.75, ease: 'power3.in' }, THROUGH)
    .add(startWord, WORD)
    // the interface, once the word has formed
    .add(() => navIn(), UI)
    .fromTo('.hero__bottom .btn', { clipPath: 'inset(0% 100% 0% 0% round 100px)' }, { clipPath: 'inset(0% 0% 0% 0% round 100px)', duration: 1.1, ease: 'expo.inOut', clearProps: 'clipPath' }, UI + 0.25)
    .from('.hero__bottom .btn__label', { yPercent: 120, duration: 1, ease: 'expo.out', clearProps: 'transform' }, UI + 0.55)
    .from('.hero__bottom .btn__icon', { scale: 0, rotate: -120, duration: 1, ease: 'back.out(1.8)', clearProps: 'transform' }, UI + 0.65)
    .from('.indicator', { opacity: 0, duration: 1.2, ease: 'power2.out', clearProps: 'opacity' }, UI + 0.4)
    .add(() => {
      lenis.start();
      el.remove();
    }, UI + 0.3);
  if (FAST) tl.progress(1);
}

// the menu comes in: each block drops in (blur → sharp, see .nav.is-hidden), the K
// turns into place, the links rise one after the other in their pill, and the
// quote button draws itself
function navIn() {
  $('.nav').classList.remove('is-hidden');
  gsap.from('.nav__logo-symbol .nav__logo-svg', { scale: 0.3, rotate: -60, duration: 1.2, ease: 'back.out(1.7)', clearProps: 'transform' });
  // (their hover roll is a CSS transition on the same transform: off meanwhile)
  const links = $('.nav__links a > span');
  gsap.set(links, { transition: 'none' });
  gsap.from(links, { yPercent: 130, duration: 1, stagger: 0.06, ease: 'expo.out', delay: 0.2, clearProps: 'transform,transition' });
  gsap.fromTo('.nav__right .btn', { clipPath: 'inset(0% 0% 0% 100% round 100px)' }, { clipPath: 'inset(0% 0% 0% 0% round 100px)', duration: 1.1, ease: 'expo.inOut', delay: 0.15, clearProps: 'clipPath' });
  gsap.from('.nav__right .btn__label', { yPercent: 120, duration: 0.9, ease: 'expo.out', delay: 0.5, clearProps: 'transform' });
}

/* ------------------------------------------------------------------
   Theme + side indicator
------------------------------------------------------------------ */
function initThemes() {
  const num = $('.indicator__num');
  const label = $('.indicator__label');
  let current = null;
  const setSection = (sec) => {
    // data-tone="auto": the section drives the theme itself (see initProjects)
    if (sec.dataset.tone !== 'auto') root.dataset.theme = sec.dataset.tone;
    if (current === sec.dataset.label) return;
    current = sec.dataset.label;
    gsap.to([num, label], {
      yPercent: -100,
      opacity: 0,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: () => {
        num.textContent = sec.dataset.num;
        label.textContent = sec.dataset.label;
        gsap.fromTo([num, label], { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.5, ease: 'expo.out' });
      },
    });
  };
  $$('[data-tone]').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec,
      start: sec.dataset.toneStart || 'top 50%',
      end: 'bottom 50%',
      onToggle: (self) => self.isActive && setSection(sec),
    });
  });
}

/* ------------------------------------------------------------------
   Generic reveals
------------------------------------------------------------------ */
function initReveals() {
  const groups = new Set($$('.line-mask').filter((m) => !m.closest('.hero')).map((m) => m.parentElement));
  groups.forEach((g) => {
    gsap.to($$('.line-mask > span', g), {
      yPercent: 0,
      stagger: 0.09,
      duration: 1.3,
      ease: 'expo.out',
      scrollTrigger: { trigger: g, start: 'top 86%' },
    });
  });

  $$('[data-reveal]').forEach((el) => {
    gsap.from(el, {
      y: 60,
      opacity: 0,
      duration: 1.3,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 90%' },
    });
  });
}

/* ------------------------------------------------------------------
   Hero scroll choreography
------------------------------------------------------------------ */
function initHero() {
  // only the liquid "Kalion Studio" and the projects button: the button leaves
  // with the first pixels of scroll, the rest of the pin drives the drop
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '.hero',
      start: 'top top',
      end: '+=150%',
      pin: true,
      scrub: true,
      onUpdate: (self) => {
        glState.hero = self.progress;
        syncGL();
      },
    },
  });
  tl.to('.hero__bottom', { y: -60, opacity: 0, ease: 'power2.in', duration: 0.14 }, 0).to({}, { duration: 0.86 });
  syncGL();
}

/* ------------------------------------------------------------------
   Manifesto — words light up as you scroll
------------------------------------------------------------------ */
// Split text into word spans (recursively, so <em>, <u>, <s> keep their styling).
// Elements marked [data-keep] (the inline logo) stay a single unit; aria-hidden
// decorations are left untouched.
function splitWords(el) {
  const nodes = [...el.childNodes];
  el.innerHTML = '';
  nodes.forEach((n) => {
    if (n.nodeType === 3) {
      n.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) el.append(' ');
        else {
          const s = document.createElement('span');
          s.className = 'w';
          s.textContent = part;
          el.append(s);
        }
      });
    } else if (n.nodeType === 1 && (n.hasAttribute('data-keep') || n.getAttribute('aria-hidden') === 'true')) {
      if (n.hasAttribute('data-keep')) n.classList.add('w');
      el.append(n);
    } else if (n.nodeType === 1) {
      splitWords(n);
      el.append(n);
    }
  });
}

let aboutY = null; // scroll position where the whole manifesto is lit (nav links)

function initAbout() {
  const blocks = $$('[data-manifesto]');
  blocks.forEach(splitWords);
  const items = blocks.flatMap((b) => $$('.w', b));

  // Accents are played, not scrubbed: each one starts (with its own easing) when the
  // reading reaches its word, and rewinds if you scroll back above it.
  const cues = [];
  const cue = (at, anim) => cues.push({ at, anim: anim.pause(), on: false });
  const runCues = (p) =>
    cues.forEach((c) => {
      const on = p >= c.at;
      if (on === c.on) return;
      c.on = on;
      if (on) c.anim.timeScale(1).play();
      else c.anim.timeScale(1.8).reverse();
    });

  // the first 30% of this pin is the liquid portal opening onto the manifesto
  const PORTAL = 0.3;
  const READ_END = 0.84;
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '.about',
      start: 'top top',
      end: '+=230%',
      pin: '.about__pin',
      scrub: true,
      onUpdate: (self) => {
        glState.portal = clamp(self.progress / PORTAL, 0, 1);
        syncGL();
        runCues(self.progress);
      },
      onRefresh: (self) => runCues(self.progress),
    },
  });
  // seen through the lens: the manifesto settles from a slight magnification
  tl.fromTo('.about__pin > *', { scale: 1.14, filter: 'blur(6px)' }, { scale: 1, filter: 'blur(0px)', ease: 'power2.out', duration: PORTAL }, 0);
  const timeOf = (el) => PORTAL + (items.indexOf(el) / items.length) * (READ_END - PORTAL);
  items.forEach((el) => {
    tl.fromTo(el, { opacity: 0.12 }, { opacity: 1, duration: 0.04, ease: 'none' }, timeOf(el));
  });
  tl.set({}, {}, 1); // timeline length = 1, so positions read as scroll progress
  aboutY = () => {
    const st = tl.scrollTrigger;
    return st.start + (READ_END + 0.03) * (st.end - st.start);
  };
  const readAt = (el) => {
    const ws = $$('.w', el);
    return timeOf(ws[ws.length - 1]) + 0.035;
  };

  // "webdesign": an ember brush stroke sweeps under the word
  $$('.about .mark').forEach((m) => {
    const stroke = $('.mark__stroke', m);
    const anim = gsap
      .timeline()
      .fromTo(
        stroke,
        { clipPath: 'inset(-60% 100% -60% 0%)' },
        { clipPath: 'inset(-60% 0% -60% 0%)', duration: 0.95, ease: 'power3.inOut' },
      );
    // "template recyclé": crossed out, then pushed back
    const txt = $('.mark__txt', m);
    if (txt) anim.to(txt, { opacity: 0.38, duration: 0.7, ease: 'power2.out' }, 0.45);
    cue(readAt(m), anim);
  });

  // "démarquent.": the word fills with ember from left to right
  $$('.about .ink').forEach((el) => {
    cue(readAt(el), gsap.fromTo(el, { '--ink': 0 }, { '--ink': 1, duration: 1.1, ease: 'power2.inOut' }));
  });
}

/* ------------------------------------------------------------------
   Engagements — a flight through four glass drops (src/gl/JourneyScene.js)
   Each drop opens into a ring as the camera arrives, its engagement is
   read while the camera holds, then we fly through it to the next one,
   and finally out into the light of the ivory page below.
------------------------------------------------------------------ */
let journey = null;

async function initJourney() {
  try {
    await Promise.all([document.fonts.load('400 120px "Instrument Serif"'), document.fonts.load('400 30px "DM Mono"')]);
    const figures = $$('.vow').map((v) => ({
      main: v.dataset.main,
      suffix: v.dataset.suffix || '',
      caption: v.dataset.caption || '',
    }));
    journey = new JourneyScene($('.pillars__gl'), figures, { dpr: glDpr(1.5, 1.5) });
    glScenes.push({ scene: journey, max: glDpr(1.5, 1.5), min: 0.75 });
    await journey.warmup();
  } catch (err) {
    console.warn('Parcours 3D indisponible', err);
    journey = null;
    $('.pillars').classList.add('is-static');
  }
}

function initPillars() {
  if (!journey) return;
  const section = $('.pillars');
  const canvasEl = $('.pillars__gl');
  const title = $('.pillars__title');
  const railBtns = $$('.pillars__rail button');
  const railFill = $('.pillars__rail-fill');

  // Scroll → position on the path (2i+1 = in front of ring i). The flight eases
  // between stops and holds in front of each ring long enough to read.
  const VH_PER_UNIT = 57; // scroll length of one unit, in % of the viewport height
  const U_IN = 1.2;
  const U_HOLD = 0.75;
  const U_MOVE = 1.2;
  // the last flight (through the last ring, into the light) lasts long enough for
  // the projects section (pulled up by 100vh in CSS) to rise over the light before the pin ends
  const U_OUT = 1.1 + 100 / VH_PER_UNIT;
  const segs = [{ from: 0, to: 1, len: U_IN }];
  for (let i = 0; i < STOPS; i++) {
    const c = 2 * i + 1;
    segs.push({ from: c, to: c, len: U_HOLD });
    segs.push({ from: c, to: c + 2, len: i < STOPS - 1 ? U_MOVE : U_OUT });
  }
  const TOTAL = segs.reduce((a, g) => a + g.len, 0);
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const pathOf = (p) => {
    let x = clamp(p, 0, 1) * TOTAL;
    for (const g of segs) {
      if (x <= g.len) return lerp(g.from, g.to, ease(x / g.len));
      x -= g.len;
    }
    return segs[segs.length - 1].to;
  };
  // scroll progress at the middle of each hold (rail links)
  const holdAt = [];
  let acc = 0;
  segs.forEach((g) => {
    if (g.from === g.to) holdAt.push((acc + g.len / 2) / TOTAL);
    acc += g.len;
  });

  // engagement texts are played in and out (not scrubbed) when their stop is reached
  const vowTls = $$('.vow').map((v) =>
    gsap
      .timeline({ paused: true })
      .fromTo(v, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01 }, 0)
      .fromTo($('.vow__mask > span', v), { yPercent: 115 }, { yPercent: 0, duration: 1.1, ease: 'expo.out' }, 0)
      .fromTo($('.vow__text', v), { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 1, ease: 'expo.out' }, 0.12)
  );
  let active = -1;
  const vowAt = (s) => {
    for (let i = 0; i < STOPS; i++) {
      const c = 2 * i + 1;
      if (s > c - 0.35 && s < c + 0.55) return i;
    }
    return -1;
  };
  const setActive = (i) => {
    if (i === active) return;
    if (active >= 0) vowTls[active].timeScale(1.8).reverse();
    active = i;
    if (i >= 0) vowTls[i].timeScale(1).play();
    railBtns.forEach((b, n) => b.classList.toggle('is-active', n === i));
  };

  // the rail takes the place of the side indicator ("02 — Engagements") during the
  // flight: the indicator fades, the rail line draws out from its centre, then the
  // four stops slide in one after the other. Played backwards on the way out.
  const railTl = gsap
    .timeline({ paused: true })
    .to('.indicator', { autoAlpha: 0, duration: 0.45, ease: 'power2.out' }, 0)
    .fromTo('.pillars__rail-track', { scaleY: 0 }, { scaleY: 1, duration: 1, ease: 'expo.inOut' }, 0.15)
    .fromTo(
      railBtns,
      { x: 60, autoAlpha: 0, filter: 'blur(8px)' },
      { x: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 0.9, stagger: 0.08, ease: 'expo.out' },
      0.4
    );
  let railOn = false;
  const setRail = (on) => {
    if (on === railOn) return;
    railOn = on;
    if (on) railTl.timeScale(1).play();
    else railTl.timeScale(1.5).reverse();
  };

  let target = 0;
  let cur = 0;
  let visible = false;
  const pin = ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: `+=${Math.round(TOTAL * VH_PER_UNIT)}%`,
    pin: '.pillars__pin',
    onUpdate: (self) => (target = pathOf(self.progress)),
    onRefresh: (self) => (target = pathOf(self.progress)),
  });
  ScrollTrigger.create({
    trigger: section,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      visible = self.isActive;
      journey.active = visible;
      if (visible) cur = target; // arriving (maybe from far away): start where the scroll is, no rewind
      else {
        setRail(false);
        setActive(-1);
      }
    },
  });

  // soft top edge while the section slides in under the manifesto
  gsap.fromTo(
    canvasEl,
    { '--enter': 1 },
    { '--enter': 0, ease: 'none', scrollTrigger: { trigger: section, start: 'top bottom', end: 'top top', scrub: true } }
  );

  section.addEventListener('mousemove', (e) => {
    if (TOUCH) return; // (a tap also sends a mousemove: no parallax jump)
    journey.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    journey.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  });
  section.addEventListener('mouseleave', () => {
    journey.pointer.x = 0;
    journey.pointer.y = 0;
  });
  railBtns.forEach((b, i) =>
    b.addEventListener('click', () => {
      lenis.scrollTo(pin.start + holdAt[i] * (pin.end - pin.start), { duration: 1.8, easing: (t) => 1 - Math.pow(1 - t, 4) });
    })
  );

  gsap.ticker.add((time, deltaMS) => {
    if (!visible) return;
    const dt = Math.min(deltaMS / 1000, 0.05);
    cur = lerp(cur, target, 1 - Math.exp(-dt * 5.5));
    if (Math.abs(cur - target) < 1e-4) cur = target;
    journey.s = cur;
    journey.render(dt);

    // the title comes towards us and we fly through it
    const tIn = smoothstep(0.06, 0.8, cur);
    css(title, 'opacity', (1 - tIn).toFixed(3));
    css(title, 'transform', `scale(${1 + tIn * tIn * 2.2})`);
    css(title, 'filter', tIn > 0.001 ? `blur(${(tIn * 12).toFixed(2)}px)` : 'none');
    css(title, 'visibility', tIn >= 1 ? 'hidden' : 'visible');

    setActive(vowAt(cur));
    setRail(cur > 0.55 && cur < 7.6);
    css(railFill, 'transform', `scaleY(${clamp((cur - 1) / (2 * (STOPS - 1)), 0, 1)})`);

    // into the light: the band rises over it, on the ivory theme
    if (pin.isActive) {
      const want = cur > 8.55 ? 'light' : 'dark';
      if (root.dataset.theme !== want) root.dataset.theme = want;
    }
  });

  onResized(() => journey.resize());
}

/* ------------------------------------------------------------------
   Projects
   The band rises over the light at the end of the flight, a dark ink
   rises behind it and swallows its words, "Projets réalisés" comes out
   of the ink in 3D (src/gl/ProjectsTitle.js) and breaks apart as we
   fly through it, then the gallery: 4 sites and "Découvrir plus".
------------------------------------------------------------------ */
let ptitle = null;
let projectsGalleryY = null; // scroll position where the gallery is in place (nav links)

// onHeavyDone: called once its blocking steps are behind (the preloader then shows the name)
async function initProjectsTitle(onHeavyDone = () => {}) {
  try {
    ptitle = new ProjectsTitle($('.projects__gl'), { dpr: glDpr(1.5, 1.5) });
    glScenes.push({ scene: ptitle, max: glDpr(1.5, 1.5), min: 0.75 });
    await ptitle.warmup(nextFrame, onHeavyDone);
  } catch (err) {
    console.warn('Titre 3D indisponible', err);
    ptitle = null;
    $('.projects').classList.add('no-3d');
  }
  onHeavyDone();
}

function initProjects() {
  const section = $('.projects');
  const band = $('.pband');
  const glc = $('.projects__gl');
  const word = $('.projects__word');
  const stage = $('.projects__stage');
  const track = $('.projects__track');
  const hud = $('.projects__hud');
  const cards = $$('.pcard');
  const imgs = cards.map((c) => $('.pcard__media > img', c));
  const count = $('[data-pcount]');
  const bar = $('.projects__hud-bar span');
  const REAL = cards.filter((c) => !c.classList.contains('pcard--more')).length;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // choreography, in viewport heights of scroll inside the pin
  const INTRO = 2.8; // band → ink → title → break; then the gallery slides sideways
  const END = 0.35;

  // the band: two rows in opposite directions, faster with the scroll
  const rows = $$('.pband__row').map((row) => {
    const el = $('.pband__track', row);
    el.innerHTML = el.innerHTML.repeat(3);
    return { el, dir: +row.dataset.dir, x: 0, period: el.scrollWidth / 3 };
  });

  let dist = 0;
  let centers = [];
  const measure = () => {
    dist = Math.max(0, track.scrollWidth - vp.w);
    centers = cards.map((c) => c.offsetLeft + c.offsetWidth / 2);
    rows.forEach((r) => (r.period = r.el.scrollWidth / 3));
  };
  measure();

  let visible = false;
  const pin = ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    // (the gallery is measured here: after a resize its width has changed before the end is read)
    end: () => {
      measure();
      return `+=${vp.h * (INTRO + END) + dist}`;
    },
    pin: '.projects__pin',
    invalidateOnRefresh: true,
    onRefresh: measure,
  });
  projectsGalleryY = () => pin.start + vp.h * INTRO;
  ScrollTrigger.create({
    trigger: section,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      visible = self.isActive;
      if (ptitle) ptitle.active = visible;
      if (!visible) root.classList.remove('in-gallery');
    },
  });

  section.addEventListener('mousemove', (e) => {
    if (!ptitle || TOUCH) return;
    ptitle.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    ptitle.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  });

  const s3 = { ink: 0, form: 0, brk: 0 };
  let current = -1;
  gsap.ticker.add((time, deltaMS) => {
    if (!visible) return;
    const dt = Math.min(deltaMS / 1000, 0.05);
    const vh = vp.h;
    const px = window.scrollY - pin.start;
    const u = px / vh;

    // band: comes out of the light (big, blurred → sharp), then the ink rises over it
    // while it drifts up a little, as if pushed by the liquid
    const pre = easeOut(clamp(1 + u, 0, 1));
    css(band, 'opacity', (smoothstep(0.05, 0.55, pre) * (1 - smoothstep(0.9, 1.0, u))).toFixed(3));
    css(band, 'transform', `translateY(${(-smoothstep(0, 0.9, u) * 9).toFixed(2)}vh) scale(${lerp(1.35, 1, pre).toFixed(4)})`);
    css(band, 'filter', pre < 0.999 ? `blur(${((1 - pre) * 10).toFixed(2)}px)` : 'none');
    if (u < 1) {
      const v = clamp(lenis.velocity || 0, -60, 60);
      const sd = lenis.direction === -1 ? -1 : 1;
      rows.forEach((r) => {
        r.x += r.dir * sd * (0.7 + Math.abs(v) * 0.3);
        r.x = -((((-r.x) % r.period) + r.period) % r.period);
        css(r.el, 'transform', `translate3d(${r.x.toFixed(1)}px,0,0)`);
      });
    }

    // ink, 3D title, break
    const ink = clamp(u / 0.9, 0, 1);
    if (ptitle) {
      const k = 1 - Math.exp(-dt * 7);
      s3.ink = lerp(s3.ink, ink, k);
      s3.form = lerp(s3.form, clamp((u - 0.3) / 0.9, 0, 1), k);
      s3.brk = lerp(s3.brk, clamp((u - 1.5) / 1, 0, 1), k);
      Object.assign(ptitle.state, s3);
      css(glc, 'opacity', (1 - smoothstep(2.3, 2.6, u)).toFixed(3));
      if (u < 2.65) ptitle.render(dt);
    } else {
      const t = smoothstep(1.4, 2.3, u);
      css(word, 'opacity', (smoothstep(0.3, 0.8, u) * (1 - t)).toFixed(3));
      css(word, 'transform', `scale(${1 + t * 1.5})`);
    }
    // ivory until the ink has covered the screen, then dark (before the pin, the end
    // of the flight above drives the theme)
    if (u >= 0 && px < pin.end - pin.start) {
      const want = ink > 0.97 ? 'dark' : 'light';
      if (root.dataset.theme !== want) root.dataset.theme = want;
    }

    // gallery comes forward out of the burst, then slides sideways
    const g = easeOut(clamp((u - 2.0) / 0.75, 0, 1));
    css(stage, 'opacity', g.toFixed(3));
    css(stage, 'visibility', g > 0.001 ? 'visible' : 'hidden');
    section.classList.toggle('is-gallery', g > 0.9);
    // (the side label steps aside while the gallery is there: it would run over the cards)
    root.classList.toggle('in-gallery', g > 0.5 && px < pin.end - pin.start);
    css(stage, 'transform', `perspective(1400px) rotateX(${((1 - g) * 18).toFixed(2)}deg) scale(${lerp(0.55, 1, g).toFixed(4)})`);
    const h = clamp((u - 2.4) / 0.3, 0, 1);
    css(hud, 'opacity', h.toFixed(3));
    css(hud, 'transform', `translateY(${((1 - h) * 30).toFixed(1)}px)`);

    const x = -clamp(px - vh * INTRO, 0, dist);
    css(track, 'transform', `translate3d(${x.toFixed(1)}px,0,0)`);
    css(bar, 'transform', `scaleX(${dist > 0 ? clamp(-x / dist, 0, 1) : 0})`);
    const vw = vp.w;
    let best = 0;
    let bestD = Infinity;
    cards.forEach((c, i) => {
      const off = centers[i] + x - vw / 2;
      const n = clamp(off / vw, -1.3, 1.3);
      const an = Math.abs(n);
      if (an < bestD) {
        bestD = an;
        best = i;
      }
      css(c, 'transform', `translate3d(0, ${(an * an * 40).toFixed(1)}px, ${(-an * 520).toFixed(1)}px) rotateY(${(-n * 34).toFixed(2)}deg)`);
      if (imgs[i]) css(imgs[i], 'transform', `translate3d(${(-n * 5).toFixed(2)}%,0,0)`);
    });
    if (best !== current) {
      current = best;
      count.textContent = String(Math.min(best + 1, REAL)).padStart(2, '0');
    }
  });

  onResized(() => ptitle && ptitle.resize());
}

/* ------------------------------------------------------------------
   "Découvrir plus" — the other sites in a panel.
   Open : the "Ouvrir" pill fills with ember, the page opens from it as a
          growing circle with a glowing rim (the hero's drop becoming a
          window), and the pill flies to the top right corner where it
          becomes "Fermer".
   Close: the whole page is sucked into "Fermer", which then flies back
          down to the card and becomes "Ouvrir" again.
------------------------------------------------------------------ */
function initMore() {
  const panel = $('#more');
  const inner = $('.more__inner', panel);
  const lip = $('.more-lip');
  const morph = $('.more-morph');
  const labelOpen = $('.more-morph__a', morph);
  const labelClose = $('.more-morph__b', morph);
  const trigger = $('.pcard--more');
  const pill = $('.pcard__open', trigger);
  const closeBtn = $('.more__close', panel);
  const title = $('.more__title', panel);
  const items = $$('.more__grid > li', panel);
  const cta = $('.more__cta', panel);
  const behind = [$('main'), $('.nav'), $('.footer')].filter(Boolean);
  const EMBER = 'rgba(255, 91, 36, 1)';
  const CLEAR = 'rgba(255, 91, 36, 0)';
  const RIM = 'rgba(236, 230, 220, 0.3)';
  const IVORY = '#ece6dc';
  const INK = '#0c0b0a';
  let isOpen = false;
  let tl = null;

  const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const box = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
  const reach = ({ x, y }) => Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 40;
  const circle = (o, r) => `circle(${r}px at ${o.x}px ${o.y}px)`;

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    lenis.stop();
    behind.forEach((el) => (el.inert = true));
    panel.hidden = false;
    panel.scrollTop = 0;
    gsap.set(panel, { visibility: 'visible' });
    gsap.set(inner, { clearProps: 'transform,filter,opacity' });
    const from = pill.getBoundingClientRect();
    const to = closeBtn.getBoundingClientRect();
    const o = centre(from);
    const R = reach(o);
    if (tl) tl.kill();
    gsap.set([closeBtn, pill], { opacity: 0 });
    tl = gsap
      .timeline()
      // the pill lifts off and fills with ember…
      .set(morph, { ...box(from), autoAlpha: 1, backgroundColor: CLEAR, borderColor: RIM, color: IVORY }, 0)
      .set(labelOpen, { yPercent: 0, opacity: 1 }, 0)
      .set(labelClose, { yPercent: 110, opacity: 0 }, 0)
      .to(morph, { backgroundColor: EMBER, borderColor: EMBER, color: INK, duration: 0.3, ease: 'power2.out' }, 0)
      // …the page opens from it…
      .fromTo(panel, { clipPath: circle(o, from.height / 2) }, { clipPath: circle(o, R), duration: 1.35, ease: 'expo.inOut' }, 0.12)
      .fromTo(
        lip,
        { left: o.x, top: o.y, width: from.height, height: from.height, opacity: 1 },
        { width: R * 2, height: R * 2, duration: 1.35, ease: 'expo.inOut' },
        0.12
      )
      .to(lip, { opacity: 0, duration: 0.45, ease: 'power1.out' }, 0.95)
      // …and it travels up to the corner (two eases: a curved path), becoming "Fermer"
      .to(morph, { left: to.left, width: to.width, duration: 1.15, ease: 'power3.inOut' }, 0.2)
      .to(morph, { top: to.top, height: to.height, duration: 1.15, ease: 'power2.inOut' }, 0.2)
      .to(labelOpen, { yPercent: -110, opacity: 0, duration: 0.4, ease: 'power2.in' }, 0.55)
      .to(labelClose, { yPercent: 0, opacity: 1, duration: 0.55, ease: 'power3.out' }, 0.85)
      .to(morph, { backgroundColor: CLEAR, borderColor: RIM, color: IVORY, duration: 0.5, ease: 'power1.inOut' }, 0.9)
      .set([closeBtn, pill], { opacity: 1 }, 1.35)
      .set(morph, { autoAlpha: 0 }, 1.35)
      .fromTo(title, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 1.2, ease: 'expo.out' }, 0.6)
      .fromTo(
        items,
        { z: -520, rotationX: 26, y: 70, opacity: 0 },
        { z: 0, rotationX: 0, y: 0, opacity: 1, duration: 1.4, stagger: 0.07, ease: 'expo.out' },
        0.7
      )
      .fromTo(cta, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'expo.out' }, 1.1);
    closeBtn.focus({ preventScroll: true });
  };

  const close = (then) => {
    if (!isOpen) return;
    isOpen = false;
    const from = closeBtn.getBoundingClientRect();
    const to = pill.getBoundingClientRect();
    const o = centre(from);
    const R = reach(o);
    const ir = inner.getBoundingClientRect();
    if (tl) tl.kill();
    gsap.set([closeBtn, pill], { opacity: 0 });
    tl = gsap
      .timeline({
        onComplete: () => {
          panel.hidden = true;
          gsap.set(inner, { clearProps: 'transform,filter,opacity' });
          gsap.set([closeBtn, pill], { opacity: 1 });
          behind.forEach((el) => (el.inert = false));
          lenis.start();
          if (typeof then === 'function') then();
          else trigger.focus({ preventScroll: true });
        },
      })
      // "Fermer" stays put and the whole page is sucked into it…
      .set(morph, { ...box(from), autoAlpha: 1, backgroundColor: CLEAR, borderColor: RIM, color: IVORY }, 0)
      .set(labelClose, { yPercent: 0, opacity: 1 }, 0)
      .set(labelOpen, { yPercent: 110, opacity: 0 }, 0)
      .set(inner, { transformOrigin: `${o.x - ir.left}px ${o.y - ir.top}px` }, 0)
      .to(inner, { scale: 0.06, filter: 'blur(8px)', opacity: 0.3, duration: 0.95, ease: 'power3.in' }, 0)
      .fromTo(panel, { clipPath: circle(o, R) }, { clipPath: circle(o, from.height / 2), duration: 0.95, ease: 'power3.in' }, 0)
      .fromTo(
        lip,
        { left: o.x, top: o.y, width: R * 2, height: R * 2, opacity: 0 },
        { width: from.height, height: from.height, opacity: 1, duration: 0.95, ease: 'power3.in' },
        0
      )
      .to(morph, { backgroundColor: EMBER, borderColor: EMBER, color: INK, duration: 0.35, ease: 'power2.in' }, 0.6)
      .set(panel, { visibility: 'hidden' }, 0.95)
      .to(lip, { opacity: 0, duration: 0.25 }, 0.95)
      // …then flies back down to the card and becomes "Ouvrir" again
      .to(morph, { left: to.left, width: to.width, duration: 1.0, ease: 'power3.inOut' }, 0.95)
      .to(morph, { top: to.top, height: to.height, duration: 1.0, ease: 'power2.inOut' }, 0.95)
      .to(labelClose, { yPercent: -110, opacity: 0, duration: 0.35, ease: 'power2.in' }, 1.05)
      .to(labelOpen, { yPercent: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, 1.35)
      .to(morph, { backgroundColor: CLEAR, borderColor: RIM, color: IVORY, duration: 0.45, ease: 'power1.inOut' }, 1.45)
      .set(morph, { autoAlpha: 0 }, 1.95);
  };

  trigger.addEventListener('click', open);
  closeBtn.addEventListener('click', () => close());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) close();
  });
  cta.addEventListener('click', (e) => {
    e.preventDefault();
    close(() => scrollToTarget('#contact'));
  });
  // each site leans towards the cursor
  $$('.mtile', panel).forEach((tile) => {
    tile.addEventListener('mousemove', (e) => {
      if (TOUCH) return;
      const r = tile.getBoundingClientRect();
      tile.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width - 0.5) * 10).toFixed(2)}deg`);
      tile.style.setProperty('--rx', `${(-((e.clientY - r.top) / r.height - 0.5) * 8).toFixed(2)}deg`);
    });
    tile.addEventListener('mouseleave', () => {
      tile.style.setProperty('--rx', '0deg');
      tile.style.setProperty('--ry', '0deg');
    });
  });
}

/* ------------------------------------------------------------------
   Reviews — the liquid rises over the end of the gallery; small bubbles
   fizz, seven bubbles (one per review) rise and merge into one sphere,
   which turns to glass and lights a halo. Then the reviews spread out
   of the sphere on two rows; once spread, they turn on their own
   (opposite ways, constant pace): several are readable at once and
   there is nothing to scroll through. Ray-traced in ReviewsScene.
------------------------------------------------------------------ */
let rvgl = null;
let reviewsY = null; // scroll position where the reviews have spread out (nav links)
// the sphere as the reviews leave it: the tarifs take it over. Screen space (x, y, r, like
// DropsScene) and, to draw it exactly the same, its world place and values (w*, shape, glass)
const reviewsBall = { x: 0, y: 0, r: 0, ok: false, wx: 0, wy: 0, wz: 0, wr: 0, squash: 1, life: 0, seed: 0, ior: 1.47, absorb: 1 };

const readReviews = () =>
  $$('.rv-list > .rv').map((li) => ({
    quote: $('blockquote', li).textContent.trim(),
    name: $('.rv__who strong', li).textContent.trim(),
    role: ($('.rv__who .mono', li) || { textContent: '' }).textContent.trim(),
  }));

const reviewFonts = () =>
  Promise.all([
    document.fonts.load('400 18px "Instrument Serif"'),
    document.fonts.load('italic 400 18px "Instrument Serif"'),
    document.fonts.load('400 11px "DM Mono"'),
  ]);

async function initReviewsGL() {
  try {
    rvgl = new ReviewsScene($('.reviews__gl'), { dpr: glDpr(1.5, 2), mobile: MOBILE });
    glScenes.push({ scene: rvgl, max: glDpr(1.5, 2), min: 1 });
    await reviewFonts();
    rvgl.setRows(readReviews());
    await rvgl.warmup();
  } catch (err) {
    console.warn('Avis 3D indisponibles', err);
    rvgl = null;
    $('.reviews').classList.add('no-gl');
  }
}

function initReviews() {
  const section = $('.reviews');
  const pinEl = $('.reviews__pin');
  const canvasEl = $('.reviews__gl');
  const head = $('.rv-head');

  if (!rvgl) {
    gsap.from('.rv-head, .rv-list > .rv', { y: 50, opacity: 0, stagger: 0.06, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: section, start: 'top 70%' } });
    return;
  }

  // choreography, in viewport heights of scroll inside the pin
  const DONE = 2.0; // the reviews have come out of the sphere
  // leaving plays the arrival backwards: the rows slide back into the sphere, its ring
  // folds back into it, the underwater light goes; then the tarifs take the sphere over
  const LEAVE = DONE + 0.35;
  const SWAP = LEAVE + 0.6; // the tarifs hold the sphere from here (see initPricing)
  const HAND = 0.5; // ...while their background fades in over the reviews
  const TOTAL = SWAP + HAND;
  const seg = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
  const easeOut3 = (t) => 1 - Math.pow(1 - t, 3);

  const pin = ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: () => `+=${vp.h * TOTAL}`,
    pin: pinEl,
    invalidateOnRefresh: true,
  });
  reviewsY = () => pin.start + vp.h * DONE;

  // seven bubbles, one per review: where they rise from, when, how big
  const BUB = [
    { x: -0.37, z: 0.3, r: 0.16, d: 0.0, ph: 0.3 },
    { x: 0.69, z: -0.4, r: 0.19, d: 0.06, ph: 1.7 },
    { x: 0.07, z: 0.62, r: 0.11, d: 0.13, ph: 2.9 },
    { x: 1.05, z: 0.12, r: 0.14, d: 0.2, ph: 4.1 },
    { x: -0.67, z: -0.35, r: 0.13, d: 0.26, ph: 5.3 },
    { x: 0.41, z: 0.1, r: 0.17, d: 0.32, ph: 0.9 },
    { x: 0.81, z: 0.5, r: 0.1, d: 0.38, ph: 2.2 },
  ];
  // the sphere sits on the right (at ~70 % of the width, whatever the screen):
  // the reviews come out of it, to the left. On a phone it sits in the middle, high up,
  // and the rows unroll from under it to both sides (a wider lens: it fits across)
  // (a short phone: a wider lens, the sphere a little smaller and lower, clear of the title)
  const SHORT = MOBILE && vp.h / vp.w < 1.95;
  const BALL = MOBILE ? { x: 0, y: SHORT ? 0.3 : 0.3, z: 0, r: 0.3 } : { x: 0.6, y: -0.08, z: 0, r: 0.3 };
  const FOV = MOBILE ? (SHORT ? 50 : 40) : 30;
  const place = () => (BALL.x = MOBILE ? 0 : clamp(0.35 * (vp.w / vp.h), 0.3, 0.95));
  place();
  if (MOBILE) BUB.forEach((b) => (b.x *= 0.42));
  // their volumes add up to the sphere's
  const SC = BALL.r / Math.cbrt(BUB.reduce((a, b) => a + b.r ** 3, 0));
  // the two rows: their place (share of the screen height, from the top) and drift
  // (CSS px / s, > 0: to the left). They turn on their own, at a calm constant pace:
  // neither the cursor nor the scroll changes it
  const ROWS = MOBILE
    ? [
        { top: SHORT ? 0.625 : 0.59, speed: 22 },
        { top: SHORT ? 0.835 : 0.8, speed: -22 },
      ]
    : [
        { top: 0.41, speed: 26 },
        { top: 0.67, speed: -26 },
      ];
  // (the second row starts half a card further: the two rows sit in quincunx)
  const drift = ROWS.map((r, i) => ({ off: i * (rvgl.rowPer || 0) * 0.5 }));
  const U = rvgl.uniforms;

  const st = { u: -1, px: 0, py: 0 };
  // dev only: lets the preview tests jump to a moment and grab a frame
  if (import.meta.env.DEV) {
    window.__rv = {
      st,
      pin,
      shot: async (name) => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        rvgl.render(gsap.ticker.time);
        const data = canvasEl.toDataURL('image/jpeg', 0.92);
        return fetch('http://localhost:5199', { method: 'POST', body: JSON.stringify({ name, data }) }).then((r) => r.text());
      },
    };
  }
  const pointer = { x: 0, y: 0 };
  const spring = { x: 0, v: 0 };
  let prevR = 0;
  let prevRip = 0;
  let visible = false;

  window.addEventListener('mousemove', (e) => {
    if (TOUCH) return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  });

  gsap.ticker.add((time, deltaMS) => {
    const vh = vp.h;
    const u = (window.scrollY - pin.start) / vh;
    const on = u > -0.05 && u < TOTAL + 0.02; // afterwards the tarifs cover it
    if (on !== visible) {
      visible = on;
      rvgl.active = on;
      css(canvasEl, 'visibility', on ? 'visible' : 'hidden');
      if (on && Math.abs(st.u - u) > 2.5) st.u = u; // arriving from far away: no replay
    }
    if (!visible) return;
    const dt = Math.min(deltaMS / 1000, 0.05);
    st.u = lerp(st.u, u, 1 - Math.exp(-dt * 5.5));
    st.px = lerp(st.px, pointer.x, 1 - Math.exp(-dt * 2.5));
    st.py = lerp(st.py, pointer.y, 1 - Math.exp(-dt * 2.5));
    const s = st.u;

    // the liquid rises from the bottom and swallows the gallery; we stay under its surface
    U.uLevel.value = lerp(-0.62, 0.68, smoothstep(0, 0.78, s));
    // leaving is read on the raw scroll, in step with the tarifs that take over
    const ring = seg(u, LEAVE + 0.22, LEAVE + 0.52); // the ring folds back into the sphere
    const calm = seg(u, LEAVE + 0.3, LEAVE + 0.58); // the underwater light goes
    U.uUnder.value = lerp(1, 0.55, seg(s, 1.0, 1.6)) * (1 - calm);
    U.uFizz.value = seg(s, 0.04, 0.3) * lerp(1, 0.45, seg(s, 1.0, 1.5)) * (1 - calm);
    U.uFizzY.value = s * 0.9;

    // the bubbles rise, sway, and are swallowed one by one by the sphere
    const m = seg(s, 0.12, 1.12);
    let vol = 0;
    BUB.forEach((b, i) => {
      const t = seg(m, b.d, b.d + 0.55);
      const ey = 1 - (1 - t) * (1 - t);
      const ex = Math.pow(t, 1.2);
      const r = b.r * SC;
      const sway = Math.sin(t * Math.PI * 2.6 + b.ph + time * 0.9) * 0.07 * (1 - ex);
      const w = smoothstep(0.86, 1.0, t);
      vol += w * r * r * r;
      rvgl.setBlob(
        i,
        lerp(b.x, BALL.x, ex) + sway,
        lerp(-1.35 - b.d * 0.8, BALL.y, ey),
        lerp(b.z, BALL.z, ex),
        r * (1 - w),
        0.84 + 0.16 * t,
        1,
        b.ph
      );
    });
    const Rb = Math.cbrt(vol);

    // the glass turns and lights its halo
    const glass = seg(s, 1.02, 1.3);
    const rip = seg(s, 1.05, 1.4);
    U.uIor.value = lerp(1.33, 1.47, easeInOutCubic(glass));
    U.uAbsorb.value = glass;

    // the sphere jiggles when it swallows a bubble, and when the halo lights up
    spring.v += clamp((Rb - prevR) * 55, -0.7, 0.7);
    if (prevRip < 0.02 && rip >= 0.02) spring.v -= 1.3;
    prevR = Rb;
    prevRip = rip;
    spring.v += (-170 * spring.x - 9 * spring.v) * dt;
    spring.x = clamp(spring.x + spring.v * dt, -0.22, 0.22);
    const by = BALL.y + Math.sin(time * 0.9) * 0.012;
    // (on the raw scroll, in step with the tarifs: once they hold it, it is theirs —
    // they draw it with this very code and these values, so nothing changes on screen)
    const handed = u > SWAP + 0.05;
    const life = lerp(1, 0.45, glass);
    rvgl.setBlob(BUB.length, BALL.x, by, BALL.z, handed ? 0 : Rb, 1 + spring.x, life, 0.7);
    Object.assign(reviewsBall, { wx: BALL.x, wy: by, wz: BALL.z, wr: Rb, squash: 1 + spring.x, life, seed: 0.7, ior: U.uIor.value, absorb: U.uAbsorb.value });

    U.uHaloC.value.set(BALL.x, BALL.z);
    U.uHaloY.value = BALL.y - BALL.r * 0.5;
    // the ring: it opened out of the sphere; leaving, it folds back in, flaring as it goes
    const ringOut = easeOut3(rip) * (1 - easeInOutCubic(ring));
    U.uHaloR.value = lerp(Math.max(Rb, 0.15) * 1.02, BALL.r * 1.75, ringOut);
    const glowIn = smoothstep(0, 0.15, rip) * lerp(1, 0.32, seg(s, 1.45, 2.0));
    U.uGlow.value = ring > 0 ? (0.32 + 0.55 * Math.sin(Math.PI * ring)) * (1 - smoothstep(0.78, 1, ring)) : glowIn;

    // the camera cranes up from the bubbles
    const cm = easeInOutCubic(seg(s, 0.35, 1.7));
    rvgl.setCamera(st.px * 0.22, lerp(-0.25, 0.5, cm) + st.py * 0.1, lerp(3.7, 3.3, cm), 0, lerp(-0.12, 0.02, cm), 0, FOV);

    const src = rvgl.project(BALL.x, by, BALL.z);
    U.uSrcX.value = src.x;
    U.uSrcY.value = src.y;
    U.uSrcR.value = Math.max(Rb, 0.01) * (rvgl.project(BALL.x, by + 0.01, BALL.z).y - src.y) * 100 * vh;
    reviewsBall.x = src.x;
    reviewsBall.y = src.y;
    reviewsBall.r = U.uSrcR.value / vh;
    reviewsBall.ok = true;
    // the rows slide out of the sphere to the left, blurred while fast, sharp as they
    // settle; then both turn on their own. Leaving, they slide back into it.
    const dpr = rvgl.renderer.getPixelRatio();
    const snap = (v) => Math.round(v * dpr) / dpr; // on the device pixels: crisp text
    const srcPx = (src.x + (0.5 * vp.w) / vh) * vh;
    const D = MOBILE ? vp.w / 2 + 80 : srcPx + 80;
    const rowY = [];
    ROWS.forEach((r, i) => {
      const tIn = seg(s, 1.3 + 0.08 * i, 1.85 + 0.08 * i);
      const tOut = seg(u, LEAVE + 0.05 * i, LEAVE + 0.3 + 0.05 * i);
      const reveal = D * (easeOut3(tIn) - tOut * tOut * tOut);
      drift[i].off += r.speed * dt * smoothstep(0.9, 1, tIn);
      const blur = 2.2 * (tIn > 0 ? (1 - tIn) * (1 - tIn) : 0) + 2.2 * tOut * tOut;
      drift[i].show = blur > 0.001 ? drift[i].off + reveal : snap(drift[i].off + reveal);
      drift[i].front = MOBILE ? reveal : srcPx - reveal;
      drift[i].blur = blur;
      rowY[i] = 0.5 - (snap(r.top * vh - rvgl.rowH / 2) + rvgl.rowH / 2) / vh;
    });
    U.uRowsOn.value = s > 1.3 ? 1 : 0;
    U.uRowY.value.set(rowY[0], rowY[1]);
    U.uRowOff.value.set(drift[0].show, drift[1].show);
    U.uFront.value.set(drift[0].front, drift[1].front);
    U.uRowBlur.value.set(drift[0].blur, drift[1].blur);

    // the title
    const ui = seg(s, 1.25, 1.65) * (1 - seg(u, LEAVE, LEAVE + 0.3)); // it leaves with the rows
    css(head, 'opacity', ui.toFixed(3));
    css(head, 'transform', `translateY(${((1 - ui) * 30).toFixed(1)}px)`);

    rvgl.render(time);
  });

  onResized(() => {
    place();
    rvgl.resize();
    rvgl.setRows(readReviews());
  });
}

/* ------------------------------------------------------------------
   Pricing — the tarifs take the reviews' sphere over: it leaps from its
   place and falls into the middle, and on its way it divides: four
   droplets of coloured liquid split off towards their labels (the four
   things every site includes), while the tarifs fade in around it. Then
   one by one the droplets fly back into the drop and fill it, layer
   after layer. Full, it glows: "Tout
   ceci est inclus." Then it divides at each question (vitrine /
   sur-mesure, then achat unique / abonnement), each formula keeping the
   four layers. At the end the drops gather into one ember drop that falls
   onto the FAQ, coming up over the tarifs: it becomes the drop running
   down the questions. The drops live in DropsScene; the texts ride on them.
------------------------------------------------------------------ */
let drops = null;
let pricingY = null; // scroll position where the drop has landed (nav links)

async function initDrops() {
  try {
    // (the same resolution as the reviews: they hand their sphere over, pixel for pixel)
    drops = new DropsScene($('.pricing__gl'), { dpr: glDpr(1.5, 2) });
    glScenes.push({ scene: drops, max: glDpr(1.5, 2), min: 1 });
    await drops.warmup();
  } catch (err) {
    console.warn('Gouttes indisponibles', err);
    drops = null;
    $('.pricing').classList.add('no-gl');
  }
}

function initPricing() {
  const section = $('.pricing');
  const canvasEl = $('.pricing__gl');
  const ui = $('.pricing__ui');
  const head = $('.pr-head');
  const core = $('[data-drop="core"]');
  const inc = [0, 1, 2, 3].map((i) => $(`[data-drop="s${i}"]`));
  const q1 = $('.pr-q[data-step="1"]');
  const q2 = $('.pr-q[data-step="2"]');
  const vitrine = $('[data-drop="vitrine"]');
  const mesure = $('[data-drop="mesure"]');
  const once = $('[data-drop="once"]');
  const sub = $('[data-drop="sub"]');
  const mini = $('[data-drop="mini"]');
  const faqDrip = $('.faq__drip');
  const faqHead = $('.faq__drip-drop');
  // the widths of the four labels (they must fit beside their droplets)
  let incW = [];
  const measureInc = () => (incW = inc.map((el) => el.offsetWidth));
  measureInc();
  document.fonts.ready.then(measureInc);
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const seg = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
  const SQ2 = Math.SQRT2;
  const SQ3 = Math.sqrt(Math.log2(6)); // three drops on top of each other read as one

  // choreography, in viewport heights of scroll inside the pin
  // (at 0 the reviews hand their sphere over, bare: its ring and its rows already went back in)
  const LAND = 0.6; // it has leapt and fallen into the middle; its four droplets are by their labels
  const POUR = 0.85; // the first droplet flies back in
  const EACH = 0.25; // one droplet
  const FULL = POUR + 4 * EACH;
  const Q1 = 2.12; // question 1: the drop divides
  const Q2 = 3.07; // question 2: sur-mesure to the corner, vitrine divides again
  const OUT = 4.07; // the drops gather and fall onto the FAQ (which comes up over the last screen)
  const TOTAL = OUT + 1.17;

  // without WebGL the texts still follow the same choreography
  const gl = drops || { uniforms: { uBgA: { value: 1 }, uDropA: { value: 1 }, uSlosh: { value: 0 }, uGlowIn: { value: 0 }, uSpan: { value: 1 } }, setBlob() {}, setLiquid() {}, setOrb() {}, render() {}, resize() {}, active: false };
  const orbBall = {};

  const pin = ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: () => `+=${vp.h * TOTAL}`,
    pin: '.pricing__pin',
    invalidateOnRefresh: true,
  });
  pricingY = () => pin.start + vp.h * (LAND + 0.2);
  // dev only: lets the preview tests grab a frame of the drops
  if (import.meta.env.DEV) {
    window.__pr = {
      pin,
      gl,
      shot: async (name) => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        gl.render(gsap.ticker.time);
        const data = canvasEl.toDataURL('image/jpeg', 0.92);
        return fetch('http://localhost:5199', { method: 'POST', body: JSON.stringify({ name, data }) }).then((r) => r.text());
      },
    };
  }

  // the cursor becomes a small drop that merges with the big ones
  const ptr = { x: 0, y: 0, has: false };
  const cur = { x: 0, y: 0, vx: 0, vy: 0, r: 0 };
  section.addEventListener('mousemove', (e) => {
    if (TOUCH) return; // (no cursor drop under a finger)
    const W = vp.w;
    const H = vp.h;
    ptr.x = (e.clientX / W - 0.5) * (W / H);
    ptr.y = 0.5 - e.clientY / H;
    if (!ptr.has) {
      cur.x = ptr.x;
      cur.y = ptr.y;
    }
    ptr.has = true;
  });
  section.addEventListener('mouseleave', () => (ptr.has = false));

  const place = (el, x, y, extra = '') => {
    css(el, 'transform', `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)${extra}`);
  };
  const show = (el, o, interactive) => {
    css(el, 'opacity', o.toFixed(3));
    css(el, 'visibility', o > 0.01 ? 'visible' : 'hidden');
    if (interactive) css(el, 'pointerEvents', o > 0.8 ? 'auto' : 'none');
  };
  // a label that changes: it rises into place and leaves upwards
  const roll = (el, o, out) => {
    show(el, o);
    css(el, 'translate', `0 ${((out ? -1 : 1) * (1 - o) * 14).toFixed(1)}px`);
  };

  let visible = false;
  let time = 0;
  let slosh = 0;
  let bump = 0;
  let landed = false;
  const poured = [false, false, false, false];
  gsap.ticker.add((t, deltaMS) => {
    const W = vp.w;
    const H = vp.h;
    const A = W / H;
    const u = (window.scrollY - pin.start) / H; // < 0 while the reviews are still on
    const on = u > -0.01 && u < TOTAL + 0.02;
    if (on !== visible) {
      visible = on;
      gl.active = on;
      css(canvasEl, 'visibility', on ? 'visible' : 'hidden');
      css(ui, 'visibility', on ? 'visible' : 'hidden');
      if (!on) root.classList.remove('cursor-drop');
    }
    if (!visible) return;
    const dt = Math.min(deltaMS / 1000, 0.05);
    time += dt;
    const toX = (x) => (x / A + 0.5) * W;
    const toY = (y) => (0.5 - y) * H;
    const U = gl.uniforms;

    // layout, in viewport heights (y up, 0 = middle)
    // (on a phone: the drop fills most of the width; the four things it includes wait in
    // a column, two above it and two under it; the formulas stand side by side, high up,
    // their details in two columns under them; "sur-mesure" in the top right corner)
    const y0 = MOBILE ? -0.03 : -0.015;
    const RB = MOBILE ? Math.min(0.13, 0.29 * A) : Math.min(0.2, 0.15 * A); // the drop being filled
    const R1 = MOBILE ? Math.min(0.092, 0.19 * A) : Math.min(0.155, 0.115 * A);
    const xOff = MOBILE ? 0.272 * A : Math.min(0.22 * A, 0.42);
    // (phone: the formulas start ~230 px from the top, under the title, the question and the
    // "sur-mesure" bubble, whatever the screen height)
    const yc = MOBILE ? 0.5 - (H < 720 ? 222 : 236) / H - R1 : 0.075;
    const RS = MOBILE ? 0.022 : 0.03; // a droplet
    const RM = MOBILE ? 36 / H : 0.088;
    // (far enough from the formulas: two drops closer than ~60 px melt into each other)
    const xMini = MOBILE ? A / 2 - RM - 16 / H : A / 2 - 0.16;
    const yMini = MOBILE ? 0.5 - 140 / H : 0.24;
    // where the four droplets wait, by their labels
    const SPOT = MOBILE
      ? [
          [-0.3 * A, 0.235],
          [-0.3 * A, 0.17],
          [-0.3 * A, -0.225],
          [-0.3 * A, -0.29],
        ]
      : [
          [-0.27 * A, 0.15],
          [0.27 * A, 0.15],
          [-0.27 * A, -0.15],
          [0.27 * A, -0.15],
        ];
    // (a squarer screen: the labels beside the droplets would run off its edges — the
    // droplets come in until their labels fit)
    if (!MOBILE) {
      const edge = 0.032 * W + 12;
      const off = (RS + 0.026) * H;
      const xAt = (px) => (px / W - 0.5) * A;
      SPOT.forEach((s, i) => {
        const w = incW[i] || 0;
        s[0] = s[0] < 0 ? Math.max(s[0], xAt(edge + off + w)) : Math.min(s[0], xAt(W - edge - off - w));
      });
    }

    // 0. the hand-over: the tarifs draw the reviews' sphere themselves, exactly as the
    // reviews did (same ray tracing, same camera, same values): no pixel changes and
    // there is only ever one sphere. It leaps and falls into the middle, and on the way
    // it melts into the tarifs' drop (its glass softens, then the drop shows through);
    // the tarifs fade in around it
    U.uDropA.value = u >= 0 ? seg(u, 0, 0.05) : 0;
    U.uBgA.value = easeIO(seg(u, 0.05, 0.45));
    const S = reviewsBall.ok ? reviewsBall : { x: 0.35 * A, y: -0.06, r: 0.17 };
    const fallT = seg(u, 0.05, LAND);
    const leap = (t) => 0.13 * Math.sin(Math.PI * Math.min(1, t * 1.05)); // up a little, then down
    const fe = easeIO(fallT);
    const dropX = lerp(S.x, 0, fe);
    const dropY = lerp(S.y, y0, fe) + leap(fallT);
    const dropR = lerp(S.r, RB, fe);
    const orb = drops && rvgl && reviewsBall.ok ? 1 - easeIO(seg(u, 0.12, 0.3)) : 0;
    let sil = null;
    if (orb > 0) {
      // first its glass softens (it stops bending the light, its surface calms down)...
      const melt = easeIO(seg(u, 0.03, 0.2));
      Object.assign(orbBall, reviewsBall);
      orbBall.ior = lerp(reviewsBall.ior, 1.12, melt);
      orbBall.absorb = reviewsBall.absorb * (1 - melt);
      orbBall.life = reviewsBall.life * (1 - melt);
      // ...then the drop, already there under it on its very outline, shows through
      // (as it fades, its outline settles on the drop's round one)
      sil = gl.setOrb(orb, rvgl.uniforms, orbBall, dropX, dropY, dropR, 1 - orb);
    } else gl.setOrb(0);
    // the drop under the sphere: on its outline (just inside it while it is whole)
    const hx = sil ? sil.x : dropX;
    const hy = sil ? sil.y : dropY;
    const hr = sil ? lerp(sil.r, sil.rMin * 0.96, smoothstep(0.6, 1, orb)) : dropR;
    if (landed === false && fallT >= 1) bump = 1.6; // it lands: a squash, a wobble
    landed = fallT >= 1;

    // 1. the droplets fly in one by one; each one fills a layer
    let fill = 0;
    for (let k = 0; k < 4; k++) {
      const tk = seg(u, POUR + k * EACH, POUR + (k + 0.92) * EACH);
      const sk = seg(u, 0.2 + 0.05 * k, 0.58 + 0.05 * k); // splits off the falling drop
      const [sx, sy] = SPOT[k];
      // an arc: up and over, then down into the drop, faster as it falls
      const e = tk * tk * (3 - 2 * tk);
      const cx = sx * 0.3;
      const cy = Math.max(sy, 0) + 0.27;
      const ex = 0;
      const ey = y0 + RB * 0.3;
      const x = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * cx + e * e * ex;
      const y = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * cy + e * e * ey + Math.sin(time * 1.4 + k * 1.9) * 0.006 * (1 - tk);
      const inDrop = smoothstep(0.8, 1.0, tk);
      fill += inDrop * 0.25;
      if (!poured[k] && tk > 0.86) {
        poured[k] = true;
        slosh = Math.min(1.3, slosh + 1);
        bump = 1;
      }
      if (poured[k] && tk < 0.8) poured[k] = false;
      let r = RS * (1 - inDrop) * (1 + 0.3 * Math.sin(tk * Math.PI)) * (1 - seg(u, Q1 - 0.1, Q1));
      let dx = x;
      let dy = y;
      let dFill = 1.6;
      if (tk <= 0) {
        // on the way down: it pinches off the drop, takes its colour, arcs to its label
        const es = easeOut(sk);
        dx = lerp(dropX, sx, es);
        dy = lerp(dropY, sy, es) + 0.07 * Math.sin(Math.PI * sk) + Math.sin(time * 1.4 + k * 1.9) * 0.006 * sk;
        r = sk > 0 ? RS * (0.55 + 0.45 * smoothstep(0, 0.25, sk)) : 0;
        dFill = 1.6 * smoothstep(0.08, 0.4, sk);
      }
      gl.setBlob(4 + k, dx, dy, r, 0.6);
      gl.setLiquid(4 + k, dFill, dy - r, 2 * Math.max(r, 1e-3), k + 1);
      inc[k].classList.toggle('is-in', tk > 0.92);
    }
    slosh *= Math.exp(-dt * 2.2);
    bump *= Math.exp(-dt * 4.5);
    U.uSlosh.value = slosh;
    U.uGlowIn.value = seg(u, FULL - 0.06, FULL + 0.12) * (1 - seg(u, Q1, Q1 + 0.3));
    U.uSpan.value = lerp(1, 0.24, easeIO(seg(u, Q1, Q1 + 0.38)));

    // 2 & 3. the questions: it divides, then divides again
    const s1 = easeIO(seg(u, Q1, Q1 + 0.38));
    const s2a = easeIO(seg(u, Q2, Q2 + 0.28));
    const s2b = easeIO(seg(u, Q2 + 0.15, Q2 + 0.45));
    // 4. the way out: they gather, then fall onto the FAQ's drip
    const cv = easeIO(seg(u, OUT + 0.08, OUT + 0.42));
    const fl = seg(u, OUT + 0.4, OUT + 0.72);

    const breathe = (i) => 1 + 0.012 * Math.sin(time * 1.3 + i * 1.7);
    const rEach = (RB / SQ3) * (1 + 0.035 * bump);
    // b (sur-mesure)
    let bx = lerp(0, xOff, s1);
    let by = lerp(y0, yc, s1);
    let br = lerp(rEach, R1, s1);
    bx = lerp(bx, xMini, s2a);
    by = lerp(by, yMini, s2a);
    br = lerp(br, RM, s2a);
    // a1 + a2 (vitrine), together until question 2
    const ax = lerp(lerp(0, -xOff, s1), 0, s2a);
    const ay = lerp(y0, yc, s1);
    const ar = lerp(lerp(rEach, R1 / SQ2, s1), R1, s2b);
    let a1x = ax - xOff * s2b;
    let a2x = ax + xOff * s2b;
    let a1y = ay;
    let a2y = ay;
    let a1r = ar;
    let a2r = ar;
    // (while it falls, a1 + a2 are its head and b trails a little behind: a falling drop)
    if (fallT < 1) {
      // (no tail while it is still the round sphere: it grows as the sphere melts)
      const lagT = lerp(clamp((fallT - 0.08) / 0.92, 0, 1), fallT, smoothstep(0, 0.25, orb));
      const le = easeIO(lagT);
      a1x = a2x = hx;
      a1y = a2y = hy;
      a1r = a2r = hr / SQ3;
      bx = lerp(S.x, 0, le) + hx - dropX;
      by = lerp(S.y, y0, le) + leap(lagT) + hy - dropY;
      br = (lerp(S.r, RB, le) / SQ3) * (hr / dropR);
    }
    // gathering
    const RG = R1 * 0.72;
    const gx = 0;
    const gy = 0.02;
    a1x = lerp(a1x, gx, cv);
    a2x = lerp(a2x, gx, cv);
    bx = lerp(bx, gx, cv);
    a1y = lerp(a1y, gy, cv);
    a2y = lerp(a2y, gy, cv);
    by = lerp(by, gy, cv);
    a1r = lerp(a1r, RG / SQ3, cv);
    a2r = lerp(a2r, RG / SQ3, cv);
    br = lerp(br, RG / SQ3, cv);
    // falling onto the drip at the top of the FAQ's list
    let handoff = 0;
    if (fl > 0) {
      const d = faqHead.getBoundingClientRect(); // the head of the drip, centred on its line
      const tx = (d.left / W - 0.5) * A;
      const ty = 0.5 - (d.top + 4) / H;
      const head = easeIO(fl);
      const tail = easeIO(clamp((fl - 0.12) / 0.88, 0, 1)); // the tail lags: a falling teardrop
      const rd = 7 / H / SQ2; // the drip's head, two blobs on top of each other
      const vanish = 1 - smoothstep(0.9, 1, fl);
      a1x = a2x = lerp(gx, tx, head);
      a1y = a2y = lerp(gy, ty, head);
      a1r = a2r = lerp(RG / SQ3, rd, head) * vanish;
      bx = lerp(gx, tx, tail);
      by = lerp(gy, ty, tail);
      br = lerp(RG / SQ3, rd * 0.6, tail) * vanish;
      handoff = smoothstep(0.85, 1, fl);
    }
    css(faqDrip, 'opacity', handoff.toFixed(3));
    css(canvasEl, 'opacity', (1 - seg(u, OUT + 0.66, OUT + 0.8)).toFixed(3));

    // the liquid: filled by the droplets, settled at the bottom of each formula,
    // then all ember for the fall
    const lvl = lerp(lerp(fill, 0.24, s1), 12, cv); // over-full: all liquid, no meniscus
    const tint = cv > 0.5 ? 5 : 0;
    const visA = lerp(lerp(RB, R1, s1), R1, s2b) * (1 - cv * 0.28);
    const visB = lerp(lerp(RB, R1, s1), br, s2a) * (1 - cv * 0.28);
    // (the level climbs way past the top as they gather: the whole drop turns liquid)
    const hA = Math.max(2 * visA, 0.02);
    const hB = Math.max(2 * visB, 0.02);
    gl.setLiquid(1, lvl, a1y - hA / 2, hA, tint);
    gl.setLiquid(2, lvl, a2y - hA / 2, hA, tint);
    gl.setLiquid(3, lvl, by - hB / 2, hB, tint);

    // cursor drop (spring), only while the drops are there to play with
    const k = 120;
    const damp = 15;
    const playing = ptr.has && u > LAND + 0.1 && u < OUT;
    root.classList.toggle('cursor-drop', playing);
    cur.vx += (k * (ptr.x - cur.x) - damp * cur.vx) * dt;
    cur.vy += (k * (ptr.y - cur.y) - damp * cur.vy) * dt;
    cur.x += cur.vx * dt;
    cur.y += cur.vy * dt;
    cur.r = lerp(cur.r, playing ? 0.026 : 0, 0.12);
    gl.setBlob(0, cur.x, cur.y, cur.r, 0.4);
    gl.setLiquid(0, 0, 0, 1, 0);

    // calm outlines: these drops carry the texts
    gl.setBlob(1, a1x, a1y, a1r * breathe(1), 0.45);
    gl.setBlob(2, a2x, a2y, a2r * breathe(2), 0.45);
    gl.setBlob(3, bx, by, br * breathe(3), 0.45);
    gl.render(t); // (the reviews' clock: their lights and their sphere's surface go on the same)

    // --- texts riding on the drops ---
    show(head, seg(u, 0.32, 0.62) * (1 - seg(u, OUT, OUT + 0.15)));
    place(core, toX(0), toY(y0 + 0.01), ' translate(-50%, -50%)');
    show(core, seg(u, FULL - 0.04, FULL + 0.14) * (1 - seg(u, Q1, Q1 + 0.12)));
    inc.forEach((el, i) => {
      const [sx, sy] = SPOT[i];
      const left = !MOBILE && sx < 0; // (on a phone, all to the right of their droplet)
      const off = (RS + 0.026) * H;
      place(el, toX(sx) + (left ? -off : off), toY(sy), left ? ' translate(-100%, -50%)' : ' translate(0, -50%)');
      show(el, seg(u, 0.48 + 0.05 * i, 0.72 + 0.05 * i) * (1 - seg(u, Q1 - 0.12, Q1 + 0.04)));
    });
    roll(q1, seg(u, Q1 + 0.15, Q1 + 0.35) * (1 - seg(u, Q2 - 0.1, Q2 + 0.02)), u > Q2 - 0.1);
    roll(q2, seg(u, Q2 + 0.12, Q2 + 0.3) * (1 - seg(u, OUT, OUT + 0.12)), u > OUT);

    const o1 = seg(u, Q1 + 0.22, Q1 + 0.4) * (1 - seg(u, Q2 - 0.08, Q2 + 0.04));
    const vitR = ar * (s2b > 0 ? 1 : SQ2); // the pair reads as one drop of radius ar·√2
    place(vitrine, toX(ax), toY(ay));
    cssVar(vitrine, '--r', `${(R1 * H).toFixed(1)}px`);
    cssVar(vitrine, '--k', clamp(vitR / R1, 0.5, 1).toFixed(3));
    show(vitrine, o1, true);
    place(mesure, toX(lerp(0, xOff, s1)), toY(lerp(y0, yc, s1)));
    cssVar(mesure, '--r', `${(R1 * H).toFixed(1)}px`);
    cssVar(mesure, '--k', clamp(lerp(rEach, R1, s1) / R1, 0.5, 1).toFixed(3));
    show(mesure, o1, true);

    const o2 = seg(u, Q2 + 0.28, Q2 + 0.45) * (1 - seg(u, OUT, OUT + 0.12));
    [once, sub].forEach((el, i) => {
      place(el, toX(ax + (i ? 1 : -1) * xOff * s2b), toY(ay));
      cssVar(el, '--r', `${(R1 * H).toFixed(1)}px`);
      cssVar(el, '--k', clamp(ar / R1, 0.5, 1).toFixed(3));
      show(el, o2, true);
    });
    place(mini, toX(lerp(lerp(0, xOff, s1), xMini, s2a)), toY(lerp(lerp(y0, yc, s1), yMini, s2a)), ' translate(-50%, -50%)');
    show(mini, seg(u, Q2 + 0.15, Q2 + 0.3) * (1 - seg(u, OUT, OUT + 0.1)), true);
  });

  onResized(() => {
    gl.resize();
    measureInc();
  });
}

/* ------------------------------------------------------------------
   FAQ — a drop runs down the questions as you read (stretching with
   the scroll speed); each answer opens like a drop growing from its
   button
------------------------------------------------------------------ */
function initFaq() {
  const list = $('.faq__list');
  const drip = $('.faq__drip');
  const items = $$('.faq__item');

  // the title surfaces word by word as the section comes up over the tarifs
  const ftitle = $('.faq__title');
  splitWords(ftitle);
  gsap
    .timeline({ scrollTrigger: { trigger: '.faq', start: 'top 62%', toggleActions: 'play none none reverse' } })
    .from($$('.w', ftitle), { yPercent: 70, opacity: 0, filter: 'blur(8px)', stagger: 0.06, duration: 1.2, ease: 'expo.out' })
    .from('.faq__more', { y: 20, opacity: 0, duration: 1, ease: 'expo.out' }, 0.35);
  const AT = 'at 96% 0%';
  const close = (item) => {
    if (!item.classList.contains('is-open')) return;
    item.classList.remove('is-open');
    $('.faq__q', item).setAttribute('aria-expanded', 'false');
    gsap.to($('.faq__a-in', item), { clipPath: `circle(0% ${AT})`, duration: 0.55, ease: 'power3.in' });
    gsap.to($('.faq__a', item), { height: 0, duration: 0.7, ease: 'expo.inOut', delay: 0.12 });
  };
  const open = (item) => {
    item.classList.add('is-open');
    $('.faq__q', item).setAttribute('aria-expanded', 'true');
    gsap.to($('.faq__a', item), { height: 'auto', duration: 0.85, ease: 'expo.inOut' });
    gsap.fromTo($('.faq__a-in', item), { clipPath: `circle(0% ${AT})` }, { clipPath: `circle(150% ${AT})`, duration: 1.2, ease: 'power3.out', delay: 0.05 });
  };
  items.forEach((item) => {
    $('.faq__q', item).addEventListener('click', () => {
      const isOpen = item.classList.contains('is-open');
      items.forEach((o) => o !== item && close(o));
      if (isOpen) close(item);
      else open(item);
      setTimeout(() => ScrollTrigger.refresh(), 1000);
    });
  });

  let target = 0;
  let p = 0;
  let st = 1;
  let visible = false;
  ScrollTrigger.create({
    trigger: list,
    start: 'top 72%',
    end: 'bottom 62%',
    onUpdate: (self) => (target = self.progress),
    onRefresh: (self) => (target = self.progress),
  });
  ScrollTrigger.create({
    trigger: list,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (s) => {
      visible = s.isActive;
      if (visible) p = target; // (arriving from far away: no rewind)
    },
  });
  gsap.ticker.add(() => {
    if (!visible) return;
    p = lerp(p, target, 0.1);
    st = lerp(st, 1 + clamp(Math.abs(lenis.velocity || 0) * 0.05, 0, 1.4), 0.12);
    cssVar(drip, '--p', p.toFixed(4));
    cssVar(drip, '--st', st.toFixed(3));
    // each question soaks up the ink as the drop reaches it, from left to right
    const h = list.offsetHeight || 1;
    items.forEach((item) => {
      const k = clamp((p - item.offsetTop / h + 0.02) / 0.12, 0, 1);
      cssVar(item, '--k', k.toFixed(3));
      css(item, 'transform', `translateX(${((1 - k) * 14).toFixed(1)}px)`);
    });
  });
}

/* ------------------------------------------------------------------
   Contact
------------------------------------------------------------------ */
function preselect(group, value) {
  const input = $(`.chips[data-group="${group}"] input[value="${value}"]`);
  if (!input) return;
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function initContact() {
  $$('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const value = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(value);
        toast(`Pseudo Discord « ${value} » copié`);
      } catch {
        toast(`Discord : ${value}`);
      }
    })
  );

  // chips: an ember drop slides to the chosen option, stretching on the way like a liquid
  $$('.chips').forEach((group) => {
    const blob = $('.chips__blob', group);
    let last = null;
    // layout offsets, not screen boxes: the letter may still be folded in 3D
    const rectOf = () => {
      const input = $('input:checked', group);
      if (!input) return null;
      const label = input.parentElement;
      const span = input.nextElementSibling;
      return { x: label.offsetLeft, y: label.offsetTop, width: span.offsetWidth, height: span.offsetHeight };
    };
    const place = (animate) => {
      const to = rectOf();
      if (!to) return gsap.set(blob, { opacity: 0 });
      if (!animate || !last) {
        gsap.set(blob, { ...to, opacity: 1 });
        last = to;
        return;
      }
      gsap.killTweensOf(blob);
      if (Math.abs(last.y - to.y) < 4) {
        const left = Math.min(last.x, to.x);
        const right = Math.max(last.x + last.width, to.x + to.width);
        gsap
          .timeline()
          .to(blob, { x: left, width: right - left, duration: 0.26, ease: 'power2.in' })
          .to(blob, { x: to.x, width: to.width, duration: 0.75, ease: 'elastic.out(1, 0.55)' });
      } else {
        gsap
          .timeline()
          .to(blob, { scaleY: 0.6, duration: 0.18, ease: 'power2.in' })
          .to(blob, { x: to.x, y: to.y, width: to.width, height: to.height, duration: 0.55, ease: 'expo.inOut' }, 0.05)
          .to(blob, { scaleY: 1, duration: 0.7, ease: 'elastic.out(1, 0.45)' }, 0.45);
      }
      last = to;
    };
    group.addEventListener('change', () => place(true));
    place(false);
    onRealResize(() => place(false));
  });

  // the send button fills with liquid as the form gets completed
  const form = $('.form');
  const send = $('.send');
  const pct = $('.send__pct');
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const level = () => {
    const d = new FormData(form);
    let n = 0;
    if (String(d.get('name') || '').trim().length > 1) n++;
    if (emailOk(String(d.get('email') || '').trim())) n++;
    if (String(d.get('message') || '').trim().length > 9) n++;
    const v = n / 3;
    send.style.setProperty('--lvl', v.toFixed(3));
    send.classList.toggle('is-full', v >= 1);
    pct.textContent = `${Math.round(v * 100)} %`;
  };
  form.addEventListener('input', (e) => {
    level();
    // a field flagged as missing clears as soon as it is filled in
    const field = e.target.closest && e.target.closest('.field.is-error');
    if (field) {
      const k = e.target.name;
      const val = String(e.target.value || '').trim();
      if (val && (k !== 'email' || emailOk(val))) field.classList.remove('is-error');
    }
  });
  level();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    let ok = true;
    ['name', 'email', 'message'].forEach((k) => {
      const field = form.elements[k].closest('.field');
      const val = String(data.get(k) || '').trim();
      const bad = !val || (k === 'email' && !emailOk(val));
      field.classList.toggle('is-error', bad);
      if (bad) ok = false;
    });
    if (!ok) {
      toast('Merci de compléter les champs indiqués');
      return;
    }
    const subject = `Demande de devis — ${data.get('type')}`;
    const body = [
      `Nom : ${data.get('name')}`,
      `Email : ${data.get('email')}`,
      `Type de projet : ${data.get('type')}`,
      `Budget : ${data.get('budget')}`,
      '',
      String(data.get('message')),
    ].join('\n');
    window.location.href = `mailto:contact@kalionstudio.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast('Votre messagerie s’ouvre avec votre demande');
  });

  initContactScene();
}

/* ------------------------------------------------------------------
   Contact — the arrival, pinned on one screen:
   - « Parlons » comes from the left, « ensemble. » from the right: the
     two words meet in the middle, big;
   - the drop that ran down the FAQ comes off the end of its line and
     falls onto the title: it becomes the full stop of « ensemble. »;
   - the title settles top left while the letter (the form) comes up,
     folded in three and sealed with an ember drop; the scroll unfolds
     it, flap after flap, and the ways to reach us come in beside it.
------------------------------------------------------------------ */
let contactY = null; // scroll position where the letter is open (nav links)

// On a phone the letter is taller than the screen: nothing is pinned. The two words meet
// as the title comes up the screen, the FAQ's drop falls onto its full stop, then the
// letter comes up folded and unfolds as it rises, and the ways to reach us follow it.
function initContactMobile() {
  const pinEl = $('.contact__pin');
  const title = $('.contact__title');
  const wa = $('.ct-word--a');
  const wb = $('.ct-word--b');
  const dot = $('.ct-dot');
  const letter = $('.letter');
  const f1 = $('.fold--1');
  const f3 = $('.fold--3');
  const seal = $('.letter__seal');
  const side = [$('.contact__lead'), ...$$('.channel')];
  const fly = $('.fly-drop');
  const faqHead = $('.faq__drip-drop');
  const seg = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const faqEnd = ScrollTrigger.create({ trigger: '.faq__list', start: 'bottom 62%' });
  const MEET = 0.36; // the words have met when the title is this high on the screen
  let titleY = 0; // the title's place in the page
  const measure = () => (titleY = title.getBoundingClientRect().top + window.scrollY);
  measure();
  ScrollTrigger.addEventListener('refresh', measure);
  contactY = () => titleY - 96;
  const turn = (fold, angle, z) => {
    const a = Math.abs(angle) < 0.05 ? 0 : angle;
    css(fold, 'transform', a ? `translateZ(${z}px) rotateX(${a.toFixed(2)}deg)` : 'none');
    cssVar(fold, '--shade', (Math.sin((Math.abs(a) * Math.PI) / 180) * 0.8).toFixed(3));
  };
  let visible = false;
  ScrollTrigger.create({ trigger: '.contact', start: 'top bottom', end: 'bottom top', onToggle: (s) => (visible = s.isActive) });
  gsap.ticker.add(() => {
    const W = vp.w;
    const H = vp.h;
    const y = window.scrollY;

    // --- the drop falling from the FAQ onto the full stop ---
    const f = seg(y, faqEnd.start, titleY - H * MEET);
    const flying = f > 0 && f < 1;
    css(fly, 'opacity', flying ? '1' : '0');
    css(faqHead, 'opacity', f > 0 ? '0' : '');
    if (flying) {
      const a = faqHead.getBoundingClientRect();
      const b = dot.getBoundingClientRect();
      const x = lerp(a.left, b.left + b.width * 0.42, easeInOutCubic(f));
      const yy = lerp(a.top + 3, b.top + b.height * 0.78, f * f);
      const st = 1 + 0.9 * Math.sin(f * Math.PI) * (1 - f);
      css(fly, 'transform', `translate3d(${x.toFixed(1)}px, ${yy.toFixed(1)}px, 0) scale(${(1 / Math.sqrt(st)).toFixed(3)}, ${st.toFixed(3)})`);
    }
    if (!visible) return;

    // --- the two words meet ---
    const top = titleY - y; // the title on the screen
    const meet = easeOut(seg(top, H * 0.98, H * MEET));
    css(wa, 'transform', `translate3d(${(-(1 - meet) * W * 0.6).toFixed(1)}px, 0, 0)`);
    css(wb, 'transform', `translate3d(${((1 - meet) * W * 0.6).toFixed(1)}px, 0, 0)`);
    const land = seg(top, H * MEET, H * (MEET - 0.1));
    css(dot, 'opacity', top <= H * MEET + 2 ? '1' : '0');
    css(dot, 'transform', `scale(${(1 + 0.35 * Math.sin(land * Math.PI) * (1 - land)).toFixed(3)}, ${(1 - 0.25 * Math.sin(land * Math.PI) * (1 - land)).toFixed(3)})`);

    // --- the letter comes up folded and unfolds, flap after flap ---
    // (positions from the layout, not from the boxes on screen: those move with the very
    // transforms set here, which would feed back into the progress)
    const pinTop = pinEl.getBoundingClientRect().top;
    const lp = seg(pinTop + letter.offsetTop + letter.offsetHeight / 2, H * 1.25, H * 0.45);
    const come = easeOut(seg(lp, 0, 0.35));
    css(letter, 'transform', come < 0.999 ? `perspective(1400px) translate3d(0, ${((1 - come) * 18).toFixed(2)}vh, 0) rotateX(${((1 - come) * 40).toFixed(2)}deg)` : 'none');
    css(letter, 'opacity', seg(lp, 0, 0.22).toFixed(3));
    turn(f1, -180 * (1 - easeInOutCubic(seg(lp, 0.3, 0.65))), 2);
    turn(f3, 180 * (1 - easeInOutCubic(seg(lp, 0.55, 0.95))), 1);
    css(seal, 'transform', `scale(${(1 - seg(lp, 0.3, 0.4)).toFixed(3)})`);

    // --- the words around it, as they come up ---
    side.forEach((el) => {
      const k = easeOut(seg(pinTop + el.offsetTop, H * 1.0, H * 0.78));
      css(el, 'opacity', k.toFixed(3));
      css(el, 'transform', k < 0.999 ? `translate3d(0, ${((1 - k) * 26).toFixed(1)}px, 0)` : 'none');
    });
  });
}

function initContactScene() {
  if (MOBILE) return initContactMobile();
  const section = $('.contact');
  const pinEl = $('.contact__pin');
  const title = $('.contact__title');
  const wa = $('.ct-word--a');
  const wb = $('.ct-word--b');
  const dot = $('.ct-dot');
  const letter = $('.letter');
  const f1 = $('.fold--1');
  const f3 = $('.fold--3');
  const seal = $('.letter__seal');
  const side = [$('.contact__lead'), ...$$('.channel')];
  const fly = $('.fly-drop');
  const faqHead = $('.faq__drip-drop');
  const seg = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // choreography, in viewport heights of scroll (0 = the section reaches the top)
  const MEET = 0.35; // the words have met, the drop lands on the full stop
  const TOTAL = 1.6;
  const pin = ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: () => `+=${vp.h * TOTAL}`,
    pin: pinEl,
    invalidateOnRefresh: true,
  });
  contactY = () => pin.end;
  if (import.meta.env.DEV) window.__ct = { pin }; // dev only: lets the preview tests jump to a moment
  // the drop leaves the FAQ once its drip has reached the last question
  const faqEnd = ScrollTrigger.create({ trigger: '.faq__list', start: 'bottom 62%' });

  // the title's final place (top left, scale 1) vs its big centred moment
  let box = null;
  const measure = () => {
    css(title, 'transform', 'none');
    box = { left: title.offsetLeft, top: title.offsetTop, w: title.offsetWidth, h: title.offsetHeight };
  };
  measure();

  const turn = (fold, angle, z) => {
    const a = Math.abs(angle) < 0.05 ? 0 : angle;
    css(fold, 'transform', a ? `translateZ(${z}px) rotateX(${a.toFixed(2)}deg)` : 'none');
    cssVar(fold, '--shade', (Math.sin((Math.abs(a) * Math.PI) / 180) * 0.8).toFixed(3));
  };

  let visible = false;
  ScrollTrigger.create({ trigger: section, start: 'top bottom', end: 'bottom top', onToggle: (s) => (visible = s.isActive) });
  gsap.ticker.add(() => {
    const W = vp.w;
    const H = vp.h;
    const y = window.scrollY;

    // --- the drop falling from the FAQ onto the full stop ---
    const f = seg(y, faqEnd.start, pin.start + H * MEET);
    const flying = f > 0 && f < 1;
    css(fly, 'opacity', flying ? '1' : '0');
    css(faqHead, 'opacity', f > 0 ? '0' : '');
    if (flying) {
      const a = faqHead.getBoundingClientRect();
      const b = dot.getBoundingClientRect();
      const x0 = a.left;
      const y0 = a.top + 3;
      const x1 = b.left + b.width * 0.42;
      const y1 = b.top + b.height * 0.78;
      const x = lerp(x0, x1, easeInOutCubic(f));
      const yy = lerp(y0, y1, f * f); // gravity
      const st = 1 + 0.9 * Math.sin(f * Math.PI) * (1 - f); // stretched while it falls fast
      css(fly, 'transform', `translate3d(${x.toFixed(1)}px, ${yy.toFixed(1)}px, 0) scale(${(1 / Math.sqrt(st)).toFixed(3)}, ${st.toFixed(3)})`);
    }
    if (!visible) return;

    const u = (y - pin.start) / H;

    // --- the two words meet, big, in the middle ---
    const meet = easeOut(seg(u, -0.6, MEET));
    const settle = easeInOutCubic(seg(u, MEET + 0.08, 0.82));
    const S = Math.min(2.3, (W * 0.8) / box.w);
    const big = 1 - settle;
    const sc = lerp(1, S, big);
    const tx = (W / 2 - (box.w * S) / 2 - box.left) * big;
    const ty = (H * 0.44 - (box.h * S) / 2 - box.top) * big;
    css(title, 'transform', `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`);
    css(wa, 'transform', `translate3d(${(-(1 - meet) * W * 0.5 / sc).toFixed(1)}px, 0, 0)`);
    css(wb, 'transform', `translate3d(${((1 - meet) * W * 0.5 / sc).toFixed(1)}px, 0, 0)`);
    // the full stop appears when the drop lands, with a little squash
    const land = seg(u, MEET - 0.01, MEET + 0.12);
    css(dot, 'opacity', u >= MEET - 0.005 ? '1' : '0');
    css(dot, 'transform', `scale(${(1 + 0.35 * Math.sin(land * Math.PI) * (1 - land)).toFixed(3)}, ${(1 - 0.25 * Math.sin(land * Math.PI) * (1 - land)).toFixed(3)})`);

    // --- the letter comes up, folded, then unfolds flap after flap ---
    const come = easeOut(seg(u, 0.4, 0.88));
    css(letter, 'transform', come < 0.999 ? `perspective(1600px) translate3d(0, ${((1 - come) * 62).toFixed(2)}vh, 0) rotateX(${((1 - come) * 48).toFixed(2)}deg)` : 'none');
    css(letter, 'opacity', seg(u, 0.4, 0.6).toFixed(3));
    const open1 = easeInOutCubic(seg(u, 0.84, 1.12));
    const open3 = easeInOutCubic(seg(u, 1.06, 1.36));
    turn(f1, -180 * (1 - open1), 2);
    turn(f3, 180 * (1 - open3), 1);
    css(seal, 'transform', `scale(${(1 - seg(u, 0.84, 0.92)).toFixed(3)})`);

    // --- the ways to reach us, one after the other ---
    side.forEach((el, i) => {
      const k = easeOut(seg(u, 1.1 + i * 0.05, 1.4 + i * 0.05));
      css(el, 'opacity', k.toFixed(3));
      css(el, 'transform', k < 0.999 ? `translate3d(${(-(1 - k) * 40).toFixed(1)}px, 0, 0)` : 'none');
    });
  });

  onResized(measure);
}

/* ------------------------------------------------------------------
   Footer — the liquid word condenses again (reveal)
------------------------------------------------------------------ */
function initFooter() {
  ScrollTrigger.create({
    trigger: '.footer',
    start: 'top bottom',
    end: 'bottom bottom',
    onUpdate: (self) => {
      glState.footer = self.progress;
      syncGL();
    },
  });
}

// (played once, the first time the footer comes up)
function initFooterReveal() {
  gsap.from('.footer__top > *, .footer__bottom', {
    y: 50,
    opacity: 0,
    stagger: 0.1,
    duration: 1.2,
    ease: 'expo.out',
    scrollTrigger: { trigger: '.footer', start: 'top 60%' },
  });
}

/* ------------------------------------------------------------------
   Boot
------------------------------------------------------------------ */
// lets the browser paint (the preloader) before the next heavy step
const nextFrame = () =>
  new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setTimeout(resolve, 0);
    };
    requestAnimationFrame(go);
    setTimeout(go, 150); // (a hidden tab has no frames)
  });

// resolves once the first frame has actually been shown
const firstPaint = () =>
  new Promise((resolve) => {
    const done = () => setTimeout(resolve, 0);
    try {
      if (performance.getEntriesByType('paint').length) return done();
      const po = new PerformanceObserver(() => {
        po.disconnect();
        done();
      });
      po.observe({ type: 'paint' });
    } catch (e) {
      nextFrame().then(nextFrame).then(done);
      return;
    }
    setTimeout(done, 600); // (never wait longer than this)
  });

async function boot() {
  // The preloader is on screen from the very first frame (index.html) and its counter
  // rolls on its own. Each WebGL scene is started in its own frame (their shaders then
  // compile in the background), the heaviest first (the projects' 3D title and its
  // lighting); the first one waits until the preloader is really on screen.
  let gate = firstPaint().then(nextFrame);
  gate.then(makeGrain);
  const all = [initProjectsTitle, initGL, initJourney, initDrops, initReviewsGL].map((init) => {
    const ready = gate.then(() => init());
    gate = gate.then(nextFrame);
    return ready;
  });
  // (the images are further down the page: they don't hold the opening)
  await Promise.all([document.fonts.ready, ...all]);

  initCursor();
  initMagnetic();
  initNav();
  initMenu();
  initQuality();
  initLights();
  initHero();
  initAbout();
  initPillars();
  initProjects();
  initMore();
  initReviews();
  initPricing();
  initFaq();
  initContact();
  initFooter();
  initReveals();
  initThemes();
  ScrollTrigger.refresh();
  initResizeKeep();
  syncGL();
  initFooterReveal();
  await nextFrame();

  // everything is ready: the counter runs to 100 (the logo stays at least a moment), and
  // the page opens straight away
  await wait(FAST ? 0 : Math.max(0, 900 - performance.now()));
  // (very slow device: public/boot-guard.js may have opened the page already)
  if (!$('.loader')) return openWithoutIntro();
  await finishCounter(FAST ? 0.01 : 0.5);
  await wait(FAST ? 0 : 60);
  if (!$('.loader')) return openWithoutIntro();
  playIntro();
}

// the page without its opening (the preloader is already gone)
function openWithoutIntro() {
  window.__kalionOpened = true;
  root.classList.remove('boot-fallback');
  if (gl) gl.assemble(0, 0);
  navIn();
  lenis.start();
}

boot();
