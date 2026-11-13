/* Red Run Rally: offline support.
   The page comes from the network when there is one, so a new version shows on the next open.
   With no network (or a slow one) the copy saved on the phone is used. */
const CACHE = 'red-run-rally-v1';
const CORE = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const FONT_CSS = ["https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Nunito:wght@600;800&display=swap"];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    await saveFonts(cache).catch(() => {});
    await self.skipWaiting();
  })());
});

/* Save the font style sheet and the font files it names. If this fails, the system font is used. */
async function saveFonts(cache) {
  for (const url of FONT_CSS) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const css = await res.clone().text();
    await cache.put(url, res);
    const files = [...new Set((css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || []))];
    await Promise.all(files.map(f => cache.match(f).then(hit => hit || fetch(f).then(r => { if (r.ok) return cache.put(f, r); })).catch(() => {})));
  }
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('red-run-rally-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)); }

/* A response that followed a redirect cannot answer a page load. Make a clean copy. */
function clean(res) {
  return res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
}

async function pageFirstFromNetwork(request) {
  const cache = await caches.open(CACHE);
  const saved = async () => (await cache.match(request, { ignoreSearch: true })) || (await cache.match('./'));
  const fromNet = fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (!res.ok) throw new Error('status ' + res.status);
    cache.put('./', clean(res.clone()));
    return clean(res);
  });
  fromNet.catch(() => {});
  try {
    return await Promise.race([fromNet, timeout(4000)]);
  } catch (e) {
    const hit = await saved();
    if (hit) return hit;
    return fromNet.catch(() => Response.error());
  }
}

async function cacheFirst(request, refresh) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  const fromNet = () => fetch(request).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()); return res; });
  if (hit) { if (refresh) fromNet().catch(() => {}); return hit; }
  return fromNet();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) { event.respondWith(cacheFirst(req, false)); return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (req.mode === 'navigate') { event.respondWith(pageFirstFromNetwork(req)); return; }
  event.respondWith(cacheFirst(req, true));
});
