'use strict';
const CACHE_PREFIX='kupa-app-shell-';
const CACHE='kupa-app-shell-esm-407118e12e30';
const SHELL=[
  './',
  './index.html',
  './reset-local.html',
  './assets/app.css',
  './assets/app.js',
  './assets/js/cloud/auth.js',
  './assets/js/cloud/transport.js',
  './assets/js/composition/cash.js',
  './assets/js/composition/checks.js',
  './assets/js/composition/cloud.js',
  './assets/js/composition/credit.js',
  './assets/js/composition/expenses.js',
  './assets/js/composition/finance-cloud.js',
  './assets/js/composition/finance.js',
  './assets/js/composition/notes.js',
  './assets/js/composition/state-normalization.js',
  './assets/js/composition/storage-v2.js',
  './assets/js/connectivity.js',
  './assets/js/core/dates.js',
  './assets/js/core/money.js',
  './assets/js/core/search.js',
  './assets/js/core/values.js',
  './assets/js/domains/bank/alerts.js',
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
  './assets/js/domains/credit/sync-view.js',
  './assets/js/domains/credit/view.js',
  './assets/js/domains/dashboard/controller.js',
  './assets/js/domains/dashboard/model.js',
  './assets/js/domains/dashboard/view.js',
  './assets/js/domains/documents/document-result-sort.js',
  './assets/js/domains/documents/document-search-navigator.js',
  './assets/js/domains/documents/docx-search-viewer.js',
  './assets/js/domains/documents/pdf-search-viewer.js',
  './assets/js/domains/documents/pdf-text-fragments.js',
  './assets/js/domains/documents/pdfjs-runtime-config.js',
  './assets/js/domains/documents/search-source.js',
  './assets/js/domains/documents/spreadsheet-preview-worker.js',
  './assets/js/domains/documents/spreadsheet-search-viewer.js',
  './assets/js/domains/documents/text-search-viewer.js',
  './assets/js/domains/expenses/editor.js',
  './assets/js/domains/expenses/model.js',
  './assets/js/domains/expenses/view.js',
  './assets/js/domains/notes/controller.js',
  './assets/js/domains/records/commands.js',
  './assets/js/domains/search/model.js',
  './assets/js/integrations/bank-bridge.js',
  './assets/js/integrations/document-bridge.js',
  './assets/js/integrations/document-google-drive.js',
  './assets/js/lifecycle.js',
  './assets/js/main.js',
  './assets/js/shared/action-registry.js',
  './assets/js/shared/authenticated-account-scope.js',
  './assets/js/shared/bank-bridge-client.js',
  './assets/js/shared/bank-cheque-images.js',
  './assets/js/shared/bank-recurring-debits.js',
  './assets/js/shared/bank-transaction-order.js',
  './assets/js/shared/browser-bridge-platform.js',
  './assets/js/shared/browser-google-drive-platform.js',
  './assets/js/shared/calendar.js',
  './assets/js/shared/cashflow-breakdown.js',
  './assets/js/shared/cashflow-notification.js',
  './assets/js/shared/cashflow.js',
  './assets/js/shared/check-bank-review.js',
  './assets/js/shared/check-forecast.js',
  './assets/js/shared/check-series.js',
  './assets/js/shared/check-summary.js',
  './assets/js/shared/clean-view-cache.js',
  './assets/js/shared/cloud-backups.js',
  './assets/js/shared/cloud-checkpoint-publication.js',
  './assets/js/shared/cloud-sync.js',
  './assets/js/shared/credit-billing-cycles.js',
  './assets/js/shared/credit-card-order-view.js',
  './assets/js/shared/credit-card-order.js',
  './assets/js/shared/credit-detail-controls.js',
  './assets/js/shared/credit-history.js',
  './assets/js/shared/credit-sync-policy.js',
  './assets/js/shared/customer-debt-progress.js',
  './assets/js/shared/data-invariants.js',
  './assets/js/shared/document-bridge-client.js',
  './assets/js/shared/document-search-composition.js',
  './assets/js/shared/domain-revisions.js',
  './assets/js/shared/events.js',
  './assets/js/shared/finance-connection-import.js',
  './assets/js/shared/finance-derivations.js',
  './assets/js/shared/finance-fence.js',
  './assets/js/shared/finance-refresh-policy.js',
  './assets/js/shared/global-document-search.css',
  './assets/js/shared/global-document-search.js',
  './assets/js/shared/google-drive-client.js',
  './assets/js/shared/google-drive-document-policy.js',
  './assets/js/shared/html.js',
  './assets/js/shared/indexed-db-connection.js',
  './assets/js/shared/kupa-cashflow.js',
  './assets/js/shared/local-site-reset-page.js',
  './assets/js/shared/local-site-reset.js',
  './assets/js/shared/notes-sheet-model.js',
  './assets/js/shared/notes-workbook-merge.js',
  './assets/js/shared/notes-workbook.css',
  './assets/js/shared/notes-workbook.js',
  './assets/js/shared/orders-finance.js',
  './assets/js/shared/restore-groups.js',
  './assets/js/shared/result-pages.js',
  './assets/js/shared/revision-selector.js',
  './assets/js/shared/runtime-performance.js',
  './assets/js/shared/runtime-polling.js',
  './assets/js/shared/runtime-resources.js',
  './assets/js/shared/search-fragments.js',
  './assets/js/shared/search-scheduler.js',
  './assets/js/shared/search.js',
  './assets/js/shared/shared-checks-contract.js',
  './assets/js/shared/shared-checks-flight.js',
  './assets/js/shared/shared-checks-status.js',
  './assets/js/shared/shared-checks-storage-v2.js',
  './assets/js/shared/shared-checks-v2-composition.js',
  './assets/js/shared/shared-checks-v2-runtime.js',
  './assets/js/shared/spreadsheet-model.js',
  './assets/js/shared/spreadsheet-store.js',
  './assets/js/shared/spreadsheet-sync.js',
  './assets/js/shared/spreadsheet-workspace.js',
  './assets/js/shared/startup-task.js',
  './assets/js/shared/storage-cloud-status.js',
  './assets/js/shared/storage-journal-idb.js',
  './assets/js/shared/storage-journal-model.js',
  './assets/js/shared/storage-journal.js',
  './assets/js/shared/storage-metrics.js',
  './assets/js/shared/storage-owner.js',
  './assets/js/shared/storage-startup-protocol.js',
  './assets/js/shared/storage-startup-recovery.js',
  './assets/js/shared/storage-v2-account-marker.js',
  './assets/js/shared/storage-v2-activation-cache.js',
  './assets/js/shared/storage-v2-bootstrap.js',
  './assets/js/shared/storage-v2-boundary.js',
  './assets/js/shared/storage-v2-detached-target.js',
  './assets/js/shared/storage-v2-fenced-recovery.js',
  './assets/js/shared/storage-v2-local-birth.js',
  './assets/js/shared/storage-v2-local-import.js',
  './assets/js/shared/storage-v2-owner-transfer.js',
  './assets/js/shared/storage-v2-persisted-compat.js',
  './assets/js/shared/storage-v2-restore.js',
  './assets/js/shared/storage-v2-runtime.js',
  './assets/js/shared/storage-v2-schema.js',
  './assets/js/shared/storage-v2-server-protocol.js',
  './assets/js/shared/sync-capabilities.js',
  './assets/js/shared/sync-status.js',
  './assets/js/shared/tab-lock.js',
  './assets/js/startup/cloud-hydration.js',
  './assets/js/startup/connection.js',
  './assets/js/startup/local-services.js',
  './assets/js/state/constants.js',
  './assets/js/state/contexts.js',
  './assets/js/state/normalization.js',
  './assets/js/state/revisions.js',
  './assets/js/state/serialization.js',
  './assets/js/state/validation.js',
  './assets/js/storage/backup.js',
  './assets/js/storage/browser.js',
  './assets/js/storage/files.js',
  './assets/js/storage/indexed-db.js',
  './assets/js/storage/persistence.js',
  './assets/js/storage/tab-lock.js',
  './assets/js/storage/v2-cloud-ports.js',
  './assets/js/sync/checks-state.js',
  './assets/js/sync/checks.js',
  './assets/js/sync/document.js',
  './assets/js/sync/legacy-card-migration.js',
  './assets/js/sync/merge-records.js',
  './assets/js/sync/merge.js',
  './assets/js/sync/recovery.js',
  './assets/js/ui-primitives/local-search.js',
  './assets/js/ui/action-packs/backup.js',
  './assets/js/ui/action-packs/bank.js',
  './assets/js/ui/action-packs/cash.js',
  './assets/js/ui/action-packs/checks.js',
  './assets/js/ui/action-packs/cloud.js',
  './assets/js/ui/action-packs/credit.js',
  './assets/js/ui/action-packs/expenses.js',
  './assets/js/ui/action-packs/notes.js',
  './assets/js/ui/action-packs/settings.js',
  './assets/js/ui/action-packs/shell.js',
  './assets/js/ui/actions.js',
  './assets/js/ui/backup.js',
  './assets/js/ui/bulk.js',
  './assets/js/ui/cloud.js',
  './assets/js/ui/connection.js',
  './assets/js/ui/date-editor.js',
  './assets/js/ui/document-index-refresh.js',
  './assets/js/ui/document-result-menu.js',
  './assets/js/ui/document-search-connection-view.js',
  './assets/js/ui/document-search-content-options.js',
  './assets/js/ui/document-search-error-view.js',
  './assets/js/ui/document-search-file-type.js',
  './assets/js/ui/document-search-folder-scope.js',
  './assets/js/ui/document-search-pipeline.js',
  './assets/js/ui/document-search-view.js',
  './assets/js/ui/folders.js',
  './assets/js/ui/global-search-refs.js',
  './assets/js/ui/global-search.js',
  './assets/js/ui/modal.js',
  './assets/js/ui/navigation.js',
  './assets/js/ui/secondary-read-only-actions.js',
  './assets/js/ui/settings.js',
  './assets/js/ui/sidebar.js',
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
const LAZY_RUNTIME_PREFIXES=['./assets/vendor/'].map(item=>new URL(item,self.location.href||self.location.origin+'/').pathname);
const isLazyRuntimePath=pathname=>LAZY_RUNTIME_PREFIXES.some(prefix=>pathname.startsWith(prefix));

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
  const lazyRuntime=isLazyRuntimePath(url.pathname);
  if(event.request.mode!=='navigate'&&!SHELL_PATHS.has(url.pathname)&&!lazyRuntime)return;

  // Third-party document runtimes are immutable, version-pinned assets intentionally kept
  // out of the install shell. On first request, persist the clone before
  // resolving the response promise. This makes the lazy cache deterministic:
  // callers that have received the module can rely on it already being cached.
  if(lazyRuntime){
    const lazyResponse=(async()=>{
      try{
        const response=await fetch(event.request);
        if(response.ok){
          const cache=await caches.open(CACHE);
          await cache.put(event.request,response.clone());
        }
        return response;
      }catch(error){
        const cache=await caches.open(CACHE);
        const cached=await cache.match(event.request);
        if(cached)return cached;
        throw error;
      }
    })();
    event.waitUntil(lazyResponse.then(()=>undefined,()=>undefined));
    event.respondWith(lazyResponse);
    return;
  }

  // Network-first prevents a previously installed PWA from keeping stale HTML,
  // config or icons after a deployment. Offline remains fully supported by the
  // verified app-shell cache and navigation fallback.
  const network=fetch(event.request);
  const cacheWrite=network.then(response=>{
    if(!response.ok||!SHELL_PATHS.has(url.pathname))return;
    return caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
  }).catch(()=>{});
  event.waitUntil(cacheWrite);
  event.respondWith(
    network.catch(async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match(event.request);
      if(cached)return cached;
      if(event.request.mode==='navigate')return cache.match('./index.html');
      throw new Error('offline_and_not_cached');
    })
  );
});
