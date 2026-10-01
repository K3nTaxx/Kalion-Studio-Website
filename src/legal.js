// Legal pages and 404: the site's fonts and colours, a gentle arrival of the blocks,
// and the summary that follows the reading. No WebGL, no smooth-scroll library.
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource/dm-mono/400.css';
import './legal.css';

const $$ = (s) => [...document.querySelectorAll(s)];

// the head, then each section, rise in as they come into view
const blocks = $$('.lg-head > *, .lg-toc, .lg-sec, .nf > *');
blocks.forEach((el) => el.classList.add('lg-reveal'));
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }),
    { rootMargin: '0px 0px -8% 0px' }
  );
  blocks.forEach((el, i) => {
    // (the first ones one after the other)
    if (i < 6) el.style.transitionDelay = `${i * 0.07}s`;
    io.observe(el);
  });
} else blocks.forEach((el) => el.classList.add('is-in'));

// the summary marks the section being read
const links = $$('.lg-toc a');
if (links.length && 'IntersectionObserver' in window) {
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const spy = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        links.forEach((a) => a.classList.remove('is-on'));
        const a = byId.get(e.target.id);
        if (a) a.classList.add('is-on');
      }),
    { rootMargin: '-35% 0px -60% 0px' }
  );
  $$('.lg-sec').forEach((s) => spy.observe(s));
}
