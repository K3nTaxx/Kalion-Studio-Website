/* Kalion Studio — a safety net for the preloader.
   The site's script removes the preloader itself once the page is ready. If that script
   cannot run at all (a very old browser, a failed download), the visitor must not stay in
   front of the logo forever: after a while the preloader steps aside and the page can be
   read and scrolled. (Plain old JavaScript on purpose: it has to run everywhere.) */
(function () {
  var html = document.documentElement;
  function bail() {
    if (window.__kalionOpened) return;
    var loader = document.querySelector('.loader');
    if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
    if ((' ' + html.className + ' ').indexOf(' boot-fallback ') < 0) html.className += ' boot-fallback';
  }
  // the script never even started: give up early; it started but never opened: later
  setTimeout(function () {
    if (!window.__kalionStarted) bail();
  }, 15000);
  setTimeout(bail, 45000);
})();
