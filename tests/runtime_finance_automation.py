"""Real app composition: held Bridge status across access loss and reconnect."""
import json

from browser_harness import BrowserSession, ROOT


FLOW = r"""(async()=>{
 const assert=(value,message)=>{if(!value)throw new Error(message)};
 const waitFor=async predicate=>{for(let i=0;i<250;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('finance automation condition timed out')};
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const realFetch=globalThis.fetch,oldOnline=Object.getOwnPropertyDescriptor(navigator,'onLine');
 const originalState=structuredClone(state),originalMode=session.connectionMode,originalReady=session.backendReady,originalAuth=session.supaSession;
 let online=true,statusCalls=0,providerCalls=0;
 const held=[];
 financeAutomation.stop();syncDocument.stopCloudPolling();
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing-token');
 localStorage.setItem('netunim_kupa_bank_auto_daily_v1','0');
 localStorage.setItem('netunim_kupa_credit_auto_daily_v1','1');
 localStorage.removeItem('netunim_kupa_credit_auto_attempt_v1');
 Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>online});
 globalThis.fetch=(url,options)=>{
   if(String(url).startsWith('http://127.0.0.1:8765/v2/credit/status')){statusCalls++;const gate=deferred();held.push(gate);return gate.promise}
   if(String(url).startsWith('http://127.0.0.1:8765/')){providerCalls++;throw new Error('unexpected provider entry')}
   return realFetch(url,options);
 };
 const reply=()=>new Response(JSON.stringify({ok:true,bridgeVersion:73,contractVersion:2,profiles:[{profileId:'fixture'}]}));
 try{
   assert(tab.primaryTab&&storageRecovery.isReady(),'fixture requires primary recovered storage');
   session.connectionMode=CASE==='owner'||CASE==='logout'?'supabase':'local';session.backendReady=true;
   if(session.connectionMode==='supabase')session.supaSession={user:{id:'fixture-owner-A'}};
   state=normalizeState({...state,creditSync:{version:4,syncedAt:'2020-01-01T00:00:00Z',profiles:[],errors:[]}});
   const before=JSON.stringify(state),headBefore=await mainStorageV2.cloudState();
   const one=financeAutomation.start(),two=financeAutomation.start();assert(one===two,'parallel start must join one operation');
   await waitFor(()=>statusCalls===1);
   if(CASE==='offline'){online=false;window.dispatchEvent(new Event('offline'))}
   if(CASE==='owner')session.supaSession={user:{id:'fixture-owner-B'}};
   if(CASE==='secondary')tab.primaryTab=false;
   if(CASE==='logout')assert(uiCloud.logoutSupabase()===true,'actual UI logout must stop automation');
   held[0].resolve(reply());await one;
   assert(providerCalls===0,'lost access must stop before provider entry');
   assert(domainsCreditController.creditSyncUiState().autoTimer===null,'lost access must retain no credit timer');
   assert(JSON.stringify(state)===before,'cancelled preparation must preserve state');
   const headAfter=await mainStorageV2.cloudState();assert(headAfter.seq===headBefore.seq,'cancelled preparation must append no journal record');
   if(CASE==='offline'){
     online=true;window.dispatchEvent(new Event('online'));await waitFor(()=>statusCalls===2);
     financeAutomation.stop();held[1].resolve(reply());await waitFor(()=>domainsCreditController.creditSyncUiState().autoTimer===null);
     assert(providerCalls===0,'reconnect must respect a later stop');
   }
   return {singleStatus:true,noProvider:true,noTimer:true,stateRetained:true,journalRetained:true,reconnect:CASE!=='offline'||statusCalls===2};
 }finally{
   financeAutomation.stop();for(const gate of held)gate.resolve(reply());
   globalThis.fetch=realFetch;tab.primaryTab=true;session.connectionMode=originalMode;session.backendReady=originalReady;session.supaSession=originalAuth;state=originalState;
   if(oldOnline)Object.defineProperty(navigator,'onLine',oldOnline);else delete navigator.onLine;
 }
})()"""

for case in ('offline', 'owner', 'secondary', 'logout'):
    with BrowserSession(ROOT / 'netunim-kupa/site', 'finance-automation-' + case) as browser:
        result = browser.evaluate(FLOW.replace('CASE', json.dumps(case)), timeout=30)
        assert result and all(result.values()), result
        print('PASS Kupa finance automation ' + case + ': ' + json.dumps(result))
        errors = browser.drain_serious_errors()
        assert not errors, errors
