import {createDomainsBankController} from '../domains/bank/controller.js';
import {createDomainsBankView} from '../domains/bank/view.js';
import {createFinanceBrowserEffects} from '../shared/finance-browser-effects.js';
import {createBankActions} from '../ui/action-packs/bank.js';
import {createLazyDeferredSearchUpdater} from '../shared/search-scheduler.js';

function requireMethods(name, port, methods) {
  for (const method of methods) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`kupa_bank_${name}_${method}_required`);
  }
}

// Owns Bank orchestration/presentation and resource lifetimes. The shared
// Finance Bridge and cloud adapters are supplied by Finance composition.
export function createKupaBankCapability({
  model, session, checks, cloud, persistence, bridge, authority, readout, revisions, platform={},
}) {
  if (!model || !session) throw new TypeError('kupa_bank_context_required');
  requireMethods('checks', checks, ['hasLocalWork', 'sync', 'save']);
  requireMethods('persistence', persistence, ['save', 'recover']);
  requireMethods('scope', authority?.scope, ['capture', 'captureRead']);
  if (typeof authority?.automaticAccess !== 'function') throw new TypeError('kupa_bank_automatic_access_required');
  requireMethods('readout', readout, ['balance', 'forecast', 'observedCheckSequence']);
  requireMethods('revisions', revisions, ['touchData', 'touchDisplay']);
  requireMethods('cloud', cloud, ['refreshFinance', 'saveFinancePatch', 'claimLease', 'releaseLease',
    'saveSnapshot', 'mergeTransactions', 'syncTransactions', 'readTransactions', 'readTransactionSnapshot',
    'acknowledgeMissing', 'syncImages', 'downloadImage']);
  const effects = platform.effects ?? createFinanceBrowserEffects();
  requireMethods('effects', effects, ['saveJson', 'dispose']);
  let disposed = false, binding = null;
  const pending = new Set();
  function ready() {
    if (disposed) throw new Error('kupa_bank_disposed');
    if (!binding) throw new Error('kupa_bank_ui_not_bound');
    return binding;
  }
  const notify = (...args) => { if (!disposed) return ready().toast(...args); };
  const render = (...args) => { if (!disposed) return ready().render(...args); };
  function capture(method) {
    const guard = authority.scope[method]();
    return () => {
      if (disposed) throw Object.assign(new Error('kupa_bank_disposed'), {code:'FINANCE_OPERATION_SCOPE_CHANGED'});
      guard();
    };
  }
  const scope = {capture:() => capture('capture'), captureRead:() => capture('captureRead')};
  const controller = createDomainsBankController({
    model, session, bridge, operationScope:scope,
    effects:{saveJson:(...args) => { ready(); return effects.saveJson(...args); }},
    timers:platform.timers ?? globalThis, autoScope:() => disposed ? null : authority.automaticAccess(),
    sharedChecksHaveLocalWork:(...args) => checks.hasLocalWork(...args),
    saveSharedChecksToCloud:(...args) => checks.save(...args), syncSharedChecksFromCloud:(...args) => checks.sync(...args),
    sharedChecksObservedSequence:(...args) => readout.observedCheckSequence(...args),
    saveState:(...args) => persistence.save(...args), recoverLocalState:(...args) => persistence.recover(...args), toast:notify, render,
    refreshFinanceCloudSnapshot:(...args) => cloud.refreshFinance(...args), saveFinancePatch:(...args) => cloud.saveFinancePatch(...args),
    claimFinanceSyncLease:(...args) => cloud.claimLease(...args), releaseFinanceSyncLease:(...args) => cloud.releaseLease(...args),
    saveBankSyncSnapshot:(...args) => cloud.saveSnapshot(...args), mergeBankTransactions:(...args) => cloud.mergeTransactions(...args),
    syncBankTransactionsSnapshot:(...args) => cloud.syncTransactions(...args), readBankTransactions:(...args) => cloud.readTransactions(...args),
    readBankTransactionSnapshot:(...args) => cloud.readTransactionSnapshot(...args), acknowledgeBankTransactionMissing:(...args) => cloud.acknowledgeMissing(...args),
    syncBankChequeImages:(...args) => cloud.syncImages(...args), touchBankDataRevision:(...args) => revisions.touchData(...args), touchBankDisplayRevision:(...args) => revisions.touchDisplay(...args),
  });
  function enter(method, ...args) {
    if (disposed) return Promise.resolve(false);
    ready();
    return controller[method](...args);
  }
  function viewCall(method, ...args) {
    if (disposed) return false;
    const result = ready().view[method](...args);
    if (result?.then) {
      const tracked = Promise.resolve(result);
      pending.add(tracked);
      tracked.then(() => pending.delete(tracked), () => pending.delete(tracked));
    }
    return result;
  }
  const commands = Object.fromEntries([
    'refreshBankBalance', 'retryLocalBankSnapshot', 'saveBankBridgeToken', 'configureBankBridge',
    'selectBankBridgeAccount', 'deleteBankBridgeCredentials', 'exportBankChequeDiagnostics', 'acknowledgeMissingBankTransaction',
  ].map(method => [method, (...args) => enter(method, ...args)]));
  commands.setBankAutoRefresh = enabled => { if (disposed) return false; ready(); return controller.setBankAutoRefresh(enabled); };
  const presentation = Object.fromEntries([
    'renderBank', 'openCashflowBreakdown', 'openBankChequeImage', 'setBankAccountView', 'setBankDataView',
    'setBankSearch', 'setBankDateMode', 'setBankDateBoundary', 'toggleBankSyncOptions',
  ].map(method => [method, (...args) => viewCall(method, ...args)]));
  const queries = {
    snapshot:() => { ready(); return controller.bankBridgeUiState(); },
    localSnapshot:() => { ready(); return controller.bankLocalSnapshotState(); },
    ensureDisplayArchive:(...args) => enter('ensureBankDisplayArchive', ...args),
    refreshStatus:(...args) => enter('refreshBankBridgeStatus', ...args),
  };

  function bindUi({ui, modal, date, toast, render:renderView, runFinance, importConnections}) {
    if (disposed) throw new Error('kupa_bank_disposed');
    if (binding) throw new Error('kupa_bank_ui_already_bound');
    requireMethods('modal', modal, ['modal', 'closeModal']);
    requireMethods('date', date, ['dateEditorMarkup']);
    if (!ui || [toast, renderView, runFinance, importConnections].some(method => typeof method !== 'function')) {
      throw new TypeError('kupa_bank_ui_commands_required');
    }
    const view = createDomainsBankView({
      model, ui, runFinance, isActive:() => !disposed,
      modal:(...args) => { if (!disposed) return modal.modal(...args); }, closeModal:(...args) => { if (!disposed) return modal.closeModal(...args); },
      bankHomeBalance:(...args) => readout.balance('home', ...args),
      bankNextCycleCommitments:(...args) => readout.forecast('business', ...args),
      bankHomeNextCycleCommitments:(...args) => readout.forecast('home', ...args),
      bankBridgeUiState:queries.snapshot, refreshBankBridgeStatus:queries.refreshStatus,
      ensureBankDisplayArchive:queries.ensureDisplayArchive,
      downloadBankChequeImage:(date, key) => cloud.downloadImage(date, key, {assertCurrent:scope.captureRead()}),
      dateEditorMarkup:date.dateEditorMarkup,
    });
    const search = createLazyDeferredSearchUpdater(value => { if (!disposed) ui.bankSearchValue = value; }, presentation.setBankSearch);
    const actions = createBankActions({bankCommands:commands, bankPresentation:presentation, importFinanceConnections:importConnections, ui, toast:notify, search});
    binding = {view, toast, render:renderView, search, actions:Object.fromEntries(Object.entries(actions).map(([name, handler]) =>
      [name, (...args) => disposed ? false : handler(...args)]))};
  }
  const runtime = {
    isActive:() => !disposed,
    start() { if (disposed) return false; ready(); return controller.startAutoSync(); },
    stop:controller.stopAutoSync,
    wake() { if (disposed) return false; ready(); return controller.maybeAutoRefreshBankBalance(); },
    async drain() { await controller.runtime.drain(); while (pending.size) await Promise.all([...pending]); },
    dispose() {
      if (disposed) return false;
      disposed = true;
      controller.runtime.dispose();
      binding?.search.cancel();
      binding?.view.runtime.dispose();
      effects.dispose();
      return true;
    },
  };
  return {bindUi, commands, queries, presentation, runtime,
    assertReady:() => { ready(); return true; }, actionPack:() => ({name:'bank', actions:ready().actions})};
}
