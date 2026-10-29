// The only setting in the ducks.ai upload: where the mini-site comes from.
//   base:      the Vercel site that serves index.html, css/ and js/ (must end with "/")
//   mode:      "remote" = load from Vercel, falling back to the bundled copy if Vercel is unreachable
//              "local"  = frozen: always use the bundled copy
//   timeoutMs: how long to wait for Vercel before using the bundled copy
window.SITE_SHELL_CONFIG = {
  base: 'https://ducks-vercel-api.vercel.app/',
  mode: 'remote',
  timeoutMs: 5000
};
