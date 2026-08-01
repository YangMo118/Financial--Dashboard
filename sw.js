// Service Worker for financial-dashboard PWA
// Strategy:
//   - HTML pages: network-first, cache fallback (always fresh when online)
//   - Static assets (JS/CSS/icons): cache-first, background update (fast load)
//   - API requests: network-first, short cache fallback (fresh data preferred)

var CACHE_VERSION = 'fin-dashboard-v1-1-6';
var CACHE_STATIC = CACHE_VERSION + '-static';
var CACHE_RUNTIME = CACHE_VERSION + '-runtime';

// Static assets to pre-cache on install
var PRE_CACHE_URLS = [
  './',
  './financial-dashboard.html',
  './favicon.svg',
  './favicon-32.png',
  './apple-touch-icon.png'
];

// Files that match these patterns are considered static assets
var STATIC_PATTERNS = [/\.svg$/, /\.png$/, /\.ico$/, /\.css$/, /\.js$/];

// Install: pre-cache static assets
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache){
      return Promise.all(
        PRE_CACHE_URLS.map(function(url){
          return cache.add(url).catch(function(){ return; });
        })
      );
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(
        names.filter(function(name){
          return name.indexOf(CACHE_VERSION) !== 0; // delete old versions
        }).map(function(name){
          return caches.delete(name);
        })
      );
    }).then(function(){
      return self.clients.claim();
    })
  );
});

// Check if a URL is a static asset
function isStaticAsset(url){
  return STATIC_PATTERNS.some(function(p){ return p.test(url.pathname); });
}

// Check if a URL is an API request (cross-origin to eastmoney/tencent/etc.)
function isApiRequest(url){
  return url.origin !== self.location.origin;
}

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);

  // Only handle GET requests
  if(e.request.method !== 'GET') return;

  // === API requests: network-first with short cache fallback ===
  if(isApiRequest(url)){
    e.respondWith(
      fetch(e.request).then(function(resp){
        // Cache successful API responses briefly (for offline fallback)
        if(resp && resp.status === 200){
          var respClone = resp.clone();
          caches.open(CACHE_RUNTIME).then(function(cache){
            cache.put(e.request, respClone);
            // Clean up old runtime cache entries (keep only last 50)
            cache.keys().then(function(keys){
              if(keys.length > 50){
                keys.slice(0, keys.length - 50).forEach(function(key){
                  cache.delete(key);
                });
              }
            });
          });
        }
        return resp;
      }).catch(function(){
        // Offline: try cached API response
        return caches.match(e.request).then(function(cached){
          if(cached) return cached;
          return new Response('{"error":"offline"}', {status: 503, statusText: 'Offline', headers:{'Content-Type':'application/json'}});
        });
      })
    );
    return;
  }

  // === HTML pages: network-first, cache fallback ===
  if(e.request.mode === 'navigate' || (e.request.headers.get('accept') && e.request.headers.get('accept').indexOf('text/html') !== -1)){
    e.respondWith(
      fetch(e.request).then(function(resp){
        if(resp && resp.status === 200){
          var respClone = resp.clone();
          caches.open(CACHE_STATIC).then(function(cache){
            cache.put(e.request, respClone);
          });
        }
        return resp;
      }).catch(function(){
        // Offline: return cached page
        return caches.match(e.request).then(function(cached){
          if(cached) return cached;
          return caches.match('./financial-dashboard.html');
        });
      })
    );
    return;
  }

  // === Static assets: cache-first, background update ===
  if(isStaticAsset(url)){
    e.respondWith(
      caches.match(e.request).then(function(cached){
        if(cached){
          // Update cache in background
          fetch(e.request).then(function(resp){
            if(resp && resp.status === 200){
              caches.open(CACHE_STATIC).then(function(cache){
                cache.put(e.request, resp.clone());
              });
            }
          }).catch(function(){ /* offline, keep cached */ });
          return cached;
        }
        // Not cached, try network
        return fetch(e.request).then(function(resp){
          if(!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
          var respClone = resp.clone();
          caches.open(CACHE_STATIC).then(function(cache){
            cache.put(e.request, respClone);
          });
          return resp;
        }).catch(function(){
          return new Response('', {status: 503, statusText: 'Offline'});
        });
      })
    );
    return;
  }

  // === Other same-origin requests: cache-first with network fallback ===
  e.respondWith(
    caches.match(e.request).then(function(cached){
      if(cached) return cached;
      return fetch(e.request).then(function(resp){
        if(!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        var respClone = resp.clone();
        caches.open(CACHE_RUNTIME).then(function(cache){
          cache.put(e.request, respClone);
        });
        return resp;
      }).catch(function(){
        return new Response('', {status: 503, statusText: 'Offline'});
      });
    })
  );
});
