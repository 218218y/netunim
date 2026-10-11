// @ts-check

/** @typedef {{operations:readonly unknown[],isCurrent:()=>boolean,isSettled:()=>boolean}} PendingSnapshot */
/** @typedef {{capture:()=>()=>boolean,isSettled:()=>boolean}} QueueObservation */

/**
 * Publish from a fresh durable read while its readonly transaction still owns
 * the queue snapshot. Conflicting transactions in other tabs cannot commit
 * between this read and the synchronous publication. This is a point-in-time
 * read proof, not a Google ACK or a promise about future queued writes.
 * @param {IDBDatabase} db
 * @param {QueueObservation} observation
 * @param {(snapshot:PendingSnapshot)=>boolean} publish
 * @returns {Promise<boolean>}
 */
export function confirmCalendarPendingSnapshot(db,observation,publish){
  if(typeof publish!=='function')throw new TypeError('calendar_confirmation_callback_required');
  const isCurrent=observation.capture();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('pending-operations','readonly');
    /** @type {boolean|undefined} */ let result;
    /** @type {unknown} */ let failure;
    tx.onabort=()=>reject(failure||tx.error||new Error('calendar_storage_aborted'));
    tx.onerror=()=>reject(failure||tx.error||new Error('calendar_storage_confirmation_failed'));
    tx.oncomplete=()=>{if(result===undefined)reject(new Error('calendar_confirmation_missing'));else resolve(result)};
    const request=tx.objectStore('pending-operations').getAll();
    request.onsuccess=()=>{
      try{
        /** @type {unknown} */ const rows=request.result;
        if(!Array.isArray(rows))throw new Error('calendar_pending_snapshot_invalid');
        const value=publish(Object.freeze({operations:rows,isCurrent,isSettled:observation.isSettled}));
        if(typeof value!=='boolean'){
          // Observe an invalid asynchronous consumer; it must never turn into
          // an unhandled rejection or an accepted confirmation.
          void Promise.resolve(value).catch(error=>console.error('invalid Calendar confirmation callback',error));
          throw new TypeError('calendar_confirmation_must_be_synchronous');
        }
        result=value;
      }catch(error){failure=error;tx.abort()}
    };
    request.onerror=()=>{failure=request.error||new Error('calendar_pending_read_failed')};
  });
}
