"""Real backup composition, native input/Blob resources and V2 journals; no user files."""
import argparse
import json
from browser_harness import BrowserSession, ROOT

parser=argparse.ArgumentParser()
parser.add_argument('--app',choices=('orders','kupa'))
parser.add_argument('--phase',choices=('read-dispose','read-account','confirmation','success','downloads'),action='append')
args=parser.parse_args()

FLOW=r"""(async()=>{
 await appReady;const app=__APP__,phase=__PHASE__,kupa=app==='kupa',check=(ok,message)=>{if(!ok)throw Error(message)};
 if(kupa){syncDocument.stopCloudPolling();bank.runtime.stop();credit.runtime.stop()}else{syncDocument.stopPolling();finance.runtime.stop()}
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
 const note={id:'backup-resource-note',content:'original durable value'};state.notes.push(note);
 const options={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,record:note,mode:'insert',index:state.notes.length-1}]};
 if(kupa)await storagePersistence.saveState('fixture',options);else storagePersistence.scheduleSave('fixture',options);
 await mainStorageV2.commitPromise;if(!kupa)storagePersistence.runtime.cancelPending();await storagePersistence.runtime.drain();
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const raw=async()=>JSON.stringify({main:await db.load('local:'+app),shared:await db.load('local:shared-checks')}),before=await raw();
 const target=structuredClone(state);target.notes.find(row=>row.id===note.id).content='restored file content';
 const payload=kupa?(await import('./assets/js/state/serialization.js')).payloadFromState(target,session.dbRevision):stateSelectors.prepareState(target),text=JSON.stringify(payload);
 const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}},held=deferred(),entered=deferred(),confirmed=deferred();
 const nativeInputClick=HTMLInputElement.prototype.click,nativeAnchorClick=HTMLAnchorElement.prototype.click,nativeCreate=URL.createObjectURL,nativeRevoke=URL.revokeObjectURL;
 const urls=new Set(),inputs=new Set();let selected=null;
 HTMLInputElement.prototype.click=function(){if(this.type==='file'){selected=this;inputs.add(this);return}return nativeInputClick.call(this)};
 HTMLAnchorElement.prototype.click=function(){};
 URL.createObjectURL=function(blob){const href=nativeCreate.call(this,blob);urls.add(href);return href};
 URL.revokeObjectURL=function(href){urls.delete(href);return nativeRevoke.call(this,href)};
 const sessionSave=kupa?cloudAuth.storeSupaSession:cloudAuth.saveSession;
 const file={name:'synthetic-backup.json',size:text.length,text:async()=>{entered.resolve();if(phase.startsWith('read-'))await held.promise;return text}};
 async function start(){
   const selecting=kupa?uiBackup.beginRestoreBackup():uiBackup.beginJsonRestore();check(selected,'Backup did not create native input');
   Object.defineProperty(selected,'files',{value:[file],configurable:true});selected.dispatchEvent(new Event('change'));
   return await selecting;
 }
 try{
   if(phase==='downloads'){
     for(let i=0;i<50;i++){if(kupa)uiBackup.downloadJsonBackup();else uiBackup.exportJson();uiBackup.runtime.cancelPending();check(!urls.size,'download URL retained after cutover')}
     if(!kupa){const picking=uiBackup.beginJsonRestore();check(selected.isConnected,'picker missing');uiBackup.runtime.cancelPending();await picking;check(!selected.isConnected,'picker retained after cancellation')}
     check(await raw()===before,'download ownership changed durable data');
     return {phase,cycles:50,urls:urls.size};
   }
   if(phase.startsWith('read-')){
     const reading=start();await entered.promise;
     if(phase==='read-dispose')uiBackup.runtime.dispose();else sessionSave({user:{id:'replacement-account'},access_token:'synthetic',expires_at:9999999999});
     let drained=false;const drain=uiBackup.runtime.drain().then(()=>drained=true);for(let i=0;i<20;i++)await Promise.resolve();
     check(!drained&&uiBackup.runtime.isPending(),'accepted file read abandoned before bytes settled');
     held.resolve();await reading;await drain;
     check(!ui.pendingJsonRestore&&!document.querySelector('.backup-json-preview'),'obsolete file published a restore preview');
     check(await raw()===before&&state.notes.find(row=>row.id===note.id).content===note.content,'obsolete file changed visible or durable data');
   }else{
     uiModal.confirmDialog=async()=>{confirmed.resolve();if(phase==='confirmation')await held.promise;return true};
     let restoring;
     if(kupa)restoring=start();else{await start();check(ui.pendingJsonRestore,'Orders preview missing');restoring=uiBackup.applyJsonRestore()}
     await confirmed.promise;
     if(phase==='confirmation'){
       uiBackup.runtime.dispose();let drained=false;const drain=uiBackup.runtime.drain().then(()=>drained=true);for(let i=0;i<20;i++)await Promise.resolve();
       check(!drained,'accepted restore confirmation escaped drain');held.resolve();await restoring;await drain;
       check(await raw()===before,'disposed confirmation wrote a journal');
     }else{
       await restoring;await uiBackup.runtime.drain();
       const recovered=await mainStorageV2.recoverForOwner({intent:'load-account'});
       check(state.notes.find(row=>row.id===note.id).content==='restored file content'&&recovered.state.notes.find(row=>row.id===note.id).content==='restored file content','valid file import lost committed content: '+JSON.stringify({target:payload.notes,visible:state.notes,recovered:recovered.state.notes,pending:!!ui.pendingJsonRestore}));
     }
   }
   check([...inputs].every(input=>!input.isConnected),'native input retained');uiBackup.runtime.dispose();check(!urls.size,'disposed backup retained URL');
   return {phase,drained:true,retained:phase!=='success',restored:phase==='success'};
 }finally{
   uiBackup.runtime.dispose();HTMLInputElement.prototype.click=nativeInputClick;HTMLAnchorElement.prototype.click=nativeAnchorClick;URL.createObjectURL=nativeCreate;URL.revokeObjectURL=nativeRevoke;
 }
})()"""

for app in (args.app,) if args.app else ('orders','kupa'):
    for phase in args.phase or ('read-dispose','read-account','confirmation','success','downloads'):
        with BrowserSession(ROOT/f'netunim-{app}/site',f'backup-resources-{app}-{phase}') as browser:
            result=browser.evaluate(FLOW.replace('__APP__',json.dumps(app)).replace('__PHASE__',json.dumps(phase)),timeout=45)
            errors=browser.drain_serious_errors()
            assert not errors,errors
            print('PASS native backup resources '+app+': '+json.dumps(result),flush=True)
