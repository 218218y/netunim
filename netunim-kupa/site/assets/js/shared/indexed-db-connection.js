// One connection per storage owner. Failed opens and browser-forced closes are retryable.
export function createIndexedDbConnection(name,version,upgrade){
  let opening=null;
  return function open(){
    if(opening)return opening;
    const pending=new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,version);
      request.onupgradeneeded=()=>upgrade(request.result);
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result;
        const invalidate=()=>{if(opening===pending)opening=null};
        db.onversionchange=()=>{invalidate();db.close()};
        db.onclose=invalidate;
        resolve(db);
      };
    });
    opening=pending;
    pending.catch(()=>{if(opening===pending)opening=null});
    return pending;
  };
}
