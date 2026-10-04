import {esc} from '../../core/values.js';
import {CREDIT_PROVIDER_LABELS} from './sync-feed.js';
import {filterCurrentSyncEvents,syncEventCurrent} from '../../shared/sync-status.js';

function syncDate(value){if(!value)return 'עדיין לא סונכרן';try{return new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))}catch{return String(value)}}
function creditErrorRows(syncUi,summary){
  const statusErrors=Array.isArray(syncUi?.status?.lastErrors)?syncUi.status.lastErrors:[],localErrors=[...filterCurrentSyncEvents(statusErrors,summary?.sync?.syncedAt),...statusErrors.filter(error=>error?.severity==='deferred'||error?.deferred===true)];
  const rows=[...localErrors,...(Array.isArray(summary?.sync?.errors)?summary.sync.errors:[])],seen=new Set(),out=[];
  for(const row of rows){const key=[row?.profileId,row?.provider,row?.code,row?.stage,row?.message,row?.at].map(x=>String(x||'')).join('|');if(seen.has(key))continue;seen.add(key);out.push(row)}
  return out.sort((a,b)=>(Date.parse(b?.at||'')||0)-(Date.parse(a?.at||'')||0));
}
export function creditSyncHeadlineState(syncUi,summary){
  const errors=creditErrorRows(syncUi,summary),latestError=errors[0]||null,lastSync=summary?.sync?.syncedAt||null;
  const errorAt=syncUi?.errorAt||latestError?.at||null,lastSyncTime=Date.parse(lastSync||'')||0,errorTime=Date.parse(errorAt||'')||0;
  if(syncUi?.busy)return {tone:'busy',icon:'↻',title:'מסנכרן',meta:'כעת'};
  if(syncUi?.error&&syncEventCurrent(syncUi.errorAt,lastSync))return {tone:'error',icon:'!',title:'נכשל',meta:errorAt?syncDate(errorAt):'כעת'};
  const hard=errors.find(error=>error?.severity==='error'),warnings=errors.filter(error=>error?.severity==='warning'),deferred=errors.find(error=>error?.severity==='deferred'||error?.deferred===true);
  if(hard){const partial=lastSyncTime&&(!errorTime||lastSyncTime>=errorTime-5000);return {tone:partial?'warn':'error',icon:'!',title:partial?'הושלם עם אזהרות':'נכשל',meta:(partial?lastSync:errorAt)?syncDate(partial?lastSync:errorAt):'זמן לא זמין'};}
  if(deferred)return {tone:'warn',icon:'⏸',title:'מושהה',meta:deferred.retryAfterAt?`עד ${syncDate(deferred.retryAfterAt)}`:'עקב חסימה קודמת'};
  if(warnings.length)return {tone:'warn',icon:'!',title:'הושלם עם אזהרות',meta:lastSync?syncDate(lastSync):'ללא הצלחת Core קודמת'};
  if(lastSync)return {tone:'ok',icon:'✓',title:'הצליח',meta:syncDate(lastSync)};
  return {tone:'idle',icon:'•',title:'טרם סונכרן',meta:'מוכן להגדרה'};
}
export function creditSyncHeadlineMarkup(state){return `<span class="credit-sync-state-icon" aria-hidden="true">${esc(state.icon)}</span><span class="credit-sync-state-copy"><b>${esc(state.title)}</b><small>${esc(state.meta)}</small></span>`}
export function creditSyncDiagnosticsMarkup(syncUi,summary){
  const errors=creditErrorRows(syncUi,summary),rows=[];
  const currentLocalError=syncUi?.error&&syncEventCurrent(syncUi.errorAt,summary?.sync?.syncedAt)?syncUi.error:'',localCovered=currentLocalError&&errors.some(error=>String(currentLocalError).includes(String(error?.message||''))&&String(error?.message||'').length>0);
  if(currentLocalError&&!localCovered)rows.push(`<div class="credit-sync-detail error"><b>הסנכרון האחרון נכשל</b><span>${esc(currentLocalError)}</span>${syncUi.errorAt?`<small>${esc(syncDate(syncUi.errorAt))}</small>`:''}</div>`);
  if(syncUi?.bridgeError)rows.push(`<div class="credit-sync-detail warn"><b>Bank Bridge המקומי אינו זמין כרגע</b><span>${esc(syncUi.bridgeError)}</span><small>זו בדיקת זמינות במחשב הזה; היא אינה מבטלת תוצאה חדשה יותר שכבר נשמרה בענן.</small></div>`);
  if(summary?.hasCoverageGaps)rows.push(`<div class="credit-sync-detail warn"><b>כיסוי חודשי חלקי</b><span>${esc(summary.staleMonthCount)} חודשים מוצגים מ־Last Known Good ו־${esc(summary.missingMonthCount)} חודשים ללא נתון.</span><small>נתון ישן אינו מסומן כרענן, וחודש חסר אינו מושלם באמצעות תחזית מומצאת.</small></div>`);
  for(const error of errors){const label=error?.label||CREDIT_PROVIDER_LABELS[error?.provider]||error?.provider||'חברת אשראי',severity=['warning','deferred','info'].includes(error?.severity)?'warn':'error',meta=[error?.code?`קוד: ${error.code}`:'',error?.component?`רכיב: ${error.component}`:'',error?.stage?`שלב: ${error.stage}`:'',error?.month?`חודש: ${error.month}`:'',error?.accountSuffix?`כרטיס: ••${error.accountSuffix}`:'',error?.httpStatus?`HTTP: ${error.httpStatus}`:'',error?.browserEngine?`דפדפן: ${error.browserEngine==='chromium'?'Chrome/Edge':'Camoufox'}`:'',error?.retryAfterAt?`מושהה עד: ${syncDate(error.retryAfterAt)}`:'',error?.diagnosticFingerprint?`אבחון: ${error.diagnosticFingerprint}`:'',error?.originalFailureAt?`הכשל המקורי: ${syncDate(error.originalFailureAt)}`:error?.at?syncDate(error.at):''].filter(Boolean).join(' · ');rows.push(`<div class="credit-sync-detail ${severity}"><b>${esc(error?.severity==='deferred'?'מושהה — '+label:label)}</b><span>${esc(error?.message||'סנכרון האשראי נכשל')}</span>${meta?`<small>${esc(meta)}</small>`:''}</div>`)}
  if(Number(syncUi?.status?.lastAttemptedCount)===0&&Number(syncUi?.status?.lastDeferredCount)>0)rows.push(`<div class="credit-sync-detail warn"><b>לא בוצע ניסיון חדש</b><span>${esc(syncUi.status.lastDeferredCount)} חיבורים דולגו בגלל cooldown פעיל.</span></div>`);
  return rows.join('');
}
