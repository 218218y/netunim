import {esc} from '../core/values.js';
import {money} from '../core/money.js';
import {checkDateFmt,checkTodayISO} from '../core/dates.js';
import {cashflowWarningItems} from '../domains/bank/alerts.js';
import {dueCheckWarningItems} from '../domains/checks/alerts.js';

function cashflowReason(item){
  return item.reason==='negative'
    ?'התחזית עוברת למינוס.'
    :`התחזית הגיעה לסף המינימום שהוגדר (${money(item.minimum)}) או ירדה מתחתיו.`;
}

function alertCard(item){
  const actionAttrs=`type="button" class="alert-center-card ${item.kind==='cashflow'?'cashflow-warning':'check-warning'} alert-center-card-action" data-action="open-alert-target" data-click-arg0="${esc(item.id)}"`;
  if(item.kind==='cashflow')return `<button ${actionAttrs}><div class="alert-center-card-icon" aria-hidden="true">!</div><div class="alert-center-card-main"><div class="alert-center-card-kicker">עו״ש תזרימי · חשבון ${esc(item.account)}</div><div class="alert-center-card-title">יתרה צפויה <strong>${money(item.projected)}</strong></div><p>${esc(cashflowReason(item))}</p><small>התחזית מחושבת מיתרת העו״ש האחרונה ובהפחתת חיובי האשראי וההוצאות של אותו חשבון.</small></div><span class="alert-center-card-open" aria-hidden="true">פתח</span></button>`;
  const dueText=item.isToday?`מועד ההפקדה הוא היום · ${checkDateFmt(item.dueDate)}`:`מועד ההפקדה עבר · ${checkDateFmt(item.dueDate)}`;
  const facts=[item.checkNumber?`מס׳ צ׳ק ${item.checkNumber}`:'',item.note?item.note:''].filter(Boolean);
  return `<button ${actionAttrs}><div class="alert-center-card-icon" aria-hidden="true">!</div><div class="alert-center-card-main"><div class="alert-center-card-kicker">צ׳ק שממתין להפקדה</div><div class="alert-center-card-title"><span>${esc(item.name||'ללא שם')}</span><strong>${money(item.amount)}</strong></div><p>${esc(dueText)}</p>${facts.length?`<small>${facts.map(esc).join(' · ')}</small>`:''}</div><span class="alert-center-card-open" aria-hidden="true">פתח</span></button>`;
}

export function createUiAlertCenter({model,financeSnapshot,modal,closeModal=()=>{},navigateToChecks=()=>{},navigateToCashflow=()=>{}}){
  let startupHandled=false;

  function currentAlerts(today=checkTodayISO()){
    const snapshot=financeSnapshot?.()||{};
    return [
      ...cashflowWarningItems(snapshot.kupa),
      ...dueCheckWarningItems(model?.state?.checks,today),
    ];
  }

  function refreshIndicator(){
    const button=document.getElementById('alertCenterButton'),countEl=document.getElementById('alertCenterCount');
    if(!button||!countEl)return currentAlerts();
    const alerts=currentAlerts(),count=alerts.length,active=count>0;
    button.hidden=!active;
    button.classList.toggle('active',active);
    button.setAttribute('aria-label',active?`${count} אזהרות פעילות`:'אין אזהרות פעילות');
    button.title=active?`${count} אזהרות פעילות`:'אין אזהרות פעילות';
    countEl.textContent=String(count);
    countEl.hidden=!active;
    return alerts;
  }

  function modalBody(alerts,{startup=false}={}){
    const count=alerts.length;
    const intro=startup
      ?`<div class="alert-center-intro"><div class="alert-center-intro-icon" aria-hidden="true">!</div><div><b>${count===1?'יש אזהרה שדורשת תשומת לב':`יש ${count} אזהרות שדורשות תשומת לב`}</b><span>הפרטים מוצגים כאן בצורה מרוכזת וברורה. אותן אזהרות זמינות גם מסימן האזהרה בראש המסך.</span></div></div>`
      :`<div class="alert-center-summary"><b>${count?`${count} אזהרות פעילות`:'אין כרגע אזהרות פעילות'}</b><span>${count?'הרשימה מתעדכנת לפי הנתונים הנוכחיים.':'כשהמערכת תזהה חריגה תזרימית או צ׳ק שהגיע להפקדה, היא תופיע כאן.'}</span></div>`;
    const list=count?`<div class="alert-center-list">${alerts.map(alertCard).join('')}</div>`:'<div class="alert-center-empty"><span aria-hidden="true">✓</span><b>הכול תקין כרגע</b></div>';
    return `${intro}${list}`;
  }

  function openAlertCenter({startup=false}={}){
    const alerts=refreshIndicator();
    modal(startup?'התראות בפתיחת המערכת':'מרכז אזהרות',modalBody(alerts,{startup}),'<button class="btn primary" type="button" data-action="close-modal">הבנתי</button>');
    return alerts.length;
  }

  function openAlertTarget(alertId){
    const item=currentAlerts().find(row=>row.id===String(alertId||''));
    if(!item)return false;
    closeModal();
    if(item.kind==='check_due'){navigateToChecks(item.checkId);return true}
    if(item.kind==='cashflow'){navigateToCashflow(item.account);return true}
    return false;
  }

  function showStartupAlerts(){
    if(startupHandled)return false;
    startupHandled=true;
    const alerts=refreshIndicator();
    if(!alerts.length)return false;
    openAlertCenter({startup:true});
    return true;
  }

  return {currentAlerts,refreshIndicator,openAlertCenter,openAlertTarget,showStartupAlerts};
}
