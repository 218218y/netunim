import assert from 'node:assert/strict';
import {dateInRange as kupaDateInRange,dateSearchAliases as kupaAliases,searchMatch as kupaSearchMatch} from '../netunim-kupa/site/assets/js/core/search.js';
import {dateInRange as ordersDateInRange,dateSearchAliases as ordersAliases,searchMatch as ordersSearchMatch} from '../netunim-orders/site/assets/js/core/search.js';
import {createDomainsChecksView as createKupaChecksView} from '../netunim-kupa/site/assets/js/domains/checks/view.js';
import {createDomainsChecksView as createOrdersChecksView} from '../netunim-orders/site/assets/js/domains/checks/view.js';

const queryForms=['01-09-26','1-09-26','01.09.26','1.9.26','01/09/26','1/9/2026','2026'];
for(const [label,searchMatch,aliases,dateInRange] of [
  ['kupa',kupaSearchMatch,kupaAliases,kupaDateInRange],
  ['orders',ordersSearchMatch,ordersAliases,ordersDateInRange],
]){
  const date='2026-09-01T09:30:00.000Z';
  for(const query of queryForms)assert.equal(searchMatch(query,['פעולה'],[date]),true,`${label}: ${query} must match the same date`);
  assert.equal(searchMatch('02-09-26',['פעולה'],[date]),false,`${label}: another day must not match`);
  assert(aliases(date).includes('1-09-26'),`${label}: unpadded day alias is generated`);
  assert.equal(dateInRange(date,'2026-09-01','2026-09-01'),true,`${label}: exact day range is inclusive`);
  assert.equal(dateInRange(date,'2026-09-02',''),false,`${label}: lower boundary filters earlier rows`);
}

const check={id:'C1',name:'ישראל',checkNumber:'123',note:'',status:'בקופה',amount:500,dueDate:'2026-09-01',depositDate:'2026-09-03',clearedDate:'',createdAt:'2026-08-20T10:00:00Z'};
const kupaUi={checkTab:'open',checkFocus:'all',checkYear:'all',checkSearchValue:'1.9.26',bulkSelected:new Set()};
const kupaChecks=createKupaChecksView({ui:kupaUi,model:{state:{checks:[check]}},syncBulkUi:()=>{},bulkControls:()=>'',bulkHeader:()=>'',bulkCell:()=>'',futureCheckMonths:()=>[]});
assert.equal(kupaChecks.visibleChecks().length,1,'Kupa checks search recognizes flexible due-date input');
kupaUi.checkSearchValue='3/9/26';
assert.equal(kupaChecks.visibleChecks().length,1,'Kupa checks search also recognizes deposit date');

const ordersUi={checkTab:'open',checkYear:'all',checkSearchValue:'01.09.26',checksBulkMode:false,checksBulkSelected:new Set()};
const ordersChecks=createOrdersChecksView({model:{state:{checks:[check]}},ui:ordersUi,checksSession:{},loadSession:()=>false,mountViewLayout:()=>{}});
assert.equal(ordersChecks.visibleChecks().length,1,'Orders checks search recognizes flexible due-date input');
ordersUi.checkSearchValue='20-8-2026';
assert.equal(ordersChecks.visibleChecks().length,1,'Orders checks search recognizes created date');



const statusRows=[
  {...check,id:'OPEN',status:'בקופה'},
  {...check,id:'DEPOSITED',status:'הופקד - במעקב'},
  {...check,id:'CLEARED',status:'נפרע'},
  {...check,id:'RETURNED',status:'חזר'},
  {...check,id:'CANCELLED',status:'בוטל'},
];
for(const [label,createView,uiFactory,args] of [
  ['Kupa',createKupaChecksView,()=>({checkTab:'open',checkFocus:'all',checkYear:'all',checkSearchValue:'',checkAccount:'עסקי',bulkSelected:new Set()}),ui=>({ui,model:{state:{checks:statusRows}},syncBulkUi:()=>{},bulkControls:()=>'',bulkHeader:()=>'',bulkCell:()=>'',futureCheckMonths:()=>[]})],
  ['Orders',createOrdersChecksView,()=>({checkTab:'open',checkYear:'all',checkSearchValue:'',checkAccount:'עסקי',checksBulkMode:false,checksBulkSelected:new Set()}),ui=>({model:{state:{checks:statusRows}},ui,checksSession:{},loadSession:()=>false,mountViewLayout:()=>{}})],
]){
  const ui=uiFactory(),view=createView(args(ui));
  assert.deepEqual(view.visibleChecks().map(row=>row.id),['OPEN','DEPOSITED'],`${label}: the first "הכל" tab includes every non-closed check`);
  ui.checkTab='deposited';
  assert.deepEqual(view.visibleChecks().map(row=>row.id),['DEPOSITED'],`${label}: deposited filter remains specific`);
  ui.checkTab='closed';
  assert.deepEqual(view.visibleChecks().map(row=>row.id),['CLEARED','RETURNED','CANCELLED'],`${label}: closed filter contains only closed statuses`);
}

console.log('PASS date search filters: flexible date forms are canonical across bank/credit/check search helpers');
