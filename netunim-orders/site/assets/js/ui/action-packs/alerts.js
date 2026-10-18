import { markMutationActions } from '../../shared/action-registry.js';
export function createAlertsActions({ uiAlertCenter }) {
  const dismissBankAlert = (...args) => uiAlertCenter.dismissBankAlert(...args);
  const dismissNoteAlert = (...args) => uiAlertCenter.dismissNoteAlert(...args);
  const markAlertCheckDeposited = (...args) => uiAlertCenter.markAlertCheckDeposited(...args);
  const openAlertTarget = (...args) => uiAlertCenter.openAlertTarget(...args);
  const actions = {
    'open-alert-target': (element, event) => { return openAlertTarget(element.dataset.clickArg0); },
    'mark-alert-check-deposited': (element, event) => { event?.preventDefault(); event?.stopPropagation(); return markAlertCheckDeposited(element.dataset.clickArg0); },
    'dismiss-bank-alert': (element, event) => { event?.preventDefault(); event?.stopPropagation(); return dismissBankAlert(element.dataset.clickArg0); },
    'dismiss-note-reminder': (element, event) => { event?.preventDefault(); event?.stopPropagation(); return dismissNoteAlert(element.dataset.clickArg0); },
  };
  return markMutationActions(actions, { orders: ['dismiss-note-reminder'], checks: ['mark-alert-check-deposited'] });
}
