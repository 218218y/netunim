"""Morning A -> B recovery wake, actual documents/editor and native journals.

Synthetic server ledger only; no live Morning issuance. The timer clock is
controlled at the lifetime boundary, without waiting a minute or changing
production delays. --baseline replaces only that module in the disposable site.
"""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;syncDocument.stopPolling();domainsFinanceController.stopAutoSync();
 const check=(ok,message)=>{if(!ok)throw Error(message)},owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
 const {createDomainsCustomersDocuments}=await import('./assets/js/domains/customers/documents.js');
 const {createMorningRequest}=await import('./assets/js/integrations/morning.js');
 const {loadMorningDebtRecoveryContext}=await import('./assets/js/domains/customers/morning-debt-recovery.js');
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const debts=['A','B'].map(id=>({id:'wake-debt-'+id,customerName:'Wake fixture '+id,amount:100,clearingApproval:'4444',customerId:'123456782',paid:false,invoiceIssued:false,closedAt:null}));
 const note={id:'morning-wake-note',content:'independent durable note'};
 state.customerDebts.push(...debts);state.notes.push(note);
 storagePersistence.scheduleSave('Morning wake fixture',{domains:['customerDebts','notes'],operations:[
   ...debts.map((record,index)=>({type:'put',collection:'customerDebts',mode:'insert',id:record.id,record,index})),
   {type:'put',collection:'notes',mode:'insert',id:note.id,record:note,index:state.notes.length-1},
 ]});await mainStorageV2.commitPromise;
 cloudAuth.saveSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});
 localStorage.setItem(CLOUD_AUTO_KEY,'1');
 let main=null,shared=null;
 cloudTransport.readCloud=async()=>structuredClone(main);cloudTransport.readCloudMeta=async()=>({revision:main.revision});
 cloudTransport.readSharedChecksCloud=async()=>structuredClone(shared);
 cloudTransport.rpcSaveV2=async(snapshot,expected=0)=>{main={revision:expected+1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async checks=>{shared={revision:1,state:{version:1,checks:structuredClone(checks),bankEvents:[]}};return {r:{ok:true},row:shared}};
 await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});session.storageProtocolBlocked=false;morningOperationScope.capture()();
 const rawShared=JSON.stringify(await db.load(owner+':shared-checks')),accountBefore=cloudAuth.getAccountScope();
 const ledger=new Map(),calls=[],queued=new Map();let serial=1_000_000,effects=0;
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
 globalThis.setTimeout=(run,delay,...args)=>{
   if(new Error().stack.includes('/morning-lifetime.js:')){const id=++serial;queued.set(id,{run,delay,operationId:loadMorningDebtRecoveryContext()?.operationId});return id}
   return originalSet(run,delay,...args);
 };
 globalThis.clearTimeout=id=>queued.delete(id)||originalClear(id);
 cloudAuth.supaFetch=async(path,options)=>{
   options.assertRequestScope?.();const request=JSON.parse(options.body);calls.push(request);
   if(path.includes('/rest/v1/rpc/')){check(request.p_expected_revision===main.revision,'unexpected Main revision');main={revision:main.revision+1,state:structuredClone(request.p_state)};return new Response(JSON.stringify(main))}
   const id=request.operation_id,entry=ledger.get(id);
   if(request.action==='reserve'){check(!entry,'duplicate reservation');ledger.set(id,{operation_id:id,state:'reserved'});return new Response(JSON.stringify({ok:true,reserved:true,operation:ledger.get(id)}))}
   if(request.action==='create'){
     check(entry?.state==='reserved','create without unique reservation');entry.state='creating';entry.document_type=request.document.type;entry.amount=request.document.amount;
     if(request.source.debtId==='wake-debt-B'){effects++;entry.document_id='official-B';entry.document_number='fixture-B'}
     return new Response(JSON.stringify({ok:false,uncertain:true,code:'morning_creation_uncertain',message:'fixture response lost'}),{status:503});
   }
   check(request.action==='status','unexpected Morning action '+request.action);
   return new Response(JSON.stringify({ok:true,configured:true,available:true,environment:'sandbox',unresolved:entry?.state==='creating',operation:entry||null}));
 };
 // Same production documents/editor/persistence ports as the composition; the
 // confirmation dialog is accepted in the fixture. All local writes are real.
 const documents=createDomainsCustomersDocuments({operationScope:morningOperationScope,model:{get state(){return state}},
   modal:(...args)=>uiModal.modal(...args),toast:(...args)=>uiStatus.toast(...args),confirmDialog:async()=>true,
   markModalDraftSaved:(...args)=>uiModal.markModalDraftSaved(...args),request:createMorningRequest({operationScope:morningOperationScope,supaFetch:(...args)=>cloudAuth.supaFetch(...args)}),
   dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),setDateValue:(...args)=>uiDateEditor.setDateValue(...args),
   documentsBrowser:{invalidateCache(){},viewDocument:async()=>false},
   applyVerifiedDebtDocument:(...args)=>domainsCustomers.editor.applyVerifiedMorningDocument(...args),
   rejectSecondaryMutation:(...args)=>storagePersistence.rejectSecondaryMutation(...args),rejectSecondaryIssuance:(...args)=>storagePersistence.rejectSecondaryAction(...args),
   refreshForMorningRecovery:()=>syncDocument.refreshForMorningRecovery(),
 });
 try{
   await documents.openMorningDocument(debts[0].id);
   await documents.createMorningDocument(document.querySelector('[data-action="morning-create"]'));
   const a=loadMorningDebtRecoveryContext();check(a?.debtId===debts[0].id,'A issuance did not retain recovery');
   await documents.refreshStatus({reconcile:true});check(queued.size===1,'A recovery was not scheduled');
   const stale=[...queued.values()][0];check(stale.operationId===a.operationId,'A timer has wrong identity');
   ledger.get(a.operationId).state='failed';check((await documents.recoverPendingMorningOperation()).state==='failed','A terminal failure not cleared');
   check(!loadMorningDebtRecoveryContext(),'terminal A context retained');check(queued.size===1,'A timer unexpectedly consumed');
   await documents.openMorningDocument(debts[1].id);
   await documents.createMorningDocument(document.querySelector('[data-action="morning-create"]'));
   const b=loadMorningDebtRecoveryContext();check(b?.debtId===debts[1].id&&b.operationId!==a.operationId,'B issuance identity not retained');
   await documents.refreshStatus({reconcile:true});
   check(queued.size===1&&[...queued.values()][0].operationId===b.operationId,'operation B lost its recovery wake to the authorized operation A timer');
   const statusCount=calls.filter(row=>row.action==='status').length;
   stale.run();check(queued.size===1&&calls.filter(row=>row.action==='status').length===statusCount,'canceled A disturbed B wake');
   const [key,wake]=[...queued.entries()][0];check(wake.delay===60_000,'production recovery delay changed');
   const confirmed=ledger.get(b.operationId);confirmed.state='created';confirmed.verified_at='2026-10-11T00:00:00Z';
   queued.delete(key);wake.run();
   check(calls.filter(row=>row.action==='status').length===statusCount+1,'B timer did not start its recovery read');
   // Join only after the scheduled read has started; this must not supply the
   // missing wake itself. No new create/reserve may occur during recovery.
   const completion=await documents.recoverPendingMorningOperation();await mainStorageV2.commitPromise;
   check(completion.state==='created'&&completion.ok,'B recovery did not complete '+JSON.stringify(completion));
   const restored=await mainStorageV2.recoverReadOnly(),original=restored.state.customerDebts.find(row=>row.id===debts[0].id),updated=restored.state.customerDebts.find(row=>row.id===debts[1].id);
   check(!original.debtProgress?.length&&updated.debtProgress?.length===2,'wrong debt or duplicate debt effect');
   check(updated.debtProgress.every(row=>row.id.startsWith('MORNING:'+b.operationId+':')&&row.amount===100),'B effect identity/content changed');
   check(updated.morningDocuments.some(row=>row.operationId===b.operationId&&row.documentId==='official-B'),'B document binding not persisted');
   check(!loadMorningDebtRecoveryContext()&&queued.size===0,'completed B retained a recovery context or timer');
   check(effects===1&&calls.filter(row=>row.action==='create').length===2&&calls.filter(row=>row.action==='reserve').length===2,'recovery issued another document');
   check(JSON.stringify(await db.load(owner+':shared-checks'))===rawShared,'Morning recovery modified Shared journal');
   check(JSON.stringify(cloudAuth.getAccountScope())===JSON.stringify(accountBefore),'fixture did not retain same login scope');
   check(restored.state.notes.some(row=>row.id===note.id&&row.content===note.content),'independent note lost');
   return {operationId:b.operationId,owner,oneWake:true,staleWakeFenced:true,sameLogin:true,oneDocumentEffect:true,durableDebt:true,sharedUnchanged:true};
 }finally{documents.dispose();localStorage.setItem(CLOUD_AUTO_KEY,'0');cloudAuth.saveSession(null);syncDocument.stopPolling();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear}
})()"""

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', action='store_true')
args = parser.parse_args()
with BrowserSession(ROOT / 'netunim-orders/site', 'morning-recovery-operation-timer', auto_navigate=False) as browser:
    if args.baseline:
        old = subprocess.check_output(['git', 'show', '899f2a8a2db62c2b13b6821aada0a4482f7b984f:netunim-orders/site/assets/js/domains/customers/morning-lifetime.js'], cwd=ROOT)
        prepared = browser.tmp / 'site/assets/js/domains/customers/morning-lifetime.js'
        trailer = prepared.read_text(encoding='utf-8').split('\nexport const __testBindings=', 1)[1]
        prepared.write_bytes(old + ('\nexport const __testBindings=' + trailer).encode('utf-8'))
    browser._navigate()
    result = browser.evaluate(FLOW, timeout=40)
    errors = browser.drain_serious_errors()
    assert not errors, errors
    browser._navigate()
    restored = browser.evaluate(r"""(async()=>{
      await appReady;const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js'),{createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),{STORAGE_SCHEMAS}=await import('./assets/js/shared/storage-v2-schema.js');
      const {assertOrderEntityInvariants}=await import('./assets/js/state/validation.js');
      const recovered=await createStorageJournal({owner:__OWNER__+':orders',schema:STORAGE_SCHEMAS.orders,db:createStorageJournalDb(),validate:state=>assertOrderEntityInvariants(state,{required:true})}).recover();
      return {debt:recovered.state.customerDebts.find(row=>row.id==='wake-debt-B'),note:recovered.state.notes.find(row=>row.id==='morning-wake-note')};
    })()""".replace('__OWNER__', json.dumps(result['owner'])))
    assert len(restored['debt']['debtProgress']) == 2, restored
    assert all(row['id'].startswith('MORNING:' + result['operationId'] + ':') and row['amount'] == 100 for row in restored['debt']['debtProgress']), restored
    assert restored['note']['content'] == 'independent durable note', restored
    errors = browser.drain_serious_errors()
    assert not errors, errors
    print('PASS Morning timer identity + native IDB restart: ' + json.dumps(result))
