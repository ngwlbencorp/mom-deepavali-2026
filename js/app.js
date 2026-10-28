(function () {
  'use strict';
  var C = window.SCAM_CONTENT;
  var KEY = 'scamquiz.v1';
  var app = document.getElementById('app');

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

  // ---------- tiny DOM helper ----------
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
  function show(nodes) {
    app.innerHTML = '';
    nodes.forEach(function (n) { if (n) app.appendChild(n); });
    window.scrollTo(0, 0);
  }
  function linkTo(i) {
    var l = C.links[i];
    return el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', class: 'ext' }, [l.label + ' ↗']);
  }
  function helpline() {
    return el('p', { class: 'helpline' }, ['Unsure? Call the ' + C.event.helplineName + ' ',
      el('a', { href: 'tel:' + C.event.helpline }, [C.event.helpline])]);
  }

  // ---------- screens ----------
  function home() {
    show([
      el('section', { class: 'card hero' }, [
        el('p', { class: 'eyebrow', text: C.event.greeting }),
        el('h1', { text: C.event.title }),
        el('p', { text: C.event.intro }),
        el('p', { class: 'muted', text: C.event.meta }),
        el('button', { class: 'btn', onclick: startQuiz }, [state.attempts ? 'Try the quiz again' : 'Start quiz']),
        state.last ? el('button', { class: 'btn secondary', onclick: result }, ['Show my QR code']) : null
      ]),
      el('section', { class: 'card' }, [el('p', { text: C.event.souvenirNote }), el('p', { class: 'muted', text: C.event.staffNote })]),
      helpline()
    ]);
  }

  var run;
  function startQuiz() { run = { i: 0, correct: 0 }; question(); }

  function exampleCard(ex) {
    return el('div', { class: 'phone', 'aria-label': 'Example scam message' }, [
      el('div', { class: 'phone-tag', text: 'EXAMPLE · NOT REAL' }),
      el('div', { class: 'phone-head' }, [el('strong', { text: ex.from }), el('span', { text: ex.channel })]),
      el('div', { class: 'phone-body' }, ex.lines.map(function (l) { return el('p', { class: 'bubble', text: l }); })
        .concat(ex.attachment ? [el('p', { class: 'bubble file', text: '📄 ' + ex.attachment })] : []))
    ]);
  }

  // Width set through the style property, not a style attribute, so a host
  // Content-Security-Policy that blocks inline styles cannot break it.
  function barFill(pct) {
    var i = el('i');
    i.style.width = pct + '%';
    return i;
  }

  function question() {
    var q = C.questions[run.i], total = C.questions.length, picked = [], done = false;
    var opts = el('div', { class: 'options', role: q.type === 'multi' ? 'group' : 'radiogroup' });
    var feedback = el('div', { class: 'explain', hidden: '' });
    var checkBtn = q.type === 'multi' ? el('button', { class: 'btn', disabled: '', onclick: function () { reveal(); } }, ['Check answer']) : null;
    var nextBtn = el('button', { class: 'btn', hidden: '', onclick: next }, [run.i + 1 < total ? 'Next question' : 'See my result']);

    var buttons = q.options.map(function (label, idx) {
      var b = el('button', { class: 'opt', type: 'button', 'aria-pressed': 'false', onclick: function () {
        if (done) return;
        if (q.type === 'multi') {
          var at = picked.indexOf(idx);
          if (at >= 0) picked.splice(at, 1); else picked.push(idx);
          b.setAttribute('aria-pressed', at >= 0 ? 'false' : 'true');
          if (picked.length) checkBtn.removeAttribute('disabled'); else checkBtn.setAttribute('disabled', '');
        } else { picked = [idx]; b.setAttribute('aria-pressed', 'true'); reveal(); }
      } }, [q.type === 'multi' ? el('span', { class: 'box', 'aria-hidden': 'true' }) : null, label]);
      opts.appendChild(b);
      return b;
    });

    function reveal() {
      done = true;
      var answer = [].concat(q.answer);
      var right = picked.length === answer.length && answer.every(function (a) { return picked.indexOf(a) >= 0; });
      if (right) run.correct++;
      buttons.forEach(function (b, idx) {
        b.disabled = true;
        if (answer.indexOf(idx) >= 0) b.classList.add('right');
        else if (picked.indexOf(idx) >= 0) b.classList.add('wrong');
      });
      feedback.className = 'explain ' + (right ? 'ok' : 'no');
      feedback.appendChild(el('strong', { text: right ? 'Correct!' : 'Not quite.' }));
      feedback.appendChild(el('p', { text: q.explain }));
      if (q.link !== undefined) feedback.appendChild(linkTo(q.link));
      feedback.removeAttribute('hidden');
      if (checkBtn) checkBtn.hidden = true;
      nextBtn.removeAttribute('hidden');
      feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function next() {
      run.i++;
      if (run.i < total) return question();
      finish();
    }

    show([
      el('div', { class: 'progress', 'aria-label': 'Question ' + (run.i + 1) + ' of ' + total }, [
        el('span', { text: 'Question ' + (run.i + 1) + ' of ' + total }),
        el('div', { class: 'bar' }, [barFill(Math.round(run.i / total * 100))])
      ]),
      el('section', { class: 'card' }, [
        el('p', { class: 'eyebrow', text: q.topic }),
        q.example ? exampleCard(q.example) : null,
        el('h2', { text: q.question }),
        opts, checkBtn, feedback, nextBtn
      ])
    ]);
  }

  function finish() {
    var total = C.questions.length;
    state.attempts = (state.attempts || 0) + 1;
    state.last = { score: run.correct, total: total };
    if (run.correct === total && !state.firstFull) state.firstFull = state.attempts;
    save(state);
    if (!state.feedbackDone) feedbackScreen(); else submitResult();
  }

  // Registers this attempt with the server. The first phone to register an ID owns it; if another
  // phone already owns this ID (409), pick a new ID and key and try again.
  function submitResult() {
    show([el('section', { class: 'card center' }, [el('p', { class: 'muted', text: 'Saving your result…' })])]);
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
    var F = C.feedback, csat = null, learned = null;
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
    var faces = ['😞', '🙁', '😐', '🙂', '😄'];
    function submit(skip) {
      if (!skip) { state.csat = csat; state.learned = learned; }
      state.feedbackDone = true;
      save(state);
      submitResult();
    }
    show([
      el('section', { class: 'card' }, [
        el('h2', { text: F.title }),
        el('p', { class: 'muted', text: F.intro }),
        el('h3', { text: F.csatQuestion }),
        choice('faces', F.csatLabels.map(function (l, i) {
          return { value: i + 1, kids: [el('span', { class: 'face', 'aria-hidden': 'true', text: faces[i] }), el('span', { class: 'lbl', text: l })] };
        }), function (v) { csat = v; }),
        el('h3', { text: F.learnedQuestion }),
        choice('words', F.learnedOptions.map(function (o) { return { value: o.code, kids: [o.label] }; }), function (v) { learned = v; }),
        el('button', { class: 'btn', onclick: function () { submit(false); } }, ['Submit and see my QR code']),
        el('button', { class: 'linkbtn', onclick: function () { submit(true); } }, ['Skip'])
      ])
    ]);
  }

  function result() {
    var last = state.last, full = last.score === last.total;
    var text = window.ScamPayload.encode({
      id: state.id, score: last.score, total: last.total, attempts: state.attempts,
      firstFull: state.firstFull, csat: state.csat, learned: state.learned
    });
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var qrBox = el('div', { class: 'qr', role: 'img', 'aria-label': 'Your quiz QR code' });
    qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });

    show([
      el('section', { class: 'card result ' + (full ? 'full' : 'partial') }, [
        el('p', { class: 'score', text: last.score + ' / ' + last.total }),
        el('h2', { text: full ? 'All correct! Well done.' : 'Good try! Get all correct for a souvenir.' }),
        el('p', { text: full
          ? 'Show this QR code to an MOM officer at the side of the hall to collect your souvenir.'
          : 'You can still show this QR code to an MOM officer, then try again to get all answers correct.' }),
        qrBox,
        el('p', { class: 'code' }, ['Code: ', el('strong', { text: state.id }), ' · Attempt ' + state.attempts]),
        state.pending
          ? el('div', { class: 'notice' }, [
              el('p', { text: 'Your result is not saved yet (no connection). An MOM officer can still scan this QR code.' }),
              el('button', { class: 'btn secondary', onclick: submitResult }, ['Retry saving'])
            ])
          : el('p', { class: 'saved', text: 'Result saved ✓' }),
        el('button', { class: full ? 'btn secondary' : 'btn', onclick: startQuiz }, [full ? 'Do the quiz again' : 'Try again'])
      ]),
      el('section', { class: 'card' }, [
        el('h3', { text: 'Remember' }),
        el('ul', { class: 'remember' }, [
          el('li', {}, [el('strong', { text: 'STOP' }), ' suspicious requests. Never share secret codes.']),
          el('li', {}, [el('strong', { text: 'CHECK' }), ' with ' + C.event.helpline + ' if unsure.']),
          el('li', {}, [el('strong', { text: 'USE' }), ' official app stores only.'])
        ]),
        el('p', {}, [linkTo(0)]),
        el('p', {}, [linkTo(1)])
      ]),
      helpline(),
      el('p', { class: 'center' }, [el('button', { class: 'linkbtn', onclick: home }, ['Back to start'])])
    ]);
  }

  if (state.last && location.hash === '#qr') result(); else home();
})();
