import { createDomainsFinanceController } from '../netunim-orders/site/assets/js/domains/finance/controller.js';
import { createOrdersFinanceDocumentCommands } from '../netunim-orders/site/assets/js/domains/finance/document-commands.js';
import { createOrdersBankArchiveReadout } from '../netunim-orders/site/assets/js/domains/finance/bank-archive-readout.js';
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
  return createDomainsFinanceController({ ...ports, documents, syncLeases, archive });
}
