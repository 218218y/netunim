"""Main sync/production adapters with native IDB at the post-commit boundary.

Synthetic owners and RPC only. A controlled promise pauses after the native
transaction completes; a second storage identity is recovered before release.
This tests the boundary, not the reachability of a particular login UI sequence.
"""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

SETUP = r"""
const app=__APP__,clone=structuredClone,noop=()=>{},check=(ok,label)=>{if(!ok)throw Error(label)};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const {INITIAL_STATE}=await import('./assets/js/state/constants.js');
const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
const {STORAGE_SCHEMAS}=await import('./assets/js/shared/storage-v2-schema.js');
const {readStorageRecord}=await import('./assets/js/shared/storage-journal-model.js');
const {createStorageBrowser}=await import('./assets/js/storage/browser.js');
const {createSyncDocument}=await import('./assets/js/sync/document.js');
const project=value=>{const next=clone(value);delete next.checks;return next};
const model={state:clone(INITIAL_STATE)},session={localGeneration:0,cloudRevision:10,dbRevision:10,connectionMode:'supabase',backendReady:true,cloudDocumentName:'main',serverInfo:{}},files={},tab={primaryTab:true};
let owner='publication-A',loginEpoch=1,afterCommit=null;
const db=createStorageJournalDb(),entered=deferred(),release=deferred();
const wrapped={...db};
for(const method of ['acknowledge','rejectFlight'])wrapped[method]=async(...args)=>{
 const committed=await db[method](...args);
 if(afterCommit){afterCommit=null;entered.resolve();await release.promise}
 return committed;
};
const options={app,owner:()=>owner,primary:()=>tab.primaryTab,mode:()=> 'primary',validate:state=>check(Array.isArray(state.notes),'notes required'),createJournal:args=>createStorageJournal({...args,db:wrapped})};
const runtime=createStorageV2Runtime(options);
const cloudState=runtime.cloudState;let failCommitRefresh=false;
runtime.cloudState=async(...args)=>{if(failCommitRefresh){failCommitRefresh=false;throw Error('controlled post-commit cache refresh')}return cloudState(...args)};
const driver=createStorageBrowser({storageV2:runtime,model,session,files,normalizeState:clone,prepareCloudState:project,prepareKupaCloudState:project});
async function append(id,content){
 const record={id,content,createdAt:'2026-10-11',updatedAt:'2026-10-11'};
 model.state.notes.push(record);session.localGeneration++;
 const write=runtime.persist(model.state,{generation:session.localGeneration,mutationType:'edit',surface:'notes',operations:[{type:'put',collection:'notes',mode:'insert',id,index:model.state.notes.length-1,record:clone(record)}]});
 check(write.handled,'append handled');await write.committed;
}
"""

FLOW = r"""
const phase=__PHASE__,rebase=phase.startsWith('rebase'),epochChange=phase.endsWith('epoch'),fallback=phase.endsWith('fallback');
await runtime.initializeCloudHead(10,model.state,{sourceOwner:owner,intent:'cloud-authoritative',cloudState:project(model.state)});
check(await runtime.recover(),'A recovery');await driver.refreshStorageV2CloudState();await append('note-A','LOCAL_A');
const flight=await driver.materializeStorageV2CloudFlight(),scopeA=clone(runtime.cloudScope),calls=[],statuses=[],backups=[];
const remote=project(model.state);remote.notes[0].content='REMOTE_A';
const rpc=async(snapshot,expected,operationId)=>{calls.push({operationId,expected});return rebase?{r:{ok:false,status:409},j:{code:'PT409',message:'revision_conflict'}}:{r:{ok:true},row:{revision:12,state:clone(remote),operation_replayed:true,operation_revision:11}}};
const ports={getCloudWriteScope:()=>runtime.cloudScope&&({...runtime.cloudScope,accountOwner:owner,loginEpoch}),model,session,files,tab,toast:noop,render:noop,
 refreshStorageV2CloudState:()=>driver.refreshStorageV2CloudState(),materializeStorageV2CloudFlight:args=>driver.materializeStorageV2CloudFlight(args),
 acknowledgeStorageV2CloudFlight:(...args)=>driver.acknowledgeStorageV2CloudFlight(...args),rejectStorageV2CloudFlight:(...args)=>driver.rejectStorageV2CloudFlight(...args),
 setStorageV2CloudControl:value=>driver.setStorageV2CloudControl(value),storageV2CommitPromise:()=>runtime.commitPromise};
const merge=(_base,local)=>({state:clone(local),conflicts:[]});
const api=app==='orders'?createSyncDocument({...ports,prepareCloudState:project,cloudEnabled:()=>true,cloudHasLocalWork:()=>!!session.storageV2CloudPending,
 sameOrderCloudData:(a,b)=>JSON.stringify(project(a))===JSON.stringify(project(b)),applyOrderCloudState:value=>{model.state={...clone(value),checks:[]}},
 rpcSaveV2:rpc,readCloud:async()=>({revision:11,state:clone(remote)}),merge3:merge,setCloud:(...args)=>statuses.push(args),writeStateToFolder:async()=>backups.push(clone(model.state)),pollSharedChecks:async()=>{},refreshKupaReadout:async()=>false,refreshCloudTimestamp:noop}):createSyncDocument({...ports,
 hideConnectScreen:noop,reportError:noop,checksSession:{},prepareKupaCloudState:project,applyKupaCloudState:value=>({...clone(value),checks:[]}),
 setSaveStatus:noop,setConnectedStatus:noop,setCloudHeaderStatus:(...args)=>statuses.push(args),listBackups:async()=>[],backupSnapshotToComputer:async value=>backups.push(clone(value)),
 syncSharedChecksFromCloud:async()=>true,readSupabaseDocument:async()=>({revision:11,state:clone(remote)}),mergeKupaCloudState3Way:merge,storageV2CloudOutboxActive:()=>true,assertAccountOwner:()=>true,
 showSecondaryTabGuard:noop,pollSharedChecks:async()=>{},supaRest:async(_path,args)=>{const body=JSON.parse(args.body),result=await rpc(body.p_state,body.p_expected_revision,body.p_operation_id);return {ok:result.r.ok,status:result.r.ok?200:409,headers:{get:()=>null},text:async()=>JSON.stringify(result.r.ok?result.row:result.j)}}});
afterCommit=true;
const saving=app==='orders'?api.requestCloudSave(''):api.persistSupabaseState(project(model.state),'');
await Promise.race([entered.promise,saving.then(async result=>{throw Error('save ended before native commit: '+JSON.stringify({result,calls,statuses,control:(await driver.refreshStorageV2CloudState())?.control}))})]);
const aCommitted=await db.load(scopeA.owner);
const readOnlyA=createStorageJournal({owner:scopeA.owner,schema:STORAGE_SCHEMAS[app],validate:noop,db,primary:()=>false});
const recoveredA=await readOnlyA.recover(),headA={base:readStorageRecord(aCommitted.bases),flight:aCommitted.flights,pending:recoveredA.seq>readStorageRecord(aCommitted.bases).ackSeq};
check(headA.base.revision===(rebase?11:12)&&headA.flight===null,'A native commit completed');
check(recoveredA.state.notes[0].id==='note-A'&&recoveredA.state.notes[0].content===(rebase?'LOCAL_A':'REMOTE_A'),'A committed note retained');
if(epochChange){
 const next={...clone(recoveredA.state),checks:[]};
 await runtime.resetCloudHead(3,project(next),next);model.state=next;
}else{
 owner='publication-B';loginEpoch++;model.state=clone(INITIAL_STATE);
 await runtime.initializeCloudHead(3,model.state,{sourceOwner:owner,intent:'cloud-authoritative',cloudState:project(model.state)});
 check(await runtime.recover(),'B recovery');
}
session.localGeneration=0;session.cloudRevision=3;session.dbRevision=3;session.lastCloudState=project(model.state);session.lastSavedSnapshot=JSON.stringify(project(model.state));
session.cloudBusy=false;session.cloudSyncBusy=false;session.cloudWriteBusy=false;
await append('note-B','NEW_IDENTITY');const headB=await driver.refreshStorageV2CloudState(),scopeB=clone(runtime.cloudScope),durableB=JSON.stringify(await db.load(scopeB.owner)),visibleB=clone(model.state),sessionB={cloudRevision:3,dbRevision:3,lastCloudState:clone(session.lastCloudState),lastSavedSnapshot:session.lastSavedSnapshot};
check(headB.seq===1&&session.localGeneration===1,'seq/generation intentionally collide');
check(epochChange?scopeA.epoch!==scopeB.epoch:scopeA.owner!==scopeB.owner,'identity really changed');
const statusesBefore=statuses.length;failCommitRefresh=fallback;release.resolve();check(await saving===false,'old identity save must return false');
check(session.storageV2CloudPending===true,'old fallback receipt cleared the new pending flag');
check(JSON.stringify(model.state)===JSON.stringify(visibleB),'old committed result published over new identity');
for(const [key,value] of Object.entries(sessionB))check(JSON.stringify(session[key])===JSON.stringify(value),'old result updated new session '+key);
check(JSON.stringify(await db.load(scopeB.owner))===durableB,'old operation wrote control/flight/checkpoint under new identity');
check(calls.length===1&&calls[0].operationId===flight.operationId,'old operation rotated or retried under new identity');
check(statuses.length===statusesBefore&&backups.length===0,'old operation published status/backup after identity change');
if(!epochChange)check(JSON.stringify(await db.load(scopeA.owner))===JSON.stringify(aCommitted),'old account committed records changed');
return {phase,scopeA,scopeB,a:{revision:headA.base.revision,ackSeq:headA.base.ackSeq,pending:headA.pending,notes:recoveredA.state.notes},b:{revision:3,seq:1,ackSeq:0,pending:true,notes:visibleB.notes},operationId:flight.operationId};
"""

RESTORE = r"""
const expected=__EXPECTED__,epochChange=expected.phase.endsWith('epoch');
for(const entry of epochChange?[['publication-A',expected.b]]:[['publication-A',expected.a],['publication-B',expected.b]]){
 owner=entry[0];const fresh=createStorageV2Runtime({...options,createJournal:args=>createStorageJournal({...args,db})});
 const recovered=await fresh.recoverForOwner({intent:'load-account'}),head=await fresh.cloudState(),want=entry[1];
 check(JSON.stringify(recovered.state.notes)===JSON.stringify(want.notes),'fresh runtime changed IDs/content '+owner);
 check(head.base.revision===want.revision&&head.base.ackSeq===want.ackSeq&&head.pending===want.pending&&!head.flight&&!head.control,'fresh runtime changed cursor/control '+owner);
 if(want.seq)check(head.seq===want.seq,'fresh runtime changed sequence');
}
return {phase:expected.phase,ids:expected.b.notes.map(note=>note.id),pending:true,oldCommitRevision:expected.a.revision};
"""

parser=argparse.ArgumentParser()
parser.add_argument('--app',choices=('kupa','orders'))
parser.add_argument('--phase',action='append',choices=('ack-owner','ack-epoch','rebase-owner','rebase-epoch','ack-owner-fallback'))
parser.add_argument('--baseline',action='store_true',help='Use previous main sync source, expecting regression assertions to fail.')
args=parser.parse_args()
for app in (args.app,) if args.app else ('kupa','orders'):
    for phase in args.phase or ('ack-owner','ack-epoch','rebase-owner','rebase-epoch','ack-owner-fallback'):
        setup=SETUP.replace('__APP__',json.dumps(app))
        with BrowserSession(ROOT/f'netunim-{app}/site',f'publication-scope-{app}-{phase}') as browser:
            if args.baseline:
                path=f'netunim-{app}/site/assets/js/sync/document.js'
                target=browser.tmp/'site/assets/js/sync/document.js'
                old=subprocess.check_output(['git','show','99ca5607:'+path],cwd=ROOT)
                trailer=target.read_text(encoding='utf-8').split('\nexport const __testBindings=',1)
                if len(trailer)>1:
                    old+=('\nexport const __testBindings='+trailer[1]).encode('utf-8')
                target.write_bytes(old)
                browser._navigate()
            outcome=browser.evaluate('(async()=>{'+setup+FLOW.replace('__PHASE__',json.dumps(phase))+'})()',timeout=50)
            browser._navigate()
            restored=browser.evaluate('(async()=>{'+setup+RESTORE.replace('__EXPECTED__',json.dumps(outcome))+'})()',timeout=45)
            errors=browser.drain_serious_errors()
            assert all(error.startswith("Blocked attempt to show a 'beforeunload' confirmation panel for a frame that never had a user gesture") or (phase.endswith('fallback') and 'controlled post-commit cache refresh' in error) for error in errors),errors
            print('PASS native Main publication scope '+app+' '+phase+': '+json.dumps(restored),flush=True)


