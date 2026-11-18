import {moneyWithCents as money} from '../../core/money.js';
import {dateFmt, todayISO} from '../../core/dates.js';
import {creditDetailItemIdentity} from './model.js';
import {esc} from '../../core/values.js';
import {CREDIT_PROVIDER_LABELS} from './sync-feed.js';
import {creditDiagnosticKey,creditDiagnosticMarkup,financeSyncProgressMeta,filterCurrentSyncEvents,syncEventCurrent} from '../../shared/sync-status.js';

function syncDate(value){if(!value)return 'עדיין לא סונכרן';try{return new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))}catch{return String(value)}}
function creditErrorRows(syncUi,summary){
  const statusErrors=Array.isArray(syncUi?.status?.lastErrors)?syncUi.status.lastErrors:[],localErrors=[...filterCurrentSyncEvents(statusErrors,summary?.sync?.syncedAt),...statusErrors.filter(error=>error?.severity==='deferred'||error?.deferred===true)];
  const rows=[...localErrors,...(Array.isArray(summary?.sync?.errors)?summary.sync.errors:[])],seen=new Set(),out=[];
  for(const row of rows){const key=creditDiagnosticKey(row);if(seen.has(key))continue;seen.add(key);out.push(row)}
  return out.sort((a,b)=>(Date.parse(b?.at||'')||0)-(Date.parse(a?.at||'')||0));
}
export function creditSyncHeadlineState(syncUi,summary){
  const errors=creditErrorRows(syncUi,summary),latestError=errors[0]||null,lastSync=summary?.sync?.syncedAt||null;
  const errorAt=syncUi?.errorAt||latestError?.at||null,lastSyncTime=Date.parse(lastSync||'')||0,errorTime=Date.parse(errorAt||'')||0;
  if(syncUi?.busy)return {tone:'busy',icon:'↻',title:'מסנכרן',meta:financeSyncProgressMeta('credit',syncUi.progress)};
  if(syncUi?.error&&syncEventCurrent(syncUi.errorAt,lastSync))return {tone:'error',icon:'!',title:'נכשל',meta:errorAt?syncDate(errorAt):'כעת'};
  if(syncUi?.publicationWarning)return {tone:'warn',icon:'!',title:'נשמר בענן',meta:'השמירה הנלווית בבדיקה'};
  if(syncUi?.preferenceWarning)return {tone:'warn',icon:'⏸',title:'עדכון אוטומטי הושהה',meta:'העדפות המחשב דורשות טיפול'};
  const hard=errors.find(error=>error?.severity==='error'),warnings=errors.filter(error=>error?.severity==='warning'),deferred=errors.find(error=>error?.severity==='deferred'||error?.deferred===true);
  if(hard){const partial=lastSyncTime&&(!errorTime||lastSyncTime>=errorTime-5000);return {tone:partial?'warn':'error',icon:'!',title:partial?'הושלם עם אזהרות':'נכשל',meta:(partial?lastSync:errorAt)?syncDate(partial?lastSync:errorAt):'זמן לא זמין'};}
  if(deferred)return {tone:'warn',icon:'⏸',title:'מושהה',meta:deferred.retryAfterAt?`עד ${syncDate(deferred.retryAfterAt)}`:'עקב חסימה קודמת'};
  if(warnings.length)return {tone:'warn',icon:'!',title:'הושלם עם אזהרות',meta:lastSync?syncDate(lastSync):'ללא הצלחת Core קודמת'};
  if(lastSync)return {tone:'ok',icon:'✓',title:'הצליח',meta:syncDate(lastSync)};
  return {tone:'idle',icon:'•',title:'טרם סונכרן',meta:'מוכן להגדרה'};
}
export function creditSyncHeadlineMarkup(state){return `<span class="credit-sync-state-icon" aria-hidden="true">${esc(state.icon)}</span><span class="credit-sync-state-copy"><b>${esc(state.title)}</b><small data-sync-progress-meta role="status">${esc(state.meta)}</small></span>`}
export function creditSyncDiagnosticsMarkup(syncUi,summary){
  const errors=creditErrorRows(syncUi,summary),rows=[];
  if(syncUi?.preferenceWarning)rows.push(`<div class="credit-sync-detail warn"><b>העדפות העדכון האוטומטי לא אושרו</b><span>${esc(syncUi.preferenceWarning)}</span><small>קוד: ${esc(syncUi.preferenceWarningCode)}</small></div>`);
  const currentLocalError=syncUi?.error&&syncEventCurrent(syncUi.errorAt,summary?.sync?.syncedAt)?syncUi.error:'',localCovered=currentLocalError&&errors.some(error=>String(currentLocalError).includes(String(error?.message||''))&&String(error?.message||'').length>0);
  if(currentLocalError&&!localCovered)rows.push(`<div class="credit-sync-detail error"><b>הסנכרון האחרון נכשל</b><span>${esc(currentLocalError)}</span>${syncUi.errorAt?`<small>${esc(syncDate(syncUi.errorAt))}</small>`:''}</div>`);
  if(syncUi?.publicationWarning)rows.push(`<div class="credit-sync-detail warn"><b>נתוני האשראי נשמרו בענן</b><span>${esc(syncUi.publicationWarning)}</span>${syncUi.publicationWarningCode?`<small>קוד: ${esc(syncUi.publicationWarningCode)}</small>`:''}<button type="button" class="btn small" data-action="retry-credit-publication" ${syncUi.busy?'disabled':''}>בדוק וטען מהענן ללא סריקה</button></div>`);
  if(syncUi?.bridgeError)rows.push(`<div class="credit-sync-detail warn"><b>Bank Bridge המקומי אינו זמין כרגע</b><span>${esc(syncUi.bridgeError)}</span><small>זו בדיקת זמינות במחשב הזה; היא אינה מבטלת תוצאה חדשה יותר שכבר נשמרה בענן.</small></div>`);
  if(summary?.hasCoverageGaps)rows.push(`<div class="credit-sync-detail warn"><b>כיסוי חודשי חלקי</b><span>${esc(summary.staleMonthCount)} חודשים מוצגים מ־Last Known Good ו־${esc(summary.missingMonthCount)} חודשים ללא נתון.</span><small>נתון ישן אינו מסומן כרענן, וחודש חסר אינו מושלם באמצעות תחזית מומצאת.</small></div>`);
  rows.push(creditDiagnosticMarkup(errors,{esc,syncDate,providerLabels:CREDIT_PROVIDER_LABELS,variant:'kupa'}));
  if(Number(syncUi?.status?.lastAttemptedCount)===0&&Number(syncUi?.status?.lastDeferredCount)>0)rows.push(`<div class="credit-sync-detail warn"><b>לא בוצע ניסיון חדש</b><span>${esc(syncUi.status.lastDeferredCount)} חיבורים דולגו בגלל cooldown פעיל.</span></div>`);
  return rows.join('');
}

export function createCreditMonthlyDetailRowMarkup({showBulk, bulkSelected, bulkCell}) {
  const bulkPlaceholder = showBulk ? '<td class="bulk-check-col"></td>' : '';
  return function creditMonthlyDetailRow(item,{cardBoundary=false}={}){
    const boundaryClass=cardBoundary?' credit-card-boundary':'';
    if(item.source==='manual')return manualMonthlyCreditRow(item,boundaryClass,bulkSelected,bulkCell);
    if(item.source==='credit_pending')return pendingMonthlyCreditRow(item,boundaryClass,bulkPlaceholder);
    if(item.source==='credit_foreign')return foreignMonthlyCreditRow(item,boundaryClass,bulkPlaceholder);
    if(item.source==='credit_unknown')return unknownMonthlyCreditRow(item,boundaryClass,bulkPlaceholder);
    return syncedMonthlyCreditRow(item,boundaryClass,bulkPlaceholder)
  };
}

function chargeStatus(date,bankSettlementState=''){
  const today=todayISO();
  if(date<today)return bankSettlementState==='settled'?{label:'נפרע בבנק',cls:'blue'}:bankSettlementState==='awaiting'?{label:'טרם אומת',cls:'orange'}:{label:'מועד עבר',cls:'blue'};
  if(date===today)return {label:'היום',cls:'green'};
  return {label:'עתידי',cls:'green'}
}
function transactionDateCell(value,time=''){
  if(!value)return '<span class="muted">לא נמסר</span>';
  const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(time||''))?String(time):'';
  return `<span class="credit-transaction-date-value">${dateFmt(String(value).slice(0,10))}</span>${clock?`<small class="credit-transaction-time" dir="ltr">${esc(clock)}</small>`:''}`
}
function installmentCell(item){
  return Number(item.totalParts)>1?`<b>תשלום ${esc(item.part)}/${esc(item.totalParts)}</b>`:'<span class="muted">תשלום אחד</span>'
}
function billingDateEstimateMarkup(item){
  if(['authoritative','manual'].includes(String(item.billingDateConfidence||'')))return '';
  const labels={
    known_billing_cycle:'מועד חיוב שהושלם ממחזור ידוע',
    issuer_next_charge_day:'משוער לפי יום החיוב הבא מהחברה',
    inferred_billing_day:'משוער לפי יום החיוב ההיסטורי',
    bank_settlement_next_known_cycle:'הועבר למחזור הידוע הבא לאחר פירעון בבנק',
    unassigned_after_bank_settlement:'המחזור הקודם נפרע בבנק · אין מועד אמין למחזור הבא',
    unassigned:'מחזור לא ודאי · אין מועד חיוב מספיק'
  };
  return `<small class="credit-pending-estimate">${esc(labels[item.chargeDateSource]||'מועד חיוב משוער')}</small>`
}
function statementCycleMarkup(item){
  if(!item?.detailCycleBillingDate)return '';
  const nominal=Number(item.detailCycleNominalDay),cycle=Number.isInteger(nominal)&&nominal>0?`${nominal} בחודש`:dateFmt(item.detailCycleBillingDate);
  return `<small class="credit-pending-estimate">חיוב מיידי בפועל · משויך למחזור ${esc(cycle)}</small>`
}
function creditCardDetailCell(item,sourceLabel){
  const meta=[item.account,item.ownerLabel,sourceLabel].filter(Boolean).join(' · ');
  return `<td class="credit-detail-card" title="${esc(item.card)}"><b>${esc(item.card)}</b><small>${esc(meta)}</small></td>`;
}
function creditDescriptionCell(item){
  const fx=item.foreignCurrency===true?'<span class="credit-transaction-fx">מט״ח</span>':'',
  missing=item.amountStatus==='unknown_amount'?`<span class="credit-transaction-pending">${item.coverageIncomplete?'כיסוי חסר':'סכום חסר'}</span>`:'',
  coverage=item.coverageIncomplete&&item.amountStatus!=='unknown_amount'?'<span class="credit-transaction-pending">LKG/כיסוי חלקי</span>':'';
  return (`<td class="credit-detail-description" title="${esc(item.description||'')}"><div class="credit-detail-description-line"><span>${esc(item.description)||'—'}</span>` +
  `${fx}${missing}${coverage}</div></td>`);
}
function syncedMonthlyCreditRow(item,boundaryClass,bulkPlaceholder){
  const series=item.series||{},
  status=item.date?chargeStatus(item.date,item.bankSettlementState):{label:'מחזור לא ודאי',cls:'orange'},
  partial=!item.date||(series.partial&&item.date>=todayISO())||item.coverageIncomplete,
  chargeDate=item.date?dateFmt(item.date):'לא נקבע',
  chargeAmount=item.amountSource==='issuer_not_billed'?
  '<div class="muted credit-month-charge-amount">לא נכלל בחיוב לפי כאל</div>':
  item.includedInIlsTotal?`<div class="amount credit-month-charge-amount">${money(item.amount)}</div>`:'<div class="muted credit-month-charge-amount">לא נכלל בסה״כ ₪</div>';
  return (`<tr class="credit-synced-detail-row${boundaryClass}" data-credit-search-id="${esc(creditDetailItemIdentity(item))}">${bulkPlaceholder}${creditCardDetailCell(item,CREDIT_PROVIDER_LABELS[item.provider]||'מסונכרן')}` +
  `${creditDescriptionCell(item)}<td class="credit-detail-transaction-date">${transactionDateCell(item.transactionDate,item.transactionTime)}</td><td class="amount credit-detail-total">` +
  `${money(series.totalAmount)}</td><td class="credit-detail-installment">${installmentCell(item)}</td><td class="credit-detail-charge"><b>${esc(chargeDate)}</b>` +
  `${chargeAmount}${statementCycleMarkup(item)}${billingDateEstimateMarkup(item)}</td><td class="credit-detail-status"><span class="badge ${esc(status.cls)}">` +
  `${esc(status.label)}</span>${partial?`<div class="muted credit-detail-partial">${!item.date?'אין מועד חיוב אמין':item.coverageIncomplete?'כיסוי חברה חלקי':'אופק חלקי'}</div>`:''}</td></tr>`);
}
function pendingAmountMarkup(item){
  if(item.foreignCurrency&&Number.isFinite(Number(item.originalAmount))&&item.originalCurrency){
  const formatted=new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(Number(item.originalAmount));
  return `${formatted} ${esc(item.originalCurrency)}`
}
  const amount=Number(item.transactionAmount);if(!Number.isFinite(amount))return '<span class="muted">לא נמסר</span>';
  if(item.pending?.isShekel)return money(amount);
  const formatted=new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(amount);return `${formatted} ${esc(item.displayCurrency||'')}`;
}
function pendingMonthlyCreditRow(item,boundaryClass,bulkPlaceholder){
  const estimates={
  issuer_next_charge:'משוער לפי מועד החיוב הבא',
  known_future_cycle:'משוער לפי מחזור עתידי ידוע',
  inferred_billing_day:'משוער לפי יום החיוב ההיסטורי',
  bank_settlement_next_known_cycle:'הועבר למחזור הידוע הבא לאחר פירעון בבנק',
  unassigned_after_bank_settlement:'המחזור הקודם נפרע בבנק · אין מועד אמין למחזור הבא',
  unassigned:'מחזור לא ודאי · אין מועד חיוב מספיק'
},
  estimate=estimates[item.chargeDateSource]||'שיוך זמני עד אישור סופי',
  stale=item.pendingFresh===false,
  chargeDate=item.date?dateFmt(item.date):'לא נקבע';
  return (`<tr class="credit-synced-detail-row credit-pending-detail-row${stale?' stale':''}${boundaryClass}" data-credit-search-id="${esc(creditDetailItemIdentity(item))}">${bulkPlaceholder}` +
  `${creditCardDetailCell(item,CREDIT_PROVIDER_LABELS[item.provider]||'מסונכרן')}${creditDescriptionCell(item)}<td class="credit-detail-transaction-date">` +
  `${transactionDateCell(item.transactionDate,item.transactionTime)}</td><td class="amount credit-detail-total">${pendingAmountMarkup(item)}</td><td class="credit-detail-installment"><span class="muted">אישור</span></td><td class="credit-detail-charge"><b>` +
  `${esc(chargeDate)}</b>${item.includedInIlsTotal?`<div class="amount credit-month-charge-amount">${money(item.amount)}</div>`:'<div class="muted credit-month-charge-amount">לא נכלל בסה״כ ₪</div>'}<small class="credit-pending-estimate">` +
  `${esc(estimate)}</small></td><td class="credit-detail-status"><span class="credit-transaction-pending">ממתינה</span>${stale?'<div class="muted credit-detail-partial">נתון קודם</div>':''}</td></tr>`);
}
function foreignMonthlyCreditRow(item,boundaryClass,bulkPlaceholder){
  const status=item.date?chargeStatus(item.date,item.bankSettlementState):{label:'מחזור לא ודאי',cls:'orange'},
  formatted=new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(Number(item.displayAmount)||0),
  display=`${formatted} ${esc(item.displayCurrency||item.originalCurrency||'')}`,
  chargeDate=item.date?dateFmt(item.date):'לא נקבע';
  return (`<tr class="credit-synced-detail-row credit-foreign-detail-row${boundaryClass}" data-credit-search-id="${esc(creditDetailItemIdentity(item))}">${bulkPlaceholder}` +
  `${creditCardDetailCell(item,CREDIT_PROVIDER_LABELS[item.provider]||'מסונכרן')}${creditDescriptionCell(item)}<td class="credit-detail-transaction-date">` +
  `${transactionDateCell(item.transactionDate,item.transactionTime)}</td><td class="amount credit-detail-total">${display}</td><td class="credit-detail-installment">` +
  `${installmentCell(item)}</td><td class="credit-detail-charge"><b>${esc(chargeDate)}</b><div class="muted credit-month-charge-amount">לא נכלל בסה״כ ₪</div>` +
  `${statementCycleMarkup(item)}${billingDateEstimateMarkup(item)}</td><td class="credit-detail-status"><span class="badge ${esc(status.cls)}">${esc(status.label)}</span></td></tr>`);
}
function unknownMonthlyCreditRow(item,boundaryClass,bulkPlaceholder){
  const status=item.date?chargeStatus(item.date,item.bankSettlementState):{label:'מחזור לא ודאי',cls:'orange'},chargeDate=item.date?dateFmt(item.date):'לא נקבע';
  return (`<tr class="credit-synced-detail-row credit-pending-detail-row${boundaryClass}" data-credit-search-id="${esc(creditDetailItemIdentity(item))}">${bulkPlaceholder}` +
  `${creditCardDetailCell(item,CREDIT_PROVIDER_LABELS[item.provider]||'מסונכרן')}${creditDescriptionCell(item)}<td class="credit-detail-transaction-date">` +
  `${transactionDateCell(item.transactionDate,item.transactionTime)}</td><td class="amount credit-detail-total">${item.originalAmount===null?'—':item.foreignCurrency?`${new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(item.originalAmount)} ${esc(item.originalCurrency)}`:money(item.originalAmount)}</td><td class="credit-detail-installment">` +
  `${installmentCell(item)}</td><td class="credit-detail-charge"><b>${esc(chargeDate)}</b><div class="muted credit-month-charge-amount">${item.coverageIncomplete?'נתוני החברה לחודש אינם מלאים':'הסכום השקלי טרם נמסר'}</div>` +
  `${statementCycleMarkup(item)}${billingDateEstimateMarkup(item)}</td><td class="credit-detail-status"><span class="badge ${esc(status.cls)}">${esc(status.label)}</span>` +
  `${item.coverageIncomplete?'<div class="muted credit-detail-partial">כיסוי LKG/חסר</div>':''}</td></tr>`);
}
function manualMonthlyCreditRow(item,boundaryClass,bulkSelected,bulkCell){
  const record=item.record,status=chargeStatus(item.date,item.bankSettlementState);
  return (`<tr data-bulk-collection="credits" data-bulk-id="${esc(record.id)}" data-credit-search-id="${esc(creditDetailItemIdentity(item))}" class="${esc(bulkSelected.has(record.id)?'bulk-selected-row':'')}${boundaryClass}">` +
  `${bulkCell('credits',record.id)}${creditCardDetailCell(item,'תוספת ידנית')}${creditDescriptionCell(item)}<td class="credit-detail-transaction-date">${transactionDateCell(item.transactionDate)}</td><td class="amount credit-detail-total">` +
  `${money(record.totalAmount)}</td><td class="credit-detail-installment">${installmentCell(item)}</td><td class="credit-detail-charge"><b>${dateFmt(item.date)}</b><div class="amount credit-month-charge-amount">` +
  `${money(item.amount)}</div></td><td class="credit-detail-status"><span class="badge ${esc(status.cls)}">${esc(status.label)}</span><button class="iconbtn credit-detail-edit" data-action="open-credit-modal-2" data-click-arg0="` +
  `${esc(record.id)}">עריכה</button></td></tr>`);
}
