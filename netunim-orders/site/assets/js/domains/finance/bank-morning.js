import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';

function clean(value,max=250){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function amountCents(value){const number=Number(value);return Number.isFinite(number)?Math.round(number*100):NaN}
function dateOnly(value){const text=String(value||'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;const date=new Date(text);if(!Number.isFinite(date.getTime()))return'';const shift=date.getTimezoneOffset()*60_000;return new Date(date.getTime()-shift).toISOString().slice(0,10)}
function normalizeParty(value){return clean(value,180).toLocaleLowerCase('he').replace(/["'׳״`]/g,'').replace(/[-–—_/.,()[\]{}:;]+/g,' ').replace(/\s+/g,' ').trim()}
function partyWords(value){return normalizeParty(value).split(' ').filter(word=>word.length>=2)}
function transactionParty(row){return clean(row?.partyName,160)||clean(row?.partyHeadline,160)||clean(row?.messageHeadline,160)}
function transactionReference(row){return clean(row?.bankReference,80)||clean(row?.bankSerial,80)}
function transactionDescription(row){
  const description=clean(row?.description,250),memo=clean(row?.memo,500),parts=[];
  const push=value=>{const text=clean(value,250);if(!text)return;const joined=parts.join(' · ').toLocaleLowerCase('he');if(joined.includes(text.toLocaleLowerCase('he')))return;parts.push(text)};
  push(description);push(memo);
  for(const value of [row?.partyHeadline,row?.partyName,row?.messageHeadline,row?.messageDetail])push(value);
  return clean(parts.join(' · '),250)||transactionParty(row)||'תקבול בהעברה בנקאית';
}
function aggregateTransaction(row){
  const settlement=row?.creditSettlementDetails;if(settlement&&typeof settlement==='object'&&Object.keys(settlement).length)return true;
  const checks=row?.checkDetails;if(!checks||typeof checks!=='object')return false;const count=Number(checks.checkCount),items=Array.isArray(checks.checkItems)?checks.checkItems.length:0;return count>1||items>1;
}

export function bankMorningEligibility(row,role='business'){
  const archiveId=Number(row?.archiveId),amount=Number(row?.amount),currency=String(row?.currency||'ILS').trim().toUpperCase(),status=String(row?.status||'').trim().toLowerCase();
  if(role!=='business')return {eligible:false,code:'home-account',reason:'הפקת מסמך זמינה רק בתנועות החשבון העסקי'};
  if(!Number.isSafeInteger(archiveId)||archiveId<=0)return {eligible:false,code:'not-archived',reason:'התנועה עדיין לא קיבלה מזהה ארכיון יציב בענן'};
  if(!Number.isFinite(amount)||amount<=0)return {eligible:false,code:'not-credit',reason:'ניתן להפיק מסמך רק מתנועת זכות שהתקבלה'};
  if(status==='pending')return {eligible:false,code:'pending',reason:'התנועה עדיין ממתינה לקליטה סופית בבנק'};
  if(currency!=='ILS')return {eligible:false,code:'currency',reason:'הפקת Morning מהבנק נתמכת כרגע בתנועות שקליות בלבד'};
  return {eligible:true,code:'ok',reason:'',aggregate:aggregateTransaction(row)};
}

export function bankMorningPrefill(row){
  const amount=amountCents(row?.amount)/100;if(!Number.isFinite(amount)||amount<=0)throw new Error('bank_morning_invalid_amount');
  const customerName=transactionParty(row),date=dateOnly(row?.processedDate||row?.date),reference=transactionReference(row),description=transactionDescription(row);
  if(!date)throw new Error('bank_morning_invalid_date');
  return {
    customerName,amount,date,description,orderNumber:'',email:'',phone:'',taxId:'',remarks:'',
    payment:{type:4,date,price:amount,currency:'ILS',transactionId:reference,locked:true,source:'bank'},
    source:{kind:'bank',bankTransactionId:Number(row.archiveId),bankAmount:amount,currency:'ILS',aggregate:aggregateTransaction(row),partyName:customerName,reference},
  };
}

export function bankMorningDebtCandidates(row,debts=[]){
  const party=transactionParty(row),normalized=normalizeParty(party),words=new Set(partyWords(party)),amount=amountCents(row?.amount),candidates=[];
  if(!normalized)return candidates;
  for(const debt of Array.isArray(debts)?debts:[]){
    const debtName=clean(debt?.customerName,160),candidate=normalizeParty(debtName);if(!candidate)continue;
    const progress=customerDebtProgressData(debt||{});if(progress.paymentComplete&&progress.invoiceComplete)continue;
    let score=0,reason='';
    if(candidate===normalized){score=100;reason='שם מלא תואם'}
    else if(Math.min(candidate.length,normalized.length)>=4&&(candidate.includes(normalized)||normalized.includes(candidate))){score=78;reason='שם חלקי תואם'}
    else{
      const candidateWords=new Set(partyWords(debtName)),intersection=[...words].filter(word=>candidateWords.has(word)).length,denominator=Math.max(words.size,candidateWords.size,1),ratio=intersection/denominator;
      if(intersection&&ratio>=0.5){score=Math.round(55+ratio*15);reason='מילים משותפות בשם'}
    }
    if(!score)continue;
    const paymentRemaining=Number(progress.remainingPaymentMagnitude)||0,invoiceRemaining=Number(progress.remainingInvoiceMagnitude)||0;
    if(Number.isSafeInteger(amount)&&amount>0&&paymentRemaining>0&&amountCents(paymentRemaining)===amount){score+=8;reason+=reason?' · יתרת התשלום תואמת':'יתרת התשלום תואמת'}
    candidates.push({debtId:String(debt?.id||''),customerName:debtName,amount:Number(debt?.amount)||0,remainingPayment:paymentRemaining,remainingInvoice:invoiceRemaining,orderNumber:clean(debt?.orderNumber,80),score,reason});
  }
  return candidates.filter(row=>row.debtId).sort((a,b)=>b.score-a.score||a.customerName.localeCompare(b.customerName,'he')).slice(0,12);
}

export function attachBankArchiveMetadata(directRows=[],archiveRows=[]){
  const byKey=new Map();for(const row of Array.isArray(archiveRows)?archiveRows:[]){const key=String(row?.id||row?.mergeKey||'').trim();if(key)byKey.set(key,row)}
  return (Array.isArray(directRows)?directRows:[]).map(row=>{const key=String(row?.mergeKey||row?.id||'').trim(),archive=byKey.get(key);if(!archive)return row;return {...row,archiveId:archive.archiveId,handledAt:archive.handledAt||null,documentLinks:Array.isArray(archive.documentLinks)?archive.documentLinks:[]}})
}

export const normalizeBankMorningParty=normalizeParty;
