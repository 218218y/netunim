"""Real IDB append/bootstrap/boundary validation, capture and abort evidence."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site', 'journal-authority', instrument=False) as browser:
    result = browser.evaluate("""(async()=>{
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {sealStorageJsonRecord:seal}=await import('./assets/js/shared/storage-json-codec.js');
      let serial=0,rejected=0,decisionsRejected=0,metadataRejected=0;
      for(const domain of ['orders','kupa','shared-checks']){
        const owner='A:'+domain,collection=domain==='shared-checks'?'checks':'notes';
        const checkpoint=()=>seal({version:2,owner,epoch:'E',seq:0,state:{[collection]:[]}});
        const base=()=>seal({version:2,owner,epoch:'E',revision:1,ackSeq:0,state:{[collection]:[]}});
        const operation=()=>seal({version:2,owner,epoch:'E',seq:1,generation:1,operationId:'OP',at:'T',changes:[{type:'put',collection,id:'N',mode:'insert',index:0,record:{id:'N',text:'accepted'}}]});
        const make=()=>createStorageJournalDb({name:'journal-authority-'+(++serial)});
        const snapshot=async db=>JSON.stringify(await db.load(owner));
        for(const kind of ['append','initialize','boundary']){
          const db=make();if(kind!=='initialize')await db.install(owner,checkpoint(),'W');
          if(kind==='boundary')await db.setBase(owner,'E','W',base());
          const before=await snapshot(db),bad=operation();
          bad.data.changes[0].collection=domain==='shared-checks'?'notes':'checks';
          const signedBad=seal(bad.data);
          try{
            if(kind==='append')await db.append(owner,'E','W',signedBad);
            if(kind==='initialize')await db.initializeCloudHead(owner,checkpoint(),base(),'W',signedBad);
            if(kind==='boundary')await db.appendBoundary(owner,'E','W',signedBad,{expectedSeq:0,expectedBaseRevision:1});
            throw Error('accepted-malformed-'+kind);
          }catch(error){if(error.message!=='storage_invalid_collection')throw error;rejected++}
          if(await snapshot(db)!==before)throw Error('invalid command changed durable state');
        }
        for(const kind of ['install','initialize','compact','ack','adopt','reset',
          'replace','replace-local-cloud','flight-range','reject-cursor','reject-checkpoint','reset-local']){
          const db=make();
          if(kind!=='initialize')await db.install(owner,checkpoint(),'W');
          if(['compact','ack','adopt','replace','flight-range','reject-cursor','reject-checkpoint'].includes(kind)){
            if(kind!=='compact')await db.setBase(owner,'E','W',base());
            await db.append(owner,'E','W',operation());
          }
          if(kind==='replace-local-cloud')await db.setBase(owner,'E','W',base());
          if(['ack','reject-cursor','reject-checkpoint'].includes(kind))await db.beginFlight(owner,'E','W',seal({version:2,owner,epoch:'E',operationId:'F',
            baseRevision:1,startSeq:1,endSeq:1,snapshot:{[collection]:[]}}));
          const before=await snapshot(db),expected={install:'storage_checkpoint_race',initialize:'storage_initialization_invalid',
            compact:'storage_compaction_range',ack:'storage_checkpoint_stale',adopt:'storage_cloud_pending',reset:'storage_cloud_reset_invalid',
            replace:'storage_checkpoint_stale','replace-local-cloud':'storage_boundary_local_cloud_head_exists',
            'flight-range':'storage_flight_range','reject-cursor':'storage_rebase_cursor',
            'reject-checkpoint':'storage_rebase_checkpoint_stale','reset-local':'storage_state_reset_invalid'}[kind];
          try{
            if(kind==='install')await db.install(owner,checkpoint(),'W',{expectedEpoch:'former-epoch'});
            if(kind==='initialize')await db.initializeCloudHead(owner,checkpoint(),seal({...base().data,ackSeq:1}),'W');
            if(kind==='compact')await db.compact(owner,'E','W',seal({...checkpoint().data,seq:2}));
            if(kind==='ack')await db.acknowledge(owner,'E','W','F',seal({...base().data,revision:2,ackSeq:1}),{checkpoint:checkpoint()});
            if(kind==='adopt')await db.adoptCloudHead(owner,'E','W',seal({...checkpoint().data,seq:1}),seal({...base().data,revision:2,ackSeq:1}));
            if(kind==='reset')await db.resetCloudHead(owner,'E','W',checkpoint(),seal({...base().data,ackSeq:1}));
            if(kind==='replace')await db.replaceCheckpoint(owner,'E','W',checkpoint());
            if(kind==='replace-local-cloud')await db.replaceLocalCheckpoint(owner,'E','W',checkpoint(),0);
            if(kind==='flight-range')await db.beginFlight(owner,'E','W',seal({version:2,owner,epoch:'E',operationId:'F',
              baseRevision:2,startSeq:1,endSeq:1,snapshot:{[collection]:[]}}));
            if(kind.startsWith('reject-'))await db.rejectFlight(owner,'E','W','F',seal({...base().data,revision:kind==='reject-cursor'?1:2}),
              {checkpoint:seal({...checkpoint().data,seq:1}),expectedSeq:kind==='reject-checkpoint'?0:1});
            if(kind==='reset-local')await db.resetState(owner,'E','W',seal({...checkpoint().data,seq:1}));
            throw Error('accepted-invalid-decision-'+kind);
          }catch(error){if(error.message!==expected)throw error;decisionsRejected++}
          if(await snapshot(db)!==before)throw Error('authority decision changed durable state: '+kind);
        }
        const db=make();await db.install(owner,checkpoint(),'W');
        const command=operation(),writing=db.append(owner,'E','W',command);
        command.data.seq=99;command.data.changes[0].record.text='mutated';await writing;
        const stored=await db.load(owner);
        if(stored.metadata.seq!==1||stored.journal[0].data.changes[0].record.text!=='accepted')throw Error('late caller mutation reached IDB');
        // Successful request followed by transaction abort must never grant a receipt.
        const abortDb=make();await abortDb.install(owner,checkpoint(),'W');
        const before=await snapshot(abortDb),put=IDBObjectStore.prototype.put;let requestSucceeded=false;
        IDBObjectStore.prototype.put=function(...args){
          const request=put.apply(this,args);
          if(this.name==='journal')request.addEventListener('success',()=>{requestSucceeded=true;this.transaction.abort()});
          return request;
        };
        let receipt=false;
        try{await abortDb.append(owner,'E','W',operation());receipt=true}catch{}finally{IDBObjectStore.prototype.put=put}
        if(receipt||!requestSucceeded||await snapshot(abortDb)!==before)throw Error('request success granted aborted authority');
        // A corrupted boolean sequence used to coerce true + 1 to numeric 2.
        // Neither load nor append may promote that raw metadata to authority.
        const corruptDb=make(),corruptName='journal-authority-'+serial;
        await corruptDb.install(owner,checkpoint(),'W');
        const raw=await new Promise((resolve,reject)=>{const request=indexedDB.open(corruptName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
        await new Promise((resolve,reject)=>{const tx=raw.transaction('metadata','readwrite');tx.objectStore('metadata').put({epoch:'E',seq:true,writer:'W'},owner);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
        const next=seal({...operation().data,seq:2});
        for(const attempt of [()=>corruptDb.load(owner),()=>corruptDb.append(owner,'E','W',next)]){
          try{await attempt();throw Error('accepted corrupt journal metadata')}
          catch(error){if(error.message!=='storage_journal_metadata_invalid')throw error;metadataRejected++}
        }
        const entries=await new Promise((resolve,reject)=>{const request=raw.transaction('journal').objectStore('journal').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
        raw.close();
        if(entries.length)throw Error('corrupt metadata authorized an append');
        const boundaryDb=make(),id='boundary-complete-'+domain;
        await boundaryDb.beginBoundary(owner,{version:2,owner,id,kind:'restore',phase:'prepared',
          main:{kind:'replace-authoritative',state:{}},shared:{kind:'replace-authoritative',state:{}}});
        await boundaryDb.advanceBoundary(owner,id,'prepared','shared-applied');
        await boundaryDb.advanceBoundary(owner,id,'shared-applied','main-applied');
        if(await boundaryDb.completeBoundary(owner,id)!==true||(await boundaryDb.readBoundary(owner)).phase!=='complete')throw Error('signed boundary envelope was not decoded before completion');
      }
      return {rejected,decisionsRejected,metadataRejected};
    })()""")
    assert result == {'rejected': 9, 'decisionsRejected': 36, 'metadataRejected': 6}, result
    assert not browser.drain_serious_errors()
    print('PASS native journal business schemas, detached commands and request-success/transaction-abort receipts')
    runtime_capture = browser.evaluate("""(async()=>{
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
      const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
      const results=[];
      for(const app of ['orders','kupa']){
        const db=createStorageJournalDb({name:'runtime-admission-'+app}),rows=new Map();
        const emergency={get length(){return rows.size},key:i=>[...rows.keys()][i]??null,
          getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};
        const runtime=createStorageV2Runtime({app,owner:()=> 'local',primary:()=>true,
          mode:()=> 'primary',validate:()=>{},createJournal:options=>createStorageJournal({...options,db,emergency})});
        await runtime.initializeLocal({notes:[{id:'N',content:'initial'}]});
        const originalAppend=db.append;let release;
        const blocked=new Promise(resolve=>{release=resolve});
        db.append=async(...args)=>{await blocked;return originalAppend(...args)};
        const edited={notes:[{id:'N',content:'edit'}]};
        const write=runtime.persist(edited,{operations:[{type:'put',collection:'notes',id:'N',mode:'replace',record:edited.notes[0]}]});
        if(!write.handled)throw Error('native write admission: '+write.reason+': '+write.error?.message);
        const candidate={notes:[{id:'N',content:'accepted replacement'}]};
        const options={expectedSeq:1,appMetadata:{captureEvidence:'accepted metadata'}};
        const pending=runtime.replaceCurrentState(candidate,options);
        candidate.notes[0].content='later caller mutation';options.expectedSeq=99;
        options.appMetadata.captureEvidence='later caller mutation';
        release();await pending;
        const durable=await db.load('local:'+app);
        if(durable.checkpoints.data.state.notes[0].content!=='accepted replacement'
          ||durable.checkpoints.data.appMetadata.captureEvidence!=='accepted metadata'
          ||durable.checkpoints.data.seq!==1)throw Error('runtime admitted mutable command');
        const recovered=await runtime.recover();
        if(recovered.state.notes[0].content!=='accepted replacement')throw Error('runtime capture lost on recovery');
        results.push(app);
      }
      return results;
    })()""")
    assert runtime_capture == ['orders', 'kupa'], runtime_capture
    assert not browser.drain_serious_errors()
    print('PASS both runtime command entrances capture before queued native IDB writes and recover exact checkpoints')
