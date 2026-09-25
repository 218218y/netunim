import test from 'node:test';
import assert from 'node:assert/strict';
import {customerDebtProgressData} from '../netunim-orders/site/assets/js/shared/customer-debt-progress.js';
import {morningDebtImpact,applyVerifiedMorningDocumentToDebt,morningDebtProgressEntryId} from '../netunim-orders/site/assets/js/domains/customers/morning-debt.js';
import {upsertVerifiedMorningDebtDocument} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-documents.js';
import {createDomainsCustomersEditor} from '../netunim-orders/site/assets/js/domains/customers/editor.js';
import {morningDebtLinksMarkup} from '../netunim-orders/site/assets/js/domains/customers/view.js';
import {createSyncMerge} from '../netunim-orders/site/assets/js/sync/merge.js';
import {createStateNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';

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
 const duplicate=editor.applyVerifiedMorningDocument(input);assert.equal(duplicate.persisted,true);assert.equal(saves.length,2,'durable duplicate does not save again');assert.equal(renders.length,1);
 const missing=editor.applyVerifiedMorningDocument({...input,debtId:'missing',operationId:op(10)});assert.equal(missing.changed,false);assert.equal(missing.reason,'missing-debt');assert.equal(saves.length,2);
});

test('a debt may be deleted after a verified Morning application once no recovery lock remains',async()=>{
 const row=debt(),model={state:{customerDebts:[row]}},saves=[];let details='';
 const editor=createDomainsCustomersEditor({
  model,customerUi:{},modal:(_title,body)=>{details=body},toast:()=>{},scheduleSave:(message,meta)=>{saves.push({message,meta});return true},closeModal:()=>{},renderCustomers:()=>{},confirmDialog:async()=>true,
  rejectDebtRecoveryMutation:()=>false,
 });
 const applied=editor.applyVerifiedMorningDocument({debtId:row.id,operationId:op(13),documentId:'morning-doc-13',documentNumber:'1013',type:320,amount:1000,verifiedAt:'2026-09-09T16:00:00.000Z'});assert.equal(applied.changed,true);assert.equal(applied.persisted,true);
 const debtDocumentMarkup=morningDebtLinksMarkup(row);assert.match(debtDocumentMarkup,/morning-doc-13/);assert.match(debtDocumentMarkup,/חשבונית מס \/ קבלה 1013/);
 editor.openDebtProgressDetails(row.id);assert.match(details,/debt-progress-linked-row/);assert.match(details,/data-click-arg0="morning-doc-13"/);assert.match(details,/חשבונית מס \/ קבלה 1013/);
 await editor.deleteDebt(row.id);
 assert.equal(model.state.customerDebts.length,0,'verified Morning progress does not create a permanent local reference that prevents later debt deletion');
 assert.equal(model.state.customerDebts.some(debt=>morningDebtLinksMarkup(debt).includes('morning-doc-13')),false,'deleting a debt removes its row and embedded document link');
 const deletion=saves.at(-1);assert.equal(deletion.meta.mutationType,'delete');assert.deepEqual(deletion.meta.deleteIntents,{customerDebts:[row.id]});
});

test('a verified document is visible on its debt even when automatic balance allocation was declined',()=>{
 const row=debt(),model={state:{customerDebts:[row]}},saves=[];
 const editor=createDomainsCustomersEditor({model,customerUi:{},modal:()=>{},toast:()=>{},scheduleSave:(_message,meta)=>{saves.push(meta);return true},closeModal:()=>{},renderCustomers:()=>{},confirmDialog:async()=>true});
 const input={debtId:row.id,operationId:op(14),documentId:'morning-doc-14',documentNumber:'1014',type:400,amount:200,verifiedAt:'2026-09-09T17:00:00.000Z',applyPayment:false};
 const first=editor.applyVerifiedMorningDocument(input);assert.equal(first.changed,true);assert.equal(first.persisted,true);
 assert.equal(row.debtProgress.length,0);assert.equal(row.morningDocuments.length,1);
 assert.match(morningDebtLinksMarkup(row),/morning-open-document/);
 assert.equal(editor.applyVerifiedMorningDocument(input).persisted,true);assert.equal(saves.length,1,'recovery replay does not duplicate a verified link');
});

test('concurrent verified document links merge independently on the same debt',()=>{
 const normalization=createStateNormalization({}),merge=createSyncMerge({normalizeState:normalization.normalizeState});
 const state=()=>({version:4,businessName:'test',suppliers:[],transactions:[],customerDebts:[debt()],customerOrders:[],serviceCalls:[],inventoryItems:[],inventoryCategoryOrder:[],inventoryEvents:[],warehouseOrders:[],checks:[],notes:[],importAudit:{},stage2Audit:{}});
 const base=normalization.normalizeState(state()),local=structuredClone(base),remote=structuredClone(base);
 local.customerDebts[0].morningDocuments=[{operationId:op(15),documentId:'doc-15',documentNumber:'1015',documentType:305,verifiedAt:'2026-09-09T18:00:00.000Z'}];
 remote.customerDebts[0].morningDocuments=[{operationId:op(16),documentId:'doc-16',documentNumber:'1016',documentType:400,verifiedAt:'2026-09-09T18:01:00.000Z'}];
 const result=merge.merge3(base,local,remote);assert.deepEqual(result.conflicts,[]);
 assert.deepEqual(result.state.customerDebts[0].morningDocuments.map(link=>link.documentId),['doc-15','doc-16']);
});

test('historical Morning debt movements expose an operation-backed document link',()=>{
 const row=debt({debtProgress:[{id:`MORNING:${op(17)}:payment`,kind:'payment',action:'add',amount:100,source:'morning',createdAt:'2026-09-09T10:00:00.000Z'}]});
 const markup=morningDebtLinksMarkup(row);
 assert.match(markup,/טוען פרטי מסמך…/);assert.doesNotMatch(markup,/>מסמך Morning</);assert.match(markup,/data-click-arg1="00000000-0000-4000-8000-000000000017"/);assert.match(markup,/data-morning-debt-operation="00000000-0000-4000-8000-000000000017"/);
 assert.equal(morningDebtLinksMarkup(debt()),'');
});

test('historical Morning document metadata can be durably backfilled into the debt',()=>{
 const operation=op(19),row=debt({debtProgress:[{id:`MORNING:${operation}:payment`,kind:'payment',action:'add',amount:100,source:'morning',createdAt:'2026-09-09T10:00:00.000Z'}]});
 const changed=upsertVerifiedMorningDebtDocument(row,{operationId:operation,documentId:'doc-19',documentNumber:'3889',documentType:320,verifiedAt:'2026-09-09T10:00:01.000Z'});
 assert.equal(changed,true);assert.equal(row.morningDocuments.length,1);assert.deepEqual(row.morningDocuments[0],{operationId:operation,documentId:'doc-19',documentNumber:'3889',documentType:320,verifiedAt:'2026-09-09T10:00:01.000Z'});
 const markup=morningDebtLinksMarkup(row);assert.match(markup,/חשבונית מס \/ קבלה 3889/);assert.doesNotMatch(markup,/data-morning-debt-operation/);
 assert.equal(upsertVerifiedMorningDebtDocument(row,{operationId:operation,documentId:'doc-19',documentNumber:'3889',documentType:320,verifiedAt:'2026-09-09T10:00:01.000Z'}),false,'replaying identical authoritative metadata does not create another write');
});

test('debt document metadata rejects missing IDs and duplicate operation links',()=>{
 const normalization=createStateNormalization({});
 const state=links=>({version:4,businessName:'test',suppliers:[],transactions:[],customerDebts:[debt({morningDocuments:links})],customerOrders:[],serviceCalls:[],inventoryItems:[],inventoryCategoryOrder:[],inventoryEvents:[],warehouseOrders:[],checks:[],notes:[],importAudit:{},stage2Audit:{}});
 const link={operationId:op(18),documentId:'doc-18',documentNumber:'1018',documentType:320,verifiedAt:'2026-09-09T18:00:00.000Z'};
 assert.doesNotThrow(()=>normalization.normalizeState(state([link])));
 assert.throws(()=>normalization.normalizeState(state([{...link,documentId:''}])),/invalid documentId/);
 assert.throws(()=>normalization.normalizeState(state([link,link])),/invalid operationId/);
});
