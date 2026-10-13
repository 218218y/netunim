import test from 'node:test';
import assert from 'node:assert/strict';
import {creditProviderFixture,creditProfile,gate} from './bank_provider_fixture.mjs';

test('credit profiles remain sequential, retain identity exclusions and isolate raw samples',async()=>{
  const entered=gate(),held=gate(),order=[];
  const f=creditProviderFixture({sessions:{scrape:async(profile,options)=>{order.push(profile.profileId);if(profile.profileId==='first'){entered.resolve();await held.promise}
    assert.deepEqual([...options.excludedAccountNumbers],profile.profileId==='first'?['0007']:[]);
    return {profileId:profile.profileId,coreComplete:profile.profileId==='first',_dataDiagnostics:[{profileId:profile.profileId,raw:'local-only'}]};
  }}});
  const flight=f.scrape([creditProfile('first'),creditProfile('second'),{...creditProfile('inactive'),active:false},creditProfile('unsupported','unknown')],{selection:[{profileId:'first',excludedAccounts:['0007']}]});
  await entered.promise;assert.deepEqual(order,['first']);held.resolve();const result=await flight;
  assert.deepEqual(order,['first','second']);assert.equal(result.attemptedCount,2);assert.equal(result.coreSuccessCount,1);assert.ok(result.syncedAt);
  assert.equal(result._dataDiagnostics.length,2);assert.ok(!JSON.stringify(result.profiles).includes('local-only'));
});

test('issuer-wide deferral skips an attempt while Camoufox-only deferral still permits Chromium',async()=>{
  const future=new Date(Date.now()+3600000).toISOString(),previousErrors=[
    {profileId:'blocked',provider:'max',code:'CREDIT_PROVIDER_RATE_LIMITED',retryAfterAt:future,at:'2026-10-13T00:00:00Z'},
    {profileId:'amex',provider:'amex',code:'CREDIT_AUTOMATION_BLOCKED',stage:'LoginPage',httpStatus:403,browserEngine:'camoufox',retryAfterAt:future,at:'2026-10-13T00:00:00Z'},
  ];
  const f=creditProviderFixture();const result=await f.scrape([creditProfile('blocked'),creditProfile('amex','amex')],{previousErrors});
  assert.equal(result.attemptedCount,1);assert.equal(result.deferredCount,1);assert.equal(result.errors[0].deferred,true);
  const attempt=f.calls.find(row=>row[0]==='scrape');assert.equal(attempt[1],'amex');assert.equal(attempt[2].allowCamoufoxFallback,false);
});

test('expired blocked identity is removed and its diagnostic settles before a new provider session',async()=>{
  const removed=gate(),held=gate(),order=[];
  const f=creditProviderFixture({identity:{remove:async()=>{order.push('identity');removed.resolve();await held.promise}},diagnostics:{record:async event=>order.push(event.stage)},sessions:{scrape:async()=>{order.push('scrape');return {coreComplete:true}}}});
  const flight=f.scrape([creditProfile('amex','amex')],{previousErrors:[{profileId:'amex',provider:'amex',code:'CREDIT_AUTOMATION_BLOCKED',stage:'LoginPage',httpStatus:403,browserEngine:'camoufox',retryAfterAt:'2020-01-01T00:00:00Z'}]});
  await removed.promise;assert.deepEqual(order,['identity']);held.resolve();await flight;assert.deepEqual(order,['identity','IdentityRecovery','scrape']);
});

test('failed Chromium retains the prior Camoufox cooldown and the original diagnostic fields',async()=>{
  const prior={profileId:'amex',provider:'amex',code:'CREDIT_AUTOMATION_BLOCKED',stage:'LoginPage',httpStatus:403,browserEngine:'camoufox',retryAfterAt:new Date(Date.now()+3600000).toISOString()};
  const f=creditProviderFixture({sessions:{scrape:async()=>{throw Object.assign(new Error('fixture issuer failure'),{code:'CREDIT_LOGIN_FAILED',stage:'LoginFlow',httpStatus:503,browserEngine:'chromium',loginStep:'credentials-submit',loginState:'session-auth-only'})}}});
  const result=await f.scrape([creditProfile('amex','amex')],{previousErrors:[prior]});assert.equal(result.errors.length,2);assert.equal(result.syncedAt,null);
  assert.equal(result.errors[0].code,'CREDIT_LOGIN_FAILED');assert.equal(result.errors[0].loginState,'session-auth-only');assert.equal(result.errors[1].browserEngine,'camoufox');assert.equal(result.errors[1].deferred,true);
  const event=f.calls.find(row=>row[0]==='diagnostic')[1];assert.equal(event.httpStatus,503);assert.equal(event.loginStep,'credentials-submit');
});

test('no enabled credit profile is rejected before any identity or provider effect',async()=>{
  const f=creditProviderFixture();await assert.rejects(f.scrape([{...creditProfile('off'),active:false}]),{code:'CREDIT_NOT_CONFIGURED'});assert.deepEqual(f.calls,[]);
});
