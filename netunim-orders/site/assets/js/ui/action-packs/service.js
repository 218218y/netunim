import { createLazyDeferredSearchUpdater } from '../../shared/search-scheduler.js';
import { markMutationActions } from '../../shared/action-registry.js';
export function createServiceActions({ domainsServiceView, servicePorts, serviceUi }) {
  const pageServiceResults = (...args) => domainsServiceView.pageServiceResults(...args);
  const { deleteSelectedServiceCalls, deleteService, openServiceGmail, openServiceModal, renderService, saveService, toggleServiceBulkMode, toggleServiceBulkRow, toggleServiceBulkVisible, toggleServiceFlag } = servicePorts;
  const serviceSearch = createLazyDeferredSearchUpdater(value => { serviceUi.serviceSearch = value; }, () => renderService({ resultsOnly: true }));
  const actions = {
    'toggle-service-bulk-mode': (element, event) => { return toggleServiceBulkMode(); },
    'toggle-service-bulk-visible': (element, event) => { return toggleServiceBulkVisible(); },
    'delete-selected-service-calls': (element, event) => { return deleteSelectedServiceCalls(); },
    'open-service-modal': (element, event) => { return openServiceModal(); },
    'service-search': (element, event) => { return serviceSearch(element.value, element); },
    'service-filter': (element, event) => { serviceUi.serviceFilter = 'all'; return renderService(); },
    'service-filter-2': (element, event) => { serviceUi.serviceFilter = 'open'; return renderService(); },
    'service-filter-3': (element, event) => { serviceUi.serviceFilter = 'follow'; return renderService(); },
    'service-filter-4': (element, event) => { serviceUi.serviceFilter = 'escalated'; return renderService(); },
    'service-filter-5': (element, event) => { serviceUi.serviceFilter = 'closed'; return renderService(); },
    'service-results-page': el => pageServiceResults(el.dataset.clickArg0, el.dataset.clickArg1),
    'toggle-service-flag': (element, event) => { return toggleServiceFlag(element.dataset.clickArg0, element.dataset.clickArg1); },
    'toggle-service-bulk-row': (element, event) => { return toggleServiceBulkRow(element.dataset.clickArg0, element.checked, !!event?.shiftKey); },
    'open-service-gmail': (element, event) => { return openServiceGmail(element.dataset.clickArg0); },
    'open-service-modal-2': (element, event) => { return openServiceModal(element.dataset.clickArg0); },
    'save-service': (element, event) => { return saveService(element.dataset.clickArg0); },
    'delete-service': (element, event) => { return deleteService(element.dataset.clickArg0); },
  };
  return markMutationActions(actions, { orders: ['open-service-modal', 'toggle-service-flag', 'open-service-modal-2', 'save-service', 'delete-service', 'delete-selected-service-calls'] });
}
