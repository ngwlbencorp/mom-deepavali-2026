// Event themes for the mini-site: 'deepavali' (the original look, the default), 'neutral' and
// 'christmas'. EventThemes.apply(name, doc) sets data-event-theme on <html> (css/event-themes.css
// holds the colours) and swaps the Deepavali lamp icon for the theme's own. Any other name means
// 'deepavali': the attribute is removed and the original icon and theme colour are put back, so the
// page is exactly as it was. Safe to call more than once, and before or after the page renders.
// Icons are built with DOM methods and styled by class only: no innerHTML, no style attributes, so
// it works under a strict content policy.
(function (g) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var THEMES = {
    neutral: { color: '#1b3a5c', motif: shield },
    christmas: { color: '#14532d', motif: tree }
  };
  // Deepavali motifs that a theme replaces: the lamp in the header's Home button, and any .diya icon.
  var MOTIFS = '.iconbtn > svg, svg.diya';

  function svgEl(doc, tag, attrs) {
    var n = doc.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function frame(doc, theme, isDiya) {
    return svgEl(doc, 'svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false',
      class: (isDiya ? 'diya ' : '') + 'evt-motif', 'data-motif': theme });
  }
  // neutral: a shield with a tick (protection, no festival)
  function shield(doc, isDiya) {
    var s = frame(doc, 'neutral', isDiya);
    var outline = 'M32 4 L54 12 V30 C54 44 44 54 32 60 C20 54 10 44 10 30 V12 Z';
    s.appendChild(svgEl(doc, 'path', { class: 'evt-shield', d: outline }));
    s.appendChild(svgEl(doc, 'path', { class: 'evt-shield-edge', d: 'M32 10 L48 16 V30 C48 40 41 48 32 53 C23 48 16 40 16 30 V16 Z' }));
    s.appendChild(svgEl(doc, 'path', { class: 'evt-tick', d: 'M22 32 L29 39 L43 24' }));
    return s;
  }
  // christmas: a fir tree with a star and baubles (no figures, no characters)
  function tree(doc, isDiya) {
    var s = frame(doc, 'christmas', isDiya);
    s.appendChild(svgEl(doc, 'rect', { class: 'evt-trunk', x: '28', y: '52', width: '8', height: '8', rx: '1' }));
    s.appendChild(svgEl(doc, 'path', { class: 'evt-tree', d: 'M32 14 L44 28 H38 L49 40 H42 L53 53 H11 L22 40 H15 L26 28 H20 Z' }));
    s.appendChild(svgEl(doc, 'circle', { class: 'evt-bauble-a', cx: '27', cy: '33', r: '2.6' }));
    s.appendChild(svgEl(doc, 'circle', { class: 'evt-bauble-b', cx: '38', cy: '45', r: '2.6' }));
    s.appendChild(svgEl(doc, 'circle', { class: 'evt-bauble-a', cx: '24', cy: '48', r: '2.4' }));
    s.appendChild(svgEl(doc, 'path', { class: 'evt-star', d: 'M32 2 L33.8 7.1 L39.1 7.2 L34.9 10.4 L36.4 15.6 L32 12.5 L27.6 15.6 L29.1 10.4 L24.9 7.2 L30.2 7.1 Z' }));
    return s;
  }

  function current(doc) {
    var v = (doc || g.document).documentElement.getAttribute('data-event-theme');
    return THEMES.hasOwnProperty(v) ? v : 'deepavali';
  }

  // Puts the right icon in every motif slot for the theme now set on <html>. The original node is
  // kept on the replacement (not copied), so going back restores the very same element.
  function swapAll(doc) {
    var name = current(doc), list = doc.querySelectorAll(MOTIFS);
    for (var i = 0; i < list.length; i++) {
      var svg = list[i], isOurs = svg.classList.contains('evt-motif');
      var orig = isOurs ? svg.evtOriginal : svg;
      if (!svg.parentNode) continue;
      if (name === 'deepavali') {
        if (isOurs && orig) svg.parentNode.replaceChild(orig, svg);
      } else if (!isOurs || svg.getAttribute('data-motif') !== name) {
        var next = THEMES[name].motif(doc, !!(orig && orig.classList.contains('diya')));
        next.evtOriginal = orig;
        svg.parentNode.replaceChild(next, svg);
      }
    }
    return list.length;
  }

  // The browser bar colour (meta theme-color) follows the theme; the original value is kept.
  function themeColor(doc, name) {
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (meta.evtOriginal === undefined) meta.evtOriginal = meta.getAttribute('content');
    meta.setAttribute('content', name === 'deepavali' ? meta.evtOriginal : THEMES[name].color);
  }

  // Called before the page has rendered (for example through the ducks.ai shell, which inserts the
  // page body later): wait for the icon to appear, then swap it. Gives up after 15 seconds.
  function stopWaiting(doc) {
    if (doc.evtWait) { doc.evtWait.obs.disconnect(); clearTimeout(doc.evtWait.timer); doc.evtWait = null; }
  }
  function waitForMotifs(doc) {
    if (doc.evtWait || !g.MutationObserver) return;
    var obs = new g.MutationObserver(function () {
      if (!doc.querySelector(MOTIFS)) return;
      stopWaiting(doc);
      swapAll(doc);
    });
    obs.observe(doc.documentElement, { childList: true, subtree: true });
    doc.evtWait = { obs: obs, timer: setTimeout(function () { stopWaiting(doc); }, 15000) };
  }

  function apply(name, doc) {
    doc = doc || g.document;
    if (!doc || !doc.documentElement) return 'deepavali';
    name = typeof name === 'string' ? name.toLowerCase() : '';
    if (!THEMES.hasOwnProperty(name)) name = 'deepavali';
    var root = doc.documentElement;
    if (name === 'deepavali') root.removeAttribute('data-event-theme');
    else root.dataset.eventTheme = name;
    themeColor(doc, name);
    stopWaiting(doc);
    if (!swapAll(doc) && name !== 'deepavali') waitForMotifs(doc);
    return name;
  }

  g.EventThemes = { apply: apply, current: current, names: ['deepavali', 'neutral', 'christmas'] };
})(window);
