import test from 'node:test';
import assert from 'node:assert/strict';
import * as kupaValues from '../netunim-kupa/site/assets/js/core/values.js';
import * as orderValues from '../netunim-orders/site/assets/js/core/values.js';
import * as kupaDates from '../netunim-kupa/site/assets/js/core/dates.js';
import * as orderDates from '../netunim-orders/site/assets/js/core/dates.js';
import * as kupaChecks from '../netunim-kupa/site/assets/js/domains/checks/model.js';
import * as orderChecks from '../netunim-orders/site/assets/js/domains/checks/model.js';
import * as kupaCashflow from '../netunim-kupa/site/assets/js/shared/cashflow.js';
import * as orderCashflow from '../netunim-orders/site/assets/js/shared/cashflow.js';

test('HTML escaping contracts agree for text and quoted attributes',()=>{
 for(const value of ['',null,undefined,0,123,`'"<&>`,['a','b'],'שלום😀']){
   assert.equal(kupaValues.esc(value),orderValues.esc(value));
   assert.doesNotMatch(kupaValues.esc(value),/[<>"']/);
 }
});
test('common calendar display and check-number contracts agree at boundaries',()=>{
 assert.equal(kupaDates.dateFmt('2024-02-29'),'29.02.2024');
 assert.equal(kupaChecks.nextSeriesCheckNumber('0099',1),'0100');
 assert.equal(kupaValues.esc('<"&\'>'),'&lt;&quot;&amp;&#39;&gt;');
 for(const value of ['',null,undefined,'2024-02-29','2026-12-31','2000-01-01']){
   assert.equal(kupaDates.monthKey(value),orderDates.checkMonthKey(value));
   assert.equal(kupaDates.dateFmt(value),orderDates.checkDateFmt(value));
   assert.deepEqual(kupaDates.checkDateParts(value),orderDates.checkDateParts(value));
 }
 for(const value of ['',null,undefined,'0001',' 09 ','A12','0'])for(const offset of [0,1,12])assert.equal(kupaChecks.nextSeriesCheckNumber(value,offset),orderChecks.nextSeriesCheckNumber(value,offset));
});
test('intentional app differences are preserved, not deduplicated by name',()=>{
 assert.throws(()=>kupaDates.addMonthsISO('',1));
 assert.equal(orderDates.checkAddMonthsISO('',1),'');
 assert.equal(Object.hasOwn(kupaValues.clone({x:undefined}),'x'),false);
 assert.equal(Object.hasOwn(orderValues.clone({x:undefined}),'x'),true);
 // Kupa's finite-number guard returns zero; Orders retains NaN for this input.
 assert.equal(kupaChecks.normalizeSharedChecks([{id:'C',amount:'1,200'}])[0].amount,0);
 assert.ok(Number.isNaN(orderChecks.normalizeSharedChecks([{id:'C',amount:'1,200'}])[0].amount));
});

test('shared cashflow thresholds and alert semantics agree across both apps',()=>{
 const raw={businessMinimum:5000,homeMinimum:3000};
 assert.deepEqual(kupaCashflow.normalizeCashflowSettings(raw),orderCashflow.normalizeCashflowSettings(raw));
 assert.deepEqual(kupaCashflow.normalizeCashflowSettings({businessMinimum:-50,homeMinimum:''}),{version:1,businessMinimum:0,homeMinimum:null});
 for(const api of [kupaCashflow,orderCashflow]){
   assert.equal(api.cashflowAlertForAccount(-1,raw,'עסקי').reason,'negative','any projected overdraft warns even below/above a configured threshold');
   assert.equal(api.cashflowAlertForAccount(4500,raw,'עסקי').reason,'minimum','a positive projected balance below the configured business floor warns');
   assert.equal(api.cashflowAlertForAccount(5500,raw,'עסקי').active,false);
   assert.equal(api.cashflowAlertForAccount(2500,raw,'ביתי').active,true,'home uses its own independent threshold');
   assert.equal(api.cashflowAlertForAccount(4000,raw,'ביתי').active,false);
 }
});
