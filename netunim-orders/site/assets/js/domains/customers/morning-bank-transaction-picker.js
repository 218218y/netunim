import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {bankMorningEligibility} from '../finance/bank-morning.js';

const MAX_RESULTS=80;
const RECENT_DAYS=45;
function clean(value,max=260){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function bankDate(value){const text=String(value||'').slice(0,10),match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?`${match[3]}/${match[2]}/${match[1].slice(2)}`:text||'—'}
function searchText(row){return [bankDate(row?.processedDate||row?.date),row?.description,row?.memo,row?.partyName,row?.partyHeadline,row?.messageHeadline,row?.messageDetail,row?.bankReference,row?.bankSerial,Number.isFinite(Number(row?.amount))?Number(row.amount).toFixed(2):''].map(value=>clean(value,260).toLocaleLowerCase('he')).filter(Boolean).join(' ')}
function label(row){const party=clean(row?.partyName||row?.partyHeadline,90),description=clean(row?.description,110)||'תנועת זכות',date=bankDate(row?.processedDate||row?.date);return `${party?party+' · ':''}${description} · ${date} · ${money(Number(row?.amount)||0)}`}
function links(row){return Array.isArray(row?.documentLinks)?row.documentLinks:[]}

function localDateKey(value){const d=value instanceof Date?value:new Date(value);if(!Number.isFinite(d.getTime()))return'';const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function recentCutoffDate(today=new Date(),days=RECENT_DAYS){
  const now=today instanceof Date?today:new Date(today),safe=Number.isFinite(now.getTime())?now:new Date(),cutoff=new Date(safe.getFullYear(),safe.getMonth(),safe.getDate()-days);
  return localDateKey(cutoff);
}
function transactionDateKey(row){return String(row?.processedDate||row?.date||'').slice(0,10)}

export function morningLinkableBankTransactions(rows=[],{today=new Date(),days=RECENT_DAYS}={}){
  const cutoff=recentCutoffDate(today,days);
  return (Array.isArray(rows)?rows:[]).filter(row=>bankMorningEligibility(row,'business').eligible&&transactionDateKey(row)>=cutoff).sort((a,b)=>String(b?.processedDate||b?.date||'').localeCompare(String(a?.processedDate||a?.date||''))||Number(b?.archiveId||0)-Number(a?.archiveId||0));
}

function rowMarkup(row,activeTransactionId){
  const id=Number(row?.archiveId),selected=id===Number(activeTransactionId),existing=links(row),alreadyLinked=existing.length>0,detail=clean(row?.memo,180),reference=clean(row?.bankReference,80),title=alreadyLinked?'לתנועה זו כבר מקושר מסמך Morning מאומת. כדי למנוע כפילות היא אינה ניתנת לבחירה מהמסלול ההפוך; אפשר לצפות במסמך מתצוגת הבנק.':'בחר תנועת בנק זו';
  return `<button type="button" class="morning-bank-transaction-row ${selected?'selected':''} ${alreadyLinked?'already-linked':''}" data-bank-transaction-row data-bank-transaction-id="${esc(id)}" data-bank-transaction-search="${esc(searchText(row))}" data-action="morning-bank-transaction-select" data-click-arg0="${esc(id)}" aria-pressed="${selected?'true':'false'}" title="${esc(title)}" ${alreadyLinked&&!selected?'disabled':''}>
    <span class="morning-bank-transaction-cell" data-label="תאריך"><b>${esc(bankDate(row?.processedDate||row?.date))}</b></span>
    <span class="morning-bank-transaction-cell morning-bank-transaction-description" data-label="פעולה"><b>${esc(row?.description||'תנועת זכות')}</b>${detail?`<small>${esc(detail)}</small>`:''}${row?.partyName?`<small>${esc(row.partyName)}</small>`:''}</span>
    <span class="morning-bank-transaction-cell" data-label="אסמכתא">${esc(reference||'—')}</span>
    <span class="morning-bank-transaction-cell money" data-label="זכות"><b>${money(Number(row?.amount)||0)}</b></span>
    <span class="morning-bank-transaction-cell" data-label="מצב">${alreadyLinked?`<span class="badge green">מסמך ${esc(existing[0]?.documentNumber||'מקושר')}</span>`:'<span class="badge blue">זמין</span>'}</span>
  </button>`;
}

export function morningBankTransactionPickerMarkup({activeTransaction=null,loading=false}={}){
  const selected=activeTransaction&&Number(activeTransaction.archiveId)>0?activeTransaction:null;
  return `<div class="morning-form-card morning-bank-transaction-link"><div class="morning-section-title"><span>קישור לתנועת בנק <small>(רשות)</small></span><small>מוצגות תנועות זכות עסקיות סופיות מ־45 הימים האחרונים שמתאימות להפקת קבלה</small></div>
    <div class="morning-bank-transaction-selected" id="morningBankTransactionSelected" ${selected?'':'hidden'}>${selected?`<b>תנועה שנבחרה:</b> ${esc(label(selected))}`:''}</div>
    <div class="morning-bank-transaction-search-shell">
      <div class="morning-bank-transaction-toolbar"><input id="morningBankTransactionSearch" type="search" autocomplete="off" data-focus="select-input" placeholder="חפש לפי לקוח, פעולה, אסמכתא, תאריך או סכום…" data-input="morning-bank-transaction-search"><button type="button" class="btn small morning-bank-transaction-clear" data-action="morning-bank-transaction-clear" ${selected?'':'hidden'}>בטל קישור</button></div>
      <div class="morning-bank-transaction-results" id="morningBankTransactionResults"><div class="morning-bank-transaction-table-wrap"><div class="morning-bank-transaction-table" aria-label="תנועות זכות עסקיות"><div class="morning-bank-transaction-table-head" aria-hidden="true"><span>תאריך</span><span>פעולה</span><span>אסמכתא</span><span>זכות</span><span>מצב</span></div><div id="morningBankTransactionRows" class="morning-bank-transaction-table-body"></div></div><div id="morningBankTransactionEmpty" class="morning-bank-transaction-empty">${loading?'טוען תנועות בנק…':'אין תנועות מתאימות להצגה.'}</div></div><small id="morningBankTransactionCount" class="morning-bank-match-note"></small></div>
    </div>
  </div>`;
}

export function renderMorningBankTransactionPicker({rows=[],query='',activeTransactionId=null,root=globalThis.document}={}){
  if(!root)return 0;const all=morningLinkableBankTransactions(rows),needle=clean(query,180).toLocaleLowerCase('he'),filtered=needle?all.filter(row=>searchText(row).includes(needle)):all,shown=filtered.slice(0,MAX_RESULTS),host=root.getElementById?.('morningBankTransactionRows'),empty=root.getElementById?.('morningBankTransactionEmpty'),count=root.getElementById?.('morningBankTransactionCount');
  if(host)host.innerHTML=shown.map(row=>rowMarkup(row,activeTransactionId)).join('');if(empty){empty.hidden=shown.length>0;empty.textContent=all.length?'אין תנועות שמתאימות לחיפוש.':'אין תנועות זכות מתאימות מ־45 הימים האחרונים.'}if(count)count.textContent=filtered.length>shown.length?`מציג ${shown.length} מתוך ${filtered.length} תנועות · צמצם את החיפוש כדי להגיע לתנועה הרצויה`:filtered.length?`מציג ${filtered.length} תנועות מתאימות`:'';return filtered.length;
}

export function syncMorningBankTransactionSelection({transaction=null,root=globalThis.document}={}){
  if(!root)return;const id=Number(transaction?.archiveId)||0,input=root.getElementById?.('morningBankTransactionSearch'),selected=root.getElementById?.('morningBankTransactionSelected'),clear=root.querySelector?.('.morning-bank-transaction-clear');
  if(input){input.value=transaction?label(transaction):'';input.dataset.selectedBankTransactionId=id?String(id):''}
  if(selected){selected.hidden=!transaction;selected.innerHTML=transaction?`<b>תנועה שנבחרה:</b> ${esc(label(transaction))}`:''}
  if(clear)clear.hidden=!transaction;
  root.querySelectorAll?.('[data-bank-transaction-row]').forEach(row=>{const active=id>0&&Number(row.dataset.bankTransactionId)===id;row.classList.toggle('selected',active);row.setAttribute('aria-pressed',active?'true':'false')});
}

export function morningBankTransactionLabel(row){return label(row)}
