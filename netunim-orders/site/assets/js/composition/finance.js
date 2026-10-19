import {createFinanceBridgeIntegration} from '../integrations/bank-bridge.js';
import {createFinanceBrowserEffects} from '../shared/finance-browser-effects.js';
import {createFinanceOperationScope} from '../shared/finance-fence.js';
import {createFinanceLeaseOwner} from '../shared/finance-lease-owner.js';
import {createDomainsBankSelectors} from '../domains/bank/selectors.js';
import {createDomainsBankCache} from '../domains/bank/cache.js';
import {createDomainsFinanceController} from '../domains/finance/controller.js';
import {createOrdersCreditConnectionOwner} from '../domains/finance/credit-connection-owner.js';
import {createOrdersBankConnectionOwner,ORDERS_BANK_BRIDGE_MINIMUM_VERSION} from '../domains/finance/bank-connection-owner.js';
import {CREDIT_CONNECTOR_CONTRACT_VERSION} from '../domains/finance/credit-feed.js';
import {createOrdersFinanceDocumentCommands} from '../domains/finance/document-commands.js';
import {createOrdersBankSnapshotPublication} from '../domains/finance/bank-snapshot-publication.js';
import {createOrdersBankSnapshotPolicy} from '../domains/finance/bank-snapshot-policy.js';
import {createOrdersBankRefresh} from '../domains/finance/bank-refresh.js';
import {createOrdersCreditRefresh} from '../domains/finance/credit-refresh.js';
import {bankAutoRefreshDue,creditRefreshDue} from '../shared/finance-refresh-policy.js';
import {normalizeCreditFetchMode,resolveCreditAutoSyncMode} from '../shared/credit-sync-policy.js';
import {normalizeCreditSync,mergeCreditSyncResult,creditSyncScrapeSelection} from '../domains/finance/credit-feed.js';
import {createOrdersBankArchiveReadout} from '../domains/finance/bank-archive-readout.js';
import {createBankArchiveReconciliation} from '../shared/bank-archive-reconciliation.js';
import {bankArchiveTargets,bankArchiveSourceRows} from '../domains/finance/bank-archive-model.js';
import {createDomainsFinanceView} from '../domains/finance/view.js';
import {createMorningReports} from '../domains/finance/morning-reports.js';
import {createMorningRequest} from '../integrations/morning.js';
import {createMorningMediaComposition} from './morning-media.js';
import {createOrdersBankChequeImageRuntime} from '../domains/finance/bank-cheque-image-runtime.js';
import {createFinanceConnectionImportCapability} from '../shared/finance-connection-import-capability.js';
import {createCreditCardOrderView} from '../shared/credit-card-order-view.js';
import {createFinanceBankActions} from '../ui/action-packs/finance-bank.js';
import {createFinanceCreditActions} from '../ui/action-packs/finance-credit.js';
import {markMutationActions} from '../shared/action-registry.js';
import {esc,uid} from '../core/values.js';

function requireMethods(name, port, methods) {
  for (const method of methods) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`orders_finance_${name}_${method}_required`);
  }
}

// Finance owns its adapters, readout, controller and presentation. Binding is
// staged because Checks and the shell need readout ports before cloud/UI exist.
export function createOrdersFinanceCapability({
  model, ui, checksSession, tab, auth, readAccess, revisions, runFinance, platform={},
}) {
  if (!model || !ui || !checksSession || !tab || typeof readAccess !== 'function' || typeof runFinance !== 'function') {
    throw new TypeError('orders_finance_context_required');
  }
  requireMethods('auth', auth, ['loadSession', 'supaFetch', 'ensureSession']);
  requireMethods('revisions', revisions, ['read', 'touchFinance', 'touchBankDisplay']);
  const effects = platform.effects ?? createFinanceBrowserEffects();
  requireMethods('effects', effects, ['isOnline', 'writeText', 'saveJson', 'delay', 'dispose']);
  const bridge = createFinanceBridgeIntegration(platform.bridge ? {platform:platform.bridge} : undefined);
  let disposed = false, cache = null, controller = null, presentation = null, archive = null, connections = null, bankConnections = null, bankSnapshots = null, bankRefresh = null, archiveReconciliation = null;
  const operationScope = createFinanceOperationScope({readAccess:() => {
    const access = readAccess();
    return {...access, readable:access.readable && !disposed, writable:access.writable && !disposed};
  }});
  // Cleanup retains account/storage authority independently of this capability's
  // lifetime. A changed login or leadership still leaves the former lease to TTL.
  const leaseAuthority = createFinanceOperationScope({readAccess});
  const selectors = createDomainsBankSelectors({model});
  const images = createOrdersBankChequeImageRuntime({cloudAuth:auth, bridge, operationScope});

  function active() { if (disposed) throw new Error('orders_finance_disposed'); }
  function readoutReady() { active(); if (!cache) throw new Error('orders_finance_readout_not_bound'); return cache; }
  function coreReady() { active(); if (!controller) throw new Error('orders_finance_core_not_bound'); return controller; }
  function uiReady() { active(); if (!presentation) throw new Error('orders_finance_ui_not_bound'); return presentation; }
  const controllerEffects = {
    isOnline:() => !disposed && effects.isOnline(),
    delay:(...args) => { active(); return effects.delay(...args); },
  };
  const connectionEffects = {
    writeText:(...args) => { active(); return effects.writeText(...args); },
    saveJson:(...args) => { active(); return effects.saveJson(...args); },
  };

  function bindReadout({cloud, display}) {
    active();
    if (cache) throw new Error('orders_finance_readout_already_bound');
    requireMethods('readout_cloud', cloud, ['readKupaReadOnlyCloud', 'readKupaReadOnlyMeta']);
    requireMethods('display', display, ['renderChecks', 'renderSummary', 'refreshAlerts']);
    cache = createDomainsBankCache({
      checksSession, ui, operationScope,
      isOnline:controllerEffects.isOnline,
      computeKupaNetReadout:selectors.computeKupaNetReadout,
      loadSession:auth.loadSession,
      readKupaReadOnlyCloud:(...args) => cloud.readKupaReadOnlyCloud(...args),
      readKupaReadOnlyMeta:(...args) => cloud.readKupaReadOnlyMeta(...args),
      renderKupa:(...args) => uiReady().view.renderKupa(...args),
      renderChecks:display.renderChecks, renderSummary:display.renderSummary,
      refreshAlertCenter:display.refreshAlerts,
      refreshBankAlertArchive:(...args) => coreReady().ensureBankDisplayArchive(...args),
      touchFinanceRevision:revisions.touchFinance,
    });
  }

  function bindCore({cloud, checks, toast}) {
    readoutReady();
    if (controller) throw new Error('orders_finance_core_already_bound');
    requireMethods('cloud', cloud, [
      'readKupaReadOnlyCloud', 'rpcSaveKupaDocument', 'readFinanceSyncDocument', 'rpcSaveFinanceSync',
      'claimFinanceSyncLease', 'releaseFinanceSyncLease', 'saveBankSyncSnapshot',
      'syncBankTransactionsSnapshot', 'readBankTransactions', 'readBankTransactionSnapshot',
      'setBankTransactionHandled', 'acknowledgeBankTransactionMissing', 'acknowledgeBankTransactionAlert',
    ]);
    requireMethods('checks', checks, ['syncSharedChecksFromCloud', 'saveSharedChecksToCloud', 'hasLocalWork']);
    if (typeof toast !== 'function') throw new TypeError('orders_finance_toast_required');
    const syncLeases = {
      claim:(...args) => cloud.claimFinanceSyncLease(...args),
      release:(...args) => cloud.releaseFinanceSyncLease(...args),
    };
    const documents = createOrdersFinanceDocumentCommands({
      operationScope,
      kupa:{
        read:(...args) => cloud.readKupaReadOnlyCloud(...args),
        save:(...args) => cloud.rpcSaveKupaDocument(...args),
        accept:(...args) => cache.acceptKupaCloudRow(...args),
      },
      finance:{
        read:(...args) => cloud.readFinanceSyncDocument(...args),
        save:(...args) => cloud.rpcSaveFinanceSync(...args),
        publishBankSnapshot:(...args) => cloud.saveBankSyncSnapshot(...args),
      },
      leases:syncLeases,
      readout:{refresh:(...args) => cache.refreshKupaReadout(...args)},
      delay:controllerEffects.delay,
    });
    archive = createOrdersBankArchiveReadout({
      authority:operationScope,
      sources:{
        targets:() => bankArchiveTargets(checksSession.kupaCloudReadState?.bank || {}),
        rows:() => bankArchiveSourceRows(checksSession.kupaCloudReadState?.bank || {}),
      },
      reads:{
        transactions:(...args) => cloud.readBankTransactions(...args),
        snapshot:(...args) => cloud.readBankTransactionSnapshot(...args),
      },
      access:{authenticated:() => !!auth.loadSession(),online:controllerEffects.isOnline},
      revision:{read:revisions.read,touch:revisions.touchBankDisplay},
      report:(role,error) => console.error(`orders bank display archive ${role}`,error),
    });
    connections = createOrdersCreditConnectionOwner({
      pairing:{token:() => bridge.getBridgeToken()},
      transport:{
        readStatus:() => bridge.creditStatus(), readDiagnostics:() => bridge.creditDiagnostics(),
        readData:() => bridge.creditDataDiagnostics(), saveProfile:payload => bridge.saveCreditProfile(payload),
        deleteProfile:id => bridge.deleteCreditProfile(id), resetProfiles:() => bridge.resetCreditProfiles(),
      },
      presentation:{toast:(...args) => { if (!disposed) toast(...args); }},
      effects:connectionEffects,
      protocol:{minimumBridgeVersion:73,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION},
    });
    bankConnections = createOrdersBankConnectionOwner({
      pairing:{token:() => bridge.getBridgeToken()},
      transport:{
        readStatus:() => bridge.status(), configure:payload => bridge.configureCredentials(payload),
        selectAccount:payload => bridge.selectAccount(payload), deleteCredentials:() => bridge.deleteCredentials(),
        readDiagnostics:() => bridge.bankDiagnostics(),
      },
      presentation:{toast:(...args) => { if (!disposed) toast(...args); }},
      effects:{saveJson:connectionEffects.saveJson},
      protocol:{minimumBridgeVersion:ORDERS_BANK_BRIDGE_MINIMUM_VERSION},
    });
    archiveReconciliation = createBankArchiveReconciliation({
      authority:operationScope,
      transactions:{reconcile:(...args) => cloud.syncBankTransactionsSnapshot(...args)},
      images:{sync:images.sync},archive:{read:archive.queries.readSnapshot},
    });
    bankSnapshots = createOrdersBankSnapshotPublication({
      reconciliation:archiveReconciliation,
      checks:{
        hasLocalWork:checks.hasLocalWork,
        save:(...args) => checks.saveSharedChecksToCloud(...args),
        refresh:(...args) => checks.syncSharedChecksFromCloud(...args),
        read:() => ({kupa:checksSession.kupaCloudReadState,bankEvents:checksSession.checksBankEvents}),
      },
      archive:{publish:archive.commands.publish},
      publication:{save:documents.commands.publishBankSnapshot},
      policy:createOrdersBankSnapshotPolicy(),
    });
    bankRefresh = createOrdersBankRefresh({
      authority:operationScope,
      cloud:{
        refresh:(...args) => cache.refreshKupaReadout(...args),
        readFinance:(...args) => documents.queries.readFinance(...args),
        lastSyncAt:() => coreReady().bankRefreshAutomation.lastSyncAt(),
      },
      device:{
        capture:() => bankConnections.queries.capture(),
        readStatus:() => bankConnections.queries.readStatus(),
        supported:status => bankConnections.queries.supported(status),
        fetchBalance:options => bridge.fetchBalance(options),
        recordScan:(...args) => bankConnections.commands.recordScan(...args),
      },
      leases:{
        ...createFinanceLeaseOwner({leases:syncLeases,authority:leaseAuthority,timers:platform.timers??globalThis}),
        createToken:() => uid('FINLEASE'),
        reportFailure:error => console.error('orders bank sync lease release',error),
      },
      publication:{prepare:bankSnapshots.commands.prepare,publish:bankSnapshots.commands.publish},
      automation:{
        allowed:() => coreReady().bankRefreshAutomation.allowed(),
        currentEpoch:() => coreReady().bankRefreshAutomation.currentEpoch(),
        due:bankAutoRefreshDue,
      },
    });
    const creditRefresh = createOrdersCreditRefresh({
      authority:operationScope,
      cloud:{refresh:(...args)=>cache.refreshKupaReadout(...args),readSync:()=>checksSession.kupaCloudReadState?.creditSync},
      device:{capture:connections.queries.capture,readStatus:connections.queries.readStatus,supported:connections.queries.supported,
        sync:options=>bridge.syncCreditCards(options),refreshStatus:connections.queries.refreshStatus,reportFailure:connections.commands.reportFailure},
      leases:{...createFinanceLeaseOwner({leases:syncLeases,authority:leaseAuthority,timers:platform.timers??globalThis}),
        createToken:()=>uid('FINLEASE'),reportFailure:error=>console.error('orders credit sync lease release',error)},
      policy:{normalizeMode:normalizeCreditFetchMode,resolveMode:resolveCreditAutoSyncMode,selection:creditSyncScrapeSelection,
        merge:mergeCreditSyncResult,lastSyncAt:sync=>normalizeCreditSync(sync).syncedAt},
      publication:{commit:documents.commands.mutateFinance},
      automation:{allowed:()=>coreReady().creditRefreshAutomation.allowed(),currentEpoch:()=>coreReady().creditRefreshAutomation.currentEpoch(),
        mode:()=>coreReady().creditRefreshAutomation.mode(),due:creditRefreshDue},
    });
    controller = createDomainsFinanceController({
      documents,creditRefresh,archive,connections,bankConnections,bankRefresh,
      tab, checksSession, bridge, operationScope, effects:controllerEffects,
      loadSession:auth.loadSession, toast:(...args) => { if (!disposed) toast(...args); }, getSharedChecks:() => model.state.checks,
      refreshKupaReadout:(...args) => cache.refreshKupaReadout(...args),
      setBankTransactionHandled:(...args) => cloud.setBankTransactionHandled(...args),
      acknowledgeBankTransactionMissing:(...args) => cloud.acknowledgeBankTransactionMissing(...args),
      acknowledgeBankTransactionAlert:(...args) => cloud.acknowledgeBankTransactionAlert(...args),
    });
  }

  function bindUi({layout, modal, date, checksView, dashboard, openBankMorningDocument, morningOperationScope, toast}) {
    coreReady();
    if (presentation) throw new Error('orders_finance_ui_already_bound');
    requireMethods('layout', layout, ['mountViewLayout']);
    requireMethods('modal', modal, ['modal', 'closeModal', 'confirmDialog']);
    requireMethods('date', date, ['dateEditorMarkup']);
    requireMethods('checks_view', checksView, ['checksMarkup', 'checksHeaderContextMarkup', 'syncChecksBulkUi']);
    requireMethods('dashboard', dashboard, ['summaryMarkup']);
    if (typeof openBankMorningDocument !== 'function' || typeof toast !== 'function') throw new TypeError('orders_finance_ui_commands_required');
    const ownedModal = {
      modal:(...args) => { if (!disposed) return modal.modal(...args); },
      closeModal:(...args) => { if (!disposed) return modal.closeModal(...args); },
      confirmDialog:async (...args) => {
        if (disposed) return false;
        const confirmed = await modal.confirmDialog(...args);
        return !disposed && confirmed;
      },
    };
    const notify = (...args) => { if (!disposed) toast(...args); };
    const reportRequest = morningOperationScope ? createMorningRequest({supaFetch:(...args) => auth.supaFetch(...args), operationScope:morningOperationScope}) : null;
    const reportMedia = reportRequest ? createMorningMediaComposition({request:reportRequest, modal:ownedModal.modal, toast:notify}).create({capture:() => morningOperationScope.captureRead(), onStandalone:() => {}}) : null;
    const reports = reportRequest ? createMorningReports({request:reportRequest.json, captureRead:() => morningOperationScope.captureRead(),
      subscribeAccountScope:listener => auth.subscribeAccountScope?.(listener) || (() => {}), media:reportMedia, dateEditorMarkup:date.dateEditorMarkup, isActive:() => !disposed}) : null;
    const view = createDomainsFinanceView({
      ui, controller, checksView, dashboardView:dashboard, runFinance, isActive:() => !disposed,
      mountViewLayout:layout.mountViewLayout, modal:ownedModal.modal, closeModal:ownedModal.closeModal,
      confirmDialog:ownedModal.confirmDialog, dateEditorMarkup:date.dateEditorMarkup,
      downloadBankChequeImage:images.download, openBankMorningDocument,
      morningReportsMarkup:() => reports?.markup() || '',
    });
    const importConnections = createFinanceConnectionImportCapability({
      bridge, getCreditProfiles:() => controller.snapshot().creditSync?.profiles || [],
      confirmDialog:ownedModal.confirmDialog, toast:notify,
      afterImport:async (_result,assertCurrent) => {
        assertCurrent();
        await Promise.all([controller.refreshBankBridgeStatus({quiet:true}), controller.refreshCreditBridgeStatus({quiet:true})]);
        assertCurrent();
        if (!disposed) view.renderKupa();
      },
    });
    const creditOrder = createCreditCardOrderView({
      isActive:() => !disposed,
      getSync:() => controller.snapshot().creditSync,
      saveOrder:(...args) => controller.saveCreditCardOrder(...args),
      modal:ownedModal.modal, closeModal:ownedModal.closeModal, render:view.renderKupa, escapeHtml:esc,
    });
    const packs = [
      {name:'morning-reports', actions:reports?.actions || {}},
      {name:'credit-order', actions:markMutationActions(creditOrder.actions, {finance:['credit-card-order-save']})},
      {name:'finance-bank', actions:createFinanceBankActions({domainsFinanceController:controller, domainsFinanceView:view, importFinanceConnections:importConnections.commands.importConnections, ui, uiStatus:{toast:notify}})},
      {name:'finance-credit', actions:createFinanceCreditActions({domainsFinanceView:view, ui})},
    ];
    const guardedPacks = packs.map(pack => ({...pack, actions:Object.fromEntries(
      Object.entries(pack.actions).map(([name, handler]) => {
        const guarded = (...args) => disposed ? false : handler(...args);
        if (handler.startupMutationDomain !== undefined) {
          Object.defineProperty(guarded, 'startupMutationDomain', {value:handler.startupMutationDomain});
        }
        return [name, guarded];
      }),
    )}));
    presentation = {view, importConnections, reports, packs:guardedPacks};
  }

  const queries = {
    snapshot:(...args) => coreReady().snapshot(...args),
    readSnapshot:(...args) => coreReady().readSnapshot(...args),
    ensureBankDisplayArchive:(...args) => coreReady().ensureBankDisplayArchive(...args),
    refreshFinanceData:(...args) => coreReady().refreshFinanceData(...args),
  };
  const commands = {
    refreshBank:(...args) => coreReady().refreshBank(...args),
    refreshCredit:(...args) => coreReady().refreshCredit(...args),
    saveCreditCardOrder:(...args) => coreReady().saveCreditCardOrder(...args),
    setAutomaticEnabled(kind, enabled) {
      if (kind !== 'bank' && kind !== 'credit') throw new TypeError('orders_finance_kind_required');
      return coreReady()[kind === 'bank' ? 'setBankAutoEnabled' : 'setCreditAutoEnabled'](enabled);
    },
    acknowledgeMissingBankTransaction:(...args) => coreReady().acknowledgeMissingBankTransaction(...args),
    acknowledgePersistentBankAlert:(...args) => coreReady().acknowledgePersistentBankAlert(...args),
    markBankMorningVerified:(...args) => coreReady().markBankMorningVerified(...args),
    saveCashflowMinimum:(...args) => coreReady().saveCashflowMinimum(...args),
    setCreditAutoMode:(...args) => coreReady().setCreditAutoMode(...args),
    resetCreditSync:(...args) => coreReady().resetCreditSync(...args),
  };
  const readout = {
    refreshKupaReadout:(...args) => readoutReady().refreshKupaReadout(...args),
    recomputeKupaNetFromCache:(...args) => readoutReady().recomputeKupaNetFromCache(...args),
    renderKupaDependentView:(...args) => readoutReady().renderKupaDependentView(...args),
  };
  const runtime = {
    isPending:() => !!(presentation?.reports?.runtime.isPending() || controller?.runtime.isPending() || archiveReconciliation?.runtime.isPending() || bankSnapshots?.runtime.isPending() || connections?.runtime.isPending() || bankConnections?.runtime.isPending() || archive?.runtime.isPending() || presentation?.view.connectionRuntime.isPending() || presentation?.importConnections.runtime.isPending()),
    async drain() {
      do { await Promise.all([presentation?.reports?.runtime.drain(), controller?.runtime.drain(), archiveReconciliation?.runtime.drain(), bankSnapshots?.runtime.drain(), connections?.runtime.drain(), bankConnections?.runtime.drain(), archive?.runtime.drain(), presentation?.view.connectionRuntime.drain(), presentation?.importConnections.runtime.drain()]); } while(runtime.isPending());
    },
    start() { uiReady(); return controller.startAutoSync(); },
    stop() { return controller?.stopAutoSync(); },
    wake(kind) {
      uiReady();
      if (kind !== 'bank' && kind !== 'credit') throw new TypeError('orders_finance_kind_required');
      return controller[kind === 'bank' ? 'maybeAutoRefreshBank' : 'maybeAutoRefreshCredit']();
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      presentation?.reports?.runtime.dispose();
      archiveReconciliation?.runtime.dispose();
      bankSnapshots?.runtime.dispose();
      presentation?.importConnections.runtime.dispose();
      presentation?.view.connectionRuntime.dispose();
      controller?.runtime.dispose();
      connections?.runtime.dispose();
      bankConnections?.runtime.dispose();
      archive?.runtime.dispose();
      controller?.setFinanceStatusListener(() => {});
      effects.dispose();
      return true;
    },
  };
  return {
    bindReadout, bindCore, bindUi, assertReady:() => { uiReady(); return true; },
    queries, commands, readout, runtime,
    presentation:{renderKupa:(...args) => uiReady().view.renderKupa(...args)},
    customerBankPort:() => ({
      getTransactions:() => queries.snapshot().bank?.feed?.transactions || [],
      ensureTransactions:async () => { await queries.ensureBankDisplayArchive(); return queries.snapshot().bank?.feed?.transactions || []; },
      onDocumentVerified:commands.markBankMorningVerified,
    }),
    actionPacks:() => uiReady().packs,
  };
}
