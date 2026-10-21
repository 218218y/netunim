// @ts-check
import {createDebouncedTask} from '../shared/debounced-task.js';

/** @typedef {import('./local-commit.js').LocalReceipt} LocalReceipt */
/** @param {{session:import('./local-commit.js').SaveSession,journal:Pick<import('./local-commit.js').SaveJournal,'storageV2CommitPromise'>,mirror:{available:()=>boolean,write:()=>Promise<unknown>,refreshAccess:()=>unknown},cloud:{enabled:()=>boolean,save:(message:string)=>Promise<unknown>},view:import('./local-commit.js').SaveView,platform:{isOnline:()=>boolean,timers?:import('../shared/debounced-task.js').DebounceTimers}}} ports */
export function createOrdersSavePublication({session,journal,mirror,cloud,view,platform}) {
  let disposed=false;
  const task=createDebouncedTask({delay:180,...(platform.timers?{timers:platform.timers}:{}),onError:error=>console.error('Main save follow-up',error)});
  /** @param {LocalReceipt} receipt @param {string} message */
  function schedule(receipt,message) {
    const {generation,localOk,accepted,committed}=receipt;
    if (disposed) return false;
    if (cloud.enabled()&&accepted) {
      session.cloudSaveRequested=true;
      session.cloudSaveMessage=message;
      const offline=!platform.isOnline();
      view.setCloud(offline?'ענן: אופליין':'ענן: ממתין לסנכרון',offline?'offline':'');
    }
    view.setSave(localOk?'מקומי: שומר…':accepted?'מקומי: ממתין לאישור IndexedDB':'מקומי: שגיאה',accepted?'':'error',view.folderSaveTitle());
    return task.schedule(async()=>{
      try {
        if (mirror.available()) {
          // The file owner captures/coalesces the snapshot and owns its drain.
          // This optional copy cannot acknowledge IDB or hold the cloud queue.
          void mirror.write().catch(error=>console.error('folder save',error));
        } else mirror.refreshAccess();
      } catch (error) { console.error('folder save',error); }
      // A folder copy cannot turn a failed IDB receipt into cloud authority.
      if (accepted) {
        try {
          if (await committed!==true) throw new Error('storage_local_commit_unconfirmed');
          if(receipt.current&&!receipt.current())return;
          if (!disposed&&generation===session.localGeneration) view.setSave('מקומי: שמור','',view.folderSaveTitle());
          if (cloud.enabled()) {
            if (await journal.storageV2CommitPromise()!==true) throw new Error('storage_local_commit_unconfirmed');
            await cloud.save(message);
          }
        } catch (error) {
          console.error('durable staging',error);
          if (!disposed) view.setSave('השינוי לא נשמר — אין לסגור את החלון','error');
        }
      }
    });
  }
  function dispose() { disposed=true; return task.dispose(); }
  return {schedule,cancelPending:task.cancel,drain:task.drain,dispose};
}
