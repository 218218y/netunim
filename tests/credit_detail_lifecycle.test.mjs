import test from 'node:test';
import assert from 'node:assert/strict';
import {creditDetailMonthIsPast,creditDetailRangeMatch,creditDateRangeFromControl} from '../shared/credit-detail-controls.js';
import {creditHistoryCutoffMonth,creditCardCompare} from '../shared/credit-history.js';
import {kupaReconciledCreditDetailMonthsData,kupaReconciledCreditUpcomingDetailData} from '../shared/kupa-cashflow.js';
import * as kupaFeed from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import * as ordersFeed from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';

function fixture(){
  return {credits:[],creditSync:{version:4,profiles:[{profileId:'cards',provider:'max',accounts:['a','b','c'].map((accountNumber,index)=>({accountNumber,txns:['2026-09','2026-10'].map(month=>({id:`${accountNumber}-${month}`,processedDate:`${month}-${index===2?'15':'10'}`,transactionDate:index===0?'2026-08-30':'2026-08-01',chargedAmount:-100,chargedCurrency:'ILS',status:'completed'}))}))}],cardMappings:{'cards:a':{included:true,cardName:'א',sortOrder:2},'cards:b':{included:true,cardName:'ב',sortOrder:1},'cards:c':{included:true,cardName:'ג',sortOrder:1}}}};
}

test('September moves to history after its billing dates, including current-day bank settlement',()=>{
  const state=fixture(),months=kupaReconciledCreditDetailMonthsData(state,'2026-09-16').months;
  assert.deepEqual(months.filter(month=>creditDetailMonthIsPast(month,'2026-09-16')).map(month=>month.key),['2026-09']);
  assert.deepEqual(months.filter(month=>!creditDetailMonthIsPast(month,'2026-09-16')).map(month=>month.key),['2026-10']);
  assert.equal(creditDetailMonthIsPast(months[0],'2026-09-12'),false,'a month with a later card debit remains upcoming');
  assert.equal(creditDetailMonthIsPast({key:'2026-09',items:[{date:'2026-09-15',bankSettlementState:'settled'}]},'2026-09-15'),true);
  assert.equal(creditDetailMonthIsPast({key:'2026-09',items:[{date:'2026-09-15',bankPendingSettlementDetected:true}]},'2026-09-15'),false,'a pending bank debit is not settlement');
  assert.equal(creditDetailMonthIsPast({key:'unassigned',items:[{}]},'2026-09-16'),false);
});

test('custom card order is secondary to billing date in both monthly and nearest detail',()=>{
  const state=fixture();
  const month=kupaReconciledCreditDetailMonthsData(state,'2026-09-01').months[0];
  assert.deepEqual(month.items.map(row=>row.accountNumber),['b','a','c']);
  assert.deepEqual(kupaReconciledCreditUpcomingDetailData(state,'2026-09-01').items.map(row=>row.accountNumber),['b','a','c']);
  for(const mapping of Object.values(state.creditSync.cardMappings))delete mapping.sortOrder;
  assert.deepEqual(kupaReconciledCreditUpcomingDetailData(state,'2026-09-01').items.map(row=>row.accountNumber),['a','b','c']);
  assert.ok(creditCardCompare({creditAccountKey:'sync:p:1',card:'זהה'},{creditAccountKey:'sync:q:1',card:'זהה'})<0,'same names still have deterministic distinct card identities');
});

test('date range uses inclusive billing dates, not purchase dates, with open boundaries',()=>{
  const rows=kupaReconciledCreditDetailMonthsData(fixture(),'2026-09-16').months.flatMap(month=>month.items);
  assert.deepEqual(rows.filter(row=>creditDetailRangeMatch(row,'2026-09-15','2026-10-10')).map(row=>row.date),['2026-09-15','2026-10-10','2026-10-10']);
  assert.equal(rows.filter(row=>creditDetailRangeMatch(row,'','2026-09-10')).length,2);
  assert.equal(rows.filter(row=>creditDetailRangeMatch(row,'2026-10-15','')).length,1);
  assert.equal(creditDetailRangeMatch({date:'',detailDisplayBillingDate:'2026-10-10'},'2026-10-10','2026-10-10'),true);
  assert.equal(creditDetailRangeMatch({},'',''),false);
  let error='';const from={value:'2026-10-15',reportValidity:()=>true},to={value:'2026-10-10',setCustomValidity:value=>{error=value},reportValidity:()=>!error};
  const element={closest:()=>({querySelector:selector=>selector.includes('from')?from:to})};
  assert.equal(creditDateRangeFromControl(element),null);
  to.value='2026-10-15';assert.deepEqual(creditDateRangeFromControl(element),{from:'2026-10-15',to:'2026-10-15'});
});

for(const [app,feed] of [['kupa',kupaFeed],['orders',ordersFeed]])test(`${app}: ordinary merges accumulate twelve historical months, prune older months, keep future and preferences`,()=>{
  const slice=month=>({month,status:'fresh',fetchStatus:'success',fetchedAt:'2026-09-01T00:00:00Z',transactions:[{id:month,processedDate:`${month}-10`,chargedAmount:-10}]}),state=fixture().creditSync;
  state.profiles[0].accounts=[{accountNumber:'a',months:['2025-08','2025-09','2026-03','2026-06','2026-07','2026-08','2026-09','2027-01'].map(slice)}];
  const source=structuredClone(state),payload={syncedAt:'2026-09-16T00:00:00Z',profiles:[{profileId:'cards',provider:'max',accounts:[{accountNumber:'a',months:[slice('2026-09'),slice('2026-10')]}]}]};
  const merged=feed.mergeCreditSyncResult(state,payload),account=merged.profiles[0].accounts[0];
  assert.deepEqual(account.months.map(row=>row.month).sort(),['2025-09','2026-03','2026-06','2026-07','2026-08','2026-09','2026-10','2027-01']);
  assert.equal(account.txns.some(row=>row.id==='2025-08'),false);
  assert.equal(merged.cardMappings['cards:a'].sortOrder,2);
  const stored=JSON.parse(JSON.stringify(merged));assert.equal('txns' in stored.profiles[0].accounts[0],false,'cloud payload has no duplicate legacy transactions');
  assert.equal(feed.normalizeCreditSync(stored).cardMappings['cards:a'].sortOrder,2);
  const next=feed.mergeCreditSyncResult(stored,{syncedAt:'2026-10-01T00:00:00Z',profiles:[]});
  assert.equal(next.profiles[0].accounts[0].months.some(row=>row.month==='2025-09'),false);
  assert.deepEqual(state,source,'read/merge never mutates the input');
  assert.equal(creditHistoryCutoffMonth('2027-01-01'),'2026-01');
  assert.equal(creditHistoryCutoffMonth('invalid'),'');
});
