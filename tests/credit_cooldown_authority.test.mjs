import test from 'node:test';
import assert from 'node:assert/strict';
import {creditRetryAfterAt,CREDIT_MAX_AUTO_COOLDOWN_MS} from '../shared/credit-cooldown-policy.js';
import {creditAutomaticRetryAfterAt,deferredCreditProfileError,deferredCamoufoxProfileError,expiredCamoufoxLoginPageBlock} from '../netunim-kupa/bank-bridge/credit-failure-policy.mjs';
import {createCreditProvider} from '../netunim-kupa/bank-bridge/credit-provider.mjs';
import {sanitizeCreditDiagnosticEvent} from '../netunim-kupa/bank-bridge/credit-diagnostic-model.mjs';
import {parseRetryAfter} from '../netunim-kupa/bank-bridge/credit-http-policy.mjs';
import {normalizeCreditSync as kupaNormalize} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {normalizeCreditSync as ordersNormalize} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';

const now=Date.parse('2026-10-16T10:00:00Z'),at=new Date(now).toISOString(),far='2099-01-01T00:00:00.000Z';
const profile={profileId:'P',provider:'amex'};
const failure={...profile,code:'CREDIT_PROVIDER_RATE_LIMITED',at,originalFailureAt:at,retryAfterAt:far,providerRetryAfterAt:far};
const end=new Date(now+CREDIT_MAX_AUTO_COOLDOWN_MS).toISOString();
test('automatic Retry-After respects shorter deadlines and caps a far provider date at 24 hours',()=>{
  assert.equal(CREDIT_MAX_AUTO_COOLDOWN_MS,24*60*60*1000);
  assert.equal(creditRetryAfterAt(failure,now),end);
  assert.equal(creditAutomaticRetryAfterAt(failure,now),end);
  const shorter=new Date(now+7200000).toISOString();
  assert.equal(creditAutomaticRetryAfterAt({...failure,retryAfterAt:shorter},now),shorter);
});
test('persisted cooldown expires from the original failure across repeated reads and clients',()=>{
  for(const elapsed of [1000,3600000,23*3600000]) {
    const deferred=deferredCreditProfileError([failure],profile,now+elapsed);
    assert.equal(deferred.retryAfterAt,end);assert.equal(deferred.originalFailureAt,at);
    assert.equal(deferred.providerRetryAfterAt,far);
  }
  assert.equal(deferredCreditProfileError([failure],profile,now+CREDIT_MAX_AUTO_COOLDOWN_MS),null);
  assert.equal(deferredCreditProfileError([failure],profile,now+CREDIT_MAX_AUTO_COOLDOWN_MS*3),null);
});
test('invalid or future original failure evidence cannot establish a cooldown',()=>{
  for(const originalFailureAt of [far,'bad','2026-02-30T00:00:00Z',false,123,{}]) {
    const error={...failure,originalFailureAt};
    assert.equal(creditRetryAfterAt(error,now),null);
    assert.equal(deferredCreditProfileError([error],profile,now),null);
  }
  assert.equal(creditRetryAfterAt({retryAfterAt:far},now),null);
});
test('Camoufox-only blocks retain engine scope and recover at the bounded deadline',()=>{
  const error={...failure,code:'CREDIT_AUTOMATION_BLOCKED',stage:'LoginPage',httpStatus:403,browserEngine:'camoufox'};
  assert.equal(deferredCreditProfileError([error],profile,now),null);
  assert.equal(deferredCamoufoxProfileError([error],profile,now).retryAfterAt,end);
  assert.equal(deferredCamoufoxProfileError([error],profile,now+CREDIT_MAX_AUTO_COOLDOWN_MS),null);
  assert.deepEqual(expiredCamoufoxLoginPageBlock([error],profile,now+CREDIT_MAX_AUTO_COOLDOWN_MS),error);
});
test('provider aggregation and sanitized diagnostics retain the raw provider date',async t=>{
  t.mock.timers.enable({apis:['Date'],now});
  const diagnostics=[],provider=createCreditProvider({sessions:{scrape:async()=>{throw Object.assign(new Error('limited'),failure)}},identity:{remove:async()=>{}},diagnostics:{record:event=>diagnostics.push(event)}});
  const result=await provider.scrape([profile]);
  assert.equal(result.errors[0].retryAfterAt,end);assert.equal(result.errors[0].providerRetryAfterAt,far);
  const diagnostic=sanitizeCreditDiagnosticEvent(diagnostics[0]);
  assert.equal(diagnostic.retryAfterAt,end);assert.equal(diagnostic.providerRetryAfterAt,far);
});
test('a component cannot choose its own reference clock or retain a rejected raw deadline',async t=>{
  t.mock.timers.enable({apis:['Date'],now});
  const provider=createCreditProvider({sessions:{scrape:async()=>({...profile,errors:[{...failure,at:far,originalFailureAt:far}]})},identity:{remove:async()=>{}},diagnostics:{record:()=>{}}});
  const result=await provider.scrape([profile]);
  assert.equal(result.errors[0].retryAfterAt,null);
  assert.equal(result.errors[0].providerRetryAfterAt,far);
});
for(const [name,normalize] of [['Kupa',kupaNormalize],['Orders',ordersNormalize]])test(name+' retains provider evidence and bounds historical cooldown without moving its origin',t=>{
  t.mock.timers.enable({apis:['Date'],now});
  const first=normalize({errors:[failure]});
  assert.equal(first.errors[0].retryAfterAt,end);assert.equal(first.errors[0].providerRetryAfterAt,far);
  t.mock.timers.tick(3600000);
  assert.deepEqual(normalize(first).errors,first.errors);
});
test('all Retry-After parsing survives an unrepresentable numeric deadline',()=>{
  assert.equal(parseRetryAfter('7200',now),new Date(now+7200000).toISOString());
  assert.equal(parseRetryAfter('Thu, 01 Jan 2099 00:00:00 GMT',now),far);
  for(const value of ['1e30','1e300','garbage'])assert.equal(parseRetryAfter(value,now),null);
});
