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
