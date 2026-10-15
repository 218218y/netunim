import test from 'node:test';
import fs from 'node:fs';
import {storageJsonHash} from '../shared/storage-json-codec.js';
import assert from 'node:assert/strict';
import {createStorageOwnerBinding} from '../shared/storage-owner.js';
import {createStorageV2OwnerTransfer,readStorageOwnerHandoff} from '../shared/storage-v2-owner-transfer.js';
import {storageV2BootstrapStateHash} from '../shared/storage-v2-bootstrap.js';

const copy=value=>structuredClone(value);
function fakeDb(){
  const bindings=new Map(),handoffs=new Map();
  return {
    async readOwnerBinding(app){return copy(bindings.get(app)||null)},
    async readOwnerHandoff(app){return copy(handoffs.get(app)||null)},
    async initializeOwnerBinding(app,owner,{source,at}){const row={version:1,app,owner,generation:1,source,createdAt:at,updatedAt:at};bindings.set(app,row);return copy(row)},
    async beginOwnerHandoff(app,row){const binding=bindings.get(app),existing=handoffs.get(app);if(binding.owner!==row.sourceOwner||existing&&existing.phase!=='complete')throw Error('storage_owner_handoff_pending');handoffs.set(app,copy(row));return copy(row)},
    async advanceOwnerHandoff(app,id,from,to,patch){const row=handoffs.get(app);if(!row||row.id!==id||row.phase!==from)throw Error('storage_owner_handoff_changed');const next={...row,...copy(patch),phase:to};handoffs.set(app,next);return copy(next)},
    async activateOwnerHandoff(app,id,target,{at}){const row=handoffs.get(app),binding=bindings.get(app);if(!row||row.id!==id||row.phase!=='target-recovered'||binding.owner!==row.sourceOwner||row.targetOwner!==target)throw Error('storage_owner_handoff_changed');const nextBinding={...binding,owner:target,generation:binding.generation+1,updatedAt:at},nextHandoff={...row,phase:'target-active',activatedAt:at};bindings.set(app,nextBinding);handoffs.set(app,nextHandoff);return {binding:copy(nextBinding),handoff:copy(nextHandoff)}},
    async completeOwnerHandoff(app,id,target){const row=handoffs.get(app),binding=bindings.get(app);if(!row||row.id!==id||row.phase!=='target-active'||binding.owner!==target)throw Error('storage_owner_handoff_changed');const next={...row,phase:'complete'};handoffs.set(app,next);return {binding:copy(binding),handoff:copy(next)}},
  };
}
function harness({sourceOwner='local',targetOwner='B',intent='upload-local'}={}){
  const db=fakeDb(),cache=new Map(),storage={getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,String(value)),removeItem:key=>cache.delete(key)},source={main:{state:{rows:[{id:'local'}]},fullState:{rows:[{id:'local'}],checks:[{id:'c1'}]},seq:3},shared:{state:{checks:[{id:'c1'}],bankEvents:[]},seq:2}};
  const targetState={mainState:{rows:[{id:'target'}]},sharedState:{checks:[{id:'c1'}],bankEvents:[]}};
  let proofPatch={},auth=targetOwner,primary=true,online=true,marker=false,group=null,prepareCalls=0,loadCalls=0,resumeCalls=0,verifyCalls=0,viewInstalls=0,failAt='',owner=null,transfer=null;
  const calls=[];
  const ownerFactory=()=>createStorageOwnerBinding({app:'orders',db,storage,primary:()=>primary,operationId:()=> 'transfer-1',now:()=> '2026-09-24T00:00:00Z'});
  const targetFactory=target=>{
    assert.equal(target,targetOwner);
    return {
      async load(){loadCalls++;calls.push('load-target');return copy(group)},
      async resume(ctx){resumeCalls++;calls.push('resume-target');if(!group)return null;if(failAt==='resume')throw Error('resume-crash');return copy(group)},
      async prepare(ctx){prepareCalls++;calls.push('prepare-target');assert.equal(owner.current(),sourceOwner);assert.equal(owner.locked,true);assert.deepEqual(ctx.source.main.fullState,source.main.fullState);group={id:ctx.transferId,phase:'complete',owner:target,sourceOwner:ctx.sourceOwner,transferIntent:ctx.intent,main:{sourceSeq:ctx.source.main.seq,sourceHash:await storageV2BootstrapStateHash('main',ctx.source.main.state)},shared:{sourceSeq:ctx.source.shared.seq,sourceHash:await storageV2BootstrapStateHash('shared',ctx.source.shared.state)}};if(failAt==='prepare')throw Error('prepare-crash');return copy(group)},
      async verify(){verifyCalls++;calls.push('verify-target');if(failAt==='verify')throw Error('verify-crash');return {clean:true,mainRevision:5,sharedRevision:7,...copy(targetState),...copy(proofPatch)}},
      async mark(){calls.push('mark');marker=true;if(failAt==='mark')throw Error('mark-crash')},
      async verifyMarker(){calls.push('verify-marker');return marker},
    };
  };
  async function create(){owner=ownerFactory();await owner.hydrate({initialOwner:()=>sourceOwner});transfer=createStorageV2OwnerTransfer({app:'orders',ownerBinding:owner,primary:()=>primary,online:()=>online,authOwner:()=>auth,
    settleSource:async()=>{calls.push('settle-source');assert.equal(owner.locked,true,'source is read only only after durable handoff lock');if(failAt==='source')throw Error('source-crash');return copy(source)},
    createDetachedTarget:targetFactory,
    installTargetView:async proof=>{calls.push('install-view');viewInstalls++;assert.equal(proof.app,'orders');assert.equal(proof.targetOwner,targetOwner);assert.equal(proof.transferId,'transfer-1');assert.equal(proof.intent,intent);assert.equal(owner.current(),targetOwner);assert.equal(owner.locked,true);assert.deepEqual(proof.mainState,targetState.mainState);if(failAt==='view')throw Error('view-crash')},
  });return transfer}
  return {create,db,setProofPatch:value=>{proofPatch=value},get owner(){return owner},get transfer(){return transfer},source,targetState,calls,
    setAuth:value=>{auth=value},setPrimary:value=>{primary=value},setOnline:value=>{online=value},setFailure:value=>{failAt=value},seedGroup:value=>{group=copy(value)},
    get marker(){return marker},get group(){return copy(group)},get prepareCalls(){return prepareCalls},get loadCalls(){return loadCalls},get resumeCalls(){return resumeCalls},get verifyCalls(){return verifyCalls},get viewInstalls(){return viewInstalls},intent,targetOwner};
}

test('local upload prepares detached target and marker before owner activation',async()=>{
  const h=harness();const transfer=await h.create();const result=await transfer.start({targetOwner:h.targetOwner,intent:h.intent});
  assert.equal(result.owner,'B');assert.deepEqual(result.mainState,h.targetState.mainState);assert.equal(h.owner.current(),'B');assert.equal(h.owner.locked,false);
  assert.equal(h.prepareCalls,1);assert.equal(h.viewInstalls,1);
  assert.ok(h.calls.indexOf('mark')<h.calls.indexOf('install-view'));
  assert.ok(h.calls.indexOf('verify-target')<h.calls.indexOf('mark'));
});

test('restart after remote side effect reuses the frozen group and source under a locked handoff',async()=>{
  const h=harness();let transfer=await h.create();h.setFailure('prepare');
  await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}),/prepare-crash/);
  assert.equal(h.owner.current(),'local');assert.equal(h.owner.locked,true);assert.equal(transfer.preparing,true);assert.ok(h.group);
  h.setFailure('');transfer=await h.create();await transfer.hydrate();await transfer.resume();
  assert.equal(h.owner.current(),'B');assert.equal(h.prepareCalls,1,'remote plan must not be rediscovered after a partial upload');assert.ok(h.loadCalls>=2);
});

test('view failure after atomic activation stays locked and resumes safely',async()=>{
  const h=harness({sourceOwner:'A',targetOwner:'B',intent:'account-switch'});let transfer=await h.create();h.setFailure('view');
  await assert.rejects(transfer.start({targetOwner:'B',intent:'account-switch'}),/view-crash/);
  assert.equal(h.owner.current(),'B');assert.equal(h.owner.locked,true);assert.equal(h.owner.status().handoff.phase,'target-active');
  h.setFailure('');transfer=await h.create();await transfer.resume();assert.equal(h.owner.current(),'B');assert.equal(h.owner.locked,false);assert.equal(h.prepareCalls,1);
});

test('target auth expiry blocks transition before target writes and resumes only for the intended account',async()=>{
  const h=harness();let transfer=await h.create();h.setFailure('source');await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}),/source-crash/);
  h.setFailure('');h.setAuth(null);transfer=await h.create();await assert.rejects(transfer.resume(),/target_reauth_required/);
  assert.equal(h.owner.current(),'local');assert.equal(h.owner.locked,true);assert.equal(h.prepareCalls,0);
  h.setAuth('C');await assert.rejects(transfer.resume(),/target_reauth_required/);h.setAuth('B');await transfer.resume();assert.equal(h.owner.current(),'B');
});

test('a changed source or unverified target never activates the owner',async()=>{
  const h=harness();let transfer=await h.create();h.setFailure('prepare');await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}),/prepare-crash/);
  h.setFailure('');h.source.main.state.rows.push({id:'new'});transfer=await h.create();await assert.rejects(transfer.resume(),/source_changed/);assert.equal(h.owner.current(),'local');
  const second=harness();transfer=await second.create();second.setFailure('verify');await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}),/verify-crash/);assert.equal(second.owner.current(),'local');assert.equal(second.owner.locked,true);
});

test('an unrelated pending target plan is rejected before resuming cloud effects',async()=>{
  const h=harness(),transfer=await h.create();h.seedGroup({id:'another-transfer',owner:'B',phase:'main-initialized'});
  await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}),/bootstrap_plan_mismatch/);
  assert.equal(h.owner.current(),'local');assert.equal(h.owner.locked,true);assert.equal(h.prepareCalls,0);assert.equal(h.resumeCalls,0);
});

test('secondary tab and offline target cannot start a transfer',async()=>{
  const h=harness(),transfer=await h.create();h.setPrimary(false);
  await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}),/primary_required/);
  h.setPrimary(true);h.setOnline(false);
  await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}),/online_required/);
  assert.equal(h.owner.current(),'local');assert.equal(h.owner.locked,false);
});

test('a second account request cannot hijack an in-progress handoff',async()=>{
  const h=harness(),transfer=await h.create();h.setFailure('source');
  await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}),/source-crash/);
  await assert.rejects(transfer.start({targetOwner:'C',intent:'load-account'}),/handoff_pending/);
  assert.equal(h.owner.current(),'local');assert.equal(h.owner.status().handoff.targetOwner,'B');
});

for(const phase of ['target-recovered','target-active'])test(`resume ${phase} compares clean target to frozen durable evidence`,async()=>{
  const h=harness();let transfer=await h.create();
  if(phase==='target-active')h.setFailure('view');
  else {
    const activate=h.db.activateOwnerHandoff;
    h.db.activateOwnerHandoff=async()=>{throw Error('activation-crash')};
    h.restoreActivate=()=>{h.db.activateOwnerHandoff=activate};
  }
  await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}));
  assert.equal(h.owner.status().handoff.phase,phase);
  h.setFailure('');h.restoreActivate?.();h.targetState.mainState.rows.push({id:'unrelated'});
  transfer=await h.create();const installs=h.viewInstalls;
  await assert.rejects(transfer.resume(),/target_changed/);
  assert.equal(h.owner.locked,true);assert.equal(h.viewInstalls,installs);
  assert.equal(h.owner.current(),phase==='target-active'?'B':'local');
});

test('target proof is projected before view installation and cannot override transfer identity',async()=>{
  const h=harness();h.setProofPatch({app:'kupa',targetOwner:'C',sourceOwner:'foreign',transferId:'foreign',intent:'load-account'});
  const transfer=await h.create();const result=await transfer.start({targetOwner:'B',intent:'upload-local'});
  assert.equal(result.owner,'B');assert.equal(h.owner.current(),'B');
});

for(const mutate of [r=>{r.phase=['target-active']},r=>{r.app='kupa'},r=>{r.version='1'},r=>{r.targetOwner=['B']},r=>{r.sourceProof.mainSeq='3'},r=>{r.sourceProof.mainHash='bad'},r=>{delete r.targetProof},r=>{r.targetProof.sharedRevision=true},r=>{r.bootstrapId='foreign'}])test('malformed persisted handoff remains locked before target/view effects',async()=>{
  const h=harness();let transfer=await h.create();h.setFailure('view');
  await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}));h.setFailure('');
  const stored=await h.db.readOwnerHandoff('orders');mutate(stored);
  h.db.readOwnerHandoff=async()=>copy(stored);
  transfer=await h.create();const calls=h.calls.length;
  await assert.rejects(transfer.resume());assert.equal(h.owner.locked,true);
  assert.equal(h.calls.length,calls);assert.deepEqual(await h.db.readOwnerHandoff('orders'),stored);
});

for(const mutate of [r=>{r.id='foreign'},r=>{r.sourceProof.mainHash='f'.repeat(64)},r=>{r.phase='target-authenticated'}])test('persisted transition reply cannot substitute frozen identity or proof',async()=>{
  const h=harness(),advance=h.db.advanceOwnerHandoff;
  h.db.advanceOwnerHandoff=async(...args)=>{const row=await advance(...args);mutate(row);return row};
  const transfer=await h.create();await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}),/transition_changed|proof_required/);
  assert.equal(h.owner.current(),'local');assert.equal(h.owner.locked,true);assert.equal(h.prepareCalls,0);
});

for(const patch of [{mainState:[]},{mainState:true},{mainRevision:'5'},{sharedRevision:[7]},{sharedState:{checks:[{id:'same'},{id:'same'}],bankEvents:[]}}])test('invalid detached proof cannot activate the owner',async()=>{
  const h=harness();h.setProofPatch(patch);const transfer=await h.create();
  await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}));assert.equal(h.owner.current(),'local');assert.equal(h.owner.locked,true);assert.equal(h.viewInstalls,0);
});

test('handoff decoder validates proof requirements and intent without coercion',()=>{
  const row={version:1,app:'orders',id:'T',sourceOwner:'local',targetOwner:'B',intent:'upload-local',phase:'freezing-source'};
  assert.equal(readStorageOwnerHandoff(row,'orders').phase,'freezing-source');
  for(const patch of [{phase:'source-settled'},{intent:['upload-local']},{sourceOwner:'A'},{targetOwner:' B '},{phase:'complete'}])assert.throws(()=>readStorageOwnerHandoff({...row,...patch},'orders'));
});

test('implementation mutation proves frozen target evidence prevents installing changed data',async()=>{
  let source=fs.readFileSync('shared/storage-v2-owner-transfer.js','utf8').replaceAll('\r\n','\n');
  for(const name of ['storage-operation.js','sync-json.js'])source=source.replace(`'./${name}'`,JSON.stringify(new URL('../shared/'+name,import.meta.url).href));
  const guard="if(current.targetProof&&!equalSyncJson(summary,current.targetProof))throw new Error('storage_transfer_target_changed');";
  assert.ok(source.includes(guard));source=source.replace(guard,'');
  const {createStorageV2OwnerTransfer:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const h=harness();let transfer=await h.create();h.setFailure('view');await assert.rejects(transfer.start({targetOwner:'B',intent:'upload-local'}));h.setFailure('');
  h.targetState.mainState.rows.push({id:'unrelated'});
  transfer=unsafe({app:'orders',ownerBinding:h.owner,authOwner:()=> 'B',settleSource:async()=>h.source,
    createDetachedTarget:()=>({load:async()=>null,prepare:async()=>null,resume:async()=>null,verify:async()=>({clean:true,mainRevision:5,sharedRevision:7,...copy(h.targetState)}),mark:async()=>true,verifyMarker:async()=>true}),
    installTargetView:async proof=>assert.equal(proof.mainState.rows.at(-1).id,'unrelated')});
  await transfer.resume();assert.equal(h.owner.locked,false,'omitting the production comparison must reproduce unsafe completion');
});

test('canonical evidence hashing rejects non-JSON before digest instead of projecting undefined to null',async()=>{
  let digests=0;const cryptoImpl={subtle:{digest:async()=>{digests++;return new ArrayBuffer(32)}}};
  const cycle={};cycle.self=cycle;
  for(const state of [{value:undefined},{value:1n},{value:new Date()},cycle])await assert.rejects(storageJsonHash(state,cryptoImpl),/storage_non_json_value/);
  assert.equal(digests,0);
  assert.equal(await storageJsonHash({b:[1,null],a:{x:true}}),await storageJsonHash({a:{x:true},b:[1,null]}));
  assert.notEqual(await storageJsonHash({value:null}),await storageJsonHash({}));
});
