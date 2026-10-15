"""Morning catalog malformed evidence on actual DOM, scope and native journals."""
import argparse
import json
import subprocess
from browser_harness import BrowserSession,ROOT

FLOW=r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const phase=__PHASE__,check=(value,message)=>{if(!value)throw Error(message)};
 const {createMorningOperationScope}=await import('./assets/js/core/morning-operation-scope.js'),{createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const scope=createMorningOperationScope({readAccess:()=>({account:{owner:'local',epoch:1},storageOwner:'local',readable:true,writable:true})});morningOperationScope.capture=scope.capture;morningOperationScope.captureRead=scope.captureRead;
 const op='00000000-0000-4000-8000-000000000001',doc={id:'00000000-0000-4000-8000-000000000002',number:'4001',type:400,amount:30,date:'2026-10-15',clientName:'exact customer',status:0,currency:'ILS'};
 const debt={id:'catalog-debt',customerName:'exact customer',amount:100,debtProgress:[{id:'MORNING:'+op+':payment',source:'morning',kind:'payment',action:'add',amount:30,createdAt:'2026-10-15T00:00:00Z'}]};state.customerDebts.push(debt);state.notes.push({id:'catalog-note',content:'independent note'});
 storagePersistence.scheduleSave('catalog fixture',{domains:['customerDebts','notes'],operations:[{type:'put',collection:'customerDebts',id:debt.id,mode:'insert',index:state.customerDebts.length-1,record:debt},{type:'put',collection:'notes',id:'catalog-note',mode:'insert',index:state.notes.length-1,record:state.notes.at(-1)}]});await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();
 const raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')}),before=await raw(),progress=JSON.stringify(debt.debtProgress);let invalid=true,reads=0;
 cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope();const body=JSON.parse(options.body);reads++;let data;
  if(body.action==='status')data={ok:true,operation:{operation_id:invalid&&phase==='metadata-identity'?'foreign-operation':op,state:'created',verified_at:'2026-10-15T01:00:00Z',document_id:doc.id,document_number:doc.number,document_type:doc.type}};
  else if(body.action==='search_documents')data={ok:true,items:invalid&&phase==='search-shape'?{}:[doc],total:1,pages:1};
  else if(body.action==='get_document')data={ok:true,document:{...doc,id:invalid?'foreign-document':doc.id}};
  else throw Error('unexpected catalog action '+body.action);
  return new Response(JSON.stringify(data));
 };
 if(phase==='metadata-identity'){
  // Run the real browser hydration against a native marker without launching a
  // detached command through a test-only implementation.
  document.body.insertAdjacentHTML('beforeend','<button id="catalogMarker" data-morning-debt-operation="'+op+'"><span data-morning-debt-label>unresolved</span></button>');
  await hydrateDebtDocumentLinks(document);const button=document.querySelector('#catalogMarker');
  check(button.dataset.morningDebtOperation===op&&!button.dataset.clickArg0,'foreign status authorized a debt document link');check(!debt.morningDocuments?.length,'foreign status changed debt metadata');check(await raw()===before,'invalid metadata changed native stores');
  invalid=false;await hydrateDebtDocumentLinks(document);check(button.dataset.clickArg0===doc.id&&!button.dataset.morningDebtOperation,'verified same-operation retry failed');
 }else{
  await domainsCustomers.morningActions['open-morning-documents']();
  for(let n=0;n<100&&document.querySelector('#morningDocumentsBrowser')?.getAttribute('aria-busy')!=='false';n++)await new Promise(resolve=>setTimeout(resolve,20));
  if(phase==='search-shape')check(!document.querySelector('.morning-browser-table tbody tr'),'malformed search became selectable results');
  else{
   const button=document.querySelector('[data-action="morning-details"]');check(button,'valid search missing detail control');button.click();for(let n=0;n<100&&button.disabled;n++)await new Promise(resolve=>setTimeout(resolve,20));
   check(document.querySelector('#morningBrowserDetails').hidden,'foreign detail became visible');
  }
  check(await raw()===before,'readonly malformed catalog changed native stores');
 }
 check(JSON.stringify(debt.debtProgress)===progress,'catalog changed financial allocation');
 return {phase,reads,invalidEvidenceBlocked:true,financialPolicyRetained:true};
})()"""
parser=argparse.ArgumentParser();parser.add_argument('--baseline',action='store_true');parser.add_argument('--phase',action='append',choices=('metadata-identity','search-shape','detail-identity'));args=parser.parse_args()
for phase in args.phase or (('metadata-identity',) if args.baseline else ('metadata-identity','search-shape','detail-identity')):
 with BrowserSession(ROOT/'netunim-orders/site','morning-catalog-'+phase,auto_navigate=False) as browser:
  if args.baseline:
   file=browser.tmp/'site/assets/js/domains/customers/documents-browser.js';trailer=file.read_text(encoding='utf-8').split('\nexport const __testBindings=',1)[1]
   old=subprocess.check_output(['git','show','9560ebd1:netunim-orders/site/assets/js/domains/customers/documents-browser.js'],cwd=ROOT);file.write_bytes(old+('\nexport const __testBindings='+trailer).encode('utf-8'))
  browser._navigate();result=browser.evaluate(FLOW.replace('__PHASE__',json.dumps(phase)),timeout=35);assert not browser.drain_serious_errors()
  browser._navigate();restored=browser.evaluate("(async()=>{await appReady;const record=await mainStorageV2.recoverReadOnly();return {debt:record.state.customerDebts.find(row=>row.id==='catalog-debt'),note:record.state.notes.find(row=>row.id==='catalog-note')}})()")
  assert restored['note']['content']=='independent note';assert len(restored['debt']['debtProgress'])==1
  if phase=='metadata-identity':assert restored['debt']['morningDocuments'][0]['documentNumber']=='4001'
  print('PASS Morning catalog: '+json.dumps(result),flush=True)
