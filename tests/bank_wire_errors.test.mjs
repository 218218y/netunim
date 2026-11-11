import test from 'node:test';
import assert from 'node:assert/strict';
import {bankBridgeErrorResponse, bankBridgeCreditErrors} from '../netunim-kupa/bank-bridge/wire-errors.mjs';
import {httpFixture} from './bank_http_fixture.mjs';

const privateText='C:\\Users\\Private Person\\Y-account-123456789.json Y:\\Finance\\invoice-private.docx customer-private password-private';
const failure=()=>Object.assign(new Error(privateText),{code:'BANK_DATA_ERROR',stage:privateText,httpStatus:503,
  availableAccounts:[{branchNumber:'001',accountNumber:'123456789',owner:privateText}],
  creditErrors:[{code:'CREDIT_INVALID_PASSWORD',message:privateText,stage:'Login',stack:privateText,password:privateText}]});
function assertPrivate(data){
  const json=JSON.stringify(data);
  for(const text of ['C:\\Users', 'Y:\\Finance', 'invoice-private', 'Private Person', 'customer-private', '123456789', 'password-private'])assert.ok(!json.includes(text),json);
}

test('known and unknown native failures cannot forward private messages or arbitrary fields',()=>{
  for(const code of ['BANK_DATA_ERROR',privateText,'EACCES',undefined]){
    const error=failure();error.code=code;
    const result=bankBridgeErrorResponse(error);
    assertPrivate(result);assert.equal(result.stage,'');assert.equal(result.httpStatus,503);
    assert.equal(result.creditErrors[0].code,'CREDIT_INVALID_PASSWORD');
    assert.equal(result.creditErrors[0].stage,'Login');
    assert.equal(result.availableAccounts.length,0);
  }
});

test('streaming errors are sanitized after the provider has already started',async t=>{
  const f=await httpFixture(t,{providerPorts:{scrapeHapoalimSnapshot:async(_credentials,{onProgress})=>{
    onProgress('business');throw failure();
  }}});
  const response=await f.request('/balance',{method:'POST',body:'{"streamProgress":true}'});
  assert.equal(response.status,200);
  const frames=response.bytes.toString().trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(frames[0].progress.stage,'business');
  assert.equal(frames.at(-1).result.code,'BANK_DATA_ERROR');
  assertPrivate(frames);
});

test('account selection retains only the required numeric account descriptors',()=>{
  const result=bankBridgeErrorResponse({...failure(),code:'ACCOUNT_NOT_FOUND',stage:'account',accountRole:'home'});
  assert.deepEqual(result.availableAccounts,[{bankNumber:'12',branchNumber:'001',accountNumber:'123456789',accountId:'001-123456789'}]);
  assert.equal(result.accountRole,'home');assert.ok(!JSON.stringify(result).includes('customer-private'));
});

test('credit errors retain bounded scheduling evidence and provider identity',()=>{
  const at='2026-11-11T10:00:00.000Z';
  const [error]=bankBridgeCreditErrors([{code:'CREDIT_PROVIDER_RATE_LIMITED',message:privateText,
    at,originalFailureAt:at,retryAfterAt:'2026-11-11T11:00:00.000Z',provider:'max',profileId:'P',
    browserEngine:'camoufox',severity:'warning',component:'frames',month:'2026-11',accountSuffix:'1234',label:privateText}]);
  assertPrivate(error);assert.equal(error.originalFailureAt,at);assert.equal(error.profileId,'P');
  assert.equal(error.retryAfterAt,'2026-11-11T11:00:00.000Z');assert.equal(error.browserEngine,'camoufox');
  assert.equal(bankBridgeCreditErrors(Array(150).fill(failure())).length,100);
});

test('HTTP errors, persisted bank status and partial credit results use the safe boundary',async t=>{
  const f=await httpFixture(t,{providerPorts:{
    readMeta:async()=>({lastError:privateText,lastErrorCode:'BANK_DATA_ERROR',lastWarning:privateText}),
    readCreditMeta:async()=>({lastErrors:[{...failure(),message:privateText}]}),
    scrapeHapoalimSnapshot:async()=>{throw failure()},
    scrapeAllCreditProfiles:async()=>({profiles:[{profileId:'P',errors:[{...failure(),message:privateText}]}],errors:[{...failure(),message:privateText}],attemptedCount:1}),
  }});
  for(const path of ['/status','/credit/status'])assertPrivate((await f.request(path)).data);
  for(const path of ['/balance','/v2/credit/sync'])assertPrivate((await f.request(path,{method:'POST',body:'{}'})).data);
});
