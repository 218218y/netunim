import {createDomainsChecksView} from '../domains/checks/view.js';
import {createDomainsChecksEditor} from '../domains/checks/editor.js';
import {createSyncChecks} from '../sync/checks.js';
import {createSyncChecksPersistence} from '../sync/checks-persistence.js';
import {createChecksActions} from '../ui/action-packs/checks.js';
import {createLazyDeferredSearchUpdater} from '../shared/search-scheduler.js';

function requireMethods(name, port, methods) {
  for (const method of methods) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`orders_checks_${name}_${method}_required`);
  }
}

// The shell binds presentation, persistence and transport as they become
// available. Consumers receive commands and observations, never resource slots.
export function createOrdersChecksCapability({
  model, ui, session, checksSession, files, tab, auth, sharedChecksV2, touchRevision, platform={},
}) {
  if (!model || !ui || !session || !checksSession || !files || !tab || typeof touchRevision !== 'function') {
    throw new TypeError('orders_checks_context_required');
  }
  requireMethods('auth', auth, ['loadSession']);
  const isOnline = platform.isOnline ?? (() => globalThis.navigator?.onLine !== false);
  if (typeof isOnline !== 'function') throw new TypeError('orders_checks_connectivity_required');
  let view = null, editor = null, persistence = null, sync = null, actions = null, search = null;
  let disposed = false;
  function active() { if (disposed) throw new Error('orders_checks_disposed'); }
  function ready(name, port) { active(); if (!port) throw new Error(`orders_checks_${name}_not_bound`); return port; }
  const guard = port => Object.fromEntries(Object.entries(port).map(([name, method]) =>
    [name, (...args) => disposed ? false : method(...args)]));

  function bindView({layout, bankImageContext}) {
    active();
    if (view) throw new Error('orders_checks_view_already_bound');
    requireMethods('layout', layout, ['mountViewLayout']);
    if (typeof bankImageContext !== 'function') throw new TypeError('orders_checks_bank_image_context_required');
    view = guard(createDomainsChecksView({model, ui, checksSession, getBankImageContext:bankImageContext,
      loadSession:auth.loadSession, mountViewLayout:layout.mountViewLayout}));
  }

  function bindPersistence({status, folder, rejectMutation, writeFolder, refreshAlerts}) {
    active();
    if (persistence) throw new Error('orders_checks_persistence_already_bound');
    requireMethods('status', status, ['toast', 'setSave', 'setChecksCloud']);
    requireMethods('folder', folder, ['syncFolderAccessButton', 'folderBackupAvailable', 'folderSaveTitle']);
    if ([rejectMutation, writeFolder, refreshAlerts].some(method => typeof method !== 'function')) {
      throw new TypeError('orders_checks_persistence_commands_required');
    }
    const notify = guard(status);
    persistence = createSyncChecksPersistence({
      session, checksSession, sharedChecksV2, isOnline, timers:platform.timers ?? globalThis,
      toast:notify.toast, setSave:notify.setSave, setCloud:notify.setChecksCloud,
      syncFolderAccessButton:folder.syncFolderAccessButton, folderBackupAvailable:folder.folderBackupAvailable,
      folderSaveTitle:folder.folderSaveTitle, rejectSecondaryMutation:rejectMutation, writeStateToFolder:writeFolder,
      loadSession:auth.loadSession, refreshAlertCenter:refreshAlerts, touchChecksRevision:touchRevision,
      saveSharedChecksToCloud:(...args) => commands.saveToCloud(...args),
      isSaving:() => ready('sync', sync).runtime.isSaving(),
    });
  }

  function bindEditor({date, modal, toast, finance}) {
    ready('view', view);
    if (editor) throw new Error('orders_checks_editor_already_bound');
    requireMethods('date', date, ['checkDateEditorMarkup', 'setCheckDateValue', 'normalizeCheckModalDates',
      'applyCheckDatePicker', 'handleCheckDatePartBlur', 'handleCheckDatePartInput', 'handleCheckDatePartKeydown', 'openCheckDatePicker']);
    requireMethods('modal', modal, ['modal', 'closeModal', 'confirmDialog']);
    requireMethods('finance_readout', finance?.readout, ['renderKupaDependentView']);
    requireMethods('finance_presentation', finance?.presentation, ['renderKupa']);
    if (typeof toast !== 'function') throw new TypeError('orders_checks_toast_required');
    const ownedModal = {
      modal:(...args) => { if (!disposed) return modal.modal(...args); },
      closeModal:(...args) => { if (!disposed) return modal.closeModal(...args); },
      confirmDialog:async (...args) => !disposed && await modal.confirmDialog(...args) && !disposed,
    };
    const nextEditor = guard(createDomainsChecksEditor({
      model, ui, toast, checkDateEditorMarkup:date.checkDateEditorMarkup, setCheckDateValue:date.setCheckDateValue,
      normalizeCheckModalDates:date.normalizeCheckModalDates, ...ownedModal,
      scheduleCheckSave:(...args) => ready('persistence', persistence).scheduleCheckSave(...args),
    }));
    search = createLazyDeferredSearchUpdater(value => { if (!disposed) ui.checkSearchValue = value; },
      (...args) => view.renderChecksSearch(...args));
    const nextActions = createChecksActions({financeReadout:finance.readout, domainsFinanceView:finance.presentation,
      domainsChecksEditor:nextEditor, domainsChecksView:view, ui, uiDateEditor:date, uiModal:ownedModal, search});
    // Mutation labels are consumed by the shell's startup/ownership gate.
    actions = Object.fromEntries(Object.entries(nextActions).map(([name, handler]) => {
      const owned = (...args) => disposed ? false : handler(...args);
      if (handler.startupMutationDomain !== undefined) {
        Object.defineProperty(owned, 'startupMutationDomain', {value:handler.startupMutationDomain});
      }
      return [name, owned];
    }));
    editor = nextEditor;
  }

  function bindSync({status, financeReadout, writeFolder}) {
    active();
    if (sync) throw new Error('orders_checks_sync_already_bound');
    requireMethods('sync_status', status, ['toast', 'setChecksCloud', 'refreshCloudTimestamp']);
    requireMethods('finance_readout', financeReadout, ['recomputeKupaNetFromCache', 'renderKupaDependentView']);
    if (typeof writeFolder !== 'function') throw new TypeError('orders_checks_folder_write_required');
    sync = createSyncChecks({
      model, files, checksSession, tab, sharedChecksV2, isOnline, loadSession:auth.loadSession,
      toast:status.toast, setCloud:status.setChecksCloud, refreshCloudTimestamp:status.refreshCloudTimestamp,
      recomputeKupaNetFromCache:financeReadout.recomputeKupaNetFromCache,
      renderKupaDependentView:financeReadout.renderKupaDependentView, writeStateToFolder:writeFolder,
    });
  }

  const commands = {
    sync:(...args) => disposed ? Promise.resolve(false) : ready('sync', sync).syncSharedChecksFromCloud(...args),
    saveToCloud:(...args) => disposed ? Promise.resolve(false) : ready('sync', sync).saveSharedChecksToCloud(...args),
    scheduleSave:(...args) => disposed ? false : ready('persistence', persistence).scheduleCheckSave(...args),
    markDeposited:(...args) => disposed ? false : ready('editor', editor).markCheckDeposited(...args),
  };
  const presentation = {
    renderChecks:(...args) => disposed ? false : ready('view', view).renderChecks(...args),
    checksMarkup:(...args) => ready('view', view).checksMarkup(...args),
    checksHeaderContextMarkup:(...args) => ready('view', view).checksHeaderContextMarkup(...args),
    syncChecksBulkUi:(...args) => disposed ? false : ready('view', view).syncChecksBulkUi(...args),
  };
  const runtime = {
    poll:(...args) => disposed ? Promise.resolve(false) : ready('sync', sync).pollSharedChecks(...args),
    isSaving:() => sync?.runtime.isSaving() ?? false,
    isPending:() => sync?.runtime.isPending() ?? false,
    cancelPending:() => persistence?.runtime.cancelPending() ?? false,
    // Waiting for scheduled follow-ups first includes any flight they create.
    async drain() { await persistence?.runtime.drain(); await sync?.runtime.drain(); },
    dispose() {
      if (disposed) return false;
      disposed = true;
      search?.cancel();
      persistence?.runtime.dispose();
      sync?.runtime.dispose();
      return true;
    },
  };
  return {
    bindView, bindPersistence, bindEditor, bindSync, commands, presentation, runtime,
    dateEditing:{
      markCheckSeriesManual:(...args) => disposed ? false : ready('editor', editor).markCheckSeriesManual(...args),
      syncCheckSeriesFromFirst:(...args) => disposed ? false : ready('editor', editor).syncCheckSeriesFromFirst(...args),
    },
    assertReady:() => { ready('view', view); ready('editor', editor); ready('persistence', persistence); ready('sync', sync); return true; },
    actionPack:() => { ready('editor', editor); return {name:'checks', actions}; },
  };
}
