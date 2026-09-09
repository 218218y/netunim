import test from 'node:test';
import assert from 'node:assert/strict';
import {customerDebtProgressData} from '../netunim-orders/site/assets/js/shared/customer-debt-progress.js';
import {morningDebtImpact,applyVerifiedMorningDocumentToDebt,morningDebtProgressEntryId} from '../netunim-orders/site/assets/js/domains/customers/morning-debt.js';
import {createDomainsCustomersEditor} from '../netunim-orders/site/assets/js/domains/customers/editor.js';

const op=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const add=(id,kind,amount)=>({id,kind,action:'add',amount,source:'manual',createdAt:'2026-09-09T09:00:00.000Z'});

function debt(extra={}){return {id:'D1',customerName:'לקוח',amount:1000,paid:false,invoiceIssued:false,supplied:false,debtProgress:[],...extra}}

function apply(row,type,amount,operation=op(1),verifiedAt='2026-09-09T10:00:00.000Z',policy={}){
 return applyVerifiedMorningDocumentToDebt(row,{operationId:operation,type,amount,verifiedAt,...policy});
}

test('type 320 closes both payment and invoice when verified for the full debt',()=>{
 const row=debt(),result=apply(row,320,1000),p=customerDebtProgressData(row);
 assert.equal(result.changed,true);assert.equal(p.paymentComplete,true);assert.equal(p.invoiceComplete,true);
 assert.equal(p.paymentApplied,1000);assert.equal(p.invoiceApplied,1000);assert.equal(row.debtProgress.length,2);
 assert.ok(row.paidAt);assert.ok(row.invoiceIssuedAt);assert.ok(row.closedAt);
 assert.deepEqual(row.debtProgress.map(x=>x.source),['morning','morning']);
});

test('receipt changes payment only and tax invoice changes invoice only',()=>{
 const receipt=debt();apply(receipt,400,1000);let p=customerDebtProgressData(receipt);
 assert.equal(p.paymentComplete,true);assert.equal(p.invoiceComplete,false);assert.equal(receipt.debtProgress.length,1);assert.equal(receipt.debtProgress[0].kind,'payment');
 const invoice=debt();apply(invoice,305,1000);p=customerDebtProgressData(invoice);
 assert.equal(p.paymentComplete,false);assert.equal(p.invoiceComplete,true);assert.equal(invoice.debtProgress.length,1);assert.equal(invoice.debtProgress[0].kind,'invoice');
});

test('partial Morning documents accumulate independently across repeated verified operations',()=>{
 const row=debt();apply(row,320,300,op(1));apply(row,400,200,op(2));apply(row,305,100,op(3));
 const p=customerDebtProgressData(row);assert.equal(p.paymentApplied,500);assert.equal(p.invoiceApplied,400);assert.equal(p.remainingPayment,500);assert.equal(p.remainingInvoice,600);
 assert.equal(row.debtProgress.length,4);
});

test('verified document amount is capped to each remaining side of the debt',()=>{
 const row=debt({debtProgress:[add('P1','payment',400),add('I1','invoice',200)]});
 const before=morningDebtImpact(row,320,1000);assert.equal(before.paymentApply,600);assert.equal(before.invoiceApply,800);assert.equal(before.paymentUnapplied,400);assert.equal(before.invoiceUnapplied,200);
 apply(row,320,1000);const p=customerDebtProgressData(row);assert.equal(p.paymentApplied,1000);assert.equal(p.invoiceApplied,1000);assert.equal(row.debtProgress.at(-2).amount,600);assert.equal(row.debtProgress.at(-1).amount,800);
});

test('document above original debt never creates an overpaid or over-invoiced local balance',()=>{
 const row=debt(),impact=morningDebtImpact(row,320,1250);assert.equal(impact.relation,'over');assert.equal(impact.paymentApply,1000);assert.equal(impact.invoiceApply,1000);assert.equal(impact.paymentUnapplied,250);assert.equal(impact.invoiceUnapplied,250);
 apply(row,320,1250);const p=customerDebtProgressData(row);assert.equal(p.paymentRecorded,1000);assert.equal(p.invoiceRecorded,1000);assert.equal(p.remainingPayment,0);assert.equal(p.remainingInvoice,0);
});

test('same Morning operation is idempotent across immediate verification and later reconciliation',()=>{
 const row=debt(),operation=op(7);assert.equal(apply(row,320,400,operation).changed,true);const snapshot=structuredClone(row);const replay=apply(row,320,400,operation,'2026-09-09T11:00:00.000Z');
 assert.equal(replay.changed,false);assert.equal(replay.reason,'already-applied');assert.deepEqual(row,snapshot);
 assert.equal(row.debtProgress.filter(x=>x.id===morningDebtProgressEntryId(operation,'payment')).length,1);assert.equal(row.debtProgress.filter(x=>x.id===morningDebtProgressEntryId(operation,'invoice')).length,1);
});

test('manual reset after a Morning entry is not undone by replaying the same verified operation',()=>{
 const row=debt(),operation=op(8);apply(row,400,300,operation);const entryId=morningDebtProgressEntryId(operation,'payment');row.debtProgress.push({id:'RESET1',kind:'payment',action:'reset',clears:[entryId],source:'manual',createdAt:'2026-09-09T12:00:00.000Z'});
 assert.equal(customerDebtProgressData(row).paymentApplied,0);const replay=apply(row,400,300,operation,'2026-09-09T13:00:00.000Z');assert.equal(replay.changed,false);assert.equal(customerDebtProgressData(row).paymentApplied,0);
});

test('already-complete side stays untouched while the other side can still be completed',()=>{
 const row=debt({paid:true});const impact=morningDebtImpact(row,320,1000);assert.equal(impact.paymentApply,0);assert.equal(impact.invoiceApply,1000);apply(row,320,1000);
 const p=customerDebtProgressData(row);assert.equal(p.paymentComplete,true);assert.equal(p.invoiceComplete,true);assert.equal(row.debtProgress.length,1);assert.equal(row.debtProgress[0].kind,'invoice');
});

test('non-positive debt is deliberately ineligible for automatic Morning progress',()=>{
 const row=debt({amount:-250}),impact=morningDebtImpact(row,320,250),before=structuredClone(row);assert.equal(impact.eligible,false);const result=apply(row,320,250);assert.equal(result.changed,false);assert.equal(result.reason,'ineligible-debt');assert.deepEqual(row,before);
});


test('manual partial payment is not deducted twice when receipt payment allocation is explicitly disabled',()=>{
 const row=debt({debtProgress:[add('MANUAL-P1','payment',300)]});
 const before=customerDebtProgressData(row);assert.equal(before.paymentApplied,300);assert.equal(before.remainingPayment,700);
 const impact=morningDebtImpact(row,400,300,{applyPayment:false});assert.equal(impact.paymentSupported,true);assert.equal(impact.paymentAffected,false);assert.equal(impact.paymentApply,0);
 const result=apply(row,400,300,op(11),'2026-09-09T15:00:00.000Z',{applyPayment:false});assert.equal(result.changed,false);assert.equal(result.reason,'skipped-by-policy');
 const after=customerDebtProgressData(row);assert.equal(after.paymentApplied,300);assert.equal(after.remainingPayment,700);assert.equal(row.debtProgress.length,1);
});

test('invoice-receipt can update invoice while deliberately not re-recording an already manual payment',()=>{
 const row=debt({debtProgress:[add('MANUAL-P2','payment',250)]});
 const result=apply(row,320,250,op(12),'2026-09-09T15:10:00.000Z',{applyPayment:false,applyInvoice:true});assert.equal(result.changed,true);
 const progress=customerDebtProgressData(row);assert.equal(progress.paymentApplied,250);assert.equal(progress.invoiceApplied,250);assert.equal(progress.remainingPayment,750);assert.equal(progress.remainingInvoice,750);
 assert.equal(row.debtProgress.filter(item=>item.kind==='payment').length,1);assert.equal(row.debtProgress.filter(item=>item.kind==='invoice'&&item.source==='morning').length,1);
});

test('customer editor renders a verified Morning mutation once but re-persists an idempotent replay for crash recovery',()=>{
 const row=debt(),model={state:{customerDebts:[row]}},saves=[],renders=[],persistResults=[false,true];
 const editor=createDomainsCustomersEditor({model,customerUi:{},modal:()=>{},toast:()=>{},scheduleSave:(message,meta)=>{saves.push({message,meta});return persistResults.shift()},closeModal:()=>{},renderCustomers:()=>renders.push(true),confirmDialog:async()=>true});
 const input={debtId:row.id,operationId:op(9),type:400,amount:250,verifiedAt:'2026-09-09T14:00:00.000Z'};
 const first=editor.applyVerifiedMorningDocument(input);assert.equal(first.changed,true);assert.equal(first.persisted,false);assert.equal(saves.length,1);assert.equal(renders.length,1);assert.equal(saves[0].meta.surface,'orders.morning.customerDebt');
 const replay=editor.applyVerifiedMorningDocument(input);assert.equal(replay.changed,false);assert.equal(replay.reason,'already-applied');assert.equal(replay.persisted,true);assert.equal(saves.length,2);assert.equal(renders.length,1);assert.equal(saves[1].meta.surface,'orders.morning.customerDebt');
 const missing=editor.applyVerifiedMorningDocument({...input,debtId:'missing',operationId:op(10)});assert.equal(missing.changed,false);assert.equal(missing.reason,'missing-debt');assert.equal(saves.length,2);
});
