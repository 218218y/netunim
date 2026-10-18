"""Native request-success/transaction-abort must never grant a durable receipt."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site', 'durable-receipts', instrument=False) as browser:
    result = browser.evaluate("""(async()=>{
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {sealStorageJsonRecord:seal}=await import('./assets/js/shared/storage-json-codec.js');
      const db=createStorageJournalDb({name:'durable-receipts'}),check=(ok,message)=>{if(!ok)throw Error(message)};
      async function abortAfterRequest(method,operation){
        const original=IDBObjectStore.prototype[method];let injected=0;
        IDBObjectStore.prototype[method]=function(...args){
          const request=original.apply(this,args);
          if(this.transaction.db.name==='durable-receipts'&&!injected++)request.addEventListener('success',()=>this.transaction.abort());
          return request;
        };
        let accepted=false;
        try{await operation();accepted=true}catch{}finally{IDBObjectStore.prototype[method]=original}
        check(injected>0&&!accepted,'false receipt after '+method+' success');
      }
      for(const [begin,advance,read,key,record] of [
        ['beginBoundary','advanceBoundary','readBoundary','A',{version:2,owner:'A',id:'B',phase:'prepared'}],
        ['beginBootstrapGroup','advanceBootstrapGroup','readBootstrapGroup','A:orders',{version:2,scope:'A:orders',id:'B',phase:'prepared',planHash:'H'}],
        ['beginLocalBirth','advanceLocalBirth','readLocalBirth','orders:local',{version:2,scope:'orders:local',id:'B',phase:'prepared'}],
      ]){
        await abortAfterRequest('put',()=>db[begin](key,record));check(await db[read](key)===null,'aborted creation became durable');
        await db[begin](key,record);
        await abortAfterRequest('get',()=>db[read](key));
        const before=JSON.stringify(await db[read](key));
        await abortAfterRequest('put',()=>db[advance](key,'B','prepared','applying'));
        check(JSON.stringify(await db[read](key))===before,'aborted transition changed prior evidence');
        const reopened=createStorageJournalDb({name:'durable-receipts'});
        check(JSON.stringify(await reopened[read](key))===before,'restart changed transition evidence');
      }
      for(const domain of ['orders','kupa','shared-checks']){
        const owner='A:'+domain,collection=domain==='shared-checks'?'checks':'notes',state={[collection]:[]};
        await db.install(owner,seal({version:2,owner,epoch:'E',seq:0,state}),'W');
        await db.setBase(owner,'E','W',seal({version:2,owner,epoch:'E',revision:1,ackSeq:0,state}));
        await db.append(owner,'E','W',seal({version:2,owner,epoch:'E',seq:1,generation:1,operationId:'OP',at:'T',changes:[{type:'put',collection,id:'N',mode:'insert',index:0,record:{id:'N'}}]}));
        await db.beginFlight(owner,'E','W',seal({version:2,owner,epoch:'E',operationId:'F',baseRevision:1,startSeq:1,endSeq:1,snapshot:state}));
        const before=JSON.stringify(await db.load(owner));
        await abortAfterRequest('put',()=>db.acknowledge(owner,'E','W','F',seal({version:2,owner,epoch:'E',revision:2,ackSeq:1,state})));
        check(JSON.stringify(await db.load(owner))===before,'aborted ACK changed cursor or flight');
      }
      return true;
    })()""")
    assert result
    assert not browser.drain_serious_errors()
    print('PASS native Main/Shared ACK abort, transition read/write abort and restart receipts')
