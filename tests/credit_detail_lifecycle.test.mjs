import test from 'node:test';
import assert from 'node:assert/strict';
import {creditDetailMonthIsPast,creditDetailRangeMatch,creditDetailRecentThreeRange,creditDetailQuickPeriodMatch,creditDateRangeFromControl,creditDetailDayMatch,creditDetailNominalChargeDay,creditDetailChargeCycleKey,creditDetailFutureMonths} from '../shared/credit-detail-controls.js';
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

test('custom card order outranks billing date in both monthly and nearest detail',()=>{
  const state=fixture();
  state.creditSync.cardMappings['cards:a'].sortOrder=3;state.creditSync.cardMappings['cards:b'].sortOrder=2;state.creditSync.cardMappings['cards:c'].sortOrder=1;
  const month=kupaReconciledCreditDetailMonthsData(state,'2026-09-01').months[0];
  assert.deepEqual(month.items.map(row=>row.accountNumber),['c','b','a'],'rank 1 on a later billing date stays before ranks 2 and 3');
  assert.deepEqual(kupaReconciledCreditUpcomingDetailData(state,'2026-09-01').items.map(row=>row.accountNumber),['c','b','a'],'nearest detail uses the same user-defined card precedence');
  for(const mapping of Object.values(state.creditSync.cardMappings))delete mapping.sortOrder;
  assert.deepEqual(kupaReconciledCreditUpcomingDetailData(state,'2026-09-01').items.map(row=>row.accountNumber),['a','b','c']);
  assert.ok(creditCardCompare({creditAccountKey:'sync:p:1',card:'זהה'},{creditAccountKey:'sync:q:1',card:'זהה'})<0,'same names still have deterministic distinct card identities');
});

test('Saturday-shifted actual debit stays in the nominal day-10 cycle',()=>{
  const scheduled={date:'2026-10-10'},shifted={date:'2026-10-11'};
  assert.equal(new Date(Date.UTC(2026,9,10)).getUTCDay(),6,'fixture proves 10 October 2026 is Saturday');
  assert.equal(creditDetailNominalChargeDay(scheduled),'10');
  assert.equal(creditDetailNominalChargeDay(shifted),'10');
  assert.equal(creditDetailChargeCycleKey(scheduled),creditDetailChargeCycleKey(shifted),'10th and Sunday 11th render as one nominal billing cycle');
  assert.equal(creditDetailDayMatch(shifted,'10'),true,'the day-10 filter includes the actual Sunday debit');
});

test('future-month menu omits a month that is already fully represented by nearest-charge cycles',()=>{
  const october={key:'2026-10',items:[
    {creditAccountKey:'sync:max:6326',date:'2026-10-11',description:'regular'},
    {creditAccountKey:'sync:max:6326',date:'2026-10-02',detailCycleBillingDate:'2026-10-11',foreignCurrency:true,description:'FX'},
  ]},november={key:'2026-11',items:[{creditAccountKey:'sync:max:6326',date:'2026-11-10',description:'later'}]},upcoming=october.items;
  assert.deepEqual(creditDetailFutureMonths([october,november],upcoming).map(month=>month.key),['2026-11'],'a month that would duplicate the complete nearest-charge view is not offered again as a future month');
  const partialOctober={...october,items:[...october.items,{creditAccountKey:'sync:max:7777',date:'2026-10-15',description:'later card cycle'}]};
  assert.deepEqual(creditDetailFutureMonths([partialOctober,november],upcoming).map(month=>month.key),['2026-10','2026-11'],'a month with another card-cycle not present in nearest-charge stays reachable');
  assert.deepEqual(creditDetailFutureMonths([october,november],upcoming,'2026-10').map(month=>month.key),['2026-10','2026-11'],'an already selected redundant month remains represented while the user is viewing it');
});

test('foreign immediate debits are assigned to the enclosing statement cycle without changing their real debit date',()=>{
  const state={credits:[],creditSync:{version:4,profiles:[{profileId:'max',provider:'max',accounts:[{accountNumber:'6326',balanceDate:'2026-10-11',txns:[
    {id:'before',status:'completed',processedDate:'2026-10-02',transactionDate:'2026-09-30',chargedAmount:-110,chargedCurrency:'ILS',originalAmount:-110,originalCurrency:'ILS',foreignTransaction:true,description:'AKUSOLI'},
    {id:'after',status:'completed',processedDate:'2026-10-12',transactionDate:'2026-10-12',chargedAmount:-20,chargedCurrency:'ILS',originalAmount:-20,originalCurrency:'ILS',foreignTransaction:true,description:'AFTER-CYCLE'},
    {id:'regular-sep',status:'completed',processedDate:'2026-09-10',transactionDate:'2026-09-01',chargedAmount:-500,chargedCurrency:'ILS'},
    {id:'regular-aug',status:'completed',processedDate:'2026-08-10',transactionDate:'2026-08-01',chargedAmount:-500,chargedCurrency:'ILS'},
  ]}]}],cardMappings:{'max:6326':{included:true,cardName:'MAX 6326',account:'עסקי'}}}};
  const detail=kupaReconciledCreditDetailMonthsData(state,'2026-10-04').months,october=detail.find(month=>month.key==='2026-10'),november=detail.find(month=>month.key==='2026-11'),before=october.items.find(row=>row.description==='AKUSOLI'),after=november.items.find(row=>row.description==='AFTER-CYCLE');
  assert.equal(before.date,'2026-10-02');assert.equal(before.detailCycleBillingDate,'2026-10-11');assert.equal(creditDetailNominalChargeDay(before),'10');assert.equal(creditDetailChargeCycleKey(before),'2026-10:10');
  assert.equal(after.date,'2026-10-12');assert.equal(after.detailCycleBillingDate,'2026-11-10','a debit after the current cycle closes belongs to the following statement cycle');
  assert.equal(creditDetailRangeMatch(before,'2026-10-02','2026-10-02'),true);assert.equal(creditDetailRangeMatch(before,'2026-10-11','2026-10-11'),false,'date range filtering continues to mean the actual debit date');
  assert.equal(creditDetailMonthIsPast({key:'2026-10',items:[{...before,bankSettlementState:'settled'}]},'2026-10-04'),false,'an already-settled immediate debit does not make its still-open statement cycle historical');
  assert.equal(kupaReconciledCreditUpcomingDetailData(state,'2026-10-04').items.some(row=>row.description==='AKUSOLI'),true,'the default upcoming statement includes the immediate foreign debit inside the open cycle window');
});

test('credit quick periods include all cached detail and the current plus two prior calendar months through today',()=>{
  assert.deepEqual(creditDetailRecentThreeRange('2026-10-05'),{from:'2026-08-01',to:'2026-10-05'});
  assert.equal(creditDetailQuickPeriodMatch({},'all','2026-10-05'),true,'All must keep undated cached detail');
  assert.equal(creditDetailQuickPeriodMatch({date:'2026-08-01'},'recent3','2026-10-05'),true);
  assert.equal(creditDetailQuickPeriodMatch({date:'2026-07-31'},'recent3','2026-10-05'),false);
  assert.equal(creditDetailQuickPeriodMatch({date:'2026-10-05'},'recent3','2026-10-05'),true);
  assert.equal(creditDetailQuickPeriodMatch({date:'2026-10-06'},'recent3','2026-10-05'),false,'future charges are not part of the last three months');
  assert.equal(creditDetailQuickPeriodMatch({},'recent3','2026-10-05'),false);
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
