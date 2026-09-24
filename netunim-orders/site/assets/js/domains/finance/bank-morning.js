import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';
import {inferMorningBankFromText,morningBankCode,morningBankName,resolveMorningBank} from '../customers/morning-banks.js';

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
  const fallback=row?.checkDetails?.kind==='deposit'?'תקבול בצ׳ק':'תקבול בהעברה בנקאית';
  return clean(parts.join(' · '),250)||transactionParty(row)||fallback;
}
function aggregateTransaction(row){
  const settlement=row?.creditSettlementDetails;if(settlement&&typeof settlement==='object'&&Object.keys(settlement).length)return true;
  const checks=row?.checkDetails;if(!checks||typeof checks!=='object')return false;const count=Number(checks.checkCount),items=Array.isArray(checks.checkItems)?checks.checkItems.length:0;return count>1||items>1;
}
function checkItems(row){return Array.isArray(row?.checkDetails?.checkItems)?row.checkDetails.checkItems.filter(item=>item&&Number(item.amount)>0):[]}
function normalizedDigits(value,max=40){return clean(value,max).replace(/\D/g,'')}
function bankCheckSourceKey(item){
  const bank=normalizedDigits(item?.bankNumber,20),branch=normalizedDigits(item?.branchNumber,20),account=normalizedDigits(item?.accountNumber,40),check=normalizedDigits(item?.checkNumber,80),cents=amountCents(item?.amount);
  return bank&&branch&&account&&check&&Number.isSafeInteger(cents)&&cents>0?`check:${bank}:${branch}:${account}:${check}:${cents}`:'';
}
function transferBankDetails(row){
  const text=[row?.messageDetail,row?.memo,row?.description].map(value=>clean(value,300)).filter(Boolean).join(' · '),bank=inferMorningBankFromText(text),branchMatch=text.match(/סניף\s*[:\-]?\s*(\d{1,6})/i),accountMatch=text.match(/(?:חשבון|מח[\-־ ]?ן)\s*[:\-]?\s*(\d{3,20})/i);
  return {bankCode:bank?.code||'',bankName:bank?.name||'',bankBranch:branchMatch?.[1]||'',bankAccount:accountMatch?.[1]||''};
}
function checkPayment(item,date,{removable=false}={}){
  const bankCode=morningBankCode(item?.bankNumber),resolved=resolveMorningBank(bankCode||item?.bankNumber),key=bankCheckSourceKey(item);
  return {type:2,date,price:Math.round(Number(item.amount)*100)/100,currency:'ILS',bankCode:resolved?.code||bankCode,bankName:resolved?.name||morningBankName(item?.bankNumber),bankBranch:clean(item?.branchNumber,30),bankAccount:clean(item?.accountNumber,40),chequeNum:clean(item?.checkNumber,40),bankSourceKey:key,locked:true,removable,source:'bank'};
}

export function bankMorningEligibility(row,role='business'){
  const archiveId=Number(row?.archiveId),amount=Number(row?.amount),currency=String(row?.currency||'ILS').trim().toUpperCase(),status=String(row?.status||'').trim().toLowerCase(),kind=String(row?.checkDetails?.kind||'').trim();
  if(role!=='business')return {eligible:false,code:'home-account',reason:'הפקת מסמך זמינה רק בתנועות החשבון העסקי'};
  if(!Number.isSafeInteger(archiveId)||archiveId<=0)return {eligible:false,code:'not-archived',reason:'התנועה עדיין לא קיבלה מזהה ארכיון יציב בענן'};
  if(!Number.isFinite(amount)||amount<=0)return {eligible:false,code:'not-credit',reason:'ניתן להפיק מסמך רק מתנועת זכות שהתקבלה'};
  if(status==='pending')return {eligible:false,code:'pending',reason:'התנועה עדיין ממתינה לקליטה סופית בבנק'};
  if(currency!=='ILS')return {eligible:false,code:'currency',reason:'הפקת Morning מהבנק נתמכת כרגע בתנועות שקליות בלבד'};
  if(kind==='returned'||kind==='returned_credit')return {eligible:false,code:'returned-cheque',reason:'תנועת החזרת צ׳ק אינה תקבול חדש ולכן לא ניתן להפיק ממנה קבלה אוטומטית'};
  if(kind==='deposit'||row?.cheque){
    const items=checkItems(row),sum=items.reduce((total,item)=>total+amountCents(item.amount),0),expected=amountCents(amount);
    if(!items.length)return {eligible:false,code:'check-details-missing',reason:'פרטי הצ׳ק עדיין אינם מלאים בבנק. יש לרענן את הבנק לפני הפקת מסמך'};
    if(items.length>12)return {eligible:false,code:'too-many-checks',reason:'בהפקדה יש יותר מ-12 צ׳קים. יש לפצל את הטיפול לפני הפקת מסמך'};
    if(!items.every(item=>bankCheckSourceKey(item))||sum!==expected)return {eligible:false,code:'check-details-mismatch',reason:'פירוט הצ׳קים אינו תואם עדיין לסכום ההפקדה. ההפקה נחסמה כדי למנוע מסמך שגוי'};
  }
  return {eligible:true,code:'ok',reason:'',aggregate:aggregateTransaction(row)};
}

export function bankMorningPrefill(row){
  const amount=amountCents(row?.amount)/100;if(!Number.isFinite(amount)||amount<=0)throw new Error('bank_morning_invalid_amount');
  const eligibility=bankMorningEligibility(row,'business');if(!eligibility.eligible)throw new Error(eligibility.code||'bank_morning_ineligible');
  const customerName=transactionParty(row),date=dateOnly(row?.processedDate||row?.date),reference=transactionReference(row),description=transactionDescription(row),items=checkItems(row),isCheque=(row?.checkDetails?.kind==='deposit'||row?.cheque)&&items.length>0;
  if(!date)throw new Error('bank_morning_invalid_date');
  let payment,paymentMode='transfer';
  if(isCheque){const removable=items.length>1;payment=items.map(item=>checkPayment(item,date,{removable}));paymentMode='checks'}
  else{const bank=transferBankDetails(row);payment={type:4,date,price:amount,currency:'ILS',transactionId:reference,...bank,bankSourceKey:'transfer',locked:true,removable:false,source:'bank'}}
  return {
    customerName,amount,date,description,orderNumber:'',email:'',phone:'',taxId:'',remarks:'',payment,
    source:{kind:'bank',bankTransactionId:Number(row.archiveId),bankAmount:amount,currency:'ILS',aggregate:aggregateTransaction(row),partyName:customerName,reference,paymentMode,bankCheckCount:isCheque?items.length:0},
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
    candidates.push({debtId:String(debt?.id||''),customerName:debtName,amount:Number(debt?.amount)||0,remainingPayment:paymentRemaining,remainingInvoice:invoiceRemaining,score,reason});
  }
  return candidates.filter(row=>row.debtId).sort((a,b)=>b.score-a.score||a.customerName.localeCompare(b.customerName,'he')).slice(0,12);
}

export function attachBankArchiveMetadata(directRows=[],archiveRows=[]){
  const byKey=new Map();for(const row of Array.isArray(archiveRows)?archiveRows:[]){const key=String(row?.id||row?.mergeKey||'').trim();if(key)byKey.set(key,row)}
  return (Array.isArray(directRows)?directRows:[]).map(row=>{const key=String(row?.mergeKey||row?.id||'').trim(),archive=byKey.get(key);if(!archive)return row;return {...row,archiveId:archive.archiveId,handledAt:archive.handledAt||null,documentLinks:Array.isArray(archive.documentLinks)?archive.documentLinks:[]}})
}

export const normalizeBankMorningParty=normalizeParty;
export const bankMorningCheckSourceKey=bankCheckSourceKey;
