import assert from 'node:assert/strict';
import {
  CREDIT_AUTO_MODE_SMART,
  CREDIT_SYNC_MODE_FORECAST,
  CREDIT_SYNC_MODE_QUICK,
  CREDIT_SYNC_MODE_RECOVERY,
  creditSmartSyncMode,
  normalizeCreditAutoMode,
  normalizeCreditFetchMode,
  resolveCreditAutoSyncMode,
} from '../shared/credit-sync-policy.js';

const now=new Date('2026-09-24T12:00:00.000Z');
function monthKey(index){return `${Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`}
const current=2026*12+8;
function account({from=current-4,to=current+12,fetchedAt='2026-09-23T12:00:00.000Z',status='fresh'}={}){
  return {accountNumber:'1111',months:Array.from({length:to-from+1},(_,offset)=>({month:monthKey(from+offset),status,fetchStatus:status==='fresh'?'success':'provider_error',fetchedAt}))};
}
function sync(accounts=[account()],mappings={'p:1111':{included:true}}){return {profiles:[{profileId:'p',accounts}],cardMappings:mappings}}

assert.equal(normalizeCreditFetchMode('daily'),CREDIT_SYNC_MODE_QUICK,'legacy daily maps to the new quick scope');
assert.equal(normalizeCreditFetchMode('full'),CREDIT_SYNC_MODE_RECOVERY,'legacy full preserves its old 130-day recovery semantics');
assert.equal(normalizeCreditFetchMode('forecast'),CREDIT_SYNC_MODE_FORECAST);
assert.equal(normalizeCreditAutoMode(''),CREDIT_AUTO_MODE_SMART,'new installations default to smart automatic policy');
assert.equal(normalizeCreditAutoMode('daily'),CREDIT_SYNC_MODE_QUICK,'an existing explicit daily preference remains quick-only');
assert.equal(normalizeCreditAutoMode('full'),CREDIT_SYNC_MODE_RECOVERY,'an existing explicit full preference remains recovery');

assert.equal(creditSmartSyncMode({}, {now,profileIds:['p']}),CREDIT_SYNC_MODE_RECOVERY,'smart mode bootstraps a locally configured profile without cloud coverage using recovery');
assert.equal(creditSmartSyncMode(sync(),{now,profileIds:['p']}),CREDIT_SYNC_MODE_QUICK,'fresh historical baseline and a fresh 12-month forecast use the cheap daily quick scope');
assert.equal(creditSmartSyncMode(sync(),{now,profileIds:['p','new-local-profile']}),CREDIT_SYNC_MODE_RECOVERY,'smart mode bootstraps recovery when a locally configured profile has no cloud baseline yet');
assert.equal(creditSmartSyncMode(sync([account({fetchedAt:'2026-09-16T11:59:59.000Z'})]),{now,profileIds:['p']}),CREDIT_SYNC_MODE_FORECAST,'forecast data older than one week is refreshed without rescanning 130 history days');
assert.equal(creditSmartSyncMode(sync([account({from:current-1})]),{now,profileIds:['p']}),CREDIT_SYNC_MODE_RECOVERY,'smart mode detects that no recovery baseline exists even when near-term data is present');
const missingFar=account();missingFar.months=missingFar.months.filter(row=>row.month!==monthKey(current+12));
assert.equal(creditSmartSyncMode(sync([missingFar]),{now,profileIds:['p']}),CREDIT_SYNC_MODE_FORECAST,'a missing far forecast month triggers forecast refresh');
assert.equal(creditSmartSyncMode(sync([account({from:current-1})],{'p:1111':{included:false}}),{now,profileIds:['p']}),CREDIT_SYNC_MODE_QUICK,'cards explicitly excluded from scraping do not force expensive recovery or forecast work');
assert.equal(resolveCreditAutoSyncMode('forecast',sync(),{now,profileIds:['p']}),CREDIT_SYNC_MODE_FORECAST,'explicit auto policy bypasses smart selection');

console.log('PASS credit sync policy: quick/forecast/recovery scopes and smart weekly/bootstrap decisions are deterministic');
