"""Real IDB append/bootstrap/boundary validation, capture and abort evidence."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site', 'journal-authority', instrument=False) as browser:
    result = browser.evaluate("""(async()=>{
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {sealStorageJsonRecord:seal}=await import('./assets/js/shared/storage-json-codec.js');
      let serial=0,rejected=0,decisionsRejected=0;
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
        for(const kind of ['install','initialize','compact','ack','adopt','reset']){
          const db=make();
          if(kind!=='initialize')await db.install(owner,checkpoint(),'W');
          if(['compact','ack','adopt'].includes(kind)){
            if(kind!=='compact')await db.setBase(owner,'E','W',base());
            await db.append(owner,'E','W',operation());
          }
          if(kind==='ack')await db.beginFlight(owner,'E','W',seal({version:2,owner,epoch:'E',operationId:'F',
            baseRevision:1,startSeq:1,endSeq:1,snapshot:{[collection]:[]}}));
          const before=await snapshot(db),expected={install:'storage_checkpoint_race',initialize:'storage_initialization_invalid',
            compact:'storage_compaction_range',ack:'storage_checkpoint_stale',adopt:'storage_cloud_pending',reset:'storage_cloud_reset_invalid'}[kind];
          try{
            if(kind==='install')await db.install(owner,checkpoint(),'W',{expectedEpoch:'former-epoch'});
            if(kind==='initialize')await db.initializeCloudHead(owner,checkpoint(),seal({...base().data,ackSeq:1}),'W');
            if(kind==='compact')await db.compact(owner,'E','W',seal({...checkpoint().data,seq:2}));
            if(kind==='ack')await db.acknowledge(owner,'E','W','F',seal({...base().data,revision:2,ackSeq:1}),{checkpoint:checkpoint()});
            if(kind==='adopt')await db.adoptCloudHead(owner,'E','W',seal({...checkpoint().data,seq:1}),seal({...base().data,revision:2,ackSeq:1}));
            if(kind==='reset')await db.resetCloudHead(owner,'E','W',checkpoint(),seal({...base().data,ackSeq:1}));
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
      }
      return {rejected,decisionsRejected};
    })()""")
    assert result == {'rejected': 9, 'decisionsRejected': 18}, result
    assert not browser.drain_serious_errors()
    print('PASS native journal business schemas, detached commands and request-success/transaction-abort receipts')
