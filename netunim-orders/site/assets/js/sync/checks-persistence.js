import {createDebouncedTask} from '../platform/debounced-task.js';

// Shared Checks owns its backup and cloud wakeups independently of Main saves.
export function createSyncChecksPersistence({
  session, checksSession, toast, setSave, setCloud, syncFolderAccessButton,
  folderBackupAvailable, folderSaveTitle, rejectSecondaryMutation,
  writeStateToFolder, loadSession, saveSharedChecksToCloud, sharedChecksV2=null,
  refreshAlertCenter=() => {}, touchChecksRevision=() => {}, timers=globalThis,
  isSaving=() => false, isOnline=() => globalThis.navigator?.onLine !== false,
}) {
  let disposed = false;
  const backupTask = createDebouncedTask({
    delay:180, timers, onError:error => console.error('Checks backup follow-up', error),
  });
  const cloudTask = createDebouncedTask({
    delay:260, timers, onError:error => console.error('Checks cloud follow-up', error),
  });
  const runtime = {
    cancelPending() {
      const backup = backupTask.cancel(), cloud = cloudTask.cancel();
      return backup || cloud;
    },
    async drain() { await Promise.all([backupTask.drain(), cloudTask.drain()]); },
    dispose() {
      disposed = true;
      const backup = backupTask.dispose(), cloud = cloudTask.dispose();
      return backup || cloud;
    },
  };

  function scheduleCheckSave(message, {deletedIds=[], mutationType='autosave', surface='orders.checks', operations=null}={}) {
    if (disposed || rejectSecondaryMutation()) return false;
    touchChecksRevision();
    refreshAlertCenter();
    const generation = ++session.localGeneration;
    if (sharedChecksV2?.requested) {
      const owner = loadSession()?.user?.id;
      const cloudCurrent = () => !!owner && loadSession()?.user?.id === owner && sharedChecksV2.cloudReady;
      const failed = () => {
        setSave('הצ׳ק לא נשמר — אין לסגור את החלון', 'error', folderSaveTitle());
        if (cloudCurrent()) setCloud('ענן: שמירת הצ׳קים נעצרה — אחסון מקומי נכשל', 'error');
      };
      const riskToken = `checks:${generation}`;
      let write;
      try { write = sharedChecksV2.persist(operations, {generation, surface, mutationType, deleteIds:deletedIds}); }
      catch (error) {
        (session.localUndurableGenerations ??= new Set()).add(riskToken);
        failed();
        console.error('Shared Checks V2 save', error);
        return false;
      }
      checksSession.checksGeneration++;
      checksSession.checksSaveRequested = true;
      if (cloudCurrent()) {
        const offline = !isOnline();
        setCloud(offline ? 'ענן: אופליין' : 'ענן: צ׳קים ממתינים לסנכרון', offline ? 'offline' : '');
      }
      if (!write.emergencyDurable) (session.localUndurableGenerations ??= new Set()).add(riskToken);
      setSave(write.emergencyDurable ? 'מקומי: שמור' : 'מקומי: ממתין לאישור IndexedDB', '', folderSaveTitle());
      write.committed.then(() => {
        session.localUndurableGenerations?.delete(riskToken);
        setSave('מקומי: שמור', '', folderSaveTitle());
      }, failed);
      backupTask.schedule(async () => {
        try {
          await write.committed;
          if (folderBackupAvailable()) await writeStateToFolder();
          else syncFolderAccessButton();
        } catch (error) { console.error('checks backup', error); }
      });
      if (loadSession()) queueSharedChecksSave(message, write.committed);
      else if (message) write.committed.then(() => toast(message), () => {});
      return write.emergencyDurable;
    }
    (session.localUndurableGenerations ??= new Set()).add(`checks:${generation}`);
    setSave('Shared Checks V2 is required before saving checks', 'error', folderSaveTitle());
    return false;
  }

  function queueSharedChecksSave(message="צ'קים סונכרנו", durable=null) {
    if (disposed) return false;
    checksSession.sharedChecksSaveMessage = message;
    checksSession.checksSaveMessage = message;
    checksSession.checksSaveRequested = true;
    cloudTask.cancel();
    if (isSaving()) return;
    cloudTask.schedule(async () => {
      if (durable) {
        try { await durable; }
        catch {
          setSave('הצ׳ק לא נשמר — אין לסגור את החלון', 'error', folderSaveTitle());
          return;
        }
      }
      await saveSharedChecksToCloud(checksSession.sharedChecksSaveMessage);
    });
  }

  return {scheduleCheckSave, queueSharedChecksSave, runtime};
}
