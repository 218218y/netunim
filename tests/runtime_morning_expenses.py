"""Real browser expense intake with synthetic provider; no live financial writes."""
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady; syncDocument.stopPolling(); finance.runtime.stop();
 const {createMorningExpenseIntake}=await import('./assets/js/domains/finance/morning-expense-intake.js');
 const {bindActionEvents}=await import('./assets/js/shared/events.js');
 const fileEffects=await import('./assets/js/platform/morning-expense-files.js');
 const check=(value,message)=>{if(!value)throw Error(message)};
 const id=n=>'aaaaaaaa-aaaa-4aaa-aaaa-'+String(n).padStart(12,'0');
 let environment='sandbox';
 localStorage.removeItem('morningExpensePreferences:'+environment+':'+id(1));
 localStorage.removeItem('morningExpenseOperation:'+environment+':'+id(1));
 localStorage.removeItem('morningExpenseOperation:'+id(1));
 let owner=id(1), listener=()=>{}, linked=false, posts=0, uploads=0, confirms=0, held=null, confirmWait=null, recoveryState='created';
 const intent={number:'RECOVERED-123',documentType:305,date:'2026-09-20',reportingDate:'2026-10-01',supplierName:'ספק מהבקשה המקורית',supplierTaxId:'123456789',pcnClassification:'T',amount:118,vat:18};
 let sourceMetadata=null,sourceReview=null,sourceException=false;
 const sourceState=()=>({sourceExpected:!!sourceMetadata,sourceMetadata,sourceReview,sourceVerified:!!sourceMetadata&&linked,sourcePending:!!sourceMetadata&&recoveryState!=='cancelled'&&!linked&&!sourceException,sourceException});
 const requests=[], capture=()=>{const saved=owner;return()=>check(saved===owner,'account changed')};
 const supplier={id:id(2),name:'ספק בדיקה <script>',taxId:'123456789',active:true,country:'IL'};
 const expense={id:id(3),kind:'expense',status:10,supplierId:id(2),name:supplier.name,number:'HISTORY-1',grossCents:11800,reportingDate:'2026-10-01',sourceDocumentDate:'2026-10-20',createdAt:'2026-10-26T10:00:00.000Z',pcnClassification:'T',classification:{id:id(4),title:'ציוד משרד',vat:100,income:100}};
 let catalogExpense=expense,directoryHidden=false,uploadEnabled=true,statusUnavailable=false,serverFileState='not_started';const confirmations=[];
 let historyItems=[expense],historyUnavailable=false,searchItems=null,today='2026-10-26',calendarTesting=false;
 const accountRecent=[expense];
 const paged=items=>({ok:true,version:1,environment,page:0,pageSize:50,total:items.length,pages:items.length?1:0,items});
 const respond=async(action,body,assertCurrent)=>{
  assertCurrent();requests.push({action,body});if(held&&action==='suppliers')await held;
  if(action==='capabilities')return {ok:true,version:1,environment,create:true,upload:uploadEnabled,sourceIntent:true,duplicateCheck:true};
  if(action==='source_pending')return {ok:true,page:body.page||0,pageSize:20,items:sourceMetadata&&!linked&&!sourceException?[{operationId:id(90),verified:true,intent,...sourceState()}]:[]};
  if(action==='duplicate_check')return {ok:true,duplicate:false};
  if(action==='suppliers')return paged(body.name==='missing'||directoryHidden?[]:[supplier]);
  if(action==='expenses'){
   if(calendarTesting)return paged([]);
   if(body.fromDate===undefined&&body.toDate===undefined){const items=searchItems||accountRecent;return {...paged(items.slice(body.page*50,body.page*50+50)),page:body.page,total:items.length,pages:Math.ceil(items.length/50)};}
   if(body.fromDate==='2026-09-01'&&body.toDate==='2026-10-01'){
    if(historyUnavailable)throw Error('history unavailable');
    return {...paged(historyItems.slice(body.page*50,body.page*50+50)),page:body.page,total:historyItems.length,pages:Math.ceil(historyItems.length/50)};
   }
   if(body.fromDate==='2026-07-01'&&body.toDate==='2026-08-01')return paged([{...expense,id:id(500),number:'OLD-PERIOD',reportingDate:'2026-08-01',sourceDocumentDate:'2026-06-05'}]);
   return paged([catalogExpense]);
  }
  if(action==='get_supplier')return {ok:true,version:1,environment,item:supplier};
  if(action==='get_expense')return {ok:true,version:1,environment,item:{...expense,id:body.id}};
  if(action==='create'){posts++;check(body.expense.vat==='160.00','manual VAT changed');sourceMetadata=body.sourceFile||null;sourceReview=body.sourceReview||null;const item={...expense,id:id(8),number:body.expense.number,createdAt:'2026-10-26T11:00:00.000Z'};accountRecent.unshift(item);return {ok:true,state:'created',verified:true,expenseId:id(8),fileLinked:false,intent:{...intent,...body.expense,amount:Number(body.expense.gross),vat:Number(body.expense.vat)},...sourceState(),item};}
  if(action==='operation_status'){if(statusUnavailable)throw Error('בדיקת מצב אינה זמינה');return {ok:true,state:recoveryState,verified:recoveryState==='created',expenseId:recoveryState==='created'?id(8):'',fileLinked:linked,fileState:serverFileState,intent,...sourceState()};}
  if(action==='reconcile'){check(body.expenseId===id(8),'wrong canonical ID');recoveryState='created';return {ok:true,state:'created',verified:true,expenseId:id(8),fileLinked:linked,intent};}
  if(action==='cancel_reserved'){check(recoveryState==='reserved','nonreserved cancellation');recoveryState='cancelled';return {ok:true,state:'cancelled',verified:false,cancelled:true,intent,...sourceState()};}
  if(action==='upload_prepare')return {ok:true,fileGeneration:id(10)};
  if(action==='upload_ack')return {ok:true,fileState:'file_accepted'};
  if(action==='upload_ticket')return {ok:true,url:'https://s3.eu-west-1.amazonaws.com/sandbox-file-upload-service-uploaded',maxFileSize:20971520,fields:{key:'test',Policy:'test'},expiresAt:Date.now()+55000};
  if(action==='upload_status'||action==='source_verify')return {ok:true,fileLinked:linked,...sourceState(),message:linked?'Morning מציגה קובץ מצורף להוצאה.':'קישור הקובץ טרם אומת ב־Morning.'};
  if(action==='source_waive'){sourceException=true;return {ok:true,...sourceState(),sourceExceptionReason:body.reason};}
  throw Error('unexpected '+action);
 };
 const request=async(action,body,assertCurrent)=>{
  if(action!=='capabilities')check(body.expectedEnvironment===environment,'request not pinned to environment');
  return {...await respond(action,body,assertCurrent),version:1,environment};
 };
 const fixture=document.createElement('div');fixture.id='expenseFixture';fixture.className='view-scroll';fixture.style.height='calc(100vh - 80px)';document.getElementById('main').replaceChildren(fixture);
 const upload=async(ticket,selected,assertCurrent)=>fileEffects.uploadExpenseFile(ticket,selected,assertCurrent,{fetch:async(url,init)=>{
  uploads++;check(init.credentials==='omit'&&!init.headers,'upload leaked auth');check([...init.body.keys()].at(-1)==='file','file not last');return new Response(null,{status:204});
 }});
 const {createUiDateEditor}=await import('./assets/js/ui/date-editor.js');
 const ports={dateEditorMarkup:createUiDateEditor({}).dateEditorMarkup,request,captureRead:capture,captureWrite:capture,accountId:()=>owner,todayISO:()=>today,subscribeAccountScope:fn=>{listener=fn;return()=>{}},confirmDialog:async(title,text)=>{confirms++;confirmations.push(text);check(title.includes(environment==='production'?'האמיתי':'Sandbox')||!title.startsWith('שמירת'),'wrong environment approval');return confirmWait?await confirmWait:true},files:{validate:fileEffects.validateExpenseFile,upload}};
 let uiFeature=createMorningExpenseIntake(ports);fixture.innerHTML=uiFeature.markup();
 bindActionEvents(fixture,new Proxy({}, {get:(_,name)=>(...args)=>uiFeature.actions[name]?.(...args)}));
 for(const name of ['click','input','change','keydown','drop','dragover','paste'])fixture.addEventListener(name,event=>event.stopPropagation());
 const click=name=>{const element=fixture.querySelector('[data-action="morning-expense-'+name+'"], [data-expense-command="'+name+'"]');check(element,'missing '+name);element.click()};
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 check(fixture.querySelectorAll('[role="option"]').length===1,'suppliers missing');check(!fixture.querySelector('script'),'unescaped supplier');
 const field=(name,value,type='input')=>{const element=fixture.querySelector('[data-expense-field="'+name+'"]');check(element,'missing '+name);if(element.type==='checkbox')element.checked=value===true;else element.value=value;element.dispatchEvent(new Event(type,{bubbles:true}));return element};
 check(fixture.querySelector('[data-expense-field="reportingPeriod"]').value==='2026-09','bimonth default missing');
 check([...fixture.querySelector('[data-expense-field="reportingYear"]').options].map(item=>item.value).join(',')==='2026','obsolete reporting years remain');
 check(!fixture.textContent.includes('השמירה יוצרת הוצאה אמיתית')&&!fixture.textContent.includes('נטען עמוד הצעות ראשוני'),'removed notices remain');
 field('date','2026-09-20','change');check(fixture.querySelector('[data-expense-field="reportingDate"]').value==='2026-09-01','September reporting month changed');
 field('date','2026-10-20','change');check(fixture.querySelector('[data-expense-field="reportingDate"]').value==='2026-10-01','October reporting month changed');
 field('supplierId',id(2),'change');check(fixture.querySelector('[data-expense-field="classificationExpenseId"]').value===id(3),'last category missing');
 check(!fixture.querySelector('[data-expense-field="historyYear"]')&&!fixture.querySelector('[data-expense-command="classification-year"]'),'removed classification controls remain');
 check(fixture.querySelector('[data-expense-history]').textContent.includes('HISTORY-1'),'history did not load automatically');
 check(!fixture.querySelector('[data-expense-command="next"]'),'new intake offers a redundant reset button');
 historyItems=Array.from({length:55},(_,index)=>({...expense,id:id(100+index),number:'HISTORY-'+index,sourceDocumentDate:index===54?'2026-10-26':'2026-08-01'}));
 const editing=field('number','preserved');editing.focus();
 await uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'history-refresh'}});await settle();
 check(editing.isConnected&&document.activeElement===editing&&editing.value==='preserved','history refresh replaced or blurred the intake');
 const historyRows=()=>[...fixture.querySelectorAll('[data-expense-history-id]')];
 check(historyRows().length===20&&historyRows()[0].textContent.includes('HISTORY-54'),'history sorted API pages separately or did not limit the first display');
 const historyList=fixture.querySelector('[data-expense-history]');check(getComputedStyle(historyList).overflowY==='visible','history has a nested vertical scroll');
 check(!historyList.querySelector('[data-expense-command="history-more"]'),'history still requires a load-more click');
 const scrollToCount=async count=>{fixture.scrollTop=fixture.scrollHeight;for(let i=0;i<120&&historyRows().length<count;i++)await new Promise(resolve=>setTimeout(resolve,20));await settle();check(historyRows().length===count,'infinite history scroll expected '+count+' rows, found '+historyRows().length)};
 await scrollToCount(40);await scrollToCount(55);await scrollToCount(56);
 check(historyRows().at(-1).textContent.includes('OLD-PERIOD'),'history did not load the previous reporting period');
 check(fixture.querySelectorAll('.morning-expense-history-period h3').length===2,'history failed to separate reporting periods');
 check(requests.every(({action,body})=>action!=='expenses'||body.fromDate!==undefined),'opening scanned the entire account');
 searchItems=Array.from({length:251},(_,index)=>({...expense,id:id(1000+index),number:index===249?'OLDSEARCH':'SEARCH-'+index,name:index===250?'ת.ב.י הוצאות':'אחר',
   description:'כיסאות',grossCents:123450,vatCents:18831,reportingDate:index===249?'2025-12-01':'2026-10-01',sourceDocumentDate:index===250?'2026-09-15':index===249?'2025-08-05':'2026-08-01'}));
 for(const term of ['15-9-26','15-09-26','15/09/26','15.09.2026','תבי 1,234.50','SEARCH-250','OLDSEARCH']){
  const input=fixture.querySelector('[data-input="morning-expense-history-query"]');input.value=term;input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));await settle();
  check(!historyRows().length&&fixture.querySelector('[data-expense-history]').textContent.includes('החיפוש עדיין חלקי'),'incomplete search presented a final empty result');
  check(document.activeElement?.value===term,'search render lost input focus');
  click('history-search-more');await settle();
  check(historyRows().length===1&&historyRows()[0].textContent.includes(term==='OLDSEARCH'?'OLDSEARCH':'SEARCH-250'),'search missed a date/amount/text match beyond the initial pages');
  check(fixture.querySelector('[data-expense-history]').textContent.includes(term==='OLDSEARCH'?'2025':'2026')&&fixture.querySelector('[data-expense-history]').textContent.includes('החיפוש הושלם בכל החשבון'),'search ignored old reporting periods or completion');
  check(editing.isConnected&&editing.value==='preserved'&&posts===0&&confirms===0,'search changed the intake or dispatched a financial action');
 }
 click('history-search-clear');check(historyRows().length===56,'clearing search lost the browsed history');searchItems=null;
 const explicitSearchReads=requests.filter(({action,body})=>action==='expenses'&&body.fromDate===undefined).length;
 historyUnavailable=true;click('history-refresh');await settle();check(fixture.querySelector('[data-expense-history]').textContent.includes('לא ניתן להשלים')&&fixture.querySelector('[data-expense-field="number"]').value==='preserved','history error erased intake data');
 historyUnavailable=false;historyItems=[expense];click('history-refresh');await settle();
 field('supplierQuery','123456789');await new Promise(resolve=>setTimeout(resolve,350));await settle();check(requests.at(-1).body.taxId==='123456789','tax search not passed to provider');
 field('supplierId',id(2),'change');click('favorite');field('supplierQuery','missing');await new Promise(resolve=>setTimeout(resolve,350));await settle();check(!fixture.querySelector('[data-expense-field="supplierId"]').value,'unselected search text retained a supplier identity');
 click('use-favorite');check(fixture.querySelector('[data-expense-field="supplierId"]').value===id(2),'favorite did not restore supplier');
 field('number','000123');field('net','1000.00');field('vat','160.00');check(field('description','הוצאה לבדיקה').isConnected,'typing replaced field');
 catalogExpense={...expense,id:id(30)};click('load');await settle();
 check(fixture.querySelector('[data-expense-field="classificationExpenseId"]').value==='','refresh retained invisible category');
 click('save');await settle();check(posts===0&&confirms===0,'invisible category reached creation');field('supplierId',id(2),'change');
 field('date','2026-08-20','change');check(!fixture.querySelector('[data-expense-field="reportingDateConfirmed"]'),'extra late-report checkbox remained');check(fixture.querySelector('[data-expense-field="reportingDate"]').value==='2026-10-01','later reporting month was not derived');field('date','2026-10-20','change');
 field('pcnClassification','P','change');check(fixture.querySelector('[data-action="morning-expense-save"]').disabled,'P write available');field('pcnClassification','T','change');
 field('gross','');click('save');await settle();check(posts===0&&confirms===0,'invalid totals reached write');field('net','1000.00');field('vat','160.00');
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO2sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 const selection=new DataTransfer();for(const name of ['first.png','second.png'])selection.items.add(new File([png],name,{type:'image/png'}));
 const input=fixture.querySelector('input[type="file"]');input.files=selection.files;input.dispatchEvent(new Event('change',{bubbles:true}));await settle();check(fixture.querySelector('img')?.src.startsWith('blob:'),'source preview missing');
 fixture.innerHTML=uiFeature.markup();const paste=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:selection});fixture.querySelector('[data-morning-expense-intake]').dispatchEvent(paste);await settle();check(paste.defaultPrevented&&fixture.querySelector('img'),'file paste failed after parent rerender');
 check(fixture.querySelectorAll('.morning-expense-queue li').length===4,'paste replaced queued files');
 const queueClick=(name,index)=>fixture.querySelector('[data-expense-command="'+name+'"][data-expense-index="'+index+'"]').click();
 queueClick('choose-file',1);check(fixture.querySelector('.morning-expense-source>b').textContent==='second.png','queue selection failed');
 queueClick('remove-file',2);queueClick('remove-file',2);queueClick('choose-file',1);
 check(fixture.querySelectorAll('.morning-expense-queue li').length===2&&fixture.querySelector('.morning-expense-source>b').textContent==='first.png','queue removal lost another file');
 uploadEnabled=false;click('load');await settle();click('save');await settle();check(posts===0&&fixture.textContent.includes('צירוף קבצים עדיין כבוי'),'file queue entered disabled upload path');uploadEnabled=true;click('load');await settle();
 click('save');await settle();check(posts===1&&confirms===1,'save not exactly once');
 check(requests.filter(({action,body})=>action==='expenses'&&body.fromDate===undefined).length===explicitSearchReads,'saving scanned the entire account');
 click('recent-refresh');await settle();check(fixture.querySelector('[data-expense-recent]').textContent.includes('000123'),'explicit recent loading missed saved intake');
 check(confirmations[0].includes('ציוד משרד')&&confirmations[0].includes('2026-10-20')&&confirmations[0].includes('חשבונית מס'),'approval omitted category, type or source date');
 const recovery=localStorage.getItem('morningExpenseOperation:'+environment+':'+owner);check(recovery&&!recovery.includes('000123')&&!recovery.includes('first.png'),'recovery retained invoice data');
 check(!fixture.querySelector('[data-action="morning-expense-save"]'),'created invoice can save again');
 click('next');check(fixture.querySelector('.morning-expense-source>b').textContent==='first.png','unlinked source discarded');
 click('upload');await settle();check(uploads===1,'upload missing');check(fixture.querySelector('.morning-expense-status').textContent.includes('טרם אומת'),'accepted upload claimed linked');
 click('file-status');await settle();check(!fixture.querySelector('.morning-expense-operation').textContent.includes('Morning מציגה קובץ'),'pending file claimed linked');
 linked=true;click('file-status');await settle();check(fixture.querySelector('.morning-expense-operation').textContent.includes('Morning מציגה קובץ'),'file linkage missing');
 const desktop={width:innerWidth,scroll:document.documentElement.scrollWidth};check(desktop.scroll<=desktop.width+1,'desktop overflow');
 click('next');check(fixture.querySelector('.morning-expense-source>b').textContent==='second.png','queue did not advance');check(fixture.querySelector('[data-expense-field="supplierId"]').value===id(2),'supplier default lost');
 const preferenceText=localStorage.getItem('morningExpensePreferences:'+environment+':'+owner);check(preferenceText&&!preferenceText.includes(supplier.name)&&!preferenceText.includes(supplier.taxId)&&!preferenceText.includes('000123'),'preferences leaked invoice or supplier data');
 uiFeature.runtime.dispose();uiFeature=createMorningExpenseIntake(ports);fixture.innerHTML=uiFeature.markup();directoryHidden=true;catalogExpense={...expense,id:id(40),classification:{...expense.classification,id:id(44),title:'סיווג אחר'}};
 click('toggle');await settle();check(fixture.querySelector('[data-expense-command="use-favorite"]'),'favorite did not survive reopening or canonical lookup');
 check(!fixture.querySelector('[data-expense-recent-id]'),'reopening automatically scanned the entire account');click('recent-refresh');await settle();
 check(fixture.querySelector('[data-expense-recent-id="'+id(8)+'"]'),'explicit recent lookup missed saved intake');
 field('supplierId',id(2),'change');await settle();check(fixture.querySelector('[data-expense-field="classificationExpenseId"]').value===id(30),'saved category outside the history page was not revalidated');directoryHidden=false;
 // Account change while the approval dialog is open must prevent dispatch entirely.
 field('number','cancelled');field('net','1000.00');field('vat','160.00');let releaseConfirm;confirmWait=new Promise(resolve=>releaseConfirm=resolve);
 const saving=uiFeature.actions['morning-expense-save']();await new Promise(resolve=>setTimeout(resolve,0));owner=id(9);listener();releaseConfirm(true);await saving;confirmWait=null;check(posts===1,'stale confirmation dispatched');owner=id(1);listener();
 localStorage.setItem('morningExpenseOperation:'+owner,recovery);uiFeature.runtime.dispose();uiFeature=createMorningExpenseIntake(ports);fixture.innerHTML=uiFeature.markup();click('toggle');await settle();
 check(!fixture.querySelector('[data-action="morning-expense-save"]'),'reload enabled blind replay');click('status');await settle();check(posts===1,'recovery created another expense');
 check(fixture.querySelector('[data-expense-receipt]').textContent.includes('RECOVERED-123'),'recovered operation details missing');
 check(!fixture.querySelector('[data-expense-field="number"]'),'recovery displayed an empty intake form');
 statusUnavailable=true;click('status');await settle();check(!fixture.querySelector('[data-action="morning-expense-upload"]')&&fixture.textContent.includes('אימות הפרטים ממתין'),'failed read kept historical verification');statusUnavailable=false;click('status');await settle();
 recoveryState='needs_reconciliation';click('status');await settle();check(fixture.querySelector('[data-expense-field="reconciliationId"]'),'reconciliation control missing');
 field('reconciliationId',id(8));click('reconcile');await settle();check(posts===1&&!fixture.querySelector('[data-expense-field="reconciliationId"]'),'reconciliation created a new expense or stayed unresolved');
 linked=false;serverFileState='ticket_issued';click('status');await settle();click('next');check(fixture.querySelector('[data-expense-receipt]')&&!fixture.querySelector('[data-expense-field="number"]'),'reloaded pending file lost its recovery');serverFileState='not_started';
 const originalEnvironment=environment;environment=environment==='sandbox'?'production':'sandbox';click('load');await settle();check(fixture.textContent.includes('סביבת Morning השתנתה')&&!fixture.querySelector('[data-action="morning-expense-save"]'),'environment switch reassigned pending operation');environment=originalEnvironment;
 recoveryState='reserved';click('status');await settle();click('cancel');await settle();check(posts===1&&fixture.textContent.includes('בוטלה לפני שליחה'),'reserved cancellation failed');
 check(!fixture.querySelector('[data-expense-command="next"]').disabled,'cancelled source reservation still blocks the next invoice');
 uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'next'}});let release;held=new Promise(resolve=>release=resolve);const loading=uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'load'}});await new Promise(resolve=>setTimeout(resolve,0));owner=id(9);listener();release();await loading;held=null;
 check(!fixture.textContent.includes(supplier.name)&&!fixture.querySelector('[data-expense-field="supplierId"]'),'old account catalog survived');check(!fixture.textContent.includes(id(8))&&!fixture.querySelector('[data-expense-recent-id]'),'old expense result or recent intake survived');uiFeature.runtime.dispose();localStorage.removeItem('morningExpenseOperation:'+id(1));localStorage.removeItem('morningExpenseOperation:'+environment+':'+id(1));localStorage.removeItem('morningExpensePreferences:'+environment+':'+id(1));
 calendarTesting=true;
 for(const [date,period,years] of [['2026-10-31','2026-09','2026'],['2026-11-01','2026-11','2026'],['2027-01-01','2027-01','2027,2026'],['2027-02-28','2027-01','2027,2026'],['2027-03-01','2027-03','2027']]){
  today=date;uiFeature=createMorningExpenseIntake(ports);fixture.innerHTML=uiFeature.markup();click('toggle');await settle();
  check(fixture.querySelector('[data-expense-field="reportingPeriod"]').value===period,'wrong calendar default on '+date);
  check([...fixture.querySelector('[data-expense-field="reportingYear"]').options].map(item=>item.value).join(',')===years,'wrong year choices on '+date);
  if(date==='2026-11-01'){
   field('date','2026-10-15','change');check(fixture.querySelector('[data-expense-field="reportingDate"]').value==='2026-11-01','old invoice silently changed the calendar default');
   field('reportingPeriod','2026-09','change');check(fixture.querySelector('[data-expense-field="reportingDate"]').value==='2026-10-01','explicit previous period did not preserve October');
  }
  if(date==='2027-01-01'){
   field('reportingYear','2026','change');check(fixture.querySelector('[data-expense-field="reportingYear"]').value==='2026','previous year not selectable in January');
   field('reportingPeriod','2026-11','change');today='2027-03-01';field('supplierId',id(2),'change');
   check(fixture.querySelector('[data-expense-field="reportingYear"]').value==='2026','an open previous-year draft was silently changed in March');
  }
  uiFeature.runtime.dispose();
 }
 return {posts,uploads,confirms,requests:requests.length,desktop};
})()"""

if __name__ == '__main__':
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-expenses') as browser:
        for environment in ['sandbox', 'production']:
            for width in [1440, 390]:
                browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width < 800})
                result = browser.evaluate(FLOW.replace("let environment='sandbox'", f"let environment='{environment}'"), timeout=45)
                assert result['posts'] == 1 and result['uploads'] == 1, result
        assert not browser.drain_serious_errors()
        print('PASS Morning expense intake: VAT, confirmation, source preview, queue, recovery and account isolation', result, flush=True)
