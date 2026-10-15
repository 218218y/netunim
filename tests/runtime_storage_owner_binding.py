"""Checksummed owner records retain fail-closed authority in native IndexedDB."""
from browser_harness import BrowserSession, ROOT
import json

for app in ['orders', 'kupa']:
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-owner-binding', instrument=False) as browser:
        result=browser.evaluate("""(async()=>{
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const {createStorageOwnerBinding}=await import('./assets/js/shared/storage-owner.js');
          const {sealStorageJsonRecord}=await import('./assets/js/shared/storage-json-codec.js');
          const app=APP,name='native-owner-evidence-'+app,db=createStorageJournalDb({name}),values=new Map();
          const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
          const owner=createStorageOwnerBinding({app,db,storage});await owner.hydrate({initialOwner:()=> 'A'});
          const native=await new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
          const put=(store,data)=>new Promise((resolve,reject)=>{const tx=native.transaction([store],'readwrite');tx.objectStore(store).put(sealStorageJsonRecord(data),app);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
          const bad={version:1,app,id:'invalid-completed',sourceOwner:'A',targetOwner:[],intent:'account-switch',phase:'complete'};
          await put('owner-handoffs',bad);let rejected=false;try{await owner.refresh()}catch{rejected=true}
          const retained=await new Promise((resolve,reject)=>{const tx=native.transaction(['owner-handoffs'],'readonly'),request=tx.objectStore('owner-handoffs').get(app);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
          const locked=rejected&&!owner.ready&&!owner.writable&&owner.locked&&owner.current()==='A'&&JSON.stringify(retained)===JSON.stringify(sealStorageJsonRecord(bad));
          await new Promise((resolve,reject)=>{const tx=native.transaction(['owner-handoffs'],'readwrite');tx.objectStore('owner-handoffs').delete(app);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
          await owner.refresh();const recovered=owner.writable&&owner.current()==='A';
          const binding=await db.readOwnerBinding(app);await put('owner-bindings',{...binding,owner:'B',generation:binding.generation+1});
          const set=storage.setItem;storage.setItem=()=>{throw Error('cache-write-rejected')};
          let cacheRejected=false;try{await owner.refresh()}catch{cacheRejected=true}
          const cacheFenced=cacheRejected&&owner.current()==='A'&&!owner.writable;
          storage.setItem=set;await owner.refresh();const repaired=owner.current()==='B'&&owner.writable;
          native.close();return {locked,recovered,cacheFenced,repaired};
        })()""".replace('APP',json.dumps(app)))
        assert result=={'locked':True,'recovered':True,'cacheFenced':True,'repaired':True},result
        assert not browser.drain_serious_errors()
        print('PASS',app,'native checksummed owner evidence retained; cache failure fenced; verified refresh recovered',flush=True)
