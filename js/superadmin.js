(function () {
  'use strict';
  var Api = window.ScamApi, ROLE = 'super', REFRESH_MS = 15000;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var hhmm = function (d) { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
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
    clearInterval(timer); timer = null;
    if (s) { tab('dash'); loadDash(); timer = setInterval(function () { if (!$('t-dash').hidden && document.visibilityState === 'visible') loadDash(); }, REFRESH_MS); }
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
    }, function () { err.textContent = 'Cannot reach the server.'; err.hidden = false; });
  });
  $('logout').addEventListener('click', function () { loggedOut(''); });

  function tab(name) {
    [].forEach.call(document.querySelectorAll('[data-tab]'), function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    ['dash', 'admins', 'data'].forEach(function (t) { $('t-' + t).hidden = t !== name; });
    if (name === 'admins') loadAdmins();
    if (name === 'dash') loadDash();
  }
  [].forEach.call(document.querySelectorAll('[data-tab]'), function (b) { b.addEventListener('click', function () { tab(b.dataset.tab); }); });

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
      ['Learned something new', (d.learned.Y + d.learned.S + d.learned.N) ? d.learned.Y + ' yes' : '–', d.learned.S + ' a little · ' + d.learned.N + ' no']
    ];
    var box = $('tiles'); box.innerHTML = '';
    tiles.forEach(function (t) {
      var div = document.createElement('div'); div.className = 'tile';
      div.innerHTML = '<p class="label"></p><p class="value"></p><p class="sub"></p>';
      div.children[0].textContent = t[0]; div.children[1].textContent = t[1]; div.children[2].textContent = t[2];
      box.appendChild(div);
    });
    lineChart(d);
    csatChart(d);
  }

  // Cumulative submissions and souvenirs given, one shared count axis, cap as a reference line.
  var SERIES = [
    { key: 'submissions', label: 'Quiz submissions', color: 'var(--series-1)' },
    { key: 'given', label: 'Souvenirs given', color: 'var(--series-2)' }
  ];
  function lineChart(d) {
    var host = $('lineChart'); host.innerHTML = '';
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

    var W = Math.max(320, host.clientWidth), H = 260, m = { t: 12, r: 130, b: 28, l: 44 };
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
    var ticks = Math.min(5, pts.length);
    for (var j = 0; j < ticks; j++) {
      var tt = t0 + (t1 - t0) * (ticks === 1 ? 1 : j / (ticks - 1));
      svg('text', { x: x(tt), y: H - 8, 'text-anchor': j === 0 ? 'start' : j === ticks - 1 ? 'end' : 'middle' }, root).textContent = hhmm(tt);
    }
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
      svg('text', { x: e.x + 14, y: ly + 4, class: 'lbl' }, root).textContent = e.s.label + ' ' + e.v;
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
      tip.innerHTML = '<b>' + hhmm(p.t) + '</b><br>' + SERIES.map(function (s) {
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
    var rows = pts.map(function (p) { return '<tr><td>' + hhmm(p.t) + '</td><td>' + p.submissions + '</td><td>' + p.given + '</td></tr>'; }).join('');
    $('lineTable').innerHTML = '<table><thead><tr><th>Up to</th><th>Quiz submissions</th><th>Souvenirs given</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3">No data yet</td></tr>') + '</tbody></table>';
  }

  // Single-series columns: rating counts, value on each cap.
  function csatChart(d) {
    var host = $('csatChart'); host.innerHTML = '';
    if (!d.csatN) { host.innerHTML = '<p class="empty">No ratings yet.</p>'; return; }
    var W = Math.max(320, host.clientWidth), H = 200, m = { t: 22, r: 8, b: 28, l: 8 };
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
  window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if (last && !$('t-dash').hidden) renderDash(last); }, 150); });

  // ---------- admins ----------
  var pending = [];
  function adminError(msg) { var e = $('adminErr'); e.textContent = msg || ''; e.hidden = !msg; }
  function renderAdmins(list) {
    $('adminCount').textContent = list.length;
    var ul = $('adminList'); ul.innerHTML = '';
    list.forEach(function (a) {
      var li = document.createElement('li'), span = document.createElement('span'), b = document.createElement('button');
      span.textContent = a.email; b.textContent = 'Remove';
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
