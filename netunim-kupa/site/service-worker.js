'use strict';
const CACHE_PREFIX='kupa-app-shell-';
const CACHE='kupa-app-shell-esm-ec8ce056624c';
const SHELL=[
  './',
  './index.html',
  './assets/app.css',
  './assets/app.js',
  './assets/js/cloud/auth.js',
  './assets/js/cloud/transport.js',
  './assets/js/core/dates.js',
  './assets/js/core/money.js',
  './assets/js/core/search.js',
  './assets/js/core/values.js',
  './assets/js/domains/bank/alerts.js',
  './assets/js/domains/bank/bridge.js',
  './assets/js/domains/bank/controller.js',
  './assets/js/domains/bank/feed.js',
  './assets/js/domains/bank/model.js',
  './assets/js/domains/bank/selectors.js',
  './assets/js/domains/bank/view.js',
  './assets/js/domains/cash/controller.js',
  './assets/js/domains/cash/editor.js',
  './assets/js/domains/cash/model.js',
  './assets/js/domains/cash/selectors.js',
  './assets/js/domains/cash/view.js',
  './assets/js/domains/checks/editor.js',
  './assets/js/domains/checks/model.js',
  './assets/js/domains/checks/selectors.js',
  './assets/js/domains/checks/view.js',
  './assets/js/domains/credit/controller.js',
  './assets/js/domains/credit/editor.js',
  './assets/js/domains/credit/model.js',
  './assets/js/domains/credit/selectors.js',
  './assets/js/domains/credit/sync-feed.js',
  './assets/js/domains/credit/view.js',
  './assets/js/domains/dashboard/controller.js',
  './assets/js/domains/dashboard/model.js',
  './assets/js/domains/dashboard/view.js',
  './assets/js/domains/expenses/editor.js',
  './assets/js/domains/expenses/model.js',
  './assets/js/domains/expenses/selectors.js',
  './assets/js/domains/expenses/view.js',
  './assets/js/domains/notes/controller.js',
  './assets/js/domains/notes/sheet-model.js',
  './assets/js/domains/records/commands.js',
  './assets/js/lifecycle.js',
  './assets/js/main.js',
  './assets/js/shared/calendar.js',
  './assets/js/shared/cashflow.js',
  './assets/js/shared/check-forecast.js',
  './assets/js/shared/check-series.js',
  './assets/js/shared/cloud-sync.js',
  './assets/js/shared/events.js',
  './assets/js/shared/html.js',
  './assets/js/shared/kupa-cashflow.js',
  './assets/js/shared/orders-finance.js',
  './assets/js/shared/sync-status.js',
  './assets/js/state/constants.js',
  './assets/js/state/contexts.js',
  './assets/js/state/normalization.js',
  './assets/js/state/serialization.js',
  './assets/js/state/validation.js',
  './assets/js/storage/backup.js',
  './assets/js/storage/browser.js',
  './assets/js/storage/files.js',
  './assets/js/storage/indexed-db.js',
  './assets/js/storage/pending.js',
  './assets/js/storage/persistence.js',
  './assets/js/storage/tab-lock.js',
  './assets/js/sync/checks-state.js',
  './assets/js/sync/checks.js',
  './assets/js/sync/document.js',
  './assets/js/sync/merge-records.js',
  './assets/js/sync/merge.js',
  './assets/js/sync/pending.js',
  './assets/js/sync/recovery.js',
  './assets/js/ui/actions.js',
  './assets/js/ui/backup.js',
  './assets/js/ui/bulk.js',
  './assets/js/ui/cloud.js',
  './assets/js/ui/connection.js',
  './assets/js/ui/date-editor.js',
  './assets/js/ui/folders.js',
  './assets/js/ui/modal.js',
  './assets/js/ui/navigation.js',
  './assets/js/ui/settings.js',
  './assets/js/ui/status.js',
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

  // Network-first keeps deployments, config and replacement icons fresh.
  // If the network is unavailable, fall back to the verified data-free shell.
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
