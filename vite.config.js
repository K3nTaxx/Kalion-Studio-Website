import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// The site's public address, for the links search engines and link previews need in full
// (canonical, og:image, sitemap). On Netlify, URL is the site's main address — the custom
// domain once one is connected — so nothing has to be changed by hand. SITE_URL overrides it.
const SITE_URL = (process.env.SITE_URL || process.env.URL || 'https://kalion-studio.netlify.app').replace(/\/+$/, '');

// the pages listed in the sitemap
const PAGES = [
  { path: '/', priority: '1.0' },
  { path: '/mentions-legales/', priority: '0.3' },
  { path: '/politique-de-confidentialite/', priority: '0.3' },
  { path: '/cgv/', priority: '0.4' },
];

function site() {
  return {
    name: 'kalion-site',
    // %SITE_URL% in the pages → the full address
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    },
    // robots.txt and sitemap.xml, written with the same address
    generateBundle() {
      const day = new Date().toISOString().slice(0, 10);
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          PAGES.map((p) => `  <url>\n    <loc>${SITE_URL}${p.path}</loc>\n    <lastmod>${day}</lastmod>\n    <priority>${p.priority}</priority>\n  </url>\n`).join('') +
          `</urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [site()],
  build: {
    // Older iPhones too (iOS 15+): the scripts are written down to what they understand, and
    // the media queries keep their classic syntax (the "range" one needs Safari 16.4) —
    // otherwise an iPhone on iOS 15–16 would stay on the preloader, or get the computer layout
    target: ['es2020', 'chrome100', 'edge100', 'firefox100', 'safari15'],
    cssTarget: ['chrome100', 'edge100', 'firefox100', 'safari15'],
    chunkSizeWarningLimit: 1000, // (three.js: one large module, loaded behind the preloader)
    rollupOptions: {
      input: {
        main: resolve(ROOT, 'index.html'),
        mentions: resolve(ROOT, 'mentions-legales/index.html'),
        confidentialite: resolve(ROOT, 'politique-de-confidentialite/index.html'),
        cgv: resolve(ROOT, 'cgv/index.html'),
        notfound: resolve(ROOT, '404.html'),
      },
    },
  },
});
