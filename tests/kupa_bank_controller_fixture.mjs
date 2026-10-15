import { createDomainsBankController } from '../netunim-kupa/site/assets/js/domains/bank/controller.js';
import {createFinanceLeaseOwner} from '../shared/finance-lease-owner.js';
import { createKupaBankConnectionOwner, KUPA_BANK_BRIDGE_MINIMUM_VERSION } from '../netunim-kupa/site/assets/js/domains/bank/connection-owner.js';
import { createKupaBankArchiveReadout } from '../netunim-kupa/site/assets/js/domains/bank/archive-readout.js';
import {createBankArchiveReconciliation} from '../shared/bank-archive-reconciliation.js';
import { bankArchiveTargets } from '../netunim-kupa/site/assets/js/domains/bank/archive-model.js';
import { createBankLocalSnapshot } from '../netunim-kupa/site/assets/js/domains/bank/local-snapshot.js';
import { createKupaBankSnapshotCommands } from '../netunim-kupa/site/assets/js/domains/bank/snapshot-commands.js';
import {createKupaBankRefresh} from '../netunim-kupa/site/assets/js/domains/bank/refresh.js';
import {createKupaBankSnapshotPolicy} from '../netunim-kupa/site/assets/js/domains/bank/snapshot-policy.js';
import {BANK_READOUT_WARNING} from '../netunim-kupa/site/assets/js/domains/bank/snapshot-commands.js';
import {normalizeBankFeed} from '../netunim-kupa/site/assets/js/domains/bank/feed.js';
import {bankRecurringDebitHistoryData} from '../shared/bank-recurring-debits.js';
import {bankAutoRefreshDue} from '../shared/finance-refresh-policy.js';
import {wholeMoney} from '../netunim-kupa/site/assets/js/core/money.js';
import { createManualBankSnapshot } from '../netunim-kupa/site/assets/js/domains/bank/manual-snapshot.js';
import { uid } from '../netunim-kupa/site/assets/js/core/values.js';
import { todayISO } from '../netunim-kupa/site/assets/js/core/dates.js';

// Explicit test ports route the actual archive owner. No production legacy API.
export function createKupaBankControllerFixture(ports) {
  if (
    typeof ports.autoScope !== 'function' ||
    typeof ports.operationScope?.capture !== 'function' ||
    typeof ports.operationScope?.captureRead !== 'function'
  )
    return createDomainsBankController(ports);
  const archive = createKupaBankArchiveReadout({
    authority: ports.operationScope,
    sources: { targets: () => bankArchiveTargets(ports.model.state.bank || {}) },
    reads: {
      transactions: ports.readBankTransactions ?? (async () => []),
      snapshot: ports.readBankTransactionSnapshot ?? (async () => null),
    },
    access: { cloud: () => ports.session.connectionMode === 'supabase' },
    publication: () => {
      ports.touchBankDisplayRevision?.();
      ports.render?.();
    },
    report: (role, error) => console.error(`bank display archive ${role}`, error),
  });
  const pick = (name, fallback) => (Object.hasOwn(ports, name) ? ports[name] : fallback);
  const unexpected = () => {
    throw new Error('unexpected Bank fixture cloud publication');
  };
  const syncLeases = {
    claim: pick('claimFinanceSyncLease', async (leaseName,leaseToken) => ({
      acquired: true,
      leaseName,
      leaseToken,
      fenceEpoch: 1,
    })),
    release: pick('releaseFinanceSyncLease', async () => true),
  };
  for (const method of ['claim', 'release'])
    if (typeof syncLeases[method] !== 'function')
      throw new TypeError('kupa_bank_lease_' + method + '_required');
  const localSnapshot = createBankLocalSnapshot({
    model: ports.model,
    saveState: ports.saveState,
    recoverLocalState: ports.recoverLocalState ?? (async () => false),
    render: ports.render,
  });
  const readFinance = pick('refreshFinanceCloudSnapshot', async () => ({
    verified: true,
    state: ports.model.state,
  }));
  const snapshots = createKupaBankSnapshotCommands({
    authority: ports.operationScope,
    bank: {
      mode: () => ports.session.connectionMode,
      manualCandidate: (numeric, options) => {
        const seq = ports.sharedChecksObservedSequence();
        return createManualBankSnapshot(ports.model.state.bank, numeric, seq, options, {
          now: () => new Date().toISOString(),
          today: todayISO,
          createToken: () => uid('BANK'),
        });
      },
    },
    checks: {
      hasLocalWork: ports.sharedChecksHaveLocalWork ?? (() => false),
      saveCloud: ports.saveSharedChecksToCloud ?? (async () => true),
      syncCloud: ports.syncSharedChecksFromCloud ?? (async () => true),
    },
    local: localSnapshot,
    cloud: { publish: pick('saveBankSyncSnapshot', unexpected), refresh: readFinance },
    publication: {
      bank: (value) => {
        ports.model.state.bank = value;
      },
      archive: archive.commands.publish,
      data: () => {
        ports.touchBankDataRevision?.();
      },
    },
  });
  if(typeof ports.bridge.status!=='function')ports.bridge.status=async()=>({bridgeVersion:74,configured:true});
  const connections = createKupaBankConnectionOwner({
    pairing:{read:() => ports.bridge.getBridgeToken(),write:value => ports.bridge.setBridgeToken(value)},
    transport:{readStatus:() => ports.bridge.status(),configure:input => ports.bridge.configureCredentials(input),selectAccount:input => ports.bridge.selectAccount(input),deleteCredentials:() => ports.bridge.deleteCredentials(),readDiagnostics:() => ports.bridge.bankDiagnostics()},
    presentation:{toast:ports.toast,changed:ports.render},effects:ports.effects,
    clock:{now:() => Date.now()},protocol:{minimumBridgeVersion:KUPA_BANK_BRIDGE_MINIMUM_VERSION,statusCacheMs:15000},
  });
  const archiveReconciliation = createBankArchiveReconciliation({
    authority:ports.operationScope,
    transactions:{reconcile:ports.syncBankTransactionsSnapshot ?? (async()=>({sourcePayload:[],result:{total_count:0}}))},
    images:{sync:ports.syncBankChequeImages ?? (async()=>({warnings:[]}))},
    archive:{read:archive.queries.readSnapshot},
  });
  let controller;
  const bankRefresh=createKupaBankRefresh({
    authority:ports.operationScope,
    cloud:{mode:()=>ports.session.connectionMode,refresh:readFinance,currentState:()=>ports.model.state,
      lastSyncAt:state=>controller.refreshReadout.lastSyncAt(state),checksHaveLocalWork:ports.sharedChecksHaveLocalWork??(()=>false)},
    device:{capture:connections.queries.capture,readStatus:connections.queries.readStatus,supported:connections.queries.supported,fetchBalance:options=>ports.bridge.fetchBalance(options)},
    leases:{...createFinanceLeaseOwner({leases:syncLeases,authority:ports.operationScope,timers:ports.timers??globalThis}),createToken:()=>uid('FINLEASE'),reportFailure:error=>console.error('bank sync lease release',error)},
    publication:{prepare:snapshots.commands.prepare,reconcile:archiveReconciliation.commands.sync,publishCloud:snapshots.commands.publishCloud,publishLocal:snapshots.commands.publishLocal,readoutWarning:BANK_READOUT_WARNING},
    policy:createKupaBankSnapshotPolicy({
      feeds:{normalize:normalizeBankFeed,recurringHistory:bankRecurringDebitHistoryData,roundMoney:wholeMoney},
      source:{readBank:()=>ports.model.state.bank&&typeof ports.model.state.bank==='object'?ports.model.state.bank:{},observedSequence:()=>ports.sharedChecksObservedSequence()},
      identity:{now:()=>new Date().toISOString(),today:todayISO,createToken:()=>uid('BANK')},
    }),
    automation:{due:bankAutoRefreshDue,markAttempt:()=>ports.bridge.markAutoAttempt()},
  });
  controller = createDomainsBankController({
      ...ports,
      archive,
      snapshots,
      bankRefresh,
      connections,
    });
  const runtime = controller.runtime;
  return {
    ...controller,
    runtime: {
      async drain() {
        await runtime.drain();
        await archiveReconciliation.runtime.drain();
        await connections.runtime.drain();
        await archive.runtime.drain();
      },
      dispose() {
        archiveReconciliation.runtime.dispose();
        const result = runtime.dispose();
        connections.runtime.dispose();
        archive.runtime.dispose();
        return result;
      },
    },
  };
}
