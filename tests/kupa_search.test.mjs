import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSearchText,searchMatch} from '../netunim-kupa/site/assets/js/core/search.js';
import {buildKupaGlobalSearchEntries,searchKupaGlobalData} from '../netunim-kupa/site/assets/js/domains/search/model.js';
import {createDomainsCashView} from '../netunim-kupa/site/assets/js/domains/cash/view.js';
import {createDomainsExpensesView} from '../netunim-kupa/site/assets/js/domains/expenses/view.js';
import {createDomainsNotesController} from '../netunim-kupa/site/assets/js/domains/notes/controller.js';
import {localSearchMarkup} from '../netunim-kupa/site/assets/js/ui/search.js';

const state={
  checks:[{id:'CHK1',name:'משה כהן',amount:1500,dueDate:'2026-09-10',status:'בקופה',account:'ביתי',checkNumber:'00177',note:'עבור ארון'}],
  credits:[{id:'CR1',active:true,firstChargeDate:'2999-09-10',totalAmount:450,installments:3,card:'ויזה 1234',account:'עסקי',ownerLabel:'יעקב',description:'מחשב למשרד',transactionDate:'2999-09-02'}],
  creditSync:{version:4,profiles:[],errors:[],cardMappings:{}},
  expenses:[{id:'EXP1',description:'שכירות מחסן',amount:2400,date:'2026-09-01',type:'קבועה',account:'עסקי',recurring:true,active:true}],
  cash:[{id:'CASH1',date:'2026-09-03',type:'הכנסה',description:'מכירה מזומן',amount:780,note:'לקוח ירושלים'}],
  rights:[{id:'RIGHT1',date:'2026-09-03',type:'זכות',description:'הפרשת מעשר',amount:78,note:'ממכירה'}],
  bank:{
    feed:{accountNumber:'12-345-111222',transactions:[{id:'BANK1',date:'2026-09-02',amount:-615,description:'העברה לספק',memo:'אלפא רהיטים',bankReference:'7788',status:'completed',balanceAfter:4100}]},
    homeFeed:{accountNumber:'12-345-333444',transactions:[{id:'BANK2',date:'2026-09-01',amount:900,description:'הפקדת שיקים',memo:'הפקדה בנייד',bankReference:'9911',status:'completed',balanceAfter:2500,checkDetails:{checkNumbers:['4463454']}}]},
  },
  notes:[{id:'NOTE1',content:'להתקשר לרואה חשבון ביום ראשון',createdAt:'2026-09-01',updatedAt:'2026-09-02'}],
  notesSheet:{columns:[{id:'A',title:'פריט',type:'text',width:160},{id:'B',title:'מיקום',type:'text',width:160}],rows:[{id:'ROW1',cells:{A:'ברגים מיוחדים',B:'מדף עליון'},createdAt:'2026-09-01',updatedAt:'2026-09-01'}]},
};

test('Kupa global search indexes every operational data view',()=>{
  const entries=buildKupaGlobalSearchEntries(state);
  assert.deepEqual(new Set(entries.map(x=>x.group)),new Set(['checks','credit','expenses','cash','bank','notes']));
  assert.ok(entries.some(x=>x.kind==='manual-credit'&&x.title==='מחשב למשרד'));
  assert.ok(entries.some(x=>x.kind==='rights-row'&&x.id==='RIGHT1'));
  assert.ok(entries.some(x=>x.kind==='sheet-row'&&x.id==='ROW1'));
});

test('Kupa global search reaches the correct repository for domain-specific terms',()=>{
  const cases=[
    ['00177','checks','CHK1'],
    ['מחשב למשרד','credit',null],
    ['שכירות מחסן','expenses','EXP1'],
    ['מכירה מזומן','cash','CASH1'],
    ['אלפא רהיטים','bank',null],
    ['4463454','bank',null],
    ['רואה חשבון','notes','NOTE1'],
    ['ברגים מיוחדים','notes','ROW1'],
  ];
  for(const [query,group,id] of cases){
    const result=searchKupaGlobalData(state,query),bucket=result.groups.find(x=>x.key===group);
    assert.ok(bucket.total>0,`${query} should match ${group}`);
    if(id)assert.ok(bucket.items.some(x=>x.id===id),`${query} should reveal ${id}`);
  }
});

test('shared Kupa search normalization handles punctuation, compact numbers and date aliases',()=>{
  assert.equal(normalizeSearchText('  050-123/4567  '),'050 123 4567');
  assert.equal(searchMatch('0501234567',['050-123-4567']),true);
  assert.equal(searchMatch('1,500',[1500]),true);
  assert.equal(searchMatch('10/09/26',[],['2026-09-10']),true);
  assert.ok(searchKupaGlobalData(state,'1,500').groups.find(x=>x.key==='checks').items.some(x=>x.id==='CHK1'));
  assert.ok(searchKupaGlobalData(state,'10/09/26').groups.find(x=>x.key==='checks').items.some(x=>x.id==='CHK1'));
});

test('global result totals are computed before per-group render limits',()=>{
  const many={...state,notes:Array.from({length:8},(_,i)=>({id:`N${i}`,content:`תזכורת משותפת ${i}`}))};
  const group=searchKupaGlobalData(many,'תזכורת משותפת',{limitPerGroup:3}).groups.find(x=>x.key==='notes');
  assert.equal(group.total,8);
  assert.equal(group.items.length,3);
});

test('local search helpers use the same matching contract across cash, expenses and notes',()=>{
  const cashUi={cashSearchValue:'ירושלים',bulkSelected:new Set(),bulkCollection:''};
  const cashView=createDomainsCashView({model:{state},ui:cashUi,cashBalance:()=>0,rightsBalance:()=>0,kpi:()=>'',syncBulkUi:()=>{},bulkControls:()=>'',bulkHeader:()=>'',bulkCell:()=>'',dateEditorMarkup:()=>''});
  assert.deepEqual(cashView.visibleLedgerRows(state.cash).map(x=>x.id),['CASH1']);
  cashUi.cashSearchValue='780';assert.deepEqual(cashView.visibleLedgerRows(state.cash).map(x=>x.id),['CASH1']);

  const expenseUi={expenseSearchValue:'עסקי 2400'};
  const expenseView=createDomainsExpensesView({model:{state},ui:expenseUi,bankNextCycleCommitments:()=>({targetExpenseRows:[],targetMonth:'2026-09'}),bankHomeNextCycleCommitments:()=>({targetExpenseRows:[],targetMonth:'2026-09'})});
  assert.equal(expenseView.expenseMatches(state.expenses[0]),true);
  expenseUi.expenseSearchValue='ביתי';assert.equal(expenseView.expenseMatches(state.expenses[0]),false);

  const notesUi={notesTab:'notes',notesSearchValue:'רואה חשבון'};
  const notes=createDomainsNotesController({model:{state:structuredClone(state)},ui:notesUi,saveState:()=>{},confirmDialog:async()=>true});
  assert.deepEqual(notes.visibleNoteRows().map(x=>x.id),['NOTE1']);
});

test('local search markup is accessible and does not own domain filtering logic',()=>{
  const html=localSearchMarkup({value:'abc',placeholder:'חיפוש בדיקה',inputAction:'demo-search',label:'חיפוש בדיקה',className:'wide'});
  assert.match(html,/type="search"/);
  assert.match(html,/aria-label="חיפוש בדיקה"/);
  assert.match(html,/data-input="demo-search"/);
  assert.match(html,/class="local-search wide"/);
});
