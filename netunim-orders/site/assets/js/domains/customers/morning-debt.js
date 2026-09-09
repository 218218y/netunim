import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';

const CENTS=100;
const MORNING_EFFECTS=Object.freeze({
  305:Object.freeze({payment:false,invoice:true}),
  320:Object.freeze({payment:true,invoice:true}),
  400:Object.freeze({payment:true,invoice:false}),
});

function finiteNumber(value){const number=Number(value);return Number.isFinite(number)?number:0}
function cents(value){return Math.round(finiteNumber(value)*CENTS)}
function amount(value){return Math.round(Number(value||0))/CENTS}
function supportedType(type){return MORNING_EFFECTS[Number(type)]||null}
function validOperationId(value){return String(value||'').trim()}

export function morningDebtProgressEntryId(operationId,kind){
  const operation=validOperationId(operationId);if(!operation||!['payment','invoice'].includes(kind))return'';
  return `MORNING:${operation}:${kind}`;
}

export function morningDebtImpact(debt,type,documentAmount,{applyPayment=true,applyInvoice=true}={}){
  const effect=supportedType(type),documentCents=Math.max(0,cents(documentAmount)),progress=customerDebtProgressData(debt||{}),targetCents=Math.abs(cents(progress.amount)),eligible=!!effect&&documentCents>0&&cents(progress.amount)>0;
  const paymentSelected=!!effect?.payment&&applyPayment!==false,invoiceSelected=!!effect?.invoice&&applyInvoice!==false;
  const paymentRemainingCents=Math.max(0,cents(progress.remainingPaymentMagnitude)),invoiceRemainingCents=Math.max(0,cents(progress.remainingInvoiceMagnitude));
  const paymentApplyCents=eligible&&paymentSelected?Math.min(documentCents,paymentRemainingCents):0,invoiceApplyCents=eligible&&invoiceSelected?Math.min(documentCents,invoiceRemainingCents):0;
  return {
    supported:!!effect,
    eligible,
    type:Number(type),
    documentAmount:amount(documentCents),
    debtAmount:progress.amount,
    targetMagnitude:amount(targetCents),
    relation:documentCents<targetCents?'partial':documentCents>targetCents?'over':'full',
    paymentSupported:!!effect?.payment,
    invoiceSupported:!!effect?.invoice,
    paymentAffected:paymentSelected,
    invoiceAffected:invoiceSelected,
    paymentBefore:progress.paymentApplied,
    invoiceBefore:progress.invoiceApplied,
    paymentRemainingBefore:progress.remainingPaymentMagnitude,
    invoiceRemainingBefore:progress.remainingInvoiceMagnitude,
    paymentApply:amount(paymentApplyCents),
    invoiceApply:amount(invoiceApplyCents),
    paymentRemainingAfter:amount(Math.max(0,paymentRemainingCents-paymentApplyCents)),
    invoiceRemainingAfter:amount(Math.max(0,invoiceRemainingCents-invoiceApplyCents)),
    paymentCompleteBefore:progress.paymentComplete,
    invoiceCompleteBefore:progress.invoiceComplete,
    paymentCompleteAfter:progress.paymentComplete||(paymentSelected&&paymentRemainingCents>0&&paymentApplyCents>=paymentRemainingCents),
    invoiceCompleteAfter:progress.invoiceComplete||(invoiceSelected&&invoiceRemainingCents>0&&invoiceApplyCents>=invoiceRemainingCents),
    paymentUnapplied:amount(paymentSelected?Math.max(0,documentCents-paymentApplyCents):0),
    invoiceUnapplied:amount(invoiceSelected?Math.max(0,documentCents-invoiceApplyCents):0),
  };
}

export function applyVerifiedMorningDocumentToDebt(debt,{operationId,type,amount:documentAmount,verifiedAt,applyPayment=true,applyInvoice=true}={}){
  const operation=validOperationId(operationId),impact=morningDebtImpact(debt,type,documentAmount,{applyPayment,applyInvoice});
  if(!debt||typeof debt!=='object'||!operation||!impact.supported||!impact.eligible)return {changed:false,impact,reason:!operation?'invalid-operation':!impact.supported?'unsupported-type':'ineligible-debt'};
  if(!impact.paymentAffected&&!impact.invoiceAffected)return {changed:false,impact,reason:'skipped-by-policy'};
  const now=typeof verifiedAt==='string'&&Number.isFinite(Date.parse(verifiedAt))?verifiedAt:new Date().toISOString(),entries=Array.isArray(debt.debtProgress)?debt.debtProgress:[],existingIds=new Set(entries.map(row=>String(row?.id||'')));
  let changed=false,alreadyApplied=false;
  const append=(kind,entryAmount,affected)=>{
    if(!affected)return;
    const id=morningDebtProgressEntryId(operation,kind);if(id&&existingIds.has(id)){alreadyApplied=true;return}
    if(!(entryAmount>0))return;
    if(!id)return;
    entries.push({id,kind,action:'add',amount:Math.round(entryAmount*100)/100,source:'morning',createdAt:now});existingIds.add(id);changed=true;
  };
  append('payment',impact.paymentApply,impact.paymentAffected);append('invoice',impact.invoiceApply,impact.invoiceAffected);
  if(!changed)return {changed:false,impact,reason:alreadyApplied?'already-applied':'no-balance'};
  debt.debtProgress=entries;
  const after=customerDebtProgressData(debt),beforePaymentComplete=impact.paymentCompleteBefore,beforeInvoiceComplete=impact.invoiceCompleteBefore,beforeClosed=beforePaymentComplete&&beforeInvoiceComplete;
  debt.paidAt=after.paymentComplete?(beforePaymentComplete?(debt.paidAt||now):now):null;
  debt.invoiceIssuedAt=after.invoiceComplete?(beforeInvoiceComplete?(debt.invoiceIssuedAt||now):now):null;
  debt.closedAt=after.paymentComplete&&after.invoiceComplete?(beforeClosed?(debt.closedAt||now):now):null;
  debt.updatedAt=now;
  return {changed:true,impact:morningDebtImpact(debt,type,documentAmount,{applyPayment,applyInvoice}),beforeImpact:impact};
}
