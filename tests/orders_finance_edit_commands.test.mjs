import test from 'node:test';
import assert from 'node:assert/strict';
import {createCashflowSettingsCommands} from '../netunim-orders/site/assets/js/domains/finance/cashflow-commands.js';
import {createBankArchiveCommands} from '../netunim-orders/site/assets/js/domains/finance/bank-archive-commands.js';

test('Cashflow commands reject invalid values before document authority and preserve the other account',async()=>{
  let authenticated=true,writes=0,state={cashflowSettings:{businessMinimum:15,homeMinimum:30,homeCheckCutoffDay:9,businessCheckCutoffDay:10}};
  const messages=[],api=createCashflowSettingsCommands({loadSession:()=>authenticated,toast:message=>messages.push(message),mutateKupaCloud:async edit=>{writes++;state=edit(state);return {}}});
  assert.equal(await api.saveCashflowMinimum('home','not money'),false);assert.equal(await api.saveCashflowCheckCutoff('home','1.5'),false);assert.equal(writes,0);
  assert.equal(await api.saveCashflowMinimum('home','42.5'),true);assert.equal(state.cashflowSettings.homeMinimum,42.5);assert.equal(state.cashflowSettings.businessMinimum,15);
  assert.equal(await api.saveCashflowCheckCutoff('business',28),true);assert.equal(state.cashflowSettings.businessCheckCutoffDay,28);assert.equal(state.cashflowSettings.homeCheckCutoffDay,9);
  authenticated=false;assert.equal(await api.saveCashflowMinimum('business',5),false);assert.equal(writes,2);
});
test('Bank archive edit cannot publish a receipt after account replacement',async()=>{
  let release,current=true,updated=0;const held=new Promise(resolve=>release=resolve),row={id:1,handledAt:null};
  const api=createBankArchiveCommands({operationScope:{capture:()=>()=>{if(!current)throw Error('account changed')}},
    transport:{saveBankTransactionHandled:async()=>{await held;return {handled_at:'confirmed'}},acknowledgeBankTransactionMissing:async()=>{await held;return {acknowledged_at:'confirmed'}}},
    archive:{update:(_id,edit)=>{updated++;edit(row);return true}},toast:()=>{},
  });
  const work=api.toggleBankTransactionHandled(1,true);current=false;release();assert.equal(await work,false);assert.equal(updated,0);assert.equal(row.handledAt,null);
  assert.equal(await api.toggleBankTransactionHandled('invalid',true),false);
});
