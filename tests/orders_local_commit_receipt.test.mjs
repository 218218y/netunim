import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoragePersistence} from '../netunim-orders/site/assets/js/storage/persistence.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const typed=()=>({operations:[{type:'put',collection:'customerDebts',id:'debt-1',mode:'replace',record:{id:'debt-1'}}]});
function fixture(t,{emergency=true,risk=false,primary=true}={}){
  const session={localGeneration:0},tab={primaryTab:primary},gate=deferred(),messages=[];let receipt=gate.promise,reads=0;
  const persistence=createStoragePersistence({tab,session,localSnapshot:()=>emergency,storageV2DurabilityAtRisk:()=>risk,storageV2CommitPromise:()=>{reads++;return receipt},
    showSecondaryTabGuard(){},setSave:(...args)=>messages.push(args),setCloud(){},cloudEnabled:()=>false,folderSaveTitle:()=>'',folderBackupAvailable:()=>false,syncFolderAccessButton(){}});
  t.after(()=>clearTimeout(session.saveTimer));
  return {persistence,session,tab,gate,messages,reads:()=>reads,setReceipt(value){receipt=value}};
}
test('commitSave requires the captured local commit, not a synchronous emergency success',async t=>{
  const f=fixture(t);let settled=false;const work=f.persistence.commitSave('metadata',typed()).then(value=>{settled=true;return value});
  await Promise.resolve();assert.equal(settled,false);f.gate.resolve(true);assert.equal(await work,true);
});
test('a false synchronous emergency result can confirm an actual IDB-only commit',async t=>{
  const f=fixture(t,{emergency:false,risk:true}),work=f.persistence.commitSave('metadata',typed());
  assert.equal(f.session.localUndurableGenerations.has(1),true);f.gate.resolve(true);assert.equal(await work,true);
  assert.equal(f.session.localUndurableGenerations.has(1),false);
});
test('commitSave rejection propagates and leaves an IDB-only generation undurable',async t=>{
  const f=fixture(t,{emergency:false,risk:true}),work=f.persistence.commitSave('metadata',typed());
  f.gate.reject(Error('injected abort'));await assert.rejects(work,/injected abort/);
  assert.equal(f.session.localUndurableGenerations.has(1),true);assert.ok(f.messages.some(row=>row[1]==='error'));
});
test('rejected secondary mutation cannot confirm an earlier pending receipt',async t=>{
  const f=fixture(t,{primary:false,risk:true});f.gate.resolve();
  assert.equal(await f.persistence.commitSave('rejected',typed()),false);assert.equal(f.session.localGeneration,0);assert.equal(f.reads(),0);
});
test('a failed stage without an outstanding commit is not confirmed by an old promise',async t=>{
  const f=fixture(t,{emergency:false});f.gate.resolve();
  assert.equal(await f.persistence.commitSave('rejected',typed()),false);assert.equal(f.session.localUndurableGenerations.has(1),true);
});
test('commitSave observes the original promise even when a newer save begins',async t=>{
  const f=fixture(t),first=f.persistence.commitSave('first',typed()),next=deferred();f.setReceipt(next.promise);
  const second=f.persistence.commitSave('second',typed());f.gate.resolve(true);assert.equal(await first,true);
  next.resolve(true);assert.equal(await second,true);assert.equal(f.session.localGeneration,2);
});
test('a promise resolving false or undefined is not a local commit receipt',async t=>{
  for(const outcome of [false,undefined]){
    const f=fixture(t),work=f.persistence.commitSave('unconfirmed',typed());f.gate.resolve(outcome);assert.equal(await work,false);
  }
});
test('commitSave rejects missing or empty typed mutations before changing a generation',async t=>{
  const f=fixture(t);
  for(const options of [undefined,{}, {operations:[]},{operations:'invalid'}])await assert.rejects(f.persistence.commitSave('invalid',options),/storage_mutation_contract_required/);
  assert.equal(f.session.localGeneration,0);assert.equal(f.reads(),0);assert.deepEqual(f.messages,[]);
});
