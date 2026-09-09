import {ordersOpenCustomerDebtSummaryData} from '../../shared/orders-finance.js';
import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';

export function customerDebtStatus(d){
  const p=customerDebtProgressData(d);
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

export function customerDebtNeedsAttention(d){const p=customerDebtProgressData(d);return !(p.paymentComplete&&p.invoiceComplete)}
export function customerDebtIsOutstanding(d){return !customerDebtProgressData(d).paymentComplete}
export function customerDebtFilteredTotal(rows,filter){
  const visibleRows=Array.isArray(rows)?rows:[];
  if(filter==='all'||filter==='open')return visibleRows.filter(customerDebtIsOutstanding).reduce((total,d)=>total+customerDebtProgressData(d).remainingPayment,0);
  return visibleRows.reduce((total,d)=>total+Number(d?.amount||0),0);
}

export function customerStatsData(state){
  const rows=state.customerDebts||[],openRows=rows.filter(customerDebtIsOutstanding),openSuppliedRows=openRows.filter(d=>d.supplied===true),openUnsuppliedRows=openRows.filter(d=>d.supplied!==true),sumOriginal=items=>items.reduce((total,d)=>total+Number(d.amount||0),0),sumRemaining=items=>items.reduce((total,d)=>total+customerDebtProgressData(d).remainingPayment,0),openSummary=ordersOpenCustomerDebtSummaryData(state);
  return{openTotal:openSummary.openTotal,openSuppliedTotal:sumRemaining(openSuppliedRows),openUnsuppliedTotal:sumRemaining(openUnsuppliedRows),allTotal:sumOriginal(rows),open:openSummary.open,openSupplied:openSuppliedRows.length,openUnsupplied:openUnsuppliedRows.length,missingInvoice:rows.filter(d=>{const p=customerDebtProgressData(d);return p.paymentComplete&&!p.invoiceComplete}).length,closed:rows.filter(d=>{const p=customerDebtProgressData(d);return p.paymentComplete&&p.invoiceComplete}).length,trackedOrders:(state.customerOrders||[]).length}
}
