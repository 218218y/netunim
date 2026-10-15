"""Real IDB append/bootstrap/boundary validation, capture and abort evidence."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site', 'journal-authority', instrument=False) as browser:
    result = browser.evaluate("""(async()=>{
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {sealStorageJsonRecord:seal}=await import('./assets/js/shared/storage-json-codec.js');
      let serial=0,rejected=0;
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
      return {rejected};
    })()""")
    assert result == {'rejected': 9}, result
    assert not browser.drain_serious_errors()
    print('PASS native journal business schemas, detached commands and request-success/transaction-abort receipts')
