"""Supplier creation through the real intake event bindings, with synthetic Morning."""
from browser_harness import BrowserSession, ROOT

FLOW=r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const {createMorningExpenseIntake}=await import('./assets/js/domains/finance/morning-expense-intake.js');
 const {bindActionEvents}=await import('./assets/js/shared/events.js');
 const {createUiDateEditor}=await import('./assets/js/ui/date-editor.js');
 const assert=(value,message)=>{if(!value)throw Error(message);},id=n=>'aaaaaaaa-aaaa-4aaa-aaaa-'+String(n).padStart(12,'0');
 let owner=id(1),listener,posts=0,status=0,release,hold=null,capability=true;
 const supplier={id:id(2),name:'ספק <בדיקה>',taxId:'012345678',country:'IL',active:true};
 const captured=()=>{const saved=owner;return()=>assert(owner===saved,'stale owner');};
 const page=()=>({ok:true,version:1,environment:'sandbox',page:0,pageSize:50,total:0,pages:0,items:[]});
 const request=async(action,body,check)=>{
  check();if(action==='capabilities')return {ok:true,version:1,environment:'sandbox',create:true,createSupplier:capability};
  if(action==='get_supplier')return {ok:true,version:1,environment:'sandbox',item:supplier};
  if(action==='create_supplier'){posts++;assert(body.expectedEnvironment==='sandbox','wrong environment');if(hold)await hold;return {ok:true,version:1,environment:'sandbox',verified:false,pending:true,message:'pending'};}
  if(action==='supplier_status'){status++;return {ok:true,version:1,environment:'sandbox',verified:true,item:supplier,existing:true};}
  return page();
 };
 const feature=createMorningExpenseIntake({request,captureRead:captured,captureWrite:captured,accountId:()=>owner,
  subscribeAccountScope:fn=>{listener=fn;return()=>{};},todayISO:()=>'2026-11-03',confirmDialog:async()=>true,
  dateEditorMarkup:createUiDateEditor({}).dateEditorMarkup,files:{validate:()=>{throw Error('no files');}}});
 const fixture=document.createElement('div');fixture.innerHTML=feature.markup();document.body.replaceChildren(fixture);
 bindActionEvents(fixture,new Proxy({}, {get:(_,name)=>(...args)=>feature.actions[name]?.(...args)}));
 for(const name of ['click','input','change','keydown'])fixture.addEventListener(name,event=>event.stopPropagation());
 const click=command=>{const button=fixture.querySelector('[data-expense-command="'+command+'"]');assert(button,'missing '+command);button.click();};
 const fill=(selector,value)=>{const field=fixture.querySelector(selector);assert(field,'missing '+selector);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));};
 const start=fixture.querySelector('[data-action="morning-expense-toggle"]');start.click();await feature.runtime.drain();
 fill('[data-expense-field="number"]','KEEP-INVOICE');
 const actions=[...fixture.querySelector('.morning-expense-supplier-actions').children];assert(actions[0].dataset.expenseCommand==='supplier-new'&&actions[1].dataset.expenseCommand==='favorite','new button must be above favorites');
 click('supplier-new');assert(document.activeElement.dataset.expenseSupplierField==='name','new form focus');
 fill('[data-expense-supplier-field="name"]',supplier.name);fill('[data-expense-supplier-field="taxId"]',supplier.taxId);
 click('supplier-create');await feature.runtime.drain();assert(posts===1,'creation missing');
 assert(fixture.querySelector('[data-expense-supplier-field="taxId"]').readOnly,'uncertain identity editable');
 assert(fixture.querySelector('[data-expense-command="supplier-create"]').textContent.includes('בדיקת'),'uncertain creation offers another post');
 click('supplier-create');await feature.runtime.drain();await Promise.resolve();await feature.runtime.drain();
 assert(status===1&&posts===1,'recovery posted again');assert(fixture.querySelector('[data-expense-field="supplierId"]').value===supplier.id,'canonical supplier not selected');
 assert(fixture.querySelector('[data-expense-field="number"]').value==='KEEP-INVOICE','invoice draft replaced');
 assert(!fixture.querySelector('.morning-expense-supplier-create'),'verified form stays open');
 click('supplier-new');fill('[data-expense-supplier-field="name"]','Other');fill('[data-expense-supplier-field="taxId"]','987654321');
 hold=new Promise(resolve=>{release=resolve;});click('supplier-create');owner=id(3);listener();release();await feature.runtime.drain();
 assert(!fixture.querySelector('[data-expense-supplier-field]'),'stale creation leaked across accounts');
 capability=false;click('load');await feature.runtime.drain();
 assert(!fixture.querySelector('[data-expense-command="supplier-new"]'),'read-only capability shows creation');
 feature.runtime.dispose();return {posts,status};
})()"""

for width in (1440,390):
    with BrowserSession(ROOT/'netunim-orders/site',f'morning-supplier-create-{width}') as browser:
        browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1000,'deviceScaleFactor':1,'mobile':width<800})
        result=browser.evaluate(FLOW,timeout=40)
        assert result=={'posts':2,'status':1},result
        assert not browser.drain_serious_errors()
        print('PASS Morning supplier creation, draft retention, uncertain recovery and account isolation:',width,flush=True)
