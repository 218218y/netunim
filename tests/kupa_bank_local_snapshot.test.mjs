import test from 'node:test';
import assert from 'node:assert/strict';
import {createBankLocalSnapshot} from '../netunim-kupa/site/assets/js/domains/bank/local-snapshot.js';
import {bankLocalSnapshotNotice} from '../netunim-kupa/site/assets/js/domains/bank/local-snapshot-view.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function fixture(){
  let epoch=1,writable=true,renders=0;const calls=[];
  const model={state:{bank:{snapshotToken:'old',currentBalance:100},notes:[{id:'note',content:'keep'}]}},bank={snapshotToken:'same-snapshot',currentBalance:500,feed:{transactions:[{id:'same-transaction'}]}};
  const initial=epoch,guard=()=>{if(!writable||initial!==epoch)throw Object.assign(Error('ownership changed'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
  let save=async()=>false;
  let recover=async assertCurrent=>{assertCurrent();return true},recoveries=0;
  const api=createBankLocalSnapshot({model,saveState:(message,options)=>{calls.push({message,options});return save()},recoverLocalState:guard=>{recoveries++;return recover(guard)},render:()=>{renders++}});
  return {api,model,bank,guard,calls,renders:()=>renders,recoveries:()=>recoveries,setRecover:value=>{recover=value},setSave:value=>{save=value},handoff:()=>{epoch++},secondary:()=>{writable=false}};
}

for(const outcome of [false,undefined,null])test(`unconfirmed ${String(outcome)} retains the exact snapshot and exposes safe same-ID retry`,async()=>{
  const f=fixture();f.setSave(async()=>outcome);
  assert.equal(await f.api.save(f.bank,'save bank',f.guard),false);assert.equal(f.model.state.bank,f.bank);
  assert.equal(f.api.state().phase,'unconfirmed');assert.equal(f.api.state().canRetry,true);
  f.setSave(async()=>true);assert.equal(await f.api.retry(),true);assert.equal(f.api.state(),null);
  assert.equal(f.calls.length,2);for(const call of f.calls){assert.equal(call.options.operations[0].value,f.bank);assert.equal(call.options.operations[0].value.snapshotToken,'same-snapshot')}
  assert.deepEqual(f.model.state.notes,[{id:'note',content:'keep'}]);
});

test('an exception is observed, cannot roll back an already written snapshot, and remains retryable',async()=>{
  const f=fixture();f.setSave(async()=>{throw new DOMException('file or journal unavailable','QuotaExceededError')});
  await assert.rejects(f.api.save(f.bank,'save bank',f.guard),{name:'QuotaExceededError'});
  assert.equal(f.api.state().phase,'unconfirmed');assert.equal(f.model.state.bank,f.bank);assert.equal(f.api.state().canRetry,true);
});

test('concurrent retry clicks join one original snapshot write until confirmation',async()=>{
  const f=fixture();await f.api.save(f.bank,'save bank',f.guard);const gate=deferred();f.setSave(()=>gate.promise);
  const first=f.api.retry(),second=f.api.retry();assert.equal(first,second);assert.equal(f.api.state().phase,'saving');assert.equal(f.api.state().canRetry,false);
  await Promise.resolve();await Promise.resolve();assert.equal(f.recoveries(),1);assert.equal(f.calls.length,2);gate.resolve(true);assert.equal(await first,true);assert.equal(await second,true);assert.equal(f.api.state(),null);
});

test('changed bank content cannot be overwritten by a retry of an obsolete projection',async()=>{
  const f=fixture();await f.api.save(f.bank,'save bank',f.guard);f.bank.currentBalance=777;
  assert.equal(f.api.state().canRetry,false);assert.throws(()=>f.api.retry(),/bank_local_snapshot_changed/);
  assert.equal(f.calls.length,1);assert.equal(f.model.state.bank.currentBalance,777);
});

test('new authoritative projection is not replaced or warned by the former failed draft',async()=>{
  const f=fixture();await f.api.save(f.bank,'save bank',f.guard);const replacement={snapshotToken:'new-cloud',currentBalance:999};f.model.state.bank=replacement;
  assert.equal(f.api.state(),null);assert.equal(await f.api.retry(),false);assert.equal(f.model.state.bank,replacement);assert.equal(f.calls.length,1);
});

for(const change of ['handoff','secondary'])test(`a late confirmation after ${change} cannot publish or authorize a retry`,async()=>{
  const f=fixture(),gate=deferred();f.setSave(()=>gate.promise);const work=f.api.save(f.bank,'save bank',f.guard);await Promise.resolve();const before=f.renders();
  f[change]();gate.resolve(true);await assert.rejects(work,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});
  assert.equal(f.renders(),before,'late completion cannot repaint a different authority');assert.equal(f.api.state().phase,'blocked');assert.equal(f.api.state().canRetry,false);
  assert.throws(()=>f.api.retry(),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(f.calls.length,1);
});

test('new staging cannot discard the pending snapshot while its write is unresolved',async()=>{
  const f=fixture(),gate=deferred();f.setSave(()=>gate.promise);const work=f.api.save(f.bank,'save bank',f.guard);
  assert.throws(()=>f.api.save({snapshotToken:'new',currentBalance:222},'new',f.guard),/bank_local_snapshot_confirmation_required/);
  assert.equal(f.model.state.bank,f.bank);gate.resolve(true);assert.equal(await work,true);
});

test('an old completion cannot clear or repaint a replacement operation',async()=>{
  const f=fixture(),first=deferred(),second=deferred();f.setSave(()=>first.promise);const old=f.api.save(f.bank,'old',f.guard);await Promise.resolve();
  f.model.state.bank={snapshotToken:'authoritative',currentBalance:200};const newer={snapshotToken:'newer',currentBalance:300};f.setSave(()=>second.promise);const work=f.api.save(newer,'new',f.guard);await Promise.resolve();
  const before=f.renders();first.resolve(true);assert.equal(await old,false);assert.equal(f.renders(),before);assert.equal(f.api.state().phase,'saving');assert.equal(f.model.state.bank,newer);
  second.resolve(true);assert.equal(await work,true);assert.equal(f.api.state(),null);
});

test('snapshot notice distinguishes temporary balances and retry permission from a saved result',()=>{
  assert.equal(bankLocalSnapshotNotice(null),'');
  assert.match(bankLocalSnapshotNotice({phase:'unconfirmed',message:'unconfirmed',canRetry:true},{retry:true}),/data-action="retry-local-bank-snapshot"/);
  assert.doesNotMatch(bankLocalSnapshotNotice({phase:'blocked',message:'scope & changed',canRetry:false},{retry:true}),/data-action/);
  assert.match(bankLocalSnapshotNotice({phase:'saving',message:'',canRetry:false}),/נתון זמני/);
});

test('a failed recovery retains the draft and cannot claim a write or empty journal',async()=>{
  const f=fixture();await f.api.save(f.bank,'save bank',f.guard);f.setRecover(async()=>false);f.setSave(async()=>true);
  assert.equal(await f.api.retry(),false);assert.equal(f.calls.length,1);assert.equal(f.model.state.bank,f.bank);assert.equal(f.api.state().phase,'unconfirmed');
});

test('authority and candidate content are rechecked after recovery before starting a retry',async()=>{
  for(const change of ['owner','content']){
    const f=fixture(),gate=deferred();await f.api.save(f.bank,'save bank',f.guard);f.setRecover(()=>gate.promise);const work=f.api.retry();await Promise.resolve();
    if(change==='owner')f.handoff();else f.bank.currentBalance=999;gate.resolve(true);
    await assert.rejects(work,change==='owner'?{code:'FINANCE_OPERATION_SCOPE_CHANGED'}:/bank_local_snapshot_changed/);assert.equal(f.calls.length,1);
  }
});
