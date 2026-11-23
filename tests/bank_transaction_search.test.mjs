import test from 'node:test';
import assert from 'node:assert/strict';
import {searchMatch,prepareSearchValues,createPreparedSearchMatcher} from '../shared/search.js';
import {bankTransactionMatchesSearch,createBankTransactionSearchMatcher} from '../shared/bank-transaction-search.js';
import {bankRowMatchesSearch as ordersSearch} from '../netunim-orders/site/assets/js/domains/finance/bank-view-helpers.js';
import {createDomainsBankView} from '../netunim-kupa/site/assets/js/domains/bank/view.js';
import {createDomainsFinanceView} from '../netunim-orders/site/assets/js/domains/finance/view.js';

// Reduced fixture derived from the reported bank screen: no live bank access or personal bank identifiers.
const rows=[
  {id:'one',archiveId:1,date:'2026-10-18',description:'העברה נכנסת',amount:2500,balanceAfter:85160.18,bankReference:'9001001'},
  {id:'two',archiveId:2,date:'2026-08-31',description:'הפק.שיק בסלולר',amount:550,balanceAfter:118662.34,bankReference:'70001',checkDetails:{kind:'deposit',checkItems:[{bankNumber:'12',branchNumber:'613',accountNumber:'876542',checkNumber:'70001',amount:550,imageFrontKey:`${'a'.repeat(15)}2500${'a'.repeat(45)}`}]}},
  {id:'three',archiveId:3,date:'2026-06-04',description:'העברה מהבנק לטובת ספק',amount:-2500,balanceAfter:99001.13,bankReference:'9001003'},
  {id:'four',archiveId:4,date:'2026-03-17',description:'זיכוי ממרכנתיל עבור העברה מח-ן:123456782',amount:5000,balanceAfter:94999.63,bankReference:'9001004'},
  {id:'five',archiveId:5,date:'2026-03-17',description:'זיכוי עבור העברה',amount:2500,balanceAfter:97499.63,bankReference:'9001005'},
  {id:'six',archiveId:6,date:'2026-02-19',description:'זיכוי עבור שידה מח-ן:123456792',amount:500,balanceAfter:78361.68,bankReference:'9001005'},
  {id:'seven',archiveId:7,date:'2026-02-13',description:'הפק.שיק בסלולר',amount:1800,balanceAfter:86000,bankReference:'9001007',lastSeenAt:'2026-11-22T10:25:00.000Z'},
];

const result=(query,matcher=createBankTransactionSearchMatcher(query))=>rows.filter(row=>matcher(row)).map(row=>row.id);
const expected=['one','three','five'];

test('shared search compacts within each field, never joins separate fields into artificial numbers',()=>{
  assert.equal(searchMatch('2500',['account 123456792',500]),false);
  assert.equal(searchMatch('2500',['account 123456782',5000]),false);
  assert.equal(searchMatch('2500',['2','500']),false);
  assert.equal(searchMatch('2500',['sum 2,500']),true);
  assert.equal(searchMatch('0501234567',['050-123-4567']),true);
  assert.equal(searchMatch('1,500',[1500]),true);
  assert.equal(searchMatch('עסקי 2400',['עסקי',2400]),true);
  const prepared=prepareSearchValues(['account 123456792',500]);
  assert.equal(createPreparedSearchMatcher('2500')(prepared),false);
});

test('bank 2500 matches the actual absolute amount, not 500, 5000, cheque metadata or timestamps',()=>{
  for(const query of ['2500','2,500','2500.00','₪ 2,500','-2500']){
    assert.deepEqual(result(query),expected,query);
    assert.deepEqual(rows.filter(row=>bankTransactionMatchesSearch(row,query)).map(row=>row.id),expected,query);
    assert.deepEqual(rows.filter(row=>ordersSearch(row,query)).map(row=>row.id),expected,query);
  }
  assert.deepEqual(result('500'),['six']);
  assert.deepEqual(result('550'),['two']);
  assert.deepEqual(result('5000'),['four']);
  assert.equal(bankTransactionMatchesSearch({amount:25000},'2500'),false);
  assert.equal(bankTransactionMatchesSearch({amount:12500},'2500'),false);
  assert.equal(bankTransactionMatchesSearch({amount:null,balanceAfter:null},'0'),false);
  assert.equal(bankTransactionMatchesSearch({amount:550,checkDetails:{checkItems:[null,{}]}},'2500'),false);
});

test('visible dates, references, cheque and card IDs, account numbers, balance and descriptions remain searchable',()=>{
  const additional={date:'2026-09-01',description:'העברה ללקוח',memo:'תשלום עבודת נגרות',amount:25.75,balanceAfter:4200,
    bankReference:'00168',senderAccount:{bankNumber:'12',branchNumber:'613',accountNumber:'456789'},
    checkDetails:{checkNumbers:['000177'],checkItems:[{bankNumber:'11',branchNumber:'123',accountNumber:'666',checkNumber:'00222',amount:250}]},
    creditSettlementDetails:{providerLabel:'ויזה',permissionReference:'7654321',issuerReference:'1234567',cardLast4s:['4567']},
  };
  for(const query of ['01/09/26','1.9.2026','2026','נגרות','456789','00168','000177','00222','7654321','4567','25.75','4200','250']){
    assert.equal(bankTransactionMatchesSearch(additional,query),true,query);
  }
  assert.equal(bankTransactionMatchesSearch(additional,'300'),false);
  assert.equal(bankTransactionMatchesSearch(additional,'7500'),false);
  assert.equal(bankTransactionMatchesSearch(additional,'העברה נגרות'),true);
  assert.equal(bankTransactionMatchesSearch(additional,'02/09/26'),false);
});

for(const site of ['kupa','orders'])test(`${site} bank table renders only three matching transactions, in both display paths`,t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document});
  const region={innerHTML:''};
  globalThis.document={querySelector:selector=>selector==='.bank-transactions-region'?region:null};
  const feed={accountNumber:'test',balance:120000,transactions:rows};
  const state={bank:{feed},checks:[],expenses:[],cards:[]};
  const view=site==='kupa'
    ?createDomainsBankView({model:{state},ui:{bankAccountView:'business'},bankBridgeUiState:()=>({feed}),dateEditorMarkup:()=>''})
    :createDomainsFinanceView({ui:{bankAccountView:'business'},controller:{snapshot:()=>({bank:{feed},kupa:state})},dateEditorMarkup:()=>''});
  view.setBankSearch('2500');
  assert.match(region.innerHTML,/3 מתוך 7 תנועות/);
  assert.equal((region.innerHTML.match(/<tr class="[^"]*"(?: data-bank-search-id="[^"]*")?>/g)||[]).length,3);
  view.setBankSearch('500');
  assert.match(region.innerHTML,/1 מתוך 7 תנועות/);
  view.setBankSearch('');
  assert.match(region.innerHTML,/7 תנועות/);
});
