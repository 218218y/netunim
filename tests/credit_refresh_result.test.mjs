import test from 'node:test';
import assert from 'node:assert/strict';
import {readCreditRefreshResult,readCreditStatusProfiles,readCreditFailureIssues,creditIssuesDeferred} from '../shared/credit-refresh-result.js';

test('Credit envelope retains valid provider fields and accepts supported responses without counters',()=>{
 const old={syncedAt:'2026-10-14T10:00:00Z',profiles:[{profileId:'P',accounts:[{accountNumber:'C',txns:[{id:'T',amount:null}]}]}],errors:[]};
 assert.deepEqual(readCreditRefreshResult(old),old);
 const current={...old,attemptedCount:1,deferredCount:0,runId:'run'};
 assert.deepEqual(readCreditRefreshResult(current),current);
 assert.ok(Object.isFrozen(readCreditRefreshResult(current)));
});
for(const value of [null,false,true,'0','1','',[],{},-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
 for(const field of ['attemptedCount','deferredCount'])test('Credit rejects coercible/invalid '+field+': '+String(value),()=>{
  assert.throws(()=>readCreditRefreshResult({profiles:[],errors:[],[field]:value}),{code:'CREDIT_REFRESH_RESULT_INVALID'});
 });
}
for(const value of [null,[],false,'ready',42])test('Credit rejects a non-object network envelope: '+String(value),()=>{
 assert.throws(()=>readCreditRefreshResult(value),{code:'CREDIT_REFRESH_RESULT_INVALID'});
});
test('Credit profile/error arrays reject malformed rows without retaining a subset',()=>{
 for(const value of [null,{},false,[null],[false],[42],['profile'],[{profileId:'P'},null]]){
  for(const field of ['profiles','errors'])assert.throws(()=>readCreditRefreshResult({profiles:[],[field]:value}),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  assert.deepEqual(readCreditFailureIssues({creditErrors:value}),[]);
 }
});
test('Credit status profile IDs must be real nonempty strings before request planning',()=>{
 for(const profiles of [null,{},[{}],[{profileId:null}],[{profileId:42}],[{profileId:''}],[{profileId:' '}],[{profileId:'P'},false]])
  assert.throws(()=>readCreditStatusProfiles({profiles}),{code:'CREDIT_REFRESH_RESULT_INVALID'});
 assert.deepEqual(readCreditStatusProfiles({}),[]);
 assert.deepEqual(readCreditStatusProfiles({profiles:[{profileId:'P',label:'Max'}]}),[{profileId:'P',label:'Max'}]);
});
test('Credit successful response requires profile evidence and rejects empty envelopes or invalid identities',()=>{
 for(const result of [{},{ok:true},{syncedAt:'2026-10-14T10:00:00Z'},{profiles:[{}]},{profiles:[{profileId:42}]}])
  assert.throws(()=>readCreditRefreshResult(result),{code:'CREDIT_REFRESH_RESULT_INVALID'});
 assert.throws(()=>readCreditRefreshResult({profiles:new Array(1)}),{code:'CREDIT_REFRESH_RESULT_INVALID'});
 assert.deepEqual(readCreditFailureIssues({creditErrors:new Array(1)}),[]);
});
test('Only every decoded diagnostic being deferred authorizes cooldown presentation',()=>{
 assert.equal(creditIssuesDeferred(readCreditFailureIssues({creditErrors:[{severity:'deferred'},{deferred:true}]})),true);
 for(const creditErrors of [[],[{deferred:'true'}],[{severity:'deferred'},null],[{severity:'deferred'},{severity:'error'}]])
  assert.equal(creditIssuesDeferred(readCreditFailureIssues({creditErrors})),false);
});
