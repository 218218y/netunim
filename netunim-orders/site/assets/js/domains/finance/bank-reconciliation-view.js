import {esc} from '../../core/values.js';
import {bankSmartHistoryRows} from '../../shared/bank-transaction-order.js';

export function bankMissingActive(row){return row?.presenceState==='missing'&&!row?.missingAcknowledgedAt}

function presenceTime(value){if(!value)return '—';const d=new Date(value);return Number.isFinite(d.getTime())?`${d.toLocaleDateString('he-IL')} · ${d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}`:'—'}

export function bankDataMode(ui){return ui?.bankDataView==='direct'?'direct':'history'}

export function bankSmartRows(rows,directRows=[]){return bankSmartHistoryRows(rows,{directTransactions:directRows,isMissingActive:bankMissingActive})}

export function bankDataViewToggleMarkup(mode){const direct=mode==='direct',current=direct?'עדכני מהבנק':'היסטוריה חכמה',next=direct?'history':'direct',nextLabel=direct?'היסטוריה חכמה':'עדכני מהבנק',shortLabel=direct?'מהבנק':'חכם',icon=direct?'↻':'✦';return `<button type="button" class="bank-data-view-toggle ${direct?'direct':'history'}" data-action="set-orders-bank-data-view" data-click-arg0="${next}" aria-label="תצוגה נוכחית: ${current}. לחץ למעבר אל ${nextLabel}" title="${current} · לחץ למעבר אל ${nextLabel}"><span class="bank-data-view-toggle-icon" aria-hidden="true">${icon}</span><span>${shortLabel}</span><span class="bank-data-view-toggle-swap" aria-hidden="true">⇄</span></button>`}

export function bankDirectSnapshotNote(snapshot){if(!snapshot)return `<div class="bank-direct-snapshot-note empty-state"><b>עדיין אין צילום תנועות מלא ומאומת מהבנק.</b><span>צילום ישיר יישמר רק לאחר קריאת תנועות מלאה ללא אזהרה; קריאה חלקית לעולם לא תחליף אותו.</span></div>`;return `<div class="bank-direct-snapshot-note"><span><b>נתוני הבנק הישירים האחרונים</b> · ${esc(presenceTime(snapshot.snapshotAt))}</span><small>כיסוי ${esc(snapshot.coverageFrom)} עד ${esc(snapshot.coverageTo)} · ${esc(snapshot.transactionCount)} תנועות. סנכרון חלקי אינו מחליף צילום זה.</small></div>`}

export function bankMissingSummary(rows){const active=(Array.isArray(rows)?rows:[]).filter(bankMissingActive),cheques=active.filter(row=>row.cheque);if(!active.length)return '';return `<div class="bank-missing-summary"><span class="bank-missing-summary-icon" aria-hidden="true">!</span><div><b>${esc(active.length)} תנועות אינן מופיעות בסריקת הבנק המלאה האחרונה${cheques.length?` · מתוכן ${esc(cheques.length)} הפקדות צ׳קים`:''}</b><small>הן הועלו לראש הרשימה. ההתראה נשארת גם אחרי סנכרונים נוספים, עד שהתנועה חוזרת לבנק או עד סימון ידני „נבדק”.</small></div></div>`}

export function bankMissingDetail(row){if(!bankMissingActive(row))return '';const title=row.cheque?'הפקדת צ׳ק לא מופיעה בסריקת הבנק האחרונה':'התנועה לא מופיעה בסריקת הבנק האחרונה';return `<div class="bank-missing-detail"><div><b>${esc(title)}</b><small>נראתה לאחרונה: ${esc(presenceTime(row.lastSeenAt))} · חסרה מאז: ${esc(presenceTime(row.missingSince))}</small></div>${row.archiveId?`<button type="button" class="btn bank-missing-ack" data-action="ack-orders-bank-missing" data-click-arg0="${esc(row.archiveId)}">נבדק — הסר התראה</button>`:''}</div>`}
