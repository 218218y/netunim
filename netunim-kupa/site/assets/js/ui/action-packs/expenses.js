import { createLazyDeferredSearchUpdater } from '../../shared/search-scheduler.js';
// Expenses owns these delegated UI actions and its local event ports.
export function createExpensesActions({ domainsExpensesEditor, domainsExpensesView, ui }) {
  const openExpenseModal = (...args) => domainsExpensesEditor.openExpenseModal(...args);
  const setExpenseSearch = (...args) => domainsExpensesView.setExpenseSearch(...args);
  const expenseSearch = createLazyDeferredSearchUpdater(value => { ui.expenseSearchValue = value; }, setExpenseSearch);
  return {
    'expense-search': (element, event) => { return expenseSearch(element.value, element); },
    'open-expense-modal': (element, event) => { return openExpenseModal(); },
    'open-expense-modal-2': (element, event) => { return openExpenseModal(element.dataset.clickArg0); },
  };
}
