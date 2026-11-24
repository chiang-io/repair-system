'use strict';
// 舊版報修系統曾註冊 Service Worker 並快取首頁。此檔僅用來清除舊快取並解除註冊，
// 讓已安裝過的瀏覽器改從網路載入貨櫃裝箱模擬。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('repair-shell-')).map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => client.navigate(client.url));
  })());
});
