/* NVP Operasional — service worker: bisa dibuka offline + notifikasi HP (tampil walau layar terkunci) */
// Versi diisi otomatis saat build (berubah setiap ada pembaruan) → HP memasang versi baru sendiri
const VERSI = '20261012-9ae7b4f0';
const CACHE = 'nvp-ops-' + VERSI;
const FILES = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', '../config.js', 'vendor/react.production.min.js', 'vendor/react-dom.production.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png', 'icons/apple-touch-icon.png'];
const SIMPAN = ['nvp-ops-meta', 'nvp-ops-berkas']; // jangan dihapus saat pembaruan

self.addEventListener('install', (e) => {
  // unduh semua berkas versi baru (melewati cache browser), lalu langsung aktif
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && SIMPAN.indexOf(k) < 0).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname === new URL('../config.js', self.registration.scope).pathname) {
    // pengaturan website: jaringan dulu (maks. 2,5 detik), cadangan dari HP
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
      try { const res = await Promise.race([net, new Promise(r => setTimeout(r, 2500, null))]); if (res) return res; } catch (err) {}
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit || net;
    })());
    return;
  }
  // berkas aplikasi: langsung dari HP (cepat & bisa offline); versi baru datang lewat pembaruan service worker
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    try { const res = await fetch(req); if (res.ok && url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) cache.put(req, res.clone()); return res; }
    catch (err) { return (await cache.match('index.html')) || Response.error(); }
  })());
});

// ---- Notifikasi dari server (Web Push). Server hanya mengirim "ketukan";
// isi pesannya diambil dari server memakai kode perangkat yang tersimpan di HP.
async function bacaMeta() {
  try { const c = await caches.open('nvp-ops-meta'); const r = await c.match(new Request('/__nvp_meta')); return r ? await r.json() : null; } catch (e) { return null; }
}
function opsiNotif(item) {
  return {
    body: item.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: 'nvp-' + (item.id || Date.now()),
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200, 100, 200],
    timestamp: Date.now(),
    data: { url: './#/' + (item.link || '') },
  };
}
async function tanganiPush() {
  let items = [];
  const meta = await bacaMeta();
  if (meta && meta.api && meta.pushToken) {
    try {
      const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(meta.api, { method: 'POST', body: JSON.stringify({ action: 'opsInbox', pushToken: meta.pushToken }), signal: ctrl.signal });
      clearTimeout(tm);
      const r = await res.json();
      if (r && r.ok) items = r.items || [];
    } catch (e) {}
  }
  if (!items.length) items = [{ id: 'umum', title: 'NVP Operasional', body: 'Ada pemberitahuan baru. Ketuk untuk membuka.', link: '' }];
  await Promise.all(items.map(it => self.registration.showNotification(it.title || 'NVP Operasional', opsiNotif(it))));
  // beri tahu aplikasi yang sedang terbuka agar mengambil data terbaru
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach(c => c.postMessage({ type: 'refresh' }));
}
self.addEventListener('push', (e) => { e.waitUntil(tanganiPush()); });

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.postMessage({ open: url }); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

// Langganan push diperbarui otomatis oleh browser → daftarkan ulang ke server
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const meta = await bacaMeta();
    if (!meta || !meta.api || !meta.pushToken || !meta.key) return;
    const raw = atob((meta.key + '='.repeat((4 - meta.key.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
    await fetch(meta.api, { method: 'POST', body: JSON.stringify({ action: 'opsSubscribe', pushToken: meta.pushToken, sub: sub.toJSON() }) });
  })().catch(() => {}));
});
