"""Supplier display state and saved local recognition categories in a real browser."""
from browser_harness import BrowserSession,ROOT
from runtime_morning_expense_local import PREFIX

LOCAL=PREFIX.replace("if(action==='get_expense')return {ok:true,version:1,environment,item:{...expense,id:body.id}};",
 "if(action==='get_expense')return {ok:true,version:1,environment,item:{...expense,id:body.id,classification:{...expense.classification,id:id(41),title:'קניות סחורה בארץ'}}};")
LOCAL+=r"""
 localStorage.setItem('morningExpensePreferences:'+environment+':'+owner,JSON.stringify({version:1,favorites:[],classifications:[{supplierId:supplier.id,expenseId:id(77)}]}));
 click('toggle');await uiFeature.runtime.drain();
 await uiFeature.actions['morning-expense-files']({files:[new File(['%PDF-1.4 synthetic'],'supplier.pdf',{type:'application/pdf'})]});
 await uiFeature.runtime.drain();
 check(fixture.querySelector('[data-expense-field=supplierId]').value===supplier.id,'recognized supplier missing');
 const select=fixture.querySelector('[data-expense-field=classificationExpenseId]');
 check(select.value===id(77)&&select.selectedOptions[0].textContent==='קניות סחורה בארץ','local recognition ignored the saved canonical category');
 check(posts===0&&uploads===0,'recognition created a financial write');uiFeature.runtime.dispose();return {savedCategory:true,posts,uploads};
})()"""

PICKER=r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const {createExpenseSupplierPicker}=await import('./assets/js/domains/finance/morning-expense-supplier-picker.js');
 const check=(value,message)=>{if(!value)throw Error(message);};
 const supplier={id:'selected',name:'ספק שנבחר',taxId:'123456782'};
 const fixture=document.createElement('div');document.getElementById('main').replaceChildren(fixture);
 let selected=supplier.id;
 const picker=createExpenseSupplierPicker({rows:()=>[supplier],selectedId:()=>selected,eligibility:()=>({eligible:true}),editable:()=>true,
  invalidateSelection:()=>{selected='';},choose:id=>{selected=id;},run:work=>work(),search:async()=>({items:[supplier]}),commit:()=>{},report:()=>{}});
 const render=()=>{fixture.innerHTML=picker.markup(false);return fixture.querySelector('[role=combobox]');};
 let input=render();picker.handle(input,{type:'focus'});check(input.value===supplier.name,'selected name missing on open');
 input=render();check(input.value===supplier.name,'opening followed by rendering erased the selected name');
 picker.handle(input,{type:'focus'});input=render();check(input.value===supplier.name,'repeated render lost selected name');
 input.value='חדש';picker.handle(input,{type:'input'});input=render();check(input.value==='חדש'&&!selected,'typed query or invalidation lost');
 input.value='';picker.handle(input,{type:'input'});input=render();check(input.value===''&&!selected,'clearing search restored an old supplier');
 picker.reset();selected=supplier.id;input=render();check(input.value===supplier.name,'selection did not restore the canonical name');
 picker.reset();return {displayStable:true,searchEditsDistinct:true};
})()"""

if __name__=='__main__':
    for width in (1440,390):
        with BrowserSession(ROOT/'netunim-orders/site',f'expense-supplier-resolution-{width}') as browser:
            browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            print('PASS local supplier category:',browser.evaluate(LOCAL,timeout=40),flush=True)
            print('PASS supplier display owner:',browser.evaluate(PICKER,timeout=40),flush=True)
            assert not browser.drain_serious_errors()
