import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createMorningCommandForm,validateTaxId} from '../netunim-orders/site/assets/js/domains/customers/morning-command-form.js';
import {createMorningDebtConfirmation} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-confirmation.js';
import {DOCUMENT_TYPES} from '../netunim-orders/site/assets/js/domains/customers/morning-document-view.js';
import {morningDebtImpact} from '../netunim-orders/site/assets/js/domains/customers/morning-debt.js';
import {morningPaymentTotalCents} from '../netunim-orders/site/assets/js/domains/customers/morning-payments.js';
import {money} from '../netunim-orders/site/assets/js/core/money.js';
import {baseline} from './morning_command_form_policy_fixture.mjs';
const ctx={DOCUMENT_TYPES,money,morningDebtImpact,morningPaymentTotalCents,activeOperationId:'operation',activeDebtId:'debt',activeSource:{kind:'debt'}};
let values={},receipts=[],type=320,debt=null;
Object.assign(ctx,{cleanText:(value,max=250)=>String(value??'').trim().slice(0,max),currentField:id=>({value:values[id]??''}),selectedType:()=>type,readPaymentRows:()=>receipts,currentDebt:()=>debt,debtUpdatePolicy:()=>({applyPayment:true,applyInvoice:true})});
const old=vm.runInNewContext(Object.values(baseline.functions).map(v=>v.source).join('\n')+'\n({read:readForm,tax:validateTaxId,message:debtImpactConfirmation})',ctx);
const form=createMorningCommandForm({session:{context:()=>({operationId:ctx.activeOperationId,debtId:ctx.activeDebtId,source:ctx.activeSource})},fields:{read:ctx.currentField,type:ctx.selectedType},receipts:{read:ctx.readPaymentRows,totalCents:morningPaymentTotalCents},format:{money}});
const confirmation=createMorningDebtConfirmation({format:{money},financial:{impact:morningDebtImpact}});
const outcome=run=>{try{return JSON.parse(JSON.stringify(run()))}catch(error){return {error:error.message}}};
test('full command matrix preserves validation/error order, cents, bank transfer/check attribution and payloads',()=>{
 let cases=0;
 for(type of [305,320,400,999])for(const source of [{kind:'standalone'},{kind:'debt'},{kind:'bank',bankTransactionId:7,bankAmount:30,paymentMode:'transfer'},{kind:'bank',bankTransactionId:7,bankAmount:30,paymentMode:'checks'}])for(const patch of [
  {},{morningClientName:''},{morningAmount:'0'},{morningAmount:'NaN'},{morningAmount:'30.01'},{morningDocumentDate:''},{morningDueDate:'2026-10-14'},{morningDescription:''},{morningClientEmail:'invalid'},{morningClientTaxId:'123456789'},{morningLinkedDocument:' invoice-id '},{morningClientName:'x'.repeat(180),morningRemarks:'r'.repeat(550)}
 ])for(const variant of ['plain','transfer','check','mismatch']){
  ctx.activeSource=source;values={morningClientName:'  Customer <&  ',morningClientEmail:'a@example.test',morningAmount:'30',morningDocumentDate:'2026-10-15',morningDueDate:'2026-10-16',morningDescription:' document ',morningClientTaxId:'123456782',...patch};
  receipts=[{type:variant==='check'?2:4,date:'2026-10-15',price:variant==='mismatch'?30.01:30,currency:'ILS',...(variant==='plain'||variant==='mismatch'?{}:{bankSourceKey:variant==='check'?'check:exact':'transfer'})}];
  const before=JSON.stringify({values,receipts,source});assert.deepEqual(outcome(()=>form.read()),outcome(()=>old.read()));assert.equal(JSON.stringify({values,receipts,source}),before);cases++;
 }
 assert.equal(cases,768);
});
test('tax IDs retain optional, punctuation, checksum and nine-digit normalization policy',()=>{
 for(const value of ['',undefined,null,'123456782','123-456-782','000000000','123456789','1234567890','abc',123456782])assert.deepEqual(outcome(()=>validateTaxId(value)),outcome(()=>old.tax(value)));
});
test('1008 pre-issue confirmations preserve partial/excess, already manual and independent allocation warnings',()=>{
 let cases=0;
 for(const id of ['','debt'])for(debt of [null,{amount:100},{amount:0},{amount:-100},{amount:100,paid:true},{amount:100,debtProgress:[{kind:'payment',action:'add',amount:30,source:'manual'}]}])for(const documentType of [305,320,400])for(const amount of [0,1,30,50.01,99.99,100,130])for(const applyPayment of [true,false])for(const applyInvoice of [true,false]){
  ctx.activeDebtId=id;const policy={applyPayment,applyInvoice};assert.equal(confirmation.message(id,debt,documentType,amount,policy),old.message(documentType,amount,policy));cases++;
 }
 assert.equal(cases,1008);
});
test('form and confirmation expose no issuance, queue, persistence, modal or asynchronous authority',()=>{
 for(const name of ['morning-command-form','morning-debt-confirmation']){const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/'+name+'.js',import.meta.url),'utf8');for(const token of ['request.json','fetch(','localStorage','setTimeout','querySelector','addOperation','confirmDialog','async function','commitSave'])assert.equal(source.includes(token),false,name+':'+token)}
});
