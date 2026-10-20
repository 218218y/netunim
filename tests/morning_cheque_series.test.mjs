import test from 'node:test';
import assert from 'node:assert/strict';
import {nextMorningPaymentDraft} from '../netunim-orders/site/assets/js/domains/customers/morning-cheque-series.js';
import {createMorningPayments} from '../netunim-orders/site/assets/js/domains/customers/morning-payments.js';

const fallback={type:4,date:'2026-10-20',price:'',currency:'ILS'};
const first={type:2,date:'2026-01-31',price:1250.75,currency:'ILS',bankCode:'12',bankName:'בנק הפועלים',bankBranch:'600',bankAccount:'0012345',chequeNum:'000099'};

test('a cheque drafts a sequential, editable cheque with all payment/bank fields',()=>{
  const second=nextMorningPaymentDraft([first],fallback);
  assert.deepEqual(second,{type:2,date:'2026-02-28',price:1250.75,currency:'ILS',bankCode:'12',bankName:'בנק הפועלים',bankBranch:'600',bankAccount:'0012345',chequeNum:'000100'});
  assert.equal(nextMorningPaymentDraft([first,second],fallback).date,'2026-03-31','February truncation must not drift the next cheque to March 28');
  assert.equal(nextMorningPaymentDraft([first,second],fallback).chequeNum,'000101');
  assert.deepEqual(first,{type:2,date:'2026-01-31',price:1250.75,currency:'ILS',bankCode:'12',bankName:'בנק הפועלים',bankBranch:'600',bankAccount:'0012345',chequeNum:'000099'},'no mutation of original cheque');
});

test('manual changes are never overwritten; the next cheque continues from the last edited cheque',()=>{
  const edited={...nextMorningPaymentDraft([first],fallback),date:'2026-02-25',price:1100.12,chequeNum:'000200',bankBranch:'777'};
  const third=nextMorningPaymentDraft([first,edited],fallback);
  assert.deepEqual({date:third.date,price:third.price,chequeNum:third.chequeNum,bankBranch:third.bankBranch},{date:'2026-03-25',price:1100.12,chequeNum:'000201',bankBranch:'777'});
  assert.equal(edited.chequeNum,'000200');
});

test('a manually restarted schedule keeps its anchor through multiple short months',()=>{
  const payments=[{...first,date:'2026-11-15'},{...first,date:'2026-12-31',chequeNum:'000200'}];
  const before=structuredClone(payments);
  for(const date of ['2027-01-31','2027-02-28','2027-03-31','2027-04-30','2027-05-31']){
    const next=nextMorningPaymentDraft(payments,fallback);
    assert.equal(next.date,date);
    payments.push(next);
  }
  assert.deepEqual(payments.slice(0,2),before,'adding drafts must not rewrite manually edited rows');
});

test('twelve monthly cheques preserve exact amounts, numbers and calendar days',()=>{
  const payments=[first];
  const dates=['2026-01-31','2026-02-28','2026-03-31','2026-04-30','2026-05-31','2026-06-30','2026-07-31','2026-08-31','2026-09-30','2026-10-31','2026-11-30','2026-12-31'];
  for(let index=1;index<12;index++)payments.push(nextMorningPaymentDraft(payments,fallback));
  assert.deepEqual(payments.map(payment=>payment.date),dates);
  assert.deepEqual(payments.map(payment=>payment.chequeNum),['000099','000100','000101','000102','000103','000104','000105','000106','000107','000108','000109','000110']);
  assert.ok(payments.every(payment=>payment.price===1250.75&&payment.bankAccount==='0012345'));
});

test('end-of-year and leap days advance by calendar months, not fixed durations',()=>{
  const dec=nextMorningPaymentDraft([{...first,date:'2026-12-15'}],fallback);
  assert.equal(dec.date,'2027-01-15');
  const feb=nextMorningPaymentDraft([{...first,date:'2024-01-31'}],fallback);
  assert.equal(feb.date,'2024-02-29');
  assert.equal(nextMorningPaymentDraft([{...first,date:'2024-01-31'},feb],fallback).date,'2024-03-31');
});

test('no cheque preserves existing transfer defaults, while mixed rows continue the latest cheque',()=>{
  assert.deepEqual(nextMorningPaymentDraft([{type:3,price:100}],fallback),fallback);
  assert.deepEqual(nextMorningPaymentDraft([{type:1,price:100},{type:4,price:120}],fallback),fallback);
  const next=nextMorningPaymentDraft([first,{type:4,price:99}],fallback);
  assert.equal(next.type,2);assert.equal(next.chequeNum,'000100');assert.equal(next.price,1250.75);
});

test('invalid numbers and dates never manufacture incorrect cheque details',()=>{
  for(const value of ['','12A','-1','1.5','1e6','9'.repeat(40),'0'.repeat(41)])assert.equal(nextMorningPaymentDraft([{...first,chequeNum:value}],fallback).chequeNum,'');
  assert.equal(nextMorningPaymentDraft([{...first,chequeNum:'000900'}],fallback).chequeNum,'000901');
  assert.equal(nextMorningPaymentDraft([{...first,date:'2026-02-30'}],fallback).date,fallback.date);
  assert.equal(nextMorningPaymentDraft([{...first,price:0}],fallback).price,'');
  assert.equal(nextMorningPaymentDraft([{...first,price:NaN}],fallback).price,'');
});

test('long cheque numbers increment exactly without floating point rounding',()=>{
  for(const [value,expected] of [['9007199254740991','9007199254740992'],['9007199254740991000','9007199254740991001'],['0009007199254740992','0009007199254740993'],['0'.repeat(39)+'9','0'.repeat(38)+'10']]){
    assert.equal(nextMorningPaymentDraft([{...first,chequeNum:value}],fallback).chequeNum,expected);
  }
});

test('bank-origin cheque suggestion remains an editable manual receipt, never bank-authenticated',()=>{
  const source={...first,bankSourceKey:'check:verified-1',locked:true,removable:false,source:'bank',transactionId:'bank-ledger-ref'};
  const next=nextMorningPaymentDraft([source],fallback);
  for(const key of ['bankSourceKey','locked','removable','source','transactionId'])assert.equal(Object.hasOwn(next,key),false,key+' cannot be copied');
  assert.equal(next.bankAccount,'0012345');assert.equal(next.chequeNum,'000100');
});

function fakePaymentRow(input,bankSourceKey=''){
  return {
    dataset:{paymentRow:'0',bankSourceKey,bankSource:bankSourceKey?'true':'false',bankRemovable:'false'},
    querySelector(selector){
      const key=/\[data-payment-field="([^"]+)"\]/.exec(selector)?.[1];
      return key?{value:String(input[key]??'')}:null;
    },querySelectorAll(){return []}
  };
}

test('actual add-receipt command renders the suggestion using the live form values',async()=>{
  const entered={type:'2',price:'750.35',bankName:'12 - בנק הפועלים',bankBranch:'600',bankAccount:'0001234',chequeNum:'00105'};
  const old=fakePaymentRow(entered,'check:verified-1');
  let oldRows=[old];
  const host={_markup:'',querySelectorAll(){return oldRows},set innerHTML(value){this._markup=value;oldRows=[]},get innerHTML(){return this._markup}};
  const fields={morningPaymentRows:host,morningPaymentDate0:{value:'2026-10-15'}};
  const receipts=createMorningPayments({dateEditorMarkup:(id,date)=>`<input id="${id}" value="${date}">`,toast(message){throw Error(message)},currentField:id=>fields[id]||null,getSource:()=>({kind:'bank'}),getSelectedType:()=>320});
  const pending=receipts.addMorningPayment();
  entered.chequeNum='00115';
  assert.equal(await pending,true);
  const newRow=host.innerHTML.split('data-payment-row="1"')[1];
  assert.ok(newRow,'second row must be rendered');
  assert.match(newRow,/<option value="2" selected>צ׳ק<\/option>/);
  assert.match(newRow,/data-payment-field="price"[^>]*value="750.35"/);
  assert.match(newRow,/id="morningPaymentDate1" value="2026-11-15"/);
  assert.match(newRow,/data-payment-field="chequeNum"[^>]*value="00116"/);
  assert.match(newRow,/data-payment-field="bankBranch"[^>]*value="600"/);
  assert.match(newRow,/data-payment-field="bankAccount"[^>]*value="0001234"/);
  assert.match(newRow,/data-bank-source="false"/);
  assert.match(newRow,/data-bank-source-key=""/);
  assert.doesNotMatch(newRow,/readonly|disabled/,'suggested cheque is editable');
  const originalRow=host.innerHTML.split('data-payment-row="1"')[0];
  assert.match(originalRow,/data-bank-source-key="check:verified-1"/);
  assert.match(originalRow,/data-payment-field="chequeNum"[^>]*readonly/,'bank-origin source remains locked');
});

for(const change of ['closed','replaced','issuing','completed','disposed'])test(`lazy receipt addition cannot edit a ${change} form`,async()=>{
  let host={},editable=true;
  const receipts=createMorningPayments({currentField:()=>host,canEdit:()=>editable});
  const pending=receipts.addMorningPayment();
  if(change==='closed')host=null;
  else if(change==='replaced')host={};
  else editable=false;
  assert.equal(await pending,false,'stale work must stop before reading or rendering any rows');
});

test('rapid additions re-read the form and enforce the twelve-receipt limit',async()=>{
  let rows=Array.from({length:11},()=>fakePaymentRow(first)),renders=0;
  const messages=[];
  const host={querySelectorAll:()=>rows,set innerHTML(value){renders++;rows=Array.from(value.matchAll(/data-payment-row="\d+"/g),()=>fakePaymentRow(first))}};
  const receipts=createMorningPayments({dateEditorMarkup:()=>'',toast:message=>messages.push(message),currentField:id=>id==='morningPaymentRows'?host:{value:first.date},getSource:()=>({kind:'standalone'}),getSelectedType:()=>305});
  assert.deepEqual(await Promise.all([receipts.addMorningPayment(),receipts.addMorningPayment()]),[true,false]);
  assert.equal(rows.length,12);
  assert.equal(renders,1);
  assert.deepEqual(messages,['ניתן להוסיף עד 12 תקבולים למסמך']);
});
