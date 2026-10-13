"""Production Orders local pairing/confirmation/form ownership with native IDB."""
import json
import os
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;finance.runtime.stop();syncDocument.stopPolling();
 const check=(ok,message)=>{if(!ok)throw Error(message)},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const caseName=__CASE__,tokenKey='netunim_kupa_bank_bridge_token_v1',stamp='2026-10-13T16:00:00.000Z';
 const note={id:'orders-connection-owner-note',content:'retained Orders connection boundary',createdAt:stamp,updatedAt:stamp};state.notes.push(note);
 scheduleSave('connection boundary',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
 await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();
 let identity='local';
 if(caseName==='reset'){
   identity='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
   cloudAuth.saveSession({user:{id:identity},access_token:'fixture',expires_at:9999999999});let main=null,shared=null;
   cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;
   cloudTransport.rpcSaveV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
   cloudTransport.rpcSaveSharedChecksV2=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
   await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:identity,intent:'upload-local'});session.storageProtocolBlocked=false;
 }
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const mainBefore=JSON.stringify(await db.load(identity+':orders')),sharedBefore=JSON.stringify(await db.load(identity+':shared-checks')),documentBefore=JSON.stringify(checksSession.kupaCloudReadState);
 localStorage.setItem(tokenKey,'pairing-A');
 const originalFetch=globalThis.fetch,originalToast=uiStatus.toast,originalConfirm=uiModal.confirmDialog,originalClick=HTMLAnchorElement.prototype.click;
 const entered=gate(),held=gate(),events=[];let deletes=0,resets=0,phase='held',replacementForm;
 uiStatus.toast=message=>events.push(String(message));HTMLAnchorElement.prototype.click=()=>events.push('download');
 if(caseName==='delete'||caseName==='reset')uiModal.confirmDialog=()=>{entered.resolve();return held.promise};
 globalThis.fetch=async(url,options)=>{
   const path=new URL(String(url)).pathname;
   check(String(options.headers.Authorization).includes('pairing-A')||phase==='replacement','unexpected replacement Bridge request');
   if(path==='/v2/credit/profiles'){if(options.method==='DELETE')deletes++;if(caseName==='form'){entered.resolve();await held.promise}return new Response('{}')}
   if(path==='/v2/credit/reset'){resets++;return new Response('{}')}
   if(path==='/v2/credit/status'){
     if(caseName==='status'||caseName==='status-error'){entered.resolve();await held.promise;if(caseName==='status-error')return new Response(JSON.stringify({ok:false,message:'private former-device error',code:'fixture'}),{status:400})}
     return new Response(JSON.stringify({bridgeVersion:73,contractVersion:2,profiles:[{profileId:'former',ownerLabel:'private former-device profile'}]}));
   }
   if(path==='/v2/credit/data-diagnostics'){entered.resolve();await held.promise;return new Response(JSON.stringify({available:true,filename:'former.json',data:{private:'former-device'},cardCount:1}))}
   throw Error('unexpected Orders connection request '+path);
 };
 const action=(name,id='')=>uiActions[name]({dataset:{clickArg0:id}},{preventDefault:()=>{},stopPropagation:()=>{}});
 try{
   if(caseName==='status'||caseName==='status-error'){ui.currentView='kupa';ui.kupaSubView='credit';finance.presentation.renderKupa()}
   else if(caseName==='form'){action('open-orders-credit-connection');document.getElementById('ordersCcUsername').value='fixture';document.getElementById('ordersCcPassword').value=' fixture password ';action('save-orders-credit-connection')}
   else action(caseName==='delete'?'delete-orders-credit-connection':caseName==='reset'?'reset-orders-credit-sync':'export-orders-credit-data-diagnostics','former');
   await Promise.race([entered.promise,new Promise((_,reject)=>globalThis.addEventListener('unhandledrejection',event=>reject(event.reason),{once:true}))]);phase='replacement';
   if(caseName==='form'){action('open-orders-credit-connection');replacementForm=document.getElementById('ordersCreditConnectionForm')}
   else if(caseName==='dispose'){check(finance.runtime.dispose()===true&&finance.runtime.dispose()===false,'Finance close is not idempotent')}
   else localStorage.setItem(tokenKey,'pairing-B');
   check(finance.runtime.isPending(),'accepted work is not pending');
   let drained=false;const drain=finance.runtime.drain().then(()=>{drained=true});await Promise.resolve();check(!drained,'Finance drain abandoned accepted local work');
   held.resolve(true);await drain;
   check(!finance.runtime.isPending(),'accepted work did not finish');check(deletes===0&&resets===0,'old confirmation targeted replacement pairing');
   if(caseName==='form')check(document.getElementById('ordersCreditConnectionForm')===replacementForm&&document.getElementById('modalBackdrop').classList.contains('open'),'old save closed replacement native form');
   else if(caseName!=='dispose'){const readout=finance.queries.snapshot();check(readout.creditStatus===null&&readout.creditBridgeError==='','former-device status or error published')}
   check(!events.includes('download')&&!events.some(message=>message.includes('private former-device')),'former-device details escaped');
   if(caseName!=='form')check(events.length===0,'stale connection changed presentation');
   check(JSON.stringify(checksSession.kupaCloudReadState)===documentBefore,'connection operation changed Finance document');
   check(JSON.stringify(await db.load(identity+':orders'))===mainBefore,'connection boundary changed Main journal');
   check(JSON.stringify(await db.load(identity+':shared-checks'))===sharedBefore,'connection boundary changed Shared journal');
   return {pairingBound:true,acceptedWorkDrained:true,noForeignEffects:true,noForeignDelete:true,journalsRetained:true};
 }finally{held.resolve(true);cloudAuth.saveSession(null);globalThis.fetch=originalFetch;uiStatus.toast=originalToast;uiModal.confirmDialog=originalConfirm;HTMLAnchorElement.prototype.click=originalClick;finance.runtime.stop()}
})()"""

for case in ('status', 'status-error', 'diagnostic', 'delete', 'reset', 'form', 'dispose'):
    if os.environ.get('NETUNIM_ORDERS_CONNECTION_CASE') not in (None, case):
        continue
    with BrowserSession(ROOT / 'netunim-orders/site', 'orders-credit-connection-' + case) as browser:
        result = browser.evaluate(FLOW.replace('__CASE__', json.dumps(case)), timeout=40)
        assert result and all(result.values()), result
        browser._navigate()
        restored = browser.evaluate("""(async()=>{await appReady;return (await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='orders-connection-owner-note')?.content})()""")
        assert restored == 'retained Orders connection boundary', restored
        errors = browser.drain_serious_errors()
        assert not errors, errors
        print('PASS native Orders Credit connection ' + case + ': ' + json.dumps(result), flush=True)
