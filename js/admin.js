(function () {
  'use strict';
  var Api = window.ScamApi, C = window.SCAM_CONTENT;
  var ROLE = 'admin', POLL_MS = 5000;
  var $ = function (id) { return document.getElementById(id); };
  var time = function (iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; };

  // ---------- views (hash routes: #home, #scan, #manual) ----------
  var views = ['login', 'home', 'scan', 'manual'];
  function route() {
    var s = Api.session(ROLE);
    var want = (location.hash || '#home').slice(1);
    if (!s) want = 'login';
    else if (views.indexOf(want) < 0 || want === 'login') want = 'home';
    views.forEach(function (v) { $('v-' + v).hidden = v !== want; });
    $('counter').hidden = !s;
    if (want !== 'scan') stopCamera();
    if (want === 'manual') resetManual();
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
    if (Date.now() - lastOk < POLL_MS * 2.5) return;
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
  function startPolling() { if (!pollTimer) { poll(); pollTimer = setInterval(poll, POLL_MS); } }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && pollTimer) poll(); });

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
    var msg = r && r.network ? 'No connection to the server. Do NOT give a souvenir yet.' : ((r && r.body && r.body.message) || 'Server error') + '.';
    verdict(box, 'stop', 'Not checked', msg, [{ label: 'Try again', run: next }]);
  }

  // ---------- scan path ----------
  var nextScan = { label: 'Scan next', secondary: true, run: function () { $('verdict').hidden = true; resume(); } };

  function check(code) {
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
  var marks = [], manualId = null;
  $('manualIntro').textContent = C.manual.intro;
  function resetManual() {
    marks = C.manual.questions.map(function () { return null; });
    manualId = null;
    $('mverdict').hidden = true;
    var list = $('mq');
    list.innerHTML = '';
    C.manual.questions.forEach(function (item, i) {
      var li = document.createElement('li');
      li.innerHTML = '<p class="q"></p><p class="expect">Correct answer: <b></b></p><div class="pair"><button type="button" class="yes" aria-pressed="false">✓ Correct</button><button type="button" class="no" aria-pressed="false">✕ Wrong</button></div>';
      li.querySelector('.q').textContent = item.q;
      li.querySelector('b').textContent = item.answer;
      var yes = li.querySelector('.yes'), no = li.querySelector('.no');
      function pick(v) {
        marks[i] = v;
        yes.setAttribute('aria-pressed', String(v === true));
        no.setAttribute('aria-pressed', String(v === false));
        $('manualSubmit').disabled = marks.indexOf(null) >= 0;
      }
      yes.addEventListener('click', function () { pick(true); });
      no.addEventListener('click', function () { pick(false); });
      list.appendChild(li);
    });
    $('manualSubmit').disabled = true;
  }
  var nextPerson = { label: 'Next person', secondary: true, run: function () { resetManual(); window.scrollTo(0, 0); } };

  function submitManual() {
    $('manualSubmit').disabled = true;
    Api.call('POST', '/api/manual', { answers: marks.slice(), id: manualId }, ROLE).then(function (r) {
      if (!r.ok) return failed('mverdict', r, submitManual);
      if (r.body.stats) showStats(r.body.stats);
      var b = r.body, info = 'Code ' + b.id + ' · ' + b.score + '/' + b.total + ' · attempt ' + b.attempts;
      if (b.status === 'given') { manualId = null; return verdict('mverdict', 'give', 'Give a souvenir ✓', 'Recorded. ' + info, [nextPerson]); }
      if (b.status === 'cap_reached') return verdict('mverdict', 'stop', 'No souvenirs left', 'All correct, but all souvenirs have been given out. ' + info, [nextPerson]);
      manualId = b.id;
      verdict('mverdict', 'retry', 'Not all correct', info + '. Explain the right answers, then ask again and mark their new replies.', [
        { label: 'Ask again', run: function () { $('mverdict').hidden = true; $('manualSubmit').disabled = false; window.scrollTo(0, 0); } },
        nextPerson
      ]);
    }, function (e) { failed('mverdict', e, submitManual); });
  }
  $('manualSubmit').addEventListener('click', submitManual);

  route();
})();
