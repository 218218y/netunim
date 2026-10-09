import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarAuth} from '../netunim-orders/site/assets/js/calendar/auth.js';
import {createCalendarApi} from '../netunim-orders/site/assets/js/calendar/api.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const changed=error=>error.code==='CALENDAR_OPERATION_SCOPE_CHANGED';
const token=owner=>({access_token:'token-'+owner,expires_in:3600,account_id:owner+'@example.test'});
function fixture(request=async(_path,options)=>{options.assertRequestScope?.();return new Response(JSON.stringify(token('A')))}){
  let scope={owner:'A',epoch:1};const calendarSession={accessToken:'',tokenExpiresAt:0,connected:false,accountVerified:false,accountId:'',expectedAccountId:''};
  const auth=createCalendarAuth({calendarSession,supaFetch:request,accountScope:()=>scope});
  return {auth,calendarSession,currentScope:()=>scope,scope:value=>{scope=value}};
}
for(const replacement of [{owner:null,epoch:2},{owner:'B',epoch:2},{owner:'A',epoch:2}]){
  test(`Calendar cached authority closes on ${JSON.stringify(replacement)}`,async()=>{
    const f=fixture();await f.auth.restore();f.scope(replacement);
    assert.equal(f.auth.hasUsableToken(),false);assert.throws(()=>f.auth.accessToken());assert.equal(f.calendarSession.connected,false);
  });
  test(`Calendar token response cannot publish after ${JSON.stringify(replacement)}`,async()=>{
    const held=deferred(),f=fixture(()=>held.promise),pending=f.auth.restore();const rejected=assert.rejects(pending,changed);
    f.scope(replacement);held.resolve(new Response(JSON.stringify(token('A'))));await rejected;assert.equal(f.calendarSession.accessToken,'');
  });
}
test('Calendar response body is scoped independently of response headers',async()=>{
  const body=deferred(),entered=deferred(),f=fixture(async()=>({ok:true,json:()=>{entered.resolve();return body.promise}}));
  const rejected=assert.rejects(f.auth.restore(),changed);await entered.promise;f.scope({owner:'B',epoch:2});body.resolve(token('A'));await rejected;
  assert.equal(f.calendarSession.accessToken,'');
});
test('a new Calendar account acquires its own token while the former restore is pending',async()=>{
  const held=deferred();let requests=0;const f=fixture(async()=>++requests===1?held.promise:new Response(JSON.stringify(token('B'))));
  const old=f.auth.restore(),oldOutcome=old.then(()=>null,error=>error);f.scope({owner:'B',epoch:2});const current=f.auth.restore();
  held.resolve(new Response(JSON.stringify(token('A'))));assert.equal(await current,'token-B');assert.equal((await oldOutcome)?.code,'CALENDAR_OPERATION_SCOPE_CHANGED');
  assert.equal(requests,2);assert.equal(f.auth.accessToken(),'token-B');
});
test('same-login access-token refresh keeps Calendar authority usable',async()=>{
  const f=fixture();await f.auth.restore();f.scope({owner:'A',epoch:1});assert.equal(f.auth.hasUsableToken(),true);assert.equal(await f.auth.restore(),'token-A');
});
test('a former failed Calendar restore cannot erase a newer credential or impose its cooldown',async()=>{
  const held=deferred();let requests=0;const f=fixture(async()=>++requests===1?held.promise:new Response(JSON.stringify(token('B'))));
  const old=f.auth.restore().then(()=>null,error=>error);f.scope({owner:'B',epoch:2});await f.auth.restore();
  held.resolve(new Response(JSON.stringify({code:'calendar_data_api_unavailable'}),{status:503}));assert.equal((await old)?.code,'CALENDAR_OPERATION_SCOPE_CHANGED');assert.equal(f.auth.accessToken(),'token-B');
  f.auth.clearToken();assert.equal(await f.auth.restore(),'token-B');assert.equal(requests,3);
});
test('Calendar recovery backoff is retained within its owner and closes before another request',async t=>{
  let requests=0;const f=fixture(async()=>{requests++;return new Response(JSON.stringify({code:'calendar_data_api_unavailable'}),{status:503})});
  t.mock.method(Date,'now',()=>100_000);await assert.rejects(f.auth.restore(),error=>error.retryAfterMs===15_000);
  await assert.rejects(f.auth.restore(),error=>error.retryAfterMs===15_000);assert.equal(requests,1);
});
test('Calendar API rejects an old response body and cannot clear a newer account token on late 401',async t=>{
  const f=fixture(async()=>new Response(JSON.stringify(token(f.currentScope().owner))));await f.auth.restore();
  const body=deferred(),entered=deferred();t.mock.method(globalThis,'fetch',async()=>({ok:false,status:401,text:()=>{entered.resolve();return body.promise}}));
  const api=createCalendarApi({calendarAuth:f.auth}),outcome=api.listCalendars().then(()=>null,error=>error);await entered.promise;
  f.scope({owner:'B',epoch:2});await f.auth.restore();body.resolve(JSON.stringify({error:{message:'expired'}}));
  assert.equal((await outcome)?.code,'CALENDAR_OPERATION_SCOPE_CHANGED');assert.equal(f.auth.accessToken(),'token-B');
});
