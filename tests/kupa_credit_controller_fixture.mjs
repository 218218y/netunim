import { createDomainsCreditController } from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import {createFinanceLeaseOwner} from '../shared/finance-lease-owner.js';
import {createKupaCreditRefresh} from '../netunim-kupa/site/assets/js/domains/credit/refresh.js';
import {createCreditPublication} from '../netunim-kupa/site/assets/js/domains/credit/publication.js';
import {normalizeCreditFetchMode,resolveCreditAutoSyncMode} from '../shared/credit-sync-policy.js';
import {creditRefreshDue} from '../shared/finance-refresh-policy.js';
import {uid} from '../netunim-kupa/site/assets/js/core/values.js';
import { createCreditConnectionOwner } from '../netunim-kupa/site/assets/js/domains/credit/connection-owner.js';
import {
  normalizeCreditSync,
  mergeCreditSyncResult,creditSyncScrapeSelection,
  CREDIT_CONNECTOR_CONTRACT_VERSION,
} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';

// Old test inputs map to real owners. No production compatibility constructor or
// synthetic data/profile/IO implementation is introduced by this test helper.
export function createKupaCreditControllerFixture(ports) {
  const connections = createCreditConnectionOwner({
    protocol: { minimumBridgeVersion: 73, contractVersion: CREDIT_CONNECTOR_CONTRACT_VERSION },
    pairing: { token: () => ports.bridge.getBridgeToken() },
    transport: {
      readStatus: () => ports.bridge.creditStatus(),
      readDiagnostics: () => ports.bridge.creditDiagnostics(),
      readData: () => ports.bridge.creditDataDiagnostics(),
      saveProfile: (payload) => ports.bridge.saveCreditProfile(payload),
      deleteProfile: (profileId) => ports.bridge.deleteCreditProfile(profileId),
    },
    effects: ports.effects,
    profiles: { read: () => normalizeCreditSync(ports.model.state.creditSync).profiles },
    presentation: {
      toast: (...args) => ports.toast(...args),
      render: (...args) => ports.render(...args),
      confirmDialog: (...args) => ports.confirmDialog(...args),
    },
  });
  const syncLeases=createFinanceLeaseOwner({
    leases:{claim:ports.claimFinanceSyncLease??(async(leaseName,leaseToken)=>({acquired:true,leaseName,leaseToken,fenceEpoch:1})),release:ports.releaseFinanceSyncLease??(async()=>true)},
    authority:{capture:ports.captureOperation},timers:ports.timers??globalThis,
  });
  const refreshFinance=ports.refreshFinanceCloudSnapshot??(async()=>({verified:true,state:ports.model.state}));
  const publication=createCreditPublication({commit:ports.saveFinancePatch??(async()=>({saved:false})),read:refreshFinance,
    publish:state=>{ports.model.state.creditSync=normalizeCreditSync(state.creditSync)},
    checkpoint:message=>ports.saveState(message,{operations:[{type:'set',field:'creditSync',value:ports.model.state.creditSync}]}),
  });
  let controller;
  const creditRefresh=createKupaCreditRefresh({
    authority:{capture:ports.captureOperation},cloud:{refresh:refreshFinance,readSync:()=>ports.model.state.creditSync},
    device:{capture:connections.queries.capture,status:()=>connections.queries.snapshot().status,error:()=>connections.queries.snapshot().bridgeError,
      supported:connections.queries.supported,sync:options=>ports.bridge.syncCreditCards(options),refreshStatus:connections.queries.refreshStatus},
    leases:{...syncLeases,createToken:()=>uid('FINLEASE'),reportFailure:error=>console.error('credit sync lease release',error)},
    policy:{normalizeMode:normalizeCreditFetchMode,resolveMode:resolveCreditAutoSyncMode,selection:creditSyncScrapeSelection,merge:mergeCreditSyncResult,lastSyncAt:sync=>sync?.syncedAt},
    publication:{publish:(candidate,message,lease,assertCurrent,assertRetained)=>publication.commit(state=>({...state,creditSync:candidate}),message,lease,assertCurrent,assertRetained)},
    automation:{due:creditRefreshDue,mode:()=>controller.refreshAutomation.mode(),markAttempt:()=>controller.refreshAutomation.markAttempt()},
  });
  controller = createDomainsCreditController({ ...ports, connections, publication,creditRefresh });
  const runtime = controller.runtime;
  controller.runtime = {
    isPending: () => runtime.isPending() || connections.runtime.isPending(),
    async drain() {
      await Promise.all([runtime.drain(), connections.runtime.drain()]);
    },
    dispose() {
      connections.runtime.dispose();
      return runtime.dispose();
    },
  };
  return controller;
}
