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

function createLazyMorningPanel(kind, ports, notify) {
  let feature = null, flight = null, active = true;
  const reports = kind === 'reports', stem = reports ? 'morning-report' : 'morning-expense', prefix = stem + '-';
  function markup({page = false} = {}) {
    if (!reports && !page) return `<section class="morning-expense-intake" data-morning-expense-launcher><button type="button" class="morning-expense-trigger" data-action="morning-expense-toggle"><b>קליטת הוצאות ב־Morning</b><span aria-hidden="true">←</span></button></section>`;
    if (feature) return feature.markup();
    if (!reports && page) return `<section class="morning-expense-intake" data-morning-expense-intake><header class="morning-expense-heading"><h1>קליטת הוצאות ב־Morning</h1><button type="button" class="btn" data-action="morning-expense-back">חזרה למאזן ודוחות</button></header><p class="morning-expense-content" role="status">טוען את מסך ההוצאות…</p></section>`;
    const panel = stem + (reports ? 's' : '-intake');
    return `<section class="${panel}" data-${panel}><div class="${stem}-heading"><button type="button" class="${stem}-trigger" data-action="${prefix}toggle" aria-expanded="false"><span><b>${reports ? 'דוחות מורנינג' : 'קליטת הוצאות ב־Morning'}</b>${reports ? '<small>תקבולים לפי אמצעי תשלום · רווח והפסד · מע״מ</small>' : ''}</span><span aria-hidden="true">⌄</span></button></div></section>`;
  }
  async function ensure() {
    if (!active || feature) return active ? feature : null;
    if (!flight) flight = (reports ? import('./morning-reports.js') : import('./morning-expenses.js')).then(module => {
      if (active) feature = (reports ? module.createFinanceMorningReports : module.createFinanceMorningExpenses)(ports);
      return feature;
    }).finally(() => { flight = null; });
    return flight;
  }
  const names = (reports ? 'toggle period option load cancel type detail detail-page record export pdf' : 'toggle back field save upload files dragover drop keyboard paste command write history-query history-search-enter').split(' ');
  const actions = Object.fromEntries(names.map(name => [prefix + name, (...args) => {
    if (!active) return false;
    if (!reports && name === 'back') return active ? ports.back() : false;
    if (!reports && name === 'toggle') ports.open();
    if (feature) return active ? feature.actions[prefix + name](...args) : false;
    return ensure().then(loaded => active ? loaded?.actions[prefix + name](...args) : false)
      .catch(() => {
        if (active) {
          notify('מסך Morning אינו זמין כרגע');
          const output = !reports && !feature && document.querySelector('[data-morning-expense-intake] .morning-expense-content');
          if (output) output.innerHTML = '<p role="alert">לא ניתן לטעון כרגע את מסך ההוצאות.</p><button type="button" class="btn" data-action="morning-expense-toggle">ניסיון נוסף</button>';
        }
        return false;
      });
  }]));
  if (!reports) markMutationActions(actions, {finance:['save', 'upload', 'keyboard', 'write'].map(name => prefix + name)});
  return {markup, actions, runtime:{
    isPending:() => !!flight || feature?.runtime.isPending() === true,
    drain:async () => { await flight?.catch(() => {}); await feature?.runtime.drain(); },
    dispose:() => { if (!active) return false; active = false; feature?.runtime.dispose(); return true; },
  }};
}

// Checks needs the Finance readout before cloud and UI binding.
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
  // Cleanup keeps its original account/storage fence; changed owners leave leases to TTL.
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
    if (morningOperationScope) requireMethods('morning_auth', auth, ['getAccountScope', 'subscribeAccountScope']);
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
    const [reports, expenses] = morningOperationScope ? ['reports', 'expenses'].map(kind => createLazyMorningPanel(kind, {
      auth, morningOperationScope, modal:ownedModal.modal, confirmDialog:ownedModal.confirmDialog, toast:notify,
      dateEditorMarkup:date.dateEditorMarkup, isActive:() => !disposed,
      open:() => {ui.currentView = 'kupa'; ui.kupaSubView = 'expenses'; view.renderKupa({resetScroll:true});},
      back:() => {ui.kupaSubView = 'summary'; view.renderKupa({resetScroll:true});},
    }, notify)) : [null, null];
    const view = createDomainsFinanceView({
      ui, controller, checksView, dashboardView:dashboard, runFinance, isActive:() => !disposed,
      mountViewLayout:layout.mountViewLayout, modal:ownedModal.modal, closeModal:ownedModal.closeModal,
      confirmDialog:ownedModal.confirmDialog, dateEditorMarkup:date.dateEditorMarkup,
      downloadBankChequeImage:images.download, openBankMorningDocument,
      morningReportsMarkup:() => reports?.markup() || '',
      morningExpensesMarkup:options => expenses?.markup(options) || '',
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
      {name:'morning-expenses', actions:expenses?.actions || {}},
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
    presentation = {view, packs:guardedPacks, runtimes:[reports?.runtime, expenses?.runtime, importConnections.runtime, view.connectionRuntime]};
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
  const ownedRuntimes = () => [...(presentation?.runtimes || []), archiveReconciliation?.runtime, bankSnapshots?.runtime, controller?.runtime,
    connections?.runtime, bankConnections?.runtime, archive?.runtime].filter(Boolean);
  const runtime = {
    isPending:() => ownedRuntimes().some(owner => owner.isPending()),
    async drain() {
      do { await Promise.all(ownedRuntimes().map(owner => owner.drain())); } while(runtime.isPending());
    },
    start() { uiReady(); return controller.startAutoSync(); },
    resume() { uiReady(); return controller.resumeAutoSync(); },
    stop() { return controller?.stopAutoSync(); },
    wake(kind) {
      uiReady();
      if (kind !== 'bank' && kind !== 'credit') throw new TypeError('orders_finance_kind_required');
      return controller[kind === 'bank' ? 'maybeAutoRefreshBank' : 'maybeAutoRefreshCredit']();
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      ownedRuntimes().forEach(owner => owner.dispose());
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
