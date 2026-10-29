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
 const supplier={id:id(2),name:'ת.ב.י ספק מסך הוצאות',taxId:'123456789',country:'IL',active:true};
 const pSupplier={id:id(20),name:'ספק P לבדיקה',taxId:'123456780',country:'PS',active:true};
 const expense={id:id(3),kind:'expense',status:10,supplierId:supplier.id,name:supplier.name,number:'HISTORY-1',grossCents:11800,supplierTaxId:supplier.taxId,reportingDate:'2026-10-01',sourceDocumentDate:'2026-10-20',createdAt:'2026-10-26T10:00:00.000Z',pcnClassification:'T',classification:{id:id(4),title:'קניות סחורה בארץ',vat:100,income:100}};
 const accountExpenses=[expense,{...expense,id:id(99),number:'MORNING-EXTERNAL',sourceDocumentDate:'2019-06-01',reportingDate:'2020-01-01',createdAt:'2026-10-27T11:00:00.000Z'}];
 const calls=[],confirmations=[];let posts=0,hold=null,entered=null,operation=null,heldQuery='';
 cloudAuth.supaFetch=async(path,options)=>{
  check(path==='/functions/v1/morning-expenses','wrong expense service');options.assertRequestScope();
  const request=JSON.parse(options.body);calls.push(request);
  if(hold&&request.action==='suppliers'&&(!heldQuery||request.name===heldQuery)){entered();await hold}
  const base={ok:true,version:1,environment:'production'};
  if(request.action==='capabilities')return Response.json({...base,create:true,upload:true,sourceIntent:true,duplicateCheck:true,siteRecent:true,pcnP:false,draftApproval:false,pSuppliers:[{id:pSupplier.id,taxId:pSupplier.taxId}]});
  if(request.action==='site_recent')return Response.json({...base,source:'site',items:[expense]});
  if(request.action==='source_pending')return Response.json({...base,items:[],page:request.page||0,pageSize:20});
  if(request.action==='duplicate_check')return Response.json({...base,duplicate:false});
  check(request.expectedEnvironment==='production','request missing displayed environment');
  if(request.action==='suppliers'||request.action==='expenses'){
   const items=request.action==='suppliers'?(request.name==='תבי'?[]:request.name==='ישן'?[pSupplier]:[supplier,pSupplier]):request.fromDate?[expense]:accountExpenses;
   return Response.json({...base,page:0,pageSize:50,total:items.length,pages:1,items});
  }
  if(request.action==='create'){
   posts++;check(request.expense.allocationNumber==='123456789','allocation number lost');check(request.expense.vat==='18.00','manual VAT changed');
   check(request.expense.reportingDate===request.expense.date.slice(0,7)+'-01','reporting month changed');operation=request.operationId;
   const item={...expense,id:id(8),number:request.expense.number,createdAt:'2026-10-27T12:00:00.000Z'};accountExpenses.unshift(item);
   return Response.json({...base,state:'created',verified:true,expenseId:id(8),fileLinked:false,item});
  }
  if(request.action==='operation_status'){
   check(request.operationId===operation,'recovery used another operation');
   return Response.json({...base,state:'created',verified:true,expenseId:id(8),fileLinked:false,intent:{number:'COMPOSITION-1',documentType:305,date:'2026-10-20',reportingDate:'2026-10-01',supplierName:supplier.name,amount:118,vat:18}});
  }
  throw Error('unexpected expense action '+request.action);
 };
 uiModal.confirmDialog=async(title,message)=>{confirmations.push({title,message});return true};
 ui.currentView='kupa';ui.kupaSubView='summary';finance.presentation.renderKupa();
 check(document.querySelector('[data-morning-expense-launcher]').compareDocumentPosition(document.querySelector('[data-morning-reports]'))&Node.DOCUMENT_POSITION_FOLLOWING,'expense intake is below reports');
 check(calls.length===0,'expense panel made eager requests');click('toggle');
 await wait(()=>document.querySelector('[data-expense-field="supplierId"]'));await finance.runtime.drain();
 check(ui.kupaSubView==='expenses'&&!document.querySelector('[data-morning-reports]')&&!document.querySelector('[data-action="tax-open"]'),'expense page still contains unrelated sections');
 check(document.querySelector('[data-expense-history]').textContent.includes('HISTORY-1'),'real composition omitted automatic history');
 check(calls.every(request=>request.action!=='expenses'||request.fromDate),'opening the intake scanned the entire account');
 check(document.querySelector('[data-expense-recent]').textContent.includes('HISTORY-1')&&!document.querySelector('[data-expense-recent]').textContent.includes('MORNING-EXTERNAL'),'real composition omitted automatic site-only history');
 click('recent-refresh');await finance.runtime.drain();
 check(document.querySelector('[data-expense-recent]').textContent.includes('MORNING-EXTERNAL'),'explicit recent loading omitted an expense created elsewhere under another reporting period');
 click('back');check(ui.kupaSubView==='summary'&&document.querySelector('[data-morning-reports]'),'back did not restore the summary');
 const requestsBeforeReopen=calls.length;click('toggle');await finance.runtime.drain();check(calls.length===requestsBeforeReopen,'reopening made provider requests');
 const rect=name=>document.querySelector('[data-expense-field="'+name+'"]').getBoundingClientRect();
 const liveNumber=document.querySelector('[data-expense-field="number"]');liveNumber.focus();finance.presentation.renderKupa();
 check(liveNumber.isConnected&&document.activeElement===liveNumber&&ui.kupaSubView==='expenses','Finance publication replaced the expense editor');
 const reporting=['reportingPeriod','documentType','pcnClassification'].map(rect);
 check(reporting.every(box=>Math.abs(box.top-reporting[0].top)<2)&&reporting[0].left>reporting[1].left&&reporting[1].left>reporting[2].left,'reporting controls are not one symmetric RTL row');
 check(Math.abs(rect('description').top-rect('allocationNumber').top)<2,'description/allocation not paired');check(Math.abs(rect('classificationExpenseId').bottom-document.querySelector('[data-expense-command="more-classifications"]').getBoundingClientRect().bottom)<2,'classification controls not paired');
 check(document.querySelector('[data-expense-field="supplierId"]'),'actual app did not expose expense form: '+document.querySelector('[data-expense-message]')?.textContent);
 check(!document.querySelector('.morning-expense-intake').textContent.includes('השמירה יוצרת הוצאה אמיתית')&&!document.querySelector('[data-expense-message]').textContent.includes('נטען עמוד הצעות ראשוני'),'removed notices remain in the real composition');
 const historyQuery=document.querySelector('[data-input="morning-expense-history-query"]');historyQuery.value='1-6-19';historyQuery.dispatchEvent(new Event('input',{bubbles:true}));
 historyQuery.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await finance.runtime.drain();
 check(document.querySelector('[data-expense-history]').textContent.includes('MORNING-EXTERNAL')&&!document.querySelector('[data-expense-history]').textContent.includes('HISTORY-1'),'real navigation failed to dispatch expense search');
 check(liveNumber.isConnected&&posts===0&&confirmations.length===0,'real search replaced the editor or dispatched a save');
 click('history-search-clear');check(document.querySelector('[data-expense-history]').textContent.includes('HISTORY-1'),'real search clear lost browsing');
 const chooseHistory=async(kind,value)=>{const control=document.querySelector('[data-expense-history-filter="'+kind+'"]');control.value=value;control.focus();control.dispatchEvent(new Event('change',{bubbles:true}));await finance.runtime.drain();};
 await chooseHistory('year','2026');
 check(!document.querySelector('[data-expense-history-filter="period"]').disabled,'real lazy composition did not enable bimonth selection');
 check([...document.querySelector('[data-expense-history-filter="year"]').options].map(option=>option.value).join(',')===',2026','history exposes obsolete years');
 await chooseHistory('period','2026-09');
 check(document.querySelector('[data-expense-history-filter="period"]').value==='2026-09','real lazy composition did not dispatch bimonth selection');
 await chooseHistory('year','');
 const period=document.querySelector('[data-expense-field="reportingPeriod"]');
 check([...period.options].every(option=>option.value.startsWith('2026-')&&!/\d{2}–\d{2}/.test(option.text)),'old years or ambiguous numeric period labels remain');
 check(document.querySelector('[data-expense-field="reportingDate"]').type==='hidden'&&!document.querySelector('[data-expense-field="reportingDateConfirmed"]'),'redundant reporting controls remain');
 const datePart=part=>document.querySelector('#morningExpenseDate').closest('[data-date-editor]').querySelector('[data-date-part="'+part+'"]');
 const inputDate=iso=>{for(const [part,value] of [['day',iso.slice(8)],['month',iso.slice(5,7)],['year',iso.slice(2,4)]]){const input=datePart(part);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))}};
 const day=datePart('day');day.focus();day.value='2';day.dispatchEvent(new Event('input',{bubbles:true}));
 check(day.isConnected&&document.activeElement===day,'first date digit replaced or blurred the editor');
 day.value='23';day.dispatchEvent(new Event('input',{bubbles:true}));
 check(document.activeElement===datePart('month'),'two date digits did not advance to month');
 inputDate('2026-09-23');
 check(document.querySelector('[data-expense-field="reportingDate"]').value==='2026-09-01','same-period invoice did not preserve source month');
 inputDate('2026-08-23');
 check(document.querySelector('[data-expense-field="reportingDate"]').value==='2026-10-01','late-period month not automatic');
 const supplierInput=()=>document.querySelector('#morningExpenseSupplier');
 supplierInput().click();field('supplierQuery','תבי');await wait(()=>calls.some(request=>request.name==='תבי'));await finance.runtime.drain();
 check(document.querySelectorAll('[role="option"]').length===1&&document.querySelector('[role="option"]').textContent.includes(supplier.name),'strict remote response erased punctuation-insensitive supplier match');
 let releaseOld,enteredOld;heldQuery='ישן';hold=new Promise(resolve=>releaseOld=resolve);const oldSearch=new Promise(resolve=>enteredOld=resolve);entered=enteredOld;
 supplierInput().click();field('supplierQuery','ישן');await oldSearch;
 field('supplierQuery','מסך');await wait(()=>calls.some(request=>request.name==='מסך'));
 await new Promise(resolve=>setTimeout(resolve,20));releaseOld();await finance.runtime.drain();hold=null;heldQuery='';
 check(document.querySelector('[role="option"]').textContent.includes(supplier.name),'late supplier response replaced newer search results');
 supplierInput().click();field('supplierQuery','מסך');
 check(document.querySelectorAll('[role="option"]').length===1,'supplier list not filtered in place');
 supplierInput().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await finance.runtime.drain();
 check(document.querySelector('[data-expense-field="supplierId"]').value===supplier.id,'Enter failed to choose unique supplier');
 field('gross','27582.50');
 check(document.querySelector('[data-expense-field="net"]').value==='23375.00'&&document.querySelector('[data-expense-field="vat"]').value==='4207.50','ordinary gross VAT split incorrect');
 supplierInput().click();field('supplierQuery','ספק P');
 supplierInput().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
 check(supplierInput().getAttribute('aria-activedescendant'),'arrow selection missing');
 supplierInput().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await finance.runtime.drain();
 field('gross','1160.00');check(document.querySelector('[data-expense-field="net"]').value==='1000.00'&&document.querySelector('[data-expense-field="vat"]').value==='160.00','P gross VAT split incorrect');
 check(document.querySelector('[data-action="morning-expense-save"]').disabled,'unverified P write opened');
 check([...document.querySelector('[data-expense-field="documentType"]').options].filter(option=>option.value).map(option=>option.value).join(',')==='305,330,320','document types or priority incorrect');
 field('supplierId',supplier.id,'change');field('number','COMPOSITION-1');field('net','100.00');field('vat','18.00');field('gross','118.00');field('allocationNumber','123456789');
 inputDate('2026-10-20');
 datePart('day').value='32';datePart('day').dispatchEvent(new Event('input',{bubbles:true}));
 click('save');await finance.runtime.drain();check(posts===0&&confirmations.length===0,'invalid date reused the previous valid date');inputDate('2026-10-20');
 const accountReadsBeforeSave=calls.filter(request=>request.action==='expenses'&&!request.fromDate).length;
 click('favorite');click('save');await finance.runtime.drain();
 check(posts===1&&confirmations.length===1,'actual app confirmation/save did not execute exactly once');
 check(document.querySelector('[data-expense-recent]').textContent.includes('COMPOSITION-1'),'save did not immediately insert the verified site intake');
 check(calls.filter(request=>request.action==='expenses'&&!request.fromDate).length===accountReadsBeforeSave,'save triggered an all-account scan');
 click('recent-refresh');await finance.runtime.drain();check(document.querySelector('[data-expense-recent]').textContent.includes('COMPOSITION-1'),'explicit refresh missed confirmed intake');
 check(confirmations[0].title.includes('האמיתי')&&confirmations[0].message.includes(expense.classification.title),'actual confirmation missed account or category');
 const key='morningExpenseOperation:production:'+owner,preference='morningExpensePreferences:production:'+owner;
 check(localStorage.getItem(key)===null,'completed manual intake retained a stale recovery pointer');
 check(JSON.parse(localStorage.getItem(preference)).favorites.includes(supplier.id),'favorites lost account identity');
 check(document.querySelector('[data-expense-completed]').textContent.includes('COMPOSITION-1')&&document.querySelector('[data-expense-field="number"]').value==='','actual composition did not retain completion evidence and open the next manual intake');
 check(JSON.stringify(await db.load(owner+':orders'))===beforeMain&&JSON.stringify(await db.load(owner+':shared-checks'))===beforeShared,'expense flow changed local financial journals');
 // Successful manual intake advances automatically; unresolved-source recovery
 // remains covered by runtime_morning_expense_source.py.
 let release,ready;hold=new Promise(resolve=>release=resolve);const waiting=new Promise(resolve=>ready=resolve);entered=ready;
 supplierInput().click();field('supplierQuery','ספק');await waiting;
 cloudAuth.saveSession({user:{id:id(9)},access_token:'synthetic-other-account',expires_at:9999999999});release();await finance.runtime.drain();hold=null;
 check(!document.querySelector('[data-expense-field="supplierId"]')&&!document.querySelector('.morning-expense-intake').textContent.includes(supplier.name),'old account result survived real auth notification');
 check(posts===1,'account replacement created another expense');
 check(JSON.stringify(await db.load(owner+':orders'))===beforeMain&&JSON.stringify(await db.load(owner+':shared-checks'))===beforeShared,'account replacement changed retained journals');
 check(document.documentElement.scrollWidth<=innerWidth+1,'expense composition overflow');
 finance.runtime.dispose();localStorage.removeItem(key);localStorage.removeItem(preference);
 return {actualLazyComposition:true,actualAuthObservation:true,actualStorageGuards:true,posts,accountIsolated:true,retainedJournals:true,width:innerWidth};
})()"""

P_FLOW = FLOW[:FLOW.index(" const period=")].replace('pcnP:false', 'pcnP:true').replace(
    "check(request.expense.allocationNumber==='123456789','allocation number lost');check(request.expense.vat==='18.00','manual VAT changed');",
    "check(request.expense.number==='000012345','P number not canonical');check(request.expense.vat==='150.00','manual P VAT changed');check(request.expense.pcnClassification==='P'&&request.expense.supplierId===pSupplier.id,'P identity lost');"
) + r"""
 field('supplierId',pSupplier.id,'change');field('classificationExpenseId',expense.id,'change');
 field('number','12345');field('documentType','330','change');field('gross','1160.00');
 check(document.querySelector('[data-expense-field="net"]').value==='1000.00'&&document.querySelector('[data-expense-field="vat"]').value==='160.00','enabled P VAT suggestion failed');
 field('vat','150.00');
 check(document.querySelector('[data-expense-field="gross"]').value==='1150.00','manual P VAT correction did not update total');
 field('pcnClassification','T','change');
 check(document.querySelector('[data-expense-field="pcnClassification"]').value==='P','protected P supplier could change to T');
 check(!document.querySelector('[data-action="morning-expense-save"]').disabled,'verified P save remains blocked');
 click('save');await finance.runtime.drain();
 check(posts===1&&confirmations.length===1,'P save/confirmation failed');
 check(confirmations[0].message.includes('P'),'P classification absent from final confirmation');
 check(JSON.stringify(await db.load(owner+':orders'))===beforeMain&&JSON.stringify(await db.load(owner+':shared-checks'))===beforeShared,'P intake changed local journals');
 finance.runtime.dispose();return {posts,protectedIdentity:true,manualVat:true,canonicalNumber:true};
})()"""

LAYOUT_ASSERTIONS = r"""(async()=>{
 await document.fonts.ready;
 const check=(value,message)=>{if(!value)throw Error(message+' at '+innerWidth+'px')};
 const bounds=element=>element.getBoundingClientRect();
 const inside=(element,parent,message)=>{
  const box=bounds(element),limit=bounds(parent);
  check(box.width>0&&box.left>=limit.left-1&&box.right<=limit.right+1,message);
 };
 const tables=[...document.querySelectorAll('.morning-expense-table')];
 const heading=document.querySelector('[data-expense-history] .morning-expense-history-heading');
 const filters=heading.querySelector('.morning-expense-history-filters');
 check(filters&&heading.contains(filters.querySelector('[data-expense-history-filter="year"]')),'history filters are detached from the heading');
 for(const select of filters.querySelectorAll('select'))check(bounds(select).width<=220,'history filter is too wide');
 if(innerWidth>=1024){const title=bounds(heading.querySelector('h2')),controls=bounds(filters);check(Math.abs((title.top+title.bottom-controls.top-controls.bottom)/2)<3,'history controls are not beside the title');}
 check(tables.length===2,'recent/reporting tables missing');
 for(const table of tables){
  inside(table,table.parentElement,'expense table clipped by its section');
  check(table.scrollWidth<=table.clientWidth+1,'expense table content overflows');
  check(getComputedStyle(table.parentElement).overflowY==='visible','expense list has a separate vertical scroll');
  for(const cell of table.querySelectorAll('th,td')){
   if(cell.getClientRects().length)inside(cell,table,'expense column clipped');
  }
  for(const amount of table.querySelectorAll('td:nth-last-child(-n+2) bdi'))inside(amount,amount.closest('td'),'expense amount clipped');
 }
 const input=document.querySelector('#morningExpenseSupplier'),favorite=document.querySelector('[data-expense-command="favorite"]');
 const field=bounds(input),button=bounds(favorite),row=input.closest('.morning-expense-supplier-row');
 check(Math.abs(field.bottom-button.bottom)<1&&button.right<=field.left,'favorite is not on the left of the supplier in the same row');
 inside(input,row,'supplier input clipped');inside(favorite,row,'favorite button clipped');
 return {width:innerWidth,tables:tables.map(table=>bounds(table).width)};
})()"""


def verify_recent_persistence():
    setup = r"""(async()=>{
      await appReady;syncDocument.stopPolling();finance.runtime.stop();
      const {createExpenseRecentCache}=await import('./assets/js/domains/finance/morning-expense-recent-cache.js');
      const {createExpenseRecent}=await import('./assets/js/domains/finance/morning-expense-recent.js');
      const {createRuntimeTaskOwner}=await import('./assets/js/shared/runtime-task-owner.js');
      const check=(value,message)=>{if(!value)throw Error(message)},scope={owner:'aaaaaaaa-aaaa-4aaa-aaaa-000000000050',environment:'production'};
      const row=n=>({id:String(n),kind:'expense',status:10,type:305,number:'PERSISTED-'+n,createdAt:new Date(1700000000000+n*1000).toISOString(),name:'safe display',url:'signed-secret',payload:{private:'secret'}});
      const cache=createExpenseRecentCache(),other=createExpenseRecentCache(),tasks=createRuntimeTaskOwner();
      const caps={version:1,environment:'production',siteRecent:true};let calls=0,clock=100;
      const recent=createExpenseRecent({cache,accountId:()=>scope.owner,capabilities:()=>caps,capture:()=>()=>{},run:tasks.run,now:()=>clock,
        request:async action=>{check(action==='expenses','unexpected provider action');calls++;return {...caps,page:0,pageSize:50,total:2,pages:1,items:[row(1),row(2)]};}});
      await recent.load();clock=110;recent.record({verified:true,expenseId:'3',item:row(3)});await tasks.drain();check(calls===2,'write scanned the provider');
      await other.update(scope,{kind:'record',items:[row(4)],at:120},()=>{});
      await cache.update(scope,{kind:'full',items:[row(1),row(2),row(3)],at:140,startedAt:115},()=>{});
      const saved=await cache.read(scope,()=>{});check(saved.items.map(item=>item.id).join(',')==='4,3,2,1','concurrent refresh erased a site intake');
      check(!JSON.stringify(saved).includes('secret')&&!JSON.stringify(saved).includes('payload'),'snapshot retained non-display data');
      cache.close();other.close();return {committed:true,providerReads:calls,concurrent:true};
    })()"""
    restore = r"""(async()=>{
      await appReady;syncDocument.stopPolling();finance.runtime.stop();
      const {createExpenseRecentCache}=await import('./assets/js/domains/finance/morning-expense-recent-cache.js');
      const {createExpenseRecent}=await import('./assets/js/domains/finance/morning-expense-recent.js');
      const check=(value,message)=>{if(!value)throw Error(message)},scope={owner:'aaaaaaaa-aaaa-4aaa-aaaa-000000000050',environment:'production'};
      const cache=createExpenseRecentCache(),caps={version:1,environment:'production',siteRecent:true};
      const recent=createExpenseRecent({cache,accountId:()=>scope.owner,capabilities:()=>caps,capture:()=>()=>{},run:work=>work(),
        request:async()=>{throw Error('reload must not make provider requests')}});
      await recent.loadSite();const markup=recent.markup();
      for(const n of [1,2,3,4])check(markup.includes('PERSISTED-'+n),'reload lost saved expense '+n);
      check(markup.includes('כל חשבון Morning')&&!markup.includes('<details'),'reload did not restore the open combined list');
      check(!await cache.read({...scope,environment:'sandbox'},()=>{}),'snapshot leaked between environments');
      check(!await cache.read({...scope,owner:'aaaaaaaa-aaaa-4aaa-aaaa-000000000051'},()=>{}),'snapshot leaked between accounts');
      let stale=false;try{await cache.update(scope,{kind:'record',items:[],at:150},()=>{throw Error('stale owner')});}catch{stale=true;}
      check(stale,'stale owner was allowed to persist');cache.close();return {reload:true,open:true,isolated:true,noProviderScan:true};
    })()"""
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-expense-persistence') as browser:
        print('PASS native recent snapshot commit:',browser.evaluate(setup,timeout=45),flush=True)
        browser._navigate()
        print('PASS native recent snapshot after real page reload:',browser.evaluate(restore,timeout=45),flush=True)
        assert not browser.drain_serious_errors()


def verify_layout():
    # Use the real lazy Finance composition and styles. Hidden outer overflow
    # masks this regression from document.scrollWidth-only checks.
    setup = FLOW[:FLOW.index(" click('back')")] + ' return true;})()'
    setup = setup.replace('grossCents:11800,', 'grossCents:2758250,vatCents:420750,')
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-expense-layout') as browser:
        browser.call('Emulation.setDeviceMetricsOverride', {'width':1440,'height':1100,'deviceScaleFactor':1,'mobile':False})
        browser.evaluate(setup, timeout=45)
        for favorite in [False, True]:
            if favorite:
                browser.evaluate(r"""(async()=>{
                 const supplier=document.querySelector('[data-expense-field="supplierId"]');
                 supplier.value='aaaaaaaa-aaaa-4aaa-aaaa-000000000002';supplier.dispatchEvent(new Event('change',{bubbles:true}));
                 await finance.runtime.drain();document.querySelector('[data-expense-command="favorite"]').click();await finance.runtime.drain();
                 if(!document.querySelector('[data-expense-command="use-favorite"]'))throw Error('favorite was not saved');
                })()""")
            for width in [1920,1440,1280,1025,1024,801,800,390,320]:
                browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
                result = browser.evaluate(LAYOUT_ASSERTIONS)
                print('PASS expense table bounds, amounts and supplier/favorite row:', json.dumps({'favorite':favorite, **result}), flush=True)
        assert not browser.drain_serious_errors()


if __name__=='__main__':
    verify_recent_persistence()
    verify_layout()
    for width in [1440,390]:
        with BrowserSession(ROOT/'netunim-orders/site',f'morning-expense-composition-{width}') as browser:
            browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            result=browser.evaluate(FLOW,timeout=45)
            assert result['posts']==1 and result['accountIsolated'],result
            assert not browser.drain_serious_errors()
            print('PASS composed expense UI, native auth, recovery and account isolation:',json.dumps(result),flush=True)
        with BrowserSession(ROOT/'netunim-orders/site',f'morning-p-expense-composition-{width}') as browser:
            browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            result=browser.evaluate(P_FLOW,timeout=45)
            assert result['posts']==1 and result['protectedIdentity'],result
            assert not browser.drain_serious_errors()
            print('PASS composed P intake, explicit VAT and canonical number:',json.dumps(result),flush=True)
