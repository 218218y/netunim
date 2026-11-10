import test from 'node:test';
import assert from 'node:assert/strict';
import {completeSupabaseMfa,verifySupabaseFactor} from '../shared/supabase-mfa.js';
import {edgeFixture} from './edge_handler_fixture.mjs';
import {createCloudAuth as ordersAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createCloudAuth as kupaAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const factor={id:'33333333-3333-4333-8333-333333333333',status:'verified',factor_type:'totp',friendly_name:'Test authenticator'};
const challengeId='44444444-4444-4444-8444-444444444444';
const jwt=(aal='aal1',sub=owner)=>[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({aal,sub})).toString('base64url'),'synthetic-signature'].join('.');
const session=()=>({access_token:jwt(),refresh_token:'synthetic-lower-refresh',expires_in:3600,user:{id:owner,factors:[factor]}});
const upgraded=()=>({...session(),access_token:jwt('aal2'),refresh_token:'synthetic-verified-refresh'});
function transport(receipt=upgraded()){
  const calls=[];
  return {calls,url:'https://example.supabase.co',headers:token=>({Authorization:'Bearer '+token}),fetchRequest:async(url,init)=>{
    calls.push({url,init});return Response.json(url.endsWith('/challenge')?{id:challengeId}:receipt);
  }};
}
test('unenrolled users keep their session, but verified MFA never proceeds without a valid code or factor selection',async()=>{
  const plain={...session(),user:{id:owner}},t=transport();
  assert.equal(await completeSupabaseMfa(plain,t),plain);
  assert.equal(await completeSupabaseMfa({...plain,user:{id:owner,factors:[{...factor,status:'unverified'}]}},t).then(s=>s.user.id),owner);
  await assert.rejects(completeSupabaseMfa(session(),t),{code:'mfa_code_required'});
  const multiple={...session(),user:{id:owner,factors:[factor,{...factor,id:other}]}};
  await assert.rejects(completeSupabaseMfa(multiple,{...t,code:'000123'}),{code:'mfa_factor_required'});
  await assert.rejects(completeSupabaseMfa(multiple,{...t,code:'000123',factorId:owner}),{code:'mfa_factor_required'});
  assert.equal(t.calls.length,0);
});
test('Supa MFA exchanges the captured factor/code and accepts only a same-owner elevated receipt',async()=>{
  const original=session(),snapshot=structuredClone(original),t=transport();
  const result=await completeSupabaseMfa(original,{...t,code:'000123'});
  assert.deepEqual(original,snapshot);
  assert.equal(result.access_token,jwt('aal2'));
  assert.equal(t.calls.length,2);
  assert.equal(t.calls[0].url,`https://example.supabase.co/auth/v1/factors/${factor.id}/challenge`);
  assert.deepEqual(JSON.parse(t.calls[1].init.body),{challenge_id:challengeId,code:'000123'});
  assert.equal(t.calls[1].init.credentials,'omit');assert.equal(t.calls[1].init.redirect,'error');
  for(const bad of [{...upgraded(),access_token:jwt('aal1')},{...upgraded(),access_token:jwt('aal2',other)},
    {...upgraded(),user:{id:other}},{...upgraded(),refresh_token:undefined},{...upgraded(),expires_in:0}]){
    await assert.rejects(completeSupabaseMfa(session(),{...transport(bad),code:'000123'}),{code:'mfa_invalid_receipt'});
  }
  const enrolling={...session(),user:{id:owner,factors:[]}};
  assert.equal((await verifySupabaseFactor(enrolling,{...transport(),factorId:factor.id,code:'000123'})).access_token,jwt('aal2'));
});
test('MFA transport deadlines abort without automatic retry',async()=>{
  let calls=0,aborted=false;
  await assert.rejects(completeSupabaseMfa(session(),{...transport(),code:'000123',timeoutMs:5,fetchRequest:async(_url,{signal})=>{
    calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'))},{once:true}));
  }}),{code:'mfa_connection_failed'});
  assert.equal(calls,1);assert.equal(aborted,true);
});
for(const name of ['google-calendar-oauth','google-drive-oauth','morning-documents','morning-expenses'])test(`${name}: actual Edge boundary requires verified MFA state and matching claims`,async()=>{
  const user={id:owner,user_metadata:{aal:'aal2',factors:[]},app_metadata:{morning_expenses_read:true}};
  const accepted=async(options,{token=jwt(),factorReads=0,allowed}={})=>{
    const f=await edgeFixture(name,{user,env:{MORNING_CLIENT_ID:'test',MORNING_CLIENT_SECRET:'test'},...options});
    const response=await f.handler(new Request('https://example.supabase.co/functions/v1/'+name,{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({action:'unknown_no_side_effect',owner_id:other}),
    }));
    assert.equal(response.status!==401,allowed);
    assert.deepEqual(f.authCalls,[token]);
    assert.deepEqual(f.factorReads,Array(factorReads).fill(owner));
    assert.equal(f.operations.length+f.requests.length,0);
    return response;
  };
  for (const factors of [[],[{...factor,status:'unverified'}]]) {
    await accepted({user:{...user,factors}},{allowed:true});
    await accepted({listFactors:async()=>({data:{factors}})},{factorReads:1,allowed:true});
  }
  await accepted({user:{...user,factors:[factor]}},{allowed:false});
  await accepted({user:{...user,factors:[factor]}},{token:jwt('aal2'),allowed:true});
  await accepted({listFactors:async()=>({data:{factors:[factor]}})},{factorReads:1,allowed:false});
  await accepted({listFactors:async()=>({data:{factors:[factor]}})},{token:jwt('aal2'),factorReads:1,allowed:true});
  for (const factors of [null,{},[null],[{...factor,status:'unknown'}],[{status:'unverified'}]]) {
    await accepted({user:{...user,factors}},{allowed:false});
    await accepted({listFactors:async()=>({data:{factors}})},{factorReads:1,allowed:false});
  }
  const error=new Error('synthetic private Auth details');
  for (const listFactors of [async()=>({data:{},error:null}),async()=>({data:{factors:[]},error}),async()=>{throw error}]) {
    const response=await accepted({listFactors},{factorReads:1,allowed:false});
    assert.doesNotMatch(await response.text(),/synthetic private Auth details/);
  }
  await accepted({getUser:async()=>({data:{user},error})},{allowed:false});
  await accepted({},{token:jwt('aal2',other),allowed:false});
  await accepted({user:{...user,factors:[]}},{token:jwt('unknown'),allowed:false});
});

for(const app of ['orders','kupa'])test(`${app}: password-only and stale MFA results cannot publish credentials`,async()=>{
  const priorStorage=globalThis.localStorage,priorFetch=globalThis.fetch,values=new Map();
  globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  const api=app==='orders'?ordersAuth({}):kupaAuth({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=>'',setCloudHeaderStatus:()=>{}});
  const login=app==='orders'?api.authPassword:api.supaAuthPassword;
  const reset=app==='orders'?api.authPasswordForLocalReset:api.supaAuthPasswordForLocalReset;
  const current=app==='orders'?api.loadSession:api.loadSupaSession;
  const save=app==='orders'?api.saveSession:api.storeSupaSession;
  try{
    globalThis.fetch=async()=>Response.json(session());
    await assert.rejects(login('synthetic@example.invalid','not-a-real-password'),{code:'mfa_code_required'});
    await assert.rejects(reset('synthetic@example.invalid','not-a-real-password'),{code:'mfa_code_required'});
    assert.equal(current(),null);assert.equal(values.size,0);
    const entered=Promise.withResolvers(),release=Promise.withResolvers();
    globalThis.fetch=async url=>{
      if(url.includes('grant_type=password'))return Response.json(session());
      if(url.endsWith('/challenge'))return Response.json({id:challengeId});
      entered.resolve();await release.promise;return Response.json(upgraded());
    };
    const pending=login('synthetic@example.invalid','not-a-real-password',{code:'000123'});
    await entered.promise;
    save({...upgraded(),user:{id:other},access_token:jwt('aal2',other)});
    release.resolve();await assert.rejects(pending);
    assert.equal(current().user.id,other);
  }finally{if(priorStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=priorStorage;globalThis.fetch=priorFetch;}
});
