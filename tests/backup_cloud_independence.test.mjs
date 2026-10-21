import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {postAckFixture} from './post_ack_fixture.mjs';

for(const app of ['orders','kupa'])test(`${app}: cloud ACK and a later flight finish while optional backup is stalled`,async()=>{
  let release,started=0,finished=false;
  const gate=new Promise(resolve=>{release=resolve});
  const f=await postAckFixture(app,{backup:async()=>{started++;await gate}});
  f.files.dirHandle={};
  const save=f.save().then(result=>{finished=true;return result});
  try{
    await Promise.race([save,delay(100)]);
    assert.ok(started>0);assert.equal(finished,true,'cloud save must not await the folder');
    assert.equal(await save,true);assert.equal((await f.runtime.cloudState()).pending,false);
    await f.edit('later','accepted while backup is stalled');assert.equal(await f.save(),true);
    assert.equal(f.calls.length,2);assert.equal((await f.runtime.cloudState()).pending,false);
  }finally{release();await save}
});

for(const app of ['orders','kupa'])test(`${app}: optional backup rejection cannot undo an acknowledged cloud save`,async t=>{
  t.mock.method(console,'error',()=>{});
  const f=await postAckFixture(app,{backup:async()=>{throw Error('revoked folder permission')}});f.files.dirHandle={};
  assert.equal(await f.save(),true);assert.equal((await f.runtime.cloudState()).pending,false);
});
