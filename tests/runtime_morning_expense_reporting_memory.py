"""Remember reporting choices across fresh expense runtimes, dates and scopes."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_expenses import FLOW

PREFIX = FLOW[:FLOW.index(' const settle=')]
SCENARIO = PREFIX + r"""
 const settle=()=>uiFeature.runtime.drain();calendarTesting=true;
 for(const env of ['sandbox','production'])for(const account of [id(1),id(2)])localStorage.removeItem('morningExpensePreferences:'+env+':'+account+':reportingPeriod');
 const field=(name,value)=>{const input=fixture.querySelector('[data-expense-field="'+name+'"]');input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}))};
 const value=name=>fixture.querySelector('[data-expense-field="'+name+'"]').value;
 const fresh=async()=>{uiFeature.runtime.dispose();uiFeature=createMorningExpenseIntake(ports);fixture.innerHTML=uiFeature.markup();click('toggle');await settle()};
 const preference=()=> 'morningExpensePreferences:'+environment+':'+owner+':reportingPeriod';
 click('toggle');await settle();
 check(value('reportingPeriod')==='2026-09'&&JSON.parse(localStorage.getItem(preference())).period==='2026-09','initial selection was not remembered');
 field('reportingPeriod','2026-09');check(!uiFeature.runtime.hasUnsavedWork(),'a saved reporting preference is incorrectly treated as an unsaved invoice');
 today='2026-11-01';await fresh();check(value('reportingPeriod')==='2026-09','calendar rollover changed the saved period');
 check(fixture.querySelector('[data-expense-period-warning]'),'calendar rollover has no previous-period reminder');
 field('date','2026-10-15');check(value('reportingPeriod')==='2026-09'&&value('reportingDate')==='2026-10-01','invoice date changed the selected reporting period');
 field('reportingPeriod','2026-11');await fresh();check(value('reportingPeriod')==='2026-11','new manual choice was not persisted');
 check(!fixture.querySelector('[data-expense-period-warning]'),'current period still has an old-period warning');
 field('reportingPeriod','2026-09');await fresh();check(value('reportingPeriod')==='2026-09','returning to a previous period was not persisted');
 field('reportingPeriod','2026-11');
 today='2027-01-05';await fresh();check(value('reportingPeriod')==='2026-11'&&value('reportingYear')==='2026','year rollover changed the saved selection');
 today='2028-03-01';await fresh();check(value('reportingPeriod')==='2026-11'&&value('reportingYear')==='2026','a saved reporting period expired after a year');
 check([...fixture.querySelector('[data-expense-field="reportingYear"]').options].map(option=>option.value).join(',')==='2028,2026','remembered year is missing or the full historical menu returned');
 field('date','2028-03-01');check(value('reportingPeriod')==='2026-11'&&value('reportingDate')==='2026-12-01','a newer invoice silently advanced the remembered period');
 click('load');await settle();check(value('reportingPeriod')==='2026-11','catalog refresh changed the reporting preference');
 await uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'next'}});check(value('reportingPeriod')==='2026-11','new intake ignored the reporting preference');
 field('reportingYear','2028');field('reportingPeriod','2028-01');await fresh();check(value('reportingPeriod')==='2028-01','manual year/period change did not replace the old preference');
 const originalSet=Storage.prototype.setItem;
 Storage.prototype.setItem=function(key,value){if(key===preference())throw Error('blocked preference');return originalSet.call(this,key,value)};
 try {field('reportingPeriod','2028-03');check(value('reportingPeriod')==='2028-03'&&fixture.querySelector('[data-expense-message]').textContent.includes('למסך זה בלבד'),'storage failure lost the choice or falsely claimed persistence');}
 finally {Storage.prototype.setItem=originalSet;}
 await fresh();check(value('reportingPeriod')==='2028-01','failed storage write unexpectedly replaced the durable preference');
 owner=id(2);await fresh();check(value('reportingPeriod')==='2028-03','reporting preference leaked to another account');
 owner=id(1);environment=environment==='production'?'sandbox':'production';await fresh();check(value('reportingPeriod')==='2028-03','reporting preference crossed environments');
 environment=environment==='production'?'sandbox':'production';await fresh();check(value('reportingPeriod')==='2028-01','original scoped preference was lost');
 check(posts===0&&uploads===0,'reporting preferences dispatched an external financial write');
 uiFeature.runtime.dispose();
 return {remembered:true,monthBoundary:true,yearBoundary:true,manualReturn:true,scoped:true,storageFailure:true,posts,uploads};
})()"""

if __name__ == '__main__':
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-expense-reporting-memory') as browser:
        for environment in ['sandbox', 'production']:
            browser.call('Emulation.setDeviceMetricsOverride', {'width':390,'height':1100,'deviceScaleFactor':1,'mobile':True})
            result = browser.evaluate(SCENARIO.replace("let environment='sandbox'", f"let environment='{environment}'"), timeout=45)
            print('PASS durable reporting period selection:', result, flush=True)
        assert not browser.drain_serious_errors()
