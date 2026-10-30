(function () {
  'use strict';
  // ducks.ai adds a "presenter gate" for slide decks to every hosted page: unless the tab is in
  // presenter mode, it cancels every n and t key press, so officers could not type those letters
  // (emails, password, codes, bug reports). Presenter mode would also show ducks.ai's "edit text"
  // button, so instead the page puts those letters back into its own text boxes. An earlier version
  // switched presenter mode on: clear that. See tests/gate.test.js.
  try { sessionStorage.removeItem('ducks-presenter:' + (location.pathname.split('/')[2] || '')); } catch (e) {}
  window.addEventListener('keydown', function (e) {
    var t = e.target, k = e.key || '';
    if (!e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !/^[nt]$/i.test(k)) return; // only what the gate blocked
    if (!t || !(t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|email|password|search|tel|url)$/.test(t.type)))) return;
    if (!(document.execCommand && document.execCommand('insertText', false, k))) {
      try { t.setRangeText(k, t.selectionStart, t.selectionEnd, 'end'); } catch (x) { t.value += k; } // email boxes have no selection
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);
  var Api = window.ScamApi, C = window.SCAM_CONTENT;
  var ROLE = 'admin', POLL_MS = 5000;
  var $ = function (id) { return document.getElementById(id); };
  var time = function (iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; };

  // ---------- views (hash routes: #home, #scan, #manual, #bug, #bugs) ----------
  var views = ['login', 'home', 'scan', 'manual', 'bug', 'bugs'];
  function route() {
    var s = Api.session(ROLE);
    var want = (location.hash || '#home').slice(1);
    if (!s) want = 'login';
    else if (views.indexOf(want) < 0 || want === 'login') want = 'home';
    views.forEach(function (v) { $('v-' + v).hidden = v !== want; });
    $('counter').hidden = !s;
    if (want !== 'scan') stopCamera();
    if (want === 'manual') resetManual();
    if (want === 'bug') resetBug();
    if (want === 'bugs') loadBugs();
    if (want === 'scan') { $('verdict').hidden = true; startCamera(); }
    if (s) { $('who').textContent = s.user; startPolling(); } else stopPolling();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  function loggedOut(msg) {
    Api.setSession(ROLE, null);
    location.hash = '#login';
    route();
    if (msg) { $('loginErr').textContent = msg; $('loginErr').hidden = false; }
  }

  // ---------- login ----------
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('loginErr');
    err.hidden = true;
    Api.call('POST', '/api/login', { role: 'admin', email: $('email').value, password: $('password').value }).then(function (r) {
      if (!r.ok) { err.textContent = r.body.message || 'Login failed'; err.hidden = false; return; }
      Api.setSession(ROLE, { token: r.body.token, user: r.body.user });
      $('password').value = '';
      location.hash = '#home';
      route();
    }, function () { err.textContent = 'Cannot reach the server. Check your connection.'; err.hidden = false; });
  });
  $('logout').addEventListener('click', function () { loggedOut(''); });

  // ---------- live counter ----------
  var pollTimer = null, lastOk = 0;
  function showStats(st) {
    lastOk = Date.now();
    $('left').textContent = st.capRemaining;
    $('cap').textContent = st.cap;
    $('given').textContent = st.given + ' given';
    $('counter').classList.toggle('low', st.capRemaining <= Math.max(10, st.cap * 0.05));
    var live = $('live');
    live.classList.remove('stale');
    live.textContent = 'live ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  function markStale() {
    if (Date.now() - lastOk < interval() * 2.5) return;
    var live = $('live');
    live.classList.add('stale');
    live.textContent = 'offline: do not give souvenirs';
  }
  function poll() {
    if (document.visibilityState === 'hidden') return;
    Api.call('GET', '/api/stats', null, ROLE).then(function (r) {
      if (r.status === 401) return loggedOut(r.body.message);
      if (r.ok) showStats(r.body); else markStale();
    }, markStale);
  }
  // Every 5 s while officers are using the page; once a minute after 10 minutes without a tap or
  // key press (a screen left open all day would otherwise use ~17,000 of Vercel's requests a day).
  // Once a minute still keeps the database awake (Neon sleeps after 5 idle minutes).
  var T = window.ADMIN_POLL_TEST || {}; // tests only: shorter times
  var IDLE_AFTER = T.idleAfter || 10 * 60 * 1000, IDLE_POLL_MS = T.idlePoll || 60000, lastAction = Date.now(), polling = false;
  function interval() { return Date.now() - lastAction > IDLE_AFTER ? IDLE_POLL_MS : POLL_MS; }
  function schedule() { clearTimeout(pollTimer); pollTimer = polling ? setTimeout(function () { poll(); schedule(); }, interval()) : null; }
  function startPolling() { if (!polling) { polling = true; poll(); schedule(); } }
  function stopPolling() { polling = false; schedule(); }
  function activity() {
    var wasIdle = interval() === IDLE_POLL_MS;
    lastAction = Date.now();
    if (wasIdle && polling) { poll(); schedule(); }
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, activity, true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && polling) { lastAction = Date.now(); poll(); schedule(); } });

  // ---------- verdict card ----------
  function verdict(box, cls, big, detail, actions) {
    var v = $(box);
    v.className = 'card verdict ' + cls;
    v.innerHTML = '';
    var p1 = document.createElement('p'); p1.className = 'big'; p1.textContent = big; v.appendChild(p1);
    var p2 = document.createElement('p'); p2.className = 'detail'; p2.textContent = detail; v.appendChild(p2);
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn' + (a.secondary ? ' secondary' : '');
      b.textContent = a.label;
      b.addEventListener('click', function () { b.disabled = true; a.run(); });
      v.appendChild(b);
    });
    v.hidden = false;
    v.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (navigator.vibrate) navigator.vibrate(cls === 'give' ? 80 : [60, 60, 60]);
  }
  function failed(box, r, next) {
    if (r && r.status === 401) return loggedOut(r.body.message);
    if (r && r.body && r.body.error === 'event_closed') return verdict(box, 'stop', 'Event has ended', r.body.message, [box === 'mverdict' ? nextPerson : nextScan]);
    var msg = r && r.network ? 'No connection to the server. Do NOT give a souvenir yet.' : ((r && r.body && r.body.message) || 'Server error') + '.';
    verdict(box, 'stop', 'Not checked', msg, [{ label: 'Try again', run: next }]);
  }

  // ---------- scan path ----------
  var nextScan = { label: 'Scan next', secondary: true, run: function () { $('verdict').hidden = true; resume(); } };

  function check(code) {
    activity(); // a camera scan involves no tap
    pause();
    var info = function (rec) { return 'Code ' + rec.id + ' · ' + rec.score + '/' + rec.total + (rec.source === 'admin' ? ' · manual' : ' · attempt ' + rec.attempts); };
    Api.call('POST', '/api/scan', { code: code }, ROLE).then(function (r) {
      if (!r.ok) {
        if (r.status === 400 || r.status === 404) return verdict('verdict', 'stop', r.status === 404 ? 'Code not found' : 'Not valid', r.body.message, [nextScan]);
        return failed('verdict', r, function () { check(code); });
      }
      var rec = r.body.record;
      if (rec.redeemed_at) {
        return verdict('verdict', 'stop', 'Already given', 'Collected at ' + time(rec.redeemed_at) + ' by ' + rec.redeemed_station + '. ' + info(rec), [nextScan]);
      }
      if (!r.body.eligible) return verdict('verdict', 'retry', 'Not all correct yet', info(rec) + '. Ask them to tap "Try again" on their phone.', [nextScan]);
      verdict('verdict', 'give', 'All correct', info(rec), [{ label: 'Souvenir given', run: function () { redeem(rec.id); } }, nextScan]);
    }, function (e) { failed('verdict', e, function () { check(code); }); });
  }

  function redeem(id) {
    Api.call('POST', '/api/redeem', { id: id }, ROLE).then(function (r) {
      if (!r.ok) return failed('verdict', r, function () { redeem(id); });
      if (r.body.stats) showStats(r.body.stats);
      var s = r.body.status;
      if (s === 'given') return verdict('verdict', 'give', 'Recorded ✓', 'Souvenir given to ' + id + '.', [nextScan]);
      if (s === 'already') return verdict('verdict', 'stop', 'Already given', 'Another officer gave this code a souvenir just now. Do not give another.', [nextScan]);
      if (s === 'cap_reached') return verdict('verdict', 'stop', 'No souvenirs left', 'All ' + r.body.stats.cap + ' souvenirs have been given out.', [nextScan]);
      verdict('verdict', 'stop', 'Not recorded', 'Status: ' + s + '. Scan the code again.', [nextScan]);
    }, function (e) { failed('verdict', e, function () { redeem(id); }); });
  }

  $('typeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('typed').value.trim();
    if (v) { check(v); $('typed').value = ''; }
  });

  // camera
  var video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  var stream = null, detector = null, busy = false, paused = false;
  if ('BarcodeDetector' in window) {
    try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }
  }
  function decodeCanvas(w, h) {
    var r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    return r ? r.data : null;
  }
  function pause() { paused = true; }
  function resume() { paused = false; }
  function tick() {
    if (!stream) return;
    if (!busy && !paused && video.readyState >= 2) {
      busy = true;
      var done = function (text) { busy = false; if (text && !paused) check(text); };
      if (detector) {
        detector.detect(video).then(function (codes) { done(codes.length ? codes[0].rawValue : null); }, function () { detector = null; done(null); });
      } else {
        var w = 480, h = Math.round(video.videoHeight / video.videoWidth * w) || 480;
        canvas.width = w; canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        done(decodeCanvas(w, h));
      }
    }
    requestAnimationFrame(tick);
  }
  function startCamera() {
    resume();
    if (stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('camNote').textContent = 'Camera not available here (needs HTTPS). Use "Scan from photo" or type the code.';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      if (location.hash !== '#scan') { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; video.srcObject = s; video.play();
      $('camWrap').hidden = false; $('camBtn').textContent = 'Stop camera'; $('camNote').textContent = '';
      tick();
    }, function (err) {
      $('camNote').textContent = 'Could not open camera (' + err.name + '). Tap "Start camera" to allow it, or use "Scan from photo".';
    });
  }
  function stopCamera() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; $('camWrap').hidden = true; $('camBtn').textContent = 'Start camera';
  }
  $('camBtn').addEventListener('click', function () { if (stream) stopCamera(); else startCamera(); });
  $('file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var img = new Image(), url = URL.createObjectURL(f);
    img.onload = function () {
      var scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      var text = decodeCanvas(canvas.width, canvas.height);
      if (text) check(text); else verdict('verdict', 'stop', 'No QR code found', 'Try again with the QR code filling more of the photo.', [nextScan]);
    };
    img.src = url;
    this.value = '';
  });

  // ---------- manual path ----------
  // The questions are a guide for the officer; there is no marking. The officer judges the MW's
  // understanding and, if satisfied, records the claim, which gives the souvenir (subject to the cap).
  $('manualIntro').textContent = C.manual.intro;
  function resetManual() {
    $('mverdict').hidden = true;
    var list = $('mq');
    list.innerHTML = '';
    C.manual.questions.forEach(function (item) {
      var li = document.createElement('li');
      li.innerHTML = '<p class="q"></p><p class="expect">Answer: <b></b></p>';
      li.querySelector('.q').textContent = item.q;
      li.querySelector('b').textContent = item.answer;
      list.appendChild(li);
    });
    $('manualSubmit').disabled = false;
  }
  var nextPerson = { label: 'Next person', secondary: true, run: function () { resetManual(); window.scrollTo(0, 0); } };

  function submitManual() {
    $('manualSubmit').disabled = true;
    var answers = C.manual.questions.map(function () { return true; });
    Api.call('POST', '/api/manual', { answers: answers }, ROLE).then(function (r) {
      if (!r.ok) return failed('mverdict', r, submitManual);
      if (r.body.stats) showStats(r.body.stats);
      var info = 'Code ' + r.body.id;
      if (r.body.status === 'given') return verdict('mverdict', 'give', 'Give a souvenir ✓', 'Recorded. ' + info, [nextPerson]);
      if (r.body.status === 'cap_reached') return verdict('mverdict', 'stop', 'No souvenirs left', 'All souvenirs have been given out. ' + info, [nextPerson]);
      verdict('mverdict', 'stop', 'Not recorded', 'Unexpected reply: ' + r.body.status, [nextPerson]);
    }, function (e) { failed('mverdict', e, submitManual); });
  }
  $('manualSubmit').addEventListener('click', submitManual);

  // ---------- bug report ----------
  // Photos are shrunk on the phone (longest side 1600 px, JPEG) so each upload stays small.
  var shots = [];
  function resetBug() {
    shots = [];
    $('bugForm').reset();
    $('bugForm').hidden = false;
    $('bverdict').hidden = true;
    $('bugErr').hidden = true;
    $('bugSend').disabled = false;
    drawThumbs();
  }
  function drawThumbs() {
    var box = $('bugThumbs');
    box.innerHTML = '';
    shots.forEach(function (src, i) {
      var fig = document.createElement('figure');
      var img = document.createElement('img'); img.src = src; img.alt = 'Screenshot ' + (i + 1);
      var x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Remove screenshot ' + (i + 1));
      x.addEventListener('click', function () { shots.splice(i, 1); drawThumbs(); });
      fig.appendChild(img); fig.appendChild(x); box.appendChild(fig);
    });
  }
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var q = 0.82, out = c.toDataURL('image/jpeg', q);
        while (out.length > 780000 && q > 0.4) { q -= 0.12; out = c.toDataURL('image/jpeg', q); } // stays under the server's 600 KB
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Not a picture')); };
      img.src = url;
    });
  }
  $('bugFiles').addEventListener('change', function () {
    var files = [].slice.call(this.files).slice(0, 3 - shots.length);
    this.value = '';
    Promise.all(files.map(shrink)).then(function (list) { shots = shots.concat(list).slice(0, 3); drawThumbs(); },
      function () { $('bugErr').textContent = 'One of the files is not a picture.'; $('bugErr').hidden = false; });
  });
  $('bugForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('bugSend').disabled = true;
    $('bugErr').hidden = true;
    Api.call('POST', '/api/bugreport', { description: $('bugText').value, screenshots: shots }, ROLE).then(function (r) {
      if (r.status === 401) return loggedOut(r.body.message);
      if (!r.ok) { $('bugErr').textContent = r.body.message || 'Could not send. Try again.'; $('bugErr').hidden = false; $('bugSend').disabled = false; return; }
      $('bugForm').hidden = true;
      verdict('bverdict', 'give', 'Thank you ✓', 'Report #' + r.body.id + ' sent. You can carry on, and check "Reported problems and fixes" on the menu to see when it is fixed.', [
        { label: 'Report another problem', secondary: true, run: function () { resetBug(); window.scrollTo(0, 0); } }
      ]);
    }, function () { $('bugErr').textContent = 'Cannot reach the server. Try again.'; $('bugErr').hidden = false; $('bugSend').disabled = false; });
  });

  // ---------- reported problems: every officer's reports and their status, read only ----------
  var BUG_STATUS = {
    new: ['Received', 'open'], in_progress: ['Being fixed', 'open'], needs_decision: ['Under review', 'open'],
    fixed: ['Fixed', 'done'], wont_fix: ['No change needed', 'closed'], duplicate: ['Already reported', 'closed']
  };
  function when(iso) { return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function took(a, b) {
    var m = Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000));
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }
  function bugItem(b) {
    var st = BUG_STATUS[b.status] || [b.status, 'open'];
    var li = document.createElement('li');
    li.className = 'bugitem ' + st[1];
    li.setAttribute('data-id', b.id);
    var head = document.createElement('p');
    head.className = 'bitemhead';
    var no = document.createElement('b'); no.textContent = '#' + b.id;
    var chip = document.createElement('span'); chip.className = 'bstat ' + st[1]; chip.textContent = st[0];
    head.appendChild(no); head.appendChild(chip);
    if (b.mine) { var y = document.createElement('span'); y.className = 'bstat mine'; y.textContent = 'Yours'; head.appendChild(y); }
    var desc = document.createElement('p'); desc.className = 'bitemdesc';
    desc.textContent = b.description.length > 300 ? b.description.slice(0, 300) + '…' : b.description;
    var meta = document.createElement('p'); meta.className = 'muted small';
    meta.textContent = 'Reported ' + when(b.created_at) + (b.reporter ? ' by ' + b.reporter : '') + (b.status === 'fixed' && b.fixed_at ? ' · Fixed ' + when(b.fixed_at) + ' (took ' + took(b.created_at, b.fixed_at) + ')' : '');
    li.appendChild(head); li.appendChild(desc); li.appendChild(meta);
    if (b.note) { var n = document.createElement('p'); n.className = 'bugnote'; n.textContent = 'What was done: ' + b.note; li.appendChild(n); }
    return li;
  }
  function loadBugs() {
    var list = $('bugList');
    list.innerHTML = '';
    $('bugsErr').hidden = true;
    $('bugsLoading').textContent = 'Loading…';
    $('bugsLoading').hidden = false;
    Api.call('GET', '/api/bugreport', null, ROLE).then(function (r) {
      $('bugsLoading').hidden = true;
      if (r.status === 401) return loggedOut(r.body.message);
      if (!r.ok) { $('bugsErr').textContent = r.body.message || 'Could not load the reports. Try again.'; $('bugsErr').hidden = false; return; }
      if (!r.body.reports.length) { $('bugsLoading').textContent = 'No problems reported yet.'; $('bugsLoading').hidden = false; return; }
      var n = { fixed: 0, open: 0, mine: 0 };
      r.body.reports.forEach(function (b) {
        if (b.status === 'fixed') n.fixed++; else if ((BUG_STATUS[b.status] || [])[1] === 'open') n.open++;
        if (b.mine) n.mine++;
        list.appendChild(bugItem(b));
      });
      $('bugsLoading').textContent = n.fixed + ' fixed · ' + n.open + ' still open' + (n.mine ? ' · ' + n.mine + ' reported by you' : '');
      $('bugsLoading').hidden = false;
    }, function () { $('bugsLoading').hidden = true; $('bugsErr').textContent = 'Cannot reach the server. Try again.'; $('bugsErr').hidden = false; });
  }

  route();
})();
