// The only settings in the ducks.ai upload: where the page comes from, and which page it is.
//   base:      the Vercel site that serves index.html, css/ and js/ (must end with "/")
//   mode:      "remote" = load from Vercel, falling back to the bundled copy if Vercel is unreachable
//              "local"  = frozen: always use the bundled copy
//   timeoutMs: how long to wait for Vercel before using the bundled copy
//   page:      which page of the site this ducks.ai page shows (tools/build-shell.js --admin sets admin/index.html)
//   fallback:  whether a copy of the page is bundled (false for the officer page)
window.SITE_SHELL_CONFIG = {
  base: 'https://ducks-vercel-api.vercel.app/',
  page: 'index.html',
  fallback: true,
  mode: 'remote',
  timeoutMs: 5000
};
