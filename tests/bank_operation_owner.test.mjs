import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeOperationOwner} from '../netunim-kupa/bank-bridge/operation-owner.mjs';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};

test('synchronous throws release configuration and provider ownership',async()=>{
  const owner=createBridgeOperationOwner();
  await assert.rejects(owner.configuration(()=>{throw new Error('configuration')}),/configuration/);
  assert.equal(await owner.configuration(()=>42),42);
  await assert.rejects(owner.provider(()=>{throw new Error('provider')}),/provider/);
  assert.equal(await owner.provider(()=>7),7);
});

test('status reads wait for complete configuration publication and remain available during providers',async()=>{
  const owner=createBridgeOperationOwner(),held=gate();let stored='old',queried=false;
  const writing=owner.configuration(async()=>{stored='partial';await held.promise;stored='new'});
  const reading=owner.read(()=>{queried=true;return stored});
  await Promise.resolve();await Promise.resolve();assert.equal(queried,false);
  held.resolve();await writing;assert.equal(await reading,'new');
  const session=gate(),provider=owner.provider(()=>session.promise);
  try{assert.equal(await owner.read(()=>stored),'new');await assert.rejects(owner.configuration(()=>{}),{code:'SCRAPE_BUSY'})}
  finally{session.resolve();await provider}
});

test('accepted commands remain FIFO after failure while queued work blocks provider entry',async()=>{
  const owner=createBridgeOperationOwner(),held=gate(),order=[];
  const first=owner.configuration(async()=>{order.push('first');await held.promise;throw new Error('fixture')});
  const second=owner.configuration(()=>order.push('second'));
  const third=owner.configuration(()=>order.push('third'));
  const rejection=assert.rejects(first,/fixture/);
  await assert.rejects(owner.provider(()=>{}),{code:'SCRAPE_BUSY'});
  held.resolve();await Promise.all([rejection,second,third]);assert.deepEqual(order,['first','second','third']);
});

test('read-only status queries do not claim provider exclusivity',async()=>{
  const owner=createBridgeOperationOwner(),held=gate(),reading=owner.read(()=>held.promise);
  try{
    assert.equal(await owner.provider(()=>42),42);
  }finally{held.resolve();await reading}
});

test('a mutation waiting behind a read still reserves provider exclusivity',async()=>{
  const owner=createBridgeOperationOwner(),held=gate(),reading=owner.read(()=>held.promise);
  const changing=owner.configuration(()=>42);
  try{await assert.rejects(owner.provider(()=>{}),{code:'SCRAPE_BUSY'})}
  finally{held.resolve();await reading;await changing}
});
