import {
  creditDebitAmount,
  CREDIT_FUTURE_MONTHS,
  CREDIT_HISTORY_DAYS,
  creditProfilePublic,
  creditScrapeFailure,
  creditLoginThrownScrapeFailure,
  creditThrownScrapeFailure,
  normalizeCreditScrapeAccount,
  normalizeCreditScrapeTransaction,
} from './lib.mjs';
import {
  camoufoxCreditSupported,
  isCamoufoxRetryableNativeFailure,
  scrapeIsracardFamilyWithCamoufox,
} from './isracard-camoufox.mjs';
import {safeCreditResponseShape} from './credit-diagnostics.mjs';
import {maxRawTransactionTime} from './credit-data-diagnostics.mjs';
import {AMEX_DIGITAL_V3_SCHEMA_VERSION,scrapeAmexDigitalV3} from './amex-digitalv3.mjs';
import {ISRACARD_DIGITAL_V3_SCHEMA_VERSION,scrapeIsracardDigitalV3} from './isracard-digitalv3.mjs';
import {preserveInstalledChromiumIdentity} from './isracard-group-utils.mjs';

export const CREDIT_CONNECTOR_CONTRACT_VERSION=2;
export const CREDIT_PROVIDER_SCHEMA_VERSION='israeli-bank-scrapers-6.10.0';
export const MAX_PROVIDER_SCHEMA_VERSION='max-netunim-v2+upstream-login-6.10.0';
export const VISA_CAL_PROVIDER_SCHEMA_VERSION='visa-cal-netunim-v7+upstream-6.12.1-balance+pr1184-invalid-password+pr1193-browser-api';
export const CREDIT_CORE_FUTURE_MONTHS=1;
export const CREDIT_RECENT_HISTORY_DAYS=30;
export const CREDIT_SYNC_MODE_QUICK='quick';
export const CREDIT_SYNC_MODE_FORECAST='forecast';
export const CREDIT_SYNC_MODE_RECOVERY='recovery';

const CAL_ENDPOINTS={
  frames:'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus',
  pending:'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests',
  transactions:'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails',
};
const CAL_STATIC_HEADERS={
  Origin:'https://digital-web.cal-online.co.il',
  Referer:'https://digital-web.cal-online.co.il',
  'Accept-Language':'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site':'same-site',
  'Sec-Fetch-Mode':'cors',
  'Sec-Fetch-Dest':'empty',
};
const CAL_TRANSACTION_TYPES={regular:'5',credit:'6',installments:'8',standingOrder:'9'};
const CAL_FRAMES_NOT_RELEVANT_STATUS=87;
const CAL_INVALID_PASSWORD_MESSAGE='שם המשתמש או הסיסמה שהוזנו שגויים';
const MAX_BASE_API_ACTIONS_URL='https://onlinelcapi.max.co.il';
const MAX_BASE_WELCOME_URL='https://www.max.co.il';
const MAX_HOME_PAGE_DATA_URL=`${MAX_BASE_WELCOME_URL}/api/registered/getHomePageData`;
const MAX_CATEGORIES_URL=`${MAX_BASE_API_ACTIONS_URL}/api/contents/getCategories`;

function text(value,max=240){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function excludedAccountSet(values=[]){return new Set((Array.isArray(values)?values:[]).map(value=>text(value,80)).filter(Boolean))}
function two(value){return String(value).padStart(2,'0')}
function monthKey(value){const d=new Date(value);return `${d.getUTCFullYear()}-${two(d.getUTCMonth()+1)}`}
function monthStart(value){const d=new Date(value);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1))}
function addMonths(value,count){const d=monthStart(value);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+count,1))}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function safeDate(value){
  if(!value)return null;
  const raw=String(value).trim(),floatingIso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(raw),d=new Date(floatingIso?`${raw}Z`:raw);
  return Number.isFinite(d.getTime())?d.toISOString():null;
}
function explicitTransactionTime(value){const match=/[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(String(value??'').trim());if(!match)return '';const time=`${match[1]}:${match[2]}`;return time==='00:00'?'':time}
function safeError(message,code,extra={}){const e=new Error(message);e.code=code;Object.assign(e,extra);return e}
function safeSuffix(value){const digits=String(value??'').replace(/\D/g,'');return digits?digits.slice(-4):text(value,4)}
function errorFetchStatus(error){
  const code=String(error?.code||'');
  if(code==='CREDIT_PROVIDER_SCHEMA_ERROR'||code==='CREDIT_PROVIDER_RESPONSE_NOT_JSON')return 'schema_error';
  if(code==='CREDIT_PROVIDER_NETWORK_ERROR')return 'network_error';
  return 'provider_error';
}
function diagnostic(onDiagnostic,event){try{onDiagnostic?.(event)}catch{}}
function diagnosticBrowserProduct(browserPath){
  const name=String(browserPath||'').replace(/\\/g,'/').split('/').pop().toLowerCase();
  if(name==='msedge.exe')return 'edge';
  if(name==='chrome.exe')return 'chrome';
  return '';
}

export function creditRecoveryStartDate(now=new Date()){
  const d=new Date(now);d.setUTCDate(d.getUTCDate()-CREDIT_HISTORY_DAYS);return d;
}
export function creditRecentStartDate(now=new Date()){
  const d=new Date(now);d.setUTCDate(d.getUTCDate()-CREDIT_RECENT_HISTORY_DAYS);return d;
}
// Legacy exported name retained for tests/tools that used the old full horizon helper.
export const creditStartDate=creditRecoveryStartDate;


export function buildCreditMonthPlan({startDate=creditStartDate(),futureMonths=CREDIT_FUTURE_MONTHS,now=new Date()}={}){
  const start=monthStart(startDate),current=monthStart(now),coreEnd=addMonths(current,CREDIT_CORE_FUTURE_MONTHS),end=addMonths(current,Math.max(CREDIT_CORE_FUTURE_MONTHS,Math.trunc(Number(futureMonths)||0))),months=[];
  for(let cursor=start;cursor<=end;cursor=addMonths(cursor,1))months.push({month:monthKey(cursor),tier:cursor<=coreEnd?'core':'forecast'});
  return months;
}

export function normalizeCreditSyncMode(value){
  if(value===CREDIT_SYNC_MODE_FORECAST)return CREDIT_SYNC_MODE_FORECAST;
  if(value===CREDIT_SYNC_MODE_RECOVERY||value==='full')return CREDIT_SYNC_MODE_RECOVERY;
  if(value===CREDIT_SYNC_MODE_QUICK||value==='daily')return CREDIT_SYNC_MODE_QUICK;
  return CREDIT_SYNC_MODE_QUICK;
}
export function creditSyncScope({syncMode=CREDIT_SYNC_MODE_QUICK,now=new Date()}={}){
  const mode=normalizeCreditSyncMode(syncMode);
  if(mode===CREDIT_SYNC_MODE_RECOVERY)return {syncMode:mode,startDate:creditRecoveryStartDate(now),futureMonths:CREDIT_FUTURE_MONTHS};
  if(mode===CREDIT_SYNC_MODE_FORECAST)return {syncMode:mode,startDate:creditRecentStartDate(now),futureMonths:CREDIT_FUTURE_MONTHS};
  return {syncMode:mode,startDate:creditRecentStartDate(now),futureMonths:CREDIT_CORE_FUTURE_MONTHS};
}

export function parseRetryAfter(value,now=Date.now()){
  const raw=String(value??'').trim();if(!raw)return null;
  const seconds=Number(raw);let time=Number.isFinite(seconds)&&seconds>=0?Number(now)+seconds*1000:Date.parse(raw);
  if(!Number.isFinite(time))return null;
  time=Math.max(Number(now)||Date.now(),time);return new Date(time).toISOString();
}

function creditAutomationBlockBody(body=''){
  const value=String(body||'');
  return /(?:block automation|bot detection|sorry[,!]?\s+you have been blocked|attention required[^<]{0,120}cloudflare|cf-error-details)/i.test(value);
}

export function classifyCreditHttpResponse({status=0,text:body='',stage='',retryAfter='',now=Date.now()}={}){
  const httpStatus=Number(status)||0,responseText=String(body||''),extra={stage,httpStatus};
  if(httpStatus===429)return safeError('חברת האשראי הגבילה זמנית את קצב הבקשות. לא יתבצע ניסיון נוסף לפני מועד ההמתנה של החברה.','CREDIT_PROVIDER_RATE_LIMITED',{...extra,retryAfterAt:parseRetryAfter(retryAfter,now)});
  if(httpStatus===403||creditAutomationBlockBody(responseText))return safeError('חברת האשראי חסמה את בקשת האוטומציה של הסשן הנוכחי. לא יתבצע ניסיון נוסף במהלך הסנכרון.','CREDIT_AUTOMATION_BLOCKED',extra);
  if(httpStatus<200||httpStatus>=300)return safeError(`חברת האשראי החזירה HTTP ${httpStatus||'לא ידוע'} בשלב ${stage||'לא ידוע'}.`,'CREDIT_PROVIDER_HTTP_ERROR',extra);
  if(/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(responseText))return safeError('חברת האשראי החזירה HTML במקום JSON.','CREDIT_PROVIDER_RESPONSE_NOT_JSON',extra);
  return null;
}

function parseCreditJsonResponse(responseText,{status=0,stage='',retryAfter='',now=Date.now()}={}){
  const failure=classifyCreditHttpResponse({status,text:responseText,stage,retryAfter,now});
  if(failure)throw failure;
  try{return responseText?JSON.parse(responseText):null}catch{throw safeError('חברת האשראי החזירה תשובה שאינה JSON תקין.','CREDIT_PROVIDER_RESPONSE_NOT_JSON',{stage,httpStatus:Number(status)||0})}
}

async function postJson(fetchImpl,url,data,{headers={},stage='',timeoutMs=60_000,now=Date.now()}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let response;
    try{response=await fetchImpl(url,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',...headers},body:JSON.stringify(data),signal:controller.signal})}
    catch(error){throw safeError(error?.name==='AbortError'?'קריאת הנתונים מחברת האשראי לא הסתיימה בזמן.':'החיבור לשירות הנתונים של חברת האשראי נקטע.','CREDIT_PROVIDER_NETWORK_ERROR',{stage,causeName:text(error?.name,40)})}
    const responseText=await response.text();
    return parseCreditJsonResponse(responseText,{status:response.status,stage,retryAfter:response.headers?.get?.('retry-after')||'',now});
  }finally{clearTimeout(timer)}
}

export async function postVisaCalJson(page,fetchImpl,url,data,{browserHeaders={},nodeHeaders={},stage='',timeoutMs=60_000,now=Date.now()}={}){
  let inPageError='';
  let pageResponse;
  try{
    pageResponse=await page.evaluate(async(innerUrl,innerData,innerHeaders,innerTimeoutMs)=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),innerTimeoutMs);
      try{
        const response=await fetch(innerUrl,{method:'POST',body:JSON.stringify(innerData),credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json',...innerHeaders},signal:controller.signal});
        return {status:response.status,body:await response.text(),retryAfter:response.headers.get('retry-after')||''};
      }finally{clearTimeout(timer)}
    },url,data,browserHeaders,timeoutMs);
  }catch(error){inPageError=text(error?.message||error,180)}
  if(!inPageError){
    try{return {data:parseCreditJsonResponse(String(pageResponse?.body??''),{status:pageResponse?.status,stage,retryAfter:pageResponse?.retryAfter||'',now}),transport:'browser'}}
    catch(error){error.transport='browser';throw error}
  }
  try{return {data:await postJson(fetchImpl,url,data,{headers:nodeHeaders,stage,timeoutMs,now}),transport:'node-fallback',browserError:inPageError}}
  catch(error){error.transport='node-fallback';error.browserRequestError=inPageError;throw error}
}

function shiftMonthDate(value,delta){
  const iso=safeDate(value);if(!iso)return null;const d=new Date(iso),first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+delta,1)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(d.getUTCDate(),last))).toISOString();
}
function calCurrency(value){const v=text(value,12);return ['ש"ח','ש״ח','NIS'].includes(v)?'ILS':v}
function calNumber(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
const CAL_BILLING_DAY_FORMAT=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'});
function calBillingDate(value){
  const raw=String(value||''),day=raw.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
  const iso=safeDate(`${day}T00:00:00Z`);if(iso?.slice(0,10)!==day)return null;
  if(raw.includes('T')&&/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)){const instant=safeDate(raw);return instant?`${CAL_BILLING_DAY_FORMAT.format(new Date(instant))}T00:00:00.000Z`:null}
  return iso;
}
function calIsIls(value){return ['ILS','₪'].includes(calCurrency(value))}
const CAL_LOCAL_TIME_FORMAT=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function calPurchaseDate(value){const raw=String(value||''),iso=safeDate(raw);if(!iso)return null;return raw.includes('T')&&/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)?`${CAL_LOCAL_TIME_FORMAT.format(new Date(iso)).replace(' ','T')}.000Z`:iso}

export function normalizeVisaCalTransaction(transaction={}){
  const pending=transaction.debCrdDate===undefined||transaction.debCrdDate===null,numOfPayments=Number(pending?transaction.numberOfPayments:transaction.numOfPayments),part=Number(pending?1:transaction.curPaymentNum),installments=numOfPayments>0?{number:Math.max(1,Math.trunc(part)||1),total:Math.trunc(numOfPayments)}:null,purchaseDate=calPurchaseDate(transaction.trnPurchaseDate),date=installments?shiftMonthDate(purchaseDate,installments.number-1):purchaseDate;
  const chargedBase=calNumber(pending?transaction.trnAmt:transaction.amtBeforeConvAndIndex),originalBase=calNumber(transaction.trnAmt),credit=String(transaction.trnTypeCode)===CAL_TRANSACTION_TYPES.credit;
  return normalizeCreditScrapeTransaction({
    identifier:pending?'':transaction.trnIntId,
    type:[CAL_TRANSACTION_TYPES.regular,CAL_TRANSACTION_TYPES.standingOrder].includes(String(transaction.trnTypeCode))?'normal':'installments',
    status:pending?'pending':'completed',date,processedDate:pending?purchaseDate:calBillingDate(transaction.debCrdDate),transactionDate:purchaseDate,transactionTime:explicitTransactionTime(purchaseDate),
    originalAmount:Number.isFinite(originalBase)?originalBase*(credit?1:-1):null,originalCurrency:calCurrency(transaction.trnCurrencySymbol),
    chargedAmount:Number.isFinite(chargedBase)?-chargedBase:null,chargedCurrency:pending?'':calCurrency(transaction.debCrdCurrencySymbol),
    ...(!pending?{chargeAmountStatus:chargedBase===null?'missing':'reported'}:{}),
    description:text(transaction.merchantName,220)||'עסקת אשראי',memo:text(transaction.transTypeCommentDetails,260),installments,
  });
}

function visaCalProviderMessage(data,fallback){return text(data?.statusTitle,160)||text(data?.statusDescription,160)||text(data?.title,160)||fallback}

export function parseVisaCalMonthData(data,{startDate=null}={}){
  if(data?.statusCode!==1)throw safeError(visaCalProviderMessage(data,'כאל לא אישרה את קריאת החודש.'),'CREDIT_PROVIDER_DATA_ERROR',{stage:'Transactions'});
  if(!data?.result||!Array.isArray(data.result.bankAccounts))throw safeError('כאל החזירה מבנה חודשי שאינו תואם לחוזה המחבר.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Transactions'});
  const rows=[];
  for(const [accountIndex,account] of data.result.bankAccounts.entries()){
    const regular=Array.isArray(account?.debitDates)?account.debitDates:[],immediate=Array.isArray(account?.immidiateDebits?.debitDays)?account.immidiateDebits.debitDays:[];
    for(const debitDay of [...regular,...immediate]){
      if(!Array.isArray(debitDay?.transactions))throw safeError('כאל החזירה debit day ללא מערך עסקאות.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Transactions'});
      const due=calBillingDate(debitDay.date),dayRows=debitDay.transactions.map(raw=>normalizeVisaCalTransaction(due&&raw.debCrdDate!=null?{...raw,debCrdDate:due}:raw));
      // CAL's own transactions screen uses debitDates[].totalDebits[].amount
      // for the cycle header, not the sum of individual amtBeforeConvAndIndex.
      // Keep the purchases intact and expose any difference as a named row.
      const totals=Array.isArray(debitDay.totalDebits)?debitDay.totalDebits.filter(total=>calIsIls(total?.currencySymbol)):[],reported=totals.length===1?calNumber(totals[0].amount):null;
      // A blank charge is never replaced with the transaction's face value.
      // When CAL's complete ILS cycle total equals all explicitly charged rows,
      // its blank rows are informational for this cycle (fees waived/rewards).
      // Otherwise preserve them as unknown rather than inventing a zero debit.
      const ilsRows=dayRows.filter((tx,i)=>calIsIls(debitDay.transactions[i].debCrdCurrencySymbol||debitDay.transactions[i].trnCurrencySymbol));
      if(due&&reported!==null&&dayRows.every(tx=>tx.status==='completed')){
        const seen=new Set(),known=ilsRows.reduce((sum,tx)=>{if(tx.chargeAmountStatus!=='reported')return sum;const key=tx.id?`${tx.id}|${tx.installments?.number||1}`:'';if(key&&seen.has(key))return sum;if(key)seen.add(key);return sum-Math.round(tx.chargedAmount*100)},0);
        if(known===Math.round(reported*100))for(const tx of ilsRows)if(tx.chargeAmountStatus==='missing')tx.chargeAmountStatus='not_billed';
      }
      const complete=due&&debitDay.transactions.every((raw,i)=>dayRows[i].status==='completed'&&calNumber(raw.amtBeforeConvAndIndex)!==null&&!!text(raw.debCrdCurrencySymbol));
      if(complete&&reported!==null){
        const seen=new Set(),knownCents=dayRows.reduce((sum,tx)=>{if(!calIsIls(tx.chargedCurrency))return sum;const key=tx.id?`${tx.id}|${tx.processedDate}|${tx.installments?.number||1}`:'';if(key&&seen.has(key))return sum;if(key)seen.add(key);return sum-Math.round(tx.chargedAmount*100)},0),difference=Math.round(reported*100)-knownCents;
        if(difference)dayRows.push(normalizeCreditScrapeTransaction({id:`cal-statement:${accountIndex}:${regular.includes(debitDay)?'cycle':'immediate'}:${due.slice(0,10)}:ILS`,type:'statement_adjustment',status:'completed',date:due,processedDate:due,transactionDate:due,chargedAmount:-difference/100,chargedCurrency:'ILS',originalAmount:-difference/100,originalCurrency:'ILS',description:'התאמה לסיכום החיוב של כאל',memo:`סיכום כאל: ${reported.toFixed(2)} ₪; סכום העסקאות: ${(knownCents/100).toFixed(2)} ₪. ההפרש מבוסס על סיכום חברת האשראי.`}));
      }
      for(const tx of dayRows){const billingDate=tx.processedDate;if(!startDate||!billingDate||Date.parse(billingDate)>=Date.parse(startDate))rows.push(tx)}
    }
  }
  return rows;
}

function firstVisaCalRawTransaction(data){
  for(const account of Array.isArray(data?.result?.bankAccounts)?data.result.bankAccounts:[]){
    for(const debitDay of [...(Array.isArray(account?.debitDates)?account.debitDates:[]),...(Array.isArray(account?.immidiateDebits?.debitDays)?account.immidiateDebits.debitDays:[])]){
      const row=Array.isArray(debitDay?.transactions)?debitDay.transactions.find(item=>item&&typeof item==='object'):null;if(row)return row;
    }
  }
  return null;
}

function parseVisaCalPending(data){
  if(data?.statusCode===96)return [];
  if(data?.statusCode!==1)throw safeError(visaCalProviderMessage(data,'כאל לא אישרה את קריאת העסקאות הממתינות.'),'CREDIT_PROVIDER_DATA_ERROR',{stage:'Pending'});
  if(!Array.isArray(data?.result?.cardsList))throw safeError('כאל החזירה מבנה עסקאות ממתינות שאינו תואם לחוזה המחבר.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Pending'});
  return data.result.cardsList.flatMap(card=>Array.isArray(card?.authDetalisList)?card.authDetalisList:[]).map(normalizeVisaCalTransaction);
}

function hasOwn(value,key){return !!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key)}
function visaCalFrameProviderError(data){
  if(!data||typeof data!=='object'||Array.isArray(data))return false;
  const resultMissing=data.result===undefined||data.result===null,statusCodeError=hasOwn(data,'statusCode')&&Number(data.statusCode)!==1,status=data.status,statusError=hasOwn(data,'status')&&(status===false||(typeof status==='number'&&![0,1,200].includes(status))||(typeof status==='string'&&!['','0','1','200','ok','success','successful'].includes(status.trim().toLowerCase()))),titledMissing=resultMissing&&(text(data.statusTitle,1)||text(data.statusDescription,1)||text(data.title,1));
  return statusCodeError||statusError||!!titledMissing;
}
function frameUnavailable(){return safeError('כאל לא סיפקה נתון מסגרת עבור הכרטיס; העסקאות יישמרו ונתון המסגרת האחרון, אם קיים, יישאר כ־Last Known Good.','CREDIT_FRAMES_UNAVAILABLE',{stage:'Frames'})}
function validateFrameNumber(value,name){if(value!==undefined&&value!==null&&typeof value!=='number')throw safeError(`כאל החזירה ${name} מסוג שאינו תואם לחוזה Frames 6.9.0.`,'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'})}
function validateFrameDate(value,name){if(value!==undefined&&value!==null&&typeof value!=='string')throw safeError(`כאל החזירה ${name} מסוג שאינו תואם לחוזה Frames 6.9.0.`,'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'})}
function validateFrameGroup(group,name){
  if(group===undefined||group===null)return null;
  if(typeof group!=='object'||Array.isArray(group))throw safeError(`כאל החזירה קבוצת ${name} שאינה אובייקט.`,'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'});
  validateFrameNumber(group.nextTotalDebitForAccount,`${name}.nextTotalDebitForAccount`);validateFrameDate(group.nextTotalDebitDateForAccount,`${name}.nextTotalDebitDateForAccount`);validateFrameNumber(group.frameLimitForCardAmount,`${name}.frameLimitForCardAmount`);validateFrameNumber(group.fictiveMaxAccAmt,`${name}.fictiveMaxAccAmt`);
  if(group.cardLevelFrames!==undefined&&group.cardLevelFrames!==null&&!Array.isArray(group.cardLevelFrames))throw safeError(`כאל החזירה ${name}.cardLevelFrames שאינו מערך.`,'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'});
  for(const frame of Array.isArray(group.cardLevelFrames)?group.cardLevelFrames:[]){if(!frame||typeof frame!=='object'||Array.isArray(frame)||typeof frame.cardUniqueId!=='string')throw safeError(`כאל החזירה רשומת cardLevelFrames לא תקינה בקבוצת ${name}.`,'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'});validateFrameNumber(frame.nextTotalDebit,`${name}.cardLevelFrames.nextTotalDebit`);validateFrameDate(frame.nextDebitDate,`${name}.cardLevelFrames.nextDebitDate`)}
  return group;
}

export function parseVisaCalFrame(data,card={}){
  // Cal status 87 means there is no card relevant to the Frames display. The same card can still return valid monthly transactions,
  // so this is a non-applicable frame result rather than a failed credit-card synchronization.
  if(Number(data?.statusCode)===CAL_FRAMES_NOT_RELEVANT_STATUS)return {balance:null,balanceDate:null,cardType:'',cardFrame:null,frameStatus:'missing',frameFetchStatus:'unavailable',warning:null};
  if(visaCalFrameProviderError(data))throw safeError(visaCalProviderMessage(data,'כאל החזירה שגיאת provider מפורשת בקריאת Frames.'),'CREDIT_PROVIDER_DATA_ERROR',{stage:'Frames'});
  if(data?.result===undefined||data?.result===null)return {balance:null,balanceDate:null,cardType:'',cardFrame:null,frameStatus:'missing',frameFetchStatus:'unavailable',warning:frameUnavailable()};
  if(typeof data.result!=='object'||Array.isArray(data.result))throw safeError('כאל החזירה result מסוג שאינו תואם לחוזה Frames 6.9.0.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'});
  const bankGroup=validateFrameGroup(data.result.bankIssuedCards,'bankIssuedCards'),calGroup=validateFrameGroup(data.result.calIssuedCards,'calIssuedCards'),bankFrame=bankGroup?.cardLevelFrames?.find(item=>item.cardUniqueId===card.cardUniqueId),calFrame=calGroup?.cardLevelFrames?.find(item=>item.cardUniqueId===card.cardUniqueId);
  let frame=bankFrame||calFrame,group=bankFrame?bankGroup:calFrame?calGroup:null,cardType=bankFrame?'bankIssued':calFrame?'companyIssued':'';
  if(!group&&bankGroup&&!calGroup){group=bankGroup;cardType='bankIssued'}else if(!group&&calGroup&&!bankGroup){group=calGroup;cardType='companyIssued'}
  if(!group)return {balance:null,balanceDate:null,cardType:'',cardFrame:null,frameStatus:'missing',frameFetchStatus:'unavailable',warning:frameUnavailable()};
  const limit=group.frameLimitForCardAmount,fictiveMax=group.fictiveMaxAccAmt,amount=frame?.nextTotalDebit??group.nextTotalDebitForAccount??(limit!==undefined&&limit!==null&&fictiveMax!==undefined&&fictiveMax!==null?limit-fictiveMax:undefined),date=frame?.nextDebitDate??group.nextTotalDebitDateForAccount,hasData=amount!==undefined&&amount!==null||date!==undefined&&date!==null||limit!==undefined&&limit!==null;
  if(!hasData)return {balance:null,balanceDate:null,cardType,cardFrame:null,frameStatus:'missing',frameFetchStatus:'unavailable',warning:frameUnavailable()};
  return {balance:amount===undefined||amount===null?null:-amount,balanceDate:calBillingDate(date),cardType,cardFrame:limit===undefined||limit===null?null:limit,frameStatus:'fresh',frameFetchStatus:'success',warning:null};
}

function monthlyCoverageFailure(plan,error,at){return {month:plan.month,tier:plan.tier,fetchStatus:errorFetchStatus(error),fetchedAt:null,transactions:[],providerSchemaVersion:VISA_CAL_PROVIDER_SCHEMA_VERSION,lastErrorCode:String(error?.code||'CREDIT_PROVIDER_DATA_ERROR'),lastErrorAt:at}}
function monthlyCoverageSuccess(plan,transactions,at,schemaVersion=VISA_CAL_PROVIDER_SCHEMA_VERSION){return {month:plan.month,tier:plan.tier,fetchStatus:'success',fetchedAt:at,transactions,providerSchemaVersion:schemaVersion,lastErrorCode:'',lastErrorAt:null}}
function coverageError(profile,error,{month='',tier='',accountNumber='',at=new Date().toISOString(),component='',severity=''}={}){const stage=String(error?.stage||'Transactions').slice(0,80),resolvedComponent=component||(tier==='core'?'core_transactions':tier==='forecast'?'forecast_transactions':stage==='Frames'?'frames':stage==='Pending'?'pending':'profile'),resolvedSeverity=severity||(resolvedComponent==='core_transactions'?'error':'warning');return {profileId:profile.profileId,provider:profile.provider,label:profile.label,code:String(error?.code||'CREDIT_PROVIDER_DATA_ERROR'),stage,httpStatus:Number(error?.httpStatus)||0,message:error?.message||'קריאת נתוני האשראי נכשלה',at,originalFailureAt:error?.originalFailureAt||at,retryAfterAt:error?.retryAfterAt||null,month,tier,component:resolvedComponent,severity:resolvedSeverity,accountSuffix:safeSuffix(accountNumber)}}

const VISA_CAL_LOGIN_RESULT_TIMEOUT_MS=45_000;
const VISA_CAL_LOGIN_RESULT_POLL_MS=200;

function safeDecodeVisaCalUrl(value){try{return decodeURIComponent(String(value||''))}catch{return String(value||'')}}
export function isVisaCalInvalidPasswordErrorUrl(value){const decoded=safeDecodeVisaCalUrl(value);return decoded.includes('/calconnect/error')&&decoded.includes(CAL_INVALID_PASSWORD_MESSAGE)}
function visaCalHasInvalidPasswordErrorFrame(page){
  try{return (typeof page?.frames==='function'?page.frames():[]).some(frame=>{try{return isVisaCalInvalidPasswordErrorUrl(frame?.url?.())}catch{return false}})}catch{return false}
}

async function visaCalClientUrl(page){
  try{if(typeof page?.evaluate==='function')return String(await page.evaluate(()=>window.location.href)||'')}catch{}
  try{return String(page?.url?.()||'')}catch{return ''}
}
function visaCalStaticLoginConditionMatches(condition,currentUrl){
  if(condition instanceof RegExp){condition.lastIndex=0;return condition.test(currentUrl)}
  return typeof condition==='string'&&currentUrl.toLowerCase()===condition.toLowerCase();
}
async function visaCalUpstreamLoginResult(page,possibleResults){
  const currentUrl=await visaCalClientUrl(page),entries=Object.entries(possibleResults&&typeof possibleResults==='object'?possibleResults:{});
  for(const [result,conditions] of entries)for(const condition of Array.isArray(conditions)?conditions:[])if(typeof condition!=='function'&&visaCalStaticLoginConditionMatches(condition,currentUrl))return {result,currentUrl};
  const frames=typeof page?.frames==='function'?page.frames():[],hasConnectFrame=frames.some(frame=>{try{return /connect/i.test(String(frame?.url?.()||''))}catch{return false}});
  if(!hasConnectFrame)return null;
  for(const [result,conditions] of entries){
    for(const condition of Array.isArray(conditions)?conditions:[]){
      if(typeof condition!=='function')continue;
      try{if(await condition({page,value:currentUrl}))return {result,currentUrl}}catch{}
    }
  }
  return null;
}
async function waitForVisaCalUpstreamLoginResult(scraper,possibleResults,{timeoutMs=VISA_CAL_LOGIN_RESULT_TIMEOUT_MS,pollMs=VISA_CAL_LOGIN_RESULT_POLL_MS}={}){
  const page=scraper?.page;if(!page)throw safeError('מחבר כאל לא חשף page לאחר initialize.','CREDIT_CONNECTOR_COMPATIBILITY_ERROR',{stage:'LoginSetup'});
  const timeout=Math.max(1000,Number(timeoutMs)||VISA_CAL_LOGIN_RESULT_TIMEOUT_MS),poll=Math.max(25,Number(pollMs)||VISA_CAL_LOGIN_RESULT_POLL_MS),deadline=Date.now()+timeout;let tutorialCloseAttempted=false;
  while(Date.now()<=deadline){
    const currentUrl=await visaCalClientUrl(page);
    if(/site-tutorial(?:[/?#]|$)/i.test(currentUrl)&&!tutorialCloseAttempted){tutorialCloseAttempted=true;try{await page.click('button.btn-close')}catch{}}
    const recognized=await visaCalUpstreamLoginResult(page,possibleResults);if(recognized)return recognized;
    const remaining=deadline-Date.now();if(remaining<=0)break;await sleep(Math.min(poll,remaining));
  }
  const error=new Error(`Visa Cal login did not reach an upstream-recognized result within ${timeout} ms`);error.name='TimeoutError';throw error;
}

export async function prepareVisaCalBrowserIdentity(page,{identityProbeUrl=''}={}){
  if(!page||typeof page.evaluate!=='function'||typeof page.setUserAgent!=='function'||typeof page.evaluateOnNewDocument!=='function')throw safeError('מחבר כאל המותקן אינו חושף Page מלא שנדרש לשמירת זהות Chrome/Edge עקבית.','CREDIT_CONNECTOR_COMPATIBILITY_ERROR',{stage:'BrowserIdentity'});
  const identity=await preserveInstalledChromiumIdentity(page,{probeUrl:identityProbeUrl});
  if(!identity.ok)throw safeError('לא ניתן לשמר זהות Chrome/Edge מקורית ועקבית עבור כאל; הסנכרון נעצר לפני הכניסה כדי לא לשלוח User-Agent ו-Client Hints סותרים.','CREDIT_BROWSER_IDENTITY_UNAVAILABLE',{stage:'BrowserIdentity',clientHintsState:identity.clientHintsState,browserMajorVersion:identity.browserMajorVersion});
  if(typeof page.setExtraHTTPHeaders==='function')await page.setExtraHTTPHeaders({'accept-language':'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7'});
  await page.evaluateOnNewDocument(()=>{try{Object.defineProperty(navigator,'webdriver',{get:()=>undefined,configurable:true})}catch{}});
  return identity;
}

export function applyVisaCalLoginNavigationPolicy(scraper,{loginResultTimeoutMs=VISA_CAL_LOGIN_RESULT_TIMEOUT_MS,loginResultPollMs=VISA_CAL_LOGIN_RESULT_POLL_MS}={}){
  if(!scraper||typeof scraper.getLoginOptions!=='function')throw safeError('מחבר כאל המותקן אינו חושף את חוזה getLoginOptions שנדרש למדיניות הניווט המקומית.','CREDIT_CONNECTOR_COMPATIBILITY_ERROR',{stage:'LoginSetup'});
  const getLoginOptions=scraper.getLoginOptions.bind(scraper);scraper.__netunimLoginStep='navigation';
  scraper.getLoginOptions=credentials=>{
    const options=getLoginOptions(credentials);
    if(!options||typeof options!=='object'||Array.isArray(options))throw safeError('מחבר כאל המותקן החזיר חוזה LoginOptions לא תקין.','CREDIT_CONNECTOR_COMPATIBILITY_ERROR',{stage:'LoginSetup'});
    if(!options.possibleResults||typeof options.possibleResults!=='object'||Array.isArray(options.possibleResults))throw safeError('מחבר כאל המותקן אינו חושף possibleResults תקין לזיהוי תוצאת הכניסה.','CREDIT_CONNECTOR_COMPATIBILITY_ERROR',{stage:'LoginSetup'});
    const possibleResults={...options.possibleResults},invalidPasswordKey=Object.keys(possibleResults).find(key=>key==='INVALID_PASSWORD'||/invalid.*password/i.test(key));
    if(invalidPasswordKey)possibleResults[invalidPasswordKey]=[async({page}={})=>visaCalHasInvalidPasswordErrorFrame(page),...(Array.isArray(possibleResults[invalidPasswordKey])?possibleResults[invalidPasswordKey]:[])];
    const wrapStep=(step,nextStep,action)=>typeof action==='function'?async(...args)=>{scraper.__netunimLoginStep=step;const result=await action(...args);if(nextStep)scraper.__netunimLoginStep=nextStep;return result}:action;
    // Cal is an SPA and the credential form lives in a cross-origin iframe. Upstream
    // clicks Submit and only afterwards starts waitForNavigation() on the main page.
    // That wait can miss the already-completed transition, and an iframe-local result
    // does not have to create a main-page navigation event at all. Use the installed
    // scraper's own possibleResults contract as the authority instead of duplicating
    // Cal selectors/messages locally. The 45-second bound and one credential submit stay unchanged.
    const postAction=async()=>{scraper.__netunimLoginStep='result-detection';await waitForVisaCalUpstreamLoginResult(scraper,possibleResults,{timeoutMs:loginResultTimeoutMs,pollMs:loginResultPollMs})};
    // The landing document itself only needs DOMContentLoaded because upstream already
    // owns the explicit #ccLoginDesktopBtn readiness check.
    return {...options,possibleResults,waitUntil:'domcontentloaded',checkReadiness:wrapStep('landing-readiness','open-login-popup',options.checkReadiness),preAction:wrapStep('open-login-popup','credentials-submit',options.preAction),postAction};
  };
  return scraper;
}

export class CreditProviderAdapter {
  constructor({profile,onDiagnostic=()=>{},correlationId='',now=()=>new Date(),syncMode=CREDIT_SYNC_MODE_QUICK,interactive=false,browserPath='',excludedAccountNumbers=[]}={}){this.profile=profile;this.onDiagnostic=onDiagnostic;this.correlationId=correlationId;this.now=now;this.syncMode=normalizeCreditSyncMode(syncMode);this.browserMode=interactive?'headed':'headless';this.browserProduct=diagnosticBrowserProduct(browserPath);this.connectorVersion='';this.excludedAccountNumbers=excludedAccountSet(excludedAccountNumbers)}
  event(event){const engine=String(event?.browserEngine||'');diagnostic(this.onDiagnostic,{correlationId:this.correlationId,provider:this.profile?.provider,profileId:this.profile?.profileId,connectorVersion:this.connectorVersion||undefined,syncMode:this.syncMode,browserMode:this.browserMode,browserProduct:engine==='camoufox'?'camoufox':this.browserProduct,...event})}
  async scrape(){throw new Error('CreditProviderAdapter.scrape must be implemented')}
}

export class VisaCalAdapter extends CreditProviderAdapter {
  constructor(options={}){super(options);this.connectorVersion=VISA_CAL_PROVIDER_SCHEMA_VERSION;Object.assign(this,{createScraper:options.createScraper,CompanyTypes:options.CompanyTypes,browserPath:options.browserPath,identityProbeUrl:options.identityProbeUrl||'',interactive:!!options.interactive,fetchImpl:options.fetchImpl||globalThis.fetch,requestDelayMs:Number.isFinite(options.requestDelayMs)?options.requestDelayMs:650,excludedAccountNumbers:this.excludedAccountNumbers})}
  async request(url,data,stage){if(this.blockingError)throw this.blockingError;const started=Date.now();try{const result=await postVisaCalJson(this.page,this.fetchImpl,url,data,{browserHeaders:this.browserHeaders,nodeHeaders:this.nodeHeaders,stage,now:this.now().getTime()});this.event({stage,durationMs:Date.now()-started,transport:result.transport,responseShape:safeCreditResponseShape(result.data)});return result.data}catch(error){if(['CREDIT_AUTOMATION_BLOCKED','CREDIT_PROVIDER_RATE_LIMITED'].includes(String(error?.code||''))){error.originalFailureAt=error.originalFailureAt||this.now().toISOString();this.blockingError=error}this.event({stage,durationMs:Date.now()-started,transport:error?.transport||'',errorClass:error?.code,httpStatus:error?.httpStatus,retryAfterAt:error?.retryAfterAt});throw error}}
  async scrape(){
    const profile=this.profile,scope=creditSyncScope({syncMode:this.syncMode,now:this.now()}),startDate=scope.startDate,plan=buildCreditMonthPlan({startDate,futureMonths:scope.futureMonths,now:this.now()}),scraper=applyVisaCalLoginNavigationPolicy(this.createScraper({companyId:this.CompanyTypes.visaCal,startDate,futureMonthsToScrape:0,combineInstallments:false,showBrowser:this.interactive,executablePath:this.browserPath,navigationRetryCount:1,defaultTimeout:45_000,timeout:90_000,additionalTransactionInformation:false,includeRawTransaction:false}));let initialized=false,success=false;
    try{
      await scraper.initialize();initialized=true;this.event({stage:'BrowserInit'});
      let browserIdentity;try{browserIdentity=await prepareVisaCalBrowserIdentity(scraper.page,{identityProbeUrl:this.identityProbeUrl});this.event({stage:'BrowserIdentity',clientHintsState:browserIdentity.clientHintsState,browserMajorVersion:browserIdentity.browserMajorVersion})}catch(error){this.event({stage:'BrowserIdentity',errorClass:error?.code||'CREDIT_BROWSER_IDENTITY_UNAVAILABLE',clientHintsState:error?.clientHintsState||'',browserMajorVersion:error?.browserMajorVersion||0});throw error}
      let loginResult,loginStarted=Date.now();try{loginResult=await scraper.login(profile.credentials)}catch(error){const loginStep=['navigation','landing-readiness','open-login-popup','credentials-submit','post-submit-navigation','result-detection'].includes(String(scraper.__netunimLoginStep||''))?String(scraper.__netunimLoginStep):'';const failure=creditLoginThrownScrapeFailure(error,profile);if(loginStep)failure.loginStep=loginStep;this.event({stage:failure.stage||'LoginFlow',durationMs:Date.now()-loginStarted,errorClass:failure.code,loginStep});throw failure}
      if(!loginResult?.success)throw creditScrapeFailure(loginResult,profile);this.event({stage:'Login',durationMs:Date.now()-loginStarted});
      let cards;try{cards=await scraper.getCards()}catch{throw safeError('נתוני init ורשימת הכרטיסים של כאל לא נמצאו לאחר הכניסה.','CREDIT_SESSION_INIT_MISSING',{stage:'DashboardInit'})}
      if(!Array.isArray(cards)||!cards.length)throw safeError('כאל לא החזירה רשימת כרטיסים תקינה.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'DashboardInit'});
      let authorization;try{authorization=await scraper.getAuthorizationHeader()}catch{throw safeError('אסימון ההרשאה של כאל לא נמצא לאחר הכניסה.','CREDIT_AUTH_TOKEN_MISSING',{stage:'AuthToken'})}
      if(!String(authorization||'').trim())throw safeError('אסימון ההרשאה של כאל ריק.','CREDIT_AUTH_TOKEN_MISSING',{stage:'AuthToken'});
      const xSiteId=await scraper.getXSiteId();this.page=scraper.page;this.browserHeaders={Authorization:authorization,'X-Site-Id':xSiteId};this.nodeHeaders={...this.browserHeaders,...browserIdentity.requestHeaders,...CAL_STATIC_HEADERS};
      const accounts=[],errors=[],dataDiagnostics=[];
      for(const card of cards){
        const accountNumber=text(card?.last4Digits,80);
        if(this.excludedAccountNumbers.has(accountNumber)){this.event({stage:'CardExcluded',accountSuffix:safeSuffix(accountNumber)});continue}
        const at=this.now().toISOString(),account={accountNumber,balance:null,balanceDate:null,cardType:'',cardFrame:null,availableCredit:null,frameStatus:'missing',frameFetchStatus:'unavailable',frameFetchedAt:null,frameErrorCode:'',frameErrorAt:null,pendingTransactions:[],pendingStatus:'missing',months:[]};
        try{const parsed=parseVisaCalFrame(await this.request(CAL_ENDPOINTS.frames,{cardsForFrameData:[{cardUniqueId:card.cardUniqueId}]},'Frames'),card),warning=parsed.warning;delete parsed.warning;Object.assign(account,parsed);if(parsed.frameFetchStatus==='success')account.frameFetchedAt=at;if(warning){account.frameErrorCode=warning.code;account.frameErrorAt=at;errors.push(coverageError(profile,warning,{accountNumber,at,component:'frames',severity:'warning'}))}}catch(error){account.frameFetchStatus=errorFetchStatus(error);account.frameErrorCode=error.code;account.frameErrorAt=at;errors.push(coverageError(profile,error,{accountNumber,at,component:'frames',severity:'warning'}))}
        if(!this.blockingError&&this.requestDelayMs>0)await sleep(this.requestDelayMs);
        try{account.pendingTransactions=parseVisaCalPending(await this.request(CAL_ENDPOINTS.pending,{cardUniqueIDArray:[card.cardUniqueId]},'Pending'));account.pendingStatus='success';account.pendingFetchedAt=at}catch(error){account.pendingStatus=errorFetchStatus(error);account.pendingErrorCode=error.code;account.pendingErrorAt=at;errors.push(coverageError(profile,error,{accountNumber,at,component:'pending',severity:'warning'}))}
        for(const entry of plan){
          if(!this.blockingError&&this.requestDelayMs>0)await sleep(this.requestDelayMs);
          try{const data=await this.request(CAL_ENDPOINTS.transactions,{cardUniqueId:card.cardUniqueId,month:String(Number(entry.month.slice(5,7))),year:entry.month.slice(0,4)},`Transactions ${entry.month}`),rawSample=dataDiagnostics.some(row=>row.accountNumber===accountNumber)?null:firstVisaCalRawTransaction(data),transactions=parseVisaCalMonthData(data,{startDate:entry.month===plan[0].month?startDate:null});if(rawSample)dataDiagnostics.push({profileId:profile.profileId,accountNumber,rawTransaction:rawSample});account.months.push(monthlyCoverageSuccess(entry,transactions,this.now().toISOString()))}
          catch(error){const failedAt=this.now().toISOString();account.months.push(monthlyCoverageFailure(entry,error,failedAt));errors.push(coverageError(profile,error,{month:entry.month,tier:entry.tier,accountNumber,at:failedAt,component:entry.tier==='core'?'core_transactions':'forecast_transactions',severity:entry.tier==='core'?'error':'warning'}))}
        }
        accounts.push(normalizeCreditScrapeAccount(account,profile.provider));
      }
      const coreComplete=accounts.every(account=>account.months.filter(slice=>slice.tier==='core').every(slice=>slice.fetchStatus==='success')),forecastFailures=errors.filter(error=>error.tier==='forecast').length,coreFailures=errors.filter(error=>error.tier==='core').length,syncedAt=coreComplete?this.now().toISOString():null;
      const blocked=!!this.blockingError;
      if(forecastFailures)errors.unshift({profileId:profile.profileId,provider:profile.provider,label:profile.label,code:'CREDIT_PARTIAL_FORECAST',stage:'Forecast',component:'forecast_transactions',severity:blocked?'deferred':'warning',httpStatus:0,message:blocked?`קריאות התחזית הושהו לאחר 403/429; ${forecastFailures} מקטעים לא נשלחו ו־Last Known Good נשמר.`:`לכאל חסרים ${forecastFailures} מקטעי תחזית; נתונים קודמים נשמרים כ־Last Known Good.`,at:this.blockingError?.originalFailureAt||this.now().toISOString(),originalFailureAt:this.blockingError?.originalFailureAt||null,retryAfterAt:this.blockingError?.retryAfterAt||null});
      if(coreFailures)errors.unshift({profileId:profile.profileId,provider:profile.provider,label:profile.label,code:'CREDIT_CORE_COVERAGE_INCOMPLETE',stage:'CoreCoverage',component:'core_transactions',severity:blocked?'deferred':'error',httpStatus:0,message:blocked?`קריאות Core הושהו לאחר 403/429; ${coreFailures} מקטעים לא נשלחו, שעון ההצלחה לא התקדם ו־Last Known Good נשמר.`:`לכאל חסרים ${coreFailures} מקטעי ליבה; זמן ההצלחה המלאה לא התקדם ונתוני Last Known Good נשמרו.`,at:this.blockingError?.originalFailureAt||this.now().toISOString(),originalFailureAt:this.blockingError?.originalFailureAt||null,retryAfterAt:this.blockingError?.retryAfterAt||null});
      success=coreComplete;return {...creditProfilePublic(profile),syncedAt,attemptedAt:this.now().toISOString(),coreComplete,accounts,errors,_dataDiagnostics:dataDiagnostics};
    }finally{if(initialized)try{await scraper.terminate(success)}catch{} }
  }
}

function maxTransactionsUrl(month){
  const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month||''));
  if(!match)throw safeError('חודש MAX שנבנה לסנכרון אינו תקין.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'MaxMonth'});
  const url=new URL(`${MAX_BASE_API_ACTIONS_URL}/api/registered/transactionDetails/getTransactionsAndGraphs`),date=`${match[1]}-${Number(match[2])}-01`;
  url.searchParams.set('filterData',JSON.stringify({userIndex:-1,cardIndex:-1,monthView:true,date,dates:{startDate:'0',endDate:'0'},bankAccount:{bankAccountIndex:-1,cards:null}}));
  url.searchParams.set('firstCallCardIndex','-1');
  return url.toString();
}
async function maxGetJsonWithinPage(page,url,stage,now=Date.now()){
  let payload;
  try{
    payload=await page.evaluate(async innerUrl=>{
      let response;
      try{response=await fetch(innerUrl,{credentials:'include'})}catch(error){return {networkError:String(error?.message||error||'fetch failed')}}
      const body=response.status===204?'':await response.text();
      return {status:response.status,body,retryAfter:response.headers?.get?.('retry-after')||''};
    },url);
  }catch(error){throw safeError('קריאת נתוני MAX מתוך הסשן המחובר נכשלה לפני קבלת תשובה.','CREDIT_PROVIDER_NETWORK_ERROR',{stage,causeName:text(error?.name,40)})}
  if(payload?.networkError)throw safeError('החיבור לשירות הנתונים של MAX נקטע.','CREDIT_PROVIDER_NETWORK_ERROR',{stage});
  const body=String(payload?.body||''),failure=classifyCreditHttpResponse({status:Number(payload?.status)||0,text:body,stage,retryAfter:payload?.retryAfter||'',now});
  if(failure)throw failure;
  if(!body)return null;
  try{return JSON.parse(body)}catch{throw safeError('MAX החזירה תשובה שאינה JSON תקין.','CREDIT_PROVIDER_RESPONSE_NOT_JSON',{stage,httpStatus:Number(payload?.status)||0})}
}
function maxNumber(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const raw=String(value).trim().replace(/[₪$€\s]/g,'').replace(/,(?=\d{3}(?:\D|$))/g,'');
  const n=Number(raw.replace(',','.'));return Number.isFinite(n)?n:null;
}
function maxProviderDate(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const raw=String(value).trim(),dmy=/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
  if(dmy){const [,day,month,year,hour='0',minute='0',second='0']=dmy,time=Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute),Number(second)),date=new Date(time);if(date.getUTCFullYear()===Number(year)&&date.getUTCMonth()===Number(month)-1&&date.getUTCDate()===Number(day))return date.toISOString()}
  return safeDate(raw);
}
function maxChargedCurrency(value){
  const raw=String(value??'').trim().toUpperCase();
  if(['376','ILS','NIS','₪','ש"ח','ש״ח','שח'].includes(raw))return 'ILS';
  if(['840','USD','$'].includes(raw))return 'USD';
  if(['978','EUR','€'].includes(raw))return 'EUR';
  return raw&&raw.length<=12?raw:'';
}
function maxInstallments(raw={}){
  const comments=String(raw.comments||''),numbers=comments.match(/\d+/g)||[],planType=Math.trunc(Number(raw.planTypeId)||0),planName=String(raw.planName||'');
  if(numbers.length>=2){const number=Number(numbers[0]),total=Number(numbers[1]);if(number>0&&total>0)return {number,total}}
  if([2,3].includes(planType)||/תשלומ/.test(planName))return null;
  return null;
}
function maxMemo(raw={}){
  const comments=text(raw.comments,180),receiver=text(raw.fundsTransferReceiverOrTransfer,120),detail=text(raw.fundsTransferComment,120),base=[comments,receiver].filter(Boolean).join(' ');return detail?[base,detail].filter(Boolean).join(': '):base;
}
function maxRawIdentifier(raw={},installments=null){
  const candidates=[raw?.dealData?.arn,raw?.dealData?.transactionId,raw?.transactionId,raw?.dealId,raw?.referenceNumber].map(value=>text(value,100)).filter(Boolean),base=candidates[0]||'';
  return base&&installments?.number?`${base}_${installments.number}`:base;
}
function maxRawLooksLikeTransaction(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
  const card=text(raw.shortCardNumber,80),purchase=text(raw.purchaseDate,80),merchant=text(raw.merchantName||raw.businessName,220),hasAmount=hasOwn(raw,'actualPaymentAmount')||hasOwn(raw,'originalAmount');
  return !!card&&!!purchase&&hasAmount&&(!!merchant||hasOwn(raw,'planName')||hasOwn(raw,'planTypeId'));
}
function maxWalkTransactionCandidates(value,path='result',out=[],arrayEvidence=[],depth=0){
  if(depth>10||value===null||value===undefined)return {out,arrayEvidence};
  if(Array.isArray(value)){
    const firstObject=value.find(item=>item&&typeof item==='object'&&!Array.isArray(item));
    arrayEvidence.push({path:text(path,180),count:value.length,sampleKeys:firstObject?Object.keys(firstObject).sort().slice(0,50):[]});
    value.forEach((item,index)=>maxWalkTransactionCandidates(item,`${path}[${index}]`,out,arrayEvidence,depth+1));return {out,arrayEvidence};
  }
  if(typeof value!=='object')return {out,arrayEvidence};
  if(maxRawLooksLikeTransaction(value))out.push({raw:value,path:text(path.replace(/\[\d+\]/g,'[]'),180)});
  for(const [key,child] of Object.entries(value))maxWalkTransactionCandidates(child,`${path}.${key}`,out,arrayEvidence,depth+1);
  return {out,arrayEvidence};
}
function maxCandidateKey(raw={}){
  const arn=text(raw?.dealData?.arn||raw?.transactionId||raw?.dealId||'',120);if(arn)return `id:${arn}|${text(raw.comments,80)}`;
  return JSON.stringify([safeSuffix(raw.shortCardNumber),text(raw.purchaseDate,60),text(raw.paymentDate,60),text(raw.merchantName||raw.businessName,120),maxNumber(raw.originalAmount),text(raw.originalCurrency,12),maxNumber(raw.actualPaymentAmount),String(raw.paymentCurrency??''),text(raw.planName,80),text(raw.comments,120)]);
}
function maxForeignSignalLabels(raw={}){
  const labels=[],currencies=[['originalCurrency',maxChargedCurrency(raw.originalCurrency)],['paymentCurrency',maxChargedCurrency(raw.paymentCurrency)],['issuerCurrency',maxChargedCurrency(raw?.dealData?.issuerCurrency)]];
  for(const [field,currency] of currencies)if(currency&&currency!=='ILS')labels.push(`${field}:${currency}`);
  const exchangeRate=maxNumber(raw?.dealData?.exchangeRate),issuerExchangeRate=maxNumber(raw?.dealData?.issuerExchangeRate);if(exchangeRate!==null&&exchangeRate!==0)labels.push('exchangeRate');if(issuerExchangeRate!==null&&issuerExchangeRate!==0)labels.push('issuerExchangeRate');
  const wording=[raw.planName,raw.comments,raw.fundsTransferComment].map(value=>String(value||'')).join(' ');if(/חו["״']?ל|מט["״']?ח|foreign|currency|overseas/i.test(wording))labels.push('providerText');
  return [...new Set(labels)].slice(0,12);
}
function maxOffCyclePayment(raw={}){
  const date=maxProviderDate(raw.paymentDate);if(!date)return false;const day=new Date(date).getUTCDate();return day<7||day>18;
}
function maxCandidateAudit(item={}){
  const raw=item.raw||{},foreignSignals=maxForeignSignalLabels(raw),offCyclePayment=maxOffCyclePayment(raw);
  return {sourcePath:text(item.path,180),accountSuffix:safeSuffix(raw.shortCardNumber),purchaseDate:maxProviderDate(raw.purchaseDate),paymentDate:maxProviderDate(raw.paymentDate),merchantName:text(raw.merchantName||raw.businessName,180),planName:text(raw.planName,120),planTypeId:Number.isFinite(Number(raw.planTypeId))?Math.trunc(Number(raw.planTypeId)):null,categoryId:Number.isFinite(Number(raw.categoryId))?Math.trunc(Number(raw.categoryId)):null,originalAmount:maxNumber(raw.originalAmount),originalCurrency:maxChargedCurrency(raw.originalCurrency)||text(raw.originalCurrency,12),actualPaymentAmount:maxNumber(raw.actualPaymentAmount),paymentCurrency:maxChargedCurrency(raw.paymentCurrency),issuerCurrency:maxChargedCurrency(raw?.dealData?.issuerCurrency),exchangeRate:maxNumber(raw?.dealData?.exchangeRate),issuerExchangeRate:maxNumber(raw?.dealData?.issuerExchangeRate),foreignSignals,offCyclePayment};
}
export function extractMaxTransactionCandidates(data={}){
  const result=data&&typeof data==='object'&&!Array.isArray(data)?data.result:null;if(!result||typeof result!=='object')return {transactions:[],evidence:{resultPresent:false,resultKeys:[],arrayPaths:[],legacyTransactionsCount:0,candidateCount:0,candidatePaths:[],candidateAccountSummary:[],foreignSignalCandidateCount:0,offCycleCandidateCount:0,candidateAuditSamples:[],candidateAuditTruncated:false}};
  const {out,arrayEvidence}=maxWalkTransactionCandidates(result),seen=new Set(),transactions=[],uniqueItems=[],candidatePaths=new Set();
  for(const item of out){const key=maxCandidateKey(item.raw);if(seen.has(key))continue;seen.add(key);transactions.push(item.raw);uniqueItems.push(item);candidatePaths.add(item.path)}
  const accountSummary=new Map(),auditRows=[];
  for(const item of uniqueItems){const audit=maxCandidateAudit(item),accountSuffix=audit.accountSuffix||'',summary=accountSummary.get(accountSuffix)||{accountSuffix,candidateCount:0,foreignSignalCount:0,offCycleCount:0};summary.candidateCount++;if(audit.foreignSignals.length)summary.foreignSignalCount++;if(audit.offCyclePayment)summary.offCycleCount++;accountSummary.set(accountSuffix,summary);if(audit.foreignSignals.length||audit.offCyclePayment)auditRows.push(audit)}
  auditRows.sort((a,b)=>Number(b.foreignSignals.length>0)-Number(a.foreignSignals.length>0)||String(b.paymentDate||'').localeCompare(String(a.paymentDate||''))||String(b.purchaseDate||'').localeCompare(String(a.purchaseDate||'')));
  const candidateAccountSummary=[...accountSummary.values()].sort((a,b)=>String(a.accountSuffix).localeCompare(String(b.accountSuffix)));
  return {transactions,evidence:{resultPresent:true,resultKeys:Object.keys(result).sort().slice(0,80),arrayPaths:arrayEvidence.slice(0,80),legacyTransactionsCount:Array.isArray(result.transactions)?result.transactions.length:0,candidateCount:transactions.length,candidatePaths:[...candidatePaths].sort().slice(0,40),candidateAccountSummary,foreignSignalCandidateCount:candidateAccountSummary.reduce((sum,row)=>sum+row.foreignSignalCount,0),offCycleCandidateCount:candidateAccountSummary.reduce((sum,row)=>sum+row.offCycleCount,0),candidateAuditSamples:auditRows,candidateAuditTruncated:false}};
}
export function normalizeMaxRawTransaction(raw={},categories=new Map()){
  if(!maxRawLooksLikeTransaction(raw))return null;
  const purchaseDate=maxProviderDate(raw.purchaseDate);if(!purchaseDate)return null;
  const paymentRaw=raw.paymentDate,completed=paymentRaw!==null&&paymentRaw!==undefined&&String(paymentRaw).trim()!=='',paymentDate=completed?maxProviderDate(paymentRaw):null,installments=maxInstallments(raw),chargedCurrency=maxChargedCurrency(raw.paymentCurrency),originalCurrency=text(raw.originalCurrency,12),actual=maxNumber(raw.actualPaymentAmount),original=maxNumber(raw.originalAmount),timeEvidence=maxRawTransactionTime(raw),foreignTransaction=maxForeignSignalLabels(raw).length>0;
  return {identifier:maxRawIdentifier(raw,installments),type:installments?'installments':'normal',date:purchaseDate,processedDate:completed?paymentDate:null,transactionDate:purchaseDate,transactionTime:timeEvidence.time,originalAmount:original===null?null:creditDebitAmount(original),originalCurrency,chargedAmount:actual===null?null:creditDebitAmount(actual),...(chargedCurrency?{chargedCurrency}:{}),foreignTransaction,description:text(raw.merchantName||raw.businessName||'עסקת MAX',220)||'עסקת MAX',memo:maxMemo(raw),category:categories.get(Number(raw.categoryId))||undefined,installments,status:completed?'completed':'pending',rawTransaction:raw};
}
function maxCategories(data={}){const map=new Map(),rows=Array.isArray(data?.result)?data.result:[];for(const row of rows){const id=Number(row?.id),name=text(row?.name,160);if(Number.isFinite(id)&&name)map.set(id,name)}return map}
function maxHomeCards(data={}){
  const rows=Array.isArray(data?.Result?.UserCards?.Cards)?data.Result.UserCards.Cards:[],cards=new Map();
  for(const row of rows){const accountNumber=safeSuffix(row?.Last4Digits),limit=maxNumber(row?.CreditLimit),open=maxNumber(row?.OpenToBuy),cycle=Array.isArray(row?.CycleSummary)?row.CycleSummary:[],shekel=cycle.find(item=>String(item?.CurrencySymbol||'').includes('₪')),balance=limit!==null&&open!==null?Math.round((-(limit-open))*100)/100:null;if(accountNumber)cards.set(accountNumber,{accountNumber,balance,balanceDate:maxProviderDate(shekel?.Date),cardFrame:limit,availableCredit:open})}
  return cards;
}
function maxResponseEvidence(profileId,month,evidence,discoveredCardCount,excludedAccountNumbers){const excluded=new Set([...excludedAccountNumbers].map(safeSuffix).filter(Boolean)),candidateAccountSummary=(Array.isArray(evidence.candidateAccountSummary)?evidence.candidateAccountSummary:[]).filter(row=>!excluded.has(safeSuffix(row?.accountSuffix))),visibleAuditRows=(Array.isArray(evidence.candidateAuditSamples)?evidence.candidateAuditSamples:[]).filter(row=>!excluded.has(safeSuffix(row?.accountSuffix))),candidateAuditSamples=visibleAuditRows.slice(0,80);return {kind:'providerResponseShape',profileId,month,resultPresent:evidence.resultPresent===true,resultKeys:evidence.resultKeys||[],arrayPaths:evidence.arrayPaths||[],legacyTransactionsCount:Number(evidence.legacyTransactionsCount)||0,candidateCount:Number(evidence.candidateCount)||0,candidatePaths:evidence.candidatePaths||[],candidateAccountSummary,foreignSignalCandidateCount:candidateAccountSummary.reduce((sum,row)=>sum+(Number(row?.foreignSignalCount)||0),0),offCycleCandidateCount:candidateAccountSummary.reduce((sum,row)=>sum+(Number(row?.offCycleCount)||0),0),candidateAuditSamples,candidateAuditTruncated:visibleAuditRows.length>candidateAuditSamples.length,discoveredCardCount:Number(discoveredCardCount)||0,excludedAccountSuffixes:[...excluded].sort()}}
function maxMonthlyAccounts({homeCards,rawByCard,profile,startDate,futureMonths,now,excludedAccountNumbers}){
  const allNumbers=new Set([...homeCards.keys(),...rawByCard.keys()]),accounts=[];
  for(const accountNumber of [...allNumbers].sort()){
    if(excludedAccountNumbers.has(accountNumber)){continue}
    const card=homeCards.get(accountNumber)||{},txns=rawByCard.get(accountNumber)||[];
    accounts.push(genericMonthlyAccount({...card,accountNumber,txns},profile.provider,{startDate,futureMonths,now},MAX_PROVIDER_SCHEMA_VERSION));
  }
  return accounts;
}
async function scrapeMaxDirect(adapter){
  const profile=adapter.profile,scope=creditSyncScope({syncMode:adapter.syncMode,now:adapter.now()}),startDate=scope.startDate,plan=buildCreditMonthPlan({startDate,futureMonths:scope.futureMonths,now:adapter.now()}),scraper=adapter.createScraper({companyId:adapter.companyId,startDate,futureMonthsToScrape:scope.futureMonths,combineInstallments:false,showBrowser:adapter.interactive,executablePath:adapter.browserPath,navigationRetryCount:1,defaultTimeout:45_000,timeout:90_000,additionalTransactionInformation:false,includeRawTransaction:true,outputData:{enableTransactionsFilterByDate:false}}),started=Date.now();let initialized=false,success=false;
  try{
    await scraper.initialize();initialized=true;adapter.event({stage:'BrowserInit'});
    const loginStarted=Date.now();let loginResult;try{loginResult=await scraper.login(profile.credentials)}catch(error){const failure=creditLoginThrownScrapeFailure(error,profile);adapter.event({stage:failure.stage||'LoginFlow',durationMs:Date.now()-loginStarted,errorClass:failure.code});throw failure}
    if(!loginResult?.success)throw creditScrapeFailure(loginResult,profile);adapter.event({stage:'Login',durationMs:Date.now()-loginStarted});
    const page=scraper?.page;if(!page||typeof page.evaluate!=='function')throw safeError('מחבר MAX המותקן אינו חושף page לאחר ההתחברות.','CREDIT_CONNECTOR_COMPATIBILITY_ERROR',{stage:'MaxData'});
    let categories=new Map();try{categories=maxCategories(await maxGetJsonWithinPage(page,MAX_CATEGORIES_URL,'MaxCategories',adapter.now().getTime()))}catch(error){adapter.event({stage:'MaxCategories',errorClass:error?.code||'CREDIT_PROVIDER_DATA_ERROR',httpStatus:error?.httpStatus||0})}
    const homeData=await maxGetJsonWithinPage(page,MAX_HOME_PAGE_DATA_URL,'MaxHomeCards',adapter.now().getTime()),homeCards=maxHomeCards(homeData),rawByCard=new Map(),dataDiagnostics=[];
    for(const entry of plan){
      const monthStarted=Date.now(),data=await maxGetJsonWithinPage(page,maxTransactionsUrl(entry.month),`MaxTransactions ${entry.month}`,adapter.now().getTime()),parsed=extractMaxTransactionCandidates(data||{});
      dataDiagnostics.push(maxResponseEvidence(profile.profileId,entry.month,parsed.evidence,homeCards.size,adapter.excludedAccountNumbers));
      adapter.event({stage:'MaxTransactions',month:entry.month,durationMs:Date.now()-monthStarted});
      for(const raw of parsed.transactions){const tx=normalizeMaxRawTransaction(raw,categories),accountNumber=safeSuffix(raw?.shortCardNumber);if(!tx||!accountNumber)continue;if(!rawByCard.has(accountNumber))rawByCard.set(accountNumber,[]);rawByCard.get(accountNumber).push(tx)}
    }
    const discoveredNumbers=new Set([...homeCards.keys(),...rawByCard.keys()]);
    if(!discoveredNumbers.size){
      // Preserve Last Known Good and, crucially, return the sanitized response-shape
      // evidence to the diagnostic exporter. Throwing here would hide the exact
      // authenticated MAX shape that is needed when their private API changes.
      const attemptedAt=adapter.now().toISOString(),schemaFailure=safeError('MAX אישרה את הכניסה אך לא הוחזרה אפילו רשומת כרטיס אחת מנתוני הבית או מפירוט העסקאות. הסנכרון לא יסומן כהצלחה ריקה.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'MaxCards'}),error=coverageError(profile,schemaFailure,{at:attemptedAt,component:'core_transactions',severity:'error'});
      adapter.event({browserEngine:'chromium',stage:'MaxCards',durationMs:Date.now()-started,errorClass:schemaFailure.code});
      return {...creditProfilePublic(profile),syncedAt:null,attemptedAt,coreComplete:false,accounts:[],errors:[error],_dataDiagnostics:dataDiagnostics};
    }
    for(const accountNumber of discoveredNumbers)if(adapter.excludedAccountNumbers.has(accountNumber))adapter.event({stage:'CardExcluded',accountSuffix:safeSuffix(accountNumber)});
    const accounts=maxMonthlyAccounts({homeCards,rawByCard,profile,startDate,futureMonths:scope.futureMonths,now:adapter.now(),excludedAccountNumbers:adapter.excludedAccountNumbers}),rawSamples=[];
    for(const accountNumber of discoveredNumbers){if(adapter.excludedAccountNumbers.has(accountNumber))continue;const rows=rawByCard.get(accountNumber)||[],chosen=rows.find(tx=>tx?.rawTransaction&&maxRawTransactionTime(tx.rawTransaction).candidates.length)||rows.find(tx=>tx?.rawTransaction);if(chosen?.rawTransaction)rawSamples.push({profileId:profile.profileId,accountNumber,rawTransaction:chosen.rawTransaction})}
    dataDiagnostics.push(...rawSamples);const syncedAt=adapter.now().toISOString();success=true;adapter.event({stage:'Complete',durationMs:Date.now()-started});return {...creditProfilePublic(profile),syncedAt,attemptedAt:syncedAt,coreComplete:true,accounts,errors:[],_dataDiagnostics:dataDiagnostics};
  }catch(error){const failure=creditThrownScrapeFailure(error,profile);if(!failure.browserEngine)failure.browserEngine='chromium';adapter.event({browserEngine:'chromium',stage:failure?.stage||'Scrape',durationMs:Date.now()-started,errorClass:failure?.code,httpStatus:failure?.httpStatus,providerStatus:failure?.providerStatus,providerReturnCode:failure?.providerReturnCode});throw failure}
  finally{if(initialized)try{await scraper.terminate(success)}catch{}}
}

function transactionBillingDate(tx){return tx?.processedDate||''}
function transactionMonth(tx){const value=transactionBillingDate(tx);return value&&/^\d{4}-\d{2}/.test(String(value))?String(value).slice(0,7):''}
function enrichMaxTransaction(tx={}){
  const raw=tx?.rawTransaction&&typeof tx.rawTransaction==='object'?tx.rawTransaction:null,timeEvidence=raw?maxRawTransactionTime(raw):null;
  return {...tx,...(hasOwn(raw,'actualPaymentAmount')?{chargedAmount:creditDebitAmount(raw.actualPaymentAmount)}:{}),...(hasOwn(raw,'originalAmount')?{originalAmount:creditDebitAmount(raw.originalAmount)}:{}),transactionTime:tx?.transactionTime||timeEvidence?.time||''};
}
function maxRawDiagnosticSamples(accounts,profileId){
  const samples=[];
  for(const account of Array.isArray(accounts)?accounts:[]){
    const rows=(Array.isArray(account?.txns)?account.txns:[]).filter(tx=>tx?.rawTransaction&&typeof tx.rawTransaction==='object');
    if(!rows.length)continue;
    const chosen=rows.find(tx=>maxRawTransactionTime(tx.rawTransaction).candidates.length)||rows[0];
    samples.push({profileId,accountNumber:account?.accountNumber||'',rawTransaction:chosen.rawTransaction});
  }
  return samples;
}
function genericMonthlyAccount(account,provider,{startDate,futureMonths,now},schemaVersion=CREDIT_PROVIDER_SCHEMA_VERSION){
  const source=provider==='max'&&Array.isArray(account?.txns)?{...account,txns:account.txns.map(enrichMaxTransaction)}:account;
  const normalized=normalizeCreditScrapeAccount(source,provider),plan=buildCreditMonthPlan({startDate,futureMonths,now}),byMonth=new Map(plan.map(entry=>[entry.month,[]])),pending=[],pendingSeen=new Set(),unassigned=[],cutoff=Date.parse(startDate);
  for(const tx of normalized.txns){
    // Provider status is authoritative. MAX and Isracard-group DigitalV3 intentionally set
    // processedDate on approvals to the purchase date, so processedDate must never promote
    // a pending authorization into a finalized billing-month transaction.
    if(tx.status==='pending'){
      const key=tx.id?`${tx.id}|${tx.date||''}|${tx.chargedAmount??tx.originalAmount??''}`:'';
      if(!key||!pendingSeen.has(key)){pending.push(tx);if(key)pendingSeen.add(key)}
      continue;
    }
    const billingDate=transactionBillingDate(tx),billingTime=Date.parse(billingDate),key=transactionMonth(tx);
    if(Number.isFinite(cutoff)&&Number.isFinite(billingTime)&&billingTime<cutoff)continue;
    if(byMonth.has(key))byMonth.get(key).push(tx);else if(!key)unassigned.push(tx);
  }
  return normalizeCreditScrapeAccount({...normalized,txns:undefined,pendingTransactions:pending,pendingStatus:'success',pendingFetchedAt:now.toISOString(),unassignedTransactions:unassigned,months:plan.map(entry=>monthlyCoverageSuccess(entry,byMonth.get(entry.month),now.toISOString(),schemaVersion))},provider);
}

export class GenericScraperAdapter extends CreditProviderAdapter {
  constructor(options={}){super(options);Object.assign(this,{createScraper:options.createScraper,CompanyTypes:options.CompanyTypes,companyId:options.companyId,browserPath:options.browserPath,interactive:!!options.interactive,preparePage:options.preparePage})}
  async scrape(){const profile=this.profile,scope=creditSyncScope({syncMode:this.syncMode,now:this.now()}),startDate=scope.startDate,scraper=this.createScraper({companyId:this.companyId,startDate,futureMonthsToScrape:scope.futureMonths,combineInstallments:false,showBrowser:this.interactive,executablePath:this.browserPath,navigationRetryCount:1,defaultTimeout:45_000,timeout:90_000,additionalTransactionInformation:false,includeRawTransaction:this.profile?.provider==='max',outputData:{enableTransactionsFilterByDate:false},...(this.preparePage?{preparePage:this.preparePage}:{})}),started=Date.now();try{const result=await scraper.scrape(profile.credentials);if(!result?.success)throw creditScrapeFailure(result,profile);const syncedAt=this.now().toISOString(),rawAccounts=Array.isArray(result.accounts)?result.accounts:[],includedAccounts=rawAccounts.filter(account=>{const accountNumber=text(account?.accountNumber,80);if(!this.excludedAccountNumbers.has(accountNumber))return true;this.event({browserEngine:'chromium',stage:'CardExcluded',accountSuffix:safeSuffix(accountNumber)});return false}),dataDiagnostics=profile.provider==='max'?maxRawDiagnosticSamples(includedAccounts,profile.profileId):[];this.event({browserEngine:'chromium',stage:'Complete',durationMs:Date.now()-started});return {...creditProfilePublic(profile),syncedAt,attemptedAt:syncedAt,coreComplete:true,accounts:includedAccounts.map(account=>genericMonthlyAccount(account,profile.provider,{startDate,futureMonths:scope.futureMonths,now:this.now()})),errors:[],_dataDiagnostics:dataDiagnostics}}catch(error){const failure=creditThrownScrapeFailure(error,profile);if(!failure.browserEngine)failure.browserEngine='chromium';this.event({browserEngine:'chromium',stage:failure?.stage||'Scrape',durationMs:Date.now()-started,errorClass:failure?.code,httpStatus:failure?.httpStatus,providerStatus:failure?.providerStatus,providerReturnCode:failure?.providerReturnCode});throw failure}}
}
export class MaxAdapter extends CreditProviderAdapter {
  constructor(options={}){super(options);this.connectorVersion=MAX_PROVIDER_SCHEMA_VERSION;Object.assign(this,{createScraper:options.createScraper,CompanyTypes:options.CompanyTypes,companyId:options.companyId,browserPath:options.browserPath,interactive:!!options.interactive})}
  async scrape(){return scrapeMaxDirect(this)}
}

class IsracardGroupDigitalV3Adapter extends CreditProviderAdapter {
  constructor(options={},schemaVersion='',scrapeImpl=null){
    super(options);this.connectorVersion=schemaVersion;Object.assign(this,{browserPath:options.browserPath,identityProbeUrl:options.identityProbeUrl||'',interactive:!!options.interactive,identityDir:options.identityDir,allowCamoufoxFallback:options.allowCamoufoxFallback!==false,digitalScrapeImpl:scrapeImpl});
  }
  async scrape(){
    const profile=this.profile,scope=creditSyncScope({syncMode:this.syncMode,now:this.now()}),started=Date.now();
    try{
      const result=await this.digitalScrapeImpl({credentials:profile.credentials,browserPath:this.browserPath,identityProbeUrl:this.identityProbeUrl,interactive:this.interactive,startDate:scope.startDate,futureMonthsToScrape:scope.futureMonths,excludedAccountNumbers:[...this.excludedAccountNumbers],onDiagnostic:event=>this.event({browserEngine:'chromium',...event}),now:this.now});
      if(!result?.success)throw safeError(`${profile.label||profile.provider} DigitalV3 לא השלים את הסנכרון.`,'CREDIT_PROVIDER_DATA_ERROR',{stage:'DigitalV3'});
      const syncedAt=this.now().toISOString();
      this.event({browserEngine:'chromium',stage:'Complete',durationMs:Date.now()-started});
      const rawAccounts=(Array.isArray(result.accounts)?result.accounts:[]).filter(account=>{const accountNumber=text(account?.accountNumber,80);if(!this.excludedAccountNumbers.has(accountNumber))return true;this.event({browserEngine:'chromium',stage:'CardExcluded',accountSuffix:safeSuffix(accountNumber)});return false}),dataDiagnostics=(Array.isArray(result?._dataDiagnostics)?result._dataDiagnostics:[]).filter(row=>!this.excludedAccountNumbers.has(text(row?.accountNumber,80))).map(row=>({...row,profileId:profile.profileId}));return {...creditProfilePublic(profile),syncedAt,attemptedAt:syncedAt,coreComplete:true,accounts:rawAccounts.map(account=>genericMonthlyAccount(account,profile.provider,{startDate:scope.startDate,futureMonths:scope.futureMonths,now:this.now()},this.connectorVersion)),errors:[],_dataDiagnostics:dataDiagnostics};
    }catch(error){
      const failure=creditThrownScrapeFailure(error,profile);if(!failure.browserEngine)failure.browserEngine='chromium';
      this.event({browserEngine:'chromium',stage:failure?.stage||'Scrape',durationMs:Date.now()-started,errorClass:failure?.code,httpStatus:failure?.httpStatus,providerStatus:failure?.providerStatus,providerReturnCode:failure?.providerReturnCode});
      if(!this.allowCamoufoxFallback||!isCamoufoxRetryableNativeFailure(failure)||!camoufoxCreditSupported(profile.provider))throw failure;
      return this.scrapeCamoufox();
    }
  }
  async scrapeCamoufox(){const scope=creditSyncScope({syncMode:this.syncMode,now:this.now()});return camoufoxProfileResult(this,{provider:this.profile.provider,credentials:this.profile.credentials,startDate:scope.startDate,futureMonthsToScrape:scope.futureMonths,interactive:this.interactive,identityDir:this.identityDir,excludedAccountNumbers:[...this.excludedAccountNumbers],onDiagnostic:event=>this.event({browserEngine:'camoufox',...event}),correlationId:this.correlationId,now:this.now})}
}

export class IsracardAdapter extends IsracardGroupDigitalV3Adapter {
  constructor(options={}){super(options,ISRACARD_DIGITAL_V3_SCHEMA_VERSION,options.isracardScrapeImpl||scrapeIsracardDigitalV3)}
}

export class AmexAdapter extends IsracardGroupDigitalV3Adapter {
  constructor(options={}){super(options,AMEX_DIGITAL_V3_SCHEMA_VERSION,options.amexScrapeImpl||scrapeAmexDigitalV3)}
}

async function camoufoxProfileResult(adapter,options){
  try{const result=await scrapeIsracardFamilyWithCamoufox(options),profile=adapter.profile,syncedAt=result.coreComplete===false?null:adapter.now().toISOString(),rawAccounts=(Array.isArray(result.accounts)?result.accounts:[]).filter(account=>!adapter.excludedAccountNumbers.has(text(account?.accountNumber,80))),dataDiagnostics=(Array.isArray(result?._dataDiagnostics)?result._dataDiagnostics:[]).filter(row=>!adapter.excludedAccountNumbers.has(text(row?.accountNumber,80))).map(row=>({...row,profileId:profile.profileId}));return {...creditProfilePublic(profile),syncedAt,attemptedAt:adapter.now().toISOString(),coreComplete:result.coreComplete!==false,accounts:rawAccounts.map(account=>normalizeCreditScrapeAccount(account,profile.provider)),errors:(Array.isArray(result.errors)?result.errors:[]).map(error=>({...error,profileId:profile.profileId,provider:profile.provider,label:profile.label,browserEngine:'camoufox'})),_dataDiagnostics:dataDiagnostics}}catch(error){const failure=creditThrownScrapeFailure(error,adapter.profile);if(!failure.browserEngine)failure.browserEngine='camoufox';throw failure}
}

export function createCreditProviderAdapter({profile,CompanyTypes,createScraper,browserPath,identityProbeUrl='',interactive=false,identityDir='',onDiagnostic=()=>{},correlationId='',now=()=>new Date(),fetchImpl=globalThis.fetch,requestDelayMs,syncMode=CREDIT_SYNC_MODE_QUICK,excludedAccountNumbers=[],allowCamoufoxFallback=true,isracardScrapeImpl=null,amexScrapeImpl=null}={}){
  const common={profile,CompanyTypes,createScraper,browserPath,identityProbeUrl,interactive,identityDir,onDiagnostic,correlationId,now,fetchImpl,requestDelayMs,syncMode,excludedAccountNumbers,allowCamoufoxFallback,isracardScrapeImpl,amexScrapeImpl};
  if(profile.provider==='visaCal')return new VisaCalAdapter(common);
  if(profile.provider==='max')return new MaxAdapter({...common,companyId:CompanyTypes.max});
  if(profile.provider==='isracard')return new IsracardAdapter({...common,companyId:CompanyTypes.isracard});
  if(profile.provider==='amex')return new AmexAdapter({...common,companyId:CompanyTypes.amex});
  throw safeError('חברת האשראי שנבחרה אינה נתמכת ב־Credit Connector v2.','CREDIT_PROVIDER_UNAVAILABLE');
}
