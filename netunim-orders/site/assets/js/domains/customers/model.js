

export function customerDebtStatus(d){if(d.paid&&d.invoiceIssued)return{key:'closed',text:'נסגר',cls:'green'};if(d.paid&&!d.invoiceIssued)return{key:'invoice',text:'שולם · חסרה חשבונית',cls:'red'};if(!d.paid&&d.invoiceIssued)return{key:'open',text:'חשבונית יצאה · טרם שולם',cls:'yellow'};return{key:'open',text:'חוב פתוח',cls:'yellow'}}

export function customerStatsData(state){const rows=state.customerDebts||[];return{openTotal:rows.filter(d=>!d.paid).reduce((s,d)=>s+Number(d.amount||0),0),allTotal:rows.reduce((s,d)=>s+Number(d.amount||0),0),open:rows.filter(d=>!d.paid).length,missingInvoice:rows.filter(d=>d.paid&&!d.invoiceIssued).length,closed:rows.filter(d=>d.paid&&d.invoiceIssued).length,trackedOrders:(state.customerOrders||[]).length}}
