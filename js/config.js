// API server, origin only. Pages hosted on ducks call the API here; pages served by this
// same Vercel project also work with it set. This is not a secret.
window.SCAM_CONFIG = { apiBase: 'https://ducks-vercel-api.vercel.app' };
