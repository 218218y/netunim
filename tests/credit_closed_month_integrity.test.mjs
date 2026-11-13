import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { creditSyncScope } from '../netunim-kupa/bank-bridge/credit-sync-scope.mjs';
import { genericMonthlyAccount } from '../netunim-kupa/bank-bridge/credit-monthly-projection.mjs';
import { readCreditRefreshResult } from '../shared/credit-refresh-result.js';
import { mergeCreditSyncResult as kupaMerge } from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import { mergeCreditSyncResult as ordersMerge } from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {createKupaCreditRefresh} from '../netunim-kupa/site/assets/js/domains/credit/refresh.js';
import {createOrdersCreditRefresh} from '../netunim-orders/site/assets/js/domains/finance/credit-refresh.js';

function completed(month, id) {
  return {
    id,
    status: 'completed',
    processedDate: `${month}-10T12:00:00Z`,
    date: `${month}-08T12:00:00Z`,
    chargedAmount: -100,
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedCurrency: 'ILS',
    description: 'Synthetic only',
  };
}
const txns = [
  completed('2026-07', 'jul'),
  completed('2026-08', 'aug'),
  completed('2026-09', 'sep'),
  completed('2026-10', 'oct'),
  { ...completed('2026-10', 'foreign'), processedDate: null,
    originalCurrency: 'USD', chargedAmount: null, foreignTransaction: true },
];
function projected(mode, stamp, explicitStartDate = null) {
  const now = new Date(stamp);
  const scope = creditSyncScope({ syncMode: mode, now });
  if (explicitStartDate) scope.startDate = new Date(explicitStartDate);
  return genericMonthlyAccount(
    { accountNumber: '0042', txns },
    'isracard',
    { ...scope, now },
    'fixture-no-real-card-data',
  );
}
function monthlyIds(account, month) {
  return account.months.find(x => x.month === month)?.transactions.map(t => t.id) ?? [];
}

test('rolling quick/forecast/recovery windows all begin at month start', () => {
  assert.equal(creditSyncScope({ syncMode: 'quick', now: new Date('2026-11-13T12:00:00Z') }).startDate.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(creditSyncScope({ syncMode: 'forecast', now: new Date('2026-10-28T12:00:00Z') }).startDate.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(creditSyncScope({ syncMode: 'recovery', now: new Date('2026-11-13T12:00:00Z') }).startDate.toISOString(), '2026-07-01T00:00:00.000Z');
});

test('producer never drops first-half transactions when plan starts on a midmonth day', () => {
  const sep = projected('quick', '2026-10-28T12:00:00Z', '2026-09-28T12:00:00Z');
  const oct = projected('quick', '2026-11-13T12:00:00Z', '2026-10-14T12:00:00Z');
  assert.deepEqual(monthlyIds(sep, '2026-09'), ['sep']);
  assert.deepEqual(monthlyIds(oct, '2026-10'), ['oct']);
});

test('original production projection reproduces September/October loss using actual upstream date filtering', async () => {
  const file = new URL('../netunim-kupa/bank-bridge/credit-monthly-projection.mjs', import.meta.url);
  const source = JSON.parse(readFileSync(new URL('./fixtures/credit-monthly-projection-before-integrity.json',import.meta.url),'utf8')).source
    .replace(/(['"])\.\/([^'"]+)\1/g, (_, q, path) => JSON.stringify(new URL(path, file).href));
  const old = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  for(const [stamp, cutoff, month] of [
    ['2026-10-28T12:00:00Z','2026-09-28T12:00:00Z','2026-09'],
    ['2026-11-13T12:00:00Z','2026-10-14T12:00:00Z','2026-10'],
  ]){
    const now=new Date(stamp), startDate=new Date(cutoff);
    const lost=old.genericMonthlyAccount({accountNumber:'0042',txns},'isracard',{startDate,futureMonths:1,now});
    assert.deepEqual(monthlyIds(lost,month),[]);
    assert.equal(lost.months.find(row=>row.month===month).fetchStatus,'success');
    const scope=creditSyncScope({syncMode:'quick',now});
    // Emulate a provider which honors startDate before the Bridge sees the rows.
    const fetched=txns.filter(tx=>!tx.processedDate||Date.parse(tx.processedDate)>=scope.startDate.getTime());
    const complete=genericMonthlyAccount({accountNumber:'0042',txns:fetched},'isracard',{...scope,now});
    assert.equal(monthlyIds(complete,month).length,1);
  }
});

for (const [name, merge] of [['Kupa', kupaMerge], ['Orders', ordersMerge]]) {
  const envelope = (transactions, stamp = '2026-11-13T12:00:00Z') => readCreditRefreshResult({
    contractVersion: 2, syncedAt: stamp, correlationId: 'synthetic-regression',
    profiles: [{ profileId: 'P', provider: 'isracard', syncedAt: stamp, attemptedAt: stamp,
      coreComplete: true, accounts: [{ accountNumber: '0042', months: [{
        month: '2026-10', tier: 'core', fetchStatus: 'success', fetchedAt: stamp, transactions,
      }] }] }], errors: [],
  }, Date.parse(stamp) + 60_000);
  const original = [completed('2026-10', 'first'), completed('2026-10', 'second')];
  const initial = () => merge({ cardMappings: { 'P:0042': { included: true } } },
    envelope(original, '2026-10-28T12:00:00Z'));

  test(`${name} quarantines successful historical shrinkage, substitution and monetary changes`, () => {
    for (const incoming of [[], original.slice(1), [original[1], {...original[1], id:'replacement'}],
      [original[0], {...original[1], chargedAmount: -1}]]) {
      const before = initial(), serialized = JSON.stringify(before);
      const result = merge(before, envelope(incoming));
      const profile = result.profiles[0], month = profile.accounts[0].months[0];
      assert.deepEqual(month.transactions, before.profiles[0].accounts[0].months[0].transactions);
      assert.equal(month.fetchedAt, '2026-10-28T12:00:00.000Z');
      assert.equal(month.status, 'stale');
      assert.equal(month.lastErrorCode, 'CREDIT_HISTORICAL_MONTH_REGRESSION');
      assert.equal(profile.coreComplete, false);
      assert.equal(profile.syncedAt, before.profiles[0].syncedAt);
      assert.equal(result.syncedAt, before.syncedAt);
      assert.equal(result.errors[0].code, 'CREDIT_HISTORICAL_MONTH_REGRESSION');
      assert.equal(result.errors[0].month, '2026-10');
      assert.equal(result.errors[0].correlationId, 'synthetic-regression');
      assert.equal(JSON.stringify(before), serialized);
      const restored = merge(JSON.parse(JSON.stringify(result)), envelope(original));
      assert.deepEqual(monthlyIds(restored.profiles[0].accounts[0], '2026-10'), ['first', 'second']);
      assert.equal(restored.profiles[0].coreComplete, true);
      assert.equal(restored.errors.length, 0);
    }
  });

  test(`${name} accepts complete reordered history, late charges and refunds; current month stays mutable`, () => {
    const late = {...completed('2026-10', 'refund'), chargedAmount: 25};
    const result = merge(initial(), envelope([original[1], late, {...original[0], description:'Updated label'}]));
    assert.equal(result.profiles[0].accounts[0].months[0].transactions.length, 3);
    assert.equal(result.errors.length, 0);
    const open = merge({cardMappings:{'P:0042':{included:true}}},envelope(original,'2026-10-09T12:00:00Z'));
    const current = merge(open, envelope([], '2026-10-09T18:00:00Z'));
    assert.deepEqual(monthlyIds(current.profiles[0].accounts[0], '2026-10'), []);
    const elapsed = merge(initial(), envelope([], '2026-10-29T12:00:00Z'));
    assert.deepEqual(monthlyIds(elapsed.profiles[0].accounts[0], '2026-10'), ['first','second']);
    assert.equal(elapsed.errors[0].code,'CREDIT_HISTORICAL_MONTH_REGRESSION');
  });

  test(`${name} refresh owner publishes preserved history and reports merge integrity errors to the UI`, async(t)=>{
    t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-13T13:00:00Z')});
    const guard=()=>{},status={bridgeVersion:83,contractVersion:2,profiles:[{profileId:'P'}]};
    let sync=initial(),published=null,releases=0;
    const owner=(name==='Kupa'?createKupaCreditRefresh:createOrdersCreditRefresh)({
      authority:{capture:()=>guard},cloud:{refresh:async()=>({verified:true,state:{}}),readSync:()=>sync},
      device:{capture:()=>guard,readStatus:async()=>status,status:()=>status,error:()=>'',supported:()=>true,
        sync:async()=>envelope([]),refreshStatus:async()=>status,reportFailure:guard},
      leases:{createToken:()=> 'T',reportFailure:guard,commands:{acquire:(leaseName,leaseToken)=>({
        ready:Promise.resolve({acquired:true,leaseName,leaseToken,fenceEpoch:1,assertCurrent:guard}),
        assertCurrent:guard,close:async()=>{releases++;}})},runtime:{isPending:()=>false,drain:async()=>{},dispose:()=>true}},
      policy:{normalizeMode:()=> 'forecast',resolveMode:()=> 'quick',selection:()=>[],lastSyncAt:value=>value.syncedAt,merge},
      publication:{commit:async mutate=>{sync=mutate({creditSync:sync}).creditSync;return {saved:true}},
        publish:async candidate=>{sync=candidate}},
      automation:{allowed:()=>true,currentEpoch:()=>1,due:()=>true,mode:()=> 'smart',markAttempt:()=>true},
    });
    try{
      await owner.commands.refresh({allowed:()=>true,onDenied:guard,onDeferred:guard,onWarning:guard,
        onPublished:(...args)=>{published=args[name==='Kupa'?0:1]},
        onFailed:error=>assert.fail(error.message),onDiagnosticsWarning:guard,onDiagnosticsFailed:guard,onFailureFinished:guard});
      assert.deepEqual(monthlyIds(sync.profiles[0].accounts[0],'2026-10'),['first','second']);
      assert.equal(published.errors[0].code,'CREDIT_HISTORICAL_MONTH_REGRESSION');
      assert.equal(releases,1);
    }finally{await owner.runtime.drain();owner.runtime.dispose()}
  });

  test(`${name} protects legacy undated rows on failure and historical multiplicity without stable IDs`, () => {
    const before=initial();
    before.profiles[0].accounts[0].months[0].fetchedAt=null;
    const failed=envelope([]);
    const raw=structuredClone(failed);raw.profiles[0].coreComplete=false;
    raw.profiles[0].accounts[0].months[0].fetchStatus='network_error';
    const result=merge(before,raw);
    assert.deepEqual(monthlyIds(result.profiles[0].accounts[0],'2026-10'),['first','second']);
    const anonymous=original.map(tx=>({...tx,id:''}));
    const saved=merge({cardMappings:{'P:0042':{included:true}}},envelope(anonymous,'2026-10-28T12:00:00Z'));
    const blocked=merge(saved,envelope(anonymous.slice(1)));
    assert.equal(blocked.profiles[0].accounts[0].months[0].transactions.length,2);
  });

  test(`${name} retains July–October after successive quick syncs and recovery`, () => {
    let retained = { cardMappings: { 'P:0042': { included: true, account: 'ביתי' } } };
    for (const [mode, date] of [
      ['recovery', '2026-10-01T12:00:00Z'],
      ['quick', '2026-10-28T12:00:00Z'],
      ['quick', '2026-11-13T12:00:00Z'],
      ['recovery', '2026-11-13T12:00:00Z'],
    ]) {
      const account = projected(mode, date);
      const envelope = readCreditRefreshResult({
        contractVersion: 2,
        syncedAt: date,
        profiles: [{ profileId: 'P', provider: 'isracard', coreComplete: true, accounts: [account] }],
      }, Date.parse(date) + 60_000);
      retained = merge(retained, envelope);
      const persisted = retained.profiles[0].accounts[0];
      for (const [month, id] of [
        ['2026-07', 'jul'], ['2026-08', 'aug'], ['2026-09', 'sep'], ['2026-10', 'oct'],
      ]) assert.deepEqual(monthlyIds(persisted, month), [id], `${mode} ${date} ${month}`);
      assert.equal(persisted.unassignedTransactions.some(tx => tx.id === 'foreign'), true);
    }
  });
}

test('disabling the actual shared history guard recreates silent loss in both real merge implementations', async()=>{
  const file=new URL('../shared/credit-month-integrity.js',import.meta.url);
  const source=readFileSync(file,'utf8');
  const changed=source.replace('if(protectedRows.length)','if(false)');
  assert.notEqual(source,changed);
  const mutated='data:text/javascript;base64,'+Buffer.from(changed).toString('base64');
  for(const path of ['../netunim-kupa/site/assets/js/domains/credit/sync-feed.js','../netunim-orders/site/assets/js/domains/finance/credit-feed.js']){
    const feed=new URL(path,import.meta.url);
    const code=readFileSync(feed,'utf8').replace(/(['"])\.\.\/\.\.\/shared\/credit-month-integrity\.js\1/,JSON.stringify(mutated))
      .replace(/(['"])(\.\.?\/[^'"]+)\1/g,(_,q,relative)=>JSON.stringify(new URL(relative,feed).href));
    const {mergeCreditSyncResult:merge}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
    const payload=transactions=>({syncedAt:'2026-11-13T12:00:00Z',profiles:[{profileId:'P',accounts:[{accountNumber:'0042',months:[{month:'2026-10',fetchStatus:'success',fetchedAt:'2026-11-13T12:00:00Z',transactions}]}]}]});
    const before=merge({cardMappings:{'P:0042':{included:true}}},payload([completed('2026-10','retained')]));
    assert.deepEqual(monthlyIds(merge(before,payload([])).profiles[0].accounts[0],'2026-10'),[]);
  }
});
