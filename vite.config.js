import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// The site's public address, for the links search engines and link previews need in full
// (canonical, og:image, sitemap): always the main domain, also on Netlify's own addresses and
// previews (they point search engines to it). A SITE_URL environment variable overrides it.
const SITE_URL = (process.env.SITE_URL || 'https://www.kalionstudio.com').replace(/\/+$/, '');

// the pages listed in the sitemap, with the day each one last really changed (update it when
// a page's content changes: a date that moves at every build tells search engines nothing)
const PAGES = [
  { path: '/', priority: '1.0', lastmod: '2026-10-03' },
  { path: '/mentions-legales/', priority: '0.3', lastmod: '2026-10-02' },
  { path: '/politique-de-confidentialite/', priority: '0.3', lastmod: '2026-10-03' },
  { path: '/cgv/', priority: '0.4', lastmod: '2026-10-02' },
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
      // the whole site is open to every crawler; the search engines, AI assistants and link
      // previews are also named one by one, explicitly allowed
      const ROBOTS = [
        '# Kalion Studio — robots.txt',
        '# Tout le site est ouvert aux moteurs de recherche et aux assistants IA.',
        `# Résumé du studio pour les IA : ${SITE_URL}/llms.txt`,
        '',
        'User-agent: *',
        'Allow: /',
        '',
        '# Moteurs de recherche (Google, Bing / Copilot, Apple / Siri, DuckDuckGo)',
        'User-agent: Googlebot',
        'User-agent: Bingbot',
        'User-agent: Applebot',
        'User-agent: DuckDuckBot',
        'Allow: /',
        '',
        '# Assistants IA : recherche et réponses en direct (ChatGPT, Claude, Perplexity, Mistral, DuckDuckGo, Meta AI)',
        'User-agent: OAI-SearchBot',
        'User-agent: ChatGPT-User',
        'User-agent: Claude-SearchBot',
        'User-agent: Claude-User',
        'User-agent: PerplexityBot',
        'User-agent: Perplexity-User',
        'User-agent: MistralAI-User',
        'User-agent: DuckAssistBot',
        'User-agent: meta-externalfetcher',
        'Allow: /',
        '',
        '# Assistants IA : apprentissage des modèles (pour que les IA connaissent Kalion Studio)',
        'User-agent: GPTBot',
        'User-agent: ClaudeBot',
        'User-agent: Google-Extended',
        'User-agent: Applebot-Extended',
        'User-agent: meta-externalagent',
        'User-agent: CCBot',
        'User-agent: Amazonbot',
        'Allow: /',
        '',
        '# Aperçus de liens (Instagram, WhatsApp, Facebook, LinkedIn, X)',
        'User-agent: facebookexternalhit',
        'User-agent: LinkedInBot',
        'User-agent: Twitterbot',
        'Allow: /',
        '',
        `Sitemap: ${SITE_URL}/sitemap.xml`,
        '',
      ].join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: ROBOTS,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          PAGES.map((p) => `  <url>\n    <loc>${SITE_URL}${p.path}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n    <priority>${p.priority}</priority>\n  </url>\n`).join('') +
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
