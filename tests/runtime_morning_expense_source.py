"""Native browser crash recovery and original-file binding; synthetic HTTP only."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_expense_local import PREFIX

SCENARIO = PREFIX + r"""
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 const bytes=new TextEncoder().encode('%PDF-1.4 source recovery fixture');
 const original=new File([bytes],'original.pdf',{type:'application/pdf'});
 const choose=async file=>{await uiFeature.actions['morning-expense-files']({files:[file]});await settle()};
 recognized.fields.net.status='review';recognized.fields.net.reason='computed_net';
 await choose(original);
 const warnings=fixture.querySelector('[data-expense-review-warnings]');
 check(warnings&&!warnings.hidden&&/מחושב|חושב/.test(warnings.textContent)&&warnings.textContent.includes('s0123456789')&&fixture.querySelector('[data-expense-review-field="net"]').dataset.reviewStatus==='review','computed or normalized source hidden before save');
 await uiFeature.actions['morning-expense-files']({files:Array.from({length:19},(_,n)=>new File([bytes,String(n)],'queued-'+n+'.pdf',{type:'application/pdf'}))});await settle();
 click('save');await settle();
 check(posts===1&&uploads===0&&sourceMetadata?.sha256?.length===64,'source intent missing before upload');
 check(sourceReview.mode==='extracted','matching extracted source forced manual source review');
 check(fixture.querySelector('[data-expense-command="next"]').disabled,'pending original can be abandoned');
 await choose(new File([bytes,'wrong'],'replacement.pdf',{type:'application/pdf'}));
 check(fixture.querySelector('.morning-expense-source>b').textContent==='replacement.pdf','full queue counts a replaced original twice');
 await choose(original);check(fixture.querySelector('.morning-expense-source>b').textContent==='original.pdf','full queue prevents source recovery');
 const key='morningExpenseOperation:'+environment+':'+owner;
 uiFeature.runtime.dispose();localStorage.removeItem(key); // The server list survives even loss of the local pointer.
 uiFeature=createMorningExpenseIntake(ports);fixture.innerHTML=uiFeature.markup();click('toggle');await settle();
 check(fixture.querySelector('[data-source-operation]'),'server pending source disappeared after reload');
 await uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'source-resume',sourceOperation:id(90)}});await settle();
 check(localStorage.getItem(key)?.includes(id(90))&&posts===1,'recovery did not pin the original operation');
 check(!fixture.querySelector('[data-action="morning-expense-save"]')&&fixture.querySelector('[data-expense-command="next"]').disabled,'recovery permits another create');
 await choose(new File([bytes,'different'],'wrong.pdf',{type:'application/pdf'}));
 click('upload');await settle();check(uploads===0&&!requests.some(row=>row.action==='upload_prepare'),'wrong reselected source received an upload form');
 check(fixture.textContent.includes('אינו המקור'),'wrong hash was not explained');
 await choose(original);click('upload');await settle();check(uploads===1&&posts===1,'original source could not resume');
 serverFileState='ticket_issued';click('status');await settle();
 click('upload');await settle();check(uploads===1,'ambiguous source upload replayed');
 const reason=fixture.querySelector('[data-expense-field="sourceReason"]');check(reason&&!reason.disabled,'source exception cannot be edited during recovery');
 reason.value='המקור נבדק במורנינג, נדרשת השלמה חשבונאית ידנית';reason.dispatchEvent(new Event('input',{bubbles:true}));
 await uiFeature.actions['morning-expense-write']({dataset:{expenseCommand:'source-waive'}});await settle();
 check(sourceException&&!fixture.querySelector('[data-expense-command="next"]').disabled,'explicit exception did not release pending original');
 check(fixture.querySelector('[data-expense-source-state]').textContent.includes('חריגה ידנית'),'exception falsely claimed source proof');
 check(posts===1&&uploads===1,'recovery repeated an external operation');uiFeature.runtime.dispose();localStorage.removeItem(key);
 return {sourceExpected:true,serverRecovery:true,wrongSourceBlocked:true,manualException:true,posts,uploads};
})()"""

if __name__ == '__main__':
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-expense-source') as browser:
        for width in [1440,390]:
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width < 800})
            result=browser.evaluate(SCENARIO,timeout=45)
            assert result['posts']==1 and result['uploads']==1,result
        assert not browser.drain_serious_errors()
        print('PASS source recovery: reload, server list, exact original, no replay and explicit exception',result,flush=True)
