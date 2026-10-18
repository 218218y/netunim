import { createLazyDeferredSearchUpdater } from '../../shared/search-scheduler.js';
// Checks owns these delegated UI actions and its local event ports.
export function createChecksActions({ domainsChecksEditor, domainsChecksView, ui, uiBulk, uiDateEditor, uiModal, search = null }) {
  const applyCheckDatePicker = (...args) => uiDateEditor.applyCheckDatePicker(...args);
  const changeCheckSeriesCount = (...args) => domainsChecksEditor.changeCheckSeriesCount(...args);
  const clearCheckFocus = (...args) => domainsChecksView.clearCheckFocus(...args);
  const deleteBulkSelected = (...args) => uiBulk.deleteBulkSelected(...args);
  const handleCheckDatePartBlur = (...args) => uiDateEditor.handleCheckDatePartBlur(...args);
  const handleCheckDatePartInput = (...args) => uiDateEditor.handleCheckDatePartInput(...args);
  const handleCheckDatePartKeydown = (...args) => uiDateEditor.handleCheckDatePartKeydown(...args);
  const markCheckSeriesManual = (...args) => domainsChecksEditor.markCheckSeriesManual(...args);
  const markCleared = (...args) => domainsChecksEditor.markCleared(...args);
  const markDeposited = (...args) => domainsChecksEditor.markDeposited(...args);
  const openCheckDatePicker = (...args) => uiDateEditor.openCheckDatePicker(...args);
  const openCheckModal = (...args) => domainsChecksEditor.openCheckModal(...args);
  const renderChecks = (...args) => domainsChecksView.renderChecks(...args);
  const renderChecksSearch = (...args) => domainsChecksView.renderChecksSearch(...args);
  const reviewCheckBank = (...args) => { if (domainsChecksEditor.reviewCheckBank(...args))
    uiModal.closeModal(true); };
  const syncCheckSeriesFromFirst = (...args) => domainsChecksEditor.syncCheckSeriesFromFirst(...args);
  const toggleBulkMode = (...args) => uiBulk.toggleBulkMode(...args);
  const toggleBulkRow = (...args) => uiBulk.toggleBulkRow(...args);
  const toggleBulkVisible = (...args) => uiBulk.toggleBulkVisible(...args);
  const checksSearch = search || createLazyDeferredSearchUpdater(value => { ui.checkSearchValue = value; }, renderChecksSearch);
  return {
    'refresh-check-bank': element => domainsChecksEditor.refreshBankMatches?.(element),
    'review-check-bank': element => reviewCheckBank(element.dataset.clickArg2 === 'remove-selected' ? [...ui.bulkSelected] : element.dataset.clickArg0, element.dataset.clickArg1, element.dataset.clickArg2),
    'handle-check-date-part-input': (element, event) => { return handleCheckDatePartInput(element); },
    'handle-check-date-part-blur': (element, event) => { return handleCheckDatePartBlur(element); },
    'handle-check-date-part-keydown': (element, event) => { return handleCheckDatePartKeydown(event, element); },
    'open-check-date-picker': (element, event) => { return openCheckDatePicker(element); },
    'apply-check-date-picker': (element, event) => { return applyCheckDatePicker(element); },
    'open-check-modal': (element, event) => { return openCheckModal(); },
    'mark-cleared': (element, event) => { return markCleared(element.dataset.clickArg0); },
    'mark-deposited': (element, event) => { return markDeposited(element.dataset.clickArg0); },
    'open-check-modal-2': (element, event) => { return openCheckModal(element.dataset.clickArg0); },
    'toggle-bulk-mode': (element, event) => { return toggleBulkMode(element.dataset.clickArg0); },
    'delete-bulk-selected': (element, event) => { return deleteBulkSelected(element.dataset.clickArg0); },
    'toggle-bulk-visible': (element, event) => { return toggleBulkVisible(element.dataset.changeArg0, element.checked); },
    'toggle-bulk-row': (element, event) => { return toggleBulkRow(element.dataset.changeArg0, element.dataset.changeArg1, element.checked); },
    'check-tab': (element, event) => { ui.checkTab = 'open'; ui.checkFocus = 'all'; return renderChecks(); },
    'check-tab-2': (element, event) => { ui.checkTab = 'deposited'; ui.checkFocus = 'all'; return renderChecks(); },
    'check-tab-3': (element, event) => { ui.checkTab = 'closed'; ui.checkFocus = 'all'; return renderChecks(); },
    'check-account': (element, event) => { ui.checkBankHistoryPage = 0; const account = element.dataset.clickArg0; ui.checkAccount = account === 'ביתי' ? 'ביתי' : account === 'עסקי' ? 'עסקי' : 'all'; ui.checkFocus = 'all'; ui.bulkSelected.clear(); return renderChecks(); },
    'check-bank-history-page': (element, event) => { ui.checkBankHistoryPage = Number(element.dataset.clickArg0) || 0; renderChecks(); return document.querySelectorAll('.check-bank-activity').forEach(panel => { panel.open = true; }); },
    'check-year': (element, event) => { ui.checkYear = element.value; return renderChecks(); },
    'toggle-checks-forecast': (element, event) => { ui.checksForecastOpen = !ui.checksForecastOpen; const body = document.getElementById('checksForecastBody'), button = document.querySelector('[data-action="toggle-checks-forecast"]'); if (body)
      body.hidden = !ui.checksForecastOpen; if (button) {
      button.classList.toggle('open', ui.checksForecastOpen);
      return button.setAttribute('aria-expanded', String(ui.checksForecastOpen));
    } },
    'render-checks-search': (element, event) => { return checksSearch(element.value, element); },
    'clear-check-focus': (element, event) => { return clearCheckFocus(); },
    'change-check-series-count': (element, event) => { return changeCheckSeriesCount(); },
    'sync-check-series-from-first': (element, event) => { return syncCheckSeriesFromFirst(); },
    'mark-check-series-manual': (element, event) => { return markCheckSeriesManual(element); },
  };
}
