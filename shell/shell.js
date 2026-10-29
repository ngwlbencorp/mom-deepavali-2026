// ducks.ai shell for the mini-site. Fetches index.html from the Vercel site in config.js, puts its
// page structure into this page, then loads its stylesheets and scripts from Vercel, in order.
// So a push to the repo changes the live mini-site without a new ducks.ai upload.
// If Vercel does not answer within the timeout (or mode is "local"), or a file from it fails to
// load, the copy bundled in ./fallback/ (taken when this zip was built) is used instead.
// The scripts run in this page, so browser storage (claim ID, language) belongs to the ducks.ai
// page, exactly as when the files are uploaded directly.
(function () {
  'use strict';
  var C = window.SITE_SHELL_CONFIG || {};
  var FALLBACK = './fallback/';
  var FLAG = 'siteShell.fallback'; // set for this tab when a remote file failed, so a reload uses the bundle
  var flagged = false;
  try { flagged = sessionStorage.getItem(FLAG) === '1'; } catch (e) {}

  function abs(base, url) { return new URL(url, new URL(base, location.href)).href; }
  function getText(url, ms) {
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = ms && ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    return fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.text();
    }, function (e) { clearTimeout(timer); throw e; });
  }
  function addTag(tag, attrs) {
    return new Promise(function (resolve, reject) {
      var n = document.createElement(tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      if (tag === 'script') n.async = false;
      n.onload = resolve;
      n.onerror = function () { reject(new Error('Could not load ' + (attrs.src || attrs.href))); };
      (tag === 'link' ? document.head : document.body).appendChild(n);
    });
  }

  function start(base, source, html) {
    window.SITE_SHELL = { source: source, base: base };
    var doc = new DOMParser().parseFromString(html, 'text/html');
    document.title = doc.title || document.title;
    document.documentElement.lang = doc.documentElement.lang || 'en';
    var css = [].map.call(doc.querySelectorAll('link[rel="stylesheet"][href]'), function (l) { return abs(base, l.getAttribute('href')); });
    var js = [].map.call(doc.querySelectorAll('script[src]'), function (s) { return abs(base, s.getAttribute('src')); });
    [].forEach.call(doc.querySelectorAll('script, noscript'), function (s) { s.remove(); });
    // Styles first, so the page is measured with its real layout when the scripts start.
    return Promise.all(css.map(function (href) { return addTag('link', { rel: 'stylesheet', href: href }); })).then(function () {
      var loading = document.getElementById('shell-loading');
      if (loading) loading.remove();
      document.body.className = doc.body.className;
      // Insert before anything else in the body; ducks.ai's own additions to the page stay untouched.
      var first = document.body.firstChild;
      [].slice.call(doc.body.childNodes).forEach(function (node) { document.body.insertBefore(document.importNode(node, true), first); });
      // Added together with async off: the browser downloads them in parallel but runs them in order.
      return Promise.all(js.map(function (src) { return addTag('script', { src: src }); }));
    });
  }

  function useFallback() {
    return getText(FALLBACK + 'index.html').then(function (html) { return start(FALLBACK, C.mode === 'local' ? 'local' : 'fallback', html); });
  }

  if (C.mode === 'local' || !C.base || flagged) { useFallback(); return; }
  getText(C.base + 'index.html', C.timeoutMs || 5000).then(function (html) {
    return start(C.base, 'remote', html).catch(function (e) {
      // Part of the remote site failed after some of it ran: start again cleanly from the bundle.
      if (window.console) console.warn('Mini-site: ' + e.message + '; using the bundled copy');
      try { sessionStorage.setItem(FLAG, '1'); } catch (x) { return useFallback(); } // no storage: no reload, or it would loop
      location.reload();
    });
  }, function () { return useFallback(); });
})();
