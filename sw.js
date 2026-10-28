// 깃펜노트 오프라인 지원
// 앱 파일을 기기에 담아두고, 인터넷이 없어도 열리게 함.
// 앱을 고친 뒤 올릴 때는 VERSION 숫자를 하나 올려야 새 파일로 바뀜.
var VERSION = 'gitpen-v5';
var SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'sync.js',
  'config.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'skins/default/skin.css',
  'skins/default/Galmuri11.woff2',
  'skins/default/Galmuri11-Bold.woff2',
  'skins/default/wall.png',
  'skins/default/plank.png',
  'skins/default/paper.png',
  'skins/default/cover.png',
  'skins/default/grain.png',
  'skins/night-library/skin.css',
  'skins/night-library/wall.png',
  'skins/night-library/plank.png',
  'skins/night-library/paper.png',
  'skins/night-library/cover.png',
  'skins/night-library/grain.png',
  'skins/sakura/skin.css',
  'skins/sakura/wall.png',
  'skins/sakura/plank.png',
  'skins/sakura/paper.png',
  'skins/sakura/cover.png',
  'skins/sakura/grain.png',
  'skins/stone-cave/skin.css',
  'skins/stone-cave/wall.png',
  'skins/stone-cave/plank.png',
  'skins/stone-cave/paper.png',
  'skins/stone-cave/cover.png',
  'skins/stone-cave/grain.png',
  'skins/snow-cabin/skin.css',
  'skins/snow-cabin/wall.png',
  'skins/snow-cabin/plank.png',
  'skins/snow-cabin/paper.png',
  'skins/snow-cabin/cover.png',
  'skins/snow-cabin/grain.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// 같은 사이트 파일만: 담아둔 걸 바로 주고, 뒤에서 새 버전을 받아 갈아둠
// GitHub API(동기화)는 건드리지 않음
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
