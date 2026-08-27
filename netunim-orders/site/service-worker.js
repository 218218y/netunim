'use strict';
const CACHE='orders-app-shell-v7-network-first';
const SHELL=['./','./index.html','./manifest.webmanifest','./supabase/config.js','./favicon.ico','./favicon-16x16.png','./favicon-32x32.png','./apple-touch-icon.png','./android-chrome-192x192.png','./android-chrome-512x512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  // Network-first prevents a previously installed PWA from keeping stale HTML,
  // config or icons after a deployment. Offline remains fully supported by the
  // verified app-shell cache and navigation fallback.
  event.respondWith(
    fetch(event.request).then(response=>{
      if(response.ok){
        const copy=response.clone();
        event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
      }
      return response;
    }).catch(async()=>{
      const cached=await caches.match(event.request);
      if(cached)return cached;
      if(event.request.mode==='navigate')return caches.match('./index.html');
      throw new Error('offline_and_not_cached');
    })
  );
});
