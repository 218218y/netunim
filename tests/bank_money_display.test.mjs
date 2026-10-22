import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBankFeed} from '../shared/bank-feed.js';
import {bankWarningItems} from '../netunim-orders/site/assets/js/domains/bank/alerts.js';
import {createUiAlertCenter} from '../netunim-orders/site/assets/js/ui/alert-center.js';
import {money} from '../netunim-orders/site/assets/js/core/money.js';
import {morningBankTransactionLabel, morningBankTransactionPickerMarkup, syncMorningBankTransactionSelection, morningLinkableBankTransactions} from '../netunim-orders/site/assets/js/domains/customers/morning-bank-transaction-picker.js';
import {createDomainsBankView} from '../netunim-kupa/site/assets/js/domains/bank/view.js';
import {createDomainsFinanceView} from '../netunim-orders/site/assets/js/domains/finance/view.js';

const base={archiveId:42,date:'2026-10-22',description:'Returned cheque',presenceState:'missing'};
const feedFor=amount=>normalizeBankFeed({balance:500,syncedAt:'2026-10-22',transactions:[{...base,amount}]});
const absent=[null,undefined,'',' ','invalid',false,true,[],{},Infinity];

test('normalized unknown money stays unknown through both alert cards and acknowledgements',async t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document});
  globalThis.document={getElementById:()=>null};
  for(const amount of [...absent,0,'0',-25.5,'25.50']){
    const feed=feedFor(amount),bank={feed},expected=feed.transactions[0].amount;
    const warnings=bankWarningItems(bank);
    assert.equal(warnings.length,2);
    assert.ok(warnings.every(item=>item.amount===expected),String(amount));
    let html='',dismissed=null,opened='';
    const center=createUiAlertCenter({model:{state:{}},financeSnapshot:()=>({bank,bankAlertsReady:true}),
      modal:(_title,body)=>{html=body},navigateToBank:account=>{opened=account},
      dismissBankWarning:async item=>{dismissed=item;return true}});
    assert.equal(center.openAlertCenter(),2);
    assert.equal(html.split(`<strong>${expected===null?'סכום לא ידוע':money(expected)}</strong>`).length-1,2);
    assert.ok(html.includes('data-click-arg0="bank_missing:42"'));
    assert.equal(center.openAlertTarget('bank_missing:42'),true);
    assert.equal(opened,'עסקי');
    assert.equal(await center.dismissBankAlert('bank_returned_cheque:42'),true);
    assert.equal(dismissed.archiveId,42);
    assert.equal(dismissed.amount,expected);
  }
});

test('Morning selection text never invents a zero for unknown amounts',()=>{
  for(const amount of [...absent,0,'0',25.5]){
    const row=feedFor(amount).transactions[0],expected=row.amount===null?'סכום לא ידוע':money(row.amount);
    assert.ok(morningBankTransactionLabel(row).endsWith(expected),String(amount));
    assert.ok(morningBankTransactionPickerMarkup({activeTransaction:row}).includes(expected));
    const input={dataset:{}},selected={},root={querySelector:selector=>({'#morningBankTransactionSearch':input,'#morningBankTransactionSelected':selected}[selector])};
    syncMorningBankTransactionSelection({transaction:row,root});
    assert.ok(input.value.endsWith(expected));
    assert.ok(selected.innerHTML.endsWith(expected));
    assert.equal(input.dataset.selectedBankTransactionId,'42');
    assert.equal(morningLinkableBankTransactions([row],{today:new Date('2026-10-22T12:00:00Z')}).length,row.amount>0?1:0);
  }
});

for(const site of ['kupa','orders'])test(`${site} bank table distinguishes unknown, zero and signed amounts; absent balances are not financial facts`,t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document});
  const region={innerHTML:''};
  globalThis.document={querySelector:selector=>selector.endsWith('.bank-transactions-region')?region:null};
  const feed=feedFor(null);
  feed.transactions=[null,0,-25,25].map((amount,index)=>({...feed.transactions[0],amount,archiveId:index+1,balanceAfter:amount}));
  const state={bank:{feed},checks:[],expenses:[],cards:[]};
  const view=site==='kupa'
    ?createDomainsBankView({model:{state},ui:{},bankBridgeUiState:()=>({feed}),dateEditorMarkup:()=>''})
    :createDomainsFinanceView({ui:{},controller:{snapshot:()=>({bank:{feed},kupa:state})},dateEditorMarkup:()=>''});
  view.setBankSearch('');
  assert.match(region.innerHTML,/סכום לא ידוע/);
  assert.match(region.innerHTML,/bank-transaction-money credit">[^<]*0[^<]*₪/);
  assert.match(region.innerHTML,/bank-transaction-money debit">[^<]*25[^<]*₪/);
  for(const balance of absent){
    feed.balance=balance;
    view.setBankSearch('');
    assert.ok(!region.innerHTML.includes('bank-primary-balance'),String(balance));
  }
  feed.balance=0;view.setBankSearch('');
  assert.match(region.innerHTML,/bank-primary-balance/);
});
