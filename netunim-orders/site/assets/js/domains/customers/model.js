

export function customerDebtStatus(d){if(d.paid&&d.invoiceIssued)return{key:'closed',text:'נסגר',cls:'green'};if(d.paid&&!d.invoiceIssued)return{key:'invoice',text:'שולם · חסרה חשבונית',cls:'red'};if(!d.paid&&d.invoiceIssued)return{key:'open',text:'חשבונית יצאה · טרם שולם',cls:'yellow'};return{key:'open',text:'חוב פתוח',cls:'yellow'}}

export function customerDebtNeedsAttention(d){return !(d?.paid&&d?.invoiceIssued)}
export function customerDebtIsOutstanding(d){return !d?.paid}
export function customerDebtFilteredTotal(rows,filter){
  const visibleRows=Array.isArray(rows)?rows:[],sum=items=>items.reduce((total,d)=>total+Number(d?.amount||0),0);
  if(filter==='all'||filter==='open')return sum(visibleRows.filter(customerDebtIsOutstanding));
  return sum(visibleRows);
}

export function customerStatsData(state){
  const rows=state.customerDebts||[],openRows=rows.filter(customerDebtIsOutstanding),openSuppliedRows=openRows.filter(d=>d.supplied===true),openUnsuppliedRows=openRows.filter(d=>d.supplied!==true),sum=items=>items.reduce((total,d)=>total+Number(d.amount||0),0);
  return{openTotal:sum(openRows),openSuppliedTotal:sum(openSuppliedRows),openUnsuppliedTotal:sum(openUnsuppliedRows),allTotal:sum(rows),open:openRows.length,openSupplied:openSuppliedRows.length,openUnsupplied:openUnsuppliedRows.length,missingInvoice:rows.filter(d=>d.paid&&!d.invoiceIssued).length,closed:rows.filter(d=>d.paid&&d.invoiceIssued).length,trackedOrders:(state.customerOrders||[]).length}
}
