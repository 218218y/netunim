"""Native active/closed/replaced form controls and exact isolated payloads."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_cloud import LOCAL_CLOUD

FLOW=r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();calendarRuntime.dispose();
"""+LOCAL_CLOUD+r"""
 const {createDomainsCustomersDocuments}=await import('./assets/js/domains/customers/documents.js'),{createMorningRequest}=await import('./assets/js/integrations/morning.js');
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb(),raw=async()=>JSON.stringify([await db.load('local:orders'),await db.load('local:shared-checks'),localStorage.getItem('orders.morning.pending-issuance.v1')]),before=await raw(),checks=[];
 const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)},transaction={archiveId:71,amount:42,date:'2026-10-14',currency:'ILS',status:'processed'},payloads=[];
 const documents=createDomainsCustomersDocuments({operationScope:fixtureMorningScope,subscribeAccountScope:cloudAuth.subscribeAccountScope,model,modal:(...args)=>uiModal.modal(...args),toast(){},dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),setDateValue:(...args)=>uiDateEditor.setDateValue(...args),getBusinessBankTransactions:()=>[transaction],ensureBusinessBankTransactions:async()=>true,documentsBrowser:{previewDraft:async payload=>{payloads.push(payload);return true}},request:createMorningRequest({operationScope:fixtureMorningScope,supaFetch:async()=>new Response(JSON.stringify({ok:true,configured:true,available:true,operation:null}))})});
 const trap=document.createElement('div');trap.innerHTML='<div data-payment-row="0"><select data-payment-field="type"><option value="3" selected>card</option></select><input data-payment-field="price" value="99"><input data-payment-field="cardNum" value=""></div><input type="radio" name="morningDocumentType" value="305">';document.getElementById('main').append(trap);
 const commands=[['syncPaymentType'],['syncPaymentBank',0],['syncPaymentTotal'],['syncDocumentType'],['addMorningPayment'],['removeMorningPayment',0],['linkBankDebt','missing'],['filterBankDebtPicker','missing'],['linkBankTransaction',71],['clearBankTransactionLink'],['filterBankTransactionPicker','missing']];
 try{
  await documents.openMorningDocumentModal({prefill:{customerName:'Exact owner',amount:42,description:'Exact source'},initialType:320,source:{kind:'standalone'}});
  const suffix=trap.querySelector('[data-payment-field="cardNum"]'),invoice=trap.querySelector('input[type="radio"]');documents.syncPaymentType();check(suffix.value==='','active editor leaves external card suffix untouched');
  check(await documents.previewMorningDocument()===true&&payloads.length===1&&payloads[0].document.payment.length===1&&payloads[0].document.payment[0].price===42,'preview captures only its exact owned receipt');
  check(documents.linkBankTransaction(71)===true,'current form can explicitly link a validated business transaction');check(invoice.disabled===false,'bank type restriction stays in its own form');
  check(documents.clearBankTransactionLink()===true,'current form can restore its original source');
  uiModal.closeModal();const closed=trap.innerHTML;for(const [name,...args] of commands)check(documents[name](...args)===false,'closed form rejects '+name);check(trap.innerHTML===closed,'closed editor cannot mutate external controls');
  await documents.openMorningDocumentModal({prefill:{customerName:'Exact replacement',amount:42,description:'Original'},initialType:320});
  uiModal.modal('Other feature',trap.innerHTML+'<input id="replacementFormDraft" value="initial">');await Promise.resolve();document.getElementById('replacementFormDraft').value='exact dirty draft';
  const replacement=document.getElementById('modal').innerHTML;for(const [name,...args] of commands)check(documents[name](...args)===false,'replaced form rejects '+name);
  check(document.getElementById('modal').innerHTML===replacement&&uiModal.modalHasUnsavedDraft(),'replaced editor preserves another feature controls and draft guard');check(await raw()===before,'form/link edits preserve exact Main, Shared and recovery evidence');
 }finally{documents.dispose();await documents.runtime.drain();trap.remove();uiModal.closeModal()}
 return checks;
})()"""
with BrowserSession(ROOT/'netunim-orders/site','morning-form-edit-ownership') as browser:
    result=browser.evaluate(FLOW,timeout=25)
    assert not browser.drain_serious_errors()
    print(f'PASS Morning form edit ownership: {len(result)} native scoped-control/payload/journal assertions')
