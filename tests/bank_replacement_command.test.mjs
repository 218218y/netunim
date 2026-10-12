import test from 'node:test';
import assert from 'node:assert/strict';
import {replacementFixture} from './bank_replacement_fixture.mjs';

test('accepted graceful shutdown that exceeds the wait budget is never escalated to a force kill',async()=>{
  const f=replacementFixture({wait:async()=>false});
  await assert.rejects(f.stop(),error=>error.code==='BRIDGE_SHUTDOWN_PENDING');assert.equal(f.forced(),0);
});
test('lost shutdown response cannot authorize terminating unconfirmed provider/configuration work',async()=>{
  const f=replacementFixture({shutdown:async()=>{throw new Error('fixture response lost')},wait:async()=>true});
  await assert.rejects(f.stop(),error=>error.code==='BRIDGE_SHUTDOWN_UNCONFIRMED');assert.equal(f.forced(),0);
});

test('an unanswered health probe cannot certify an absent listener',async()=>{
  const f=replacementFixture({probe:async()=>{throw Object.assign(new Error('fixture health timeout'),{name:'AbortError'})}});
  await assert.rejects(f.stop(),{code:'BRIDGE_PROBE_UNCONFIRMED'});assert.equal(f.shutdownCalls(),0);
});

test('a failed closure probe cannot certify completed shutdown',async()=>{
  const f=replacementFixture({wait:async()=>{throw new Error('fixture TCP timeout')}});
  await assert.rejects(f.stop(),{code:'BRIDGE_SHUTDOWN_UNCONFIRMED'});assert.equal(f.forced(),0);
});

test('replacement requires matching service, a pairing token and a positive shutdown acknowledgement',async()=>{
  for(const [ports,code] of [
    [{probe:async()=>({response:{ok:true},data:{service:'other'}})},'BRIDGE_PORT_OCCUPIED'],
    [{token:''},'BRIDGE_AUTH_REQUIRED'],
    [{shutdown:async()=>({response:{ok:false},data:{ok:false,code:'UNAUTHORIZED'}})},'BRIDGE_SHUTDOWN_REJECTED'],
    [{shutdown:async()=>({response:{ok:true},data:{}})},'BRIDGE_SHUTDOWN_REJECTED'],
  ]){const f=replacementFixture(ports);await assert.rejects(f.stop(),{code});assert.equal(f.forced(),0)}
});

test('a missing listener and confirmed graceful closure complete without escalation',async()=>{
  const absent=replacementFixture({probe:async()=>null});await absent.stop();assert.equal(absent.shutdownCalls(),0);
  const closed=replacementFixture({wait:async()=>true});await closed.stop();assert.equal(closed.shutdownCalls(),1);assert.equal(closed.forced(),0);
});
