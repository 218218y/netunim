import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiGlobalSearch} from '../netunim-kupa/site/assets/js/ui/global-search.js';

function harness(){
  const calls=[];
  const ui={
    checkTab:'open',checkAccount:'עסקי',checkYear:'2026',checkFocus:'overdue',checkSearchValue:'local',
    expensesTab:'credit',creditAccountFilter:'ביתי',creditProviderFilter:'max',creditCardFilter:'card',creditSearchValue:'local',creditDetailFocus:null,
    expenseSearchValue:'local',cashSearchValue:'local',bankAccountView:'business',bankDateMode:'range',bankDateFrom:'2026-08-01',bankDateTo:'2026-08-31',bankSearchValue:'local',notesTab:'notes',notesSearchValue:'local',notesSheetSearchValue:'sheet-local',
  };
  const previousDocument=globalThis.document,previousRaf=globalThis.requestAnimationFrame;
  globalThis.document={querySelectorAll:()=>[]};
  globalThis.requestAnimationFrame=callback=>{callback();return 1};
  const search=createUiGlobalSearch({model:{state:{}},ui,setPage:page=>calls.push(page)});
  return {search,ui,calls,restore(){globalThis.document=previousDocument;globalThis.requestAnimationFrame=previousRaf}};
}

test('Kupa global check navigation removes local constraints and selects the correct account',()=>{
  const h=harness();try{
    assert.equal(h.search.navigateItem({group:'checks',kind:'check',id:'C1',account:'ביתי'}),true);
    assert.deepEqual(h.calls,['checks']);
    assert.deepEqual([h.ui.checkTab,h.ui.checkAccount,h.ui.checkYear,h.ui.checkFocus,h.ui.checkSearchValue],['all','ביתי','all','all','']);
  }finally{h.restore()}
});

test('credit and expense results select the proper expense subview without stale local filters',()=>{
  const h=harness();try{
    h.search.navigateItem({group:'credit',kind:'manual-credit',id:'manual:C1:2999-09-10:1',monthKey:'2999-09',cardKey:'manual:ויזה'});
    assert.equal(h.ui.expensesTab,'credit');
    assert.equal(h.ui.creditSearchValue,'');
    assert.equal(h.ui.creditAccountFilter,'all');assert.equal(h.ui.creditProviderFilter,'all');assert.equal(h.ui.creditCardFilter,'all');
    assert.deepEqual(h.ui.creditDetailFocus,{monthKey:'2999-09',cardKey:'manual:ויזה'});
    h.search.navigateItem({group:'expenses',kind:'expense',id:'E1'});
    assert.equal(h.ui.expensesTab,'expenses');assert.equal(h.ui.expenseSearchValue,'');
    assert.deepEqual(h.calls,['credit','credit']);
  }finally{h.restore()}
});

test('cash, bank and notes results open their native views and clear filters that could hide the target',()=>{
  const h=harness();try{
    h.search.navigateItem({group:'cash',kind:'rights-row',id:'R1'});
    assert.equal(h.ui.cashSearchValue,'');
    h.search.navigateItem({group:'bank',kind:'bank-transaction',id:'home:B1:2026-09-01:10',role:'home'});
    assert.deepEqual([h.ui.bankAccountView,h.ui.bankDateMode,h.ui.bankDateFrom,h.ui.bankDateTo,h.ui.bankSearchValue],['home','all','','','']);
    h.search.navigateItem({group:'notes',kind:'sheet-row',id:'S1'});
    assert.equal(h.ui.notesTab,'sheet');assert.equal(h.ui.notesSheetSearchValue,'');assert.equal(h.ui.notesSearchValue,'local');
    assert.deepEqual(h.calls,['cash','bank','notes']);
  }finally{h.restore()}
});

test('unknown Kupa global result groups are rejected',()=>{
  const h=harness();try{assert.equal(h.search.navigateItem({group:'other',id:'1'}),false);assert.deepEqual(h.calls,[])}finally{h.restore()}
});
