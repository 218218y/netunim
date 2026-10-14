"""Production Kupa local Bank connection ownership, native forms and durable IDB."""
import json
import os
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;financeAutomation.stop();syncDocument.stopCloudPolling();bank.runtime.stop();
 const check=(ok,message)=>{if(!ok)throw Error(message)},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const caseName=__CASE__,tokenKey='netunim_kupa_bank_bridge_token_v1';
 const note={id:'kupa-bank-connection-note',content:'retained local connection boundary'};state.notes.push(note);
 await storagePersistence.saveState('connection boundary',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const mainBefore=JSON.stringify(await db.load('local:kupa')),sharedBefore=JSON.stringify(await db.load('local:shared-checks')),modelBefore=JSON.stringify(state);
 localStorage.setItem(tokenKey,'pairing-A');
 const originalFetch=globalThis.fetch,originalToast=uiStatus.toast,originalClick=HTMLAnchorElement.prototype.click;
 const entered=gate(),held=gate(),events=[];let configures=0,deletes=0,selections=0,phase=['status','status-error'].includes(caseName)?'held':'warming',replacementForm;
 uiStatus.toast=message=>events.push(String(message));HTMLAnchorElement.prototype.click=()=>events.push('download');
 globalThis.fetch=async(url,options)=>{
   const path=new URL(String(url)).pathname;check(String(options.headers.Authorization).includes('pairing-A')||phase==='replacement','unexpected replacement Bank request');
   if(path==='/status'){
     if(phase==='held'&&['status','status-error'].includes(caseName)){entered.resolve();await held.promise;if(caseName==='status-error')return new Response(JSON.stringify({ok:false,message:'private former-device status error'}),{status:400})}
     return new Response(JSON.stringify({bridgeVersion:74,configured:true,businessBranchNumber:'0012',businessAccountNumber:'0034'}));
   }
   if(path==='/credentials'){
     if(options.method==='DELETE'){deletes++;entered.resolve();await held.promise;return new Response('{}')}
     configures++;check(JSON.parse(options.body).password===' fixture password ','password whitespace changed');check(JSON.parse(options.body).businessAccountNumber==='0034','credential account leading zeroes changed');entered.resolve();await held.promise;
     if(caseName==='write-error')return new Response(JSON.stringify({ok:false,message:'private former-device vault error'}),{status:400});
     return new Response(JSON.stringify({businessBranchNumber:'0012',businessAccountNumber:'0034'}));
   }
   if(path==='/account-selection'){selections++;check(JSON.parse(options.body).accountNumber==='0034','selection account leading zeroes changed');entered.resolve();await held.promise;return new Response('{}')}
   if(path==='/bank/diagnostics'){entered.resolve();await held.promise;return new Response(JSON.stringify({available:true,filename:'former.json',data:{private:'former-device'},transactionCount:1}))}
   throw Error('unexpected Kupa Bank request '+path);
 };
 const action=(name,args=[])=>uiActions[name]({dataset:Object.fromEntries(args.map((value,index)=>['clickArg'+index,value]))},{preventDefault:()=>{},stopPropagation:()=>{}});
 try{
   ui.currentPage='bank';bank.presentation.renderBank();
   if(phase==='warming'){await bank.runtime.drain();await Promise.resolve();phase='held';events.length=0}
   if(['configure','write-error','form-replaced','stale-form'].includes(caseName)){
     check(document.getElementById('bankBridgeCredentialsForm'),'native Bank form missing');document.getElementById('bankUserCodeInput').value='fixture';document.getElementById('bankPasswordInput').value=' fixture password ';
     if(caseName==='stale-form'){localStorage.setItem(tokenKey,'pairing-B');phase='replacement'}
     action('configure-bank-bridge');if(caseName==='stale-form')entered.resolve();
   }else if(caseName==='delete')action('delete-bank-bridge-credentials');
   else if(caseName==='select')action('select-bank-bridge-account',['business','0012','0034']);
   else if(!['status','status-error'].includes(caseName))action('export-bank-cheque-diagnostics');
   await entered.promise;phase='replacement';
   if(caseName==='form-replaced'){bank.presentation.renderBank();replacementForm=document.getElementById('bankBridgeCredentialsForm');replacementForm.querySelector('#bankUserCodeInput').value='replacement draft'}
   else if(caseName==='dispose')check(bank.runtime.dispose()===true&&bank.runtime.dispose()===false,'Bank disposal is not idempotent');
   else localStorage.setItem(tokenKey,'pairing-B');
   if(caseName!=='stale-form')check(bank.runtime.isPending(),'accepted Bank work is not pending');
   let drained=false;const drain=bank.runtime.drain().then(()=>{drained=true});await Promise.resolve();if(caseName!=='stale-form')check(!drained,'Bank drain abandoned an accepted request');
   held.resolve();await drain;check(!bank.runtime.isPending(),'accepted Bank work did not settle');
   check(configures===(['configure','write-error','form-replaced'].includes(caseName)?1:0),'stale form configured a replacement Bridge');check(deletes===(caseName==='delete'?1:0),'unexpected deletion');check(selections===(caseName==='select'?1:0),'unexpected selection');
   if(caseName==='form-replaced')check(document.getElementById('bankBridgeCredentialsForm')===replacementForm&&replacementForm.querySelector('#bankUserCodeInput').value==='replacement draft','late save replaced a native form or erased its draft');
   else if(caseName!=='dispose'){const value=bank.queries.snapshot();check(!value.checked&&!value.configured&&value.accountNumber===''&&value.availabilityError===''&&value.lastError==='','former-device state published')}
   check(!events.includes('download')&&!events.some(message=>message.includes('private former-device')),'former-device information escaped');if(caseName!=='form-replaced')check(events.length===0,'stale Bank command published a notification');
   check(JSON.stringify(state)===modelBefore,'local connection changed the business model');check(JSON.stringify(await db.load('local:kupa'))===mainBefore,'local connection changed Main journal');check(JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'local connection changed Shared journal');
   return {pairingBound:true,acceptedWorkDrained:true,noForeignEffects:true,nativeFormOwned:true,journalsRetained:true};
 }finally{held.resolve();globalThis.fetch=originalFetch;uiStatus.toast=originalToast;HTMLAnchorElement.prototype.click=originalClick;bank.runtime.stop()}
})()"""

for case in ('status', 'status-error', 'diagnostic', 'configure', 'write-error', 'delete',
             'select', 'dispose', 'form-replaced', 'stale-form'):
    if os.environ.get('NETUNIM_KUPA_BANK_CONNECTION_CASE') not in (None, case):
        continue
    with BrowserSession(ROOT / 'netunim-kupa/site', 'kupa-bank-connection-' + case) as browser:
        result = browser.evaluate(FLOW.replace('__CASE__', json.dumps(case)), timeout=40)
        assert result and all(result.values()), result
        browser._navigate()
        restored = browser.evaluate("""(async()=>{await appReady;return (await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='kupa-bank-connection-note')?.content})()""")
        assert restored == 'retained local connection boundary', restored
        errors = browser.drain_serious_errors()
        assert not errors, errors
        print('PASS native Kupa Bank connection ' + case + ': ' + json.dumps(result), flush=True)
