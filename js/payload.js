// Shared QR payload format, used by the quiz (encode), the admin scanner and the API (decode).
//   SCAM26|<id>|<score>/<total>|<attempts>|<attempt of first full score or ->|<csat 1-5 or ->|<learned Y/S/N or ->|<check>
// The check value only catches typos and casual edits: the salt is visible in
// this file, so it is not tamper-proof.
// Loaded by the browser (window.ScamPayload) and by the API (require).

(function (g) {
  'use strict';
  var PREFIX = 'SCAM26';
  var SALT = 'deepavali-2026';

  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8).slice(0, 6).toUpperCase();
  }

  function encode(r) {
    var body = [
      PREFIX, r.id, r.score + '/' + r.total, r.attempts,
      r.firstFull || '-', r.csat || '-', r.learned || '-'
    ].join('|');
    return body + '|' + hash(body + SALT);
  }

  function decode(text) {
    var t = String(text || '').trim();
    var parts = t.split('|');
    if (parts.length !== 8 || parts[0] !== PREFIX) return { ok: false, reason: 'Not a scam quiz QR code' };
    var body = parts.slice(0, 7).join('|');
    if (hash(body + SALT) !== parts[7]) return { ok: false, reason: 'Code check failed (edited or mistyped)' };
    var st = parts[2].split('/');
    var score = parseInt(st[0], 10), total = parseInt(st[1], 10);
    if (!/^[0-9A-Z]{8}$/.test(parts[1]) || isNaN(score) || isNaN(total)) return { ok: false, reason: 'Malformed code' };
    var num = function (v) { return v === '-' ? null : parseInt(v, 10); };
    return {
      ok: true,
      id: parts[1],
      score: score,
      total: total,
      full: total > 0 && score === total,
      attempts: num(parts[3]),
      firstFull: num(parts[4]),
      csat: num(parts[5]),
      learned: parts[6] === '-' ? null : parts[6]
    };
  }

  var api = { encode: encode, decode: decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else g.ScamPayload = api;
})(typeof window !== 'undefined' ? window : globalThis);
