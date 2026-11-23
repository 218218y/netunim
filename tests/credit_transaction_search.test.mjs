import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditTransactionSearchMatcher,creditTransactionSearchFields,
  createFinancialSearchMatcher,prepareFinancialSearchFields} from '../shared/search.js';
import {createCreditTransactionSearchMatcher as kupaMatcher} from '../netunim-kupa/site/assets/js/core/search.js';
import {createCreditTransactionSearchMatcher as ordersMatcher} from '../netunim-orders/site/assets/js/core/search.js';

const rows=[
  {id:'exact',description:'עסקה רגילה',amount:2500,displayAmount:2500,totalAmount:2500,card:'••1234',account:'עסקי',transactionDate:'2026-09-10',date:'2026-10-10'},
  {id:'large',description:'עסקה רגילה',amount:12500,displayAmount:12500,totalAmount:12500,card:'••1234',account:'עסקי',transactionDate:'2026-09-10',date:'2026-10-10'},
  {id:'small',description:'עסקה רגילה',amount:500,displayAmount:500,totalAmount:500,card:'••1234',account:'עסקי',transactionDate:'2026-09-10',date:'2026-10-10'},
  {id:'reference',description:'חיוב מזהה 85525007896',amount:550,displayAmount:550,totalAmount:550,card:'••1234',account:'עסקי',transactionDate:'2026-09-10',date:'2026-10-10'},
  {id:'joined',description:'פריט 2 ואחריו 500',amount:550,displayAmount:550,totalAmount:550,card:'••1234',account:'עסקי',transactionDate:'2026-09-10',date:'2026-10-10'},
  {id:'hidden-id',description:'פריט',record:{id:'internal-2500-id'},amount:550,displayAmount:550,totalAmount:550,card:'••1234',account:'עסקי',transactionDate:'2026-09-10',date:'2026-10-10'},
  {id:'foreign',description:'רכישה מט\u05f4ח',amount:45,displayAmount:45,originalAmount:2500,totalAmount:45,displayCurrency:'ILS',originalCurrency:'USD',card:'••1234',account:'עסקי',transactionDate:'2026-09-10',date:'2026-10-10'},
];
const expected=['exact','reference','foreign'];
const labels={visaCal:'כאל'};

for(const [site,mkMatcher] of [['Kupa',kupaMatcher],['Orders',ordersMatcher]]){
  test(`${site}: numeric search is exact for amounts, partial for real reference numbers only`,()=>{
    for(const query of ['2500','2,500','₪2,500','2500.00']){
      const matches=rows.filter(mkMatcher(query,labels)).map(row=>row.id);
      assert.deepEqual(matches,expected,query);
    }
    assert.deepEqual(rows.filter(mkMatcher('12500',labels)).map(row=>row.id),['large']);
    assert.deepEqual(rows.filter(mkMatcher('500',labels)).map(row=>row.id),['small','reference','joined']);
    assert.deepEqual(rows.filter(mkMatcher('52500',labels)).map(row=>row.id),['reference']);
    assert.deepEqual(rows.filter(mkMatcher('מזהה',labels)).map(row=>row.id),['reference']);
    assert.deepEqual(rows.filter(mkMatcher('10/09/26',labels)).map(row=>row.id),rows.map(row=>row.id));
  });
}

test('precomputed Kupa credit search fields and live Orders rows agree',()=>{
  for(const query of ['2500','12500','500','מזהה','עסקי','10/9/26','8552500','9999']){
    const matches=createCreditTransactionSearchMatcher(query,labels);
    const precomputed=rows.map(row=>({...row,search:creditTransactionSearchFields(row,labels)}));
    assert.deepEqual(precomputed.filter(matches).map(row=>row.id),rows.filter(matches).map(row=>row.id),query);
  }
});

test('financial number segments never concatenate across visible text fields',()=>{
  const matcher=createFinancialSearchMatcher('2500');
  assert.equal(matcher(prepareFinancialSearchFields({amounts:[500],identifiers:['2'],texts:['מספר 500']})),false);
  assert.equal(matcher(prepareFinancialSearchFields({amounts:[5000],texts:['מספר 2']})),false);
  assert.equal(matcher(prepareFinancialSearchFields({texts:['אסמכתא 85525007896']})),true);
  assert.equal(matcher(prepareFinancialSearchFields({identifiers:['855-2500-7896']})),true);
  assert.equal(matcher(prepareFinancialSearchFields({texts:['מספר 2 ומספר 500']})),false);
});

import {createDomainsCreditView} from '../netunim-kupa/site/assets/js/domains/credit/view.js';
import {createDomainsFinanceView} from '../netunim-orders/site/assets/js/domains/finance/view.js';

for(const site of ['kupa','orders'])test(`${site}: rendered credit transaction table obeys exact amounts and partial references`,t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document});
  const host={outerHTML:'',parentElement:null};
  globalThis.document={getElementById:()=>host};
  const state={credits:[
    {id:'a',active:true,card:'1234',account:'עסקי',totalAmount:2500,installments:1,firstChargeDate:'2026-10-10',transactionDate:'2026-09-10',description:'התאמה כספית'},
    {id:'b',active:true,card:'1234',account:'עסקי',totalAmount:12500,installments:1,firstChargeDate:'2026-10-10',transactionDate:'2026-09-10',description:'סכום גדול'},
    {id:'c',active:true,card:'1234',account:'עסקי',totalAmount:550,installments:1,firstChargeDate:'2026-10-10',transactionDate:'2026-09-10',description:'אסמכתא 85525007896'},
  ],creditSync:{version:4,profiles:[],errors:[],cardMappings:{}},checks:[],expenses:[],cards:[]};
  const ui={creditDetailMode:'all',creditAccountFilter:'all',creditProviderFilter:'all',creditCardFilter:'all',creditView:'all',bulkSelected:new Set()};
  const view=site==='kupa'
    ?createDomainsCreditView({ui,model:{state},syncBulkUi:()=>{},bulkCell:()=>'',bulkHeader:()=>'',dateEditorMarkup:()=>'',creditSyncUiState:()=>({})})
    :createDomainsFinanceView({ui,controller:{snapshot:()=>({kupa:state,bank:{}})},dateEditorMarkup:()=>''});
  view.setCreditSearch('2500');
  assert.match(host.outerHTML,/התאמה כספית/);
  assert.match(host.outerHTML,/85525007896/);
  assert.doesNotMatch(host.outerHTML,/סכום גדול/);
  view.setCreditSearch('12500');
  assert.match(host.outerHTML,/סכום גדול/);
  assert.doesNotMatch(host.outerHTML,/התאמה כספית/);
  assert.doesNotMatch(host.outerHTML,/85525007896/);
});
