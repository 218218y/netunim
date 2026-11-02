"""Native active/closed/replaced form controls and exact isolated payloads."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_cloud import LOCAL_CLOUD

FLOW=r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();calendarRuntime.dispose();
 const NativeDate=Date,started=NativeDate.now(),instant=NativeDate.UTC(2026,10,2,12),now=()=>instant+NativeDate.now()-started;
 globalThis.Date=new Proxy(NativeDate,{get:(target,key)=>key==='now'?now:Reflect.get(target,key),construct:(target,args,newTarget)=>Reflect.construct(target,args.length?args:[now()],newTarget)});
"""+LOCAL_CLOUD+r"""
 const {createDomainsCustomersDocuments}=await import('./assets/js/domains/customers/documents.js'),{createMorningRequest}=await import('./assets/js/integrations/morning.js');
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb(),raw=async()=>JSON.stringify([await db.load('local:orders'),await db.load('local:shared-checks'),localStorage.getItem('orders.morning.pending-issuance.v1')]),before=await raw(),checks=[];
 const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)},transaction={archiveId:71,amount:42,date:'2026-10-14',currency:'ILS',status:'processed'},payloads=[];
 let ensure=async()=>true,reportGate=null,reportEntered=()=>{},reportEnvironment='production',reportFailure=false;
 let statusGate=null,statusEntered=()=>{},statusEnvironment='production',statusFailure=false;
 const reportCalls=[];
 const request=createMorningRequest({operationScope:fixtureMorningScope,supaFetch:async(_path,options)=>{
  const body=JSON.parse(options.body);
  if(body.action==='report_page'){
   reportCalls.push(body);reportEntered();if(reportGate)await reportGate;
   if(reportFailure)return Response.json({ok:false,message:'report unavailable'},{status:503});
   const documents=body.source==='documents',items=[{id:documents?'output':'input',kind:documents?'document':'expense',type:305,date:body.fromDate,status:10,businessType:1,grossCents:documents?11800:5900,vatCents:documents?1800:900,deductibleVatCents:450}];
   return Response.json({ok:true,version:1,...body,environment:reportEnvironment,pageSize:50,total:1,pages:1,readAt:new Date().toISOString(),items});
  }
  const environment=statusEnvironment;if(statusGate){statusEntered();await statusGate;}
  if(statusFailure)return Response.json({ok:false,message:'status unavailable'},{status:503});
  return Response.json({ok:true,configured:true,available:true,environment,operation:null});
 }});
 const documents=createDomainsCustomersDocuments({operationScope:fixtureMorningScope,subscribeAccountScope:cloudAuth.subscribeAccountScope,model,modal:(...args)=>uiModal.modal(...args),toast(){},dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),setDateValue:(...args)=>uiDateEditor.setDateValue(...args),getBusinessBankTransactions:()=>[transaction],ensureBusinessBankTransactions:()=>ensure(),documentsBrowser:{previewDraft:async payload=>{payloads.push(payload);return true}},request});
 const trap=document.createElement('div');trap.innerHTML='<div data-payment-row="0"><select data-payment-field="type"><option value="3" selected>card</option></select><input data-payment-field="price" value="99"><input data-payment-field="cardNum" value=""></div><input type="radio" name="morningDocumentType" value="305">';document.getElementById('main').append(trap);
 const commands=[['syncPaymentType'],['syncPaymentBank',0],['syncPaymentTotal'],['syncDocumentType'],['addMorningPayment'],['removeMorningPayment',0],['linkBankDebt','missing'],['filterBankDebtPicker','missing'],['linkBankTransaction',71],['clearBankTransactionLink'],['filterBankTransactionPicker','missing']];
 try{
  await documents.openMorningDocumentModal({prefill:{customerName:'Exact owner',amount:42,description:'Exact source'},initialType:320,source:{kind:'standalone'}});
  await documents.runtime.drain();
  const status=document.getElementById('morningConnectionStatus'),vat=document.querySelector('[data-morning-vat-summary]'),rect=element=>element.getBoundingClientRect();
  check(status.textContent.includes('Production')&&vat.textContent.includes('13.50'),'issuance header shows the complete default VAT');
  check(reportCalls.length===2&&reportCalls.every(row=>row.fromDate==='2026-09-01'&&row.toDate==='2026-10-31'),'issuance header uses the default September–October cycle');
  check(getComputedStyle(status).fontSize===getComputedStyle(vat).fontSize&&getComputedStyle(status).fontWeight===getComputedStyle(vat).fontWeight,'header VAT matches connection typography');
  const period=vat.querySelector('[data-morning-vat-period]');
  check(period?.textContent==='ספטמבר–אוקטובר 2026'&&rect(period).height>0,'VAT reporting months are not visibly displayed');
  check(parseFloat(getComputedStyle(period).fontSize)<parseFloat(getComputedStyle(vat).fontSize),'VAT reporting months are not smaller than the amount');
  check(rect(vat).right<=rect(status).left&&Math.abs((rect(vat).top+rect(vat).bottom-rect(status).top-rect(status).bottom)/2)<2,'header VAT is not aligned at the left of connection status');
  check(document.getElementById('modal').scrollWidth<=document.getElementById('modal').clientWidth+1,'header VAT overflows the modal');
  const suffix=trap.querySelector('[data-payment-field="cardNum"]'),invoice=trap.querySelector('input[type="radio"]');documents.syncPaymentType();check(suffix.value==='','active editor leaves external card suffix untouched');
  check(await documents.previewMorningDocument()===true&&payloads.length===1&&payloads[0].document.payment.length===1&&payloads[0].document.payment[0].price===42,'preview captures only its exact owned receipt');
  check(documents.linkBankTransaction(71)===true,'current form can explicitly link a validated business transaction');check(invoice.disabled===false,'bank type restriction stays in its own form');
  check(documents.clearBankTransactionLink()===true,'current form can restore its original source');
  uiModal.closeModal();const closed=trap.innerHTML;for(const [name,...args] of commands)check(documents[name](...args)===false,'closed form rejects '+name);check(trap.innerHTML===closed,'closed editor cannot mutate external controls');
  await documents.openMorningDocumentModal({prefill:{customerName:'Exact replacement',amount:42,description:'Original'},initialType:320});
  uiModal.modal('Other feature',trap.innerHTML+'<input id="replacementFormDraft" value="initial">');await Promise.resolve();document.getElementById('replacementFormDraft').value='exact dirty draft';
  const replacement=document.getElementById('modal').innerHTML;for(const [name,...args] of commands)check(documents[name](...args)===false,'replaced form rejects '+name);
  check(document.getElementById('modal').innerHTML===replacement&&uiModal.modalHasUnsavedDraft(),'replaced editor preserves another feature controls and draft guard');check(await raw()===before,'form/link edits preserve exact Main, Shared and recovery evidence');
  await documents.openMorningDocumentModal({prefill:{customerName:'Cheque series',amount:6253.75,description:'Monthly cheques'},initialType:320});
  const receipt=(index,key)=>document.querySelector(`#modal [data-payment-row="${index}"] [data-payment-field="${key}"]`);
  const receiptDate=(index,date)=>uiDateEditor.setDateValue(document.getElementById('morningPaymentDate'+index),date,false);
  for(const [key,value] of Object.entries({type:'2',price:'1250.75',bankName:'12',bankBranch:'600',bankAccount:'0012345',chequeNum:'000099'}))receipt(0,key).value=value;
  receiptDate(0,'2026-11-15');documents.syncPaymentType();await documents.addMorningPayment();
  check(receipt(1,'chequeNum').value==='000100'&&document.getElementById('morningPaymentDate1').value==='2026-12-15','native add continues the entered cheque '+JSON.stringify([receipt(1,'chequeNum').value,document.getElementById('morningPaymentDate0').value,document.getElementById('morningPaymentDate1').value]));
  receiptDate(1,'2026-12-31');receipt(1,'chequeNum').value='000200';receipt(1,'bankBranch').value='777';
  for(let i=0;i<3;i++)await documents.addMorningPayment();
  check(await documents.previewMorningDocument()===true,'native cheque form validates through the real preview command');
  const cheques=payloads.at(-1).document.payment;
  check(JSON.stringify(cheques.map(row=>row.date))===JSON.stringify(['2026-11-15','2026-12-31','2027-01-31','2027-02-28','2027-03-31']),'manual date restarts the real form schedule without February drift');
  check(JSON.stringify(cheques.map(row=>row.chequeNum))===JSON.stringify(['000099','000200','000201','000202','000203']),'native payload preserves manually edited and sequential cheque numbers');
  check(cheques.every(row=>row.price===1250.75&&row.bankCode==='12'&&row.bankAccount==='0012345')&&cheques.slice(1).every(row=>row.bankBranch==='777'),'native payload preserves cents, bank details and leading account zeros');
  check(cheques.every(row=>!Object.hasOwn(row,'bankSourceKey')),'draft cheques cannot acquire verified bank provenance');
  const queued=documents.addMorningPayment();check(documents.runtime.isPending(),'lazy receipt work is retained by the Morning lifetime');
  uiModal.modal('Queued replacement','<p id="queuedReplacement">exact replacement</p>');
  check(await queued===false,'receipt import cannot append after form replacement');await documents.runtime.drain();
  check(document.getElementById('queuedReplacement')?.textContent==='exact replacement','late receipt work preserves the replacement display');
  check(await raw()===before,'cheque editing and preview preserve exact Main, Shared and recovery evidence');
  const gate=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no});return {promise,resolve,reject}},held=gate(),entered=gate(),originalError=console.error,diagnostics=[];
  ensure=()=>{entered.resolve();return held.promise};console.error=(...args)=>diagnostics.push(args);
  try{
   const opening=documents.openMorningDocumentModal({prefill:{customerName:'Held catalog',amount:42,description:'Held'},initialType:320});await entered.promise;await opening;
   documents.runtime.cancelPending();let drained=false;const draining=documents.runtime.drain().then(()=>{drained=true});for(let i=0;i<8;i++)await Promise.resolve();check(!drained,'accepted catalog refresh remains joined after cancellation');
   uiModal.modal('Catalog replacement','<p id="catalogReplacement">unchanged catalog replacement</p>');held.reject(Error('private former form bank detail'));await draining;
   check(diagnostics.length===0,'revoked catalog failure cannot publish private diagnostics');check(document.getElementById('catalogReplacement')?.textContent==='unchanged catalog replacement','late catalog cannot replace another capability display');check(await raw()===before,'catalog drain preserves exact Main, Shared and recovery evidence');
  }finally{held.resolve();console.error=originalError;ensure=async()=>true}
  const late=gate(),reading=gate();reportGate=late.promise;reportEntered=()=>reading.resolve();
  await documents.openMorningDocumentModal({prefill:{customerName:'Late VAT',amount:42},initialType:320});await reading.promise;
  uiModal.modal('VAT replacement','<p id="vatReplacement">exact replacement</p>');const replaced=document.getElementById('modal').innerHTML;
  late.resolve();await documents.runtime.drain();reportGate=null;reportEntered=()=>{};
  check(document.getElementById('modal').innerHTML===replaced,'late VAT cannot replace another modal');
  reportFailure=true;await documents.openMorningDocumentModal({prefill:{customerName:'Unavailable VAT',amount:42},initialType:320});await documents.runtime.drain();
  check(!document.querySelector('[data-action="morning-create"]').disabled&&document.querySelector('[data-morning-vat-summary]').title.includes('אינו זמין'),'unavailable VAT does not change issuance authority');
  reportFailure=false;reportEnvironment='sandbox';await documents.refreshStatus();await documents.runtime.drain();
  check(!document.querySelector('[data-morning-vat-summary]').textContent.includes('13.50'),'wrong-environment VAT cannot publish an amount');
  const statusWait=gate(),statusReading=gate();statusGate=statusWait.promise;statusEntered=()=>statusReading.resolve();
  const oldStatus=documents.refreshStatus();await statusReading.promise;
  statusGate=null;statusEnvironment='sandbox';const reportCount=reportCalls.length;
  await documents.refreshStatus();statusWait.resolve();await oldStatus;await documents.runtime.drain();
  check(reportCalls.length-reportCount===2&&document.getElementById('morningConnectionStatus').textContent.includes('Sandbox')&&document.querySelector('[data-morning-vat-summary]').textContent.includes('13.50'),'old status cannot restart VAT with the former environment');
  statusFailure=true;await documents.refreshStatus();await documents.runtime.drain();
  const clearedVat=document.querySelector('[data-morning-vat-summary]');
  check(clearedVat.hidden&&!clearedVat.textContent&&!clearedVat.hasAttribute('aria-label'),'failed connection refresh cannot retain the previous VAT amount');
 }finally{documents.dispose();await documents.runtime.drain();trap.remove();uiModal.closeModal()}
 return checks;
})()"""
for width in [1440,390]:
    with BrowserSession(ROOT/'netunim-orders/site',f'morning-form-edit-ownership-{width}') as browser:
        browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
        result=browser.evaluate(FLOW,timeout=35)
        assert not browser.drain_serious_errors()
    print(f'PASS Morning form edit ownership: {len(result)} native scoped-control/payload/journal assertions')
