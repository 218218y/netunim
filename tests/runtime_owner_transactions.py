"""Actual owner-store transactions: coherent snapshots, ABA and atomic abort."""
import json
from browser_harness import BrowserSession, ROOT

for app in ['orders', 'kupa']:
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-owner-transactions', instrument=False) as browser:
        result = browser.evaluate("""(async()=>{
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const {createStorageOwnerTransactions}=await import('./assets/js/shared/storage-owner-idb.js');
          const app=APP,name='native-owner-transactions-'+app,db=createStorageJournalDb({name});
          await db.initializeOwnerBinding(app,'A');
          const native=await new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
          const raw=()=>new Promise((resolve,reject)=>{
            const tx=native.transaction(['owner-bindings','owner-handoffs'],'readonly'),binding=tx.objectStore('owner-bindings').get(app),handoff=tx.objectStore('owner-handoffs').get(app);
            tx.oncomplete=()=>resolve(JSON.stringify([binding.result,handoff.result]));tx.onabort=()=>reject(tx.error);
          });
          async function prepare(sourceOwner,targetOwner,id,generation){
            const record={version:1,app,id,sourceOwner,targetOwner,intent:'account-switch',phase:'freezing-source'};
            await db.beginOwnerHandoff(app,record,{expectedGeneration:generation});
            for(const [from,to] of [['freezing-source','source-settled'],['source-settled','target-authenticated'],['target-authenticated','target-recovered']])
              await db.advanceOwnerHandoff(app,id,from,to,{}, {expectedGeneration:generation});
            return record;
          }
          await prepare('A','B','first',1);const beforeAbort=await raw();
          // Abort after native put success: neither store may become durable,
          // and the authority promise must reject rather than publish a receipt.
          const aborting=createStorageOwnerTransactions({open:async()=>({transaction(stores,mode){
            const tx=native.transaction(stores,mode),getStore=tx.objectStore.bind(tx);
            tx.objectStore=name=>{
              const store=getStore(name);
              return {get:store.get.bind(store),put(...args){const request=store.put(...args);if(name==='owner-handoffs')request.onsuccess=()=>tx.abort();return request}};
            };
            return tx;
          }})});
          let aborted=false;try{await aborting.activateOwnerHandoff(app,'first','B',{expectedGeneration:1})}catch{aborted=true}
          const atomic=aborted&&await raw()===beforeAbort;
          await db.activateOwnerHandoff(app,'first','B',{expectedGeneration:1});
          await db.completeOwnerHandoff(app,'first','B',{expectedGeneration:2});
          await prepare('B','A','second',2);
          await db.activateOwnerHandoff(app,'second','A',{expectedGeneration:2});
          await db.completeOwnerHandoff(app,'second','A',{expectedGeneration:3});
          const snapshot=await db.readOwnerState(app),beforeStale=await raw();
          let stale=false;try{await db.beginOwnerHandoff(app,{version:1,app,id:'late',sourceOwner:'A',targetOwner:'C',intent:'account-switch',phase:'freezing-source'},{expectedGeneration:1})}catch(error){stale=error.message==='storage_owner_generation_changed'}
          let missing=false;try{await db.beginOwnerHandoff(app,{version:1,app,id:'missing',sourceOwner:'A',targetOwner:'C',intent:'account-switch',phase:'freezing-source'},{})}catch(error){missing=error.message==='storage_owner_generation_required'}
          const retained=await raw()===beforeStale;
          native.close();return {atomic,stale,missing,retained,coherent:snapshot.binding.owner==='A'&&snapshot.binding.generation===3&&snapshot.handoff.phase==='complete'&&snapshot.handoff.id==='second'};
        })()""".replace('APP', json.dumps(app)))
        assert result == dict.fromkeys(['atomic', 'stale', 'missing', 'retained', 'coherent'], True), result
        assert not browser.drain_serious_errors()
        print('PASS', app, 'native owner transactions: atomic abort, coherent pair and stale ABA commands fenced', flush=True)
