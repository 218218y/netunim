// @ts-check
// One connection per storage owner. Only a later caller retries a failed open.
/** @param {string} name @param {number} version @param {(db:IDBDatabase)=>void} upgrade
 * @param {{indexedDB?:IDBFactory,stopOnVersionChange?:boolean}} [options] */
export function createIndexedDbConnection(name,version,upgrade,{indexedDB=globalThis.indexedDB,stopOnVersionChange=false}={}){
  /** @type {Promise<IDBDatabase>|null} */ let opening=null;
  /** @type {IDBDatabase|null} */ let connection=null;
  let upgradeRequired=false;
  /** @param {IDBDatabase} db */
  function invalidate(db){
    if(connection===db){connection=null;opening=null}
    db.close();
  }
  function open(){
    if(upgradeRequired)return Promise.reject(new Error('indexed_db_reload_required'));
    if(opening)return opening;
    /** @type {Promise<IDBDatabase>} */
    const pending=new Promise((resolve,reject)=>{
      let settled=false;
      const request=indexedDB.open(name,version);
      request.onupgradeneeded=()=>upgrade(request.result);
      request.onerror=()=>{settled=true;reject(request.error)};
      request.onblocked=()=>{settled=true;reject(new Error('indexed_db_upgrade_blocked'))};
      request.onsuccess=()=>{
        const db=request.result;
        // A blocked request may finish after its caller has already recovered.
        if(settled){db.close();return}
        settled=true;connection=db;
        db.onversionchange=()=>{upgradeRequired=stopOnVersionChange;invalidate(db)};
        db.onclose=()=>{if(connection===db){connection=null;if(opening===pending)opening=null}};
        resolve(db);
      };
    });
    opening=pending;
    pending.catch(()=>{if(opening===pending)opening=null});
    return pending;
  }
  return Object.assign(open,{invalidate});
}
