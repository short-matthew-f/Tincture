// Tincture — sw.js
// Dependency-free service worker: installs the app shell so the game runs with
// no network at all. Same pattern as the author's other games (gravity-well).
//
// tools/bump-version.js rewrites CACHE_VERSION and the SHELL list below (it
// globs index.html, style.css, manifest.webmanifest, version.json, icons/* and
// src/**/*.js). Do not hand-edit those two blocks.
//
// Update flow: a new version installs in the background into its own cache and
// WAITS. It only takes over when the page posts {type:'SKIP_WAITING'} (the
// "Restart" button in Settings), so the game never reloads mid-session. On
// activate, clients.claim() hands open pages to the new worker and every old
// tincture-v* cache is deleted.
//
// Strategy:
//   navigations + .js/.css/.html/.webmanifest/.json   network-first, cache fallback
//   version.json                                      network only (an offline
//                                                     check must say "offline",
//                                                     not echo a stale cache)
//   icons/                                            cache-first
//   Google Fonts (cross-origin css + font files)      cache-first, runtime-cached
//                                                     in tincture-fonts so fonts
//                                                     persist offline after the
//                                                     first online load
//   any other cross-origin request, non-GET           ignored

var CACHE_VERSION = '0.1.0';
var CACHE_NAME = 'tincture-v' + CACHE_VERSION;
var FONT_CACHE = 'tincture-fonts';

var SHELL = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'version.json',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512-maskable.png',
  'icons/icon-512.png',
  'icons/icon.svg',
  'src/app.js',
  'src/color.js',
  'src/content/apprentices.js',
  'src/content/canvases.js',
  'src/content/catalog.js',
  'src/content/commissions.js',
  'src/content/eras.js',
  'src/content/events.js',
  'src/content/heritage.js',
  'src/content/hunters.js',
  'src/content/names.js',
  'src/content/pigments.js',
  'src/content/postcards.js',
  'src/content/quests.js',
  'src/content/regions.js',
  'src/content/rooms.js',
  'src/content/routes.js',
  'src/content/sources.js',
  'src/content/stations.js',
  'src/format.js',
  'src/game.js',
  'src/puzzles/grading.js',
  'src/puzzles/index.js',
  'src/puzzles/matching.js',
  'src/puzzles/packing.js',
  'src/puzzles/purify.js',
  'src/pwa.js',
  'src/rng.js',
  'src/sim/bus.js',
  'src/sim/closeUp.js',
  'src/sim/commissions.js',
  'src/sim/discovery.js',
  'src/sim/economy.js',
  'src/sim/events.js',
  'src/sim/factory.js',
  'src/sim/gallery.js',
  'src/sim/hunters.js',
  'src/sim/index.js',
  'src/sim/ledger.js',
  'src/sim/offline.js',
  'src/sim/orders.js',
  'src/sim/prestige.js',
  'src/sim/quests.js',
  'src/sim/settings.js',
  'src/sim/shelf.js',
  'src/sim/shipping.js',
  'src/sim/storage.js',
  'src/state.js',
  'src/ui/album.js',
  'src/ui/audio.js',
  'src/ui/bench.js',
  'src/ui/catalog.js',
  'src/ui/commissions.js',
  'src/ui/fx.js',
  'src/ui/gallery.js',
  'src/ui/grading.js',
  'src/ui/haptics.js',
  'src/ui/heritage.js',
  'src/ui/hunter.js',
  'src/ui/kit.js',
  'src/ui/ledger.js',
  'src/ui/map.js',
  'src/ui/matching.js',
  'src/ui/naming.js',
  'src/ui/onboarding.js',
  'src/ui/orders.js',
  'src/ui/overlay.js',
  'src/ui/packing.js',
  'src/ui/paint.js',
  'src/ui/phase-beat.js',
  'src/ui/purify.js',
  'src/ui/puzzles.js',
  'src/ui/quests.js',
  'src/ui/router.js',
  'src/ui/settings.js',
  'src/ui/shelf.js',
  'src/ui/workshop.js',
  'src/version.js'
];

self.addEventListener('install', function (event) {
  // No skipWaiting() here: the new worker waits for the player's Restart tap.
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // addAll() is all-or-nothing; request each file so one missing optional
      // asset cannot wedge the whole install.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' }))['catch'](function () { /* skip */ });
      }));
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME && key.indexOf('tincture-v') === 0) return caches['delete'](key);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isIcon(url) {
  return url.pathname.indexOf('/icons/') !== -1;
}

function isCode(url) {
  return /\.(?:js|mjs|css|webmanifest|html|json)$/.test(url.pathname);
}

function isVersionFile(url) {
  return /\/version\.json$/.test(url.pathname);
}

function isFontHost(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

function putInCache(cacheName, request, response, allowOpaque) {
  if (!response) return response;
  var ok = response.ok || (allowOpaque && response.type === 'opaque');
  if (!ok) return response;
  var copy = response.clone();
  caches.open(cacheName).then(function (cache) { cache.put(request, copy); });
  return response;
}

function networkFirst(request) {
  return fetch(request)
    .then(function (response) { return putInCache(CACHE_NAME, request, response, false); })
    ['catch'](function () {
      return caches.match(request).then(function (hit) {
        if (hit) return hit;
        // A navigation to any in-scope URL falls back to the app shell.
        if (request.mode === 'navigate') {
          return caches.match('./', { ignoreSearch: true }).then(function (shell) {
            return shell || caches.match('index.html', { ignoreSearch: true });
          }).then(function (shell) { return shell || Response.error(); });
        }
        return Response.error();
      });
    });
}

function cacheFirst(request, cacheName, allowOpaque) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (response) {
      return putInCache(cacheName, request, response, allowOpaque);
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  if (url.origin !== self.location.origin) {
    if (isFontHost(url)) event.respondWith(cacheFirst(request, FONT_CACHE, true));
    return; // every other cross-origin request goes straight to the network
  }

  if (isVersionFile(url)) return; // network only: let the browser handle it

  if (request.mode === 'navigate' || isCode(url)) {
    event.respondWith(networkFirst(request));
  } else if (isIcon(url)) {
    event.respondWith(cacheFirst(request, CACHE_NAME, false));
  } else {
    event.respondWith(
      fetch(request)['catch'](function () {
        return caches.match(request).then(function (hit) { return hit || Response.error(); });
      })
    );
  }
});
