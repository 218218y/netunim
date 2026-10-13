"""Production Kupa Credit pairing handoff; synthetic loopback, native effects/IDB."""
import json
import os
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;financeAutomation.stop();syncDocument.stopCloudPolling();
 const check=(ok,message)=>{if(!ok)throw Error(message)},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const caseName=__CASE__,tokenKey='netunim_kupa_bank_bridge_token_v1',stamp='2026-10-13T12:00:00.000Z';
 const note={id:'connection-owner-note',content:'retained connection boundary',createdAt:stamp,updatedAt:stamp};state.notes.push(note);
 await storagePersistence.saveState('connection boundary',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const mainBefore=JSON.stringify(await db.load('local:kupa')),sharedBefore=JSON.stringify(await db.load('local:shared-checks')),creditBefore=JSON.stringify(state.creditSync);
 localStorage.setItem(tokenKey,'pairing-A');
 const originalFetch=globalThis.fetch,originalToast=uiStatus.toast,originalConfirm=uiModal.confirmDialog,originalModal=uiModal.modal,originalClick=HTMLAnchorElement.prototype.click;
 const entered=gate(),held=gate(),events=[],forms=[];let writes=0,deletes=0,resets=0,phase='held',replacementForm;
 uiStatus.toast=message=>events.push(String(message));
 HTMLAnchorElement.prototype.click=()=>events.push('download');
 if(caseName==='delete'||caseName==='reset')uiModal.confirmDialog=()=>{entered.resolve();return held.promise};
 if(caseName==='form')uiModal.modal=(...args)=>{forms.push(args[3]);return originalModal(...args)};
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
   throw Error('unexpected connection fixture request '+path);
 };
 cloudTransport.saveFinancePatch=async()=>{writes++;throw Error('unexpected Finance publication')};
 let pending;
 try{
   if(caseName==='status'||caseName==='status-error')pending=credit.queries.refreshStatus({quiet:false});
   else if(caseName==='diagnostic')pending=credit.commands.exportCreditDataDiagnostics();
   else if(caseName==='form'){credit.commands.openCreditConnectionModal();document.getElementById('ccUsername').value='fixture';document.getElementById('ccPassword').value=' fixture password ';pending=forms.at(-1)()}
   else pending=credit.commands[caseName==='delete'?'deleteCreditConnection':'resetCreditSync']('former');
   await entered.promise;phase='replacement';
   if(caseName==='form'){credit.commands.openCreditConnectionModal();replacementForm=document.getElementById('creditConnectionForm')}
   else localStorage.setItem(tokenKey,'pairing-B');
   let drained=false;const drain=credit.runtime.drain().then(()=>{drained=true});await Promise.resolve();check(!drained,'drain abandoned accepted connection work');
   held.resolve(true);await pending;await drain;
   check(deletes===0&&resets===0,'old confirmation targeted replacement pairing');check(writes===0,'connection work authorized Finance write');
   const ui=credit.queries.uiState();
   if(caseName==='form')check(document.getElementById('creditConnectionForm')===replacementForm&&document.getElementById('modalBackdrop').classList.contains('open'),'accepted old save closed replacement native form');
   else check(ui.status===null&&ui.bridgeError==='','former-device status/error published');
   check(!events.includes('download')&&!events.some(message=>message.includes('private former-device')),'former diagnostic or private error escaped');
   if(caseName!=='reset'&&caseName!=='form')check(events.length===0,'stale connection changed presentation');
   check(JSON.stringify(state.creditSync)===creditBefore,'connection boundary changed Credit document');
   check(JSON.stringify(await db.load('local:kupa'))===mainBefore,'connection boundary changed Main journal');
   check(JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'connection boundary changed Shared journal');
   return {pairingBound:true,noForeignEffects:true,noForeignDelete:true,noFinanceWrite:true,journalsRetained:true};
 }finally{held.resolve(true);globalThis.fetch=originalFetch;uiStatus.toast=originalToast;uiModal.confirmDialog=originalConfirm;uiModal.modal=originalModal;HTMLAnchorElement.prototype.click=originalClick;credit.runtime.stop()}
})()"""

for case in ('status', 'status-error', 'diagnostic', 'delete', 'reset', 'form'):
    if os.environ.get('NETUNIM_CONNECTION_CASE') not in (None, case):
        continue
    with BrowserSession(ROOT / 'netunim-kupa/site', 'credit-connection-' + case) as browser:
        result = browser.evaluate(FLOW.replace('__CASE__', json.dumps(case)), timeout=40)
        assert result and all(result.values()), result
        browser._navigate()
        restored = browser.evaluate("""(async()=>{await appReady;return (await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='connection-owner-note')?.content})()""")
        assert restored == 'retained connection boundary', restored
        assert not browser.drain_serious_errors()
        print('PASS native Credit connection ' + case + ': ' + json.dumps(result), flush=True)
