import { createLazyDeferredSearchUpdater } from '../../shared/search-scheduler.js';
import { markMutationActions } from '../../shared/action-registry.js';
export function createChecksActions({ financeReadout, domainsChecksEditor, domainsChecksView, domainsFinanceView, ui, uiDateEditor, uiModal, search = null }) {
  const applyCheckDatePicker = (...args) => uiDateEditor.applyCheckDatePicker(...args);
  const changeCheckSeriesCount = (...args) => domainsChecksEditor.changeCheckSeriesCount(...args);
  const deleteCheck = (...args) => domainsChecksEditor.deleteCheck(...args);
  const deleteChecksBulkSelected = (...args) => domainsChecksEditor.deleteChecksBulkSelected(...args);
  const handleCheckDatePartBlur = (...args) => uiDateEditor.handleCheckDatePartBlur(...args);
  const handleCheckDatePartInput = (...args) => uiDateEditor.handleCheckDatePartInput(...args);
  const handleCheckDatePartKeydown = (...args) => uiDateEditor.handleCheckDatePartKeydown(...args);
  const markCheckCleared = (...args) => domainsChecksEditor.markCheckCleared(...args);
  const markCheckDeposited = (...args) => domainsChecksEditor.markCheckDeposited(...args);
  const markCheckSeriesManual = (...args) => domainsChecksEditor.markCheckSeriesManual(...args);
  const openCheckDatePicker = (...args) => uiDateEditor.openCheckDatePicker(...args);
  const openCheckModal = (...args) => domainsChecksEditor.openCheckModal(...args);
  const renderChecks = (...args) => ui.currentView === 'kupa' ? domainsFinanceView.renderKupa(...args) : domainsChecksView.renderChecks(...args);
  const renderChecksSearch = (...args) => domainsChecksView.renderChecksSearch(...args);
  const reviewCheckBank = (...args) => { if (domainsChecksEditor.reviewCheckBank(...args)) {
    uiModal.closeModal();
    financeReadout.renderKupaDependentView();
  } };
  const saveCheck = (...args) => domainsChecksEditor.saveCheck(...args);
  const saveCheckSeries = (...args) => domainsChecksEditor.saveCheckSeries(...args);
  const syncCheckSeriesFromFirst = (...args) => domainsChecksEditor.syncCheckSeriesFromFirst(...args);
  const toggleChecksBulkMode = (...args) => domainsChecksView.toggleChecksBulkMode(...args);
  const toggleChecksBulkRow = (...args) => domainsChecksView.toggleChecksBulkRow(...args);
  const toggleChecksBulkVisible = (...args) => domainsChecksView.toggleChecksBulkVisible(...args);
  const checksSearch = search ?? createLazyDeferredSearchUpdater(value => { ui.checkSearchValue = value; }, renderChecksSearch);
  const actions = {
    'review-check-bank': element => reviewCheckBank(element.dataset.clickArg2 === 'remove-selected' ? [...ui.checksBulkSelected] : element.dataset.clickArg0, element.dataset.clickArg1, element.dataset.clickArg2),
    'handle-check-date-part-input': (element, event) => { return handleCheckDatePartInput(element); },
    'handle-check-date-part-blur': (element, event) => { return handleCheckDatePartBlur(element); },
    'handle-check-date-part-keydown': (element, event) => { return handleCheckDatePartKeydown(event, element); },
    'open-check-date-picker': (element, event) => { return openCheckDatePicker(element); },
    'apply-check-date-picker': (element, event) => { return applyCheckDatePicker(element); },
    'toggle-checks-bulk-mode': (element, event) => { toggleChecksBulkMode(); return renderChecks(); },
    'delete-checks-bulk-selected': (element, event) => { return deleteChecksBulkSelected(); },
    'toggle-checks-bulk-visible': (element, event) => { return toggleChecksBulkVisible(element.checked); },
    'toggle-checks-bulk-row': (element, event) => { return toggleChecksBulkRow(element.dataset.clickArg0, element.checked, !!event?.shiftKey); },
    'check-tab': (element, event) => { ui.checkTab = 'open'; return renderChecks(); },
    'check-tab-2': (element, event) => { ui.checkTab = 'deposited'; return renderChecks(); },
    'check-tab-3': (element, event) => { ui.checkTab = 'closed'; return renderChecks(); },
    'check-account': (element, event) => { ui.checkBankHistoryPage = 0; const account = element.dataset.clickArg0; ui.checkAccount = account === 'ביתי' ? 'ביתי' : account === 'עסקי' ? 'עסקי' : 'all'; ui.checksBulkSelected.clear(); ui.checksBulkAnchorId = null; return renderChecks(); },
    'check-bank-history-page': (element, event) => { ui.checkBankHistoryPage = Number(element.dataset.clickArg0) || 0; renderChecks(); return document.querySelectorAll('.check-bank-activity').forEach(panel => { panel.open = true; }); },
    'check-year': (element, event) => { ui.checkYear = element.value; return renderChecks(); },
    'toggle-checks-forecast': (element, event) => { ui.checksForecastOpen = !ui.checksForecastOpen; const body = document.getElementById('checksForecastBody'), button = document.querySelector('[data-action="toggle-checks-forecast"]'); if (body)
      body.hidden = !ui.checksForecastOpen; if (button) {
      button.classList.toggle('open', ui.checksForecastOpen);
      return button.setAttribute('aria-expanded', String(ui.checksForecastOpen));
    } },
    'render-checks-search': (element, event) => { return checksSearch(element.value, element); },
    'open-check-modal': (element, event) => { return openCheckModal(); },
    'mark-check-deposited': (element, event) => { return markCheckDeposited(element.dataset.clickArg0); },
    'mark-check-cleared': (element, event) => { return markCheckCleared(element.dataset.clickArg0); },
    'open-check-modal-2': (element, event) => { return openCheckModal(element.dataset.clickArg0); },
    'save-check': (element, event) => { return saveCheck(element.dataset.clickArg0); },
    'delete-check': (element, event) => { return deleteCheck(element.dataset.clickArg0); },
    'change-check-series-count': (element, event) => { return changeCheckSeriesCount(); },
    'save-check-series': (element, event) => { return saveCheckSeries(); },
    'sync-check-series-from-first': (element, event) => { return syncCheckSeriesFromFirst(); },
    'mark-check-series-manual': (element, event) => { return markCheckSeriesManual(element); },
  };
  return markMutationActions(actions, { checks: ['review-check-bank', 'open-check-modal', 'open-check-modal-2', 'mark-check-deposited', 'mark-check-cleared', 'save-check', 'delete-check', 'save-check-series', 'delete-checks-bulk-selected'] });
}
