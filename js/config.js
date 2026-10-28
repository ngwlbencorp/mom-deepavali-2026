// API server, origin only. Pages hosted on ducks call the API here; pages served by this
// same Vercel project also work with it set. This is not a secret.
// eventEnd: after this moment the mini-site stops showing the QR code and all souvenir
// messages. The server enforces the same cutoff for redemptions (env EVENT_END), so a wrong
// phone clock cannot reopen it; when the server can be reached, its answer wins.
window.SCAM_CONFIG = {
  apiBase: 'https://ducks-vercel-api.vercel.app',
  eventEnd: '2026-11-08T21:00:00+08:00'
};
