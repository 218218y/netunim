import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseHistory} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-history.js';
import {readExpenseSearch} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-search.js';

const caps={version:1,environment:'sandbox'};
const paged=items=>({...caps,page:0,pageSize:50,pages:items.length?1:0,total:items.length,items});
const filter=(kind,value)=>({dataset:{expenseHistoryFilter:kind},value});
function fixture(request) {
  globalThis.document={querySelector:()=>null};
  return createExpenseHistory({request,capabilities:()=>caps,capture:()=>()=>{},run:work=>work(),todayISO:()=> '2026-10-28'});
}

test('year navigation reads at most its six periods; exact empty period never scans adjacent months',async()=>{
  const calls=[],history=fixture(async(_,body)=>{calls.push(body);return paged([]);});
  await history.chooseFilter(filter('year','2024'));
  assert.deepEqual(calls.map(body=>body.fromDate),[11,9,7,5,3,1].map(month=>'2024-'+String(month).padStart(2,'0')+'-01'));
  assert.equal(history.more(),false);assert.ok(!history.markup().includes('data-expense-history-more'));
  calls.length=0;await history.chooseFilter(filter('period','2024-03'));
  assert.deepEqual(calls.map(body=>[body.fromDate,body.toDate]),[['2024-03-01','2024-04-01']]);assert.equal(history.more(),false);
  await history.refresh();assert.equal(calls.length,2);assert.equal(calls[1].fromDate,'2024-03-01');
  assert.equal(history.chooseFilter(filter('period','2023-03')),false);
  assert.equal(history.chooseFilter(filter('year','2027')),false);
  await history.chooseFilter(filter('year','2026'));
  assert.ok(!history.markup().includes('value="2026-11"'));
});

test('filter changes fence delayed pages, preserve matching searches and restore the default order',async()=>{
  let release,held=true;const calls=[];
  const history=fixture(async(_,body)=>{calls.push(body);if(held){held=false;await new Promise(resolve=>release=resolve);}
    return paged(body.fromDate==='2025-03-01'?[{id:'one',kind:'expense',status:10,number:'matching',reportingDate:'2025-04-01',sourceDocumentDate:'2024-12-01'}]:[]);
  });
  const older=history.more();await history.chooseFilter(filter('year','2025'));release();await older;
  assert.ok(calls.slice(1).every(body=>body.fromDate.startsWith('2025')));
  await history.chooseFilter(filter('period','2025-03'));history.setQuery('matching');await history.search();
  assert.equal(calls.at(-1).fromDate,'2025-03-01');assert.equal(calls.at(-1).toDate,'2025-04-01');
  assert.match(history.markup(),/החיפוש הושלם בטווח שנבחר/);
  assert.match(history.markup(),/matching/);
  history.clearSearch();await history.chooseFilter(filter('year',''));
  assert.equal(calls.at(-6).fromDate,'2026-09-01');assert.match(history.markup(),/כל השנים · מהחדש לישן/);
  history.reset();assert.ok(history.markup().includes('data-expense-history-filter="period" data-change="morning-expense-history-filter" disabled'));
});

test('search rejects provider rows outside the selected reporting range before publishing',async()=>{
  const range={fromDate:'2025-03-01',toDate:'2025-04-01'};
  await assert.rejects(readExpenseSearch(async()=>paged([{id:'one',kind:'expense',status:10,number:'matching',reportingDate:'2024-04-01'}]),caps,'matching',()=>{},{filter:range}),/אינן שייכות/);
});
