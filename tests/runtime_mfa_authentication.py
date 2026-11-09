"""Actual source/bundled security pages in isolated Chromium, synthetic Auth only."""
import json
import subprocess
from browser_harness import BrowserSession, ROOT

AUTH = r"""(()=>{
 const owner='11111111-1111-4111-8111-111111111111',id='33333333-3333-4333-8333-333333333333';
 const factor={id,factor_type:'totp',status:'verified',friendly_name:'<img src=x onerror=window.mfaXss=true>'};
 const jwt=aal=>[btoa('{}'),btoa(JSON.stringify({sub:owner,aal})),'synthetic'].join('.');
 const state=window.mfaFixture={factors:[factor],calls:[],hold:false,entered:false};
 const session=aal=>({user:{id:owner,factors:state.factors},access_token:jwt(aal),refresh_token:'synthetic-refresh',expires_in:3600});
 window.fetch=async(url,init={})=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;state.calls.push({path,method:init.method,body});
  let result;
  if(path.endsWith('/token'))result=session('aal1');
  else if(path.endsWith('/user'))result={id:owner,factors:state.factors};
  else if(path.endsWith('/challenge'))result={id:'44444444-4444-4444-8444-444444444444'};
  else if(path.endsWith('/verify')){
   if(state.hold){state.entered=true;await new Promise(resolve=>{state.release=resolve})}
   state.factors=state.factors.map(f=>({...f,status:'verified'}));result=session('aal2');
  }else if(path.endsWith('/factors')&&init.method==='POST'){
   state.factors=[{...factor,status:'unverified'}];
   result={id,totp:{secret:'SYNTHETIC-ENROLLMENT-SECRET',qr_code:'<svg xmlns="http://www.w3.org/2000/svg" onload="window.mfaXss=true"/>'}};
  }else if(init.method==='DELETE'){state.factors=[];result={id}}
  else throw Error('Unexpected synthetic Auth route: '+path);
  return Response.json(result);
 };
})()"""

FLOW = r"""(async()=>{
 const $=id=>document.getElementById(id),done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
 const until=async(fn)=>{for(let n=0;n<150;n++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('UI did not settle')};
 const idle=()=>until(()=>!$('accountSecurity').hasAttribute('aria-busy'));
 $('securityEmail').value='synthetic@example.test';$('securityPassword').value='synthetic-password';
 $('securityLogin').requestSubmit();await idle();
 check($('securityManage').hidden,'password-only MFA session cannot enter management');
 check($('securityPassword').value==='','password is cleared after password grant');
 check(mfaFixture.calls.length===1,'no factor challenge is sent without a six digit code');
 $('securityLoginCode').value='012345';$('securityLogin').requestSubmit();await idle();
 check(!$('securityManage').hidden,'MFA verified session enters account management');
 check($('securityLoginCode').value==='','used login OTP is cleared');
 check($('securityFactors').textContent.includes('<img')&&!$('securityFactors img'),'factor names render as text');
 const deletions=()=>mfaFixture.calls.filter(call=>call.method==='DELETE').length,before=deletions();
 $('securityFactors').querySelector('button').click();await until(()=>document.querySelector('dialog[open]'));
 check(deletions()===before,'factor deletion waits for local styled confirmation');
 [...document.querySelectorAll('dialog button')].find(button=>button.textContent==='ביטול').click();await idle();
 check(deletions()===before&&!document.querySelector('dialog'),'cancel preserves the factor and closes confirmation');
 $('securityEnroll').click();await idle();
 check(!$('securitySetup').hidden&&$('securitySecret').textContent==='SYNTHETIC-ENROLLMENT-SECRET','enrollment secret appears only during explicit setup');
 check($('securityQr').src.startsWith('data:image/svg+xml'),'QR stays an inert image on this page');
 $('securitySetupCode').value='012345';$('securitySetup').requestSubmit();await idle();
 check($('securitySetup').hidden&&!$('securityQr').hasAttribute('src')&&!$('securitySecret').textContent&&!$('securitySetupCode').value,'successful enrollment clears QR, secret and OTP');
 check(!window.mfaXss,'provider strings cannot execute script');
 check(localStorage.length===0&&sessionStorage.length===0&&(await indexedDB.databases()).length===0,'security page never persists credentials or opens app databases');
 $('securityEnroll').click();await idle();mfaFixture.hold=true;
 $('securitySetupCode').value='012345';$('securitySetup').requestSubmit();await until(()=>mfaFixture.entered);
 dispatchEvent(new Event('pagehide'));mfaFixture.release();await idle();
 check($('securityManage').hidden&&$('securitySetup').hidden&&!$('securitySecret').textContent&&!$('securityQr').hasAttribute('src'),'page close clears secrets and rejects delayed verification publication');
 return done;
})()"""

# CI shards and focused invocations have independent output directories. Always
# build the reviewed source here; another job's dist is never a prerequisite.
subprocess.run(['node',str(ROOT/'tools/production-build.mjs')],cwd=ROOT,check=True)

for app in ('orders','kupa'):
    for mode,site in [('source',ROOT/f'netunim-{app}/site'),('production',ROOT/'dist'/app)]:
        with BrowserSession(site,f'mfa-{app}-{mode}',instrument=False,auto_navigate=False) as browser:
            browser.call('Page.addScriptToEvaluateOnNewDocument',{'source':AUTH})
            browser.url=browser.url.replace('index.html','security.html')
            browser._navigate()
            result=browser.evaluate(FLOW,timeout=15)
            assert not browser.drain_serious_errors()
            print(f'PASS {app} {mode}: {len(result)} MFA lifecycle, inert DOM and non-persistence assertions')
