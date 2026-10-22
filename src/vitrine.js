// « Site vitrine » — the landing page of the Google Ads campaign: the offer, proof, prices and
// the devis form on one fast page. No preloader, no WebGL, no smooth-scroll library: the page
// is readable at once and everything here only adds to it (without this script it still reads,
// and the form still posts itself to Netlify Forms).
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource/dm-mono/400.css';
import './vitrine.css';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const canObserve = 'IntersectionObserver' in window;
const observe = (el, fn, opts) => {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => fn(e, io)), opts);
  io.observe(el);
  return io;
};
// (still below the fold when the page opens: those can wait to be revealed)
const belowFold = (el) => el.getBoundingClientRect().top > window.innerHeight * 0.92;

/* ------------------------------------------------------------------
   Google Ads: the quote requests sent from this page are counted as
   conversions, only if the visitor accepts the cookie (the banner).
   Nothing from Google is loaded before « Accepter »; the choice is kept
   6 months on the device, and the footer's « Cookies » reopens it.
------------------------------------------------------------------ */
const ADS_ID = 'AW-18526991107';
const ADS_LEAD = 'AW-18526991107/IhCPCO6n-6UdEIPmrYJF'; // conversion « Demande de devis »
const CONSENT_KEY = 'kalion-consent';
const CONSENT_DAYS = 182;
const ads = { on: false };

const readConsent = () => {
  try {
    const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
    if (c && Date.now() - c.at < CONSENT_DAYS * 864e5) return c.v;
  } catch (err) {
    // (storage blocked: the banner is asked again)
  }
  return null;
};
const saveConsent = (v) => {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ v, at: Date.now() }));
  } catch (err) {
    // (storage blocked: the choice holds for this visit only)
  }
};
function loadAds() {
  if (ads.on) return;
  ads.on = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  // measurement only: no ad personalisation, no analytics
  window.gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied', analytics_storage: 'denied' });
  window.gtag('js', new Date());
  window.gtag('config', ADS_ID);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`;
  document.head.append(s);
}
// a refusal after an acceptance: Google stops, its cookies are removed
function stopAds() {
  if (ads.on) window.gtag('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied' });
  const host = location.hostname.replace(/^www\./, '');
  document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter((name) => /^(_gcl|_gac)/.test(name))
    .forEach((name) => {
      [``, `; domain=${host}`, `; domain=.${host}`].forEach((d) => (document.cookie = `${name}=; Max-Age=0; path=/${d}`));
    });
}
const trackLead = () => {
  if (ads.on && window.gtag) window.gtag('event', 'conversion', { send_to: ADS_LEAD, value: 1.0, currency: 'EUR' });
};

function initConsent() {
  const box = $('.consent');
  if (!box) return;
  const open = () => {
    box.hidden = false;
    document.documentElement.classList.add('consent-open');
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('is-in')));
  };
  const close = () => {
    box.classList.remove('is-in');
    document.documentElement.classList.remove('consent-open');
    setTimeout(() => (box.hidden = true), 600);
  };
  $$('[data-consent]', box).forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.dataset.consent;
      saveConsent(v);
      if (v === 'granted') loadAds();
      else stopAds();
      close();
    })
  );
  $$('[data-consent-open]').forEach((b) => b.addEventListener('click', open));
  const choice = readConsent();
  if (choice === 'granted') loadAds();
  else if (choice === null) setTimeout(open, 1200);
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('.toast');
  t.textContent = msg;
  t.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-show'), ms);
}

/* ------------------------------------------------------------------
   The top bar takes a background once the page leaves its top; on
   phones a bar with the quote button comes up once the hero's buttons
   are gone, and steps aside at the form (and while typing in it).
------------------------------------------------------------------ */
function initBars() {
  if (!canObserve) return;
  const bar = $('.bar');
  observe($('.sentinel'), (e) => bar.classList.toggle('is-solid', !e.isIntersecting));

  const mbar = $('.mbar');
  const seen = { ctas: true, form: false };
  const sync = () => mbar.classList.toggle('is-on', !seen.ctas && !seen.form);
  observe($('.hero__ctas'), (e) => {
    seen.ctas = e.isIntersecting || e.boundingClientRect.top > 0;
    sync();
  });
  observe($('#devis .formcard'), (e) => {
    seen.form = e.isIntersecting;
    sync();
  });
}

/* ------------------------------------------------------------------
   Reveals: what is still below the fold rises in when it comes into
   view (what is already on screen is never hidden, not even a frame).
------------------------------------------------------------------ */
function initReveals() {
  if (reduced || !canObserve) return;
  $$('[data-rv]')
    .filter(belowFold)
    .forEach((el) => {
      el.classList.add('rv');
      el.style.setProperty('--rd', `${(+el.dataset.rv || 0) * 0.09}s`);
      observe(
        el,
        (e, io) => {
          if (!e.isIntersecting) return;
          el.classList.add('is-in');
          io.disconnect();
        },
        { rootMargin: '0px 0px -8% 0px' }
      );
    });

  // the drop's four layers light up one after the other, with the list beside it
  const inc = $('.inc');
  if (inc && belowFold(inc)) {
    inc.classList.add('is-armed');
    observe(
      inc,
      (e, io) => {
        if (!e.isIntersecting) return;
        inc.classList.add('is-on');
        io.disconnect();
      },
      { rootMargin: '0px 0px -25% 0px' }
    );
  }
}

/* ------------------------------------------------------------------
   The hero's stack of sites: every few seconds the front one slides
   away and comes back at the far end, the others step forward. On a
   computer the stack also leans a little towards the pointer.
------------------------------------------------------------------ */
function initStack() {
  const wins = $$('.win');
  const stack = $('.stack');
  if (wins.length < 2 || !stack) return;

  if (!reduced) {
    let order = wins.map((_, i) => i); // order[0] is the one in front
    const next = () => {
      const front = wins[order[0]];
      order = [...order.slice(1), order[0]];
      front.dataset.pos = 'out';
      order.slice(0, -1).forEach((w, pos) => (wins[w].dataset.pos = pos));
      setTimeout(() => {
        // (jumps, unseen, behind the others, then comes forward to its place at the back)
        front.dataset.pos = 'in';
        void front.offsetWidth;
        front.dataset.pos = order.length - 1;
      }, 560);
    };
    // it turns only while the hero is on screen, the tab visible and the pointer not on it
    let timer = 0;
    let onScreen = true;
    let held = false;
    const run = () => {
      clearInterval(timer);
      timer = onScreen && !held && !document.hidden ? setInterval(next, 2600) : 0;
    };
    const stage = $('.stage');
    stage.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      held = true;
      run();
    });
    stage.addEventListener('pointerleave', () => {
      held = false;
      run();
    });
    if (canObserve)
      observe($('.hero'), (e) => {
        onScreen = e.isIntersecting;
        run();
      });
    document.addEventListener('visibilitychange', run);
    run();
  }

  if (finePointer && !reduced) {
    const hero = $('.hero');
    let raf = 0;
    let px = 0;
    let py = 0;
    hero.addEventListener('pointermove', (e) => {
      px = e.clientX / window.innerWidth - 0.5;
      py = e.clientY / window.innerHeight - 0.5;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        stack.style.setProperty('--rx', `${(7 - py * 8).toFixed(2)}deg`);
        stack.style.setProperty('--ry', `${(-17 + px * 14).toFixed(2)}deg`);
      });
    });
    hero.addEventListener('pointerleave', () => {
      stack.style.removeProperty('--rx');
      stack.style.removeProperty('--ry');
    });
  }
}

/* ------------------------------------------------------------------
   FAQ: a question slides its answer open (the one open before closes)
------------------------------------------------------------------ */
function initFaq() {
  const list = $('.faq__list');
  if (!list) return;
  const items = $$('.qa', list);
  const set = (qa, open) => {
    qa.classList.toggle('is-open', open);
    $('.qa__q', qa).setAttribute('aria-expanded', String(open));
  };
  items.forEach((qa) => {
    set(qa, false);
    $('.qa__q', qa).addEventListener('click', () => {
      const open = !qa.classList.contains('is-open');
      items.forEach((other) => other !== qa && set(other, false));
      set(qa, open);
    });
  });
  list.classList.add('is-js');
}

/* ------------------------------------------------------------------
   The form — the same request as the home page's letter (form « devis »,
   Netlify Forms): the chips' ember drop, the button that fills as the
   form gets completed, the send that never leaves the page.
------------------------------------------------------------------ */
function preselect(group, value) {
  const input = $(`.chips[data-group="${group}"] input[value="${value}"]`);
  if (!input) return;
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// the chips follow the clicked ad (utm_term={keyword}, or ?offre=…): read from the address only
const plain = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function initMessageMatch() {
  const q = new URLSearchParams(location.search);
  const term = plain([q.get('utm_term'), q.get('offre')].filter(Boolean).join(' '));
  if (!term) return;
  if (/e-?commerce|boutique en ligne|vente en ligne/.test(term)) {
    preselect('type', 'E-commerce');
    preselect('budget', 'Sur devis');
    return;
  }
  if (/refonte|refaire|moderniser|nouveau site/.test(term)) preselect('type', 'Refonte de site');
  if (/abonnement|mensuel|par mois|au mois|location|louer|cle en main|tout compris/.test(term)) preselect('budget', 'Abonnement · 450 € puis 28 €/mois');
}

function initChips() {
  $$('.chips').forEach((group) => {
    const blob = $('.chips__blob', group);
    group.classList.add('has-blob');
    const place = (animate) => {
      const input = $('input:checked', group);
      if (!input) {
        blob.style.opacity = '0';
        return;
      }
      const label = input.parentElement;
      const span = input.nextElementSibling;
      if (!animate) blob.style.transition = 'none';
      blob.style.opacity = '1';
      blob.style.width = `${span.offsetWidth}px`;
      blob.style.height = `${span.offsetHeight}px`;
      blob.style.transform = `translate(${label.offsetLeft}px, ${label.offsetTop}px)`;
      if (!animate) {
        void blob.offsetWidth;
        blob.style.transition = '';
      }
    };
    group.addEventListener('change', () => place(true));
    place(false);
    let w = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === w) return; // (a phone's bar hiding is not a resize of the chips)
      w = window.innerWidth;
      place(false);
    });
    if (document.fonts) document.fonts.ready.then(() => place(false));
  });

  // the « Choisir » buttons: their formula is ticked in the form, which glows as it arrives
  const card = $('.formcard');
  $$('[data-type], [data-formula]').forEach((a) =>
    a.addEventListener('click', () => {
      if (a.dataset.type) preselect('type', a.dataset.type);
      if (a.dataset.formula) preselect('budget', a.dataset.formula);
      card.classList.remove('is-called');
      void card.offsetWidth;
      card.classList.add('is-called');
    })
  );
}

function initForm() {
  const form = $('.form');
  form.noValidate = true;
  const send = $('.send', form);
  const pct = $('.send__pct', send);
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  // (a few words about the project are enough: full as soon as the three fields hold something)
  const level = () => {
    const d = new FormData(form);
    let n = 0;
    if (String(d.get('name') || '').trim()) n++;
    if (emailOk(String(d.get('email') || '').trim())) n++;
    if (String(d.get('message') || '').trim()) n++;
    const v = n / 3;
    send.style.setProperty('--lvl', v.toFixed(3));
    send.classList.toggle('is-full', v >= 1);
    pct.textContent = `${Math.round(v * 100)} %`;
  };
  // a field to fix: its line turns red, a short message under it says why (read with the field)
  const MSG = { name: 'Indiquez votre nom', email: 'Indiquez votre adresse e-mail', message: 'Quelques mots sur votre projet' };
  const flag = (input, msg) => {
    const field = input.closest('.field');
    let err = $('.field__err', field);
    if (!err) {
      err = document.createElement('span');
      err.className = 'field__err';
      err.id = `err-${input.name}`;
      field.append(err);
    }
    err.textContent = msg || '';
    field.classList.toggle('is-error', !!msg);
    if (msg) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', err.id);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  };
  form.addEventListener('input', (e) => {
    level();
    // a field flagged as missing clears as soon as it is filled in
    if (e.target.closest && e.target.closest('.field.is-error')) {
      const val = String(e.target.value || '').trim();
      if (val && (e.target.name !== 'email' || emailOk(val))) flag(e.target, '');
    }
  });
  level();

  // Where the request comes from, read from the address when it is sent (an ad click carries
  // utm_* and gclid in it): no cookie, nothing kept on the visitor's device.
  const AD_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid', 'gbraid', 'wbraid'];
  const adParams = () => {
    const q = new URLSearchParams(location.search);
    const p = {};
    AD_KEYS.forEach((k) => {
      const v = (q.get(k) || '').trim();
      if (v) p[k] = v.slice(0, 500);
    });
    return p;
  };
  const origin = (p) => {
    const parts = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term'].map((k) => p[k]).filter(Boolean);
    const click = ['gclid', 'gbraid', 'wbraid'].filter((k) => p[k]).map((k) => `${k}=${p[k]}`)[0] || '';
    const from = !parts.length && !click ? 'Direct ou recherche naturelle' : [parts.join(' / '), click].filter(Boolean).join(' · ');
    return `${from} · page Site vitrine`;
  };
  // 'ok' | 'slow' (no answer within 15 s: it may still have arrived) | 'fail'
  const post = async (data) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString(),
        signal: ctl.signal,
      });
      if (!res.ok) return 'fail';
      // (Netlify answers a received request with its own short page; the home page coming back —
      // its contact section in it — means nothing took the form)
      const text = await res.text();
      return text.includes('id="contact"') ? 'fail' : 'ok';
    } catch (err) {
      return err && err.name === 'AbortError' ? 'slow' : 'fail';
    } finally {
      clearTimeout(timer);
    }
  };
  const resetForm = () => {
    form.reset();
    ['name', 'email', 'message'].forEach((k) => flag(form.elements[k], ''));
    $$('.chips', form).forEach((g) => g.dispatchEvent(new Event('change')));
    level();
  };
  const label = $('.send__label', send);
  const LABEL = label.textContent;
  const status = $('.form__status', form);
  const STATUS = status.innerHTML;
  const WA = 'https://wa.me/33658234103?text=Bonjour%20Kalion%20Studio%2C%20je%20souhaite%20un%20devis%20pour%20mon%20site%20vitrine.';
  const REACH = `Écrivez-nous&nbsp;: <a href="${WA}" target="_blank" rel="noopener">WhatsApp</a> · <a href="mailto:contact@kalionstudio.com">Mail</a>`;
  let sending = false;
  let restore = 0;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    // (a new attempt within the 8 s of a "sent" state: the button and the status come back now)
    if (restore) {
      clearTimeout(restore);
      restore = 0;
      label.textContent = LABEL;
      status.innerHTML = STATUS;
    }
    const data = new FormData(form);
    const bad = ['name', 'email', 'message'].filter((k) => {
      const val = String(data.get(k) || '').trim();
      const msg = !val ? MSG[k] : k === 'email' && !emailOk(val) ? 'Adresse e-mail à vérifier' : '';
      flag(form.elements[k], msg);
      return !!msg;
    });
    if (bad.length) {
      const typo = bad.includes('email') && String(data.get('email') || '').trim();
      toast(typo ? 'Vérifiez votre adresse e-mail' : 'Merci de compléter les champs indiqués', 4000);
      form.elements[bad[0]].focus();
      return;
    }
    // (the hidden spam trap filled in: a robot — nothing is sent)
    if (String(data.get('bot-field') || '').trim()) {
      toast('Merci ! Votre demande est bien envoyée. Réponse sous 24 h.', 7000);
      resetForm();
      return;
    }
    const p = adParams();
    data.set('source', origin(p));
    ['gclid', 'gbraid', 'wbraid', 'utm_term'].forEach((k) => data.set(k, p[k] || ''));
    const who = String(data.get('name')).trim().slice(0, 60);
    data.set('subject', `Devis ${data.get('type')} · ${who}${p.utm_term ? ` · Google « ${p.utm_term.slice(0, 80)} »` : ''}`);

    sending = true;
    send.setAttribute('aria-busy', 'true');
    label.textContent = 'Envoi en cours…';
    const result = await post(data);
    sending = false;
    send.removeAttribute('aria-busy');

    if (result === 'ok') {
      trackLead();
      resetForm();
      label.textContent = 'Demande envoyée ✓';
      status.innerHTML = '<i class="dot"></i>Bien reçu · Réponse sous 24&nbsp;h';
      toast('Merci ! Votre demande est bien envoyée. Réponse sous 24 h.', 7000);
      restore = setTimeout(() => {
        restore = 0;
        label.textContent = LABEL;
        status.innerHTML = STATUS;
      }, 8000);
      return;
    }
    // not sent (or no answer): the text stays, the visitor is told and given the other ways
    label.textContent = 'Réessayer';
    status.innerHTML = REACH;
    toast(
      result === 'slow'
        ? 'Le réseau est lent : votre demande est peut-être partie. Dans le doute, réessayez ou écrivez-nous sur WhatsApp.'
        : 'Envoi impossible pour le moment. Réessayez, ou écrivez-nous sur WhatsApp au 06 58 23 41 03.',
      9000
    );
  });
}

initConsent();
initBars();
initReveals();
initStack();
initFaq();
initChips();
initMessageMatch();
initForm();
