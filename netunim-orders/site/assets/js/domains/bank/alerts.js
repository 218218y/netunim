import {kupaAccountCashflowData} from './readout.js';

export function cashflowWarningItems(kupa){
  if(!kupa||typeof kupa!=='object')return [];
  const rows=[kupaAccountCashflowData(kupa,'עסקי').alert,kupaAccountCashflowData(kupa,'ביתי').alert];
  return rows.filter(row=>row.active).map(row=>({
    id:`cashflow:${row.account}`,
    kind:'cashflow',
    account:row.account,
    projected:row.projected,
    minimum:row.minimum,
    reason:row.reason,
  }));
}
