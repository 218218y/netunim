"""Production Orders Bank pairing, native form/confirmation and IDB retention."""
import json
import os
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;finance.runtime.stop();syncDocument.stopPolling();
 const check=(ok,message)=>{if(!ok)throw Error(message)},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const caseName=__CASE__,tokenKey='netunim_kupa_bank_bridge_token_v1',stamp='2026-10-13T19:00:00.000Z';
 const note={id:'orders-bank-connection-note',content:'retained Bank connection boundary',createdAt:stamp,updatedAt:stamp};state.notes.push(note);
 scheduleSave('bank connection boundary',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
 await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const mainBefore=JSON.stringify(await db.load('local:orders')),sharedBefore=JSON.stringify(await db.load('local:shared-checks')),documentBefore=JSON.stringify(checksSession.kupaCloudReadState);
 localStorage.setItem(tokenKey,'pairing-A');
 const originalFetch=globalThis.fetch,originalToast=uiStatus.toast,originalConfirm=uiModal.confirmDialog,originalClick=HTMLAnchorElement.prototype.click;
 const entered=gate(),held=gate(),events=[];let deletes=0,configures=0,selections=0,phase=['status','status-error'].includes(caseName)?'held':'warming',replacementForm;
 uiStatus.toast=message=>events.push(String(message));HTMLAnchorElement.prototype.click=()=>events.push('download');
 if(['delete','dispose-confirm'].includes(caseName))uiModal.confirmDialog=()=>{entered.resolve();return held.promise};
 globalThis.fetch=async(url,options)=>{
   const path=new URL(String(url)).pathname;
   check(String(options.headers.Authorization).includes('pairing-A')||phase==='replacement','unexpected replacement Bank request');
   if(path==='/status'){
     if(phase==='held'&&['status','status-error'].includes(caseName)){entered.resolve();await held.promise;if(caseName==='status-error')return new Response(JSON.stringify({ok:false,message:'private former-device status error',code:'fixture'}),{status:400})}
     return new Response(JSON.stringify({bridgeVersion:74,configured:true,businessBranchNumber:'0012',businessAccountNumber:'0034'}));
   }
   if(path==='/credentials'){
     if(options.method==='DELETE'){deletes++;return new Response('{}')}
     configures++;check(JSON.parse(options.body).password===' fixture password ','password whitespace changed');entered.resolve();await held.promise;
     if(caseName==='write-error')return new Response(JSON.stringify({ok:false,message:'private former-device vault error',code:'fixture'}),{status:400});
     return new Response(JSON.stringify({configured:true,businessBranchNumber:'0012',businessAccountNumber:'0034'}));
   }
   if(path==='/account-selection'){selections++;check(JSON.parse(options.body).accountNumber==='0034','leading zeroes changed');entered.resolve();await held.promise;return new Response('{}')}
   if(path==='/bank/diagnostics'){entered.resolve();await held.promise;return new Response(JSON.stringify({available:true,filename:'former.json',data:{private:'former-device'},transactionCount:1}))}
   throw Error('unexpected Orders Bank connection request '+path);
 };
 const action=(name,args=[])=>uiActions[name]({dataset:Object.fromEntries(args.map((value,index)=>['clickArg'+index,value]))},{preventDefault:()=>{},stopPropagation:()=>{}});
 try{
   ui.currentView='kupa';ui.kupaSubView='bank';finance.presentation.renderKupa();
   if(phase==='warming'){await finance.runtime.drain();await Promise.resolve();phase='held';events.length=0}
   if(['delete','dispose-confirm'].includes(caseName))action('delete-orders-bank-credentials');
   else if(['configure','write-error','form-replaced','stale-form'].includes(caseName)){
     check(document.getElementById('ordersBankCredentialsForm'),'native Bank form missing');document.getElementById('ordersBankUserCode').value='fixture';document.getElementById('ordersBankPassword').value=' fixture password ';
     if(caseName==='stale-form'){localStorage.setItem(tokenKey,'pairing-B');phase='replacement'}
     action('configure-orders-bank');if(caseName==='stale-form')entered.resolve();
   }else if(caseName==='select')action('select-orders-bank-account',['business','0012','0034']);
   else if(!['status','status-error'].includes(caseName))action('export-orders-bank-cheque-diagnostics');
   await Promise.race([entered.promise,new Promise((_,reject)=>globalThis.addEventListener('unhandledrejection',event=>reject(event.reason),{once:true}))]);phase='replacement';
   if(caseName==='form-replaced'){finance.presentation.renderKupa();replacementForm=document.getElementById('ordersBankCredentialsForm')}
   else if(['dispose','dispose-confirm'].includes(caseName))check(finance.runtime.dispose()===true&&finance.runtime.dispose()===false,'Finance disposal is not idempotent');
   else localStorage.setItem(tokenKey,'pairing-B');
   if(caseName!=='stale-form')check(finance.runtime.isPending(),'accepted Bank work is not pending');
   let drained=false;const drain=finance.runtime.drain().then(()=>{drained=true});await Promise.resolve();if(caseName!=='stale-form')check(!drained,'Finance drain abandoned Bank requests or confirmation');
   held.resolve(true);await drain;check(!finance.runtime.isPending(),'accepted Bank work did not finish');
   check(deletes===0,'old Bank confirmation deleted replacement credentials');check(configures===(['configure','write-error','form-replaced'].includes(caseName)?1:0),'stale form configured a replacement Bridge');check(selections===(caseName==='select'?1:0),'unexpected account selection');
   if(caseName==='form-replaced')check(document.getElementById('ordersBankCredentialsForm')===replacementForm,'late save rerendered a replacement native form');
   else if(!['dispose','dispose-confirm'].includes(caseName)){const value=finance.queries.snapshot();check(value.bankStatus===null&&value.bankBridgeError===''&&value.bankError==='','former-device Bank state published')}
   check(!events.includes('download')&&!events.some(message=>message.includes('private former-device')),'former-device Bank information escaped');if(caseName!=='form-replaced')check(events.length===0,'stale Bank command changed presentation');
   check(JSON.stringify(checksSession.kupaCloudReadState)===documentBefore,'local connection changed Finance document');check(JSON.stringify(await db.load('local:orders'))===mainBefore,'local connection changed Main journal');check(JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'local connection changed Shared journal');
   return {pairingBound:true,acceptedWorkDrained:true,noForeignEffects:true,noForeignDelete:true,nativeFormOwned:true,journalsRetained:true};
 }finally{held.resolve(true);globalThis.fetch=originalFetch;uiStatus.toast=originalToast;uiModal.confirmDialog=originalConfirm;HTMLAnchorElement.prototype.click=originalClick;finance.runtime.stop()}
})()"""

for case in ('status', 'status-error', 'diagnostic', 'delete', 'dispose', 'dispose-confirm',
             'configure', 'select', 'write-error', 'form-replaced', 'stale-form'):
    if os.environ.get('NETUNIM_ORDERS_BANK_CONNECTION_CASE') not in (None, case):
        continue
    with BrowserSession(ROOT / 'netunim-orders/site', 'orders-bank-connection-' + case) as browser:
        result = browser.evaluate(FLOW.replace('__CASE__', json.dumps(case)), timeout=40)
        assert result and all(result.values()), result
        browser._navigate()
        restored = browser.evaluate("""(async()=>{await appReady;return (await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='orders-bank-connection-note')?.content})()""")
        assert restored == 'retained Bank connection boundary', restored
        errors = browser.drain_serious_errors()
        assert not errors, errors
        print('PASS native Orders Bank connection ' + case + ': ' + json.dumps(result), flush=True)
