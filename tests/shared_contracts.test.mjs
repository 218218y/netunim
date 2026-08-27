import test from 'node:test';
import assert from 'node:assert/strict';
import * as kupaValues from '../netunim-kupa/site/assets/js/core/values.js';
import * as orderValues from '../netunim-orders/site/assets/js/core/values.js';
import * as kupaDates from '../netunim-kupa/site/assets/js/core/dates.js';
import * as orderDates from '../netunim-orders/site/assets/js/core/dates.js';
import * as kupaChecks from '../netunim-kupa/site/assets/js/domains/checks/model.js';
import * as orderChecks from '../netunim-orders/site/assets/js/domains/checks/model.js';

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
