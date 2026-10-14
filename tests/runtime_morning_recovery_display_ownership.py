"""Native recovery choices and accepted confirmation across modal replacement."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_cloud import LOCAL_CLOUD

FLOW = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();calendarRuntime.dispose();
"""+LOCAL_CLOUD+r"""
 const {createDomainsCustomersDocuments}=await import('./assets/js/domains/customers/documents.js'),{createMorningRequest}=await import('./assets/js/integrations/morning.js');
 const {createMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,morningFinancialSnapshot}=await import('./assets/js/domains/customers/morning-debt-recovery.js');
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),{createStorageJournal}=await import('./assets/js/shared/storage-journal.js'),{STORAGE_SCHEMAS}=await import('./assets/js/shared/storage-v2-schema.js'),{assertOrderEntityInvariants}=await import('./assets/js/state/validation.js');
 const db=createStorageJournalDb(),raw=async owner=>JSON.stringify(await db.load(owner)),sharedBefore=await raw('local:shared-checks'),notesBefore=JSON.stringify(state.notes),checks=[];
 const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const debt={id:'native-decision-debt',customerName:'Exact decision customer',amount:100,paid:false,invoiceIssued:false,closedAt:null};state.customerDebts.push(debt);
 storagePersistence.scheduleSave('Decision fixture',{domains:['customerDebts'],operations:[{type:'put',collection:'customerDebts',mode:'insert',id:debt.id,record:debt,index:state.customerDebts.length-1}]});await mainStorageV2.commitPromise;
 const OP='11111111-1111-4111-8111-111111111111',context=createMorningDebtRecoveryContext({operationId:OP,debtId:debt.id,type:320,amount:30,applyPayment:true,applyInvoice:true,financialSnapshot:morningFinancialSnapshot(debt)});saveMorningDebtRecoveryContext(context);
 debt.amount=80;storagePersistence.scheduleSave('Changed decision fixture',{domains:['customerDebts'],operations:[{type:'put',collection:'customerDebts',mode:'replace',id:debt.id,record:debt}]});await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();
 const before=await raw('local:orders'),held=gate(),entered=gate();let refreshes=0,calls=0;
 const documents=createDomainsCustomersDocuments({operationScope:fixtureMorningScope,subscribeAccountScope:cloudAuth.subscribeAccountScope,model,modal:(...args)=>uiModal.modal(...args),toast:(...args)=>uiStatus.toast(...args),markModalDraftSaved:()=>{uiModal.markModalDraftSaved()},dateEditorMarkup:()=>'',documentsBrowser:{},
  applyVerifiedDebtDocument:command=>domainsCustomers.editor.applyVerifiedMorningDocument(command),rejectSecondaryMutation:()=>storagePersistence.rejectSecondaryMutation(),
  refreshForMorningRecovery:async()=>{if(++refreshes===3){entered.resolve();await held.promise}return true},
  request:createMorningRequest({operationScope:fixtureMorningScope,supaFetch:async(_path,options)=>{options.assertRequestScope();const request=JSON.parse(options.body);check(request.action==='status','recovery display sends only verified status commands');calls++;return new Response(JSON.stringify({ok:true,operation:{operation_id:OP,state:'created',document_id:'official-decision-document',document_type:320,amount:30,verified_at:'2026-10-14T00:00:00Z'}}))}})});
 try{
  const first=await documents.recoverPendingMorningOperation();check(first.result?.reason==='decision-required','financial change opens a recovery-only decision');
  check(!document.getElementById('morningRecoveryPayment').checked&&!document.getElementById('morningRecoveryInvoice').checked,'changed amount preserves independent safe defaults');
  uiModal.closeModal();check(documents.saveRecoveryChoice()===false,'closed decision cannot save choices');check(JSON.stringify(loadMorningDebtRecoveryContext())===JSON.stringify(context),'closed choice retains exact recovery');
  await documents.recoverPendingMorningOperation();document.getElementById('morningRecoveryPayment').checked=true;document.getElementById('morningRecoveryInvoice').checked=true;
  const confirming=documents.confirmRecoveryChoice(document.querySelector('[data-action="morning-recovery-confirm"]'));await entered.promise;
  uiModal.modal('Replacement draft','<input id="replacementDecisionDraft" value="initial"><input id="morningRecoveryPayment" type="checkbox"><input id="morningRecoveryInvoice" type="checkbox">');await Promise.resolve();document.getElementById('replacementDecisionDraft').value='exact dirty replacement';
  const savedChoice=JSON.stringify(loadMorningDebtRecoveryContext());check(uiModal.modalHasUnsavedDraft(),'replacement draft is dirty before accepted confirmation completes');
  check(documents.saveRecoveryChoice()===false,'detached decision rejects matching ID controls in another modal');check(JSON.stringify(loadMorningDebtRecoveryContext())===savedChoice,'detached choice cannot replace the accepted original approval');
  held.resolve();await confirming;await documents.runtime.drain();await mainStorageV2.commitPromise;
  check(uiModal.modalHasUnsavedDraft(),'accepted confirmation cannot certify a replacement draft');check(loadMorningDebtRecoveryContext()===null,'accepted original approval completes durable recovery');
  const recovered=await createStorageJournal({owner:'local:orders',schema:STORAGE_SCHEMAS.orders,db,validate:value=>assertOrderEntityInvariants(value,{required:true})}).recover(),stored=recovered.state.customerDebts.find(row=>row.id===debt.id);
  check(stored.amount===80&&stored.debtProgress.length===2&&stored.debtProgress.every(row=>row.id.startsWith('MORNING:'+OP+':')&&row.amount===30),'native journal retains exactly one original payment and invoice event');
  check(await raw('local:orders')!==before&&JSON.stringify(recovered.state.notes)===notesBefore&&await raw('local:shared-checks')===sharedBefore,'approved Main allocation preserves exact notes and Shared journal');
  check(calls===3,'confirmation recovery performs one final verified read and no issuance POST');
 }finally{held.resolve();documents.dispose();await documents.runtime.drain();uiModal.closeModal()}
 return checks;
})()"""

with BrowserSession(ROOT/'netunim-orders/site','morning-recovery-display-ownership') as browser:
    result=browser.evaluate(FLOW,timeout=35)
    assert not browser.drain_serious_errors()
    print(f'PASS Morning recovery display ownership: {len(result)} native modal/choice/confirmation/journal assertions')
