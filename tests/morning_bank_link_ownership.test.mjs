import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningBankTransactionLinker} from '../netunim-orders/site/assets/js/domains/customers/morning-bank-transaction-link.js';
const gate=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no});return {promise,resolve,reject}};
function fixture(t){
  let active=true;const source={kind:'standalone'},errors=[];
  const prior=console.error;console.error=(...args)=>errors.push(args);t.after(()=>{console.error=prior});
  const held=gate(),entered=gate();t.after(()=>held.resolve());
  const ports={session:{generation:()=>1,isActive:()=>active},catalog:{read:()=>[],ensure:()=>{entered.resolve();return held.promise}},policy:{eligible:()=>({eligible:false}),prefill:()=>{throw Error('unused')}},form:{source:()=>source,capture:()=>({}),link(){},clear(){}},presentation:{panel:()=>'',exists:()=>true,query:()=>'',render:()=>0,select(){},blur(){},toast(){},error:error=>errors.push(error)}};
  return {owner:createMorningBankTransactionLinker(ports),ports,entered,held,errors,revoke:()=>{active=false}};
}
test('a revoked Bank catalog refresh cannot publish former-account diagnostic details',async t=>{
  const f=fixture(t),refreshing=f.owner.refresh();await f.entered.promise;f.revoke();f.held.reject(Error('private former account statement detail'));await refreshing;
  assert.deepEqual(f.errors,[],'former-account refresh failure cannot publish after loss of form authority');
});

test('current catalog failures remain visible and accepted refresh still completes',async t=>{
  const f=fixture(t),refreshing=f.owner.refresh();await f.entered.promise;const failure=Error('current failure');f.held.reject(failure);
  assert.equal(await refreshing,true);assert.deepEqual(f.errors,[failure]);
});

test('a later refresh supersedes older display publication while retaining the accepted promise',async t=>{
  const f=fixture(t),old=f.owner.refresh();await f.entered.promise;
  f.ports.catalog.ensure=async()=>true;assert.equal(await f.owner.refresh(),true);f.held.reject(Error('obsolete request failure'));
  assert.equal(await old,false);assert.deepEqual(f.errors,[]);
});

test('unknown malformed archive identities cannot reach Bank eligibility or source mutation',t=>{
  const f=fixture(t);let inspected=0;f.ports.catalog.read=()=>[null,12,{}, {archiveId:true},{archiveId:[]},{archiveId:{toString:'bad'}}];f.ports.policy.eligible=()=>{inspected++;return {eligible:true}};
  for(const id of [true,[],{},1,71])assert.equal(f.owner.link(id),false);assert.equal(inspected,0);
});
