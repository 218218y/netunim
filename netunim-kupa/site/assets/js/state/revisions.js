import {createDomainRevisionLedger} from '../shared/domain-revisions.js';

function bankCore(state){const bank=state?.bank&&typeof state.bank==='object'?state.bank:{};const {feed:_feed,homeFeed:_homeFeed,...core}=bank;return core}
function bankFeed(state){return {feed:state?.bank?.feed||null,homeFeed:state?.bank?.homeFeed||null}}

export const KUPA_PAGE_DOMAINS=Object.freeze({
  dashboard:['cash','rights','checks','credits','creditSync','expenses','bank','bankFeed','cashflowSettings','ordersFinance'],
  checks:['checks','bankFeed','bankDisplay'],
  credit:['checks','credits','creditSync','expenses','bankFeed'],
  cash:['cash','rights'],
  bank:['checks','credits','creditSync','expenses','bank','bankFeed','bankDisplay','cashflowSettings'],
  expenses:['checks','credits','creditSync','expenses','bank','bankFeed','bankDisplay','cashflowSettings'],
  notes:['notes'],
});

export function createKupaDomainRevisions(session){
  session.domainRevisions??={};
  return createDomainRevisionLedger({target:session.domainRevisions,domains:{
    cash:{field:'cashRev',select:state=>state?.cash||[]},
    rights:{field:'rightsRev',select:state=>({rows:state?.rights||[],lastCalculatedDate:state?.rightsLastCalculatedDate||null})},
    checks:{field:'checksRev',select:state=>state?.checks||[]},
    credits:{field:'creditsRev',select:state=>({credits:state?.credits||[],cards:state?.cards||[]})},
    creditSync:{field:'creditSyncRev',select:state=>state?.creditSync||null},
    expenses:{field:'expensesRev',select:state=>state?.expenses||[]},
    bank:{field:'bankRev',select:bankCore},
    bankFeed:{field:'bankFeedRev',select:bankFeed},
    bankDisplay:{field:'bankDisplayRev'},
    notes:{field:'notesRev',select:state=>state?.notes||[]},
    cashflowSettings:{field:'cashflowSettingsRev',select:state=>state?.cashflowSettings||null},
    ordersFinance:{field:'ordersFinanceRev'},
  }});
}

export function kupaPageRevision(ledger,page){return ledger.stamp(KUPA_PAGE_DOMAINS[page]||[])}
