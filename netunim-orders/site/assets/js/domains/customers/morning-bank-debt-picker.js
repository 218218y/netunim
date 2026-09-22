import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';
import {customerDebtStatus} from './model.js';
import {bankMorningDebtCandidates} from '../finance/bank-morning.js';

function cleanText(value,max=250){return String(value??'').trim().slice(0,max)}
function debtSearchText(debt){return [debt?.customerName,debt?.orderNumber,debt?.phone,debt?.note].map(value=>cleanText(value,180).toLocaleLowerCase('he').replace(/\s+/g,' ')).filter(Boolean).join(' ')}
function displayRemaining(progress){return progress.paymentComplete?progress.remainingInvoiceMagnitude:progress.remainingPaymentMagnitude}

export function activeMorningBankDebts(rows=[]){
  return (Array.isArray(rows)?rows:[]).filter(row=>{
    if(!String(row?.id||'')||Number(row?.amount)<=0)return false;
    const progress=customerDebtProgressData(row);return !(progress.paymentComplete&&progress.invoiceComplete);
  });
}

function pickerRow(debt,activeDebtId){
  const progress=customerDebtProgressData(debt),status=customerDebtStatus(debt,progress),selected=String(debt.id)===String(activeDebtId),remaining=displayRemaining(progress);
  return `<button type="button" class="morning-bank-debt-row ${selected?'selected':''}" data-bank-debt-row data-bank-debt-row-id="${esc(debt.id)}" data-bank-debt-search="${esc(debtSearchText(debt))}" data-bank-debt-choice data-bank-debt-id="${esc(debt.id)}" data-action="morning-bank-debt-select" data-click-arg0="${esc(debt.id)}" aria-pressed="${selected?'true':'false'}" ${selected?'disabled':''}>
    <span class="morning-bank-debt-cell morning-bank-debt-customer" data-label="לקוח"><b>${esc(debt.customerName||'לקוח')}</b>${debt.phone?`<small>${esc(debt.phone)}</small>`:''}</span>
    <span class="morning-bank-debt-cell money" data-label="יתרה"><b>${money(remaining)}</b><small>מתוך ${money(progress.targetMagnitude)}</small></span>
    <span class="morning-bank-debt-cell" data-label="הזמנה">${esc(debt.orderNumber||'—')}</span>
    <span class="morning-bank-debt-cell" data-label="מצב"><span class="badge ${esc(status.cls)}">${esc(status.text)}</span></span>
  </button>`;
}

function preferredCard(candidate,debt,activeDebtId){
  if(!candidate||!debt)return'';
  const progress=customerDebtProgressData(debt),status=customerDebtStatus(debt,progress),selected=String(debt.id)===String(activeDebtId),remaining=displayRemaining(progress);
  return `<button type="button" class="morning-bank-debt-preferred ${selected?'selected':''}" data-bank-debt-card-id="${esc(debt.id)}" data-bank-debt-choice data-bank-debt-id="${esc(debt.id)}" data-action="morning-bank-debt-select" data-click-arg0="${esc(debt.id)}" aria-pressed="${selected?'true':'false'}" ${selected?'disabled':''}>
    <small>התאמה מועדפת</small><b>${esc(debt.customerName||'לקוח')}</b><span>${esc(candidate.reason||'התאמה לפי שם')} · יתרה ${money(remaining)}${debt.orderNumber?` · הזמנה ${esc(debt.orderNumber)}`:''}</span><span class="badge ${esc(status.cls)}">${esc(status.text)}</span>
  </button>`;
}

export function morningBankDebtPickerMarkup({debts=[],transaction=null,activeDebtId='',aggregate=false}={}){
  const active=activeMorningBankDebts(debts),candidates=bankMorningDebtCandidates(transaction||{},active),preferred=candidates[0]||null,preferredDebt=preferred?active.find(row=>String(row.id)===String(preferred.debtId)):null,list=preferredDebt?active.filter(row=>String(row.id)!==String(preferredDebt.id)):active,current=active.find(row=>String(row.id)===String(activeDebtId));
  return `<div class="morning-form-card morning-bank-debt-link"><div class="morning-section-title"><span>קישור לחוב לקוח <small>(רשות)</small></span><small>הקישור מתבצע רק לאחר בחירה מפורשת שלך</small></div>
    ${aggregate?'<div class="morning-source-warning">התנועה נראית כריכוז תקבולים. יש לוודא במיוחד שהחוב הנבחר שייך למסמך הזה.</div>':''}
    ${preferredCard(preferred,preferredDebt,activeDebtId)}
    <div class="morning-bank-debt-search-shell">
      <div class="morning-bank-debt-toolbar"><input id="morningBankDebtSearch" type="search" autocomplete="off" placeholder="חפש לקוח, הזמנה, טלפון או הערה…" aria-controls="morningBankDebtResults" data-input="morning-bank-debt-search"><button type="button" class="btn small morning-bank-debt-clear" data-action="morning-bank-debt-clear" ${activeDebtId?'':'hidden'}>בטל קישור</button></div>
      <div class="morning-bank-debt-results" id="morningBankDebtResults">
        <div class="morning-bank-debt-table-wrap"><div class="morning-bank-debt-table" aria-label="חובות פעילים"><div class="morning-bank-debt-table-head" aria-hidden="true"><span>לקוח</span><span>יתרה</span><span>הזמנה</span><span>מצב</span></div><div class="morning-bank-debt-table-body">${list.map(row=>pickerRow(row,activeDebtId)).join('')}</div></div><div id="morningBankDebtEmpty" class="morning-bank-debt-empty" ${list.length?'hidden':''}>אין חובות פעילים המתאימים לחיפוש.</div></div>
        <small id="morningBankDebtCount" class="morning-bank-match-note">${list.length?`מציג ${list.length} חובות פעילים${preferredDebt?' נוספים':''}`:'אין חובות פעילים נוספים להצגה'}${preferredDebt?' · ההתאמה המועדפת מוצגת בנפרד למעלה':''}</small>
      </div>
    </div>
    <div class="morning-bank-debt-selection" id="morningBankDebtSelectionStatus">${activeDebtId?`מקושר כעת לחוב של ${esc(current?.customerName||'הלקוח שנבחר')}`:'לא נבחר חוב. הפקת המסמך לא תשנה חוב מקומי עד שתבחר חוב.'}</div>
  </div>`;
}

export function filterMorningBankDebtPicker(query='',root=globalThis.document){
  if(!root)return 0;const needle=cleanText(query,180).toLocaleLowerCase('he').replace(/\s+/g,' '),rows=[...root.querySelectorAll('[data-bank-debt-row]')];let visible=0;
  for(const row of rows){const match=!needle||String(row.dataset.bankDebtSearch||'').includes(needle);row.hidden=!match;if(match)visible++}
  const empty=root.getElementById?.('morningBankDebtEmpty'),count=root.getElementById?.('morningBankDebtCount');if(empty)empty.hidden=visible>0;if(count)count.textContent=visible?`מציג ${visible} חובות פעילים המתאימים לחיפוש${root.querySelector('[data-bank-debt-card-id]')?' · ההתאמה המועדפת מוצגת בנפרד למעלה':''}`:'אין חובות פעילים המתאימים לחיפוש';return visible;
}

export function collapseMorningBankDebtPicker(root=globalThis.document){
  const shell=root?.querySelector?.('.morning-bank-debt-search-shell'),focused=root?.activeElement;if(shell&&focused instanceof HTMLElement&&shell.contains(focused))focused.blur();
}

export function syncMorningBankDebtPickerSelection({activeDebtId='',debt=null,root=globalThis.document}={}){
  if(!root)return;const id=String(activeDebtId||'');
  root.querySelectorAll('[data-bank-debt-choice]').forEach(button=>{const selected=!!id&&String(button.dataset.bankDebtId)===id;button.disabled=selected;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',selected?'true':'false')});
  root.querySelectorAll('[data-bank-debt-row-id]').forEach(row=>row.classList.toggle('selected',!!id&&String(row.dataset.bankDebtRowId)===id));root.querySelectorAll('[data-bank-debt-card-id]').forEach(card=>card.classList.toggle('selected',!!id&&String(card.dataset.bankDebtCardId)===id));
  const clear=root.querySelector('.morning-bank-debt-clear'),status=root.getElementById?.('morningBankDebtSelectionStatus');if(clear)clear.hidden=!id;if(status)status.textContent=id?`מקושר כעת לחוב של ${debt?.customerName||'הלקוח שנבחר'}`:'לא נבחר חוב. הפקת המסמך לא תשנה חוב מקומי עד שתבחר חוב.';
}
