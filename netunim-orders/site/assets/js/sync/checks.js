import {createSharedChecksFlight,createDeferredCheckBankRefresh} from '../shared/shared-checks-flight.js';
import {eq} from './merge-records.js';
import {mergeSharedChecks} from './checks-merge.js';
import {clone} from '../core/values.js';
import {sharedChecksHeadIsSynced} from '../shared/shared-checks-status.js';

export function createSyncChecks({
  sharedChecksV2, model, files={}, checksSession={}, tab, toast,
  recomputeKupaNetFromCache, renderKupaDependentView, writeStateToFolder,
  loadSession, setCloud, refreshCloudTimestamp, isOnline=() => globalThis.navigator?.onLine !== false,
}) {
  // Only observations are published to state; promises belong to this owner.
  const slots = {};
  let disposed = false;
  const flight = createSharedChecksFlight({state:slots, pullKey:'pull', saveKey:'save', busyKey:'busy'});
  Object.defineProperty(checksSession, 'checksCloudBusy', {configurable:true, enumerable:true, get:() => slots.busy});
  const bankRefresh=createDeferredCheckBankRefresh({owner:()=>loadSession()?.user?.id,
    ready:()=>!disposed&&tab.primaryTab&&isOnline()&&!!loadSession()?.user?.id&&sharedChecksV2?.primaryReady,
    checks:()=>model.state.checks,refresh:()=>sharedChecksV2.refreshBankMatches(),
    sync:()=>syncSharedChecksFromCloud({quiet:true}),render:renderKupaDependentView,toast});
  const runtime = {
    cancelBankRefresh:bankRefresh.cancel,
    isSaving:() => !!slots.save,
    isPending:() => !!(slots.pull || slots.save),
    async drain() {
      while (slots.pull || slots.save) await Promise.all([slots.pull, slots.save].filter(Boolean));
      await bankRefresh.drain();
    },
    dispose() { if (disposed) return false; disposed = true; bankRefresh.dispose(); return true; },
  };

  function rememberCloud(cloud) {
    checksSession.checksCloudBase = clone(cloud.base.state.checks);
    checksSession.checksCloudRevision = cloud.base.revision;
    checksSession.checksCloudUpdatedAt = sharedChecksV2.lastRemoteUpdatedAt || checksSession.checksCloudUpdatedAt;
    checksSession.checksBankEvents = clone(cloud.base.state.bankEvents);
    checksSession.checksSaveRequested = !!cloud.pending && !cloud.control?.conflict;
    checksSession.checksCloudLastError = cloud.control?.conflict
      ? 'אותו צ׳ק שונה במקביל — נדרשת הכרעה' : cloud.control?.retry?.lastErrorCode || '';
    recomputeKupaNetFromCache();
  }

  async function syncChecksV2({required=false, quiet=false}={}) {
    const account = loadSession()?.user?.id;
    const current = () => !disposed && !!account && tab.primaryTab && isOnline() && loadSession()?.user?.id === account;
    if (!current()) return false;
    setCloud('ענן: בודק צ׳קים…');
    try {
      const ok = await sharedChecksV2.sync();
      if (!current()) return false;
      const observed = await sharedChecksV2.cloudState();
      if (!current()) return false;
      if (!sharedChecksV2.primaryReady) throw new Error('shared_checks_owner_handoff_required');
      rememberCloud(observed);
      let cloud = observed;
      if (files.dirHandle) {
        await writeStateToFolder();
        cloud = await sharedChecksV2.cloudState();
      }
      if (!current()) return false;
      if (!sharedChecksV2.primaryReady) throw new Error('shared_checks_owner_handoff_required');
      if (cloud.base?.owner !== observed.base?.owner || cloud.base?.epoch !== observed.base?.epoch) return false;
      const synced = !!ok && sharedChecksHeadIsSynced(cloud, {
        checks:model.state.checks, hasLocalWork:sharedChecksV2.hasLocalWork, observedHead:observed,
      });
      if (cloud !== observed) rememberCloud(cloud);
      setCloud(cloud.control?.conflict ? 'ענן: התנגשות בצ׳קים' : synced ? 'ענן: מסונכרן' : 'ענן: צ׳קים ממתינים לסנכרון',
        cloud.control?.conflict ? 'error' : synced ? 'synced' : '', checksSession.checksCloudLastError);
      refreshCloudTimestamp();
      if (!quiet) renderKupaDependentView();
      if(synced)bankRefresh.observe();
      return synced;
    } catch (error) {
      if (current()) {
        checksSession.checksCloudLastError = error.message;
        setCloud('ענן: בדיקת הצ׳קים נכשלה', 'error', error.message);
        if (!quiet) toast(error.message);
      }
      if (required) throw error;
      return false;
    }
  }

  async function syncSharedChecksFromCloud({quiet=false, required=false}={}) {
    if (disposed) return false;
    if (!sharedChecksV2?.requested) {
      const error = new Error('shared_checks_v2_required');
      checksSession.checksCloudLastError = error.message;
      if (required) throw error;
      return false;
    }
    return flight.pull(() => syncChecksV2({quiet, required}));
  }

  async function saveSharedChecksToCloud() {
    if (disposed) return false;
    if (!sharedChecksV2?.requested) {
      checksSession.checksCloudLastError = 'shared_checks_v2_required';
      return false;
    }
    if (!tab.primaryTab) return false;
    checksSession.checksSaveRequested = true;
    return flight.save(() => syncChecksV2());
  }

  async function pollSharedChecks() {
    if (disposed || !sharedChecksV2?.requested || !tab.primaryTab || !loadSession() || !isOnline() || runtime.isPending()) return;
    const before = clone(model.state.checks), synced = await syncSharedChecksFromCloud({quiet:true});
    if (!disposed && synced && !eq(before, model.state.checks)) renderKupaDependentView();
  }

  return {refreshBankMatches:bankRefresh.manual,mergeSharedChecks, syncSharedChecksFromCloud, saveSharedChecksToCloud, pollSharedChecks, runtime};
}
