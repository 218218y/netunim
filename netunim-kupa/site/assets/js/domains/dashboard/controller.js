import {ordersFinanceSummaryData} from '../../shared/orders-finance.js';

// Read-only cross-app summary. Orders remains the sole owner of supplier/customer data.
export function createDomainsDashboardController({session,ui,readOrdersReadOnlyMeta,readOrdersReadOnlyCloud,renderDashboard}){
function currentOwnerId(){return String(session.supaSession?.user?.id||'')}
function clearStaleOwnerSummary(){const owner=currentOwnerId(),known=String(session.ordersFinanceOwnerId||'');if(owner&&known&&owner!==known){session.ordersFinanceRevision=0;session.ordersFinanceUpdatedAt=null;session.ordersFinanceSummary=null;session.ordersFinanceCheckedAt=0;session.ordersFinanceOwnerId=owner}return owner}
function summary(){if(session.connectionMode!=='supabase'||!session.backendReady)return null;const owner=currentOwnerId(),known=String(session.ordersFinanceOwnerId||'');if(owner&&known&&owner!==known)return null;return session.ordersFinanceSummary&&typeof session.ordersFinanceSummary==='object'?session.ordersFinanceSummary:null}
async function refreshOrdersFinanceSummary({force=false,renderIfChanged=true}={}){
  if(session.connectionMode!=='supabase'||!session.backendReady||!navigator.onLine)return false;
  const owner=clearStaleOwnerSummary();
  if(session.ordersFinanceReadPromise)return session.ordersFinanceReadPromise;
  const now=Date.now();if(!force&&now-Number(session.ordersFinanceCheckedAt||0)<10_000)return false;
  session.ordersFinanceCheckedAt=now;
  session.ordersFinanceReadPromise=(async()=>{
    const meta=await readOrdersReadOnlyMeta(),revision=Number(meta?.revision||0);
    if(!revision)return false;
    if(!force&&revision===Number(session.ordersFinanceRevision||0)&&summary())return false;
    const row=await readOrdersReadOnlyCloud();if(!row?.state)return false;
    const next=ordersFinanceSummaryData(row.state),changed=revision!==Number(session.ordersFinanceRevision||0)||JSON.stringify(next)!==JSON.stringify(summary());
    session.ordersFinanceRevision=Number(row.revision||revision);session.ordersFinanceUpdatedAt=row.updated_at||meta?.updated_at||null;session.ordersFinanceSummary=next;if(owner)session.ordersFinanceOwnerId=owner;
    if(changed&&renderIfChanged&&ui.currentPage==='dashboard')renderDashboard();
    return changed;
  })().catch(error=>{console.error('orders finance summary read',error);return false}).finally(()=>{session.ordersFinanceReadPromise=null});
  return session.ordersFinanceReadPromise;
}
return {summary,refreshOrdersFinanceSummary};
}
