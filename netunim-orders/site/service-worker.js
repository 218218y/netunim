'use strict';
const CACHE_PREFIX='orders-app-shell-';
const CACHE='orders-app-shell-esm-fd2bf1fda7ef';
const SHELL=[
  './',
  './index.html',
  './assets/app.css',
  './assets/app.js',
  './assets/js/cloud/auth.js',
  './assets/js/cloud/transport.js',
  './assets/js/core/dates.js',
  './assets/js/core/money.js',
  './assets/js/core/values.js',
  './assets/js/domains/bank/cache.js',
  './assets/js/domains/bank/readout.js',
  './assets/js/domains/bank/selectors.js',
  './assets/js/domains/checks/editor.js',
  './assets/js/domains/checks/model.js',
  './assets/js/domains/checks/view.js',
  './assets/js/domains/customers/bulk.js',
  './assets/js/domains/customers/editor.js',
  './assets/js/domains/customers/model.js',
  './assets/js/domains/customers/selectors.js',
  './assets/js/domains/customers/view.js',
  './assets/js/domains/dashboard/view.js',
  './assets/js/domains/inventory/editor.js',
  './assets/js/domains/inventory/model.js',
  './assets/js/domains/inventory/order.js',
  './assets/js/domains/inventory/selectors.js',
  './assets/js/domains/inventory/view.js',
  './assets/js/domains/notes/controller.js',
  './assets/js/domains/service/bulk.js',
  './assets/js/domains/service/editor.js',
  './assets/js/domains/service/model.js',
  './assets/js/domains/service/view.js',
  './assets/js/domains/suppliers/bulk.js',
  './assets/js/domains/suppliers/commands.js',
  './assets/js/domains/suppliers/editor.js',
  './assets/js/domains/suppliers/model.js',
  './assets/js/domains/suppliers/navigation.js',
  './assets/js/domains/suppliers/order.js',
  './assets/js/domains/suppliers/selectors.js',
  './assets/js/domains/suppliers/view.js',
  './assets/js/domains/warehouse/bulk.js',
  './assets/js/domains/warehouse/editor.js',
  './assets/js/domains/warehouse/model.js',
  './assets/js/domains/warehouse/view.js',
  './assets/js/lifecycle.js',
  './assets/js/main.js',
  './assets/js/shared/calendar.js',
  './assets/js/shared/check-series.js',
  './assets/js/shared/events.js',
  './assets/js/shared/html.js',
  './assets/js/state/constants.js',
  './assets/js/state/contexts.js',
  './assets/js/state/normalization.js',
  './assets/js/state/selectors.js',
  './assets/js/state/serialization.js',
  './assets/js/state/snapshots.js',
  './assets/js/state/validation.js',
  './assets/js/storage/backup.js',
  './assets/js/storage/browser.js',
  './assets/js/storage/checks.js',
  './assets/js/storage/files.js',
  './assets/js/storage/indexed-db.js',
  './assets/js/storage/persistence.js',
  './assets/js/storage/tab-lock.js',
  './assets/js/sync/checks-persistence.js',
  './assets/js/sync/checks.js',
  './assets/js/sync/document.js',
  './assets/js/sync/merge-records.js',
  './assets/js/sync/merge.js',
  './assets/js/ui/actions.js',
  './assets/js/ui/backup.js',
  './assets/js/ui/cloud.js',
  './assets/js/ui/date-editor.js',
  './assets/js/ui/folder-status.js',
  './assets/js/ui/folders.js',
  './assets/js/ui/layout.js',
  './assets/js/ui/modal.js',
  './assets/js/ui/navigation.js',
  './assets/js/ui/settings.js',
  './assets/js/ui/status.js',
  './assets/js/ui/tab-guard.js',
  './manifest.webmanifest',
  './supabase/config.js',
  './favicon.ico',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './apple-touch-icon.png',
  './android-chrome-192x192.png',
  './android-chrome-512x512.png'
];

const SHELL_PATHS=new Set(SHELL.map(item=>new URL(item,self.location.href||self.location.origin+'/').pathname));

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(event.request.mode!=='navigate'&&!SHELL_PATHS.has(url.pathname))return;

  // Network-first prevents a previously installed PWA from keeping stale HTML,
  // config or icons after a deployment. Offline remains fully supported by the
  // verified app-shell cache and navigation fallback.
  event.respondWith(
    fetch(event.request).then(response=>{
      if(response.ok&&SHELL_PATHS.has(url.pathname)){
        const copy=response.clone();
        event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
      }
      return response;
    }).catch(async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match(event.request);
      if(cached)return cached;
      if(event.request.mode==='navigate')return cache.match('./index.html');
      throw new Error('offline_and_not_cached');
    })
  );
});
