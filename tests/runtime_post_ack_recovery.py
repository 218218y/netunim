"""Native IDB: committed ACK/late edits and guarded pending recovery.

All normal cases use synthetic records and a fake remote, in disposable
profiles. --private-snapshot is an operator-only replay of a saved read-only
capture; it never sends its data to Supabase or writes to the user's browser.
"""
import argparse,json,subprocess,time
from pathlib import Path
from sync_document_fixture import evaluate_sync
from browser_harness import BrowserSession,ROOT

SETUP=r"""
const app=__APP__,phase=__PHASE__,clone=structuredClone,noop=()=>{},check=(value,message)=>{if(!value)throw Error(message)};
const {INITIAL_STATE}=await import('./assets/js/state/constants.js'),{createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js'),{createStorageJournal}=await import('./assets/js/shared/storage-journal.js'),{createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
const {createStorageBrowser}=await import('./assets/js/storage/browser.js'),{createSyncDocument}=await import('./assets/js/sync/document.js'),{createSyncMerge}=await import('./assets/js/sync/merge.js'),{equalSyncJson}=await import('./assets/js/shared/cloud-sync.js');
const {createStateNormalization}=await import(app==='kupa'?'./assets/js/composition/state-normalization.js':'./assets/js/state/normalization.js');
const model={state:clone(INITIAL_STATE)},session={localGeneration:0,cloudRevision:10,dbRevision:10,connectionMode:'supabase',backendReady:true,serverInfo:{}},files={},tab={primaryTab:true};
const normalization=createStateNormalization({model,externalWorkbooks:true});
const project=state=>{const next=app==='kupa'?normalization.prepareKupaCloudState(state):clone(state);delete next.checks;delete next._meta;return next};
model.state=normalization.normalizeState(model.state);
const db=createStorageJournalDb(),wrapped={...db},calls=[],statuses=[],recoveryObservations=[];let owner='post-ack-native',loginEpoch=1,onAck=null,onRecovery=null,remoteRow=null;
const originalError=console.error;console.error=(...args)=>{recoveryObservations.push({errors:args.filter(value=>value instanceof Error).map(value=>value.message)});originalError(...args)};
wrapped.acknowledge=async(...args)=>{await db.acknowledge(...args);const callback=onAck;onAck=null;if(callback)await callback()};
wrapped.commitCloudRecovery=async(...args)=>{if(onRecovery)await onRecovery();return db.commitCloudRecovery(...args)};
const options={app,owner:()=>owner,primary:()=>tab.primaryTab,mode:()=> 'primary',validate:state=>check(Array.isArray(state.notes),'notes required'),
  prepareCheckpoint:app==='kupa'?normalization.prepareKupaStorageState:clone,prepareOperation:app==='kupa'?normalization.prepareKupaStorageOperation:clone,
  createJournal:args=>createStorageJournal({...args,db:wrapped})};
const runtime=createStorageV2Runtime(options),driver=createStorageBrowser({storageV2:runtime,model,session,files,normalizeState:normalization.normalizeState,prepareCloudState:project,prepareKupaCloudState:project});
async function edit(id,content){
 const index=model.state.notes.findIndex(note=>note.id===id),record={id,content,createdAt:'2026-10-11',updatedAt:'2026-10-11'};
 if(index<0)model.state.notes.push(record);else model.state.notes[index]=record;session.localGeneration++;
 const result=runtime.persist(model.state,{generation:session.localGeneration,mutationType:'edit',surface:'notes',operations:[{type:'put',collection:'notes',id,mode:index<0?'insert':'replace',index:index<0?model.state.notes.length-1:index,record:clone(record)}]});
 check(result.handled,'edit not handled');await result.committed;
}
const merger=createSyncMerge({normalizeState:normalization.normalizeState,prepareKupaCloudState:project});
for(const key of ['merge3','mergeKupaCloudState3Way'])if(merger[key]){const original=merger[key];merger[key]=(...args)=>{const result=original(...args);recoveryObservations.push({mergeConflicts:result.conflicts});return result}}
const rpc=async(state,expected,operationId)=>{calls.push({expected,operationId,state:clone(state)});remoteRow={revision:expected+1,state:clone(state),updated_at:'2026-10-11T10:07:06Z'};
 if(calls.length===1&&!phase.startsWith('review')){
   if(phase==='conflict')remoteRow.state.notes[0].content='remote-conflicting';
   else remoteRow.state.notes.push({id:'remote-note',content:'remote-retained',createdAt:'2026-10-11',updatedAt:'2026-10-11'});
 }return {r:{ok:true},row:clone(remoteRow)};
};
const ports={getCloudWriteScope:()=>runtime.cloudScope&&({...runtime.cloudScope,accountOwner:owner,loginEpoch}),model,session,files,tab,toast:noop,render:noop,
 refreshStorageV2CloudState:()=>driver.refreshStorageV2CloudState(),materializeStorageV2CloudFlight:args=>driver.materializeStorageV2CloudFlight(args),acknowledgeStorageV2CloudFlight:(...args)=>driver.acknowledgeStorageV2CloudFlight(...args),
 setStorageV2CloudControl:(...args)=>driver.setStorageV2CloudControl(...args),storageV2CommitPromise:()=>runtime.commitPromise,
 readStorageV2CloudRecovery:async(...args)=>{const evidence=await driver.readStorageV2CloudRecovery(...args);const a=project(evidence.replayedPrevious||evidence.state),b=project(model.state);recoveryObservations.push({equal:equalSyncJson(a,b),differences:[...new Set([...Object.keys(a),...Object.keys(b)])].filter(key=>!equalSyncJson(a[key],b[key]))});return evidence},commitStorageV2CloudRecovery:async(...args)=>{const head=await driver.commitStorageV2CloudRecovery(...args);recoveryObservations.push({nativeCommit:true,current:args[1].isCurrent(),generation:session.localGeneration,seq:head.seq,writable:runtime.cloudScope.writable,ownerMatches:head.base.owner===runtime.cloudScope.owner,epochMatches:head.base.epoch===runtime.cloudScope.epoch});return head}};
const api=app==='orders'?createSyncDocument({...ports,prepareCloudState:project,composeOrderCloudState:(cloud,current)=>({...clone(cloud),checks:clone(current.checks)}),cloudEnabled:()=>true,cloudHasLocalWork:()=>!!(session.storageV2CloudPending||session.cloudSaveRequested),sameOrderCloudData:(a,b)=>equalSyncJson(project(a),project(b)),applyOrderCloudState:state=>{model.state={...clone(state),checks:clone(model.state.checks)}},rpcSaveV2:rpc,readCloud:async()=>clone(remoteRow),merge3:merger.merge3,setCloud:(...args)=>statuses.push(args),writeStateToFolder:async()=>{},pollSharedChecks:async()=>{},refreshKupaReadout:async()=>false,refreshCloudTimestamp:noop}):createSyncDocument({...ports,
 hideConnectScreen:noop,reportError:noop,checksSession:{},prepareKupaCloudState:project,applyKupaCloudState:normalization.applyKupaCloudState,setSaveStatus:noop,setConnectedStatus:noop,setCloudHeaderStatus:(...args)=>statuses.push(args),listBackups:async()=>[],backupSnapshotToComputer:async()=>{},syncSharedChecksFromCloud:async()=>true,mergeKupaCloudState3Way:merger.mergeKupaCloudState3Way,storageV2CloudOutboxActive:()=>true,assertAccountOwner:()=>true,showSecondaryTabGuard:noop,pollSharedChecks:async()=>{},supaRest:async(_path,args)=>{const body=JSON.parse(args.body),result=await rpc(body.p_state,body.p_expected_revision,body.p_operation_id);return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(result.row)}}});
"""
FLOW=r"""
const privateSnapshot=__PRIVATE__;
if(privateSnapshot){
 owner=privateSnapshot.stores['owner-bindings'][0].value.data.owner;
 const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('netunim-storage-v2');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 await new Promise((resolve,reject)=>{const names=['metadata','checkpoints','bases','flights','controls','journal'],tx=database.transaction(names,'readwrite');
   for(const name of names)for(const row of privateSnapshot.stores[name])if((Array.isArray(row.key)?row.key[0]:row.key)===owner+':orders'&&row.value!==null)tx.objectStore(name).put(clone(row.value),row.key);
   tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
 });database.close();
 const recovered=await runtime.recoverForOwner({intent:'load-account'});check(recovered,'private capture did not recover');model.state=normalization.normalizeState(recovered.state);
 remoteRow={revision:1575,state:(await runtime.cloudState()).base.state,updated_at:'2026-10-11T10:07:06.944304Z'};
}else{
 await runtime.initializeCloudHead(10,model.state,{sourceOwner:owner,intent:'cloud-authoritative',cloudState:project(model.state)});await driver.refreshStorageV2CloudState();await edit('original-note','flight-value');
}
if(phase.startsWith('review')){
 if(!privateSnapshot){
   const flight=await driver.materializeStorageV2CloudFlight();remoteRow={revision:11,state:project(model.state),updated_at:'2026-10-11T10:07:06Z'};
   await driver.acknowledgeStorageV2CloudFlight(flight.operationId,11,remoteRow.state,{currentState:model.state,expectedSeq:1});
   for(let i=0;i<34;i++)await edit('pending-'+i,phase==='review-ui'&&i===0?'<img src=x onerror="window.badRecoveryHtml=true">':'retained-'+i);
   await driver.setStorageV2CloudControl({conflict:{kind:'concurrent-ack',domain:'orders',baseRevision:10,currentRemoteRevision:11}});
 }
 await driver.refreshStorageV2CloudState();const before=await db.load(runtime.cloudScope.owner),view=clone(model.state),review=await api.prepareConcurrentAckRecovery();
 check(review.pendingCount===34,'34 pending operations expected');check(JSON.stringify(await db.load(runtime.cloudScope.owner))===JSON.stringify(before),'review wrote storage');
 if(phase==='review-abort'||phase==='review-quota'){
   const put=IDBObjectStore.prototype.put;let failure,writes=0;
   IDBObjectStore.prototype.put=function(...args){
     if(this.name==='checkpoints'){
       writes++;
       if(phase==='review-quota')throw new DOMException('controlled checkpoint quota','QuotaExceededError');
       put.apply(this,args);this.transaction.abort();throw Error('controlled checkpoint abort');
     }return put.apply(this,args);
   };
   try{await review.resume()}catch(error){failure=error}finally{IDBObjectStore.prototype.put=put}
   check(writes===1&&(phase==='review-quota'?failure?.name==='QuotaExceededError':failure?.message==='controlled checkpoint abort'),'native transaction fault not propagated');
   check(JSON.stringify(await db.load(runtime.cloudScope.owner))===JSON.stringify(before),'aborted transaction changed stores');check(calls.length===0,'aborted transaction sent remote write');
 }else{
   if(phase==='review-ui'){
     const {createUiCloud}=await import('./assets/js/ui/cloud.js'),{createCloudActions}=await import('./assets/js/ui/action-packs/cloud.js');let accepts=false,downloads=0;
     const cloudUi=createUiCloud({model,tab,session,auth:{loadSession:()=>({user:{id:owner}})},review:{
       prepareConcurrentAckRecovery:async()=>{const plan=await api.prepareConcurrentAckRecovery();return {...plan,diffText:uiBackup.syncRecoveryDiffText(plan.backup.remote.state,plan.backup.localState)}},
       downloadRecoveryBackup:payload=>{downloads++;uiBackup.downloadBlob(new Blob([JSON.stringify(payload)],{type:'application/json'}),`orders-sync-recovery-${downloads}.json`)},
     },view:{toast:noop,render:noop,renderSettings:noop,showSecondaryTabGuard:()=>{throw Error('secondary UI')},
       confirmDialog:(...args)=>{const confirmation=uiModal.confirmDialog(...args),message=document.querySelector('#confirmMessage');
         check(downloads>0,'confirmation preceded backup');check(message.textContent.includes('34')&&message.textContent.includes('<img src=x'),'review missing counts/content');
         check(!message.querySelector('img')&&!window.badRecoveryHtml,'business text interpreted as HTML');
         queueMicrotask(()=>document.querySelector(accepts?'#confirmAccept':'#confirmCancel').click());return confirmation}
     }});
     const recoveryAction=createCloudActions({uiCloud:cloudUi})['recover-orders-sync'];
     check(recoveryAction.startupMutationDomain==='orders','Main recovery claimed other document domains');
     check(await recoveryAction()===false,'cancel did not stop recovery');
     check(JSON.stringify(await db.load(runtime.cloudScope.owner))===JSON.stringify(before)&&calls.length===0,'cancel changed durable state or cloud');
     accepts=true;check(await recoveryAction(),'UI did not resume approved recovery');check(downloads===2,'review backup missing');
   }else check(await review.resume(),'review did not resume');
   api.stopPolling();
   const after=await db.load(runtime.cloudScope.owner),head=await driver.refreshStorageV2CloudState();
   check(JSON.stringify(after.journal)===JSON.stringify(before.journal),'review or ACK changed journal bytes');check(head.base.ackSeq===before.metadata.seq&&!head.control&&!head.flight&&!head.pending,'pending cursor not confirmed');
   check(equalSyncJson(project(view),project(model.state)),'review changed local business content');check(calls.length===1,'review sent more than one remaining flight');
 }
}else{
 let independentFinance=null;
 onAck=async()=>{
   if(app==='kupa'){
     model.state.bank={...model.state.bank,currentBalance:321,source:'hapoalim',sourceAccount:'synthetic-account',updatedAt:'2026-10-11T10:08:00Z'};
     model.state.creditSync={...model.state.creditSync,syncedAt:'2026-10-11T10:08:00.000Z'};
     independentFinance=clone({bank:model.state.bank,creditSync:model.state.creditSync});
   }
   if(phase==='draft'){model.state.notes[0].content='undurable-draft';session.localGeneration++}else await edit(phase==='conflict'?'original-note':'late-note','late-local-value');
 };
 let recoveryCount=0;
 if(phase==='cas-race')onRecovery=async()=>{if(++recoveryCount===1)await edit('third-note','late-before-cas')};
 if(phase==='owner-loss')onRecovery=async()=>{loginEpoch++};
 const saved=app==='orders'?await api.requestCloudSave(''):await api.persistSupabaseState(project(model.state),'');
 const head=await driver.refreshStorageV2CloudState();
 if(['conflict','draft','owner-loss'].includes(phase)){
   check(saved===false,'unsafe publication claimed success');check(calls.length===1,'unsafe follow-up write');
   check(phase==='owner-loss'?!head.control:head.control?.conflict?.kind==='concurrent-ack','wrong retained fence');
   check(!statuses.some(args=>args.includes('synced')),'false synced');
 }else{
   check(saved===true,'benign edit created permanent concurrent-ack '+JSON.stringify({saved,calls:calls.length,seq:head.seq,ackSeq:head.base.ackSeq,controlKind:head.control?.conflict?.kind,recoveryObservations,statuses}));check(!head.control&&!head.pending&&!head.flight,'benign edit left blocked head');check(calls.length===2&&calls[0].operationId!==calls[1].operationId,'ACK was resent or follow-up missing');
   check(model.state.notes.some(note=>note.id==='late-note'&&note.content==='late-local-value'),'local edit lost');check(model.state.notes.some(note=>note.id==='remote-note'&&note.content==='remote-retained'),'remote edit lost');
   if(phase==='cas-race')check(recoveryCount===2&&head.base.ackSeq===3,'CAS did not reread');
   if(app==='kupa'){
     const durable=await runtime.recoverReadOnly();
     check(durable.state.bank.currentBalance===321&&durable.state.bank.source==='hapoalim'&&durable.state.creditSync.syncedAt===independentFinance.creditSync.syncedAt,'Main recovery changed independent Finance checkpoint');
     check(model.state.bank.currentBalance===321&&model.state.creditSync.syncedAt===independentFinance.creditSync.syncedAt,'Main publication changed Finance read model');
   }
 }
}
const recovered=await runtime.recoverReadOnly(),head=await driver.refreshStorageV2CloudState();
return {owner,notes:recovered.state.notes,cloudHash:JSON.stringify(project(recovered.state)),seq:head.seq,revision:head.base.revision,ackSeq:head.base.ackSeq,pending:head.pending,controlKind:head.control?.conflict?.kind??null,calls:calls.length};
"""
RESTORE=r"""
const expected=__EXPECTED__;owner=expected.owner;
const fresh=createStorageV2Runtime({...options,createJournal:args=>createStorageJournal({...args,db})}),recovered=await fresh.recoverForOwner({intent:'load-account'}),head=await fresh.cloudState();
check(recovered&&JSON.stringify(recovered.state.notes)===JSON.stringify(expected.notes),'fresh runtime changed record IDs/content');
check(JSON.stringify(project(recovered.state))===expected.cloudHash,'fresh runtime changed full business state');
check(head.seq===expected.seq&&head.base.revision===expected.revision&&head.base.ackSeq===expected.ackSeq&&head.pending===expected.pending&&(head.control?.conflict?.kind??null)===expected.controlKind,'fresh runtime changed cursor');
return {records:expected.notes.length,seq:head.seq,revision:head.base.revision,ackSeq:head.base.ackSeq,pending:head.pending,calls:expected.calls};
"""
parser=argparse.ArgumentParser()
parser.add_argument('--app',choices=('orders','kupa'))
parser.add_argument('--phase',action='append',choices=('benign','cas-race','conflict','draft','owner-loss','review','review-abort','review-quota','review-ui'))
parser.add_argument('--baseline',action='store_true')
parser.add_argument('--private-snapshot',type=Path)
args=parser.parse_args()
if args.private_snapshot and (args.app!='orders' or args.phase!=['review']):parser.error('private replay requires --app orders --phase review')
private=json.loads(args.private_snapshot.read_text(encoding='utf-8')) if args.private_snapshot else None
for app in (args.app,) if args.app else ('orders','kupa'):
    for phase in args.phase or (('benign','cas-race','conflict','draft','owner-loss','review','review-abort','review-quota','review-ui') if app=='orders' else ('benign','cas-race','conflict','draft','owner-loss')):
        setup=SETUP.replace('__APP__',json.dumps(app)).replace('__PHASE__',json.dumps(phase))
        with BrowserSession(ROOT/f'netunim-{app}/site',f'post-ack-{app}-{phase}') as browser:
            if args.baseline:
                target=browser.tmp/'site/assets/js/sync/document.js'
                old=subprocess.check_output(['git','show',f'e1a2dbe3:netunim-{app}/site/assets/js/sync/document.js'],cwd=ROOT)
                trailer=target.read_text(encoding='utf-8').split('\nexport const __testBindings=',1)
                if len(trailer)>1:old+=('\nexport const __testBindings='+trailer[1]).encode('utf-8')
                target.write_bytes(old);browser._navigate()
            try:outcome=evaluate_sync(browser, '(async()=>{'+setup+FLOW.replace('__PRIVATE__',json.dumps(private))+'})()',baseline=args.baseline,timeout=70)
            except RuntimeError:
                if not private:print('Native error diagnostics: '+json.dumps(browser.drain_serious_errors()),flush=True)
                raise
            if phase=='review-ui':
                for number in (1,2):
                    downloaded=browser.downloads/f'orders-sync-recovery-{number}.json'
                    deadline=time.monotonic()+10
                    while not downloaded.exists() and time.monotonic()<deadline:time.sleep(.05)
                    assert downloaded.exists(),'review backup download did not complete'
                    backup=json.loads(downloaded.read_text(encoding='utf-8'))
                    assert backup['kind']=='orders-concurrent-ack-review' and backup['storage']['metadata']['seq']==35
                    assert len(backup['localState']['notes'])==35 and backup['storage']['controls']['data']['conflict']['kind']=='concurrent-ack'
            browser._navigate()
            restored=evaluate_sync(browser, '(async()=>{'+setup+RESTORE.replace('__EXPECTED__',json.dumps(outcome))+'})()',baseline=args.baseline,timeout=45)
            errors=browser.drain_serious_errors()
            assert all("beforeunload" in error or 'controlled' in error or 'storage_cloud_scope_changed' in error for error in errors),errors
            print('PASS native post-ACK '+app+' '+phase+': '+json.dumps(restored),flush=True)
