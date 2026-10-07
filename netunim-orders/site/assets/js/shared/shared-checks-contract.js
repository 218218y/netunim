import {assertEntityCollection} from './data-invariants.js';

// Shared Checks are whole-shekel JSON records. Keep non-finite historical
// values at zero, matching both check editors and Kupa's existing reader.
function wholeCheckAmount(value){
  const number=Number(value);
  return Math.round(Number.isFinite(number)?number:0);
}

export function checkAccountData(check){
  return check?.account==='ביתי'?'ביתי':'עסקי';
}

export function checkBelongsToAccountData(check,account='עסקי'){
  return checkAccountData(check)===(account==='ביתי'?'ביתי':'עסקי');
}

const CLOSED_CHECK_STATUSES=new Set(['נפרע','חזר','בוטל']);
export function checkIsClosedStatus(status){
  return CLOSED_CHECK_STATUSES.has(String(status||''));
}

export function normalizeSharedBankEvents(events){
  return (Array.isArray(events)?events:[]).map(event=>{
    const seq=Number(event?.seq);
    return {
      seq:Number.isSafeInteger(seq)&&seq>0?seq:null,
      at:event?.at||null,
      delta:wholeCheckAmount(event?.delta),
      kind:String(event?.kind||'check_effect_delta'),
      checkId:String(event?.checkId||''),
    };
  }).filter(event=>event.seq&&event.checkId);
}

export function normalizeSharedChecks(checks){
  const source=Array.isArray(checks)?checks:[];
  assertEntityCollection(source,'checks');
  return source.map(check=>{
    const seq=Number(check.depositSeq);
    return {
      ...check,
      id:String(check.id),
      name:String(check.name||''),
      account:checkAccountData(check),
      amount:wholeCheckAmount(check.amount),
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
