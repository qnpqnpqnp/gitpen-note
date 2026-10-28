// 깃펜노트 — 혼자 쓰는 픽셀 필기장
// 데이터는 이 브라우저의 localStorage에만 저장됨. 백업은 설정 메뉴에서.
(function () {
  'use strict';

  var CFG = window.GITPEN_CONFIG || {};
  var LIMIT = CFG.pageLimit || 256;
  var MAX_PAGES = CFG.maxPages || 100;
  var SKINS = (CFG.skins && CFG.skins.length) ? CFG.skins : ['default'];
  var STORE_KEY = 'gitpen-note-v1';
  var GAUGE_SEGS = 16;
  var XP_SEGS = 20;
  var COLORS = ['#2f5a7a', '#8a3030', '#3a6230', '#5e3f78', '#7a4c1a', '#1f5f5f', '#4a4a52'];
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 경험치: 새로 쓴 글자 1자 = 1, 새 쪽 = 5, 새 책 = 10, 서명 = 50
  var XP_NEW_PAGE = 5, XP_NEW_BOOK = 10, XP_SIGN = 50;
  function xpToNext(level) { return 30 + level * 20; }

  // 업적 목록
  var ACHIEVEMENTS = [
    { id: 'first_book',  title: '첫 책',        desc: '처음으로 책을 만들었다' },
    { id: 'first_ink',   title: '첫 획',        desc: '처음으로 필기를 했다' },
    { id: 'full_page',   title: '꽉 찬 쪽',     desc: '한 쪽을 ' + LIMIT + '자까지 채웠다' },
    { id: 'pages_10',    title: '열 쪽',        desc: '한 책을 10쪽까지 썼다' },
    { id: 'first_sign',  title: '봉인',         desc: '처음으로 책에 서명했다' },
    { id: 'chars_1000',  title: '천 자',        desc: '모두 합쳐 1,000자를 썼다' },
    { id: 'books_5',     title: '책장 채우기',  desc: '책을 5권 모았다' },
    { id: 'level_5',     title: '견습 필경사',  desc: '레벨 5에 도달했다' },
    { id: 'level_10',    title: '필경사',       desc: '레벨 10에 도달했다' },
    { id: 'night_owl',   title: '올빼미',       desc: '자정부터 새벽 4시 사이에 필기했다' },
    { id: 'chars_10000', title: '만 자',        desc: '모두 합쳐 10,000자를 썼다' },
    { id: 'pages_100',   title: '완결',         desc: '한 책을 ' + MAX_PAGES + '쪽까지 채웠다' },
    { id: 'streak_3',    title: '불씨',         desc: '3일 연속으로 필기했다' },
    { id: 'streak_7',    title: '모닥불',       desc: '7일 연속으로 필기했다' },
    { id: 'streak_30',   title: '꺼지지 않는 불', desc: '30일 연속으로 필기했다' },
    { id: 'early_bird',  title: '아침형 인간',  desc: '새벽 5시부터 아침 7시 사이에 필기했다' },
    { id: 'cram',        title: '벼락치기',     desc: '하루에 2,000자를 썼다' },
    { id: 'read_through',title: '다 읽었다',    desc: '서명한 책을 처음부터 끝까지 넘겨봤다' },
    { id: 'librarian',   title: '도서관장',     desc: '서명한 책 10권을 모았다' },
    { id: 'speed',       title: '속필',         desc: '1분 안에 200자를 직접 쳤다', hidden: true },
    { id: 'silent',      title: '침묵의 필경사', desc: '소리를 끈 채로 한 쪽을 꽉 채웠다', hidden: true },
    { id: 'explorer',    title: '탐험가',       desc: '모든 스킨을 한 번씩 입어봤다', hidden: true }
  ];

  // ───────── 상태 ─────────
  var state = load();
  var current = { bookId: null, page: 0 };

  function emptyState() {
    return { books: [], limitOn: true, skin: SKINS[0], sound: true, pen: true, xp: 0, level: 1, totalChars: 0, achievements: {}, deleted: {}, days: {}, skinsUsed: {} };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyState();
      return sanitize(JSON.parse(raw)) || emptyState();
    } catch (e) {
      return emptyState();
    }
  }

  function save(fromSync) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('저장 공간이 부족해서 저장하지 못했어. 백업을 받아둬.');
    }
    // 내가 고친 거면 몇 초 뒤 다른 기기로 올림
    if (!fromSync && window.GitpenSync) window.GitpenSync.schedule();
  }

  function sanitize(obj) {
    if (!obj || !Array.isArray(obj.books)) return null;
    var books = obj.books.filter(function (b) {
      return b && typeof b.title === 'string' && Array.isArray(b.pages);
    }).map(function (b) {
      var pages = b.pages.map(function (p) { return typeof p === 'string' ? p : ''; }).slice(0, MAX_PAGES);
      if (!pages.length) pages = [''];
      // best = 쪽마다 지금까지 가장 길었던 글자 수 (지웠다 다시 써서 경험치 버는 걸 막음)
      var best = pages.map(function (p, i) {
        var prev = Array.isArray(b.best) ? Number(b.best[i]) || 0 : 0;
        return Math.max(prev, charLen(p));
      });
      return {
        id: typeof b.id === 'string' ? b.id : newId(),
        title: b.title.slice(0, 16) || '이름 없는 책',
        color: COLORS.indexOf(b.color) >= 0 ? b.color : COLORS[0],
        pages: pages,
        best: best,
        signed: !!b.signed,
        createdAt: Number(b.createdAt) || Date.now(),
        updatedAt: Number(b.updatedAt) || Date.now(),
        lastPage: Math.min(Math.max(0, Number(b.lastPage) || 0), pages.length - 1)
      };
    });
    var achv = {};
    if (obj.achievements && typeof obj.achievements === 'object') {
      ACHIEVEMENTS.forEach(function (a) {
        var t = Number(obj.achievements[a.id]);
        if (t) achv[a.id] = t;
      });
    }
    // 삭제 기록: 다른 기기에 남은 책이 되살아나지 않게
    var deleted = {};
    if (obj.deleted && typeof obj.deleted === 'object') {
      Object.keys(obj.deleted).forEach(function (id) {
        var t = Number(obj.deleted[id]);
        if (t) deleted[id] = t;
      });
    }
    return {
      books: books,
      deleted: deleted,
      limitOn: obj.limitOn !== false,
      skin: SKINS.indexOf(obj.skin) >= 0 ? obj.skin : SKINS[0],
      sound: obj.sound !== false,
      pen: obj.pen !== false,
      xp: Math.max(0, Number(obj.xp) || 0),
      level: Math.max(1, Number(obj.level) || 1),
      totalChars: Math.max(0, Number(obj.totalChars) || 0),
      achievements: achv,
      days: cleanDays(obj.days),
      skinsUsed: (obj.skinsUsed && typeof obj.skinsUsed === 'object') ? obj.skinsUsed : {}
    };
  }

  // 날짜별로 쓴 글자 수 { '2026-10-28': 812 } — 연속 기록, 벼락치기 계산용
  function cleanDays(d) {
    var out = {};
    if (d && typeof d === 'object') Object.keys(d).forEach(function (k) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number(d[k]) > 0) out[k] = Number(d[k]);
    });
    return out;
  }

  function dayKey(t) {
    var d = t ? new Date(t) : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 오늘(또는 어제)까지 며칠 연속으로 썼는지
  function streak() {
    var n = 0, t = Date.now();
    if (!state.days[dayKey(t)]) t -= 86400000; // 오늘 아직 안 썼으면 어제부터 셈
    while (state.days[dayKey(t)]) { n++; t -= 86400000; }
    return n;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function findBook(id) {
    for (var i = 0; i < state.books.length; i++) if (state.books[i].id === id) return state.books[i];
    return null;
  }

  function charLen(s) { return Array.from(s || '').length; }

  function fmtDate(t) {
    var d = new Date(t);
    var today = new Date();
    if (d.toDateString() === today.toDateString()) return '오늘';
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }

  // ───────── DOM 도우미 ─────────
  var $ = function (id) { return document.getElementById(id); };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'class') node.className = props[k];
        else if (k === 'text') node.textContent = props[k];
        else if (k === 'style') node.setAttribute('style', props[k]);
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), props[k]);
        else node.setAttribute(k, props[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // 픽셀 아이콘: 문자열 그림 → SVG. 글자 하나 = 색 하나
  function pixelIcon(rows, palette, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + rows[0].length + ' ' + rows.length);
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        var c = palette[row[x]];
        if (!c) continue;
        var r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', 1); r.setAttribute('height', 1);
        r.setAttribute('fill', c);
        svg.appendChild(r);
      }
    });
    return svg;
  }

  var ICON_STAR = ['....k....', '...kyk...', '...kyk...', 'kkkkyykkk', 'kywwyyyyk', '.kyyyyyk.', '..kyyyk..', '.kyykyyk.', 'kyk...kyk', 'kk.....kk'];
  var ICON_DROP = ['...k...', '..kbk..', '..kbk..', '.kbbbk.', 'kbwbbbk', 'kbwbbbk', 'kbbbbbk', '.kbbbk.', '..kkk..'];
  var PAL_STAR = { k: '#000000', y: '#d8a93a', w: '#f5d27a' };
  var PAL_DROP = { k: '#000000', b: '#3f6fb5', w: '#7fa8ea' };

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ───────── 효과음 (파일 없이 합성) ─────────
  var audio = null;
  function ac() {
    if (!state.sound) return null;
    if (window.GITPEN_AUDIO) return window.GITPEN_AUDIO; // 소리 녹음·검사용
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      return audio;
    } catch (e) { return null; }
  }

  // 소리 재료 1: 사인파 울림 (나무 쿵, 종 딩)
  // o = { f: 시작 주파수, to: 끝 주파수, at: 시작 시점, dur, vol, attack }
  function body(o) {
    var a = ac(); if (!a) return;
    var t0 = a.currentTime + (o.at || 0);
    var osc = a.createOscillator(), g = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol, t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(a.destination);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
  }

  // 소리 재료 2: 걸러낸 잡음 (종이, 펜촉, 바스락)
  // o = { at, dur, vol, type, f: 필터 시작, to: 필터 끝, q, attack, grain: 오돌토돌함 0~1 }
  function rustle(o) {
    var a = ac(); if (!a) return;
    var t0 = a.currentTime + (o.at || 0);
    var len = Math.max(1, Math.floor(a.sampleRate * o.dur));
    var buf = a.createBuffer(1, len, a.sampleRate);
    var d = buf.getChannelData(0);
    var grain = o.grain || 0, hold = 0, last = 0;
    for (var i = 0; i < len; i++) {
      // grain이 높을수록 소리가 툭툭 끊겨서 종이 섬유 긁히는 질감이 남
      if (hold-- <= 0) { last = Math.random() * 2 - 1; hold = grain ? Math.floor(Math.random() * grain * 40) : 0; }
      var amp = grain ? (Math.random() < 0.15 ? 1 : 0.35) : 1;
      d[i] = last * amp;
    }
    var src = a.createBufferSource(); src.buffer = buf;
    var f = a.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q || 0.9;
    f.frequency.setValueAtTime(o.f, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol, t0 + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start(t0); src.stop(t0 + o.dur + 0.02);
  }

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  var sfx = {
    // 종이 한 장 넘기기: 쓱 → 착
    page: function () {
      rustle({ dur: 0.22, vol: 0.6, f: 1200, to: 4200, q: 0.7, attack: 0.04, grain: 0.3 });
      rustle({ at: 0.16, dur: 0.07, vol: 0.4, f: 2600, q: 1.2, attack: 0.003 });
    },
    // 펜촉 사각: 글자 하나마다 아주 짧게
    pen: function () {
      rustle({ dur: rand(0.025, 0.045), vol: rand(0.08, 0.13), type: 'highpass', f: rand(4500, 6500), q: 0.6, attack: 0.002, grain: 0.6 });
    },
    // 책상에 책 내려놓기: 툭
    place: function () {
      body({ f: 150, to: 70, dur: 0.18, vol: 0.45 });
      rustle({ dur: 0.08, vol: 0.3, type: 'lowpass', f: 900, attack: 0.002 });
    },
    // 나무 도장 쿵 + 종이 눌리는 소리
    stamp: function () {
      body({ f: 110, to: 50, dur: 0.3, vol: 0.7, attack: 0.002 });
      body({ f: 420, to: 260, dur: 0.06, vol: 0.25, attack: 0.001 });
      rustle({ dur: 0.12, vol: 0.4, type: 'lowpass', f: 600, attack: 0.002 });
      rustle({ at: 0.04, dur: 0.1, vol: 0.12, f: 2200, q: 0.8, grain: 0.4 });
    },
    // 레벨 업: 작은 탁상 종 띵—
    level: function () {
      [[1046, 0], [1568, 0.14]].forEach(function (n) {
        body({ f: n[0], at: n[1], dur: 1.1, vol: 0.12, attack: 0.003 });
        body({ f: n[0] * 2.76, at: n[1], dur: 0.35, vol: 0.03, attack: 0.002 }); // 종 특유의 쇳소리 배음
      });
    },
    // 업적: 유리잔 톡톡
    achv: function () {
      body({ f: 1760, dur: 0.5, vol: 0.08, attack: 0.002 });
      body({ f: 2349, at: 0.11, dur: 0.7, vol: 0.08, attack: 0.002 });
      body({ f: 4700, at: 0.11, dur: 0.15, vol: 0.015, attack: 0.001 });
    },
    // 종이 구기기: 바스락 여러 번
    trash: function () {
      for (var i = 0; i < 6; i++) rustle({ at: i * rand(0.04, 0.07), dur: rand(0.05, 0.09), vol: rand(0.35, 0.6), f: rand(1500, 4000), q: 1.5, attack: 0.002, grain: 0.8 });
    },
    // 나무 책상 톡 (글자 제한에 막힘, 책 고르기)
    tap: function () { body({ f: rand(700, 800), to: 400, dur: 0.05, vol: 0.12, attack: 0.001 }); },
    // 책 펼치기: 표지 넘어가는 바람 + 종이 펄럭
    open: function () {
      rustle({ dur: 0.35, vol: 0.25, f: 500, to: 2500, q: 0.5, attack: 0.08 });
      rustle({ at: 0.28, dur: 0.12, vol: 0.2, f: 3000, q: 1, attack: 0.004, grain: 0.3 });
      body({ at: 0.36, f: 130, to: 80, dur: 0.12, vol: 0.2 });
    }
  };

  window.GITPEN_SFX = sfx; // 콘솔에서 GITPEN_SFX.stamp() 처럼 소리를 미리 들어볼 수 있음

  // ───────── 경험치와 레벨 ─────────
  function gainXp(amount, fromEl) {
    if (amount <= 0) return;
    state.xp += amount;
    var leveled = false;
    while (state.xp >= xpToNext(state.level)) {
      state.xp -= xpToNext(state.level);
      state.level += 1;
      leveled = true;
    }
    if (leveled) {
      sfx.level();
      toast('레벨 업! Lv.' + state.level);
      flashXp();
      if (state.level >= 5) unlock('level_5');
      if (state.level >= 10) unlock('level_10');
    }
    if (amount >= 5 && fromEl) floatXp(amount, fromEl);
    renderXp();
  }

  function floatXp(amount, fromEl) {
    if (REDUCED) return;
    var r = fromEl.getBoundingClientRect();
    var f = el('div', { class: 'xp-float', text: '+' + amount + ' 잉크' });
    f.style.left = Math.round(r.left + r.width / 2 - 30) + 'px';
    f.style.top = Math.round(r.top - 10) + 'px';
    document.body.appendChild(f);
    setTimeout(function () { f.remove(); }, 750);
  }

  function flashXp() {
    document.querySelectorAll('.xp-slot').forEach(function (s) {
      s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash');
      setTimeout(function () { s.classList.remove('flash'); }, 600);
    });
  }

  function renderXp() {
    var need = xpToNext(state.level);
    var filled = Math.floor((state.xp / need) * XP_SEGS);
    document.querySelectorAll('.xp-slot').forEach(function (slot) {
      slot.textContent = '';
      var bar = el('div', { class: 'xp-bar', role: 'progressbar', 'aria-label': '잉크 경험치', 'aria-valuemin': '0', 'aria-valuemax': String(need), 'aria-valuenow': String(state.xp) });
      for (var i = 0; i < XP_SEGS; i++) bar.appendChild(el('span', { class: i < filled ? 'on' : '' }));
      slot.appendChild(el('span', { class: 'xp-level', text: 'Lv.' + state.level }));
      slot.appendChild(pixelIcon(ICON_DROP, PAL_DROP, 'xp-drop'));
      slot.appendChild(bar);
      slot.appendChild(el('span', { class: 'xp-num', text: state.xp + ' / ' + need }));
    });
  }

  // ───────── 업적 ─────────
  function unlock(id) {
    if (state.achievements[id]) return;
    var a = null;
    for (var i = 0; i < ACHIEVEMENTS.length; i++) if (ACHIEVEMENTS[i].id === id) a = ACHIEVEMENTS[i];
    if (!a) return;
    state.achievements[id] = Date.now();
    save();
    setTimeout(function () {
      sfx.achv();
      var pop = el('div', { class: 'achv-pop' }, [
        pixelIcon(ICON_STAR, PAL_STAR, 'achv-icon'),
        el('div', null, [el('b', { text: '업적 달성!' }), el('span', { text: a.title })])
      ]);
      var area = $('achv-area');
      area.appendChild(pop);
      while (area.children.length > 3) area.removeChild(area.firstChild); // 한꺼번에 많이 풀려도 3개까지만
      setTimeout(function () { pop.remove(); }, REDUCED ? 2500 : 2900);
    }, 250);
  }

  var recentGains = [];
  function trackGain(gained) {
    // 한 번에 30자 넘게 들어온 건 붙여넣기로 보고 속필에서 뺌
    var now = Date.now();
    if (gained <= 30) recentGains.push([now, gained]);
    recentGains = recentGains.filter(function (g) { return now - g[0] < 60000; });
    var sum = recentGains.reduce(function (a, g) { return a + g[1]; }, 0);
    if (sum >= 200) unlock('speed');

    var k = dayKey(now);
    state.days[k] = (state.days[k] || 0) + gained;
    if (state.days[k] >= 2000) unlock('cram');
    var st = streak();
    if (st >= 3) unlock('streak_3');
    if (st >= 7) unlock('streak_7');
    if (st >= 30) unlock('streak_30');
  }

  function checkWritingAchievements(b) {
    var n = charLen(b.pages[current.page]);
    if (n > 0) unlock('first_ink');
    if (n >= LIMIT) unlock('full_page');
    if (n >= LIMIT && !state.sound) unlock('silent');
    if (state.totalChars >= 1000) unlock('chars_1000');
    if (state.totalChars >= 10000) unlock('chars_10000');
    var h = new Date().getHours();
    if (n > 0 && h >= 0 && h < 4) unlock('night_owl');
    if (n > 0 && h >= 5 && h < 7) unlock('early_bird');
  }

  function checkSignedAchievements() {
    var signed = state.books.filter(function (b) { return b.signed; }).length;
    if (signed >= 10) unlock('librarian');
  }

  // 서명한 책을 펼친 뒤 모든 쪽을 넘겨봤는지
  function markSeen(b) {
    if (!b || !b.signed || b.pages.length < 2) return;
    current.seen = current.seen || {};
    current.seen[current.page] = true;
    if (Object.keys(current.seen).length >= b.pages.length) unlock('read_through');
  }

  function checkBookAchievements(b) {
    if (state.books.length >= 1) unlock('first_book');
    if (state.books.length >= 5) unlock('books_5');
    if (b && b.pages.length >= 10) unlock('pages_10');
    if (b && b.pages.length >= MAX_PAGES) unlock('pages_100');
  }

  function openAchvDialog() {
    var list = $('achv-list');
    list.textContent = '';
    var got = 0;
    ACHIEVEMENTS.forEach(function (a) {
      var t = state.achievements[a.id];
      if (t) got++;
      var desc = (!t && a.hidden) ? '숨겨진 업적 · 조건은 비밀' : a.desc;
      list.appendChild(el('li', { class: 'achv-item' + (t ? '' : ' locked') }, [
        pixelIcon(ICON_STAR, PAL_STAR, 'achv-icon'),
        el('div', null, [el('b', { text: t ? a.title : '???' }), el('span', { text: desc })]),
        t ? el('span', { class: 'achv-date', text: fmtDate(t) }) : null
      ]));
    });
    var st = streak();
    $('achv-progress').textContent = got + ' / ' + ACHIEVEMENTS.length + (st ? ' · ' + st + '일 연속 필기 중' : '');
    $('achv-dialog').showModal();
  }

  // ───────── 스킨, 소리 설정 ─────────
  function applySkin(name) {
    if (SKINS.indexOf(name) < 0) name = SKINS[0];
    $('skin-css').setAttribute('href', 'skins/' + encodeURIComponent(name) + '/skin.css');
    state.skin = name;
    state.skinsUsed[name] = true;
  }

  function fillSkinSelect() {
    var sel = $('skin-select');
    sel.textContent = '';
    var NAMES = { 'default': '기본 (나무 서재)', 'night-library': '밤 도서관', 'sakura': '벚꽃', 'stone-cave': '돌 동굴', 'snow-cabin': '눈 오는 오두막' };
    SKINS.forEach(function (name) { sel.appendChild(el('option', { value: name, text: NAMES[name] || name })); });
    sel.value = state.skin;
  }

  // 스피커 아이콘 (켜짐: 소리 물결, 꺼짐: X)
  var ICON_SPK_ON = ['...k.....', '..kk..k..', 'kkwk.k.k.', 'kwwk..k.k', 'kwwk..k.k', 'kkwk.k.k.', '..kk..k..', '...k.....'];
  var ICON_SPK_OFF = ['...k.....', '..kk.....', 'kkwk.k..k', 'kwwk..kk.', 'kwwk..kk.', 'kkwk.k..k', '..kk.....', '...k.....'];

  function renderSoundBtn() {
    document.querySelectorAll('.btn-mute').forEach(function (b) {
      b.textContent = '';
      b.setAttribute('aria-pressed', String(!state.sound));
      b.setAttribute('aria-label', state.sound ? '소리 끄기 (M)' : '소리 켜기 (M)');
      b.setAttribute('title', state.sound ? '소리 끄기 (M)' : '소리 켜기 (M)');
      b.classList.toggle('muted', !state.sound);
      b.appendChild(pixelIcon(state.sound ? ICON_SPK_ON : ICON_SPK_OFF, { k: '#000000', w: '#ffffff' }, 'spk-icon'));
    });
    var pen = $('btn-pen');
    pen.setAttribute('aria-pressed', String(state.pen));
    pen.textContent = state.pen ? '펜 사각 소리 켜짐' : '펜 사각 소리 꺼짐';
    pen.disabled = !state.sound;
  }

  function toggleSound() {
    state.sound = !state.sound;
    save();
    renderSoundBtn();
    sfx.tap();
    toast(state.sound ? '소리 켜짐' : '소리 꺼짐');
  }

  // ───────── 책장 화면 ─────────
  function showShelf() {
    current.bookId = null;
    $('book-view').hidden = true;
    $('shelf-view').hidden = false;
    document.title = '깃펜노트';
    renderShelf();
    renderXp();
  }

  function renderShelf() {
    var q = $('search').value.trim().toLowerCase();
    var row = $('shelf-row');
    row.textContent = '';

    var list = state.books.filter(function (b) { return !q || b.title.toLowerCase().indexOf(q) >= 0; });

    list.forEach(function (b) {
      var height = 170 + Math.min(60, b.pages.length * 2);
      var bottom = b.signed ? el('span', { class: 'gold-tag', text: '서명' }) : el('span', { class: 'spine-band' });
      var tip = el('span', { class: 'tip', role: 'tooltip' }, [
        document.createTextNode(b.title),
        el('br'),
        el('small', { text: b.pages.length + '쪽 · ' + fmtDate(b.updatedAt) + ' 수정' + (b.signed ? ' · 잠김' : '') })
      ]);
      var spine = el('button', {
        type: 'button',
        class: 'spine tx-grain',
        style: '--c:' + b.color + ';height:' + height + 'px;width:' + (b.signed ? 72 : 64) + 'px',
        'aria-label': b.title + ' 펼치기, ' + b.pages.length + '쪽' + (b.signed ? ', 서명됨' : ''),
        'data-id': b.id
      }, [el('span', { class: 'spine-title', text: b.title }), bottom, tip]);
      spine.addEventListener('click', function () { flyOpen(spine, b); });
      row.appendChild(spine);
    });

    if (!q) {
      row.appendChild(el('button', { type: 'button', class: 'add-slot', 'aria-label': '새 책 만들기', text: '+', onclick: openNewDialog }));
    }

    $('shelf-empty').hidden = state.books.length > 0;
    renderRecent();
  }

  function renderRecent() {
    var box = $('recent-list');
    box.textContent = '';
    var recent = state.books.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 3);
    $('recent-block').hidden = recent.length === 0;

    recent.forEach(function (b) {
      var text = b.pages[b.lastPage] || '';
      box.appendChild(el('button', {
        type: 'button', class: 'note-card tx-paper',
        onclick: function () { sfx.open(); openBook(b.id, b.lastPage, true); }
      }, [
        el('span', { class: 'note-head', text: b.title + ' · ' + (b.lastPage + 1) + '쪽' }),
        el('span', { class: 'note-body', text: text.trim() ? text : '(빈 쪽)' }),
        el('span', { class: 'note-foot', text: charLen(text) + ' / ' + LIMIT + ' · ' + fmtDate(b.updatedAt) })
      ]));
    });
  }

  // 책등이 빠져나와 펼쳐지는 연출
  var flying = false;
  function flyOpen(spine, b) {
    if (flying) return;
    sfx.open();
    if (REDUCED || !spine.animate) { openBook(b.id, undefined, true); return; }
    flying = true;
    var r = spine.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var tw = Math.min(1060, vw - 40), th = Math.min(540, vh - 160);
    var tl = (vw - tw) / 2, tt = Math.max(90, (vh - th) / 2);
    var fly = el('div', { class: 'fly tx-grain', style: '--c:' + b.color });
    document.body.appendChild(fly);
    spine.style.visibility = 'hidden';
    var anim = fly.animate([
      { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' },
      { left: r.left + 'px', top: (r.top - 50) + 'px', width: r.width + 'px', height: r.height + 'px', offset: 0.35 },
      { left: (vw / 2 - 40) + 'px', top: (tt + th / 2 - 120) + 'px', width: '80px', height: '240px', offset: 0.7 },
      { left: (tl + tw / 2 - 40) + 'px', top: tt + 'px', width: '80px', height: th + 'px' }
    ], { duration: 460, easing: 'steps(9, end)', fill: 'forwards' });
    anim.onfinish = function () {
      fly.remove();
      spine.style.visibility = '';
      flying = false;
      openBook(b.id, undefined, true);
    };
  }

  // ───────── 새 책 ─────────
  function openNewDialog() {
    var list = $('color-list');
    list.textContent = '';
    var pick = COLORS[state.books.length % COLORS.length];
    COLORS.forEach(function (c, i) {
      var input = el('input', { type: 'radio', name: 'color', value: c, 'aria-label': '표지 색 ' + (i + 1) });
      if (c === pick) input.checked = true;
      list.appendChild(el('label', { class: 'swatch' }, [input, el('span', { style: '--c:' + c })]));
    });
    $('new-title').value = '';
    $('new-dialog').showModal();
    $('new-title').focus();
  }

  $('new-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('new-title').value.trim();
    if (!title) { $('new-title').focus(); return; }
    var picked = document.querySelector('#color-list input:checked');
    var now = Date.now();
    var book = {
      id: newId(), title: title.slice(0, 16),
      color: picked ? picked.value : COLORS[0],
      pages: [''], best: [0], signed: false, createdAt: now, updatedAt: now, lastPage: 0
    };
    state.books.push(book);
    save();
    $('new-dialog').close();
    sfx.place();
    openBook(book.id, 0, true);
    gainXp(XP_NEW_BOOK, $('book-title'));
    checkBookAchievements(book);
    save();
  });

  // ───────── 필기 화면 ─────────
  function openBook(id, page, animate) {
    var b = findBook(id);
    if (!b) return;
    current.bookId = id;
    current.page = typeof page === 'number' ? page : b.lastPage;
    current.page = Math.min(Math.max(0, current.page), b.pages.length - 1);
    current.seen = {};
    markSeen(b);
    $('shelf-view').hidden = true;
    $('book-view').hidden = false;
    $('stamp').classList.remove('pop');
    renderBook();
    renderXp();
    var book = document.querySelector('.book');
    if (animate && !REDUCED) {
      book.classList.remove('opening'); void book.offsetWidth; book.classList.add('opening');
    }
    if (!b.signed) {
      var ed = $('editor');
      ed.focus();
      ed.setSelectionRange(ed.value.length, ed.value.length);
    }
  }

  function renderBook() {
    var b = findBook(current.bookId);
    if (!b) return showShelf();
    var i = current.page;

    $('book-title').textContent = b.title;
    $('book-meta').textContent = b.pages.length + '쪽 · ' + fmtDate(b.createdAt) + ' 시작';
    document.title = b.title + ' · 깃펜노트';

    var left = $('left-text');
    if (i === 0) {
      $('left-no').textContent = '속표지';
      left.textContent = b.title + '\n\n' + fmtDate(b.createdAt) + '에 시작한 책\n\n첫 쪽은 오른쪽에서 시작돼.';
      left.classList.add('empty');
    } else {
      $('left-no').textContent = i + '쪽';
      left.textContent = b.pages[i - 1] || '(빈 쪽)';
      left.classList.toggle('empty', !b.pages[i - 1]);
    }

    var ed = $('editor');
    ed.value = b.pages[i];
    ed.readOnly = b.signed;
    $('right-no').textContent = (i + 1) + '쪽';
    $('right-state').textContent = b.signed ? '서명됨 · 읽기 전용' : '쓰는 중';
    applyLimit();
    renderCount();

    $('page-pos').textContent = (i + 1) + ' / ' + b.pages.length;
    $('btn-prev').disabled = i === 0;
    $('btn-next').disabled = i >= b.pages.length - 1;
    $('btn-add-page').disabled = b.signed || b.pages.length >= MAX_PAGES;
    $('btn-sign').hidden = b.signed;
    $('signed-badge').hidden = !b.signed;
    $('btn-limit').disabled = b.signed;
    $('btn-limit').setAttribute('aria-pressed', String(state.limitOn));
    $('stamp').classList.toggle('show', b.signed);
  }

  function applyLimit() {
    var b = findBook(current.bookId);
    var ed = $('editor');
    if (state.limitOn && b && !b.signed) ed.setAttribute('maxlength', String(LIMIT));
    else ed.removeAttribute('maxlength');
  }

  function renderCount() {
    var n = charLen($('editor').value);
    var over = state.limitOn && n > LIMIT;
    var count = $('count');
    count.textContent = n + ' / ' + LIMIT;
    count.classList.toggle('over', over);

    var gauge = $('gauge');
    gauge.textContent = '';
    var filled = Math.min(GAUGE_SEGS, Math.ceil((n / LIMIT) * GAUGE_SEGS));
    for (var s = 0; s < GAUGE_SEGS; s++) gauge.appendChild(el('span', { class: s < filled ? (over ? 'over' : 'on') : '' }));
  }

  var penAt = 0;
  $('editor').addEventListener('input', function () {
    var b = findBook(current.bookId);
    if (!b || b.signed) return;
    var i = current.page;
    if (state.pen) {
      var now = Date.now();
      if (now - penAt > 45) { penAt = now; sfx.pen(); }
    }
    b.pages[i] = this.value;
    b.updatedAt = Date.now();
    b.lastPage = i;
    var n = charLen(this.value);
    var gained = Math.max(0, n - (b.best[i] || 0));
    if (gained) {
      b.best[i] = n;
      state.totalChars += gained;
      gainXp(gained);
      trackGain(gained);
    }
    checkWritingAchievements(b);
    save();
    renderCount();
  });

  // 입력 중 글자 제한에 막혔을 때 툭 소리
  $('editor').addEventListener('beforeinput', function (e) {
    if (!state.limitOn || this.readOnly) return;
    if (e.inputType && e.inputType.indexOf('insert') === 0 && charLen(this.value) >= LIMIT && this.selectionStart === this.selectionEnd) sfx.tap();
  });

  function turnAnim() {
    if (REDUCED) return;
    var p = document.querySelector('.book .page:not(.old)');
    p.classList.remove('turn'); void p.offsetWidth; p.classList.add('turn');
  }

  function goPage(delta) {
    var b = findBook(current.bookId);
    if (!b) return;
    var next = current.page + delta;
    if (next < 0 || next >= b.pages.length) return;
    current.page = next;
    b.lastPage = next;
    markSeen(b);
    save();
    sfx.page();
    renderBook();
    turnAnim();
    if (!b.signed) $('editor').focus();
  }

  function addPage() {
    var b = findBook(current.bookId);
    if (!b || b.signed) return;
    if (b.pages.length >= MAX_PAGES) { toast('이 책은 ' + MAX_PAGES + '쪽이 꽉 찼어. 새 책을 만들어줘.'); return; }
    b.pages.splice(current.page + 1, 0, '');
    b.best.splice(current.page + 1, 0, 0);
    current.page += 1;
    b.lastPage = current.page;
    b.updatedAt = Date.now();
    sfx.page();
    renderBook();
    turnAnim();
    gainXp(XP_NEW_PAGE, $('page-pos'));
    checkBookAchievements(b);
    save();
    $('editor').focus();
  }

  function toggleLimit() {
    var b = findBook(current.bookId);
    if (b && b.signed) return;
    state.limitOn = !state.limitOn;
    save();
    applyLimit();
    renderBook();
    sfx.tap();
    toast(state.limitOn ? '글자 제한 켜짐 (' + LIMIT + '자)' : '글자 제한 꺼짐');
  }

  // ───────── 서명 ─────────
  function openSignDialog() {
    var b = findBook(current.bookId);
    if (!b || b.signed) return;
    $('sign-title').value = b.title;
    $('sign-dialog').showModal();
    $('sign-title').select();
  }

  $('sign-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var b = findBook(current.bookId);
    var title = $('sign-title').value.trim();
    if (!b || !title) return;
    b.title = title.slice(0, 16);
    b.signed = true;
    b.updatedAt = Date.now();
    $('sign-dialog').close();
    renderBook();
    var stamp = $('stamp');
    stamp.classList.remove('pop');
    void stamp.offsetWidth;
    stamp.classList.add('pop');
    sfx.stamp();
    toast('서명 완료. 이제 이 책은 잠겼어.');
    setTimeout(function () {
      gainXp(XP_SIGN, stamp);
      unlock('first_sign');
      checkSignedAchievements();
      save();
    }, 420);
    save();
  });

  function deleteBook() {
    var b = findBook(current.bookId);
    if (!b) return;
    if (!window.confirm('"' + b.title + '" 책을 버릴까? 되돌릴 수 없어.')) return;
    state.books = state.books.filter(function (x) { return x.id !== b.id; });
    state.deleted[b.id] = Date.now();
    save();
    sfx.trash();
    showShelf();
    toast('책을 버렸어.');
  }

  // ───────── 백업 ─────────
  function exportBackup() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var d = new Date();
    var name = 'gitpen-backup-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast('백업 파일을 저장했어.');
  }

  $('import-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = sanitize(JSON.parse(reader.result)); } catch (e) { data = null; }
      if (!data) { toast('깃펜노트 백업 파일이 아니야.'); return; }
      if (!window.confirm('백업의 책 ' + data.books.length + '권으로 지금 책장을 바꿀까? 지금 책장은 사라져.')) return;
      state = data;
      applySkin(state.skin);
      fillSkinSelect();
      renderSoundBtn();
      save();
      showShelf();
      toast('백업을 불러왔어.');
    };
    reader.readAsText(file);
  });

  // ───────── 버튼 연결 ─────────
  $('btn-new-book').addEventListener('click', openNewDialog);
  $('btn-back').addEventListener('click', showShelf);
  $('btn-prev').addEventListener('click', function () { goPage(-1); });
  $('btn-next').addEventListener('click', function () { goPage(1); });
  $('btn-add-page').addEventListener('click', addPage);
  $('btn-limit').addEventListener('click', toggleLimit);
  $('btn-sign').addEventListener('click', openSignDialog);
  $('btn-delete').addEventListener('click', deleteBook);
  $('btn-export').addEventListener('click', exportBackup);
  $('btn-import').addEventListener('click', function () { $('import-file').click(); });
  $('btn-achv').addEventListener('click', openAchvDialog);
  document.querySelectorAll('.btn-mute').forEach(function (b) { b.addEventListener('click', toggleSound); });
  $('btn-pen').addEventListener('click', function () {
    state.pen = !state.pen;
    save();
    renderSoundBtn();
    if (state.pen) sfx.pen();
  });
  $('search').addEventListener('input', renderShelf);
  $('skin-select').addEventListener('change', function () {
    applySkin(this.value);
    sfx.tap();
    if (SKINS.length > 1 && SKINS.every(function (n) { return state.skinsUsed[n]; })) unlock('explorer');
    save();
  });
  document.querySelectorAll('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { btn.closest('dialog').close(); });
  });

  // ───────── 단축키 ─────────
  function typingTarget(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }

  document.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    var mod = e.ctrlKey || e.metaKey;
    var inBook = !$('book-view').hidden;

    // 소리 끄기/켜기: 어디서든 Alt+M, 글 쓰는 칸 밖에서는 M만 눌러도 됨
    if ((e.altKey && (e.key === 'm' || e.key === 'M' || e.key === 'ㅡ')) ||
        (!mod && !e.altKey && !typingTarget(e.target) && (e.key === 'm' || e.key === 'M' || e.key === 'ㅡ'))) {
      e.preventDefault(); toggleSound(); return;
    }

    if (inBook) {
      if (mod && (e.key === 's' || e.key === 'S' || e.key === 'ㄴ')) { e.preventDefault(); openSignDialog(); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); addPage(); return; }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goPage(-1); return; }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goPage(1); return; }
      if (e.key === 'Escape' || (e.altKey && e.key === 'ArrowUp')) { e.preventDefault(); showShelf(); return; }
      return;
    }

    if (e.target === $('search')) {
      if (e.key === 'Escape') { $('search').value = ''; renderShelf(); $('search').blur(); }
      if (e.key === 'Enter') {
        var first = document.querySelector('#shelf-row .spine');
        if (first) first.click();
      }
      return;
    }
    if (typingTarget(e.target) || mod || e.altKey) return;

    if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') { e.preventDefault(); openNewDialog(); return; }
    if (e.key === '/') { e.preventDefault(); $('search').focus(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      var spines = Array.prototype.slice.call(document.querySelectorAll('#shelf-row .spine'));
      if (!spines.length) return;
      var idx = spines.indexOf(document.activeElement);
      if (idx < 0) idx = e.key === 'ArrowRight' ? -1 : spines.length;
      idx += e.key === 'ArrowRight' ? 1 : -1;
      idx = Math.max(0, Math.min(spines.length - 1, idx));
      spines[idx].focus();
      sfx.tap();
      e.preventDefault();
    }
  });

  // ───────── 터치: 책을 좌우로 밀어서 쪽 넘기기 ─────────
  (function () {
    var book = document.querySelector('.book');
    var sx = 0, sy = 0, st = 0, tracking = false;
    book.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      tracking = true; sx = e.clientX; sy = e.clientY; st = Date.now();
    });
    book.addEventListener('pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      // 빠르고 확실하게 옆으로 민 경우만 (글자 선택하려는 드래그와 구분)
      if (Date.now() - st < 600 && Math.abs(dx) > 70 && Math.abs(dy) < 50) goPage(dx < 0 ? 1 : -1);
    });
    book.addEventListener('pointercancel', function () { tracking = false; });
  })();

  // ───────── 동기화 연결 고리 (sync.js가 씀) ─────────
  // 다른 기기에서 받아온 데이터를 화면을 깨지 않게 반영
  function applySynced(data) {
    var clean = sanitize(data);
    if (!clean) return;
    var before = JSON.stringify(state.books);
    state.books = clean.books;
    state.deleted = clean.deleted;
    state.xp = clean.xp;
    state.level = clean.level;
    state.totalChars = clean.totalChars;
    state.achievements = clean.achievements;
    state.days = clean.days;
    save(true);
    if (JSON.stringify(state.books) === before) { renderXp(); return; }

    if ($('book-view').hidden) {
      renderShelf();
    } else {
      var b = findBook(current.bookId);
      if (!b) { showShelf(); toast('다른 기기에서 이 책을 버렸어.'); return; }
      current.page = Math.min(current.page, b.pages.length - 1);
      var ed = $('editor');
      var changed = ed.value !== b.pages[current.page];
      var focused = document.activeElement === ed;
      renderBook();
      if (changed && focused) ed.setSelectionRange(ed.value.length, ed.value.length);
      if (changed) toast('다른 기기에서 쓴 내용을 받아왔어.');
    }
    renderXp();
  }

  window.GitpenApp = {
    // 동기화할 부분만 (스킨, 소리 같은 기기별 설정은 빼고)
    getData: function () {
      return {
        books: state.books, deleted: state.deleted,
        xp: state.xp, level: state.level, totalChars: state.totalChars,
        achievements: state.achievements, days: state.days
      };
    },
    applySynced: applySynced,
    toast: function (m) { toast(m); }
  };

  // ───────── 시작 ─────────
  applySkin(state.skin);
  fillSkinSelect();
  renderSoundBtn();
  save(); // 예전 형식 데이터를 새 형식으로 바로 저장
  showShelf();
})();
