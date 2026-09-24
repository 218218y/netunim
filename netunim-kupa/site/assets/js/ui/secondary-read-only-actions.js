// Actions that only change the local view or export data remain available in a secondary tab.
export const SECONDARY_READ_ONLY_ACTIONS=new Set([
  'cashflow-breakdown','cashflow-breakdown-date','select-input','set-page','check-tab','check-tab-2','check-tab-3','check-account','check-bank-history-page','check-year','toggle-checks-forecast','render-checks-search','clear-check-focus',
  'expenses-hub-tab','credit-details-page','credit-search','expense-search','cash-search','notes-search','credit-view','toggle-credit-forecast','credit-account-filter','credit-provider-filter','credit-card-filter','credit-date-apply','credit-detail-upcoming','credit-detail-upcoming-day','credit-detail-month','credit-detail-month-day','credit-detail-focus','clear-credit-detail-focus',
  'notes-workspace-notes','notes-workspace-sheet','set-active-notes-sheet','set-bank-account-view','set-bank-data-view','view-bank-cheque-image','bank-search','bank-date-mode','bank-date-apply','bank-date-from','bank-date-to','toggle-bank-sync-options','toggle-credit-sync-options',
  'copy-safe-credit-diagnostics','export-bank-cheque-diagnostics','export-credit-data-diagnostics','download-json-backup','refresh-cloud-backups','load-more-cloud-backups','preview-cloud-backup','download-cloud-backup','download-selected-cloud-backup','export-c-s-v','export-c-s-v-2','close-modal','view-check-bank-alerts'
]);
