import {ordersOpenCustomerDebtSummaryData} from '../../shared/orders-finance.js';
import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';
import {createRevisionSelector} from '../../shared/revision-selector.js';

export function customerDebtStatus(d,p=customerDebtProgressData(d)){
  if(p.paymentComplete&&p.invoiceComplete)return{key:'closed',text:'נסגר',cls:'green'};
  if(p.paymentPartial&&p.invoicePartial)return{key:'partial',text:'תשלום וחשבונית חלקיים',cls:'orange'};
  if(p.paymentComplete&&p.invoicePartial)return{key:'partial',text:'שולם · חשבונית חלקית',cls:'orange'};
  if(p.paymentPartial&&p.invoiceComplete)return{key:'partial',text:'חשבונית יצאה · שולם חלקית',cls:'orange'};
  if(p.paymentPartial)return{key:'partial',text:p.invoiceComplete?'חשבונית יצאה · שולם חלקית':'שולם חלקית',cls:'orange'};
  if(p.invoicePartial)return{key:'partial',text:p.paymentComplete?'שולם · חשבונית חלקית':'חשבונית חלקית · טרם שולם',cls:'orange'};
  if(p.paymentComplete&&!p.invoiceComplete)return{key:'invoice',text:'שולם-ללא ח״מ',cls:'red'};
  if(!p.paymentComplete&&p.invoiceComplete)return{key:'open',text:'ח״מ-לא שולם',cls:'yellow'};
  return{key:'open',text:'חוב פתוח',cls:'yellow'};
}

export function customerDebtMatchesFilter(progress,filter){
  if(filter==='all')return !(progress.paymentComplete&&progress.invoiceComplete);
  if(filter==='open')return !progress.paymentComplete;
  if(filter==='invoice')return !progress.invoiceComplete;
  if(filter==='closed')return progress.paymentComplete&&progress.invoiceComplete;
  return true;
}

export function customerDebtRenderModelData(state){
  const stats={openTotal:0,openSuppliedTotal:0,openUnsuppliedTotal:0,allTotal:0,open:0,openSupplied:0,openUnsupplied:0,missingInvoice:0,closed:0,trackedOrders:(state.customerOrders||[]).length};
  const rows=(state.customerDebts||[]).map(record=>{
    const progress=customerDebtProgressData(record),status=customerDebtStatus(record,progress);
    stats.allTotal+=Number(record.amount||0);
    if(!progress.paymentComplete){
      stats.open++;stats.openTotal+=progress.remainingPayment;
      if(record.supplied===true){stats.openSupplied++;stats.openSuppliedTotal+=progress.remainingPayment}
      else{stats.openUnsupplied++;stats.openUnsuppliedTotal+=progress.remainingPayment}
    }
    if(customerDebtMatchesFilter(progress,'invoice'))stats.missingInvoice++;
    if(customerDebtMatchesFilter(progress,'closed'))stats.closed++;
    return {record,progress,status,search:`${record.customerName||''} ${record.phone||''} ${record.note||''} ${record.clearingApproval||''} ${record.customerId||''}`.toLocaleLowerCase()};
  }).sort((a,b)=>Number(b.record.amount||0)-Number(a.record.amount||0));
  return {rows,stats};
}
export function createCustomerRenderSelector({state,revision}){return createRevisionSelector({revision,name:'customer-debts',select:()=>customerDebtRenderModelData(state())})}

export function customerDebtNeedsAttention(d){const p=customerDebtProgressData(d);return !(p.paymentComplete&&p.invoiceComplete)}
export function customerDebtIsOutstanding(d){return !customerDebtProgressData(d).paymentComplete}
export function customerDebtFilteredTotal(rows,filter,progressFor=customerDebtProgressData){
  const visibleRows=Array.isArray(rows)?rows:[];
  if(filter==='all'||filter==='open')return visibleRows.reduce((total,d)=>{const progress=progressFor(d);return total+(progress.paymentComplete?0:progress.remainingPayment)},0);
  if(filter==='invoice')return visibleRows.reduce((total,d)=>total+progressFor(d).remainingInvoice,0);
  return visibleRows.reduce((total,d)=>total+Number(d?.amount||0),0);
}

export function customerStatsData(state){
  const rows=state.customerDebts||[],openRows=rows.filter(customerDebtIsOutstanding),openSuppliedRows=openRows.filter(d=>d.supplied===true),openUnsuppliedRows=openRows.filter(d=>d.supplied!==true),sumOriginal=items=>items.reduce((total,d)=>total+Number(d.amount||0),0),sumRemaining=items=>items.reduce((total,d)=>total+customerDebtProgressData(d).remainingPayment,0),openSummary=ordersOpenCustomerDebtSummaryData(state);
  return{openTotal:openSummary.openTotal,openSuppliedTotal:sumRemaining(openSuppliedRows),openUnsuppliedTotal:sumRemaining(openUnsuppliedRows),allTotal:sumOriginal(rows),open:openSummary.open,openSupplied:openSuppliedRows.length,openUnsupplied:openUnsuppliedRows.length,missingInvoice:rows.filter(d=>customerDebtMatchesFilter(customerDebtProgressData(d),'invoice')).length,closed:rows.filter(d=>customerDebtMatchesFilter(customerDebtProgressData(d),'closed')).length,trackedOrders:(state.customerOrders||[]).length}
}
