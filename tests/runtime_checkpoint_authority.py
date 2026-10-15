"""Native checkpoint replacement and physical journal deletion authority."""
import json
from browser_harness import BrowserSession, ROOT

for app in ['orders', 'kupa']:
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-checkpoint-authority', instrument=False) as browser:
        result = browser.evaluate("""(async()=>{
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const {sealStorageJsonRecord:seal}=await import('./assets/js/shared/storage-json-codec.js');
          const app=APP,owner='fixture:'+app,writer='W';let serial=0;
          const cp=(epoch='E',seq=0)=>seal({version:2,owner,epoch,seq,state:{notes:[]},appMetadata:null});
          const base=(epoch='E',ackSeq=0,revision=1)=>seal({version:2,owner,epoch,ackSeq,revision,state:{notes:[]}});
          const operation=()=>seal({version:2,owner,epoch:'E',seq:1,generation:1,operationId:'OP',at:'T',changes:[{type:'put',collection:'notes',id:'N',mode:'insert',index:0,record:{id:'N'}}]});
          async function fixture({empty=false,cloud=false,flight=false,clean=false}={}){
            const name='checkpoint-authority-'+app+'-'+(++serial),db=createStorageJournalDb({name});
            if(empty)await db.load(owner);
            if(!empty){
              await db.install(owner,cp(),writer);await db.append(owner,'E',writer,operation());
              if(cloud)await db.setBase(owner,'E',writer,base('E',clean?1:0));
              if(flight)await db.beginFlight(owner,'E',writer,seal({version:2,owner,epoch:'E',operationId:'F',baseRevision:1,startSeq:1,endSeq:1,snapshot:{notes:[]}}));
            }
            const native=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
            const snapshot=()=>new Promise((resolve,reject)=>{
              const names=['checkpoints','journal','metadata','bases','flights','controls'],tx=native.transaction(names,'readonly'),data={};
              for(const name of names){const store=tx.objectStore(name),rows=store.getAll(),keys=store.getAllKeys();rows.onsuccess=()=>{(data[name]??={}).rows=rows.result};keys.onsuccess=()=>{(data[name]??={}).keys=keys.result}}
              tx.oncomplete=()=>resolve(JSON.stringify(data));tx.onabort=()=>reject(tx.error);
            });
            return {db,native,snapshot};
          }
          const cases=[
            ['install',{},(db,bad)=>db.install(owner,bad,writer,{expectedEpoch:'E'}),'next',0],
            ['initializeCloudHead',{empty:true},(db,bad)=>db.initializeCloudHead(owner,bad,base('next'),writer),'next',0],
            ['compact',{},(db,bad)=>db.compact(owner,'E',writer,bad),'E',1],
            ['replaceCheckpoint',{},(db,bad)=>db.replaceCheckpoint(owner,'E',writer,bad),'E',1],
            ['replaceLocalCheckpoint',{},(db,bad)=>db.replaceLocalCheckpoint(owner,'E',writer,bad,1),'E',1],
            ['acknowledge',{cloud:true,flight:true},(db,bad)=>db.acknowledge(owner,'E',writer,'F',base('E',1,2),{checkpoint:bad}),'E',1],
            ['rejectFlight',{cloud:true,flight:true},(db,bad)=>db.rejectFlight(owner,'E',writer,'F',base('E',0,2),{checkpoint:bad,expectedSeq:1}),'E',1],
            ['commitCloudRecovery',{},(db,bad)=>db.commitCloudRecovery(owner,'E',writer,bad,{expectedHead:{}}),'E',1],
            ['adoptCloudHead',{cloud:true,clean:true},(db,bad)=>db.adoptCloudHead(owner,'E',writer,bad,base('E',1,2)),'E',1],
            ['resetState',{},(db,bad)=>db.resetState(owner,'E',writer,bad),'next',0],
            ['resetCloudHead',{cloud:true,clean:true},(db,bad)=>db.resetCloudHead(owner,'E',writer,bad,base('next')),'next',0],
          ];
          let malformed=0;
          for(const [name,options,invoke,epoch,seq] of cases){
            const f=await fixture(options),before=await f.snapshot(),bad=seal({...cp(epoch,seq).data,state:[]});
            let rejected=false;try{await invoke(f.db,bad)}catch(error){rejected=error.message==='storage_invalid_checkpoint'}
            if(!rejected||await f.snapshot()!==before)throw Error(name+' accepted malformed checkpoint or changed durable evidence');
            f.native.close();malformed++;
          }
          for(const checkpoint of [false,0,'']){
            const f=await fixture({cloud:true,flight:true}),before=await f.snapshot();let rejected=false;
            try{await f.db.acknowledge(owner,'E',writer,'F',base('E',1,2),{checkpoint})}catch{rejected=true}
            if(!rejected||await f.snapshot()!==before)throw Error('ACK silently treated malformed checkpoint as omitted');
            f.native.close();malformed++;
          }
          let retained=0;
          for(const kind of ['install','compact','replaceLocalCheckpoint','resetState','resetCloudHead']){
            const f=await fixture();
            // A valid checksum and owner index cannot prove the physical key.
            await new Promise((resolve,reject)=>{const tx=f.native.transaction(['journal'],'readwrite');tx.objectStore('journal').put(operation(),[owner,'E',99]);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
            const before=await f.snapshot();let rejected=false;
            try{
              if(kind==='install')await f.db.install(owner,cp('next'),writer,{expectedEpoch:'E'});
              if(kind==='compact')await f.db.compact(owner,'E',writer,cp('E',1));
              if(kind==='replaceLocalCheckpoint')await f.db.replaceLocalCheckpoint(owner,'E',writer,cp('E',1),1);
              if(kind==='resetState')await f.db.resetState(owner,'E',writer,cp('next'));
              if(kind==='resetCloudHead')await f.db.resetCloudHead(owner,'E',writer,cp('next'),base('next'));
            }catch(error){rejected=error.message==='storage_journal_key_mismatch'}
            if(!rejected||await f.snapshot()!==before)throw Error(kind+' retired an unproven physical row');
            f.native.close();retained++;
          }
          // Valid same-epoch local import and epoch reset still retire exact rows.
          const valid=await fixture();await valid.db.replaceLocalCheckpoint(owner,'E',writer,cp('E',1),1);
          const imported=await valid.db.load(owner),command=cp('next');
          const pendingReset=valid.db.resetState(owner,'E',writer,command);
          command.data.epoch='late-caller-mutation';command.data.state=[];await pendingReset;
          const reset=await valid.db.load(owner);valid.native.close();
          return {malformed,retained,valid:imported.journal.length===0&&imported.metadata.seq===1&&reset.journal.length===0&&reset.metadata.epoch==='next'};
        })()""".replace('APP', json.dumps(app)))
        assert result == {'malformed': 14, 'retained': 5, 'valid': True}, result
        assert not browser.drain_serious_errors()
        print('PASS', app, 'native checkpoint writers reject malformed replacements; physical journal keys retained; valid imports/reset complete', flush=True)
