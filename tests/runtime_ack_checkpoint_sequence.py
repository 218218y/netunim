"""Production Main adapters/runtime against native IDB, with isolated owners.

Synthetic RPC receipts only; no real account, SQL changes or provider actions.
The fresh document checks recovered IDs/content and the exact immutable flight.
"""
import argparse
import json
from browser_harness import BrowserSession, ROOT

SETUP=r"""
const app=__APP__,owner='ack-sequence-account',key=owner+':'+app;
const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
const {createStorageBrowser}=await import('./assets/js/storage/browser.js');
const {INITIAL_STATE}=await import('./assets/js/state/constants.js');
const clone=structuredClone,cloud=value=>{const next=clone(value);delete next.checks;return next};
const check=(ok,label)=>{if(!ok)throw Error(label)};
const db=createStorageJournalDb(),model={state:clone(INITIAL_STATE)},session={localGeneration:0,cloudRevision:5,dbRevision:5},files={};
let primary=true,beforeTransaction=null;
const wrapped={...db,acknowledge:async(...args)=>{if(beforeTransaction){const hook=beforeTransaction;beforeTransaction=null;await hook()}return db.acknowledge(...args)}};
const runtime=createStorageV2Runtime({app,owner:()=>owner,primary:()=>primary,mode:()=> 'primary',validate:state=>check(Array.isArray(state.notes),'notes required'),createJournal:options=>createStorageJournal({...options,db:wrapped})});
const browser=createStorageBrowser({storageV2:runtime,model,session,files,normalizeState:clone,prepareCloudState:cloud,prepareKupaCloudState:cloud});
async function edit(content){
 model.state.notes=[{id:'same-note',content,createdAt:'2026-10-11',updatedAt:'2026-10-11'}];session.localGeneration++;
 const options={operations:[{type:'put',collection:'notes',mode:session.localGeneration===1?'insert':'replace',index:0,id:'same-note',record:clone(model.state.notes[0])}],generation:session.localGeneration};
 if(app==='orders')browser.localSnapshot(model.state,options);else browser.persistImmediateBrowserSnapshot(model.state,5,options);
 await files.storageV2CommitPromise;
}
"""

FLOW=r"""
await runtime.initializeCloudHead(5,model.state,{sourceOwner:owner,intent:'cloud-authoritative',cloudState:cloud(model.state)});
check(await runtime.recover(),'initial recovery');await browser.refreshStorageV2CloudState();await edit('flight-A');
const flight=await browser.materializeStorageV2CloudFlight(),head=await browser.refreshStorageV2CloudState(),candidate=clone(model.state),phase=__PHASE__;
let expected='storage_ack_checkpoint_stale';
if(phase==='before-adapter')await edit('late-B');
else if(phase==='before-transaction'){beforeTransaction=()=>edit('late-B');expected='storage_checkpoint_stale'}
else if(phase==='lost-primary'){primary=false;expected='storage_v2_primary_not_ready'}
else if(phase==='abort')expected='controlled checkpoint abort';
else if(phase==='quota')expected='QuotaExceededError';
const before=JSON.stringify(await db.load(key)),put=IDBObjectStore.prototype.put;
if(phase==='abort'||phase==='quota')IDBObjectStore.prototype.put=function(...args){
 if(this.name==='checkpoints'){if(phase==='quota')throw new DOMException('controlled checkpoint quota','QuotaExceededError');put.apply(this,args);this.transaction.abort();throw Error('controlled checkpoint abort')}
 return put.apply(this,args);
};
let error=null;
try{await browser.acknowledgeStorageV2CloudFlight(flight.operationId,6,flight.snapshot,{currentState:candidate,expectedSeq:head.seq})}catch(failure){error=failure}
finally{IDBObjectStore.prototype.put=put;primary=true}
const recovered=await runtime.recover(),retained=await browser.refreshStorageV2CloudState();
check(error&&(error.message.includes(expected)||error.name===expected),'old or aborted ACK accepted: '+JSON.stringify({phase,error:error?.message,recovered:recovered?.state.notes}));
if(phase!=='before-transaction')check(JSON.stringify(await db.load(key))===before,'rejected ACK changed durable stores');
check(JSON.stringify(retained.flight)===JSON.stringify(flight),'flight changed on failed ACK');
check(retained.base.revision===5&&retained.base.ackSeq===0&&retained.pending&&!retained.control,'failed ACK advanced cursor or added control');
const content=phase.startsWith('before-')?'late-B':'flight-A';
check(recovered.state.notes[0].id==='same-note'&&recovered.state.notes[0].content===content,'failed ACK lost the late edit');
return {flight,content,seq:retained.seq,error:error.message};
"""

RESTORE=r"""
const recovered=await runtime.recover(),head=await browser.refreshStorageV2CloudState(),expected=__EXPECTED__;
check(recovered.state.notes[0].id==='same-note'&&recovered.state.notes[0].content===expected.content,'fresh document lost note');
check(JSON.stringify(head.flight)===JSON.stringify(expected.flight)&&head.seq===expected.seq,'fresh document changed immutable flight or sequence');
model.state={...recovered.state,checks:clone(INITIAL_STATE.checks)};
await browser.acknowledgeStorageV2CloudFlight(head.flight.operationId,6,head.flight.snapshot,{currentState:clone(model.state),expectedSeq:head.seq});
const after=await runtime.recover(),ack=await browser.refreshStorageV2CloudState();
check(after.state.notes[0].content===expected.content&&after.state.notes[0].id==='same-note','fresh replay lost content or ID');
check(ack.base.ackSeq===1&&ack.seq===expected.seq&&!ack.flight&&!ack.control,'replay failed cursor confirmation');
check(ack.pending===(expected.seq>1),'replay discarded newer pending work');
return {id:after.state.notes[0].id,content:after.state.notes[0].content,seq:ack.seq,ackSeq:ack.base.ackSeq,pending:ack.pending};
"""

parser=argparse.ArgumentParser()
parser.add_argument('--app',choices=('kupa','orders'))
parser.add_argument('--phase',action='append',choices=('before-adapter','before-transaction','abort','quota','lost-primary'))
args=parser.parse_args()
for app in (args.app,) if args.app else ('kupa','orders'):
    for phase in args.phase or ('before-adapter','before-transaction','abort','quota','lost-primary'):
        setup=SETUP.replace('__APP__',json.dumps(app))
        with BrowserSession(ROOT/f'netunim-{app}/site',f'ack-sequence-{app}-{phase}') as browser:
            outcome=browser.evaluate('(async()=>{'+setup+FLOW.replace('__PHASE__',json.dumps(phase))+'})()',timeout=45)
            browser._navigate()
            restored=browser.evaluate('(async()=>{'+setup+RESTORE.replace('__EXPECTED__',json.dumps(outcome))+'})()',timeout=45)
            errors=browser.drain_serious_errors()
            assert all(error.startswith("Blocked attempt to show a 'beforeunload' confirmation panel for a frame that never had a user gesture") for error in errors),errors
            print('PASS native ACK sequence '+app+' '+phase+': '+json.dumps(restored),flush=True)
