"""Native status publication: preserve another draft and current evidence through accepted work."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_cloud import LOCAL_CLOUD

FLOW = r"""(async()=>{
  await appReady;syncDocument.stopPolling();finance.runtime.stop();calendarRuntime.dispose();
"""+LOCAL_CLOUD+r"""
  const {createDomainsCustomersDocuments}=await import('./assets/js/domains/customers/documents.js');
  const {createMorningRequest}=await import('./assets/js/integrations/morning.js');
  const {createMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,morningFinancialSnapshot}=await import('./assets/js/domains/customers/morning-debt-recovery.js');
  const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),{createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
  const {STORAGE_SCHEMAS}=await import('./assets/js/shared/storage-v2-schema.js'),{assertOrderEntityInvariants}=await import('./assets/js/state/validation.js');
  const db=createStorageJournalDb(),raw=async owner=>JSON.stringify(await db.load(owner)),sharedBefore=await raw('local:shared-checks'),notesBefore=JSON.stringify(state.notes);
  const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
  const debt={id:'native-status-debt',customerName:'Exact status customer',amount:100,paid:false,invoiceIssued:false,supplied:true,closedAt:null};state.customerDebts.push(debt);
  check(storagePersistence.scheduleSave('Status owner fixture',{domains:['customerDebts'],operations:[{type:'put',collection:'customerDebts',mode:'insert',id:debt.id,record:debt,index:state.customerDebts.length-1}]}),'fixture debt accepted by V2');
  await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();
  const OP='11111111-1111-4111-8111-111111111111',context=createMorningDebtRecoveryContext({operationId:OP,debtId:debt.id,type:320,amount:30,applyPayment:true,applyInvoice:true,financialSnapshot:morningFinancialSnapshot(debt)});saveMorningDebtRecoveryContext(context);
  let phase='allocation',held=gate(),entered=gate();const calls=[];
  cloudAuth.supaFetch=async(_path,options)=>{
    options.assertRequestScope();const input=JSON.parse(options.body);calls.push(input.action);
    if(input.action==='reserve')return new Response(JSON.stringify({ok:true,reserved:true,operation:{operation_id:input.operation_id,state:'reserved'}}));
    if(input.action==='create')return new Response(JSON.stringify({ok:true,verified:true,document:{id:'official-issued-document',number:'5001',type:input.document.type,amount:input.document.amount}}));
    check(input.action==='status','status fixture sends only defined operation commands');
    if(phase==='old'||phase==='old-before-create'){entered.resolve();await held.promise;return new Response(JSON.stringify({ok:true,configured:false,available:false,environment:'production',operation:null}))}
    return new Response(JSON.stringify({ok:true,configured:true,available:true,environment:'production',operation:phase==='allocation'?{operation_id:OP,state:'created',document_id:'official-debt-document',document_type:320,amount:30,verified_at:'2026-10-14T00:00:00Z'}:null}));
  };
  const documents=createDomainsCustomersDocuments({operationScope:fixtureMorningScope,model,request:createMorningRequest({operationScope:fixtureMorningScope,supaFetch:(...args)=>cloudAuth.supaFetch(...args)}),
    subscribeAccountScope:cloudAuth.subscribeAccountScope,modal:(...args)=>uiModal.modal(...args),toast:(...args)=>uiStatus.toast(...args),confirmDialog:(...args)=>uiModal.confirmDialog(...args),markModalDraftSaved:()=>uiModal.markModalDraftSaved(),dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),setDateValue:(...args)=>uiDateEditor.setDateValue(...args),documentsBrowser:{invalidateCache(){},viewDocument:async()=>false},
    rejectSecondaryIssuance:()=>storagePersistence.rejectSecondaryAction(),rejectSecondaryMutation:()=>storagePersistence.rejectSecondaryMutation(),applyVerifiedDebtDocument:(...args)=>domainsCustomers.editor.applyVerifiedMorningDocument(...args),refreshForMorningRecovery:async()=>{entered.resolve();await held.promise;return true}});
  const wait=async predicate=>{const until=performance.now()+5000;while(!predicate()){if(performance.now()>until)throw Error('status did not settle');await new Promise(done=>requestAnimationFrame(done))}};
  try{
    const opening=documents.openMorningDocumentModal({debtId:debt.id,prefill:{customerName:debt.customerName,amount:30},source:{kind:'debt'}});await entered.promise;
    uiModal.modal('Replacement form','<div id="morningConnectionStatus">replacement status</div><input id="replacementDraft" value="initial">');await Promise.resolve();document.getElementById('replacementDraft').value='exact unsaved draft';
    check(uiModal.modalHasUnsavedDraft(),'replacement draft starts dirty');held.resolve();await opening;await mainStorageV2.commitPromise;await documents.runtime.drain();
    check(uiModal.modalHasUnsavedDraft(),'late accepted allocation cannot mark another draft saved');
    check(document.getElementById('morningConnectionStatus').textContent==='replacement status','late connection publication cannot cross its form boundary');
    check(loadMorningDebtRecoveryContext()===null,'accepted original durable allocation still clears its own recovery');
    const recovered=await createStorageJournal({owner:'local:orders',schema:STORAGE_SCHEMAS.orders,db,validate:value=>assertOrderEntityInvariants(value,{required:true})}).recover(),stored=recovered.state.customerDebts.find(row=>row.id===debt.id);
    check(stored.debtProgress.length===2&&stored.debtProgress.every(row=>row.id.startsWith('MORNING:'+OP+':')&&row.amount===30),'native journal retains exact original operation events once');
    check(JSON.stringify(recovered.state.notes)===notesBefore&&await raw('local:shared-checks')===sharedBefore,'notes and Shared journal survive status allocation');
    const mainAfter=await raw('local:orders');uiModal.closeModal();phase='ready';
    await documents.openMorningDocumentModal({initialType:305,prefill:{customerName:'Latest status',amount:42},source:{kind:'standalone'}});
    phase='old';held=gate();entered=gate();const old=documents.refreshStatus();await entered.promise;phase='ready';await documents.refreshStatus();const latest=document.getElementById('morningConnectionStatus').textContent;
    held.resolve();await old;check(document.getElementById('morningConnectionStatus').textContent===latest&&!document.querySelector('[data-action="morning-create"]').disabled,'older response cannot replace the newer ready read');
    phase='old-before-create';held=gate();entered=gate();const stale=documents.refreshStatus();await entered.promise;phase='ready';document.getElementById('morningDescription').value='Exact official document';
    const button=document.querySelector('[data-action="morning-create"]'),issuing=documents.createMorningDocument(button);await wait(()=>document.getElementById('confirmBackdrop').classList.contains('open'));document.getElementById('confirmAccept').click();await issuing;
    const official=document.getElementById('morningConnectionStatus').textContent;check(official.includes('המסמך הופק')&&button.disabled,'official issuance owns its completion presentation');held.resolve();await stale;
    check(document.getElementById('morningConnectionStatus').textContent===official&&button.disabled,'starting issuance fences an older status read in the same form');
    check(calls.filter(action=>action==='reserve').length===1&&calls.filter(action=>action==='create').length===1,'status races never issue or reserve a duplicate document');
    check(await raw('local:orders')===mainAfter&&await raw('local:shared-checks')===sharedBefore,'read/standalone flows preserve exact Main and Shared journals');
  }finally{held.resolve();documents.dispose();await documents.runtime.drain();uiModal.closeModal()}
  return done;
})()"""

with BrowserSession(ROOT/'netunim-orders/site','morning-status-ownership') as browser:
    result=browser.evaluate(FLOW,timeout=45)
    assert not browser.drain_serious_errors()
    print(f'PASS Morning status ownership: {len(result)} native draft/publication/issuance/journal assertions')
