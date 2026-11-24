import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningLifetime} from '../netunim-orders/site/assets/js/domains/customers/morning-lifetime.js';
import {createMorningRecovery} from '../netunim-orders/site/assets/js/domains/customers/morning-recovery.js';

for(const completes of [false,true])test(`manual recovery preserves intent after a running automatic attempt (${completes?'already finished':'retry needed'})`,async()=>{
  const calls=[];
  const id='00000000-0000-4000-8000-000000000031';
  let finish,context={operationId:id},registered=false;
  const blocked=new Promise(resolve=>{finish=resolve});
  const guard=()=>undefined;
  const lifetime=createMorningLifetime({operationScope:{capture:()=>guard,captureRead:()=>guard},getPendingOperationId:()=>context?.operationId,
    recover:()=>{},onInterrupt:()=>{},events:{},timers:{setTimeout:()=>1,clearTimeout:()=>{}}});
  const recovery=createMorningRecovery({lifetime,commands:{async status(_id,_reconcile,_guard,retry){
    calls.push(retry);if(!retry)await blocked;
    registered=retry||completes;
    return {ok:true,operation:{state:'created',operation_id:id,verified_at:'verified',amount:9300},checks_registration_pending:!registered};
  }},recovery:{read:()=>context,abandon:async()=>{throw Error('not reserved')},reset:()=>false},
  application:{apply:async()=>({changed:false}),settle(){if(registered)context=null;return {durable:true,recoveryCleared:registered,blocked:!registered}}},
  publish:{isBusy:()=>false,state(){},notify(){},toast(){}}});
  const automatic=recovery.recover({quiet:true});
  const user=recovery.recover({retryChecks:true,expectedOperationId:id});
  const duplicate=recovery.recover({retryChecks:true,expectedOperationId:id});
  assert.deepEqual(calls,[false]);finish();
  const [_,first,second]=await Promise.all([automatic,user,duplicate]);
  assert.equal(first.state,'created');assert.deepEqual(first,second);
  assert.deepEqual(calls,completes?[false]:[false,true]);lifetime.dispose();await lifetime.drain();
});
