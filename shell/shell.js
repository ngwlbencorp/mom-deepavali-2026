// ducks.ai shell. Fetches one page of the site (config.js: page, default index.html, the mini-site;
// admin/index.html for the officer page) from the Vercel site in config.js, puts its page structure
// into this page, then loads its stylesheets and scripts from there, in order. So a push to the
// repo changes the live page without a new ducks.ai upload.
// With a fallback bundled (the mini-site), it is used if Vercel does not answer within the timeout
// (or mode is "local"), or if a file from it fails to load. Without one (the officer page, which
// cannot work without the API anyway), a short message asks the user to check their connection.
// The scripts run in this page, so browser storage (claim ID, language, officer login) belongs to
// the ducks.ai page, exactly as when the files are uploaded directly.
(function () {
  'use strict';
  var C = window.SITE_SHELL_CONFIG || {};
  var PAGE = C.page || 'index.html';
  var HAS_FALLBACK = C.fallback !== false;
  var FALLBACK = './fallback/';
  var FLAG = 'siteShell.fallback:' + PAGE; // set for this tab when a remote file failed, so a reload uses the bundle
  var flagged = false;
  try { flagged = HAS_FALLBACK && sessionStorage.getItem(FLAG) === '1'; } catch (e) {}
  // ducks.ai lays its own buttons over the top-left of hosted pages, unless switched off (this
  // shell's index.html does, with meta ducks-home); pages make room for them only when they can appear.
  var ducksButtonsOff = !!document.querySelector('meta[name="ducks-home"][content="off"]');
  if (C.hostOverlay === true || (!ducksButtonsOff && /(^|\.)ducks\.ai\.tech\.gov\.sg$/.test(location.hostname))) document.documentElement.classList.add('on-ducks');

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
  function unreachable() {
    var p = document.getElementById('shell-loading');
    if (!p) { p = document.createElement('p'); p.id = 'shell-loading'; document.body.insertBefore(p, document.body.firstChild); }
    p.textContent = 'Cannot reach the server. Check your internet connection, then reload this page.';
  }

  // base: the site's root; the page's own links are relative to the page (e.g. ../js/ for admin/).
  function start(base, source, html) {
    window.SITE_SHELL = { source: source, base: base, page: PAGE };
    var pageUrl = abs(base, PAGE);
    var doc = new DOMParser().parseFromString(html, 'text/html');
    document.title = doc.title || document.title;
    document.documentElement.lang = doc.documentElement.lang || 'en';
    var css = [].map.call(doc.querySelectorAll('link[rel="stylesheet"][href]'), function (l) { return abs(pageUrl, l.getAttribute('href')); });
    var js = [].map.call(doc.querySelectorAll('script[src]'), function (s) { return abs(pageUrl, s.getAttribute('src')); });
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
      return Promise.all(js.map(function (src) { return addTag('script', { src: src }); })).then(function () {
        try { sessionStorage.removeItem('siteShell.retried:' + PAGE); } catch (x) {}
      });
    });
  }

  function useFallback() {
    if (!HAS_FALLBACK) return unreachable();
    return getText(FALLBACK + PAGE).then(function (html) { return start(FALLBACK, C.mode === 'local' ? 'local' : 'fallback', html); });
  }

  if (C.mode === 'local' || !C.base || flagged) { useFallback(); return; }
  getText(C.base + PAGE, C.timeoutMs || 5000).then(function (html) {
    return start(C.base, 'remote', html).catch(function (e) {
      // Part of the remote page failed after some of it ran: start again cleanly from the bundle.
      if (window.console) console.warn('Page: ' + e.message);
      if (!HAS_FALLBACK) { // nothing to fall back to: one more try, then the error message
        var RETRY = 'siteShell.retried:' + PAGE;
        try { if (sessionStorage.getItem(RETRY)) return unreachable(); sessionStorage.setItem(RETRY, '1'); } catch (x) { return unreachable(); }
        return location.reload();
      }
      try { sessionStorage.setItem(FLAG, '1'); } catch (x) { return useFallback(); } // no storage: no reload, or it would loop
      location.reload();
    });
  }, function () { return useFallback(); });
})();
