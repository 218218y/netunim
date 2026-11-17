export const SYNC_EVENT_SKEW_MS=5000;

/** @param {string|null|undefined} value */
function eventTime(value){const time=value?Date.parse(value):NaN;return Number.isFinite(time)?time:0}

/** @param {string|null|undefined} eventAt @param {string|null|undefined} successfulAt */
export function syncEventSuperseded(eventAt,successfulAt,toleranceMs=SYNC_EVENT_SKEW_MS){
  const success=eventTime(successfulAt);if(!success)return false;
  const event=eventTime(eventAt);if(!event)return true;
  return event<success-Math.max(0,Number(toleranceMs)||0);
}

/** @param {string|null|undefined} eventAt @param {string|null|undefined} successfulAt */
export function syncEventCurrent(eventAt,successfulAt,toleranceMs=SYNC_EVENT_SKEW_MS){return !syncEventSuperseded(eventAt,successfulAt,toleranceMs)}

/** @template {{at?:string|null}} T @param {T[]|null|undefined} events @param {string|null|undefined} successfulAt */
export function filterCurrentSyncEvents(events,successfulAt,toleranceMs=SYNC_EVENT_SKEW_MS){return (Array.isArray(events)?events:[]).filter(event=>syncEventCurrent(event?.at,successfulAt,toleranceMs))}

/** @typedef {'prepare'|'provider'|'process'|'save'} FinanceSyncPhase */
/** @typedef {(phase:FinanceSyncPhase,detail?:unknown)=>void} FinanceSyncProgress */
/** @typedef {'bank'|'credit'} FinanceSyncKind */
/** @typedef {{phase:FinanceSyncPhase,detail?:unknown}|null|undefined} ProgressState */

/** @type {Array<[FinanceSyncPhase,string]>} */
const phases=[
  ['prepare','הכנת הסנכרון'],
  ['provider',''],
  ['process','בדיקת הנתונים'],
  ['save','שמירת העדכון'],
];
const bankDetails=new Map([
  ['browser','מכין את הדפדפן המקומי'],
  ['session','בודק את החיבור לבנק ומתחבר לפי הצורך'],
  ['business','קורא יתרה ותנועות בחשבון העסקי'],
  ['home','קורא יתרה ותנועות בחשבון הביתי'],
]);

/** @param {FinanceSyncKind} kind @param {FinanceSyncPhase} phase @param {string} label */
function phaseLabel(kind,phase,label){
  if(phase==='provider')return kind==='bank'?'קריאה מהבנק':'קריאה מחברות האשראי';
  if(phase==='process'&&kind==='bank')return 'בדיקת תנועות והכנת השמירה';
  return label;
}

/** @param {FinanceSyncKind} kind @param {unknown} detail */
function providerDetail(kind,detail){
  const waiting='ממתין לתשובה מ־Bank Bridge';
  if(!detail||typeof detail!=='object')return waiting;
  const {stage,index,total}=/** @type {Record<string,unknown>} */(detail);
  if(stage==='finalizing')return 'מסיים את הקריאה ב־Bank Bridge';
  if(kind==='bank')return (typeof stage==='string'&&bankDetails.get(stage))||waiting;
  if((stage==='profile'||stage==='deferred')&&typeof index==='number'&&typeof total==='number'&&Number.isSafeInteger(index)&&Number.isSafeInteger(total)&&index>0&&index<=total)
    return stage==='deferred'
      ? `חיבור ${index} מתוך ${total} · מושהה`
      : `בודק חיבור אשראי ${index} מתוך ${total}`;
  return waiting;
}

/** @param {FinanceSyncKind} kind @param {ProgressState} progress */
export function financeSyncProgressMeta(kind,progress){
  const index=phases.findIndex(([phase])=>phase===progress?.phase);
  const current=phases[index];
  if(!current)return 'כעת';
  const [phase,label]=current;
  return `שלב ${index+1} מתוך ${phases.length} · ${phaseLabel(kind,phase,label)}`;
}

/** @param {FinanceSyncKind} kind @param {ProgressState} progress */
function progressSteps(kind,progress){
  const current=phases.findIndex(([phase])=>phase===progress?.phase);
  if(current<0)return '';
  const items=phases.map(([phase,label],index)=>{
    const state=index===current?' aria-current="step"':index<current?' class="done"':'';
    const detail=index===current&&phase==='provider'?providerDetail(kind,progress?.detail):'';
    return `<li${state}>${phaseLabel(kind,phase,label)}${detail?`<small>${detail}</small>`:''}</li>`;
  });
  return `<ol aria-label="שלבי הסנכרון">${items.join('')}</ol>`;
}

/** @param {FinanceSyncKind} kind @param {ProgressState} progress */
export function financeSyncProgressMarkup(kind,progress){
  return `<div class="finance-sync-progress">${progressSteps(kind,progress)}</div>`;
}

/** @param {FinanceSyncKind} kind @param {string} panelId @param {ProgressState} progress */
export function updateFinanceSyncProgress(kind,panelId,progress){
  if(typeof document==='undefined')return;
  const panel=document.getElementById(panelId);
  if(!panel)return;
  const meta=document.querySelector(`[aria-controls="${panelId}"] [data-sync-progress-meta]`);
  const text=financeSyncProgressMeta(kind,progress);
  if(meta&&meta.textContent!==text)meta.textContent=text;
  const steps=panel.querySelector('.finance-sync-progress');
  if(steps)steps.innerHTML=progressSteps(kind,progress);
}

// Presentation only: retain the original issues and their financial coverage state.
/**
 * @typedef {Object} CreditDiagnosticIssue
 * @property {string} [profileId]
 * @property {string} [provider]
 * @property {string} [code]
 * @property {string} [component]
 * @property {string|null} [tier]
 * @property {string} [severity]
 * @property {string} [month]
 * @property {string} [accountSuffix]
 * @property {string} [stage]
 * @property {string} [message]
 * @property {string|null} [at]
 * @property {string} [diagnosticFingerprint]
 * @property {string} [label]
 * @property {number} [httpStatus]
 * @property {string} [browserEngine]
 * @property {string|null} [retryAfterAt]
 * @property {string|null} [originalFailureAt]
 */
/** @typedef {(value:string|null|undefined)=>string} DiagnosticDateLabel */
/** @param {CreditDiagnosticIssue} [error] */
export function creditDiagnosticKey(error={}){
  /** @type {(keyof CreditDiagnosticIssue)[]} */
  const keys=['profileId','provider','code','component','tier','severity','month','accountSuffix','stage','message','at','diagnosticFingerprint'];
  return JSON.stringify(keys.map(key=>String(error?.[key]||'')));
}

/** @param {CreditDiagnosticIssue|null|undefined} error @returns {error is CreditDiagnosticIssue & {month:string}} */
function partialMaxForecast(error){
  return error?.provider==='max'&&error.code==='CREDIT_PROVIDER_SCHEMA_ERROR'&&error.severity==='warning'&&
    error.component==='forecast_transactions'&&[undefined,null,'','forecast'].includes(error.tier)&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(error.month||''));
}

/** @param {CreditDiagnosticIssue} error @param {DiagnosticDateLabel} syncDate */
function diagnosticMeta(error,syncDate){
  return [error?.code?`קוד: ${error.code}`:'',error?.component?`רכיב: ${error.component}`:'',
    error?.stage?`שלב: ${error.stage}`:'',error?.month?`חודש: ${error.month}`:'',
    error?.accountSuffix?`כרטיס: ••${error.accountSuffix}`:'',error?.httpStatus?`HTTP: ${error.httpStatus}`:'',
    error?.browserEngine?`דפדפן: ${error.browserEngine==='chromium'?'Chrome/Edge':'Camoufox'}`:'',
    error?.retryAfterAt?`מושהה עד: ${syncDate(error.retryAfterAt)}`:'',
    error?.diagnosticFingerprint?`אבחון: ${error.diagnosticFingerprint}`:'',
    error?.originalFailureAt?`הכשל המקורי: ${syncDate(error.originalFailureAt)}`:error?.at?syncDate(error.at):''].filter(Boolean).join(' · ');
}

/** @param {(CreditDiagnosticIssue & {month:string})[]} errors */
function monthSummary(errors){
  const months=[...new Set(errors.map(error=>error.month))].sort();
  /** @param {string|undefined} month */
  const ordinal=month=>month?Number(month.slice(0,4))*12+Number(month.slice(5)):NaN;
  const contiguous=months.every((month,index)=>!index||ordinal(month)===ordinal(months[index-1])+1);
  return months.length>1&&contiguous?`${months[0]}–${months.at(-1)} (${months.length} חודשים)`:months.join(' · ');
}

/** @param {CreditDiagnosticIssue[]|null|undefined} errors @param {{esc:(value:unknown)=>string,syncDate:DiagnosticDateLabel,providerLabels:Record<string,string>,variant:'kupa'|'orders'}} options */
export function creditDiagnosticMarkup(errors,{esc,syncDate,providerLabels,variant}){
  const rows=Array.isArray(errors)?errors:[],forecast=rows.filter(partialMaxForecast);
  const detailClass=variant==='orders'?'finance-sync-detail':'credit-sync-detail';
  /** @param {CreditDiagnosticIssue} error */
  const label=error=>error?.label||providerLabels[error?.provider||'']||error?.provider||'חברת אשראי';
  /** @param {CreditDiagnosticIssue} error */
  const meta=error=>{const value=diagnosticMeta(error,syncDate);return value?`<small>${esc(value)}</small>`:''};
  let grouped=false;
  return rows.map(error=>{
    if(partialMaxForecast(error)){
      if(grouped)return '';grouped=true;
      const evidence=forecast.map(row=>`<div class="${detailClass} warn"><b>${esc(label(row))}</b>${meta(row)}</div>`).join('');
      const count=forecast.length===1?'הודעה אחת':`${forecast.length} הודעות`;
      return `<div class="${detailClass} warn"><b>תחזית MAX חלקית</b><span>לא התקבל פירוט שניתן לאמת לחלק מחודשי התחזית. מידע קודם, אם קיים, נשמר; החודשים החסרים אינם מאומתים כחודשים ריקים.</span><small>חודשים: <bdi dir="ltr">${esc(monthSummary(forecast))}</bdi></small><details class="credit-forecast-evidence"><summary>פרטי אבחון · ${count}</summary>${evidence}</details></div>`;
    }
    const severity=['warning','deferred','info'].includes(error?.severity||'')?'warn':'error';
    return `<div class="${detailClass} ${severity}"><b>${esc(error?.severity==='deferred'?'מושהה — '+label(error):label(error))}</b><span>${esc(error?.message||'סנכרון האשראי נכשל')}</span>${meta(error)}</div>`;
  }).join('');
}
