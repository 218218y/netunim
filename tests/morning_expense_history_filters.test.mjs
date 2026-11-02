import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseHistory} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-history.js';
import {readExpenseSearch} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-search.js';

const caps={version:1,environment:'sandbox'};
const paged=items=>({...caps,page:0,pageSize:50,pages:items.length?1:0,total:items.length,items});
const filter=(kind,value)=>({dataset:{expenseHistoryFilter:kind},value});
function fixture(request, {todayISO=()=> '2028-10-28',reportRequest}={}) {
  globalThis.document={querySelector:()=>null};
  return createExpenseHistory({request,reportRequest,capabilities:()=>caps,capture:()=>()=>{},run:work=>work(),todayISO});
}

test('default VAT reads the active reporting bimonth without restricting history and manual periods win',async()=>{
  const reads=[],reports=[];let today='2026-11-14';
  const history=fixture(async(_,body)=>{reads.push(body);return paged([]);},{todayISO:()=>today,
    reportRequest:async(action,body)=>{assert.equal(action,'report_page');reports.push(body);
      return {...caps,...body,pageSize:50,total:0,pages:0,readAt:'2026-11-14T08:00:00Z',items:[]};}});
  await history.refresh();
  assert.equal(reads[0].fromDate,'2026-11-01');
  assert.ok(reports.length===2&&reports.every(r=>r.fromDate==='2026-09-01'&&r.toDate==='2026-10-31'));
  assert.match(history.markup(),/ספטמבר–אוקטובר 2026/);
  assert.match(history.markup(),/value="" selected>כל התקופות/);
  await history.chooseFilter(filter('period','2026-03'));today='2026-11-15';await history.refresh();
  assert.equal(reports.at(-1).fromDate,'2026-03-01');
  await history.chooseFilter(filter('period',''));
  assert.equal(reports.at(-1).fromDate,'2026-11-01');
  today='2027-01-14';await history.refresh();assert.equal(reports.at(-1).fromDate,'2026-11-01');
  today='2027-01-15';await history.refresh();assert.equal(reports.at(-1).fromDate,'2027-01-01');
  await history.chooseFilter(filter('year','2026'));assert.equal(reports.at(-1).fromDate,'2026-01-01');
  await history.chooseFilter(filter('period','2026-07'));assert.equal(reports.at(-1).fromDate,'2026-07-01');
  await history.chooseFilter(filter('year',''));assert.equal(reports.at(-1).fromDate,'2027-01-01');
});

test('year navigation reads at most its six periods; exact empty period never scans adjacent months',async()=>{
  const calls=[],history=fixture(async(_,body)=>{calls.push(body);return paged([]);});
  await history.chooseFilter(filter('year','2026'));
  assert.deepEqual(calls.map(body=>body.fromDate),[11,9,7,5,3,1].map(month=>'2026-'+String(month).padStart(2,'0')+'-01'));
  assert.equal(history.more(),false);assert.ok(!history.markup().includes('data-expense-history-more'));
  calls.length=0;await history.chooseFilter(filter('period','2026-03'));
  assert.deepEqual(calls.map(body=>[body.fromDate,body.toDate]),[['2026-03-01','2026-04-01']]);assert.equal(history.more(),false);
  await history.refresh();assert.equal(calls.length,2);assert.equal(calls[1].fromDate,'2026-03-01');
  assert.equal(history.chooseFilter(filter('period','2025-03')),false);
  assert.equal(history.chooseFilter(filter('year','2029')),false);
  await history.chooseFilter(filter('year','2028'));
  assert.ok(!history.markup().includes('value="2028-11"'));
  for(const year of ['2026','2027','2028'])assert.ok(history.markup().includes('value="'+year+'"'));
  assert.ok(!history.markup().includes('value="2025"'));
});

test('filter changes fence delayed pages, preserve matching searches and restore the default order',async()=>{
  let release,held=true;const calls=[];
  const history=fixture(async(_,body)=>{calls.push(body);if(held){held=false;await new Promise(resolve=>release=resolve);}
    return paged(body.fromDate==='2027-03-01'?[{id:'one',kind:'expense',status:10,number:'matching',reportingDate:'2027-04-01',sourceDocumentDate:'2026-12-01'}]:[]);
  });
  const older=history.more();await history.chooseFilter(filter('year','2027'));release();await older;
  assert.ok(calls.slice(1).every(body=>body.fromDate.startsWith('2027')));
  await history.chooseFilter(filter('period','2027-03'));history.setQuery('matching');await history.search();
  assert.equal(calls.at(-1).fromDate,'2027-03-01');assert.equal(calls.at(-1).toDate,'2027-04-01');
  assert.match(history.markup(),/החיפוש הושלם בטווח שנבחר/);
  assert.match(history.markup(),/matching/);
  history.clearSearch();await history.chooseFilter(filter('year',''));
  assert.equal(calls.at(-6).fromDate,'2028-09-01');assert.match(history.markup(),/כל השנים · מהחדש לישן/);
  history.reset();assert.ok(!history.markup().includes('data-expense-history-filter="period" data-change="morning-expense-history-filter" disabled'));
  calls.length=0;await history.chooseFilter(filter('period','2028-03'));
  assert.equal(calls[0].fromDate,'2028-03-01');assert.equal(calls[0].toDate,'2028-04-01');
  assert.match(history.markup(),/value="" selected>כל השנים/);assert.equal(history.chooseFilter(filter('period','2027-03')),false);
});

test('search rejects provider rows outside the selected reporting range before publishing',async()=>{
  const range={fromDate:'2027-03-01',toDate:'2027-04-01'};
  await assert.rejects(readExpenseSearch(async()=>paged([{id:'one',kind:'expense',status:10,number:'matching',reportingDate:'2026-04-01'}]),caps,'matching',()=>{},{filter:range}),/אינן שייכות/);
});
