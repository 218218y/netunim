import test from 'node:test';
import assert from 'node:assert/strict';
import { readCreditRefreshResult } from '../shared/credit-refresh-result.js';
import { bankAutoRefreshDue, creditRefreshDue } from '../shared/finance-refresh-policy.js';
import { creditSmartSyncMode } from '../shared/credit-sync-policy.js';
import { mergeCreditSyncResult as kupaMerge } from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import { mergeCreditSyncResult as ordersMerge } from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';

const stamp = '2026-10-16T10:00:00Z', now = Date.parse(stamp);
const result = () => ({contractVersion:2,syncedAt:stamp,profiles:[{profileId:'P',provider:'max',syncedAt:stamp,attemptedAt:stamp,
  accounts:[{accountNumber:'C',frameFetchedAt:stamp,pendingFetchedAt:stamp,months:[{month:'2026-10',fetchStatus:'success',fetchedAt:stamp,transactions:[]}]}]}]});
const paths = [['syncedAt'],['profiles',0,'syncedAt'],['profiles',0,'attemptedAt'],['profiles',0,'accounts',0,'frameFetchedAt'],
  ['profiles',0,'accounts',0,'pendingFetchedAt'],['profiles',0,'accounts',0,'months',0,'fetchedAt']];
for (const [name,merge] of [['Kupa',kupaMerge],['Orders',ordersMerge]]) {
  test(name+' rejects every supplied invalid observation before retained-feed merge', () => {
    const initial=merge({cardMappings:{'P:C':{included:true}}},readCreditRefreshResult(result(),now)),before=structuredClone(initial);
    for (const path of paths) for (const bad of ['2099-01-01T00:00:00Z','2026-02-30T00:00:00Z','2026-10-16','2026-10-16T10:00:00',false,123,[],{}]) {
      const raw=result();let target=raw;
      for(const key of path.slice(0,-1))target=target[key];
      target[path.at(-1)]=bad;
      assert.throws(()=>merge(initial,readCreditRefreshResult(raw,now)),{code:'CREDIT_REFRESH_RESULT_INVALID'});
      assert.deepEqual(initial,before);
    }
  });
}
test('observation validation preserves future billing dates and intentional retry deadlines', () => {
  const raw=result(),account=raw.profiles[0].accounts[0];
  account.balanceDate='2027-01-10';raw.errors=[{retryAfterAt:'2026-10-17T10:00:00Z'}];
  account.frameFetchedAt=null;account.pendingFetchedAt=null;
  assert.deepEqual(readCreditRefreshResult(raw,now),raw);
});
test('persisted future or malformed Bank/Credit observations are due on a second client', () => {
  for(const due of [bankAutoRefreshDue,creditRefreshDue]) {
    for(const bad of ['2099-01-01T00:00:00Z','2026-02-30T00:00:00Z','bad',null,false,[],{}])assert.equal(due(bad,now),true);
    assert.equal(due(stamp,now),false);
    assert.equal(due('2026-10-16T13:00:00+03:00',now),false);
    assert.equal(due(new Date(now+300001).toISOString(),now),true);
    assert.equal(due(new Date(now+300000).toISOString(),now),false);
  }
});
test('a far future forecast observation cannot keep smart refresh in quick mode', () => {
  const current=2026*12+9;
  const months=Array.from({length:17},(_,i)=>{const index=current-4+i;return {
    month:`${Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`,status:'fresh',fetchStatus:'success',fetchedAt:stamp};});
  const sync={profiles:[{profileId:'P',accounts:[{accountNumber:'C',months}]}]};
  assert.equal(creditSmartSyncMode(sync,{now:new Date(now)}),'quick');
  months.at(-1).fetchedAt='2099-01-01T00:00:00Z';
  assert.equal(creditSmartSyncMode(sync,{now:new Date(now)}),'forecast');
});
