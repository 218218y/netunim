import {esc} from '../core/values.js';
import {money} from '../core/money.js';
import {checkDateFmt,checkTodayISO} from '../core/dates.js';
import {bankWarningItems,cashflowWarningItems} from '../domains/bank/alerts.js';
import {dueCheckWarningItems} from '../domains/checks/alerts.js';

function cashflowReason(item){
  return item.reason==='negative'
    ?'התחזית עוברת למינוס.'
    :`התחזית הגיעה לסף המינימום שהוגדר (${money(item.minimum)}) או ירדה מתחתיו.`;
}

function bankWhen(value){
  if(!value)return '';
  const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';
  return `${d.toLocaleDateString('he-IL')} · ${d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}`;
}

function bankAlertCard(item){
  const returned=item.kind==='bank_returned_cheque',title=returned?'החזרת שיק':(item.cheque?'הפקדת צ׳ק נגרעה מתנועות הבנק':'תנועה נגרעה מתנועות הבנק');
  const facts=returned
    ?[bankWhen(item.date),item.bankReference?`אסמכתא ${item.bankReference}`:''].filter(Boolean)
    :[item.lastSeenAt?`נראתה לאחרונה ${bankWhen(item.lastSeenAt)}`:'',item.missingSince?`חסרה מאז ${bankWhen(item.missingSince)}`:''].filter(Boolean);
  const detail=returned?(item.reason?`סיבת ההחזרה: ${item.reason}`:item.description):item.description;
  return `<div class="alert-center-card bank-warning ${returned?'bank-returned-warning':'bank-missing-warning'} alert-center-bank-card"><button type="button" class="alert-center-bank-open alert-center-card-action" data-action="open-alert-target" data-click-arg0="${esc(item.id)}"><div class="alert-center-card-icon" aria-hidden="true">!</div><div class="alert-center-card-main"><div class="alert-center-card-kicker">בנק · חשבון ${esc(item.account)}</div><div class="alert-center-card-title"><span>${esc(title)}</span><strong>${money(item.amount)}</strong></div><p>${esc(detail)}</p>${facts.length?`<small>${facts.map(esc).join(' · ')}</small>`:''}</div><span class="alert-center-card-open" aria-hidden="true">פתח</span></button><div class="alert-center-bank-actions"><button type="button" class="alert-center-card-dismiss" data-action="dismiss-bank-alert" data-click-arg0="${esc(item.id)}">הסר / אל תראה שוב</button></div></div>`;
}

function alertCard(item){
  if(item.kind==='bank_returned_cheque'||item.kind==='bank_missing')return bankAlertCard(item);
  const actionAttrs=`type="button" class="alert-center-card ${item.kind==='cashflow'?'cashflow-warning':'check-warning'} alert-center-card-action" data-action="open-alert-target" data-click-arg0="${esc(item.id)}"`;
  if(item.kind==='cashflow')return `<button ${actionAttrs}><div class="alert-center-card-icon" aria-hidden="true">!</div><div class="alert-center-card-main"><div class="alert-center-card-kicker">עו״ש תזרימי · חשבון ${esc(item.account)}</div><div class="alert-center-card-title">יתרה צפויה <strong>${money(item.projected)}</strong></div><p>${esc(cashflowReason(item))}</p><small>התחזית מחושבת מיתרת העו״ש האחרונה, פחות חיובי האשראי וההוצאות של אותו חשבון, ובתוספת צ׳קים מאותו חשבון שעדיין בקופה ונכנסים עד יום החיתוך שהוגדר.</small></div><span class="alert-center-card-open" aria-hidden="true">פתח</span></button>`;
  const dueText=item.isToday?`מועד ההפקדה הוא היום · ${checkDateFmt(item.dueDate)}`:`מועד ההפקדה עבר · ${checkDateFmt(item.dueDate)}`;
  const facts=[item.checkNumber?`מס׳ צ׳ק ${item.checkNumber}`:'',item.note?item.note:''].filter(Boolean);
  return `<div class="alert-center-card check-warning alert-center-check-card"><button type="button" class="alert-center-check-open alert-center-card-action" data-action="open-alert-target" data-click-arg0="${esc(item.id)}"><div class="alert-center-card-icon" aria-hidden="true">!</div><div class="alert-center-card-main"><div class="alert-center-card-kicker">צ׳ק ${esc(item.account||'עסקי')} שממתין להפקדה</div><div class="alert-center-card-title"><span>${esc(item.name||'ללא שם')}</span><strong>${money(item.amount)}</strong></div><p>${esc(dueText)}</p>${facts.length?`<small>${facts.map(esc).join(' · ')}</small>`:''}</div><span class="alert-center-card-open" aria-hidden="true">פתח</span></button><div class="alert-center-check-actions"><button type="button" class="alert-center-card-deposit" data-action="mark-alert-check-deposited" data-click-arg0="${esc(item.checkId)}">הופקד</button></div></div>`;
}

export function createUiAlertCenter({model,financeSnapshot,modal,closeModal=()=>{},navigateToChecks=()=>{},navigateToCashflow=()=>{},navigateToBank=navigateToCashflow,markCheckDeposited=()=>false,dismissBankWarning=async()=>false}){
  let startupHandled=false,openMode=null;

  function currentAlerts(today=checkTodayISO()){
    const snapshot=financeSnapshot?.()||{};
    return [
      ...bankWarningItems(snapshot.bank),
      ...cashflowWarningItems(snapshot.kupa),
      ...dueCheckWarningItems(model?.state?.checks,today),
    ];
  }

  function refreshIndicator(){
    const button=document.getElementById('alertCenterButton'),slot=document.getElementById('alertCenterSlot'),countEl=document.getElementById('alertCenterCount');
    if(!button||!countEl)return currentAlerts();
    const alerts=currentAlerts(),count=alerts.length,active=count>0;
    if(slot)slot.hidden=!active;
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
      :`<div class="alert-center-summary"><b>${count?`${count} אזהרות פעילות`:'אין כרגע אזהרות פעילות'}</b><span>${count?'הרשימה מתעדכנת לפי הנתונים הנוכחיים.':'כשהמערכת תזהה אירוע בנק חשוב, חריגה תזרימית או צ׳ק שהגיע להפקדה, הוא יופיע כאן.'}</span></div>`;
    const list=count?`<div class="alert-center-list">${alerts.map(alertCard).join('')}</div>`:'<div class="alert-center-empty"><span aria-hidden="true">✓</span><b>הכול תקין כרגע</b></div>';
    return `${intro}${list}`;
  }

  function renderOpenAlertCenter(){
    const startup=openMode==='startup',alerts=refreshIndicator();
    if(!alerts.length){closeModal();openMode=null;return 0}
    modal(startup?'התראות בפתיחת המערכת':'מרכז אזהרות',modalBody(alerts,{startup}),'<button class="btn primary" type="button" data-action="close-modal">הבנתי</button>');
    return alerts.length;
  }

  function openAlertCenter({startup=false}={}){
    openMode=startup?'startup':'manual';
    return renderOpenAlertCenter();
  }

  function markAlertCheckDeposited(checkId){
    const item=currentAlerts().find(row=>row.kind==='check_due'&&row.checkId===String(checkId||''));
    if(!item)return false;
    if(markCheckDeposited(item.checkId)!==true)return false;
    renderOpenAlertCenter();
    return true;
  }

  async function dismissBankAlert(alertId){
    const item=currentAlerts().find(row=>row.id===String(alertId||'')&&(row.kind==='bank_returned_cheque'||row.kind==='bank_missing'));
    if(!item)return false;
    const ok=await dismissBankWarning(item);
    if(ok===true)renderOpenAlertCenter();
    return ok===true;
  }

  function openAlertTarget(alertId){
    const item=currentAlerts().find(row=>row.id===String(alertId||''));
    if(!item)return false;
    closeModal();
    if(item.kind==='check_due'){navigateToChecks(item.checkId,item.account);return true}
    if(item.kind==='cashflow'){navigateToCashflow(item.account);return true}
    if(item.kind==='bank_returned_cheque'||item.kind==='bank_missing'){navigateToBank(item.account);return true}
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

  return {currentAlerts,refreshIndicator,openAlertCenter,markAlertCheckDeposited,dismissBankAlert,openAlertTarget,showStartupAlerts};
}
