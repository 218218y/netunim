"""Historical Morning metadata: actual UI/composition and native journal receipts.

Synthetic authenticated scope and read-only Morning status; no live issuance.
Only commit completion delivery or an actual IDB transaction is fault-injected.
"""
import argparse
import json
import subprocess
from pathlib import Path
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const phase=__PHASE__,check=(ok,message)=>{if(!ok)throw Error(message)},op='00000000-0000-4000-8000-000000000001';
 const debt={id:'metadata-debt',customerName:'Metadata fixture',amount:100,paid:false,invoiceIssued:false,debtProgress:[{id:'MORNING:'+op+':payment',kind:'payment',action:'add',amount:30,source:'morning',createdAt:'2026-10-11T00:00:00Z'}]};
 state.customerDebts.push(debt);state.notes.push({id:'metadata-note',content:'independent durable content'});
 storagePersistence.scheduleSave('metadata fixture',{domains:['customerDebts','notes'],operations:[{type:'put',collection:'customerDebts',id:debt.id,mode:'insert',index:state.customerDebts.length-1,record:debt},{type:'put',collection:'notes',id:'metadata-note',mode:'insert',index:state.notes.length-1,record:state.notes.at(-1)}]});await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();
 const {createMorningOperationScope}=await import('./assets/js/core/morning-operation-scope.js'),{createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const access={account:{owner:'local',epoch:1},storageOwner:'local',readable:true,writable:true},authority=createMorningOperationScope({readAccess:()=>access});morningOperationScope.capture=authority.capture;morningOperationScope.captureRead=authority.captureRead;
 let statusReads=0;cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope();check(JSON.parse(options.body).action==='status','unexpected issuance/provider action');statusReads++;return new Response(JSON.stringify({ok:true,operation:{state:'created',verified_at:'2026-10-11T01:00:00Z',document_id:'metadata-doc',document_number:'4001',document_type:400}}))};
 const before=JSON.stringify(await db.load('local:shared-checks')),mainBefore=JSON.stringify(await db.load('local:orders')),progress=JSON.stringify(debt.debtProgress);
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}},held=deferred(),entered=deferred();
 const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete'),put=IDBObjectStore.prototype.put,set=Storage.prototype.setItem;
 let armed=true,work;const hydrate=hydrateDebtDocumentLinks;
 hydrateDebtDocumentLinks=(...args)=>{work=hydrate(...args);return work};
 Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(handler){
   const tx=this,hold=armed&&phase!=='abort'&&tx.mode==='readwrite'&&tx.objectStoreNames.contains('journal');if(hold)armed=false;
   descriptor.set.call(tx,function(event){if(hold){entered.resolve();void held.promise.then(()=>handler.call(tx,event))}else handler.call(tx,event)});
 }});
 IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(armed&&phase==='abort'&&this.name==='journal'){armed=false;const tx=this.transaction;queueMicrotask(()=>{tx.abort();entered.resolve()})}return request};
 Storage.prototype.setItem=function(key,value){if(phase==='abort'&&String(key).startsWith('netunim-storage-v2-emergency:'))throw new DOMException('controlled emergency quota','QuotaExceededError');return set.call(this,key,value)};
 try{
   domainsCustomers.editor.openDebtProgressDetails(debt.id);await entered.promise;
   const button=document.querySelector('[data-morning-debt-label]')?.closest('button');check(button,'metadata button missing');
   if(phase==='abort'){
     await work;check(button.dataset.morningDebtOperation===op,'failed local metadata lost its recovery marker');check(button.textContent.includes('לא נשמר'),'failed local metadata lacks visible warning');
     check(mainStorageV2.durabilityAtRisk,'lost IDB-only write was not retained as at risk');
     check(JSON.stringify(await db.load('local:orders'))===mainBefore,'aborted journal transaction changed persisted Main');
     Storage.prototype.setItem=set;check(await mainStorageV2.recover(),'journal did not recover after controlled abort');
     await hydrateDebtDocumentLinks(document);
   }else{
     check(button.dataset.morningDebtOperation===op,'metadata completed before native commit receipt');
     if(phase==='relogin')access.account.epoch++;
     held.resolve();await work;
     if(phase==='relogin'){check(button.dataset.morningDebtOperation===op,'former login published metadata completion');await hydrateDebtDocumentLinks(document)}
   }
   await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();
   if(phase==='abort'){check(await mainStorageV2.recover(),'successful retry did not recover');check(!mainStorageV2.durabilityAtRisk,'same-epoch recovered retry still undurable')}
   check(!button.dataset.morningDebtOperation,'confirmed metadata remained unacknowledged');check(button.textContent.includes('קבלה 4001'),'confirmed metadata not shown');
   const recovered=await mainStorageV2.recoverReadOnly(),row=recovered.state.customerDebts.find(item=>item.id===debt.id);
   check(row.morningDocuments[0].documentId==='metadata-doc'&&row.morningDocuments[0].operationId===op,'metadata identity lost');
   check(JSON.stringify(row.debtProgress)===progress,'metadata changed financial progress');check(JSON.stringify(await db.load('local:shared-checks'))===before,'metadata changed Shared');check(statusReads===1||phase==='relogin'&&statusReads===2,'unexpected provider retries');
   return {sameIds:true,progressRetained:true,sharedRetained:true,phase,statusReads};
 }finally{held.resolve();Object.defineProperty(IDBTransaction.prototype,'oncomplete',descriptor);IDBObjectStore.prototype.put=put;Storage.prototype.setItem=set;hydrateDebtDocumentLinks=hydrate}
})()"""
parser=argparse.ArgumentParser()
parser.add_argument('--baseline',action='store_true')
parser.add_argument('--phase',choices=('completion','abort','relogin'),action='append')
args=parser.parse_args()

class MetadataBrowser(BrowserSession):
    def _module_probe(self,payload):
        if args.baseline and payload.get('mode')=='instrument':
            # Replace only in the disposable copy, before normal instrumentation.
            for name in ('composition.js','documents-browser.js'):
                relative='netunim-orders/site/assets/js/domains/customers/'+name
                old=subprocess.check_output(['git','show','c2bd3507766485cf80f885a338f81964c093deb9:'+relative],cwd=ROOT)
                (Path(payload['site'])/'assets/js/domains/customers'/name).write_bytes(old)
        return super()._module_probe(payload)

for phase in ('completion',) if args.baseline else args.phase or ('completion','abort','relogin'):
    with MetadataBrowser(ROOT/'netunim-orders/site','morning-metadata-'+phase) as browser:
        result=browser.evaluate(FLOW.replace('__PHASE__',json.dumps(phase)),timeout=45)
        browser._navigate()
        restored=browser.evaluate(r"""(async()=>{await appReady;const recovered=await mainStorageV2.recoverReadOnly();return {debt:recovered.state.customerDebts.find(row=>row.id==='metadata-debt'),note:recovered.state.notes.find(row=>row.id==='metadata-note')}})()""")
        assert restored['debt']['morningDocuments'][0]['documentId']=='metadata-doc',restored
        assert restored['note']['content']=='independent durable content',restored
        # The abort path intentionally logs a visible failed write; other paths
        # must have no unexpected browser/network exceptions.
        errors=browser.drain_serious_errors()
        if phase!='abort':
            assert not errors,errors
        else:
            # The failed generation's unload guard is deliberately retained:
            # a later record commit cannot acknowledge all earlier failed work.
            # With no user gesture Chrome logs this precise warning and reloads.
            assert all(error.startswith("Blocked attempt to show a 'beforeunload' confirmation panel for a frame that never had a user gesture") for error in errors),errors
        print('PASS Morning native metadata '+phase+': '+json.dumps(result),flush=True)
