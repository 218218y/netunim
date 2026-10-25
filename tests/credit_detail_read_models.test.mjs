import test from 'node:test';
import assert from 'node:assert/strict';
import {selectKupaCreditDetail} from '../netunim-kupa/site/assets/js/domains/credit/detail-read-model.js';
import {selectOrdersCreditDetail} from '../netunim-orders/site/assets/js/domains/finance/credit-detail-read-model.js';

const query={creditDetailMode:'month',creditDetailChargeDay:'all',creditDetailFocus:null,
  creditAccountFilter:'all',creditProviderFilter:'all',creditCardFilter:'all',
  creditView:'all',creditDateFrom:'',creditDateTo:''};
const row=(id,date,extra={})=>({id,date,creditAccountKey:'card-a',card:'Card A',account:'עסקי',provider:'max',
  amount:10,amountStatus:'known_ils',includedInIlsTotal:true,...extra});
const past=row('past','2026-09-10');
const due=row('due','2026-10-10');
const later=row('later','2026-10-15',{creditAccountKey:'card-b',card:'Card B',account:'ביתי'});
const future=row('future','2026-11-10');
const unknown=row('unknown','',{amount:0,amountStatus:'unknown_amount',includedInIlsTotal:false,coverageIncomplete:true});
const months=[
  {key:'2026-09',total:10,items:[past]},
  {key:'2026-10',total:20,items:[due,later]},
  {key:'2026-11',total:10,items:[future]},
  {key:'unassigned',total:0,items:[unknown]},
];
function freeze(value){
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}
  return value;
}
function run(kind,overrides={},matches=()=>true){
  const options=freeze({query:{...query,...overrides},reference:'2026-10-05',matches});
  const data=freeze(structuredClone({months,upcoming:[due,later,unknown]}));
  const before=JSON.stringify(data);
  const report=kind==='kupa'
    ?selectKupaCreditDetail({...options,prepared:{detail:{months:data.months},upcoming:{items:data.upcoming}}})
    :selectOrdersCreditDetail({...options,allMonths:data.months,upcomingRows:data.upcoming});
  assert.equal(JSON.stringify(data),before);
  return kind==='kupa'?{...report,items:report.detailItems,focus:report.detailFocus}:report;
}

for(const kind of ['kupa','orders']){
  test(`${kind}: pure detail reads preserve history, card focus and invalid-focus recovery`,()=>{
    assert.deepEqual(run(kind).items.map(row=>row.id),['due','later']);
    const selected={monthKey:'2026-09',cardKey:'card-a'};
    assert.deepEqual(run(kind,{creditDetailFocus:selected}).items.map(row=>row.id),['past']);
    assert.deepEqual(run(kind,{creditDetailFocus:{monthKey:'2026-10',cardKey:'absent'}}).focus,{monthKey:'2026-10',cardKey:''});
    assert.deepEqual(run(kind,{creditDetailFocus:{monthKey:'missing',cardKey:'card-b'}}).focus,{monthKey:'2026-10',cardKey:''});
  });
  test(`${kind}: range/all/recent periods and search retain complete counts and row identity`,()=>{
    const all=run(kind,{creditDetailMode:'all'},row=>row.id==='future');
    assert.equal(all.focusedCount,5);
    assert.deepEqual(all.items.map(row=>row.id),['future']);
    assert.deepEqual(run(kind,{creditDetailMode:'recent3'}).items.map(row=>row.id),['past']);
    assert.deepEqual(run(kind,{creditDetailMode:'range',creditDateFrom:'2026-10-10',creditDateTo:'2026-10-10'}).items.map(row=>row.id),['due']);
    assert.equal(run(kind,{creditDetailMode:'range'}).items.some(row=>row.id==='unknown'),false);
  });
  test(`${kind}: upcoming day filters and search do not change the full upcoming total`,()=>{
    const report=run(kind,{creditDetailMode:'upcoming',creditDetailChargeDay:'10'},()=>false);
    assert.deepEqual(report.items,[]);
    assert.equal(report.focusedCount,1);
    assert.equal(report.upcomingTotal,20);
    assert.deepEqual(run(kind,{creditDetailMode:'invalid'}).items.map(row=>row.id),['due','later','unknown']);
  });
  test(`${kind}: empty input cannot invent a month or detail row`,()=>{
    const args={query,reference:'2026-10-05',matches:()=>true};
    const result=kind==='kupa'?selectKupaCreditDetail({...args,prepared:{detail:{months:[]},upcoming:{items:[]}}})
      :selectOrdersCreditDetail({...args,allMonths:[],upcomingRows:[]});
    assert.equal(result.focusedCount,0);
    assert.equal(kind==='kupa'?result.detailFocus:result.focus,null);
  });
}

test('Kupa filters retained rows and recomputes partial totals before applying search',()=>{
  const filtered=run('kupa',{creditDetailMode:'all',creditAccountFilter:'עסקי'});
  assert.deepEqual(filtered.items.map(row=>row.id),['past','due','future','unknown']);
  const unknownMonth=filtered.detailMonths.find(month=>month.key==='unassigned');
  assert.equal(unknownMonth.partial,true);
  assert.equal(unknownMonth.missingAmountCount,1);
  assert.equal(unknownMonth.coverageGapCount,1);
  assert.equal(unknownMonth.total,0);
});

test('the applications retain their distinct nearest-month policies',()=>{
  const oldCurrent={key:'2026-10',total:10,items:[row('old-current','2026-10-01',{detailCycleBillingDate:'2026-10-20'})]};
  const futureMonth={key:'2026-11',total:10,items:[future]};
  const args={query,reference:'2026-10-05',matches:()=>true};
  const kupa=selectKupaCreditDetail({...args,prepared:{detail:{months:[oldCurrent,futureMonth]},upcoming:{items:[]}}});
  const orders=selectOrdersCreditDetail({...args,allMonths:[oldCurrent,futureMonth],upcomingRows:[]});
  assert.equal(kupa.detailFocus.monthKey,'2026-11');
  assert.equal(orders.focus.monthKey,'2026-10');
});
