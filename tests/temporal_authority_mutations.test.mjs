import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCreditRefreshResult} from '../shared/credit-refresh-result.js';
import {mergeCreditSyncResult as merge} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {creditRefreshDue,financeRefreshDelayMs,CREDIT_AUTO_INTERVAL_MS} from '../shared/finance-refresh-policy.js';
import {creditRetryAfterAt} from '../shared/credit-cooldown-policy.js';
const root=new URL('../shared/',import.meta.url),now=Date.parse('2026-10-16T10:00:00Z'),far='2099-01-01T00:00:00Z';
const read=name=>readFileSync(new URL(name,root),'utf8').replaceAll('\r\n','\n');
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
function remove(source,guard,replacement='') {
  assert.equal(source.split(guard).length,2,'remove exactly one actual guard');return source.replace(guard,replacement);
}
async function load(name,source,observation) {
  source=source.replace(/(['"])\.\/([^'"]+)\1/g,(_,quote,path)=>JSON.stringify(observation&&path==='observation-time.js'?observation:new URL(path,root).href));
  return import(data(source));
}
for(const [name,guard,patch,select] of [
  ['envelope',"observationFields(value, ['syncedAt'], now);",raw=>{raw.syncedAt=far},row=>row.syncedAt],
  ['profile',"observationFields(profile, ['syncedAt', 'attemptedAt'], now);",raw=>{raw.profiles[0].syncedAt=far},row=>row.profiles[0].syncedAt],
  ['account',"observationFields(account, ['frameFetchedAt', 'pendingFetchedAt'], now);",raw=>{raw.profiles[0].accounts[0].pendingFetchedAt=far},row=>row.profiles[0].accounts[0].pendingFetchedAt],
  ['month',"observationFields(month, ['fetchedAt'], now);",raw=>{raw.profiles[0].accounts[0].months[0].fetchedAt=far},row=>row.profiles[0].accounts[0].months[0].fetchedAt],
])test('removing the actual '+name+' observation guard restores poisoned retained Credit time',async()=>{
  const raw={contractVersion:2,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'C',pendingStatus:'success',pendingTransactions:[],months:[{month:'2026-10',fetchStatus:'success',transactions:[]}]}]}]};patch(raw);
  assert.throws(()=>readCreditRefreshResult(raw,now),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  const decoder=await load('credit-refresh-result.js',remove(read('credit-refresh-result.js'),guard,';'));
  assert.equal(Date.parse(select(merge({},decoder.readCreditRefreshResult(raw,now)))),Date.parse(far));
});
test('removing the shared future guard restores false freshness and an unbounded scheduler delay',async()=>{
  const observation=data(remove(read('observation-time.js'),'return time <= now + OBSERVATION_FUTURE_TOLERANCE_MS ? time : null;','return time;'));
  const policy=await load('finance-refresh-policy.js',read('finance-refresh-policy.js'),observation);
  assert.equal(creditRefreshDue(far,now),true);assert.equal(policy.creditRefreshDue(far,now),false);
  assert.equal(financeRefreshDelayMs(far,CREDIT_AUTO_INTERVAL_MS,now),0);
  assert.ok(policy.financeRefreshDelayMs(far,CREDIT_AUTO_INTERVAL_MS,now)>365*86400000);
});
test('removing the actual cooldown ceiling restores indefinite issuer deferral',async()=>{
  const failure={at:new Date(now).toISOString(),retryAfterAt:far};
  const policy=await load('credit-cooldown-policy.js',remove(read('credit-cooldown-policy.js'),
    'Math.min(Date.parse(row.retryAfterAt), failedAt + CREDIT_MAX_AUTO_COOLDOWN_MS)','Date.parse(row.retryAfterAt)'));
  assert.equal(Date.parse(creditRetryAfterAt(failure,now)),now+86400000);
  assert.equal(Date.parse(policy.creditRetryAfterAt(failure,now)),Date.parse(far));
});
