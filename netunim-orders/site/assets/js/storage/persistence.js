import {beginMeasure} from '../shared/runtime-performance.js';
import {createDebouncedTask} from '../platform/debounced-task.js';

// Dependencies are supplied by the composition root; construction starts no work.
export function createStoragePersistence({
  tab, session, domainRevisions, showSecondaryTabGuard, localSnapshot,
  storageV2CommitPromise=() => Promise.resolve(), storageV2DurabilityAtRisk=() => false,
  setSave, syncFolderAccessButton, folderBackupAvailable, folderSaveTitle,
  writeStateToFolder, cloudEnabled, requestCloudSave, setCloud, timers=globalThis,
}) {
  let disposed = false;
  const saveTask = createDebouncedTask({
    delay:180, timers, onError:error => console.error('Main save follow-up', error),
  });
  const runtime = {
    cancelPending:() => saveTask.cancel(),
    drain:() => saveTask.drain(),
    dispose:() => { disposed = true; return saveTask.dispose(); },
  };

  function canMutate() { return tab.primaryTab === true && !session.syncCapabilitiesError; }
  function rejectSecondaryAction() {
    if (tab.primaryTab) return false;
    showSecondaryTabGuard();
    return true;
  }
  function rejectSecondaryMutation() {
    if (session.syncCapabilitiesError) { setCloud(session.syncCapabilitiesError.message, 'error'); return true; }
    if (tab.primaryTab) return false;
    // Startup restores authoritative V2 journals after a rejected in-memory edit.
    showSecondaryTabGuard();
    globalThis.location?.reload?.();
    return true;
  }

  function scheduleSave(message='השינויים נשמרו', {
    deleteIntents={}, mutationType='autosave', surface='orders', domains=null, operations=null,
  }={}) {
    if (disposed || rejectSecondaryMutation()) return false;
    if (Array.isArray(domains) && domains.length) domainRevisions?.touch(domains);
    else domainRevisions?.touchAll();
    const localDone = beginMeasure('orders:save-local', {paint:true});
    const generation = ++session.localGeneration;
    const localOk = localSnapshot(undefined, {operations, generation, mutationType, surface, deleteIntents});
    const idbPending = !localOk && storageV2DurabilityAtRisk();
    localDone();
    if (!localOk) (session.localUndurableGenerations ??= new Set()).add(generation);
    if (cloudEnabled() && (localOk || idbPending)) {
      session.cloudSaveRequested = true;
      session.cloudSaveMessage = message;
      const offline = globalThis.navigator?.onLine === false;
      setCloud(offline ? 'ענן: אופליין' : 'ענן: ממתין לסנכרון', offline ? 'offline' : '');
    }
    if (localOk || idbPending) {
      const durable = storageV2CommitPromise();
      durable?.then(() => {
        session.localUndurableGenerations?.delete(generation);
        if (generation === session.localGeneration) {
          setSave(cloudEnabled() ? 'מקומי: שינוי שמור וממתין לסנכרון' : 'מקומי: שמור', '', folderSaveTitle());
        }
      }, () => {
        setSave('השינוי לא נשמר באחסון הדפדפן — אין לסגור את החלון', 'error');
        setCloud('ענן: השמירה נעצרה — אחסון מקומי נכשל', 'error');
      });
    }
    setSave(localOk ? 'מקומי: שומר…' : idbPending ? 'מקומי: ממתין לאישור IndexedDB' : 'מקומי: שגיאה',
      localOk || idbPending ? '' : 'error', folderSaveTitle());

    saveTask.schedule(async () => {
      try {
        if (folderBackupAvailable()) {
          if (await writeStateToFolder()) session.localUndurableGenerations?.delete(generation);
        } else syncFolderAccessButton();
      } catch (error) { console.error('folder save', error); }
      if (generation === session.localGeneration && localOk) setSave('מקומי: שמור', '', folderSaveTitle());
      if (cloudEnabled() && (localOk || idbPending)) {
        try {
          await storageV2CommitPromise();
          await requestCloudSave(message);
        } catch (error) {
          console.error('durable staging', error);
          setSave('השינוי לא נשמר — אין לסגור את החלון', 'error');
        }
      }
    });
    return localOk;
  }

  // Confirms this local generation, not the cloud or all newer work. Callers
  // retain their own account/operation fence across the captured receipt await.
  async function commitSave(message, {operations, ...options}={}) {
    if (!Array.isArray(operations) || !operations.length) throw new TypeError('storage_mutation_contract_required');
    const before = session.localGeneration;
    const localOk = scheduleSave(message, {...options, operations});
    const generation = session.localGeneration;
    if (generation === before || (!localOk && !storageV2DurabilityAtRisk())) return false;
    const committed = storageV2CommitPromise();
    if (typeof committed?.then !== 'function') throw new Error('storage_local_commit_receipt_required');
    const confirmed = await committed;
    return confirmed === true && !session.localUndurableGenerations?.has(generation);
  }

  return {canMutate, rejectSecondaryAction, rejectSecondaryMutation, scheduleSave, commitSave, runtime};
}
