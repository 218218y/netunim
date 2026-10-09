import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditPublication} from '../netunim-kupa/site/assets/js/domains/credit/publication.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const state=id=>({creditSync:{profiles:[{profileId:'P',accounts:[{accountNumber:'C',txns:[{id,amount:12}]}]}]}});
function fixture(){
  let live=true,remote=state('old'),display=remote,revision=1,writes=0,reads=0,checkpoints=0;
  const guard=()=>{if(!live)throw Object.assign(Error('revoked'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
  const ports={commit:async mutator=>{writes++;remote=mutator(remote);return {saved:true,row:{state:remote,revision:++revision}}},
    publish:value=>{display=structuredClone(value)},checkpoint:async()=>{checkpoints++;return false},
    read:async()=>{reads++;return {verified:true,state:remote,financeRevision:revision}}};
  const api=createCreditPublication({commit:(...args)=>ports.commit(...args),publish:value=>ports.publish(value),checkpoint:message=>ports.checkpoint(message),read:options=>ports.read(options)});
  return {api,ports,guard,revoke:()=>{live=false},display:()=>display,remote:()=>remote,counts:()=>({writes,reads,checkpoints})};
}

for(const failure of [false,undefined,'throw'])test(`confirmed Finance commit keeps an independent warning when follow-up returns ${failure}`,async()=>{
  const f=fixture();f.ports.checkpoint=async()=>{if(failure==='throw')throw new DOMException('fixture quota','QuotaExceededError');return failure};
  const result=await f.api.commit(()=>state('same-id'),'fixture',null,f.guard);
  assert.equal(result.remoteCommitted,true);assert.equal(result.displayPublished,true);assert.equal(result.followupConfirmed,false);
  assert.ok(result.warning);assert.equal(f.api.status().publicationWarning,result.warning);assert.deepEqual(f.display(),f.remote());
  assert.equal(f.api.status().publicationWarningCode,failure==='throw'?'QuotaExceededError':'credit_followup_not_confirmed');
});
test('read-based recovery completes the follow-up without a new remote write or changed record ID',async()=>{
  const f=fixture();await f.api.commit(()=>state('stable-id'),'fixture',null,f.guard);f.ports.checkpoint=async()=>true;
  assert.equal(await f.api.retry(f.guard),true);assert.equal(f.api.status().publicationWarning,'');assert.deepEqual(f.display(),state('stable-id'));
  assert.deepEqual(f.counts(),{writes:1,reads:1,checkpoints:1});assert.equal(await f.api.retry(f.guard),false);
});
for(const read of [{verified:false},{verified:true,state:state('wrong'),financeRevision:1},{verified:true,state:state('wrong'),financeRevision:'3'},{verified:true,state:{},financeRevision:3},{verified:true,state:{creditSync:[]},financeRevision:3}])test(`unverified/older read cannot clear a confirmed-commit warning: ${JSON.stringify(read)}`,async()=>{
  const f=fixture();await f.api.commit(()=>state('stable-id'),'fixture',null,f.guard);const prior=f.api.status();f.ports.read=async()=>read;
  await assert.rejects(f.api.retry(f.guard));assert.deepEqual(f.api.status(),prior);assert.deepEqual(f.display(),state('stable-id'));assert.equal(f.counts().writes,1);
});
test('a failed remote write cannot publish or run the local follow-up',async()=>{
  const f=fixture();f.ports.commit=async()=>{throw Error('offline before commit')};
  await assert.rejects(f.api.commit(()=>state('candidate'),'fixture',null,f.guard),/offline/);
  assert.deepEqual(f.display(),state('old'));assert.equal(f.counts().checkpoints,0);assert.equal(f.api.status().publicationWarning,'');
});
test('a remote no-op does not masquerade as a committed candidate',async()=>{
  const f=fixture();f.ports.commit=async()=>({saved:false});await assert.rejects(f.api.commit(()=>state('candidate'),'fixture',null,f.guard));
  assert.deepEqual(f.display(),state('old'));assert.equal(f.counts().checkpoints,0);
});
test('a malformed returned Credit state cannot erase the last known result through normalization defaults',async()=>{
  const f=fixture();f.ports.commit=async mutator=>{mutator(state('old'));return {saved:true,row:{revision:2,state:{}}}};
  await assert.rejects(f.api.commit(()=>state('candidate'),'fixture',null,f.guard),/credit_publication_state_required/);
  assert.deepEqual(f.display(),state('old'));assert.equal(f.counts().checkpoints,0);
});
test('an older follow-up completion cannot erase the warning for a newer committed revision',async()=>{
  const f=fixture(),held=deferred(),entered=deferred();let calls=0;
  f.ports.checkpoint=()=>++calls===1?(entered.resolve(),held.promise):Promise.resolve(false);
  const one=f.api.commit(()=>state('first'),'one',null,f.guard);await entered.promise;
  await f.api.commit(()=>state('second'),'two',null,f.guard);const warning=f.api.status();held.resolve(true);await one;
  assert.deepEqual(f.api.status(),warning);assert.deepEqual(f.display(),state('second'));
});
test('a stale recovery read cannot publish over a newer commit or clear its warning',async()=>{
  const f=fixture(),held=deferred(),entered=deferred();await f.api.commit(()=>state('first'),'one',null,f.guard);
  f.ports.read=()=>{entered.resolve();return held.promise};const retry=f.api.retry(f.guard);await entered.promise;
  await f.api.commit(()=>state('second'),'two',null,f.guard);const warning=f.api.status();held.resolve({verified:true,state:state('first'),financeRevision:2});
  assert.equal(await retry,false);assert.deepEqual(f.api.status(),warning);assert.deepEqual(f.display(),state('second'));
});
test('a delayed lower revision never republishes an older committed read model',async()=>{
  const f=fixture(),held=deferred();let calls=0;f.ports.commit=async mutator=>++calls===1?held.promise:{saved:true,row:{revision:3,state:mutator(state('old'))}};
  const one=f.api.commit(()=>state('first'),'one',null,f.guard);await f.api.commit(()=>state('second'),'two',null,f.guard);
  const warning=f.api.status();held.resolve({saved:true,row:{revision:2,state:state('first')}});const result=await one;
  assert.equal(result.displayPublished,false);assert.deepEqual(f.display(),state('second'));assert.deepEqual(f.api.status(),warning);assert.equal(f.counts().checkpoints,1);
});
for(const stage of ['commit','follow-up','recovery'])test(`revoked authorization during ${stage} cannot confirm the old operation or expose its warning`,async()=>{
  const f=fixture(),held=deferred(),entered=deferred();let pending;
  if(stage==='commit'){f.ports.commit=()=>{entered.resolve();return held.promise};pending=f.api.commit(()=>state('new'),'fixture',null,f.guard)}
  else if(stage==='follow-up'){f.ports.checkpoint=()=>{entered.resolve();return held.promise};pending=f.api.commit(()=>state('new'),'fixture',null,f.guard)}
  else{await f.api.commit(()=>state('new'),'fixture',null,f.guard);f.ports.read=()=>{entered.resolve();return held.promise};pending=f.api.retry(f.guard)}
  await entered.promise;const before=structuredClone(f.display());f.revoke();held.resolve(stage==='commit'?{saved:true,row:{revision:2,state:state('new')}}:stage==='recovery'?{verified:true,state:state('foreign'),financeRevision:3}:true);
  await assert.rejects(pending,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.deepEqual(f.display(),before);assert.equal(f.api.status().publicationWarning,'');
  assert.equal(await f.api.retry(()=>{}),false,'a new login cannot replay the old receipt');
});
