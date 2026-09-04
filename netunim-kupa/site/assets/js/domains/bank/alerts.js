import {money} from '../../core/money.js';
import {cashflowAlerts} from '../../shared/cashflow.js';

function alertReason(row){return row.reason==='negative'?'צפוי לעבור למינוס':`צפוי להגיע לסף המינימום שהוגדר (${money(row.minimum)}) או לרדת מתחתיו`}

// Startup-only coordinator. It waits until projected bank data is actually available,
// so an early render before cloud/finance hydration cannot suppress a real warning.
export function createDomainsBankAlerts({model,bankProjectedThisMonth,bankHomeProjectedThisMonth,modal,closeModal}){
  let resolved=false,shown=false;
  function maybeShowStartupCashflowAlert(){
    if(resolved||shown)return false;
    const business=bankProjectedThisMonth(),home=bankHomeProjectedThisMonth();
    if(business===null&&home===null)return false;
    const active=cashflowAlerts({business,home},model.state.cashflowSettings).filter(row=>row.active);
    if(!active.length){if(business!==null&&home!==null)resolved=true;return false}
    shown=true;resolved=true;
    const rows=active.map(row=>`<div class="notice danger" style="margin-top:9px"><b>חשבון ${row.account}</b> · עו״ש תזרימי צפוי: <b>${money(row.projected)}</b><br>${alertReason(row)}.</div>`).join('');
    modal('אזהרת עו״ש תזרימי',`<div class="soft-note">התחזית מבוססת על יתרת העו״ש האחרונה פחות סליקות אשראי והוצאות של אותו חשבון, ובתוספת הצ׳קים מאותו חשבון שעדיין בקופה ונכנסים עד יום החיתוך שהוגדר.</div>${rows}`,'הבנתי',()=>closeModal(true));
    return true;
  }
  return {maybeShowStartupCashflowAlert};
}
