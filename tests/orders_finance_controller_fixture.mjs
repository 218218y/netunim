import { createDomainsFinanceController } from '../netunim-orders/site/assets/js/domains/finance/controller.js';
import {createFinanceLeaseOwner} from '../shared/finance-lease-owner.js';
import { createOrdersFinanceDocumentCommands } from '../netunim-orders/site/assets/js/domains/finance/document-commands.js';
import { createOrdersBankSnapshotPublication } from '../netunim-orders/site/assets/js/domains/finance/bank-snapshot-publication.js';
import { createOrdersBankSnapshotPolicy } from '../netunim-orders/site/assets/js/domains/finance/bank-snapshot-policy.js';
import {createOrdersBankRefresh} from '../netunim-orders/site/assets/js/domains/finance/bank-refresh.js';
import {createOrdersCreditRefresh} from '../netunim-orders/site/assets/js/domains/finance/credit-refresh.js';
import {bankAutoRefreshDue,creditRefreshDue} from '../shared/finance-refresh-policy.js';
import {normalizeCreditFetchMode,resolveCreditAutoSyncMode} from '../shared/credit-sync-policy.js';
import {normalizeCreditSync,mergeCreditSyncResult,creditSyncScrapeSelection} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {uid} from '../netunim-orders/site/assets/js/core/values.js';
import {createBankArchiveReconciliation} from '../shared/bank-archive-reconciliation.js';
import { createOrdersBankArchiveReadout } from '../netunim-orders/site/assets/js/domains/finance/bank-archive-readout.js';
import { createOrdersCreditConnectionOwner } from '../netunim-orders/site/assets/js/domains/finance/credit-connection-owner.js';
import {
  createOrdersBankConnectionOwner,
  ORDERS_BANK_BRIDGE_MINIMUM_VERSION,
} from '../netunim-orders/site/assets/js/domains/finance/bank-connection-owner.js';
import { CREDIT_CONNECTOR_CONTRACT_VERSION } from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {
  bankArchiveTargets,
  bankArchiveSourceRows,
} from '../netunim-orders/site/assets/js/domains/finance/bank-archive-model.js';

const unexpected = () => {
  throw new Error('unexpected Finance fixture document operation');
};

// Read-only controller fixtures get inert, complete ports. Write fixtures still
// call the actual command owner and supply the cloud operation under test.
export function createOrdersFinanceControllerFixture(ports) {
  const syncLeases = {
    claim:
      ports.claimFinanceSyncLease ??
      (async (leaseName, leaseToken) => ({ acquired: true, leaseName, leaseToken, fenceEpoch: 1 })),
    release: ports.releaseFinanceSyncLease ?? (async () => true),
  };
  const documents = createOrdersFinanceDocumentCommands({
    operationScope: ports.operationScope,
    kupa: {
      read: ports.readKupaReadOnlyCloud ?? unexpected,
      save: ports.rpcSaveKupaDocument ?? unexpected,
      accept: ports.acceptKupaCloudRow ?? unexpected,
    },
    finance: {
      read: ports.readFinanceSyncDocument ?? (async () => ({ revision: 0, state: {} })),
      save: ports.rpcSaveFinanceSync ?? unexpected,
      publishBankSnapshot: ports.saveBankSyncSnapshot ?? unexpected,
    },
    leases: syncLeases,
    readout: { refresh: ports.refreshKupaReadout ?? unexpected },
    delay: ports.effects.delay,
  });
  const archive = createOrdersBankArchiveReadout({
    authority: ports.operationScope,
    sources: {
      targets: () => bankArchiveTargets(ports.checksSession?.kupaCloudReadState?.bank || {}),
      rows: () => bankArchiveSourceRows(ports.checksSession?.kupaCloudReadState?.bank || {}),
    },
    reads: {
      transactions: ports.readBankTransactions ?? (async () => []),
      snapshot: ports.readBankTransactionSnapshot ?? (async () => null),
    },
    access: { authenticated: () => !!ports.loadSession?.(), online: ports.effects.isOnline },
    revision: { read: ports.readRevision, touch: ports.touchBankDisplayRevision ?? (() => {}) },
    report: (role, error) => console.error(`orders bank display archive ${role}`, error),
  });
  const connections = createOrdersCreditConnectionOwner({
    pairing: { token: () => ports.bridge.getBridgeToken() },
    transport: {
      readStatus: () => ports.bridge.creditStatus(),
      readDiagnostics: () => ports.bridge.creditDiagnostics(),
      readData: () => ports.bridge.creditDataDiagnostics(),
      saveProfile: (payload) => ports.bridge.saveCreditProfile(payload),
      deleteProfile: (id) => ports.bridge.deleteCreditProfile(id),
      resetProfiles: () => ports.bridge.resetCreditProfiles(),
    },
    presentation: { toast: (...args) => ports.toast?.(...args) },
    effects: ports.effects,
    protocol: { minimumBridgeVersion: 73, contractVersion: CREDIT_CONNECTOR_CONTRACT_VERSION },
  });
  const bankConnections =
    ports.bankConnections ??
    createOrdersBankConnectionOwner({
      pairing: { token: () => ports.bridge.getBridgeToken() },
      transport: {
        readStatus: () => ports.bridge.status(),
        configure: (payload) => ports.bridge.configureCredentials(payload),
        selectAccount: (payload) => ports.bridge.selectAccount(payload),
        deleteCredentials: () => ports.bridge.deleteCredentials(),
        readDiagnostics: () => ports.bridge.bankDiagnostics(),
      },
      effects: { saveJson: ports.effects.saveJson ?? unexpected },
      presentation: { toast: (message) => ports.toast?.(message) },
      protocol: { minimumBridgeVersion: ORDERS_BANK_BRIDGE_MINIMUM_VERSION },
    });
  const archiveReconciliation = createBankArchiveReconciliation({
    authority:ports.operationScope,
    transactions:{reconcile:ports.syncBankTransactionsSnapshot ?? unexpected},
    images:{sync:ports.syncBankChequeImages ?? (async()=>({warnings:[]}))},
    archive:{read:archive.queries.readSnapshot},
  });
  const bankSnapshots = createOrdersBankSnapshotPublication({
    reconciliation:archiveReconciliation,
    checks:{
      hasLocalWork:ports.checksHaveLocalWork ?? (() => false),
      save:ports.saveSharedChecksToCloud ?? unexpected,
      refresh:ports.syncSharedChecksFromCloud ?? unexpected,
      read:() => ({kupa:ports.checksSession?.kupaCloudReadState,bankEvents:ports.checksSession?.checksBankEvents}),
    },
    archive:{publish:archive.commands.publish},
    publication:{save:documents.commands.publishBankSnapshot},
    policy:createOrdersBankSnapshotPolicy(),
  });
  let controller;
  const bankRefresh=createOrdersBankRefresh({
    authority:ports.operationScope,
    cloud:{refresh:ports.refreshKupaReadout??unexpected,readFinance:documents.queries.readFinance,lastSyncAt:()=>controller.bankRefreshAutomation.lastSyncAt()},
    device:{capture:bankConnections.queries.capture,readStatus:bankConnections.queries.readStatus,supported:bankConnections.queries.supported,fetchBalance:(...args)=>ports.bridge.fetchBalance(...args),recordScan:bankConnections.commands.recordScan},
    leases:{...createFinanceLeaseOwner({leases:syncLeases,authority:ports.operationScope,timers:ports.timers??globalThis}),createToken:()=>uid('FINLEASE'),reportFailure:error=>console.error('orders bank sync lease release',error)},
    publication:{prepare:bankSnapshots.commands.prepare,publish:bankSnapshots.commands.publish},
    automation:{allowed:()=>controller.bankRefreshAutomation.allowed(),currentEpoch:()=>controller.bankRefreshAutomation.currentEpoch(),due:bankAutoRefreshDue},
  });
  const creditRefresh=createOrdersCreditRefresh({
    authority:ports.operationScope,
    cloud:{refresh:ports.refreshKupaReadout??unexpected,readSync:()=>ports.checksSession?.kupaCloudReadState?.creditSync},
    device:{capture:connections.queries.capture,readStatus:connections.queries.readStatus,supported:connections.queries.supported,
      sync:options=>ports.bridge.syncCreditCards(options),refreshStatus:connections.queries.refreshStatus,reportFailure:connections.commands.reportFailure},
    leases:{...createFinanceLeaseOwner({leases:syncLeases,authority:ports.operationScope,timers:ports.timers??globalThis}),createToken:()=>uid('FINLEASE'),reportFailure:error=>console.error('orders credit sync lease release',error)},
    policy:{normalizeMode:normalizeCreditFetchMode,resolveMode:resolveCreditAutoSyncMode,selection:creditSyncScrapeSelection,merge:mergeCreditSyncResult,lastSyncAt:sync=>normalizeCreditSync(sync).syncedAt},
    publication:{commit:documents.commands.mutateFinance},
    automation:{allowed:()=>controller.creditRefreshAutomation.allowed(),currentEpoch:()=>controller.creditRefreshAutomation.currentEpoch(),mode:()=>controller.creditRefreshAutomation.mode(),due:creditRefreshDue},
  });
  controller = createDomainsFinanceController({
    ...ports,
    documents,
    creditRefresh,
    archive,
    connections,
    bankConnections,
    bankRefresh,
  });
  return {
    ...controller,
    runtime: {
      dispose: () => {
        archiveReconciliation.runtime.dispose();
        bankSnapshots.runtime.dispose();
        const closed = controller.runtime.dispose();
        connections.runtime.dispose();
        bankConnections.runtime.dispose();
        archive.runtime.dispose();
        return closed;
      },
      isPending: () =>
        controller.runtime.isPending() ||
        archiveReconciliation.runtime.isPending() ||
        bankSnapshots.runtime.isPending() ||
        connections.runtime.isPending() ||
        bankConnections.runtime.isPending() ||
        archive.runtime.isPending(),
      drain: async () => {
        await Promise.all([
          controller.runtime.drain(),
          archiveReconciliation.runtime.drain(),
          bankSnapshots.runtime.drain(),
          connections.runtime.drain(),
          bankConnections.runtime.drain(),
          archive.runtime.drain(),
        ]);
      },
    },
  };
}
