import test from 'node:test';
import assert from 'node:assert/strict';
import {creditSyncDiagnosticsMarkup,creditSyncHeadlineState} from '../netunim-kupa/site/assets/js/domains/credit/presentation.js';
import {creditDiagnostics,creditHeadlineState} from '../netunim-orders/site/assets/js/domains/finance/credit-status-view.js';

const at='2026-11-17T04:58:51.000Z',oldMessage='תגובת הספק אינה תואמת למחבר. בדוק אם זמין עדכון למחבר.';
const warning=(month='2027-01',overrides={})=>({provider:'max',profileId:'profile-a',code:'CREDIT_PROVIDER_SCHEMA_ERROR',
  severity:'warning',component:'forecast_transactions',tier:'forecast',month,message:oldMessage,at,originalFailureAt:at,...overrides});
const apps=[
  ['kupa',errors=>creditSyncDiagnosticsMarkup({}, {sync:{syncedAt:at,errors}}),
    errors=>creditSyncHeadlineState({}, {sync:{syncedAt:at,errors}})],
  ['orders',errors=>creditDiagnostics({kupa:{creditSync:{version:4,syncedAt:at,errors}},creditLastSyncAt:at}),
    errors=>creditHeadlineState({kupa:{creditSync:{version:4,syncedAt:at,errors}},creditLastSyncAt:at})],
];
for(const [app,render,headline] of apps){
  test(`${app}: optional MAX schema warnings explain partial forecast without claiming a connector update`,()=>{
    const errors=[warning()],before=JSON.stringify(errors),html=render(errors);
    assert.match(html,/תחזית MAX חלקית/);assert.match(html,/אינם מאומתים כחודשים ריקים/);
    assert.doesNotMatch(html,/בדוק אם זמין עדכון למחבר/);
    assert.match(html,/CREDIT_PROVIDER_SCHEMA_ERROR/);assert.match(html,/2027-01/);
    assert.equal(headline(errors).title,'הושלם עם אזהרות');assert.equal(JSON.stringify(errors),before);
  });
  test(`${app}: every month and source survives equal timestamps, with bounded summary and expandable evidence`,()=>{
    const errors=Array.from({length:22},(_,i)=>warning(`2027-${String(i%11+1).padStart(2,'0')}`,{
      profileId:i<11?'profile-a':'profile-b',diagnosticFingerprint:String(i).padStart(16,'0')}));
    const html=render(errors);
    assert.equal((html.match(/<details\b/g)||[]).length,1);
    assert.match(html,/22 הודעות/);
    for(let i=0;i<22;i++)assert.ok(html.includes(String(i).padStart(16,'0')),`missing evidence ${i}`);
    for(let month=1;month<=11;month++)assert.ok(html.includes(`2027-${String(month).padStart(2,'0')}`));
  });
  test(`${app}: core schema failures and unrelated errors keep their original actionable messages`,()=>{
    const errors=[warning(),warning('2026-11',{severity:'error',tier:'core',component:'core_transactions'})];
    const html=render(errors);assert.match(html,/תחזית MAX חלקית/);assert.match(html,/בדוק אם זמין עדכון למחבר/);
    assert.match(html,/core_transactions/);assert.match(html,/2026-11/);
    // Orders normalizes unknown tiers away before presentation; core is retained.
    const cases=[{severity:'error'},{component:'pending'},{tier:'core'},{month:'bad'},{code:'CREDIT_PROVIDER_RATE_LIMITED'}];
    if(app==='kupa')cases.push({tier:'history'});
    for(const overrides of cases)
      assert.doesNotMatch(render([warning('2027-01',overrides)]),/תחזית MAX חלקית/);
  });
  test(`${app}: diagnostic source labels and metadata remain escaped inside the disclosure`,()=>{
    const html=render([warning('2027-01',{label:'<img src=x onerror=alert(1)>',diagnosticFingerprint:'<script>bad</script>'})]);
    assert.doesNotMatch(html,/<img\b|<script\b/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);
  });
}
