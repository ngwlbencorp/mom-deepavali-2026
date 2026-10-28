// Language handling for the mini-site. A language file (js/lang/<code>.js) registers itself in
// SCAM_LANGS and SCAM_TEXT[code]; any text it leaves out falls back to English, and answers,
// flags and scoring always come from the English definition.
(function (g) {
  'use strict';
  var KEY = 'scamsite.lang';

  // Overlay "over" onto "base", keeping base's shape: arrays by index, objects by key, and only
  // values of the same type (so a translation can never change a boolean flag or an answer index).
  function merge(base, over) {
    if (over === undefined || over === null) return base;
    if (Array.isArray(base)) return base.map(function (b, i) { return merge(b, Array.isArray(over) ? over[i] : undefined); });
    if (base && typeof base === 'object') {
      var out = {};
      for (var k in base) out[k] = merge(base[k], over[k]);
      return out;
    }
    if (typeof base === 'string' && typeof over === 'string') return over;
    return base;
  }

  function langs() { return g.SCAM_LANGS || [{ code: 'en', name: 'English' }]; }
  function known(code) { return langs().some(function (l) { return l.code === code; }); }

  function current() {
    var c = null;
    try { c = localStorage.getItem(KEY); } catch (e) {}
    return c && known(c) ? c : 'en';
  }
  function set(code) {
    if (!known(code)) return;
    try { localStorage.setItem(KEY, code); } catch (e) {}
    document.documentElement.lang = code;
  }
  function text(code) {
    var en = g.SCAM_TEXT.en;
    return code === 'en' ? en : merge(en, g.SCAM_TEXT[code]);
  }
  // "Tap the {n} red flags" + { n: 3 }
  function fmt(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; });
  }

  g.ScamI18n = { langs: langs, current: current, set: set, text: text, fmt: fmt };
})(window);
