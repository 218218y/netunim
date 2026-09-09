import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';

const STORAGE_KEY='orders.morning.pending-issuance.v1';
const TYPES=new Set([305,320,400]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value,max=160){return String(value??'').trim().slice(0,max)}
function moneyCents(value){const number=Number(value);return Number.isFinite(number)?Math.round(number*100):NaN}
function validDateTime(value){const text=clean(value,40);return text&&Number.isFinite(Date.parse(text))?text:''}

export function normalizeMorningFinancialSnapshot(value){
  if(!value||typeof value!=='object')return null;
  const out={};
  for(const key of ['amount','paymentApplied','invoiceApplied']){if(typeof value[key]!=='number'||!Number.isSafeInteger(moneyCents(value[key])))return null;out[key]=moneyCents(value[key])/100}
  for(const key of ['paymentComplete','invoiceComplete']){if(typeof value[key]!=='boolean')return null;out[key]=value[key]}
  if(out.paymentApplied<0||out.invoiceApplied<0)return null;
  return out;
}

export function morningFinancialSnapshot(debt,operationId=''){
  if(!debt)return null;
  // Only this operation's stable IDs are excluded, never equal amounts or manual events.
  // A persisted Morning event may be replayed after a crash before Recovery cleanup.
  const progress=customerDebtProgressData(operationId?{...debt,debtProgress:(debt.debtProgress||[]).filter(row=>!['payment','invoice'].some(kind=>row.id===`MORNING:${operationId}:${kind}`))}:debt);
  return normalizeMorningFinancialSnapshot(progress);
}

export function morningFinancialChanges(before,current){
  const a=normalizeMorningFinancialSnapshot(before),b=normalizeMorningFinancialSnapshot(current);
  const amount=!a||!b||a.amount!==b.amount;
  const payment=amount||a.paymentApplied!==b.paymentApplied||a.paymentComplete!==b.paymentComplete;
  const invoice=amount||a.invoiceApplied!==b.invoiceApplied||a.invoiceComplete!==b.invoiceComplete;
  return {amount,payment,invoice,changed:payment||invoice};
}

export function createMorningDebtRecoveryContext({operationId,debtId='',type,amount,applyPayment=false,applyInvoice=false,createdAt=new Date().toISOString(),financialSnapshot,resolution}={}){
  const operation=clean(operationId,80),debt=clean(debtId,160),documentType=Number(type),amountCents=moneyCents(amount),time=validDateTime(createdAt);
  if(!UUID.test(operation))throw new Error('morning_recovery_invalid_operation');
  if(!TYPES.has(documentType))throw new Error('morning_recovery_invalid_type');
  if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error('morning_recovery_invalid_amount');
  if(!time)throw new Error('morning_recovery_invalid_time');
  const record={version:1,operationId:operation,debtId:debt,type:documentType,amount:amountCents/100,applyPayment:applyPayment===true,applyInvoice:applyInvoice===true,createdAt:time};
  const snapshot=normalizeMorningFinancialSnapshot(financialSnapshot);if(snapshot)record.financialSnapshot=snapshot;
  const reviewed=normalizeMorningFinancialSnapshot(resolution?.financialSnapshot);
  if(reviewed&&typeof resolution.applyPayment==='boolean'&&typeof resolution.applyInvoice==='boolean')record.resolution={financialSnapshot:reviewed,applyPayment:documentType!==305&&resolution.applyPayment,applyInvoice:documentType!==400&&resolution.applyInvoice,confirmedAt:validDateTime(resolution.confirmedAt)};
  else if(resolution!==undefined)delete record.financialSnapshot; // Corrupt approval must require a new explicit decision.
  return record;
}

export function normalizeMorningDebtRecoveryContext(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Number(value.version)!==1)return null;
  try{return createMorningDebtRecoveryContext(value)}catch{return null}
}

export function loadMorningDebtRecoveryContext(storage=globalThis.localStorage){
  try{
    const raw=storage?.getItem?.(STORAGE_KEY);if(!raw)return null;
    const parsed=normalizeMorningDebtRecoveryContext(JSON.parse(raw));
    if(parsed)return parsed;
    storage?.removeItem?.(STORAGE_KEY);return null;
  }catch(error){console.error('Morning recovery context load',error);return null}
}

export function saveMorningDebtRecoveryContext(value,storage=globalThis.localStorage){
  const record=normalizeMorningDebtRecoveryContext(value);if(!record)return false;
  try{const text=JSON.stringify(record);storage?.setItem?.(STORAGE_KEY,text);if(storage?.getItem?.(STORAGE_KEY)!==text)throw new Error('Morning recovery context verification failed');return true}catch(error){console.error('Morning recovery context save',error);return false}
}

export function clearMorningDebtRecoveryContext(operationId='',storage=globalThis.localStorage){
  try{
    const expected=clean(operationId,80),current=loadMorningDebtRecoveryContext(storage);
    if(expected&&current&&current.operationId!==expected)return false;
    storage?.removeItem?.(STORAGE_KEY);return !storage?.getItem?.(STORAGE_KEY);
  }catch(error){console.error('Morning recovery context clear',error);return false}
}

export function morningDebtRecoveryMatchesVerified(context,{operationId,type,amount}={}){
  const record=normalizeMorningDebtRecoveryContext(context);if(!record)return false;
  return record.operationId===clean(operationId,80)&&record.type===Number(type)&&moneyCents(record.amount)===moneyCents(amount);
}

const DURABLE_NO_MUTATION_REASONS=new Set(['standalone','skipped-by-policy','no-balance','ineligible-debt']);
export function morningVerifiedApplicationDurable(result){
  if(!result||typeof result!=='object'||result.persisted===false)return false;
  if(result.changed===true||result.reason==='already-applied')return result.persisted===true;
  return result.changed===false&&DURABLE_NO_MUTATION_REASONS.has(String(result.reason||''));
}

export const MORNING_DEBT_RECOVERY_STORAGE_KEY=STORAGE_KEY;
