"""Real browser expense intake with synthetic provider; no live financial writes."""
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady; syncDocument.stopPolling(); finance.runtime.stop();
 const {createMorningExpenseIntake}=await import('./assets/js/domains/finance/morning-expense-intake.js');
 const {bindActionEvents}=await import('./assets/js/shared/events.js');
 const fileEffects=await import('./assets/js/platform/morning-expense-files.js');
 const check=(value,message)=>{if(!value)throw Error(message)};
 const id=n=>'aaaaaaaa-aaaa-4aaa-aaaa-'+String(n).padStart(12,'0');
 let owner=id(1), listener=()=>{}, linked=false, posts=0, uploads=0, confirms=0, held=null, confirmWait=null;
 const requests=[], capture=()=>{const saved=owner;return()=>check(saved===owner,'account changed')};
 const supplier={id:id(2),name:'ספק בדיקה <script>',taxId:'123456789',active:true,country:'IL'};
 const expense={id:id(3),kind:'expense',status:10,supplierId:id(2),sourceDocumentDate:'2026-10-20',pcnClassification:'T',classification:{id:id(4),title:'ציוד משרד',vat:100,income:100}};
 const paged=items=>({ok:true,version:1,environment:'sandbox',page:0,pageSize:50,total:items.length,pages:items.length?1:0,items});
 const request=async(action,body,assertCurrent)=>{
  assertCurrent();requests.push({action,body});if(held&&action==='suppliers')await held;
  if(action==='capabilities')return {ok:true,version:1,environment:'sandbox',create:true,upload:true};
  if(action==='suppliers')return paged([supplier]);if(action==='expenses')return paged([expense]);
  if(action==='create'){posts++;check(body.expense.vat==='160.00','manual VAT changed');return {ok:true,state:'created',verified:true,expenseId:id(8),fileLinked:false};}
  if(action==='operation_status')return {ok:true,state:'created',verified:true,expenseId:id(8),fileLinked:linked};
  if(action==='upload_ticket')return {ok:true,url:'https://s3.eu-west-1.amazonaws.com/sandbox-file-upload-service-uploaded',maxFileSize:20971520,fields:{key:'test',Policy:'test'},expiresAt:Date.now()+55000};
  if(action==='upload_status')return {ok:true,fileLinked:linked,message:linked?'Morning מציגה קובץ מצורף להוצאה.':'קישור הקובץ טרם אומת ב־Morning.'};
  throw Error('unexpected '+action);
 };
 const fixture=document.createElement('div');fixture.id='expenseFixture';document.getElementById('main').replaceChildren(fixture);
 const upload=async(ticket,selected,assertCurrent)=>fileEffects.uploadExpenseFile(ticket,selected,assertCurrent,{fetch:async(url,init)=>{
  uploads++;check(init.credentials==='omit'&&!init.headers,'upload leaked auth');check([...init.body.keys()].at(-1)==='file','file not last');return new Response(null,{status:204});
 }});
 const ports={request,captureRead:capture,captureWrite:capture,accountId:()=>owner,todayISO:()=> '2026-10-26',subscribeAccountScope:fn=>{listener=fn;return()=>{}},confirmDialog:async()=>{confirms++;return confirmWait?await confirmWait:true},files:{validate:fileEffects.validateExpenseFile,upload}};
 let uiFeature=createMorningExpenseIntake(ports);fixture.innerHTML=uiFeature.markup();
 bindActionEvents(fixture,new Proxy({}, {get:(_,name)=>(...args)=>uiFeature.actions[name]?.(...args)}));
 for(const name of ['click','input','change','keydown','drop','dragover','paste'])fixture.addEventListener(name,event=>event.stopPropagation());
 const click=name=>{const element=fixture.querySelector('[data-action="morning-expense-'+name+'"]');check(element,'missing '+name);element.click()};
 const settle=()=>uiFeature.runtime.drain();click('toggle');click('load');await settle();
 check(fixture.querySelectorAll('[data-expense-field="supplierId"] option').length===2,'suppliers missing');check(!fixture.querySelector('script'),'unescaped supplier');
 const field=(name,value,type='input')=>{const element=fixture.querySelector('[data-expense-field="'+name+'"]');check(element,'missing '+name);if(element.type==='checkbox')element.checked=value===true;else element.value=value;element.dispatchEvent(new Event(type,{bubbles:true}));return element};
 check(fixture.querySelector('[data-expense-field="reportingPeriod"]').value==='2026-09','bimonth default missing');
 field('date','2026-09-20','change');check(fixture.querySelector('[data-expense-field="reportingDate"]').value==='2026-09-01','September reporting month changed');
 field('date','2026-10-20','change');check(fixture.querySelector('[data-expense-field="reportingDate"]').value==='2026-10-01','October reporting month changed');
 field('supplierId',id(2),'change');check(fixture.querySelector('[data-expense-field="classificationExpenseId"]').value===id(3),'last category missing');
 field('number','000123');field('net','1000.00');field('vat','160.00');field('gross','1160.00');check(field('description','הוצאה לבדיקה').isConnected,'typing replaced field');
 field('date','2026-08-20','change');check(fixture.querySelector('[data-expense-field="reportingDateConfirmed"]'),'late-report confirmation missing');click('save');await settle();check(posts===0&&confirms===0,'late month bypassed explicit approval');field('reportingDateConfirmed',true,'change');field('date','2026-10-20','change');
 field('pcnClassification','P','change');check(fixture.querySelector('[data-action="morning-expense-save"]').disabled,'P write available');field('pcnClassification','T','change');
 field('gross','1180');click('save');await settle();check(posts===0&&confirms===0,'invalid totals reached write');field('gross','1160.00');
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO2sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 const selection=new DataTransfer();for(const name of ['first.png','second.png'])selection.items.add(new File([png],name,{type:'image/png'}));
 const input=fixture.querySelector('input[type="file"]');input.files=selection.files;input.dispatchEvent(new Event('change',{bubbles:true}));await settle();check(fixture.querySelector('img')?.src.startsWith('blob:'),'source preview missing');
 fixture.innerHTML=uiFeature.markup();const paste=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:selection});fixture.querySelector('[data-morning-expense-intake]').dispatchEvent(paste);await settle();check(paste.defaultPrevented&&fixture.querySelector('img'),'file paste failed after parent rerender');
 click('save');await settle();check(posts===1&&confirms===1,'save not exactly once');
 const recovery=localStorage.getItem('morningExpenseOperation:'+owner);check(recovery&&!recovery.includes('000123')&&!recovery.includes('first.png'),'recovery retained invoice data');
 check(fixture.querySelector('[data-action="morning-expense-save"]').disabled,'created invoice can save again');
 click('next');check(fixture.querySelector('.morning-expense-source>b').textContent==='first.png','unlinked source discarded');
 click('upload');await settle();check(uploads===1,'upload missing');check(fixture.querySelector('.morning-expense-status').textContent.includes('טרם אומת'),'accepted upload claimed linked');
 click('file-status');await settle();check(!fixture.querySelector('.morning-expense-operation').textContent.includes('Morning מציגה קובץ'),'pending file claimed linked');
 linked=true;click('file-status');await settle();check(fixture.querySelector('.morning-expense-operation').textContent.includes('Morning מציגה קובץ'),'file linkage missing');
 const desktop={width:innerWidth,scroll:document.documentElement.scrollWidth};check(desktop.scroll<=desktop.width+1,'desktop overflow');
 click('next');check(fixture.querySelector('.morning-expense-source>b').textContent==='second.png','queue did not advance');check(fixture.querySelector('[data-expense-field="supplierId"]').value===id(2),'supplier default lost');
 // Account change while the approval dialog is open must prevent dispatch entirely.
 field('number','cancelled');field('net','1000.00');field('vat','160.00');field('gross','1160.00');let releaseConfirm;confirmWait=new Promise(resolve=>releaseConfirm=resolve);
 const saving=uiFeature.actions['morning-expense-save']();await new Promise(resolve=>setTimeout(resolve,0));owner=id(9);listener();releaseConfirm(true);await saving;confirmWait=null;check(posts===1,'stale confirmation dispatched');owner=id(1);listener();
 localStorage.setItem('morningExpenseOperation:'+owner,recovery);uiFeature.runtime.dispose();uiFeature=createMorningExpenseIntake(ports);fixture.innerHTML=uiFeature.markup();click('toggle');click('load');await settle();
 check(fixture.querySelector('[data-action="morning-expense-save"]').disabled,'reload enabled blind replay');click('status');await settle();check(posts===1,'recovery created another expense');
 uiFeature.actions['morning-expense-next']();let release;held=new Promise(resolve=>release=resolve);const loading=uiFeature.actions['morning-expense-load']();await new Promise(resolve=>setTimeout(resolve,0));owner=id(9);listener();release();await loading;held=null;
 check(!fixture.textContent.includes(supplier.name)&&!fixture.querySelector('[data-expense-field="supplierId"]'),'old account catalog survived');check(!fixture.textContent.includes(id(8)),'old expense result survived');uiFeature.runtime.dispose();localStorage.removeItem('morningExpenseOperation:'+id(1));
 return {posts,uploads,confirms,requests:requests.length,desktop};
})()"""

if __name__ == '__main__':
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-expenses') as browser:
        for width in [1440, 390]:
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width < 800})
            result = browser.evaluate(FLOW, timeout=45)
            assert result['posts'] == 1 and result['uploads'] == 1, result
        assert not browser.drain_serious_errors()
        print('PASS Morning expense intake: VAT, confirmation, source preview, queue, recovery and account isolation', result, flush=True)
