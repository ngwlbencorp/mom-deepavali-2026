(function () {
  'use strict';
  var Api = window.ScamApi, ROLE = 'super', REFRESH_MS = 15000;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var hhmm = function (d) { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };
  var dayMonth = function (d) { return new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short' }); };
  var when = function (d) { return dayMonth(d) + ', ' + hhmm(d); }; // tooltip and table: the data can span days
  // Time-axis ticks that fit: round times within a day, else one per day (local midnight).
  function timeTicks(t0, t1, max) {
    var out = [];
    if (t1 - t0 >= 20 * 3600e3) {
      var d = new Date(t0); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
      for (; d.getTime() <= t1; d.setDate(d.getDate() + 1)) out.push(d.getTime());
      var every = Math.ceil(out.length / max);
      return { ticks: out.filter(function (_, i) { return i % every === 0; }), fmt: dayMonth };
    }
    var step = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720].map(function (n) { return n * 60000; })
      .filter(function (st) { return (t1 - t0) / st <= max - 1; })[0] || 720 * 60000;
    for (var t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
    return { ticks: out.length ? out : [t1], fmt: hhmm };
  }
  var pct = function (v) { return v == null ? '–' : Math.round(v * 100) + '%'; };

  function svg(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // ---------- session / views ----------
  var timer = null, last = null;
  function show() {
    var s = Api.session(ROLE);
    $('v-login').hidden = !!s;
    $('v-app').hidden = !s;
    $('logout').hidden = !s;
    clearInterval(timer); timer = null;
    if (s) { tab('dash'); loadDash(); timer = setInterval(function () { if (document.visibilityState !== 'visible') return; if (!$('t-dash').hidden) loadDash(); if (!$('t-bugs').hidden) loadBugs(); }, REFRESH_MS); }
  }
  function loggedOut(msg) {
    Api.setSession(ROLE, null);
    show();
    if (msg) { $('loginErr').textContent = msg; $('loginErr').hidden = false; }
  }
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('loginErr'); err.hidden = true;
    Api.call('POST', '/api/login', { role: 'super', username: $('username').value, password: $('password').value }).then(function (r) {
      if (!r.ok) { err.textContent = r.body.message || 'Login failed'; err.hidden = false; return; }
      Api.setSession(ROLE, { token: r.body.token, user: r.body.user });
      $('password').value = '';
      show();
      window.scrollTo(0, 0); // the phone keyboard had scrolled the login form up; start at the tabs
    }, function () { err.textContent = 'Cannot reach the server.'; err.hidden = false; });
  });
  $('logout').addEventListener('click', function () { loggedOut(''); });

  function tab(name) {
    [].forEach.call(document.querySelectorAll('[data-tab]'), function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    ['dash', 'admins', 'data', 'bugs'].forEach(function (t) { $('t-' + t).hidden = t !== name; });
    if (name === 'admins') loadAdmins();
    if (name === 'bugs') loadBugs();
    if (name === 'dash') loadDash();
  }
  [].forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
    b.addEventListener('click', function () {
      tab(b.dataset.tab);
      // switching tabs from far down a long page: bring the tab bar back into view
      var bar = document.querySelector('.tabs').getBoundingClientRect();
      if (bar.top < 0) window.scrollBy(0, bar.top - 8);
    });
  });

  function guard(r) { if (r.status === 401 || r.status === 403) { loggedOut(r.body.message); return false; } return true; }

  // ---------- dashboard ----------
  function loadDash() {
    Api.call('GET', '/api/dashboard', null, ROLE).then(function (r) {
      if (!guard(r)) return;
      if (!r.ok) { $('updated').textContent = 'Error: ' + (r.body.message || r.status); return; }
      last = r.body;
      renderDash(last);
    }, function () { $('updated').textContent = 'Cannot reach the server. Showing the last data received.'; });
  }

  // Refreshed every 15 s. The charts are only redrawn when their data or the page width changed, so a
  // refresh does not rebuild the page under someone scrolling it (on iPhones that made it jump).
  var drawn = '';
  function renderDash(d) {
    $('updated').textContent = 'Live · updated ' + new Date(d.generatedAt).toLocaleTimeString() + ' · refreshes every ' + REFRESH_MS / 1000 + 's';
    var tiles = [
      ['Souvenirs given', d.given + ' / ' + d.cap, d.capRemaining + ' left · ' + d.adminGiven + ' via manual'],
      ['Quiz submissions', d.submissions, d.selfSubmissions + ' self · ' + d.adminSubmissions + ' manual'],
      ['MWs reached (claim IDs)', d.uniqueClaims, d.selfClaims + ' self · ' + d.adminClaims + ' manual'],
      ['First-try full score', pct(d.firstTryRate), d.selfFirstTry + ' of ' + d.selfClaims + ' self claims (see note below)'],
      ['Eventually full score', pct(d.eventualFullRate), d.selfFull + ' of ' + d.selfClaims + ' self claims'],
      ['Avg attempts to full score', d.avgAttemptsToFull == null ? '–' : d.avgAttemptsToFull.toFixed(2), 'self claims that reached full score'],
      ['Avg satisfaction', d.csatAvg == null ? '–' : d.csatAvg.toFixed(2) + ' / 5', d.csatN + ' ratings'],
      ['Learned something new', (d.learned.Y + d.learned.S + d.learned.N) ? d.learned.Y + ' yes' : '–', d.learned.S + ' a little · ' + d.learned.N + ' no'],
      // Over ~0.8 s means the database was asleep and this request woke it. Superadmin only.
      ['Database', d.dbMs == null ? '–' : d.dbMs < 800 ? 'Awake' : 'Was asleep, now awake',
        d.dbMs == null ? '' : 'responded in ' + (d.dbMs < 1000 ? d.dbMs + ' ms' : (d.dbMs / 1000).toFixed(1) + ' s'), 'wide']
    ];
    var box = $('tiles'); box.innerHTML = '';
    tiles.forEach(function (t) {
      var div = document.createElement('div'); div.className = 'tile' + (t[3] ? ' ' + t[3] : '');
      div.innerHTML = '<p class="label"></p><p class="value"></p><p class="sub"></p>';
      div.children[0].textContent = t[0]; div.children[1].textContent = t[1]; div.children[2].textContent = t[2];
      box.appendChild(div);
    });
    var key = JSON.stringify([d.timeline, d.bucketMinutes, d.cap, d.csat, d.csatN, window.innerWidth]);
    if (key === drawn) return;
    drawn = key;
    lineChart(d);
    csatChart(d);
  }

  // Cumulative submissions and souvenirs given, one shared count axis, cap as a reference line.
  var SERIES = [
    { key: 'submissions', label: 'Quiz submissions', color: 'var(--series-1)' },
    { key: 'given', label: 'Souvenirs given', color: 'var(--series-2)' }
  ];
  function lineChart(d) {
    var host = $('lineChart'), hostW = host.clientWidth; host.innerHTML = ''; // width read before clearing
    $('legend').innerHTML = SERIES.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + s.label + '</span>'; }).join('') +
      '<span><i class="ref"></i>Cap (' + d.cap + ')' + (Math.max(d.submissions, d.given) < d.cap * 0.4 ? ': shown once totals reach ' + Math.ceil(d.cap * 0.4) : '') + '</span>';
    var step = d.bucketMinutes * 60000, pts = [], sub = 0, giv = 0;
    d.timeline.forEach(function (row) {
      sub += row.submissions; giv += row.given;
      pts.push({ t: new Date(row.t).getTime() + step, submissions: sub, given: giv });
    });
    renderTable(pts);
    if (!pts.length) { host.innerHTML = '<p class="empty">No submissions yet.</p>'; return; }
    pts.unshift({ t: pts[0].t - step, submissions: 0, given: 0 });

    // On a phone the line-end labels show only the number (the legend names the series), so the
    // time axis keeps most of the width.
    var W = Math.max(300, hostW), narrow = W < 480, H = 260, m = { t: 12, r: narrow ? 34 : 130, b: 28, l: 44 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    // Scale to the data; include the cap only once the data is within reach of it, so early
    // numbers are not flattened against a line at 500.
    var dataMax = Math.max(sub, giv, 1), showCap = dataMax >= d.cap * 0.4;
    var ymaxRaw = showCap ? Math.max(d.cap, dataMax) : dataMax;
    var rough = ymaxRaw * 1.05 / 4, mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var stepY = [1, 2, 2.5, 5, 10].map(function (f) { return f * mag; }).filter(function (v) { return v >= rough; })[0];
    stepY = Math.max(1, stepY);
    var ymax = Math.ceil(ymaxRaw * 1.05 / stepY) * stepY;
    var x = function (t) { return m.l + (t1 === t0 ? iw : (t - t0) / (t1 - t0) * iw); };
    var y = function (v) { return m.t + ih - v / ymax * ih; };
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Cumulative quiz submissions and souvenirs given over time' }, host);

    for (var v = 0; v <= ymax + 1e-9; v += stepY) {
      var yy = y(v);
      svg('line', { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, stroke: 'var(--grid)', 'stroke-width': 1 }, root);
      svg('text', { x: m.l - 6, y: yy + 4, 'text-anchor': 'end' }, root).textContent = Math.round(v);
    }
    // as many labels as fit (about 64 px each), never overlapping
    var tk = timeTicks(t0, t1, Math.max(2, Math.floor(iw / 64)));
    tk.ticks.forEach(function (tt) {
      var tx = x(tt), half = 22;
      var anchor = tx - half < m.l - 8 ? 'start' : tx + half > W - 2 ? 'end' : 'middle';
      svg('line', { x1: tx, x2: tx, y1: m.t + ih, y2: m.t + ih + 4, stroke: 'var(--grid)', 'stroke-width': 1 }, root);
      svg('text', { x: tx, y: H - 8, 'text-anchor': anchor }, root).textContent = tk.fmt(tt);
    });
    if (showCap) {
      svg('line', { x1: m.l, x2: m.l + iw, y1: y(d.cap), y2: y(d.cap), stroke: 'var(--ref)', 'stroke-width': 1 }, root);
      svg('text', { x: m.l + 4, y: y(d.cap) - 5 }, root).textContent = 'Cap ' + d.cap;
    }

    var ends = [];
    SERIES.forEach(function (s) {
      var dpath = pts.map(function (p, k) { return (k ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p[s.key]).toFixed(1); }).join(' ');
      svg('path', { d: dpath, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, root);
      var lp = pts[pts.length - 1];
      svg('circle', { cx: x(lp.t), cy: y(lp[s.key]), r: 4, fill: s.color, stroke: 'var(--surface-1)', 'stroke-width': 2 }, root);
      ends.push({ s: s, y: y(lp[s.key]), v: lp[s.key], x: x(lp.t) });
    });
    // direct labels at line ends; leader lines if the ends are too close
    ends.sort(function (a, b) { return a.y - b.y; });
    if (ends.length === 2 && ends[1].y - ends[0].y < 18) { ends[0].ly = ends[0].y - 9; ends[1].ly = ends[1].y + 9; }
    ends.forEach(function (e) {
      var ly = e.ly == null ? e.y : e.ly;
      if (ly !== e.y) svg('line', { x1: e.x + 6, x2: e.x + 12, y1: e.y, y2: ly, stroke: e.s.color, 'stroke-width': 1 }, root);
      svg('text', { x: e.x + 14, y: ly + 4, class: 'lbl' }, root).textContent = narrow ? String(e.v) : e.s.label + ' ' + e.v;
    });

    // hover: crosshair + tooltip
    var cross = svg('line', { y1: m.t, y2: m.t + ih, stroke: 'var(--text-secondary)', 'stroke-width': 1, visibility: 'hidden' }, root);
    var dots = SERIES.map(function (s) { return svg('circle', { r: 4, fill: s.color, stroke: 'var(--surface-1)', 'stroke-width': 2, visibility: 'hidden' }, root); });
    var hit = svg('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, root);
    var tip = $('tip');
    function move(ev) {
      var box = root.getBoundingClientRect(), px = (ev.clientX - box.left) * W / box.width;
      var best = 0;
      pts.forEach(function (p, k) { if (Math.abs(x(p.t) - px) < Math.abs(x(pts[best].t) - px)) best = k; });
      var p = pts[best], cx = x(p.t);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      SERIES.forEach(function (s, k) { dots[k].setAttribute('cx', cx); dots[k].setAttribute('cy', y(p[s.key])); dots[k].setAttribute('visibility', 'visible'); });
      tip.innerHTML = '<b>' + when(p.t) + '</b><br>' + SERIES.map(function (s) {
        return '<span class="sw" style="background:' + s.color + '"></span>' + s.label + ': ' + p[s.key];
      }).join('<br>');
      tip.hidden = false;
      var tx = ev.clientX + 14, tw = tip.offsetWidth;
      if (tx + tw > window.innerWidth - 8) tx = ev.clientX - tw - 14;
      tip.style.left = tx + 'px'; tip.style.top = (ev.clientY - 10) + 'px';
    }
    function leave() { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (c) { c.setAttribute('visibility', 'hidden'); }); tip.hidden = true; }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  function renderTable(pts) {
    var rows = pts.map(function (p) { return '<tr><td>' + when(p.t) + '</td><td>' + p.submissions + '</td><td>' + p.given + '</td></tr>'; }).join('');
    $('lineTable').innerHTML = '<table><thead><tr><th>Up to</th><th>Quiz submissions</th><th>Souvenirs given</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3">No data yet</td></tr>') + '</tbody></table>';
  }

  // Single-series columns: rating counts, value on each cap.
  function csatChart(d) {
    var host = $('csatChart'), hostW = host.clientWidth; host.innerHTML = ''; // width read before clearing
    if (!d.csatN) { host.innerHTML = '<p class="empty">No ratings yet.</p>'; return; }
    var W = Math.max(320, hostW), H = 200, m = { t: 22, r: 8, b: 28, l: 8 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b, band = iw / 5, bw = Math.min(24, band * 0.6);
    var max = Math.max.apply(null, d.csat.concat([1]));
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Count of satisfaction ratings from 1 to 5' }, host);
    svg('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: 'var(--grid)', 'stroke-width': 1 }, root);
    d.csat.forEach(function (n, i) {
      var h = n / max * ih, cx = m.l + band * i + band / 2, x0 = cx - bw / 2, y0 = m.t + ih - h, r = Math.min(4, h);
      if (n) {
        // 4px rounded top, square at the baseline
        svg('path', {
          d: 'M' + x0 + ' ' + (m.t + ih) + 'V' + (y0 + r) + 'Q' + x0 + ' ' + y0 + ' ' + (x0 + r) + ' ' + y0 + 'H' + (x0 + bw - r) +
             'Q' + (x0 + bw) + ' ' + y0 + ' ' + (x0 + bw) + ' ' + (y0 + r) + 'V' + (m.t + ih) + 'Z',
          fill: 'var(--series-1)'
        }, root).appendChild(document.createElementNS(SVGNS, 'title')).textContent = 'Rating ' + (i + 1) + ': ' + n;
      }
      svg('text', { x: cx, y: y0 - 6, 'text-anchor': 'middle', class: 'lbl' }, root).textContent = n;
      svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, root).textContent = String(i + 1);
    });
  }

  var resizeT;
  // iPhones report a resize whenever the address bar shows or hides while scrolling; only a change
  // of width needs the charts redrawn.
  var lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(resizeT); resizeT = setTimeout(function () { if (last && !$('t-dash').hidden) renderDash(last); }, 150);
  });

  // ---------- admins ----------
  var pending = [];
  function adminError(msg) { var e = $('adminErr'); e.textContent = msg || ''; e.hidden = !msg; }
  // Officers who have not logged in yet come first, so they are easy to chase.
  function renderAdmins(list) {
    $('adminCount').textContent = list.length;
    var seen = list.filter(function (a) { return a.login_count > 0; }).length;
    $('loginSummary').textContent = seen + ' of ' + list.length + ' have logged in';
    list = list.slice().sort(function (a, b) { return (a.login_count > 0) - (b.login_count > 0) || (a.email < b.email ? -1 : 1); });
    var ul = $('adminList'); ul.innerHTML = '';
    list.forEach(function (a) {
      var li = document.createElement('li'), span = document.createElement('span'), b = document.createElement('button');
      span.textContent = a.email;
      var seenText = document.createElement('small');
      seenText.className = 'lastlogin' + (a.login_count > 0 ? '' : ' never');
      seenText.textContent = a.login_count > 0
        ? 'Last login ' + new Date(a.last_login_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + a.login_count + (a.login_count === 1 ? ' login' : ' logins')
        : 'Not logged in yet';
      span.appendChild(seenText);
      b.textContent = 'Remove';
      b.addEventListener('click', function () {
        if (!confirm('Remove ' + a.email + '? They will be logged out on their next action.')) return;
        Api.call('POST', '/api/admins', { remove: a.email }, ROLE).then(function (r) { if (guard(r) && r.ok) renderAdmins(r.body.admins); });
      });
      li.appendChild(span); li.appendChild(b); ul.appendChild(li);
    });
  }
  function loadAdmins() {
    Api.call('GET', '/api/admins', null, ROLE).then(function (r) { if (guard(r) && r.ok) renderAdmins(r.body.admins); }, function () { adminError('Cannot reach the server.'); });
  }
  $('csv').addEventListener('change', function () {
    var f = this.files && this.files[0];
    adminError('');
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var found = {};
      String(reader.result).split(/[\r\n,;\t]+/).forEach(function (cell) {
        var v = cell.replace(/^[\s"'﻿]+|[\s"']+$/g, '').toLowerCase();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) found[v] = true;
      });
      pending = Object.keys(found);
      $('previewText').textContent = pending.length
        ? pending.length + ' email address(es) found, e.g. ' + pending.slice(0, 3).join(', ') + (pending.length > 3 ? ', …' : '')
        : 'No email addresses found in this file.';
      $('uploadBtn').disabled = !pending.length;
      $('preview').hidden = false;
    };
    reader.readAsText(f);
    this.value = '';
  });
  $('uploadBtn').addEventListener('click', function () {
    var mode = document.querySelector('input[name="mode"]:checked').value;
    if (mode === 'replace' && !confirm('Replace the whole admin list with these ' + pending.length + ' emails? Admins not in the file lose access.')) return;
    Api.call('POST', '/api/admins', { emails: pending, mode: mode }, ROLE).then(function (r) {
      if (!guard(r)) return;
      if (!r.ok) return adminError(r.body.message);
      $('preview').hidden = true; pending = [];
      renderAdmins(r.body.admins);
    }, function () { adminError('Cannot reach the server.'); });
  });

  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    adminError('');
    var email = $('addEmail').value.trim().toLowerCase();
    Api.call('POST', '/api/admins', { emails: [email], mode: 'add' }, ROLE).then(function (r) {
      if (!guard(r)) return;
      if (!r.ok) return adminError(r.body.message);
      $('addEmail').value = '';
      renderAdmins(r.body.admins);
    }, function () { adminError('Cannot reach the server.'); });
  });

  // ---------- bug log ----------
  var STATUS_LABEL = { new: 'New', in_progress: 'Being fixed', needs_decision: 'Needs your decision', fixed: 'Fixed', wont_fix: "Won't fix", duplicate: 'Duplicate' };
  var REPO = 'https://github.com/ngwlbencorp/mom-deepavali-2026/commit/';
  var shotUrls = {}; // screenshot id -> object URL, so refreshes do not download images again
  function took(a, b) {
    var m = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
    return m < 60 ? m + ' min' : m < 1440 ? (m / 60).toFixed(1) + ' h' : (m / 1440).toFixed(1) + ' days';
  }
  function node(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function loadBugs() {
    Api.call('GET', '/api/bugs', null, ROLE).then(function (r) {
      if (!guard(r)) return;
      if (!r.ok) { $('bugErr').textContent = r.body.message || 'Could not load the bug log'; $('bugErr').hidden = false; return; }
      $('bugErr').hidden = true;
      renderBugs(r.body.reports, r.body.statuses);
    }, function () { $('bugErr').textContent = 'Cannot reach the server.'; $('bugErr').hidden = false; });
    Api.call('GET', '/api/apierrors', null, ROLE).then(function (r) { if (guard(r) && r.ok) renderErrors(r.body.errors.slice(0, 50)); }, function () {});
  }
  function renderErrors(list) {
    var box = $('errList');
    box.innerHTML = '';
    if (!list.length) { box.appendChild(node('p', 'muted', 'None recorded.')); return; }
    var t = node('table'), head = node('tr');
    ['When', 'API', 'Error'].forEach(function (h) { head.appendChild(node('th', null, h)); });
    t.appendChild(head);
    list.forEach(function (x) {
      var tr = node('tr');
      tr.appendChild(node('td', null, new Date(x.created_at).toLocaleString()));
      tr.appendChild(node('td', null, x.route));
      tr.appendChild(node('td', 'errmsg', x.message));
      t.appendChild(tr);
    });
    box.appendChild(t);
  }
  function renderBugs(list, statuses) {
    var fixed = list.filter(function (b) { return b.status === 'fixed' && b.fixed_at; });
    var open = list.filter(function (b) { return ['new', 'in_progress', 'needs_decision'].indexOf(b.status) >= 0; }).length;
    var mins = fixed.map(function (b) { return (new Date(b.fixed_at) - new Date(b.created_at)) / 60000; }).sort(function (a, b) { return a - b; });
    var median = mins.length ? took(0, mins[Math.floor((mins.length - 1) / 2)] * 60000) : '–';
    $('bugSummary').textContent = list.length + ' reported · ' + fixed.length + ' fixed · ' + open + ' open · median time to fix ' + median;
    var box = $('bugList');
    box.innerHTML = '';
    if (!list.length) box.appendChild(node('p', 'muted center', 'No reports yet.'));
    list.forEach(function (b) {
      var card = node('div', 'card bug ' + b.status);
      card.dataset.id = b.id;
      var head = node('div', 'bughead');
      head.appendChild(node('b', null, 'Report #' + b.id + (b.screen ? ' · ' + b.screen : '')));
      head.appendChild(node('span', 'badge ' + b.status, STATUS_LABEL[b.status] || b.status));
      card.appendChild(head);
      card.appendChild(node('p', 'muted small', 'Reported ' + new Date(b.created_at).toLocaleString() + ' by ' + (b.reporter_email || '–') +
        (b.fixed_at ? ' · fixed ' + new Date(b.fixed_at).toLocaleString() + ' (' + took(b.created_at, b.fixed_at) + ')' : '')));
      var desc = node('p', 'bugdesc', b.description); desc.dir = 'auto'; card.appendChild(desc); // e.g. Urdu reads right to left
      if (b.screenshots.length) {
        var row = node('div', 'bugshots');
        b.screenshots.forEach(function (id) {
          var a = node('a'); a.target = '_blank'; a.rel = 'noopener';
          var img = node('img'); img.alt = 'Screenshot ' + id; a.appendChild(img); row.appendChild(a);
          var show = function (u) { img.src = u; a.href = u; };
          if (shotUrls[id]) show(shotUrls[id]);
          else Api.call('GET', '/api/bugshot?id=' + id, null, ROLE, true).then(function (r) { if (r.ok) show(shotUrls[id] = URL.createObjectURL(r.body)); });
        });
        card.appendChild(row);
      }
      if (b.fix_note || b.fix_ref) {
        var fix = node('p', 'small');
        fix.appendChild(node('b', null, 'Fix: '));
        if (b.fix_note) fix.appendChild(document.createTextNode(b.fix_note + ' '));
        if (b.fix_ref && /^[0-9a-f]{7,40}$/.test(b.fix_ref)) { var l = node('a', null, b.fix_ref.slice(0, 7)); l.href = REPO + b.fix_ref; l.target = '_blank'; l.rel = 'noopener'; fix.appendChild(l); }
        else if (b.fix_ref) fix.appendChild(document.createTextNode(b.fix_ref));
        card.appendChild(fix);
      }
      var sel = node('select'); sel.setAttribute('aria-label', 'Status of report ' + b.id);
      (statuses || Object.keys(STATUS_LABEL)).forEach(function (st) { var o = node('option', null, STATUS_LABEL[st] || st); o.value = st; o.selected = st === b.status; sel.appendChild(o); });
      sel.addEventListener('change', function () {
        Api.call('POST', '/api/bugs', { id: b.id, status: sel.value }, ROLE).then(function (r) { if (guard(r)) loadBugs(); });
      });
      var lab = node('label', 'field small', 'Status '); lab.appendChild(sel); card.appendChild(lab);
      // Reports about this page are left out of the officers' list of reported problems.
      var own = node('input'); own.type = 'checkbox'; own.checked = b.screen === 'superadmin';
      own.addEventListener('change', function () {
        Api.call('POST', '/api/bugs', { id: b.id, status: b.status, screen: own.checked ? 'superadmin' : '' }, ROLE).then(function (r) { if (guard(r)) loadBugs(); });
      });
      var ownLab = node('label', 'small ownpage'); ownLab.appendChild(own); ownLab.appendChild(document.createTextNode(' About this page: hide from officers'));
      card.appendChild(ownLab);
      box.appendChild(card);
    });
  }

  // ---------- data ----------
  [].forEach.call(document.querySelectorAll('[data-export]'), function (b) {
    b.addEventListener('click', function () {
      var table = b.dataset.export, err = $('exportErr');
      err.hidden = true;
      Api.call('GET', '/api/export?table=' + table, null, ROLE, true).then(function (r) {
        if (!guard(r)) return;
        if (!r.ok) { err.textContent = r.body.message || 'Download failed'; err.hidden = false; return; }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(r.body);
        a.download = 'scam-quiz-' + table + '-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      }, function () { err.textContent = 'Cannot reach the server.'; err.hidden = false; });
    });
  });
  $('resetBtn').addEventListener('click', function () {
    var msg = $('resetMsg');
    if ($('resetConfirm').value !== 'RESET') { msg.textContent = 'Type RESET first.'; return; }
    Api.call('POST', '/api/reset', { confirm: 'RESET' }, ROLE).then(function (r) {
      if (!guard(r)) return;
      msg.textContent = r.ok ? 'All claims and submissions deleted.' : (r.body.message || 'Failed');
      $('resetConfirm').value = '';
    }, function () { msg.textContent = 'Cannot reach the server.'; });
  });

  show();
})();
