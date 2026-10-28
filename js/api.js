// Browser helper for the API, shared by the quiz, admin and superadmin pages.
// Login tokens live in sessionStorage only: closing the tab logs out.
(function (g) {
  'use strict';
  var mem = {};

  function base() {
    var v = String((g.SCAM_CONFIG || {}).apiBase || '').trim();
    if (!v) return location.origin;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try { return new URL(v).origin; } catch (e) { return location.origin; }
  }

  function session(role) {
    try { return JSON.parse(sessionStorage.getItem('scamsite.' + role)) || null; } catch (e) { return mem[role] || null; }
  }
  function setSession(role, s) {
    mem[role] = s;
    try { if (s) sessionStorage.setItem('scamsite.' + role, JSON.stringify(s)); else sessionStorage.removeItem('scamsite.' + role); } catch (e) {}
  }

  // Resolves { ok, status, body } for any HTTP answer; rejects { network: true } if the server cannot be reached.
  function call(method, path, body, role, raw) {
    var headers = {};
    if (body) headers['content-type'] = 'application/json';
    var s = role && session(role);
    if (s) headers.authorization = 'Bearer ' + s.token;
    var ctrl = g.AbortController ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 10000);
    return fetch(base() + path, {
      method: method, headers: headers, cache: 'no-store',
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      var read = raw && r.ok ? r.blob() : r.json().catch(function () { return {}; });
      return read.then(function (b) { return { ok: r.ok, status: r.status, body: b }; });
    }, function () {
      if (timer) clearTimeout(timer);
      throw { network: true };
    });
  }

  g.ScamApi = { base: base, call: call, session: session, setSession: setSession };
})(window);
