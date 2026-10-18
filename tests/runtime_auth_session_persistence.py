"""Native IDB transaction abort cannot undo a durable Kupa logout tombstone."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-kupa/site', 'kupa-auth-session', instrument=False) as browser:
    result = browser.evaluate(r"""(async()=>{
      const {createAuthSessionPersistence}=await import('./assets/js/cloud/session-store.js');
      const check=(ok,message)=>{if(!ok)throw Error(message)},key='native-auth-session-regression',errors=[];
      const db=await new Promise((resolve,reject)=>{const open=indexedDB.open('native-auth-session-regression',1);open.onupgradeneeded=()=>open.result.createObjectStore('sync');open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error)});
      const read=()=>new Promise((resolve,reject)=>{const tx=db.transaction('sync'),request=tx.objectStore('sync').get(key);request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error)});
      const write=value=>new Promise((resolve,reject)=>{const tx=db.transaction('sync','readwrite');tx.objectStore('sync').put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
      const remove=()=>new Promise((resolve,reject)=>{const tx=db.transaction('sync','readwrite'),request=tx.objectStore('sync').delete(key);request.onsuccess=()=>tx.abort();tx.oncomplete=resolve;tx.onabort=()=>reject(Error('injected native delete abort'))});
      const create=()=>createAuthSessionPersistence({key,initial:null,storage:()=>localStorage,decode:value=>value&&typeof value==='object'?value:null,mirror:{read,write,remove},report:error=>errors.push(String(error))});
      try{
        const owner=create();owner.store({user:{id:'A'},access_token:'fixture-A'});await owner.drain();
        owner.store(null);await owner.drain();
        check((await read()).user.id==='A','native abort did not preserve the historical credential');
        check(errors.length===1,'cleanup failure was hidden');
        check(await create().restore()===null,'aborted delete revived an old login');
        const next=create();next.store({user:{id:'B'},access_token:'fixture-B'});await next.drain();
        check((await create().restore()).user.id==='B','new login did not supersede logout');
        return {nativeAbort:true,logoutRetained:true,nextAccount:true};
      }finally{db.close();localStorage.removeItem(key)}
    })()""")
    assert result == {'nativeAbort': True, 'logoutRetained': True, 'nextAccount': True}, result
    assert not browser.drain_serious_errors()
    print('PASS native Kupa auth: aborted IDB delete, retained logout and new account')
