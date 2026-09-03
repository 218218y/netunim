function num(value){const n=Number(value);return Number.isFinite(n)?n:0}
function roundMoney(value){return Math.round((value+Number.EPSILON)*100)/100}

export function ordersOpenCustomerDebtSummaryData(state){
  const rows=Array.isArray(state?.customerDebts)?state.customerDebts:[],openRows=rows.filter(row=>!row?.paid);
  return {openTotal:openRows.reduce((sum,row)=>sum+num(row?.amount),0),open:openRows.length};
}

export function ordersSupplierBalanceSummaryData(state){
  const suppliers=Array.isArray(state?.suppliers)?state.suppliers:[],transactions=Array.isArray(state?.transactions)?state.transactions:[];let debt=0,credit=0;
  for(const supplier of suppliers){let raw=0;for(const tx of transactions)if(tx?.supplierId===supplier?.id)raw+=num(tx?.credit)-num(tx?.debit);const balance=roundMoney(raw);if(balance<0)debt+=-balance;else credit+=balance}
  return {debt,credit,net:credit-debt};
}

export function ordersFinanceSummaryData(state){
  const customers=ordersOpenCustomerDebtSummaryData(state),suppliers=ordersSupplierBalanceSummaryData(state);
  return {customerOpen:customers.openTotal,customerOpenCount:customers.open,supplierDebt:suppliers.debt,supplierCredit:suppliers.credit,supplierNet:suppliers.net};
}
