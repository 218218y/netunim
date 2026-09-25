import test from 'node:test';
import assert from 'node:assert/strict';
import {LEGACY_BUSINESS_KEYS,createLegacyRetirementScheduler,legacyRetirementKey,retireLegacyBusinessStorage} from '../shared/storage-v2-legacy-retirement.js';

function fixture(app='orders'){
  const values=new Map([...LEGACY_BUSINESS_KEYS[app].map(key=>[key,'old']),['orders.supabase.session.v1','session'],['kupa.storage.preferred.v1','preference']]);
  let owner='account',primary=true,verified=true,protocol={orders:2,kupa:2,sharedChecks:2},durable=true;
  const calls=[];
  const options={app,owner,ownerNow:()=>owner,primaryReady:()=>primary,verifyV2:async()=>verified,
    readProtocolState:async()=>protocol,storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{calls.push(`marker:${key}`);values.set(key,value)},removeItem:key=>{calls.push(`ls:${key}`);values.delete(key)}},
    deleteRecords:async()=>{calls.push('idb');if(!durable)throw new Error('idb-abort')}};
  return {options,values,calls,setOwner:value=>owner=value,setPrimary:value=>primary=value,setVerified:value=>verified=value,setProtocol:value=>protocol=value,setDurable:value=>durable=value};
}

for(const app of ['orders','kupa'])test(`${app}: legacy business records retire only after both V2 journals and protocol are verified`,async()=>{
  const f=fixture(app);
  f.setVerified(false);assert.equal(await retireLegacyBusinessStorage(f.options),false);assert.deepEqual(f.calls,[]);
  f.setVerified(true);f.setProtocol({orders:2,kupa:1,sharedChecks:2});assert.equal(await retireLegacyBusinessStorage(f.options),false);assert.deepEqual(f.calls,[]);
  f.setProtocol({orders:2,kupa:2,sharedChecks:2});f.setPrimary(false);assert.equal(await retireLegacyBusinessStorage(f.options),false);assert.deepEqual(f.calls,[]);
  f.setPrimary(true);f.setDurable(false);await assert.rejects(retireLegacyBusinessStorage(f.options),/idb-abort/);
  assert.equal(f.values.size,LEGACY_BUSINESS_KEYS[app].length+2);
  f.setDurable(true);assert.equal(await retireLegacyBusinessStorage(f.options),true);
  for(const key of LEGACY_BUSINESS_KEYS[app])assert.equal(f.values.has(key),false);
  assert.equal(f.values.get('orders.supabase.session.v1'),'session');
  assert.equal(f.values.get('kupa.storage.preferred.v1'),'preference');
  assert.equal(f.values.get(legacyRetirementKey(app,'account')),'2');
  const priorCalls=f.calls.length;
  assert.equal(await retireLegacyBusinessStorage(f.options),true);
  assert.equal(f.calls.length,priorCalls);
});

test('owner switch during protocol verification prevents retirement',async()=>{
  const f=fixture();f.options.readProtocolState=async()=>{f.setOwner('another-account');return {orders:2,kupa:2,sharedChecks:2}};
  assert.equal(await retireLegacyBusinessStorage(f.options),false);
  assert.deepEqual(f.calls,[]);
});

test('local V2 needs no cloud protocol but still requires a durable marker',async()=>{
  const f=fixture('kupa');f.options.owner='local';f.setOwner('local');f.options.readProtocolState=async()=>{throw new Error('offline')};
  assert.equal(await retireLegacyBusinessStorage(f.options),true);
  f.values.delete(legacyRetirementKey('kupa','local'));
  f.setVerified(false);assert.equal(await retireLegacyBusinessStorage(f.options),false);
});

test('scheduled retirement is cancelled when the V2 owner loses its writer lease before idle work',async()=>{
  let ready=true,callback,retired=0,settled=0;
  const schedule=createLegacyRetirementScheduler({ready:()=>ready,settle:async()=>{settled++},retire:async()=>{retired++},scheduleIdle:work=>{callback=work}});
  assert.equal(schedule(),true);assert.equal(schedule(),false);
  ready=false;await callback();assert.equal(settled,1);assert.equal(retired,0);
  ready=true;assert.equal(schedule(),true);await callback();assert.equal(retired,1);
});
