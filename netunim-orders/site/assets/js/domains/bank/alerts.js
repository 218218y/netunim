import {money} from '../../core/money.js';
import {kupaAccountCashflowData} from './readout.js';

function alertReason(row){return row.reason==='negative'?'צפוי לעבור למינוס':`צפוי להגיע לסף המינימום שהוגדר (${money(row.minimum)}) או לרדת מתחתיו`}

export function createDomainsBankAlerts({financeSnapshot,modal}){
  let resolved=false,shown=false;
  function maybeShowStartupCashflowAlert(){
    if(resolved||shown)return false;
    const kupa=financeSnapshot().kupa;if(!kupa)return false;
    const business=kupaAccountCashflowData(kupa,'עסקי'),home=kupaAccountCashflowData(kupa,'ביתי'),active=[business.alert,home.alert].filter(row=>row.active);
    if(!active.length){if(business.projected!==null&&home.projected!==null)resolved=true;return false}
    shown=true;resolved=true;
    const rows=active.map(row=>`<div class="notice bad" style="margin-top:9px"><b>חשבון ${row.account}</b> · עו״ש תזרימי צפוי: <b>${money(row.projected)}</b><br>${alertReason(row)}.</div>`).join('');
    modal('אזהרת עו״ש תזרימי',`<div class="notice">התחזית מבוססת על יתרת העו״ש האחרונה פחות סליקות אשראי והוצאות השייכות לאותו חשבון.</div>${rows}`,`<button class="btn primary" type="button" data-action="close-modal">הבנתי</button>`);
    return true;
  }
  return {maybeShowStartupCashflowAlert};
}
