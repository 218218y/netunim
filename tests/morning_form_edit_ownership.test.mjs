import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCustomersDocuments} from '../netunim-orders/site/assets/js/domains/customers/documents.js';
import {createMorningPayments} from '../netunim-orders/site/assets/js/domains/customers/morning-payments.js';

function row(type,price){
  const card={value:''},fields=new Map([['type',{value:String(type)}],['price',{value:String(price)}],['cardNum',card]]);
  return {dataset:{paymentRow:'0'},card,querySelector:selector=>fields.get(selector.match(/="(.*?)"/)?.[1])||null,querySelectorAll:()=>[]};
}
function documentFixture(t,rows){
  const prior=Object.getOwnPropertyDescriptor(globalThis,'document'),invoice={disabled:false,closest:()=>({classList:{toggle(){}}})};
  Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:selector=>selector.includes('morningDocumentType')?invoice:null,querySelectorAll:selector=>selector==='[data-payment-row]'?rows:[]}});
  t.after(()=>{if(prior)Object.defineProperty(globalThis,'document',prior);else delete globalThis.document});return invoice;
}
test('unmounted form edit commands cannot mutate matching payment controls in another surface',t=>{
  const foreign=row(3,99);documentFixture(t,[foreign]);
  const documents=createDomainsCustomersDocuments({operationScope:{capture:()=>()=>{},captureRead:()=>()=>{}},model:{state:{customerDebts:[]}},modal(){},toast(){},dateEditorMarkup:()=>'',documentsBrowser:{},request:{json:async()=>({})}});t.after(()=>documents.dispose());
  documents.syncPaymentType();assert.equal(foreign.card.value,'','an unmounted editor cannot default another surface card suffix');
});
test('bank selection without a mounted form cannot restrict another surface document type',t=>{
  const invoice=documentFixture(t,[]),transaction={archiveId:71,amount:42,date:'2026-10-14',currency:'ILS',status:'processed'};
  const documents=createDomainsCustomersDocuments({operationScope:{capture:()=>()=>{},captureRead:()=>()=>{}},model:{state:{customerDebts:[]}},modal(){},toast(){},dateEditorMarkup:()=>'',documentsBrowser:{},request:{json:async()=>({})},getBusinessBankTransactions:()=>[transaction]});t.after(()=>documents.dispose());
  assert.equal(documents.linkBankTransaction(71),false);assert.equal(invoice.disabled,false);
});
test('payment reads and synchronization are confined to their own rows host',t=>{
  const owned=row(4,42),foreign=row(3,99);documentFixture(t,[owned,foreign]);
  const payments=createMorningPayments({dateEditorMarkup:()=>'',toast(){},currentField:id=>id==='morningPaymentRows'?{querySelectorAll:()=>[owned]}:id==='morningPaymentDate0'?{value:'2026-10-14'}:null,getSource:()=>({kind:'standalone'}),getSelectedType:()=>320});
  assert.equal(payments.readPaymentRows({strict:false}).length,1,'outside rows cannot contaminate capture or payload validation');
  payments.syncPaymentType();assert.equal(foreign.card.value,'','outside rows cannot receive defaults from the current editor');
});
