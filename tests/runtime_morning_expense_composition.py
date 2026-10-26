"""Actual Finance navigation/auth/IDB and lazy expense composition; synthetic HTTP only."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const check=(value,message)=>{if(!value)throw Error(message)};
 const id=n=>'aaaaaaaa-aaaa-4aaa-aaaa-'+String(n).padStart(12,'0'),owner=id(1);
 const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('expense composition timeout: '+document.querySelector('[data-expense-message]')?.textContent)};
 const click=name=>{const button=document.querySelector('[data-action="morning-expense-'+name+'"],[data-expense-command="'+name+'"]');check(button,'missing '+name);button.click()};
 const field=(name,value,type='input')=>{const element=document.querySelector('[data-expense-field="'+name+'"]');check(element,'missing '+name);element.value=value;element.dispatchEvent(new Event(type,{bubbles:true}))};
 cloudAuth.saveSession({user:{id:owner},access_token:'synthetic-expense-owner',expires_at:9999999999});
 let main=null,shared=null;
 cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;
 cloudTransport.rpcSaveV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
 await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});session.storageProtocolBlocked=false;
 morningOperationScope.capture()(); // Keep the application's real auth/storage guards.
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const beforeMain=JSON.stringify(await db.load(owner+':orders')),beforeShared=JSON.stringify(await db.load(owner+':shared-checks'));
 const supplier={id:id(2),name:'ספק מסך הוצאות',taxId:'123456789',country:'IL',active:true};
 const expense={id:id(3),kind:'expense',status:10,supplierId:supplier.id,supplierTaxId:supplier.taxId,sourceDocumentDate:'2026-10-20',pcnClassification:'T',classification:{id:id(4),title:'קניות סחורה בארץ',vat:100,income:100}};
 const calls=[],confirmations=[];let posts=0,hold=null,entered=null,operation=null;
 cloudAuth.supaFetch=async(path,options)=>{
  check(path==='/functions/v1/morning-expenses','wrong expense service');options.assertRequestScope();
  const request=JSON.parse(options.body);calls.push(request);
  if(hold&&request.action==='suppliers'){entered();await hold}
  const base={ok:true,version:1,environment:'production'};
  if(request.action==='capabilities')return Response.json({...base,create:true,upload:true,pcnP:false,draftApproval:false,pSuppliers:[]});
  check(request.expectedEnvironment==='production','request missing displayed environment');
  if(request.action==='suppliers'||request.action==='expenses')return Response.json({...base,page:0,pageSize:50,total:1,pages:1,items:[request.action==='suppliers'?supplier:expense]});
  if(request.action==='create'){
   posts++;check(request.expense.allocationNumber==='123456789','allocation number lost');check(request.expense.vat==='18.00','manual VAT changed');
   check(request.expense.reportingDate===request.expense.date.slice(0,7)+'-01','reporting month changed');operation=request.operationId;
   return Response.json({...base,state:'created',verified:true,expenseId:id(8),fileLinked:false});
  }
  if(request.action==='operation_status'){
   check(request.operationId===operation,'recovery used another operation');
   return Response.json({...base,state:'created',verified:true,expenseId:id(8),fileLinked:false,intent:{number:'COMPOSITION-1',documentType:305,date:'2026-10-20',reportingDate:'2026-10-01',supplierName:supplier.name,amount:118,vat:18}});
  }
  throw Error('unexpected expense action '+request.action);
 };
 uiModal.confirmDialog=async(title,message)=>{confirmations.push({title,message});return true};
 ui.currentView='kupa';ui.kupaSubView='summary';finance.presentation.renderKupa();
 check(calls.length===0,'expense panel made eager requests');click('toggle');
 await wait(()=>document.querySelector('[data-expense-command="load"]'));click('load');await finance.runtime.drain();
 check(document.querySelector('[data-expense-field="supplierId"]'),'actual app did not expose expense form: '+document.querySelector('[data-expense-message]')?.textContent);
 check(document.querySelector('.morning-expense-notice').textContent.includes('האמיתי'),'real account notice missing');
 field('supplierId',supplier.id,'change');field('number','COMPOSITION-1');field('net','100.00');field('vat','18.00');field('gross','118.00');field('allocationNumber','123456789');
 click('favorite');click('save');await finance.runtime.drain();
 check(posts===1&&confirmations.length===1,'actual app confirmation/save did not execute exactly once');
 check(confirmations[0].title.includes('האמיתי')&&confirmations[0].message.includes(expense.classification.title),'actual confirmation missed account or category');
 const key='morningExpenseOperation:production:'+owner,preference='morningExpensePreferences:production:'+owner;
 check(JSON.parse(localStorage.getItem(key)).operationId===operation,'recovery pointer missing account identity');
 check(JSON.parse(localStorage.getItem(preference)).favorites.includes(supplier.id),'favorites lost account identity');
 click('status');await finance.runtime.drain();check(document.querySelector('[data-expense-receipt]').textContent.includes('COMPOSITION-1'),'actual composed recovery failed');
 check(JSON.stringify(await db.load(owner+':orders'))===beforeMain&&JSON.stringify(await db.load(owner+':shared-checks'))===beforeShared,'expense flow changed local financial journals');
 click('next');
 let release,ready;hold=new Promise(resolve=>release=resolve);const waiting=new Promise(resolve=>ready=resolve);entered=ready;
 click('load');await waiting;
 cloudAuth.saveSession({user:{id:id(9)},access_token:'synthetic-other-account',expires_at:9999999999});release();await finance.runtime.drain();hold=null;
 check(!document.querySelector('[data-expense-field="supplierId"]')&&!document.querySelector('.morning-expense-intake').textContent.includes(supplier.name),'old account result survived real auth notification');
 check(posts===1,'account replacement created another expense');
 check(JSON.stringify(await db.load(owner+':orders'))===beforeMain&&JSON.stringify(await db.load(owner+':shared-checks'))===beforeShared,'account replacement changed retained journals');
 check(document.documentElement.scrollWidth<=innerWidth+1,'expense composition overflow');
 finance.runtime.dispose();localStorage.removeItem(key);localStorage.removeItem(preference);
 return {actualLazyComposition:true,actualAuthObservation:true,actualStorageGuards:true,posts,accountIsolated:true,retainedJournals:true,width:innerWidth};
})()"""

if __name__=='__main__':
    for width in [1440,390]:
        with BrowserSession(ROOT/'netunim-orders/site',f'morning-expense-composition-{width}') as browser:
            browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            result=browser.evaluate(FLOW,timeout=45)
            assert result['posts']==1 and result['accountIsolated'],result
            assert not browser.drain_serious_errors()
            print('PASS composed expense UI, native auth, recovery and account isolation:',json.dumps(result),flush=True)
