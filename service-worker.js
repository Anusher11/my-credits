/* Service worker: офлайн-кэш приложения «Мои кредиты».
   Стратегия: для самой страницы — «сначала сеть» (чтобы обновления
   появлялись сразу), для иконок/шрифтов — «сначала кэш» (быстро). */
const CACHE = 'moi-krediti-v2';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isPageRequest(req) {
  if (req.mode === 'navigate') return true;
  const url = new URL(req.url);
  return url.origin === location.origin &&
         (url.pathname.endsWith('/') || url.pathname.endsWith('.html'));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Страница приложения — сначала свежая из сети, кэш только запасной (офлайн)
  if (isPageRequest(req)) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // Остальное (иконки, шрифты) — сначала кэш, затем сеть
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        try {
          const url = new URL(req.url);
          if (url.origin === location.origin ||
              url.host.endsWith('gstatic.com') ||
              url.host.endsWith('googleapis.com')) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
        } catch (_) {}
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
