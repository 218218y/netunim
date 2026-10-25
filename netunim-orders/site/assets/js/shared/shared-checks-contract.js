import {assertEntityCollection} from './data-invariants.js';
/** @typedef {import('./shared-checks-model-contracts.js').SharedCheckCalculation} SharedCheckCalculation */
/** @param {unknown} value @param {string} key @returns {unknown} */
function field(value,key){return /** @type {Record<string,unknown>|null|undefined} */ (value)?.[key]}

// Preserve ILS cents in checks and in server-issued balance deltas.
/** @type {SharedCheckCalculation['checkAmount']} */
function checkAmount(value){
  const number=Number(value);
  return Math.round((Number.isFinite(number)?number:0)*100)/100;
}

/** @type {SharedCheckCalculation['checkAccountData']} */
export function checkAccountData(check){
  return field(check,'account')==='ביתי'?'ביתי':'עסקי';
}

/** @type {SharedCheckCalculation['checkBelongsToAccountData']} */
export function checkBelongsToAccountData(check,account='עסקי'){
  return checkAccountData(check)===(account==='ביתי'?'ביתי':'עסקי');
}

const CLOSED_CHECK_STATUSES=new Set(['נפרע','חזר','בוטל']);
/** @type {SharedCheckCalculation['checkIsClosedStatus']} */
export function checkIsClosedStatus(status){
  return CLOSED_CHECK_STATUSES.has(String(status||''));
}

/** @type {SharedCheckCalculation['normalizeSharedBankEvents']} */
export function normalizeSharedBankEvents(events){
  const source=/** @type {unknown[]} */ (Array.isArray(events)?events:[]);
  return source.map(/** @returns {import('./shared-checks-model-contracts.js').DraftBankEvent} */ event=>{
    const seq=Number(field(event,'seq'));
    return {
      seq:Number.isSafeInteger(seq)&&seq>0?seq:null,
      at:field(event,'at')||null,
      delta:checkAmount(field(event,'delta')),
      kind:String(field(event,'kind')||'check_effect_delta'),
      checkId:String(field(event,'checkId')||''),
    };
  }).filter(/** @param {import('./shared-checks-model-contracts.js').DraftBankEvent} event @returns {event is import('./shared-checks-model-contracts.js').BankEvent} */ event=>!!event.seq&&!!event.checkId);
}

/** @type {SharedCheckCalculation['normalizeSharedChecks']} */
export function normalizeSharedChecks(checks){
  const source=assertEntityCollection(Array.isArray(checks)?checks:[],'checks')||[];
  return source.map(check=>{
    const seq=Number(check.depositSeq);
    return {
      ...check,
      id:String(check.id),
      name:String(check.name||''),
      account:checkAccountData(check),
      amount:checkAmount(check.amount),
      dueDate:String(check.dueDate||''),
      status:String(check.status||'בקופה'),
      depositDate:check.depositDate||null,
      depositedAt:check.depositedAt||null,
      depositSeq:Number.isSafeInteger(seq)&&seq>0?seq:null,
      clearedDate:check.clearedDate||null,
      checkNumber:String(check.checkNumber||''),
      note:String(check.note||''),
      createdAt:check.createdAt||'',
    };
  });
}
