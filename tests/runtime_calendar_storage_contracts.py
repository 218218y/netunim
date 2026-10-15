"""Persisted Calendar boundaries on real IDB; synthetic data, no Google requests."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();domainsCalendarController.dispose();
 const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');
 let commits=0;const storage=createCalendarStorage({onLocalCommit:()=>commits++}),db=await storage.openDb();
 const check=(ok,message)=>{if(!ok)throw Error(message)},done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)});
 const read=async store=>{const tx=db.transaction(store,'readonly'),completion=done(tx),request=tx.objectStore(store).getAll();const rows=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});await completion;return rows};
 const replace=async(store,rows)=>{const tx=db.transaction(store,'readwrite'),completion=done(tx),target=tx.objectStore(store);target.clear();for(const row of rows)target.put(structuredClone(row));await completion};
 const command={type:'insert',calendarId:'calendar-A',eventId:'stable-id',body:{id:'stable-id',summary:'retained text',start:{date:'2026-10-15'},end:{date:'2026-10-16'}},attempts:0,lastError:''};
 const calendar={id:'calendar-A',summary:'Calendar A',accessRole:'reader'},event={...command.body,_calendarId:'calendar-A',_calendarSummary:'Calendar A',_calendarColor:'',_calendarAccessRole:'reader'};
 const snapshot={key:'range-A',owner:'owner-A',accountId:'calendar-A',rangeStart:'2026-10-01',rangeEnd:'2026-11-01',fetchedAt:'2026-10-15T08:00:00.000Z',calendars:[calendar],events:[event]};
 await storage.putMeta('accountId','calendar-A');await storage.putRangeCache(snapshot);const seq=await storage.addOperation(command);
 const valid=await storage.listOperations();check(valid.length===1&&valid[0].seq===seq,'valid pending changed');
 check((await storage.readDisplaySnapshot('owner-A','2026-10-15','2026-10-16')).pending[0].eventId==='stable-id','valid display lost pending');
 const queueRaw=await read('pending-operations'),cacheRaw=await read('range-cache'),metaRaw=await read('meta');
 let rejected=0;const mustReject=async(run,label)=>{let error;try{await run()}catch(value){error=value}check(error?.code==='calendar_persisted_record_invalid',label+' did not fail closed');rejected++};
 for(const patch of [{type:'unknown'},{seq:'1'},{attempts:'1'},{attempts:-1},{calendarId:{}},{eventId:''},{body:{...command.body,id:'different'}},{body:{...command.body,start:{date:'2026-02-30'}}}]){
   await replace('pending-operations',[{...queueRaw[0],...patch}]);const before=JSON.stringify(await read('pending-operations')),committed=commits;let published=0;
   await mustReject(()=>storage.listOperations(),'queue read');
   await mustReject(()=>storage.confirmPendingSnapshot(()=>{published++;return true}),'queue confirmation');
   await mustReject(()=>storage.updateOperation(seq,{lastError:'must not write'}),'queue update');
   check(!published&&commits===committed&&JSON.stringify(await read('pending-operations'))===before,'invalid durable operation was changed or published');
 }
 await replace('pending-operations',queueRaw);
 for(const mutate of [row=>row.events[0].start.date='2026-02-30',row=>row.events[0]._calendarAccessRole='owner',row=>row.events[0]._calendarId='foreign',row=>row.calendars[0].accessRole=3,row=>row.owner={},row=>row.fetchedAt='tomorrow']){
   const bad=structuredClone(snapshot);mutate(bad);await replace('range-cache',[bad]);const before=JSON.stringify(await read('range-cache'));
   await mustReject(()=>storage.getRangeCache(snapshot.key),'cache read');
   await mustReject(()=>storage.readDisplaySnapshot('owner-A','2026-10-15','2026-10-16'),'display read');
   check(JSON.stringify(await read('range-cache'))===before,'invalid cache was rewritten');
 }
 await replace('range-cache',cacheRaw);await replace('meta',[{key:'accountId',value:{forged:true}}]);
 await mustReject(()=>storage.readDisplaySnapshot('owner-A','2026-10-15','2026-10-16'),'account metadata');
 await replace('meta',metaRaw);await replace('pending-operations',queueRaw);
 const before=JSON.stringify(await read('pending-operations')),committed=commits;
 await mustReject(()=>storage.addOperation({...command,body:{...command.body,id:'wrong'}}),'invalid command');
 check(committed===commits&&JSON.stringify(await read('pending-operations'))===before,'invalid command reached IDB');
 await storage.updateOperation(seq,{attempts:1,lastAttemptAt:'2026-10-15T08:01:00.000Z'});
 check((await storage.listOperations())[0].attempts===1,'valid retry metadata rejected');
 return {rejected,pendingRetained:(await storage.pendingCount())===1,displayRestored:!!await storage.readDisplaySnapshot('owner-A','2026-10-15','2026-10-16')};
})()"""

with BrowserSession(ROOT/'netunim-orders/site','calendar-storage-contracts') as browser:
    result=browser.evaluate(FLOW,timeout=45)
    assert result['rejected']==38 and result['pendingRetained'] and result['displayRestored'],result
    errors=browser.drain_serious_errors()
    assert not errors,errors
    print('PASS native Calendar persisted contracts: '+json.dumps(result),flush=True)
