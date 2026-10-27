"""Work drafts stay private/in-memory and survive switching files or catalog refresh."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_expense_local import PREFIX

SCENARIO = PREFIX + r"""
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 const bytes=new TextEncoder().encode('%PDF-1.4 work draft fixture');
 const field=(name,value,type='input')=>{const el=fixture.querySelector('[data-expense-field="'+name+'"]');el.value=value;el.dispatchEvent(new Event(type,{bubbles:true}))};
 const value=name=>fixture.querySelector('[data-expense-field="'+name+'"]').value;
 const command=(name,index)=>uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:name,expenseIndex:String(index)}});
 const files=['first.pdf','second.pdf'].map(name=>new File([bytes,name],name,{type:'application/pdf'}));
 await uiFeature.actions['morning-expense-files']({files});await settle();
 field('number','A-0007');field('date','2026-08-20','change');field('reportingPeriod','2026-07','change');
 field('net','1234.00');field('vat','167.03');field('description','manual A');
 const first=Object.fromEntries(['number','date','net','vat','gross','description','allocationNumber','supplierId','classificationExpenseId'].map(name=>[name,value(name)]));
 await command('choose-file',1);await settle();field('number','B-0008');field('reportingPeriod','2026-09','change');field('vat','151.02');
 const second=Object.fromEntries(['number','date','reportingPeriod','reportingDate','net','vat','gross'].map(name=>[name,value(name)]));
 await command('choose-file',1);await settle();
 for(const [name,expected]of Object.entries(first))check(value(name)===expected,'first draft lost '+name);
 check(value('reportingPeriod')==='2026-09'&&value('reportingDate')==='2026-10-01','switching files replaced the last manual reporting choice with a draft-specific period');
 check(extractions===2,'returning to an unchanged source unnecessarily re-extracted or overwrote it');
 click('load');await settle();check(value('number')==='A-0007'&&value('vat')==='167.03','catalog refresh overwrote edited fields');
 await command('choose-file',1);await settle();for(const [name,expected]of Object.entries(second))check(value(name)===expected,'second draft lost '+name);
 confirmWait=Promise.resolve(false);await command('remove-file',1);await settle();check(fixture.querySelectorAll('.morning-expense-queue li').length===2,'cancelled removal discarded a draft');
 confirmWait=null;await command('remove-file',1);await settle();check(fixture.querySelectorAll('.morning-expense-queue li').length===1&&value('number')==='B-0008','removing another draft changed the active form');
 const unload=new Event('beforeunload',{cancelable:true});dispatchEvent(unload);check(unload.defaultPrevented&&uiFeature.runtime.hasUnsavedWork(),'refresh has no unsaved-work warning');
 const stored=Object.keys(localStorage).filter(key=>key.startsWith('morningExpense')).map(key=>localStorage.getItem(key)).join('');
 check(!stored.includes('manual A')&&!stored.includes('A-0007'),'work drafts leaked into persistent browser storage');
 owner=id(9);listener();click('load');await settle();field('supplierId',supplier.id,'change');field('number','MANUAL-001');field('net','1000');field('vat','170.09');
 await uiFeature.actions['morning-expense-files']({files:[files[0]]});await settle();
 check(value('number')==='MANUAL-001'&&value('vat')==='170.09','attaching the first PDF erased manual intake');
 check([...fixture.querySelector('[data-expense-field="reportingYear"]').options].map(option=>option.value).join(',')==='2026','October still offers obsolete reporting years');
 // Switching years is available at the start of a year. Preserve the edited
 // work draft across that boundary instead of relying on obsolete October choices.
 today='2027-01-05';click('load');await settle();
 check([...fixture.querySelector('[data-expense-field="reportingYear"]').options].map(option=>option.value).join(',')==='2027,2026','January lost the previous reporting year');
 field('date','2026-08-20','change');field('reportingYear','2027','change');field('reportingYear','2026','change');field('reportingPeriod','2026-07','change');
 check(value('reportingDate')==='2026-08-01'&&value('number')==='MANUAL-001'&&value('vat')==='170.09','previous-year reporting erased fields or assigned the wrong month');
 owner=id(10);listener();check(!uiFeature.runtime.hasUnsavedWork()&&!fixture.textContent.includes('MANUAL-001'),'drafts leaked across accounts');
 uiFeature.runtime.dispose();check(posts===0&&uploads===0,'work draft switching caused an external write');
 return {fileDrafts:true,manualAttachment:true,removeConfirmation:true,refreshWarning:true,isolated:true,posts,uploads};
})()"""

if __name__ == '__main__':
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-expense-work-drafts') as browser:
        for width in [1440,390]:
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            result=browser.evaluate(SCENARIO,timeout=45)
            print('PASS expense work drafts, round trip, first attachment, removal and privacy:', result, flush=True)
        assert not browser.drain_serious_errors()
