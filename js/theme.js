// Officer page: the light/dark button in the header. The page follows the phone's setting until an
// officer taps the button; the choice is then kept on that phone (css/officer.css, data-theme).
(function () {
  'use strict';
  var KEY = 'scamsite.officerTheme', root = document.documentElement;
  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var chosen = null;
  try { chosen = localStorage.getItem(KEY); } catch (e) {}
  if (chosen === 'light' || chosen === 'dark') root.setAttribute('data-theme', chosen);

  function current() { return root.getAttribute('data-theme') || (dark && dark.matches ? 'dark' : 'light'); }
  function label(btn) {
    var isDark = current() === 'dark';
    btn.textContent = isDark ? '☀' : '☾';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
  }
  var btn = document.getElementById('themeBtn');
  if (!btn) return;
  label(btn);
  btn.addEventListener('click', function () {
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
    label(btn);
  });
  // The phone switching between light and dark (e.g. at sunset) updates the button while no choice is kept.
  if (dark && dark.addEventListener) dark.addEventListener('change', function () { label(btn); });
})();
