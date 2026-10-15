// @ts-check

/** @param {IDBRequest} request @returns {Promise<unknown>} */
export function calendarRequestResult(request){
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('calendar_storage_request_failed'));
  });
}

/**
 * A successful request is not a durable transaction receipt. Install terminal
 * observation before any request, join aborts, and retain the original decoder
 * or request failure. Callers validate records before issuing their writes.
 * @template T
 * @param {IDBDatabase} db
 * @param {string|string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(tx:IDBTransaction)=>T|PromiseLike<T>} run
 * @returns {Promise<T>}
 */
export async function runCalendarTransaction(db,stores,mode,run){
  const tx=db.transaction(stores,mode);
  /** @type {Promise<void>} */ const done=new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error('calendar_storage_failed'));
    tx.onabort=()=>reject(tx.error||new Error('calendar_storage_aborted'));
  });
  // A request error may precede abort; observe both even if the callback throws.
  void done.catch(()=>{});
  try{const result=await run(tx);await done;return result}
  catch(error){try{tx.abort()}catch{}await done.catch(()=>{});throw error}
}
