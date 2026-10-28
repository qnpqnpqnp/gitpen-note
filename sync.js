// 깃펜노트 기기 동기화
// 필기 데이터를 GitHub 비공개 Gist 하나에 올려두고, 기기마다 받아서 합침.
// 합치는 규칙: 책마다 더 최근에 고친 쪽이 이김. 버린 책은 삭제 기록으로 지움.
(function () {
  'use strict';

  var App = window.GitpenApp;
  if (!App) return;

  var KEY = 'gitpen-sync';            // 토큰과 Gist 번호 (필기 데이터와 따로 보관, 백업에 안 들어감)
  var API = 'https://api.github.com';
  var DESC = 'gitpen-note sync (깃펜노트 동기화 데이터)';
  var FILE = 'gitpen-data.json';
  var DEBOUNCE_MS = 3000;
  var POLL_MS = 60000;

  var cfg = loadCfg();
  var busy = false, again = false, timer = null;
  var status = { kind: cfg.token ? 'idle' : 'off', at: 0, msg: '' };

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCfg() {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* 저장 불가: 이번 세션만 */ }
  }

  // ───────── 합치기 (순수 함수) ─────────
  function merge(local, remote) {
    if (!remote) return local;
    var deleted = {};
    [local.deleted || {}, remote.deleted || {}].forEach(function (d) {
      Object.keys(d).forEach(function (id) { deleted[id] = Math.max(deleted[id] || 0, Number(d[id]) || 0); });
    });

    var byId = {}, order = [];
    function take(b) {
      if (!b || !b.id) return;
      var cur = byId[b.id];
      if (!cur) { byId[b.id] = b; order.push(b.id); return; }
      if ((Number(b.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) byId[b.id] = b;
    }
    (local.books || []).forEach(take);
    (remote.books || []).forEach(take);

    var books = order.map(function (id) { return byId[id]; }).filter(function (b) {
      return !(deleted[b.id] && deleted[b.id] >= (Number(b.updatedAt) || 0));
    });
    books.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });

    // 레벨은 더 높은 쪽 (같은 레벨이면 경험치 많은 쪽)
    var lv = local, rl = Number(remote.level) || 1, ll = Number(local.level) || 1;
    if (rl > ll || (rl === ll && (Number(remote.xp) || 0) > (Number(local.xp) || 0))) lv = remote;

    // 업적은 둘 다 모으고, 날짜는 먼저 딴 쪽
    var achv = {};
    [local.achievements || {}, remote.achievements || {}].forEach(function (a) {
      Object.keys(a).forEach(function (id) {
        var t = Number(a[id]);
        if (t) achv[id] = achv[id] ? Math.min(achv[id], t) : t;
      });
    });

    // 날짜별 글자 수: 기기마다 센 걸 더하면 겹치니 큰 쪽을 씀
    var days = {};
    [local.days || {}, remote.days || {}].forEach(function (d) {
      Object.keys(d).forEach(function (k) { days[k] = Math.max(days[k] || 0, Number(d[k]) || 0); });
    });

    return {
      books: books,
      deleted: deleted,
      xp: Number(lv.xp) || 0,
      level: Number(lv.level) || 1,
      totalChars: Math.max(Number(local.totalChars) || 0, Number(remote.totalChars) || 0),
      achievements: achv,
      days: days
    };
  }

  // ───────── GitHub API ─────────
  function gh(method, path, body) {
    return fetch(API + path, {
      method: method,
      cache: 'no-store',
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) throw { auth: true, status: res.status };
      if (res.status === 404) throw { notFound: true };
      if (!res.ok) throw { status: res.status };
      return res.json();
    });
  }

  function findOrCreateGist() {
    if (cfg.gistId) return Promise.resolve(cfg.gistId);
    return gh('GET', '/gists?per_page=100').then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].description === DESC && list[i].files && list[i].files[FILE]) return list[i].id;
      }
      var files = {}; files[FILE] = { content: JSON.stringify(App.getData()) };
      return gh('POST', '/gists', { description: DESC, public: false, files: files }).then(function (g) { return g.id; });
    }).then(function (id) { cfg.gistId = id; saveCfg(); return id; });
  }

  function readGist(id) {
    return gh('GET', '/gists/' + id).then(function (g) {
      var f = g.files && g.files[FILE];
      if (!f) return null;
      if (!f.truncated) return JSON.parse(f.content || 'null');
      // 1MB 넘으면 본문이 잘려서 오므로 원본 주소에서 받음
      return fetch(f.raw_url, { cache: 'no-store' }).then(function (r) { return r.json(); });
    });
  }

  function writeGist(id, data) {
    var files = {}; files[FILE] = { content: JSON.stringify(data) };
    return gh('PATCH', '/gists/' + id, { files: files });
  }

  // ───────── 동기화 한 번 ─────────
  function syncNow() {
    if (!cfg.token) { setStatus('off'); return Promise.resolve(); }
    if (busy) { again = true; return Promise.resolve(); }
    if (!navigator.onLine) { setStatus('offline'); return Promise.resolve(); }
    busy = true;
    setStatus('busy');
    var id;
    return findOrCreateGist().then(function (gid) {
      id = gid;
      return readGist(id);
    }).catch(function (err) {
      if (err && err.notFound) { cfg.gistId = null; saveCfg(); return findOrCreateGist().then(function (gid) { id = gid; return readGist(id); }); }
      throw err;
    }).then(function (remote) {
      var local = App.getData();
      var merged = merge(local, remote);
      var mergedStr = JSON.stringify(merged);
      if (mergedStr !== JSON.stringify(local)) App.applySynced(merged);
      if (!remote || mergedStr !== JSON.stringify(merge(remote, remote))) return writeGist(id, merged);
    }).then(function () {
      setStatus('ok');
    }).catch(function (err) {
      if (err && err.auth) setStatus('auth');
      else if (!navigator.onLine) setStatus('offline');
      else setStatus('error');
    }).then(function () {
      busy = false;
      if (again) { again = false; schedule(500); }
    });
  }

  function schedule(ms) {
    if (!cfg.token) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, typeof ms === 'number' ? ms : DEBOUNCE_MS);
    if (status.kind === 'ok') setStatus('pending');
  }

  // ───────── 상태 표시 ─────────
  var LABEL = {
    off: '동기화 꺼짐',
    idle: '동기화 대기',
    pending: '올릴 내용 있음',
    busy: '동기화 중…',
    ok: '동기화됨',
    offline: '오프라인 · 연결되면 올림',
    auth: '토큰 확인 필요',
    error: '동기화 실패 · 곧 다시 시도'
  };

  function hhmm(t) {
    var d = new Date(t);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function setStatus(kind) {
    status.kind = kind;
    if (kind === 'ok') status.at = Date.now();
    renderStatus();
    if (kind === 'error') schedule(30000);
  }

  function renderStatus() {
    var text = LABEL[status.kind] + (status.kind === 'ok' ? ' ' + hhmm(status.at) : '');
    document.querySelectorAll('.sync-slot').forEach(function (slot) {
      slot.textContent = '';
      slot.className = 'sync-slot is-' + status.kind;
      if (status.kind === 'off') return; // 안 쓰면 아예 안 보여줌
      var dot = document.createElement('span');
      dot.className = 'sync-dot';
      dot.setAttribute('aria-hidden', 'true');
      slot.appendChild(dot);
      slot.appendChild(document.createTextNode(text));
    });
    var st = document.getElementById('sync-state-text');
    if (st) st.textContent = cfg.token ? '연결됨 · ' + text : '아직 연결 안 됨';
  }

  // ───────── 설정 화면 ─────────
  var dlg = document.getElementById('sync-dialog');
  function renderDialog() {
    var on = !!cfg.token;
    document.getElementById('sync-setup').hidden = on;
    document.getElementById('sync-connect').hidden = on;
    document.getElementById('sync-now').hidden = !on;
    document.getElementById('sync-disconnect').hidden = !on;
    document.getElementById('sync-token').value = '';
    renderStatus();
  }

  document.getElementById('btn-sync').addEventListener('click', function () {
    renderDialog();
    dlg.showModal();
  });

  document.getElementById('sync-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var token = document.getElementById('sync-token').value.trim();
    if (!token) { document.getElementById('sync-token').focus(); return; }
    cfg = { token: token, gistId: null };
    saveCfg();
    renderDialog();
    syncNow().then(function () {
      if (status.kind === 'ok') App.toast('연결 완료. 이제 기기끼리 자동으로 맞춰져.');
      else if (status.kind === 'auth') {
        App.toast('토큰이 안 맞아. gist 권한으로 다시 만들어줘.');
        cfg = {}; saveCfg(); setStatus('off'); renderDialog();
        var st = document.getElementById('sync-state-text');
        if (st) st.textContent = '토큰이 안 맞아. gist 권한으로 다시 만들어줘.';
      }
    });
  });

  document.getElementById('sync-now').addEventListener('click', function () { syncNow(); });

  document.getElementById('sync-disconnect').addEventListener('click', function () {
    if (!window.confirm('이 기기의 동기화를 끊을까? 필기는 이 기기에 그대로 남아.')) return;
    cfg = {}; saveCfg();
    setStatus('off');
    renderDialog();
  });

  // ───────── 자동 동기화 ─────────
  document.addEventListener('visibilitychange', function () {
    if (!cfg.token) return;
    // 앱을 떠날 때 바로 올리고, 돌아오면 바로 받아옴
    if (document.visibilityState === 'hidden') { clearTimeout(timer); syncNow(); }
    else syncNow();
  });
  window.addEventListener('online', function () { if (cfg.token) syncNow(); });
  window.addEventListener('offline', function () { if (cfg.token) setStatus('offline'); });
  setInterval(function () {
    if (cfg.token && document.visibilityState === 'visible') syncNow();
  }, POLL_MS);

  window.GitpenSync = { schedule: schedule, syncNow: syncNow, merge: merge };

  renderStatus();
  if (cfg.token) syncNow();
})();
