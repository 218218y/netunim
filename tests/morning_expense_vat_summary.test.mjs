import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseVatSummary} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-vat-summary.js';
const row=(source,extra={})=>({id:source,kind:source==='documents'?'document':'expense',type:305,date:'2026-09-02',status:10,grossCents:11800,vatCents:1800,deductibleVatCents:450,businessType:1,...extra});
function fixture({fail=false,missing=false,refund=false,hold=null}={}){
 const calls=[],caps={environment:'sandbox'};let valid=true;
 const summary=createExpenseVatSummary({capabilities:()=>caps,capture:()=>()=>{if(!valid)throw Error('account changed');},run:work=>work(),render:()=>{},
  request:async(action,body,check)=>{calls.push(body);assert.equal(action,'report_page');if(hold)await hold(body);check();if(fail&&body.source==='expenses')throw Error('unavailable');
   const items=[row(body.source,{date:body.fromDate,...(body.source==='expenses'&&missing?{deductibleVatCents:null}:{}),...(refund&&body.source==='documents'?{type:330}:{})})];
   return {version:1,environment:caps.environment,...body,pageSize:50,total:1,pages:1,readAt:'2026-11-02T08:00:00Z',items};}});
 return {summary,calls,invalidate:()=>valid=false};
}
test('VAT uses the complete report calculation and deductible input VAT, including refunds',async()=>{
 const f=fixture();await f.summary.load('2026-09');assert.match(f.summary.markup(),/13.50/);
 assert.ok(f.calls.every(r=>r.fromDate==='2026-09-01'&&r.toDate==='2026-10-31'));assert.equal(f.calls.length,2);
 const credit=fixture({refund:true});await credit.summary.load('2026-09');assert.match(credit.summary.markup(),/להחזר/);assert.match(credit.summary.markup(),/22.50/);
});
test('missing or failed source never shows a partial amount or a false zero',async()=>{
 for(const options of [{fail:true},{missing:true}]){const f=fixture(options);await f.summary.load('2026-09');assert.match(f.summary.markup(),/אינו זמין/);assert.ok(!f.summary.markup().includes('13.50'));}
});
test('changing period, resetting and changing accounts fence late report responses',async()=>{
 let release;const held=new Promise(resolve=>release=resolve);const f=fixture({hold:body=>body.fromDate==='2026-09-01'?held:undefined});
 const old=f.summary.load('2026-09');await f.summary.load('2026-11');release();await old;assert.match(f.summary.markup(),/נובמבר/);assert.ok(!f.summary.markup().includes('ספטמבר'));
 f.summary.reset();assert.match(f.summary.markup(),/בחרו תקופת/);f.invalidate();await f.summary.load('2026-09');assert.ok(!f.summary.markup().includes('13.50'));
});
