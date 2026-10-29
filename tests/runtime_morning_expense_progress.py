"""Prompt approval, visible progress and relay-only retry in a native browser."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_expense_local import PREFIX

SCENARIO=PREFIX.replace(' let uiFeature=createMorningExpenseIntake(ports);',r"""
 let releaseChecks,checksEntered,holdSource=true;
 const checkHold=new Promise(resolve=>releaseChecks=resolve),enteredChecks=new Promise(resolve=>checksEntered=resolve);
 const baseRequest=ports.request;
 ports.request=async(action,body,check)=>{
  if(action==='capabilities')return {...await baseRequest(action,body,check),sourceRelay:true};
  if(action==='duplicate_check'){checksEntered();await checkHold;check();}
  if(action==='upload_source'){uploads++;check(body.file instanceof Blob,'relay has no file bytes');check(body.expectedEnvironment===environment,'relay environment missing');serverFileState='ticket_issued';if(body.retryGeneration){check(body.retryGeneration===id(10),'retry uses wrong operation generation');holdSource=false;linked=true;}return {ok:true,version:1,environment,fileState:'ticket_issued'};}
  const response=await baseRequest(action,body,check);
  if(action==='upload_status')return {...response,sourceRetryAt:new Date(Date.now()-1).toISOString(),sourceRetryGeneration:id(10),sourceVerified:!holdSource&&linked};
  return response;
 };
 ports.files.upload=()=>{throw Error('browser attempted direct S3 upload');};
 let uiFeature=createMorningExpenseIntake(ports);
""")+r"""
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 await uiFeature.actions['morning-expense-files']({files:[new File(['%PDF-1.4 retained progress'],'invoice.pdf',{type:'application/pdf'})]});await settle();
 const saving=uiFeature.actions['morning-expense-save']();
 check(confirms===1,'approval was delayed by remote preflight');
 check(confirmations[0].includes('בדקת')&&!confirmations[0].includes('0123456789'),'approval repeats invoice values');
 await enteredChecks;
 check(fixture.querySelector('[data-expense-progress] [aria-current="step"]')&&fixture.querySelector('.morning-expense-spinner'),'no progress while preflight is held');
 await new Promise(resolve=>setTimeout(resolve,1100));check(!fixture.querySelector('[data-expense-elapsed]').textContent.includes('חלפו 0 '),'elapsed time is frozen');
 check(posts===0&&uploads===0,'network checks already dispatched an expense');
 releaseChecks();await saving;await settle();
 check(posts===1&&uploads===1,'relay flow did not submit once');
 check(!fixture.querySelector('[data-expense-progress] [aria-current]'),'progress resources retained after completion/pending');
 const retry=fixture.querySelector('[data-expense-command="source-retry"]');check(retry&&!retry.disabled,'failed delivery has no controlled recovery');
 retry.click();await settle();check(posts===1&&uploads===2,'file retry created an expense or failed to attach');
 check(!fixture.querySelector('[data-expense-command="status"]'),'verified retry did not complete');
 check(fixture.querySelector('[data-expense-recent] [data-expense-command="source-open"]'),'recent rows lack source icon');
 uiFeature.runtime.dispose();return {immediateApproval:true,visibleProgress:true,relayOnly:true,explicitRetrySameExpense:true,posts,uploads};
})()"""
if __name__=='__main__':
 with BrowserSession(ROOT/'netunim-orders/site','expense-progress') as browser:
  for width in [1440,390]:
   browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
   result=browser.evaluate(SCENARIO,timeout=40)
   assert result['posts']==1 and result['uploads']==2,result
  assert not browser.drain_serious_errors()
  print('PASS immediate approval, progress timer, relay and controlled same-expense retry',result,flush=True)
