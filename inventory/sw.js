'use strict';
// 庫存查詢的離線快取：頁面先試網路（拿到最新版），沒網路時用快取。
// 讀檔工具（pdf.js、SheetJS）與字型第一次用到時存起來，之後沒網路也能匯入。
const CACHE = 'inventory-v8';
const SHELL = ['./', './index.html', './common.js?v=6', './config.js?v=6', './upload.html', './manifest.webmanifest', './icons/icon-192.png', './icons/favicon-32.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('inventory-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const lib = /^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (!sameOrigin && !lib) return;
  if (sameOrigin && !url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  // 資料檔由頁面自己處理（解密後存在手機），不經過快取，才會拿到最新的
  if (sameOrigin && url.pathname.endsWith('/inventory-data.json')) return;
  if (lib) {
    // 版本固定的外部檔案：有快取就用快取
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
