const CENTS=100;
/** @typedef {import('./customer-debt-contracts.js').DebtCalculation} DebtCalculation */
/** @type {ReadonlySet<unknown>} */
const PROGRESS_KINDS=new Set(['payment','invoice']);
/** @type {ReadonlySet<unknown>} */
const PROGRESS_ACTIONS=new Set(['add','reset']);
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value){return !!value&&typeof value==='object'&&!Array.isArray(value)}

/** @type {DebtCalculation['finiteNumber']} */
function finiteNumber(value){const n=Number(value);return Number.isFinite(n)?n:0}
/** @type {DebtCalculation['cents']} */
function cents(value){return Math.round(finiteNumber(value)*CENTS)}
/** @type {DebtCalculation['amountFromCents']} */
function amountFromCents(value){return Math.round(Number(value||0))/CENTS}

/** @type {DebtCalculation['customerDebtProgressEntries']} */
export function customerDebtProgressEntries(debt,kind=null){
  const rows=Array.isArray(debt?.debtProgress)?debt.debtProgress:[];
  return kind?rows.filter(row=>row?.kind===kind):rows.slice();
}

/** @type {DebtCalculation['progressAction']} */
function progressAction(row){return row?.action==='reset'?'reset':'add'}

/** @type {DebtCalculation['customerDebtActiveProgressEntries']} */
export function customerDebtActiveProgressEntries(debt,kind){
  const rows=customerDebtProgressEntries(debt,kind),cleared=new Set();
  for(const row of rows){if(progressAction(row)==='reset')for(const id of Array.isArray(row?.clears)?row.clears:[])cleared.add(String(id))}
  return rows.filter(row=>progressAction(row)==='add'&&!cleared.has(String(row?.id))&&cents(row?.amount)>0);
}

/** @type {DebtCalculation['progressNetCents']} */
function progressNetCents(debt,kind){return customerDebtActiveProgressEntries(debt,kind).reduce((sum,row)=>sum+cents(row?.amount),0)}

/** @type {DebtCalculation['domainProgress']} */
function domainProgress(targetCents,directComplete,recordedCents){
  const appliedCents=directComplete?targetCents:Math.min(recordedCents,targetCents);
  const complete=directComplete||(targetCents>0&&recordedCents>=targetCents);
  const partial=!complete&&appliedCents>0;
  return{
    recorded:amountFromCents(recordedCents),
    applied:amountFromCents(appliedCents),
    remainingMagnitude:amountFromCents(complete?0:Math.max(0,targetCents-appliedCents)),
    complete,
    partial,
  };
}

/** @type {DebtCalculation['customerDebtProgressData']} */
export function customerDebtProgressData(debt){
  const amount=amountFromCents(cents(debt?.amount)),targetCents=Math.abs(cents(amount)),sign=amount<0?-1:1;
  const payment=domainProgress(targetCents,debt?.paid===true,progressNetCents(debt,'payment'));
  const invoice=domainProgress(targetCents,debt?.invoiceIssued===true,progressNetCents(debt,'invoice'));
  return{
    amount,
    targetMagnitude:amountFromCents(targetCents),
    paymentRecorded:payment.recorded,
    paymentApplied:payment.applied,
    remainingPaymentMagnitude:payment.remainingMagnitude,
    remainingPayment:amountFromCents(cents(payment.remainingMagnitude*sign)),
    paymentComplete:payment.complete,
    paymentPartial:payment.partial,
    invoiceRecorded:invoice.recorded,
    invoiceApplied:invoice.applied,
    remainingInvoiceMagnitude:invoice.remainingMagnitude,
    remainingInvoice:amountFromCents(cents(invoice.remainingMagnitude*sign)),
    invoiceComplete:invoice.complete,
    invoicePartial:invoice.partial,
  };
}

/** @type {DebtCalculation['customerDebtProgressMode']} */
export function customerDebtProgressMode(progress,kind){
  if(kind==='payment')return progress?.paymentComplete?'true':progress?.paymentPartial?'partial':'false';
  if(kind==='invoice')return progress?.invoiceComplete?'true':progress?.invoicePartial?'partial':'false';
  return 'false';
}

/** @type {DebtCalculation['customerDebtHasPartialProgress']} */
export function customerDebtHasPartialProgress(debt){const p=customerDebtProgressData(debt);return p.paymentPartial||p.invoicePartial}

/** @template {Record<string,unknown>|null|undefined} Debt @param {Debt} debt @param {string} [path] @returns {Debt} */
export function validateCustomerDebtProgress(debt,path='customerDebts'){
  if(debt?.morningDocuments!==undefined){
    if(!Array.isArray(debt.morningDocuments))throw new Error(`${path}.morningDocuments must be an array`);
    const operations=new Set();
    for(const [index,link] of /** @type {unknown[]} */ (debt.morningDocuments).entries()){
      const field=`${path}.morningDocuments[${index}]`;
      if(!record(link))throw new Error(`${field} must be an object`);
      if(typeof link.operationId!=='string'||!link.operationId.trim()||operations.has(link.operationId))throw new Error(`${field} has invalid operationId`);
      operations.add(link.operationId);
      if(typeof link.documentId!=='string'||!link.documentId.trim())throw new Error(`${field} has invalid documentId`);
      if(typeof link.documentNumber!=='string'||!Number.isSafeInteger(link.documentType)||typeof link.verifiedAt!=='string')throw new Error(`${field} has invalid document metadata`);
    }
  }
  if(debt?.debtProgress===undefined)return debt;
  if(!Array.isArray(debt.debtProgress))throw new Error(`${path}.debtProgress must be an array`);
  const ids=new Set();
  for(const [index,row] of /** @type {unknown[]} */ (debt.debtProgress).entries()){
    if(!record(row))throw new Error(`${path}.debtProgress[${index}] must be an object`);
    const id=typeof row.id==='string'?row.id.trim():'';
    if(!id||id!==row.id||ids.has(id))throw new Error(`${path}.debtProgress[${index}] has invalid id`);ids.add(id);
    if(!PROGRESS_KINDS.has(row.kind))throw new Error(`${path}.debtProgress[${index}] has invalid kind`);
    const action=row.action===undefined?'add':row.action;if(!PROGRESS_ACTIONS.has(action))throw new Error(`${path}.debtProgress[${index}] has invalid action`);
    if(action==='add'){
      const value=Number(row.amount);if(!Number.isFinite(value)||value<0.005)throw new Error(`${path}.debtProgress[${index}] has invalid amount`);
      if(row.clears!==undefined)throw new Error(`${path}.debtProgress[${index}] add cannot clear entries`);
    }else{
      if(row.amount!==undefined)throw new Error(`${path}.debtProgress[${index}] reset cannot have amount`);
      if(!Array.isArray(row.clears)||!row.clears.length||row.clears.some((/** @type {unknown} */ value)=>typeof value!=='string'||!value.trim()))throw new Error(`${path}.debtProgress[${index}] has invalid reset targets`);
    }
    if(row.createdAt!==undefined&&typeof row.createdAt!=='string')throw new Error(`${path}.debtProgress[${index}] has invalid createdAt`);
    if(row.source!==undefined&&typeof row.source!=='string')throw new Error(`${path}.debtProgress[${index}] has invalid source`);
  }
  return debt;
}
