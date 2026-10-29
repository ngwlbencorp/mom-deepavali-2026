(function () {
  'use strict';
  var I = window.ScamI18n;
  var T = I.text(I.current());
  var KEY = 'scamquiz.v1';
  var app = document.getElementById('app'), nav = document.getElementById('nav');
  var redraw = null; // re-renders the current screen, e.g. after a language change

  // ---------- event window and souvenirs left ----------
  // After the event ends, the site keeps working as a quiz but shows no QR code and no souvenir
  // messages. The server's answer (from /api/remaining) wins over the phone's clock.
  var CFG = window.SCAM_CONFIG || {};

  // ducks.ai lays its own "back to ducks" and "report" buttons over the top-left of hosted pages.
  // Keep that corner of the header clear when running there.
  if (CFG.hostOverlay === true || /(^|\.)ducks\.ai\.tech\.gov\.sg$/.test(location.hostname)) {
    document.body.classList.add('on-ducks');
  }
  var EVENT_END = Date.parse(CFG.eventEnd || '2026-11-08T21:00:00+08:00');
  var live = { open: null, left: null }; // null = not known yet
  function eventOpen() { return live.open !== null ? live.open : Date.now() < EVENT_END; }
  function souvenirsOn() { return eventOpen() && live.left !== 0; }

  // ---------- storage (falls back to memory in private mode) ----------
  var memory = null;
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch (e) {}
    return memory || {};
  }
  function save(s) {
    memory = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  function randomBytes(n) {
    var bytes = new Uint8Array(n);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  }
  function newId() {
    var alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', bytes = randomBytes(8), out = '';
    for (var j = 0; j < 8; j++) out += alphabet[bytes[j] % 32];
    return out;
  }
  // Proves to the server that later submissions come from the phone that registered the ID.
  function newKey() {
    return Array.prototype.map.call(randomBytes(16), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  var state = load();
  if (!state.id) { state = { id: newId(), attempts: 0 }; save(state); }
  if (!state.key) { state.key = newKey(); save(state); }

  // ---------- tiny DOM helpers ----------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  // Animation timings go through the style property (CSSOM), which a strict host CSP allows.
  function vars(node, map) { for (var k in map) node.style.setProperty(k, map[k]); return node; }
  var f = I.fmt;

  // Renders one screen: body nodes, plus footer buttons [{label, run, primary, disabled}].
  function show(nodes, buttons, again, watchLive, mode) {
    redraw = again || null;
    watch(!!watchLive);
    app.className = 'screen' + (mode ? ' ' + mode : '');
    app.innerHTML = '';
    app.scrollTop = 0;
    nodes.forEach(function (n) { if (n) app.appendChild(n); });
    nav.innerHTML = '';
    var refs = (buttons || []).map(function (b) {
      if (!b) return null;
      var btn = el('button', { class: 'btn' + (b.primary ? '' : ' secondary'), type: 'button', onclick: b.run }, [b.label]);
      if (b.disabled) btn.disabled = true;
      nav.appendChild(btn);
      return btn;
    });
    nav.hidden = !refs.some(Boolean);
    fit();
    return refs;
  }

  // If a screen does not fit (long translation, small phone, large system font), step the text
  // down, at most twice. Past that, only the middle area scrolls.
  function overflowing() {
    if (app.scrollHeight > app.clientHeight + 1) return true;
    return [].some.call(app.querySelectorAll('.phone-body'), function (b) { return b.scrollHeight > b.clientHeight + 1; });
  }
  function fit() {
    app.classList.remove('tight', 'tighter');
    if (!overflowing()) return;
    app.classList.add('tight');
    if (!overflowing()) return;
    app.classList.add('tighter');
  }
  var fitTimer;
  window.addEventListener('resize', function () { clearTimeout(fitTimer); fitTimer = setTimeout(fit, 150); });
  // Polls the souvenir count every 20 s, only while home or the result screen is visible.
  var pollTimer = null;
  function watch(on) {
    if (!on) { clearInterval(pollTimer); pollTimer = null; return; }
    if (pollTimer) return;
    pollLive();
    pollTimer = setInterval(pollLive, 20000);
  }
  function pollLive() {
    if (document.visibilityState === 'hidden' || !window.ScamApi) return;
    window.ScamApi.call('GET', '/api/remaining').then(function (r) {
      if (!r.ok) return;
      var before = souvenirsOn() + '|' + eventOpen();
      live.open = !!r.body.open;
      live.left = r.body.capRemaining;
      if (souvenirsOn() + '|' + eventOpen() !== before && redraw) redraw(); else updatePill();
    }, function () {});
  }
  function leftText() { return live.left === null ? '' : live.left > 0 ? f(T.ui.left, { n: live.left }) : T.ui.soldOut; }
  function pill() {
    var p = el('p', { class: 'leftpill', id: 'leftPill', text: leftText() });
    if (live.left === null) p.hidden = true;
    return p;
  }
  function updatePill() {
    var p = document.getElementById('leftPill');
    if (!p) return;
    var wasHidden = p.hidden;
    p.textContent = leftText();
    p.hidden = live.left === null;
    if (wasHidden !== p.hidden) fit(); // the pill appearing can push a small screen over the edge
  }
  document.addEventListener('visibilitychange', function () { if (pollTimer && document.visibilityState === 'visible') pollLive(); });

  function progress(i, n) {
    return el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(n), 'aria-valuenow': String(i) }, [
      vars(el('i'), { '--p': Math.round(i / n * 100) + '%' })
    ]);
  }
  // Top row on every inner screen: a clearly labelled way out, then the progress bar.
  function topbar(label, onExit, i, n) {
    return el('div', { class: 'topbar' }, [
      el('button', { class: 'exitbtn', type: 'button', onclick: onExit }, [label]),
      n ? progress(i, n) : null
    ]);
  }
  function helpline() {
    return el('a', { class: 'helpline', href: 'tel:' + T.event.helpline }, [T.ui.unsure + ' ', el('b', { text: T.event.helpline })]);
  }
  // Phone-style message mock-up, always labelled EXAMPLE. app (from content.js) sets the look:
  // "sms" (a phone's Messages app), "call", "ad" (social media advert); anything else is a chat app.
  // Generic look only: no app names or logos.
  var AVATAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4.2"/><path d="M3.8 21.5c.6-4.4 4-6.9 8.2-6.9s7.6 2.5 8.2 6.9z"/></svg>';
  function phone(from, channel, body, app) {
    var avatar = el('span', { class: 'avatar' });
    avatar.innerHTML = AVATAR;
    return el('div', { class: 'phone ' + ({ sms: 'sms', call: 'call', ad: 'ad' }[app] || 'chat') }, [
      el('div', { class: 'phone-head' }, [
        el('span', { class: 'back', 'aria-hidden': 'true', text: '‹' }),
        avatar,
        el('span', { class: 'who' }, [typeof from === 'string' ? el('strong', { text: from }) : el('strong', {}, [from]), channel ? el('small', { text: channel }) : null]),
        el('span', { class: 'phone-tag', text: T.ui.example })
      ]),
      el('div', { class: 'phone-body' }, body)
    ]);
  }

  // ---------- language ----------
  var langBtn = document.getElementById('langBtn'), sheet = document.getElementById('sheet');
  function setupLang() {
    langBtn.hidden = I.langs().length < 2;
    langBtn.textContent = I.current().toUpperCase();
    langBtn.setAttribute('aria-label', T.ui.language);
  }
  langBtn.addEventListener('click', function () {
    sheet.innerHTML = '';
    sheet.appendChild(el('p', { class: 'sheet-title', text: T.ui.language }));
    I.langs().forEach(function (l) {
      sheet.appendChild(el('button', { class: 'btn' + (l.code === I.current() ? '' : ' secondary'), type: 'button', lang: l.code, onclick: function () {
        I.set(l.code);
        T = I.text(l.code);
        sheet.hidden = true;
        setupLang();
        if (redraw) redraw();
      } }, [l.name]));
    });
    sheet.hidden = false;
  });
  document.getElementById('homeBtn').addEventListener('click', function () { sheet.hidden = true; leave(home); });
  document.documentElement.lang = I.current();
  setupLang();

  // ---------- home ----------
  function home() {
    var open = eventOpen();
    show([
      el('p', { class: 'eyebrow', text: T.event.greeting }),
      el('h1', { text: T.event.title }),
      el('p', { class: 'lead', text: T.event.intro }),
      el('button', { class: 'tile', type: 'button', onclick: function () { story(0, 0); } }, [
        el('span', { class: 'tile-ico', 'aria-hidden': 'true', text: '📖' }),
        el('span', { class: 'tile-txt' }, [el('b', { text: T.ui.learnTitle }), el('small', { text: T.ui.learnSub })])
      ]),
      el('button', { class: 'tile alt', type: 'button', onclick: startQuiz }, [
        el('span', { class: 'tile-ico', 'aria-hidden': 'true', text: '🏆' }),
        el('span', { class: 'tile-txt' }, [el('b', { text: open ? T.ui.quizTitle : T.ui.quizTitleAfter }), el('small', { text: T.ui.quizSub })])
      ]),
      state.last ? el('button', { class: 'linkbtn', type: 'button', onclick: result }, [souvenirsOn() && (state.last.score === state.last.total || state.firstFull) ? T.ui.showQr : T.ui.showResult]) : null,
      open ? el('p', { class: 'note', text: T.event.souvenirNote }) : null,
      open ? pill() : null,
      helpline()
    ], [], home, true);
  }

  // An official video on YouTube, in the reader's language where a subtitled version exists.
  function watchLink(v) {
    var id = (v.lang && v.lang[I.current()]) || v.id;
    return el('a', { class: 'watch', href: 'https://www.youtube.com/watch?v=' + id, target: '_blank', rel: 'noopener' },
      [el('span', { class: 'play', text: '▶' }), el('span', { class: 'watchtext' }, [el('b', { text: T.ui.watch }), el('small', { text: v.by + ' · YouTube' })])]);
  }

  // ---------- learn: 2 frames per story (animated example, then what to do), then the ACT screen ----------
  function story(si, frame) {
    var s = T.learn[si], total = T.learn.length * 2 + 1, pos = si * 2 + frame;
    var first = si === 0 && frame === 0;
    var prev = function () { if (frame) story(si, 0); else story(si - 1, 1); };
    var next = function () { if (!frame) story(si, 1); else if (si < T.learn.length - 1) story(si + 1, 0); else act(); };
    var body;
    if (frame === 0) {
      var STEP = 0.8, flagged = {}, extra = s.chat.attachment ? 1 : 0;
      s.flags.forEach(function (fl, k) { flagged[fl.line] = { label: fl.label, at: (s.chat.lines.length + extra + k) * STEP + 0.3 }; });
      var bubbles = [];
      s.chat.lines.forEach(function (line, i) {
        var fl = flagged[i];
        bubbles.push(vars(el('p', { class: 'bubble' + (fl ? ' flag' : '') }, [line, fl ? el('span', { class: 'flaglabel', text: '🚩 ' + fl.label }) : null]),
          { '--d': i * STEP + 's', '--fd': fl ? fl.at + 's' : '0s' }));
      });
      if (extra) bubbles.push(vars(el('p', { class: 'bubble file', text: '📄 ' + s.chat.attachment }), { '--d': s.chat.lines.length * STEP + 's' }));
      body = [el('h2', { text: s.title }), el('p', { class: 'sub', text: s.tagline }), phone(s.chat.from, s.chat.channel, bubbles, s.chat.app)];
    } else {
      body = [
        el('h2', { text: s.title }),
        el('p', { class: 'eyebrow', text: T.ui.whatToDo }),
        el('ul', { class: 'todo' }, s.todo.map(function (t) { return el('li', { text: t }); })),
        s.video ? watchLink(s.video) : null,
        helpline()
      ];
    }
    show([topbar('⌂ ' + T.ui.home, home, pos + 1, total)].concat(body),
      [first ? null : { label: T.ui.previous, run: prev }, { label: T.ui.next, run: next, primary: true }],
      function () { story(si, frame); });
  }
  function act() {
    var total = T.learn.length * 2 + 1;
    show([
      topbar('⌂ ' + T.ui.home, home, total, total),
      el('h2', { text: T.act.title }),
      el('ul', { class: 'todo act' }, T.act.items.map(function (t) {
        var m = t.match(/^(ADD|CHECK|TELL)\s*(?:[–-]\s*)?(.*)$/);
        return el('li', {}, m ? [el('b', { text: m[1] }), ' ' + m[2]] : [t]);
      })),
      helpline()
    ], [{ label: T.ui.previous, run: function () { story(T.learn.length - 1, 1); } }, { label: T.ui.toQuiz, run: startQuiz, primary: true }], act);
  }

  // ---------- quiz: answers are revealed only at the end ----------
  var run = null;
  function startQuiz() { run = { i: 0, answers: [] }; item(); }
  // Leaving mid-quiz loses the answers, so ask first if any were given.
  function leave(then) {
    if (run && run.answers.some(function (a) { return a !== undefined && a !== null; }) && !window.confirm(T.ui.exitConfirm)) return;
    run = null;
    then();
  }

  function item() {
    var q = T.quiz[run.i], n = T.quiz.length, i = run.i, nextBtn = null;
    function setAnswer(a, ready) { run.answers[i] = a; if (nextBtn) nextBtn.disabled = !ready; }
    function go(d) {
      run.i += d;
      if (run.i >= n) return finish();
      item();
    }
    var body = renderItem(q, run.answers[i], setAnswer, false);
    var refs = show([topbar('✕ ' + T.ui.exitQuiz, function () { leave(home); }, i + 1, n), el('p', { class: 'eyebrow', text: f(T.ui.step, { i: i + 1, n: n }) + (q.type === 'spot' || q.type === 'pick' ? '' : ' · ' + q.title) })].concat(body),
      [i ? { label: T.ui.previous, run: function () { go(-1); } } : null, { label: i < n - 1 ? T.ui.next : T.ui.finish, run: function () { go(1); }, primary: true, disabled: !answered(q, run.answers[i]) }],
      item);
    nextBtn = refs[1];
  }

  function answered(q, a) {
    if (a === undefined || a === null) return false;
    if (q.type === 'spot') return a.length === flagKeys(q).length;
    if (q.type === 'sort') return a.length === q.cards.length && a.every(function (x) { return typeof x === 'boolean'; });
    return true;
  }
  // Red-flag keys: "from" for the sender line (when msg.fromFlag), else "<bubble>-<segment>".
  function flagKeys(q) {
    var keys = q.msg.fromFlag ? ['from'] : [];
    q.msg.bubbles.forEach(function (b, bi) { b.forEach(function (seg, si) { if (seg.flag) keys.push(bi + '-' + si); }); });
    return keys;
  }
  // Each format renders in answer mode, or read-only review mode (review = true) with marks.
  function renderItem(q, ans, setAnswer, review) {
    return ({ spot: spotItem, sort: sortItem, reply: replyItem, pick: pickItem })[q.type](q, ans, setAnswer, review);
  }

  // Tap exactly n parts of the message. Changing your mind is allowed; the count stops at n.
  function spotItem(q, ans, setAnswer, review) {
    var flags = flagKeys(q), n = flags.length, picked = (ans || []).slice();
    var counter = el('p', { class: 'counter', text: f(T.ui.selected, { k: picked.length, n: n }) });
    // Every part of the message (and the sender, when it can be a red flag) is tappable.
    function seg(key, text) {
      var isFlag = flags.indexOf(key) >= 0, on = picked.indexOf(key) >= 0;
      var cls = 'seg' + (on ? ' on' : '');
      if (review) cls += isFlag ? ' right' : on ? ' wrong' : '';
      var btn = el('button', { class: cls, type: 'button', 'aria-pressed': String(on) }, [text]);
      if (review) { btn.disabled = true; return btn; }
      btn.addEventListener('click', function () {
        var at = picked.indexOf(key);
        if (at >= 0) picked.splice(at, 1);
        else if (picked.length < n) picked.push(key);
        else { btn.classList.remove('nudge'); void btn.offsetWidth; btn.classList.add('nudge'); return; }
        btn.classList.toggle('on', at < 0);
        btn.setAttribute('aria-pressed', String(at < 0));
        counter.textContent = f(T.ui.selected, { k: picked.length, n: n });
        setAnswer(picked.slice(), picked.length === n);
      });
      return btn;
    }
    var from = q.msg.fromFlag ? seg('from', q.msg.from) : q.msg.from;
    var bubbles = q.msg.bubbles.map(function (b, bi) {
      return el('p', { class: 'bubble static' }, b.map(function (part, si) { return seg(bi + '-' + si, part.t); }));
    });
    if (review) return [phone(from, q.msg.channel, bubbles, q.msg.app)];
    return [el('p', { class: 'prompt', text: f(T.ui.spotPrompt, { n: n }) }), phone(from, q.msg.channel, bubbles, q.msg.app), counter];
  }


  // One message card at a time: Scam or Safe. Each card is one point.
  function sortItem(q, ans, setAnswer, review) {
    var a = (ans || []).slice();
    if (review) {
      return [el('ul', { class: 'sortreview' }, q.cards.map(function (c, k) {
        var ok = a[k] === c.scam;
        return el('li', { class: ok ? 'ok' : 'no' }, [
          el('p', { class: 'msg' }, [el('b', { text: c.from + ': ' }), c.text]),
          el('p', { class: 'mark', text: (ok ? '✓ ' : '✕ ') + T.ui.rightAnswer + ': ' + (c.scam ? T.ui.scam : T.ui.safe) }),
          ok ? null : el('p', { class: 'why', text: c.why })
        ]);
      }))];
    }
    var doneCount = function () { return a.filter(function (x) { return typeof x === 'boolean'; }).length; };
    var k = Math.min(doneCount(), q.cards.length - 1);
    var wrap = el('div', { class: 'sortwrap' });
    function draw() {
      var c = q.cards[k];
      wrap.innerHTML = '';
      wrap.appendChild(el('p', { class: 'counter', text: f(T.ui.card, { i: k + 1, n: q.cards.length }) }));
      wrap.appendChild(phone(c.from, null, [el('p', { class: 'bubble static', text: c.text })]));
      var row = el('div', { class: 'sortbtns' });
      [[true, 'scam', T.ui.scam], [false, 'safe', T.ui.safe]].forEach(function (o) {
        row.appendChild(el('button', { class: 'sortbtn ' + o[1] + (a[k] === o[0] ? ' on' : ''), type: 'button', 'aria-pressed': String(a[k] === o[0]), onclick: function () {
          a[k] = o[0];
          setAnswer(a.slice(), doneCount() === q.cards.length);
          if (k < q.cards.length - 1 && typeof a[k + 1] !== 'boolean') k++;
          draw();
        } }, [o[2]]));
      });
      wrap.appendChild(row);
      wrap.appendChild(el('div', { class: 'dots' }, q.cards.map(function (_, j) {
        var reachable = j <= doneCount();
        var d = el('button', { class: 'dot' + (j === k ? ' cur' : '') + (typeof a[j] === 'boolean' ? ' done' : ''), type: 'button',
          'aria-label': f(T.ui.card, { i: j + 1, n: q.cards.length }), onclick: function () { if (reachable) { k = j; draw(); } } });
        if (!reachable) d.disabled = true;
        return d;
      })));
    }
    draw();
    return [wrap];
  }

  // A short chat plays out; pick the reply to send.
  function replyItem(q, ans, setAnswer, review) {
    var lines = q.chat.lines.map(function (l, i) { return vars(el('p', { class: 'bubble', text: l }), { '--d': i * 0.7 + 's' }); });
    var opts = el('div', { class: 'replies', role: 'radiogroup' });
    q.options.forEach(function (o, i) {
      var cls = 'reply' + (ans === i ? ' on' : '');
      if (review) cls += i === q.answer ? ' right' : ans === i ? ' wrong' : '';
      var b = el('button', { class: cls, type: 'button', role: 'radio', 'aria-checked': String(ans === i) }, [o]);
      if (review) b.disabled = true;
      else b.addEventListener('click', function () {
        [].forEach.call(opts.children, function (c) { c.classList.remove('on'); c.setAttribute('aria-checked', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-checked', 'true');
        setAnswer(i, true);
      });
      opts.appendChild(b);
    });
    if (review) return [el('p', { class: 'quote' }, [el('b', { text: q.chat.from + ': ' }), q.chat.lines[q.chat.lines.length - 1]]), opts];
    return [phone(q.chat.from, null, lines), opts];
  }

  var ICONS = {
    store: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 16h28l-2 24H12z" fill="#2a78d6"/><path d="M18 16v-3a6 6 0 0 1 12 0v3" fill="none" stroke="#2a78d6" stroke-width="3"/><path d="M19 30l4 4 7-8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chat: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 10h32v22H20l-8 7v-7H8z" fill="#8a8781"/><path d="M17 21h14M17 26h9" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
    ad: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="10" width="36" height="26" rx="3" fill="#eb6834"/><text x="24" y="28" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">SALE</text></svg>'
  };
  // Tap the picture that shows the safe way.
  function pickItem(q, ans, setAnswer, review) {
    var grid = el('div', { class: 'picks', role: 'radiogroup' });
    q.options.forEach(function (o, i) {
      var cls = 'pick' + (ans === i ? ' on' : '');
      if (review) cls += i === q.answer ? ' right' : ans === i ? ' wrong' : '';
      var ico = el('span', { class: 'pick-ico' });
      ico.innerHTML = ICONS[o.icon] || '';
      var b = el('button', { class: cls, type: 'button', role: 'radio', 'aria-checked': String(ans === i) }, [ico, el('span', { text: o.label })]);
      if (review) b.disabled = true;
      else b.addEventListener('click', function () {
        [].forEach.call(grid.children, function (c) { c.classList.remove('on'); c.setAttribute('aria-checked', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-checked', 'true');
        setAnswer(i, true);
      });
      grid.appendChild(b);
    });
    return [el('p', { class: 'prompt', text: q.prompt }), grid];
  }

  // ---------- scoring ----------
  function itemPoints(q, a) {
    if (q.type === 'sort') return q.cards.reduce(function (s, c, k) { return s + (a && a[k] === c.scam ? 1 : 0); }, 0);
    if (q.type === 'spot') {
      var fk = flagKeys(q);
      return a && a.length === fk.length && fk.every(function (k) { return a.indexOf(k) >= 0; }) ? 1 : 0;
    }
    return a === q.answer ? 1 : 0;
  }
  function itemMax(q) { return q.type === 'sort' ? q.cards.length : 1; }

  function finish() {
    var score = 0, total = 0;
    T.quiz.forEach(function (q, i) { score += itemPoints(q, run.answers[i]); total += itemMax(q); });
    state.attempts = (state.attempts || 0) + 1;
    state.last = { score: score, total: total, answers: run.answers };
    if (score === total && !state.firstFull) state.firstFull = state.attempts;
    save(state);
    run = null;
    if (!state.feedbackDone) feedbackScreen(); else submitResult();
  }

  // Registers this attempt with the server. The first phone to register an ID owns it; if another
  // phone already owns this ID (409), pick a new ID and key and try again.
  function submitResult() {
    show([el('p', { class: 'center muted', text: T.ui.saving })], []);
    var tries = 0;
    function attempt() {
      return window.ScamApi.call('POST', '/api/submit', {
        id: state.id, key: state.key, score: state.last.score, total: state.last.total,
        csat: state.csat || null, learned: state.learned || null
      }).then(function (res) {
        if (res.status === 409 && tries++ < 5) {
          state.id = newId();
          state.key = newKey();
          state.attempts = 1;
          state.firstFull = state.last.score === state.last.total ? 1 : null;
          save(state);
          return attempt();
        }
        if (!res.ok) throw { server: res.status };
        state.attempts = res.body.attempts;
        state.firstFull = res.body.firstFull;
        state.pending = false;
        state.redeemed = res.body.redeemed;
        save(state);
      });
    }
    attempt().catch(function () { state.pending = true; save(state); }).then(result);
  }

  function feedbackScreen() {
    var F = T.feedback, csat = null, learned = null, go;
    function choice(group, items, onPick) {
      var wrap = el('div', { class: 'choices ' + group, role: 'radiogroup' });
      items.forEach(function (it) {
        var b = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: function () {
          [].forEach.call(wrap.children, function (c) { c.setAttribute('aria-pressed', 'false'); });
          b.setAttribute('aria-pressed', 'true');
          onPick(it.value);
        } }, it.kids);
        wrap.appendChild(b);
      });
      return wrap;
    }
    function ready() { if (csat && learned) go.disabled = false; }
    var faces = ['😞', '🙁', '😐', '🙂', '😄'];
    go = show([
      el('h2', { text: F.title }),
      el('h3', { text: F.csatQuestion }),
      choice('faces', F.csatLabels.map(function (l, i) {
        return { value: i + 1, kids: [el('span', { class: 'face', 'aria-hidden': 'true', text: faces[i] }), el('span', { class: 'lbl', text: l })] };
      }), function (v) { csat = v; ready(); }),
      el('h3', { text: F.learnedQuestion }),
      choice('words', F.learnedOptions.map(function (o) { return { value: o.code, kids: [o.label] }; }), function (v) { learned = v; ready(); })
    ], [{ label: F.submit, primary: true, disabled: true, run: function () {
      state.csat = csat;
      state.learned = learned;
      state.feedbackDone = true;
      save(state);
      submitResult();
    } }])[0];
  }

  // ---------- result + review ----------
  function result() {
    var last = state.last, full = last.score === last.total;
    // A QR code only for a full score: on this attempt, or an earlier one (the server keeps the
    // best score, so a later lower score does not take the souvenir away).
    var earned = full || !!state.firstFull;
    var withQr = earned && souvenirsOn();
    var buttons = [];
    if (last.answers) buttons.push({ label: T.ui.review, run: function () { review(0); } });
    buttons.push({ label: T.ui.tryAgain, run: startQuiz, primary: !full });
    var pending = state.pending
      ? el('p', { class: 'notice' }, [(withQr ? T.ui.notSaved : T.ui.notSavedAfter) + ' ', el('button', { class: 'linkbtn inline', type: 'button', onclick: submitResult }, [T.ui.retry])])
      : null;
    var score = el('p', { class: 'score', text: full ? T.ui.allCorrect : f(T.ui.partial, { s: last.score, t: last.total }) });
    if (!withQr) {
      // Not all correct yet, after the event, or once all souvenirs are gone: no QR code.
      var msgs = souvenirsOn() ? [T.ui.partialMsg]
        : eventOpen() ? [T.ui.soldOut, full ? null : T.ui.afterPartial]
        : [full ? T.ui.afterFull : T.ui.afterPartial];
      show([
        topbar('⌂ ' + T.ui.home, home),
        el('div', { class: 'result ' + (full ? 'full' : 'partial') }, [score]
          .concat(msgs.map(function (m) { return m ? el('p', { class: 'msg', text: m }) : null; }))
          .concat([pending, souvenirsOn() ? pill() : null]))
      ], buttons, result, eventOpen());
      return;
    }
    var text = window.ScamPayload.encode({
      id: state.id, score: last.total, total: last.total, attempts: state.attempts,
      firstFull: state.firstFull || state.attempts, csat: state.csat, learned: state.learned
    });
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var qrBox = el('div', { class: 'qr', role: 'img', 'aria-label': 'QR code' });
    qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
    show([
      topbar('⌂ ' + T.ui.home, home),
      el('div', { class: 'result ' + (full ? 'full' : 'partial') }, [
        score,
        el('p', { class: 'msg', text: full ? T.ui.allCorrectMsg : T.ui.earnedBefore }),
        qrBox,
        el('p', { class: 'code' }, [T.ui.codeLabel + ': ', el('strong', { text: state.id }), ' · ' + T.ui.attempt + ' ' + state.attempts]),
        pending || el('p', { class: 'saved', text: T.ui.saved }),
        pill()
      ])
    ], buttons, result, true);
  }

  function review(i) {
    var q = T.quiz[i], n = T.quiz.length, a = state.last.answers[i];
    var pts = itemPoints(q, a), max = itemMax(q), ok = pts === max;
    var verdict = el('p', { class: 'verdict ' + (ok ? 'ok' : 'no'), text: (ok ? '✓ ' + T.ui.correct : '✕ ' + T.ui.wrong) + (max > 1 ? ' (' + pts + '/' + max + ')' : '') });
    show([topbar('✕ ' + T.ui.closeReview, result, i + 1, n), el('div', { class: 'reviewhead' }, [el('p', { class: 'eyebrow', text: f(T.ui.step, { i: i + 1, n: n }) }), verdict])]
      .concat(renderItem(q, a, null, true))
      .concat([q.explain ? el('p', { class: 'explain', text: q.explain }) : null]),
      [i ? { label: T.ui.previous, run: function () { review(i - 1); } } : null,
       i < n - 1 ? { label: T.ui.next, run: function () { review(i + 1); }, primary: true } : { label: T.ui.backToResult, run: result, primary: true }],
      function () { review(i); }, false, 'reviewing');
  }

  home();
})();
