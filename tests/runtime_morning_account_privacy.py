"""Completed Morning surfaces under real auth changes; synthetic server only."""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

SETUP = r"""(async()=>{
 await appReady;syncDocument.stopPolling();domainsFinanceController.stopAutoSync?.();
 const surface=__SURFACE__,owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
 const debt={id:'privacy-debt',customerName:'private Morning customer A',amount:100,paid:false,invoiceIssued:false,closedAt:null};state.customerDebts.push(debt);
 storagePersistence.scheduleSave('Morning privacy fixture',{domains:['customerDebts'],operations:[{type:'put',collection:'customerDebts',mode:'insert',id:debt.id,record:debt,index:state.customerDebts.length-1}]});await mainStorageV2.commitPromise;
 const login=id=>cloudAuth.saveSession(id?{user:{id},access_token:'synthetic-'+id,expires_at:9999999999}:null);login(owner);
 let main=null,shared=null;cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;
 cloudTransport.rpcSaveV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async checks=>{shared={revision:1,state:{version:1,checks:structuredClone(checks),bankEvents:[]}};return {r:{ok:true},row:shared}};
 await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});session.storageProtocolBlocked=false;morningOperationScope.capture()();
 const calls=[],urls=[],revoked=[],createUrl=URL.createObjectURL,revokeUrl=URL.revokeObjectURL;
 URL.createObjectURL=blob=>{const url=createUrl(blob);urls.push(url);return url};URL.revokeObjectURL=url=>{revoked.push(url);revokeUrl(url)};
 const doc={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',number:123,type:305,date:'2026-10-10',amount:100,currency:'ILS',clientName:'private Morning customer A',status:0,description:'private invoice description A'};
 cloudAuth.supaFetch=async(_path,options)=>{
  options.assertRequestScope();const request=JSON.parse(options.body);calls.push(request);let data={ok:true};
  if(request.action==='status')data={ok:true,configured:true,available:true,environment:'sandbox'};
  if(request.action==='search_documents')data={ok:true,items:[doc],total:1,pages:1};
  if(request.action==='get_document')data={ok:true,document:doc};
  if(request.action==='preview')data={ok:true,pdfBase64:btoa('%PDF-1.4\nsynthetic preview A')};
  if(request.action==='document_links')data={ok:true,url:'https://example.org/private-A.pdf'};
  if(request.action==='document_pdf')return new Response('%PDF-1.4\nsynthetic document A',{headers:{'Content-Type':'application/pdf'}});
  if(['create','reserve'].includes(request.action))throw Error('privacy test must not issue a document');
  return new Response(JSON.stringify(data));
 };
 const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve)),wait=async(predicate,message)=>{const end=performance.now()+5000;while(!predicate()){if(performance.now()>end)throw Error(message);await frame()}};
 const action=(name,id)=>domainsCustomers.morningActions[name]({dataset:{clickArg0:id}});
 const click=name=>{const button=document.querySelector('[data-action="'+name+'"]');if(!button)throw Error('missing '+name);button.click()};
 if(surface==='form'||surface==='confirmation'){
  action('open-morning-document',debt.id);await wait(()=>document.querySelector('[data-action="morning-create"]')?.disabled===false,'issuance form did not settle');
  if(surface==='confirmation'){click('morning-create');await wait(()=>document.getElementById('confirmBackdrop').classList.contains('open'),'confirmation did not open')}
  else{click('morning-preview');await wait(()=>document.getElementById('morningPreviewFrame')?.src.startsWith('blob:'),'form preview did not settle')}
 }else if(surface==='browser'){
  action('open-morning-documents');await wait(()=>document.getElementById('morningBrowserResults')?.textContent.includes(doc.clientName),'document search did not settle');
  action('morning-details',doc.id);await wait(()=>document.getElementById('morningBrowserDetails')?.textContent.includes(doc.description),'document details did not settle');
  action('morning-browser-view',doc.id);await wait(()=>document.getElementById('morningBrowserPreviewFrame')?.src.startsWith('blob:'),'browser preview did not settle');
  const clickAnchor=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download!=='morning-document.pdf')clickAnchor.call(this)};
  action('morning-download',doc.id);await wait(()=>document.querySelector('a[href*="private-A.pdf"]'),'download link did not settle');HTMLAnchorElement.prototype.click=clickAnchor;
 }else{
  action('morning-open-document',doc.id);await wait(()=>document.getElementById('morningStandalonePreviewFrame')?.src.startsWith('blob:'),'standalone PDF did not settle');
 }
 const {createMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,morningFinancialSnapshot}=await import('./assets/js/domains/customers/morning-debt-recovery.js');
 const context=createMorningDebtRecoveryContext({operationId:'33333333-3333-4333-8333-333333333333',debtId:debt.id,type:320,amount:30,applyPayment:true,applyInvoice:true,createdAt:'2026-10-11T00:00:00Z',financialSnapshot:morningFinancialSnapshot(debt)});saveMorningDebtRecoveryContext(context);
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const raw=async()=>JSON.stringify([await db.load(owner+':orders'),await db.load(owner+':shared-checks'),loadMorningDebtRecoveryContext()]),before=await raw();
 globalThis.morningPrivacy={surface,owner,other,login,action,wait,calls,urls,revoked,raw,before};return {surface,visible:true};
})()"""

VERIFY = r"""(async()=>{
 const f=morningPrivacy;
 await f.wait(()=>!document.getElementById('morningClientName')&&!document.getElementById('morningDocumentsBrowser')&&!document.getElementById('morningStandalonePreview'),'former-account Morning view retained');
 if(document.getElementById('modal').textContent.includes('private Morning')||document.querySelector('iframe[src^="blob:"],a[href*="private-A.pdf"]'))throw Error('former-account document content/link retained');
 if(document.getElementById('confirmBackdrop').classList.contains('open')||document.getElementById('confirmMessage').textContent.includes('private Morning'))throw Error('former-account issuance confirmation retained');
 if(f.urls.some(url=>!f.revoked.includes(url)))throw Error('former-account Blob URL not released');
 if(await f.raw()!==f.before)throw Error('visual invalidation changed Main/Shared/pending Morning recovery');
 const count=f.calls.length;f.action('morning-open-document','cccccccc-cccc-4ccc-8ccc-cccccccccccc');await Promise.resolve();if(f.calls.length!==count)throw Error('logged-out document action contacted Morning');
 f.login(f.owner);f.action('open-morning-documents');await f.wait(()=>document.getElementById('morningBrowserResults')?.textContent.includes('private Morning customer A'),'relogin search did not settle');
 if(f.calls.filter(call=>call.action==='search_documents').length!==(f.surface==='browser'?2:1))throw Error('relogin reused an old result cache');
 // An unrelated modal belongs to another feature and must survive invalidation.
 uiModal.modal('Other capability','<p id="unrelated-modal">unrelated modal</p>');f.login(null);
 if(!document.getElementById('unrelated-modal'))throw Error('Morning cleanup replaced another capability modal');
 if(await f.raw()!==f.before)throw Error('relogin invalidation changed retained stores');
 f.login(f.owner);f.action('open-morning-documents');await f.wait(()=>document.getElementById('morningBrowserResults')?.textContent.includes('private Morning customer A'),'fresh owner display did not settle');
 const displayedRoot=document.getElementById('morningDocumentsBrowser');
 // Real domain owners, real auth subscription, and real browser event targets.
 const {createDomainsCustomersDocuments}=await import('./assets/js/domains/customers/documents.js'),{createDomainsCustomersDocumentsBrowser}=await import('./assets/js/domains/customers/documents-browser.js'),{createMorningRequest}=await import('./assets/js/integrations/morning.js');
 const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener,live=new Set(),subscriptions=new Set();
 EventTarget.prototype.addEventListener=function(type,fn,options){if(this===window||this===document)live.add(fn);return add.call(this,type,fn,options)};
 EventTarget.prototype.removeEventListener=function(type,fn,options){if(this===window||this===document)live.delete(fn);return remove.call(this,type,fn,options)};
 const subscribeAccountScope=fn=>{const stop=cloudAuth.subscribeAccountScope(fn);subscriptions.add(fn);return ()=>{subscriptions.delete(fn);stop()}};
 try{for(let i=0;i<100;i++){
  const ports={operationScope:morningOperationScope,subscribeAccountScope,modal:(...args)=>uiModal.modal(...args),toast(){},dateEditorMarkup:()=>'',request:createMorningRequest({operationScope:morningOperationScope,supaFetch:(...args)=>cloudAuth.supaFetch(...args)})};
  const browser=createDomainsCustomersDocumentsBrowser(ports),documents=createDomainsCustomersDocuments({...ports,model:{get state(){return state}},documentsBrowser:browser,confirmDialog:(...args)=>uiModal.confirmDialog(...args)});
  documents.dispose();browser.dispose();if(documents.dispose()!==false||browser.dispose()!==false)throw Error('Morning disposal not idempotent');
  if(document.getElementById('morningDocumentsBrowser')!==displayedRoot)throw Error('unmounted Morning owner cleared the active owner display');
  if(live.size||subscriptions.size)throw Error('Morning auth/visibility/offline listener retained');
 }}finally{EventTarget.prototype.addEventListener=add;EventTarget.prototype.removeEventListener=remove}
 if(await f.raw()!==f.before)throw Error('resource cycling changed retained stores');
 return {cleared:true,pendingRetained:true,revoked:f.revoked.length,surface:f.surface,resourceCycles:100};
})()"""

parser=argparse.ArgumentParser()
parser.add_argument('--surface',choices=('form','browser','standalone','confirmation'),action='append')
parser.add_argument('--phase',choices=('local','cross-tab','account'),action='append')
parser.add_argument('--baseline',action='store_true')
args=parser.parse_args()
for surface in args.surface or ('form','browser','standalone','confirmation'):
    for phase in args.phase or ('local','cross-tab','account'):
        with BrowserSession(ROOT/'netunim-orders/site',f'morning-privacy-{surface}-{phase}',auto_navigate=False) as browser:
            if args.baseline:
                for path in ('composition/customers.js','domains/customers/composition.js','domains/customers/documents.js','domains/customers/documents-browser.js','ui/modal.js'):
                    content=subprocess.check_output(['git','show',f'4053039dd2217dd7fb7e16c0135e36ecd2c113e4:netunim-orders/site/assets/js/{path}'],cwd=ROOT)
                    prepared=browser.tmp/f'site/assets/js/{path}'
                    trailer=prepared.read_text(encoding='utf-8').split('\nexport const __testBindings=',1)
                    if len(trailer)>1:
                        content+=('\nexport const __testBindings='+trailer[1]).encode('utf-8')
                    prepared.write_bytes(content)
            browser._navigate()
            browser.evaluate(SETUP.replace('__SURFACE__',json.dumps(surface)),timeout=40)
            if phase=='local':
                browser.evaluate('morningPrivacy.login(null); true')
            elif phase=='account':
                browser.evaluate('morningPrivacy.login(morningPrivacy.other); true')
            else:
                with browser.second_tab():
                    browser.evaluate("localStorage.removeItem('orders.supabase.session.v1'); true")
            result=browser.evaluate(VERIFY,timeout=15)
            assert result and result['cleared'] and result['pendingRetained'],result
            assert not browser.drain_serious_errors()
            print(f'PASS Morning {surface} {phase} privacy: {json.dumps(result)}',flush=True)
