"""Native CORS behavior and automatic intake; all provider replies synthetic."""
import time
from browser_harness import BrowserSession, ROOT
from runtime_morning_expense_local import PREFIX

SCENARIO = PREFIX.replace(' let uiFeature=createMorningExpenseIntake(ports);',r"""
 let polls=0,holdProof=false,uploadFails=false;
 const originalRequest=ports.request;
 ports.request=async(action,body,check)=>{
   if(action==='upload_status'){polls++;if(!holdProof&&polls>=3)linked=true;}
   return originalRequest(action,body,check);
 };
 ports.files.upload=async(...args)=>{const sent=await upload(...args);if(uploadFails)throw TypeError('lost reply');return {...sent,accepted:false};};
 ports.sourceCompletion=args=>completeExpenseSource({...args,delays:[0,0,0,0]});
 let uiFeature=createMorningExpenseIntake(ports);
""")+r"""
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 const bytes=new TextEncoder().encode('%PDF-1.4 automatic intake');
 await uiFeature.actions['morning-expense-files']({files:[new File([bytes],'first.pdf',{type:'application/pdf'}),new File([bytes,'2'],'second.pdf',{type:'application/pdf'})]});await settle();
 click('save');click('save');await settle();
 check(posts===1&&uploads===1&&polls===3,'save/upload/verification were not one guarded sequence');
 check(!requests.some(r=>r.action==='upload_ack'),'opaque reply was acknowledged as accepted');
 check(!fixture.querySelector('[data-expense-command="status"]')&&fixture.querySelector('.morning-expense-source>b').textContent==='second.pdf','did not automatically advance after proof');
 check(fixture.querySelector('[data-expense-field="number"]').value==='0123456789','next PDF did not automatically fill');
 linked=false;polls=0;holdProof=true;serverFileState='not_started';uploadFails=true;
 click('save');await settle();check(posts===2&&uploads===2,'lost reply was replayed');
 check(fixture.querySelector('.morning-expense-source>b').textContent==='second.pdf'&&fixture.querySelector('[data-expense-command="next"]').disabled,'pending source advanced');
 check(fixture.textContent.includes('נשארנו בחשבונית זו'),'pending state not explained');
 holdProof=false;click('file-status');await settle();check(posts===2&&uploads===2&&!fixture.querySelector('[data-expense-command="status"]'),'read-only recovery failed or replayed');
 check(!fixture.querySelector('.morning-expense-source>b'),'completed final source was not released');
 uiFeature.runtime.dispose();return {posts,uploads,automaticAdvance:true,uncertainRecoveredWithoutReplay:true};
})()"""

def pause(browser):
    until=time.monotonic()+15
    while time.monotonic()<until:
        browser.call('Runtime.evaluate',{'expression':'true'})
        for event in browser.events:
            if event.get('method')=='Fetch.requestPaused':
                browser.events.remove(event)
                return event['params']
        time.sleep(.02)
    raise AssertionError('synthetic form did not reach the native transport')

if __name__=='__main__':
    with BrowserSession(ROOT/'netunim-orders/site','expense-completion') as browser:
        for width in [1440,390]:
            browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            result=browser.evaluate(SCENARIO,timeout=45)
            assert result['posts']==2 and result['uploads']==2,result
        browser.call('Fetch.enable',{'patterns':[{'urlPattern':'https://s3.eu-west-1.amazonaws.com/file-upload-service-uploaded','requestStage':'Request'}]})
        browser.evaluate(r"""(async()=>{
          const {uploadExpenseFile,validateExpenseFile}=await import('./assets/js/platform/morning-expense-files.js');
          const selected=await validateExpenseFile(new File(['%PDF-1.4 native synthetic'],'native.pdf',{type:'application/pdf'}));
          globalThis.nativeForm=uploadExpenseFile({url:'https://s3.eu-west-1.amazonaws.com/file-upload-service-uploaded',fields:{key:'synthetic'},maxFileSize:100,expiresAt:Date.now()+50000},selected,()=>{});
        })()""")
        event=pause(browser)
        assert event['request']['method']=='POST',event
        browser.call('Fetch.fulfillRequest',{'requestId':event['requestId'],'responseCode':204,'responseHeaders':[]})
        assert browser.evaluate('nativeForm')=={'accepted':False,'fileLinked':False}
        browser.call('Fetch.disable',{})
        assert not browser.drain_serious_errors()
        print('PASS native opaque S3 form, automatic source verification/advance, pending stop and no replay',result,flush=True)
