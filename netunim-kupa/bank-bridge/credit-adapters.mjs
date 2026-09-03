import {
  CREDIT_FUTURE_MONTHS,
  CREDIT_HISTORY_DAYS,
  creditProfilePublic,
  creditScrapeFailure,
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

export const CREDIT_CONNECTOR_CONTRACT_VERSION=2;
export const CREDIT_PROVIDER_SCHEMA_VERSION='israeli-bank-scrapers-6.9.0';
export const VISA_CAL_PROVIDER_SCHEMA_VERSION='visa-cal-6.9.0-netunim-v2';
export const CREDIT_CORE_FUTURE_MONTHS=1;

const CAL_ENDPOINTS={
  frames:'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus',
  pending:'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests',
  transactions:'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails',
};
const CAL_HEADERS={
  'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Origin:'https://digital-web.cal-online.co.il',
  Referer:'https://digital-web.cal-online.co.il',
  'Accept-Language':'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site':'same-site',
  'Sec-Fetch-Mode':'cors',
  'Sec-Fetch-Dest':'empty',
};
const CAL_TRANSACTION_TYPES={regular:'5',credit:'6',installments:'8',standingOrder:'9'};

function text(value,max=240){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function two(value){return String(value).padStart(2,'0')}
function monthKey(value){const d=new Date(value);return `${d.getUTCFullYear()}-${two(d.getUTCMonth()+1)}`}
function monthStart(value){const d=new Date(value);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1))}
function addMonths(value,count){const d=monthStart(value);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+count,1))}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function safeDate(value){if(!value)return null;const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null}
function safeError(message,code,extra={}){const e=new Error(message);e.code=code;Object.assign(e,extra);return e}
function safeSuffix(value){const digits=String(value??'').replace(/\D/g,'');return digits?digits.slice(-4):text(value,4)}
function errorFetchStatus(error){
  const code=String(error?.code||'');
  if(code==='CREDIT_PROVIDER_SCHEMA_ERROR'||code==='CREDIT_PROVIDER_RESPONSE_NOT_JSON')return 'schema_error';
  if(code==='CREDIT_PROVIDER_NETWORK_ERROR')return 'network_error';
  return 'provider_error';
}
function diagnostic(onDiagnostic,event){try{onDiagnostic?.(event)}catch{}}

export function creditStartDate(now=new Date()){
  const d=new Date(now);d.setUTCDate(d.getUTCDate()-CREDIT_HISTORY_DAYS);return d;
}

export function buildCreditMonthPlan({startDate=creditStartDate(),futureMonths=CREDIT_FUTURE_MONTHS,now=new Date()}={}){
  const start=monthStart(startDate),current=monthStart(now),coreEnd=addMonths(current,CREDIT_CORE_FUTURE_MONTHS),end=addMonths(current,Math.max(CREDIT_CORE_FUTURE_MONTHS,Math.trunc(Number(futureMonths)||0))),months=[];
  for(let cursor=start;cursor<=end;cursor=addMonths(cursor,1))months.push({month:monthKey(cursor),tier:cursor<=coreEnd?'core':'forecast'});
  return months;
}

export function parseRetryAfter(value,now=Date.now()){
  const raw=String(value??'').trim();if(!raw)return null;
  const seconds=Number(raw);let time=Number.isFinite(seconds)&&seconds>=0?Number(now)+seconds*1000:Date.parse(raw);
  if(!Number.isFinite(time))return null;
  time=Math.max(Number(now)||Date.now(),time);return new Date(time).toISOString();
}

export function classifyCreditHttpResponse({status=0,text:body='',stage='',retryAfter='',now=Date.now()}={}){
  const httpStatus=Number(status)||0,responseText=String(body||''),extra={stage,httpStatus};
  if(httpStatus===429)return safeError('חברת האשראי הגבילה זמנית את קצב הבקשות. לא יתבצע ניסיון נוסף לפני מועד ההמתנה של החברה.','CREDIT_PROVIDER_RATE_LIMITED',{...extra,retryAfterAt:parseRetryAfter(retryAfter,now)});
  if(httpStatus===403)return safeError('חברת האשראי חסמה את בקשת האוטומציה של הסשן הנוכחי. לא יתבצע ניסיון נוסף במהלך הסנכרון.','CREDIT_AUTOMATION_BLOCKED',extra);
  if(httpStatus<200||httpStatus>=300)return safeError(`חברת האשראי החזירה HTTP ${httpStatus||'לא ידוע'} בשלב ${stage||'לא ידוע'}.`,'CREDIT_PROVIDER_HTTP_ERROR',extra);
  if(/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(responseText))return safeError('חברת האשראי החזירה HTML במקום JSON.','CREDIT_PROVIDER_RESPONSE_NOT_JSON',extra);
  return null;
}

async function postJson(fetchImpl,url,data,{headers={},stage='',timeoutMs=60_000,now=Date.now()}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let response;
    try{response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data),signal:controller.signal})}
    catch(error){throw safeError(error?.name==='AbortError'?'קריאת הנתונים מחברת האשראי לא הסתיימה בזמן.':'החיבור לשירות הנתונים של חברת האשראי נקטע.','CREDIT_PROVIDER_NETWORK_ERROR',{stage,causeName:text(error?.name,40)})}
    const responseText=await response.text(),failure=classifyCreditHttpResponse({status:response.status,text:responseText,stage,retryAfter:response.headers?.get?.('retry-after')||'',now});
    if(failure)throw failure;
    try{return responseText?JSON.parse(responseText):null}catch{throw safeError('חברת האשראי החזירה תשובה שאינה JSON תקין.','CREDIT_PROVIDER_RESPONSE_NOT_JSON',{stage,httpStatus:Number(response.status)||0})}
  }finally{clearTimeout(timer)}
}

function shiftMonthDate(value,delta){
  const iso=safeDate(value);if(!iso)return null;const d=new Date(iso),first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+delta,1)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(d.getUTCDate(),last))).toISOString();
}
function calCurrency(value){const v=text(value,12);return ['ש"ח','ש״ח','NIS'].includes(v)?'ILS':v}

export function normalizeVisaCalTransaction(transaction={}){
  const pending=transaction.debCrdDate===undefined||transaction.debCrdDate===null,numOfPayments=Number(pending?transaction.numberOfPayments:transaction.numOfPayments),part=Number(pending?1:transaction.curPaymentNum),installments=numOfPayments>0?{number:Math.max(1,Math.trunc(part)||1),total:Math.trunc(numOfPayments)}:null,purchaseDate=safeDate(transaction.trnPurchaseDate),date=installments?shiftMonthDate(purchaseDate,installments.number-1):purchaseDate;
  const chargedBase=Number(pending?transaction.trnAmt:transaction.amtBeforeConvAndIndex),originalBase=Number(transaction.trnAmt),credit=String(transaction.trnTypeCode)===CAL_TRANSACTION_TYPES.credit;
  return normalizeCreditScrapeTransaction({
    identifier:pending?'':transaction.trnIntId,
    type:[CAL_TRANSACTION_TYPES.regular,CAL_TRANSACTION_TYPES.standingOrder].includes(String(transaction.trnTypeCode))?'normal':'installments',
    status:pending?'pending':'completed',date,processedDate:pending?purchaseDate:safeDate(transaction.debCrdDate),transactionDate:purchaseDate,
    originalAmount:Number.isFinite(originalBase)?originalBase*(credit?1:-1):null,originalCurrency:calCurrency(transaction.trnCurrencySymbol),
    chargedAmount:Number.isFinite(chargedBase)?-chargedBase:null,chargedCurrency:pending?'':calCurrency(transaction.debCrdCurrencySymbol),
    description:text(transaction.merchantName,220)||'עסקת אשראי',memo:text(transaction.transTypeCommentDetails,260),installments,
  });
}

export function parseVisaCalMonthData(data,{startDate=null}={}){
  if(data?.statusCode!==1)throw safeError(text(data?.title,160)||'כאל לא אישרה את קריאת החודש.','CREDIT_PROVIDER_DATA_ERROR',{stage:'Transactions'});
  if(!data?.result||!Array.isArray(data.result.bankAccounts))throw safeError('כאל החזירה מבנה חודשי שאינו תואם לחוזה המחבר.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Transactions'});
  const rows=[];
  for(const account of data.result.bankAccounts){
    const regular=Array.isArray(account?.debitDates)?account.debitDates:[],immediate=Array.isArray(account?.immidiateDebits?.debitDays)?account.immidiateDebits.debitDays:[];
    for(const debitDay of [...regular,...immediate]){
      if(!Array.isArray(debitDay?.transactions))throw safeError('כאל החזירה debit day ללא מערך עסקאות.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Transactions'});
      for(const raw of debitDay.transactions){const tx=normalizeVisaCalTransaction(raw);if(!startDate||!tx.date||Date.parse(tx.date)>=Date.parse(startDate))rows.push(tx)}
    }
  }
  return rows;
}

function parseVisaCalPending(data){
  if(data?.statusCode===96)return [];
  if(data?.statusCode!==1)throw safeError(text(data?.title,160)||'כאל לא אישרה את קריאת העסקאות הממתינות.','CREDIT_PROVIDER_DATA_ERROR',{stage:'Pending'});
  if(!Array.isArray(data?.result?.cardsList))throw safeError('כאל החזירה מבנה עסקאות ממתינות שאינו תואם לחוזה המחבר.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Pending'});
  return data.result.cardsList.flatMap(card=>Array.isArray(card?.authDetalisList)?card.authDetalisList:[]).map(normalizeVisaCalTransaction);
}

function hasOwn(value,key){return !!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key)}
function visaCalFrameProviderError(data){
  if(!data||typeof data!=='object'||Array.isArray(data))return false;
  const resultMissing=data.result===undefined||data.result===null,statusCodeError=hasOwn(data,'statusCode')&&Number(data.statusCode)!==1,status=data.status,statusError=hasOwn(data,'status')&&(status===false||(typeof status==='number'&&![0,1,200].includes(status))||(typeof status==='string'&&!['','0','1','200','ok','success','successful'].includes(status.trim().toLowerCase()))),titledMissing=resultMissing&&(text(data.title,1)||text(data.statusTitle,1));
  return statusCodeError||statusError||!!titledMissing;
}
function frameUnavailable(){return safeError('כאל לא סיפקה נתון מסגרת עבור הכרטיס; העסקאות יישמרו ונתון המסגרת האחרון, אם קיים, יישאר כ־Last Known Good.','CREDIT_FRAMES_UNAVAILABLE',{stage:'Frames'})}
function validateFrameNumber(value,name){if(value!==undefined&&value!==null&&typeof value!=='number')throw safeError(`כאל החזירה ${name} מסוג שאינו תואם לחוזה Frames 6.9.0.`,'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'})}
function validateFrameDate(value,name){if(value!==undefined&&value!==null&&typeof value!=='string')throw safeError(`כאל החזירה ${name} מסוג שאינו תואם לחוזה Frames 6.9.0.`,'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'})}
function validateFrameGroup(group,name){
  if(group===undefined||group===null)return null;
  if(typeof group!=='object'||Array.isArray(group))throw safeError(`כאל החזירה קבוצת ${name} שאינה אובייקט.`,'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'});
  validateFrameNumber(group.nextTotalDebitForAccount,`${name}.nextTotalDebitForAccount`);validateFrameDate(group.nextTotalDebitDateForAccount,`${name}.nextTotalDebitDateForAccount`);validateFrameNumber(group.frameLimitForCardAmount,`${name}.frameLimitForCardAmount`);
  if(group.cardLevelFrames!==undefined&&group.cardLevelFrames!==null&&!Array.isArray(group.cardLevelFrames))throw safeError(`כאל החזירה ${name}.cardLevelFrames שאינו מערך.`,'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'});
  for(const frame of Array.isArray(group.cardLevelFrames)?group.cardLevelFrames:[]){if(!frame||typeof frame!=='object'||Array.isArray(frame)||typeof frame.cardUniqueId!=='string')throw safeError(`כאל החזירה רשומת cardLevelFrames לא תקינה בקבוצת ${name}.`,'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'});validateFrameNumber(frame.nextTotalDebit,`${name}.cardLevelFrames.nextTotalDebit`);validateFrameDate(frame.nextDebitDate,`${name}.cardLevelFrames.nextDebitDate`)}
  return group;
}

export function parseVisaCalFrame(data,card={}){
  if(visaCalFrameProviderError(data))throw safeError('כאל החזירה שגיאת provider מפורשת בקריאת Frames.','CREDIT_PROVIDER_DATA_ERROR',{stage:'Frames'});
  if(data?.result===undefined||data?.result===null)return {balance:null,balanceDate:null,cardType:'',cardFrame:null,frameStatus:'missing',frameFetchStatus:'unavailable',warning:frameUnavailable()};
  if(typeof data.result!=='object'||Array.isArray(data.result))throw safeError('כאל החזירה result מסוג שאינו תואם לחוזה Frames 6.9.0.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'Frames'});
  const bankGroup=validateFrameGroup(data.result.bankIssuedCards,'bankIssuedCards'),calGroup=validateFrameGroup(data.result.calIssuedCards,'calIssuedCards'),bankFrame=bankGroup?.cardLevelFrames?.find(item=>item.cardUniqueId===card.cardUniqueId),calFrame=calGroup?.cardLevelFrames?.find(item=>item.cardUniqueId===card.cardUniqueId);
  let frame=bankFrame||calFrame,group=bankFrame?bankGroup:calFrame?calGroup:null,cardType=bankFrame?'bankIssued':calFrame?'companyIssued':'';
  if(!group&&bankGroup&&!calGroup){group=bankGroup;cardType='bankIssued'}else if(!group&&calGroup&&!bankGroup){group=calGroup;cardType='companyIssued'}
  if(!group)return {balance:null,balanceDate:null,cardType:'',cardFrame:null,frameStatus:'missing',frameFetchStatus:'unavailable',warning:frameUnavailable()};
  const amount=frame?.nextTotalDebit??group.nextTotalDebitForAccount,date=frame?.nextDebitDate??group.nextTotalDebitDateForAccount,limit=group.frameLimitForCardAmount,hasData=amount!==undefined&&amount!==null||date!==undefined&&date!==null||limit!==undefined&&limit!==null;
  if(!hasData)return {balance:null,balanceDate:null,cardType,cardFrame:null,frameStatus:'missing',frameFetchStatus:'unavailable',warning:frameUnavailable()};
  return {balance:amount===undefined||amount===null?null:-amount,balanceDate:safeDate(date),cardType,cardFrame:limit===undefined||limit===null?null:limit,frameStatus:'fresh',frameFetchStatus:'success',warning:null};
}

function monthlyCoverageFailure(plan,error,at){return {month:plan.month,tier:plan.tier,fetchStatus:errorFetchStatus(error),fetchedAt:null,transactions:[],providerSchemaVersion:VISA_CAL_PROVIDER_SCHEMA_VERSION,lastErrorCode:String(error?.code||'CREDIT_PROVIDER_DATA_ERROR'),lastErrorAt:at}}
function monthlyCoverageSuccess(plan,transactions,at,schemaVersion=VISA_CAL_PROVIDER_SCHEMA_VERSION){return {month:plan.month,tier:plan.tier,fetchStatus:'success',fetchedAt:at,transactions,providerSchemaVersion:schemaVersion,lastErrorCode:'',lastErrorAt:null}}
function coverageError(profile,error,{month='',tier='',accountNumber='',at=new Date().toISOString(),component='',severity=''}={}){const stage=String(error?.stage||'Transactions').slice(0,80),resolvedComponent=component||(tier==='core'?'core_transactions':tier==='forecast'?'forecast_transactions':stage==='Frames'?'frames':stage==='Pending'?'pending':'profile'),resolvedSeverity=severity||(resolvedComponent==='core_transactions'?'error':'warning');return {profileId:profile.profileId,provider:profile.provider,label:profile.label,code:String(error?.code||'CREDIT_PROVIDER_DATA_ERROR'),stage,httpStatus:Number(error?.httpStatus)||0,message:error?.message||'קריאת נתוני האשראי נכשלה',at,originalFailureAt:error?.originalFailureAt||at,retryAfterAt:error?.retryAfterAt||null,month,tier,component:resolvedComponent,severity:resolvedSeverity,accountSuffix:safeSuffix(accountNumber)}}

export class CreditProviderAdapter {
  constructor({profile,onDiagnostic=()=>{},correlationId='',now=()=>new Date()}={}){this.profile=profile;this.onDiagnostic=onDiagnostic;this.correlationId=correlationId;this.now=now}
  event(event){diagnostic(this.onDiagnostic,{correlationId:this.correlationId,provider:this.profile?.provider,profileId:this.profile?.profileId,...event})}
  async scrape(){throw new Error('CreditProviderAdapter.scrape must be implemented')}
}

export class VisaCalAdapter extends CreditProviderAdapter {
  constructor(options={}){super(options);Object.assign(this,{createScraper:options.createScraper,CompanyTypes:options.CompanyTypes,browserPath:options.browserPath,interactive:!!options.interactive,fetchImpl:options.fetchImpl||globalThis.fetch,requestDelayMs:Number.isFinite(options.requestDelayMs)?options.requestDelayMs:650})}
  async request(url,data,stage){if(this.blockingError)throw this.blockingError;const started=Date.now();try{const result=await postJson(this.fetchImpl,url,data,{headers:this.headers,stage,now:this.now().getTime()});this.event({stage,durationMs:Date.now()-started,responseShape:safeCreditResponseShape(result)});return result}catch(error){if(['CREDIT_AUTOMATION_BLOCKED','CREDIT_PROVIDER_RATE_LIMITED'].includes(String(error?.code||''))){error.originalFailureAt=error.originalFailureAt||this.now().toISOString();this.blockingError=error}this.event({stage,durationMs:Date.now()-started,errorClass:error?.code,httpStatus:error?.httpStatus,retryAfterAt:error?.retryAfterAt});throw error}}
  async scrape(){
    const profile=this.profile,startDate=creditStartDate(this.now()),plan=buildCreditMonthPlan({startDate,now:this.now()}),scraper=this.createScraper({companyId:this.CompanyTypes.visaCal,startDate,futureMonthsToScrape:0,combineInstallments:false,showBrowser:this.interactive,executablePath:this.browserPath,navigationRetryCount:1,defaultTimeout:45_000,timeout:90_000,additionalTransactionInformation:false,includeRawTransaction:false});let initialized=false,success=false;
    try{
      await scraper.initialize();initialized=true;this.event({stage:'BrowserInit'});
      let loginResult;try{loginResult=await scraper.login(profile.credentials)}catch(error){throw creditThrownScrapeFailure(error,profile)}
      if(!loginResult?.success)throw creditScrapeFailure(loginResult,profile);this.event({stage:'Login'});
      let cards;try{cards=await scraper.getCards()}catch{throw safeError('נתוני init ורשימת הכרטיסים של כאל לא נמצאו לאחר הכניסה.','CREDIT_SESSION_INIT_MISSING',{stage:'DashboardInit'})}
      if(!Array.isArray(cards)||!cards.length)throw safeError('כאל לא החזירה רשימת כרטיסים תקינה.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'DashboardInit'});
      let authorization;try{authorization=await scraper.getAuthorizationHeader()}catch{throw safeError('אסימון ההרשאה של כאל לא נמצא לאחר הכניסה.','CREDIT_AUTH_TOKEN_MISSING',{stage:'AuthToken'})}
      if(!String(authorization||'').trim())throw safeError('אסימון ההרשאה של כאל ריק.','CREDIT_AUTH_TOKEN_MISSING',{stage:'AuthToken'});
      const xSiteId=await scraper.getXSiteId();this.headers={Authorization:authorization,'X-Site-Id':xSiteId,...CAL_HEADERS};
      const accounts=[],errors=[];
      for(const card of cards){
        const at=this.now().toISOString(),accountNumber=text(card?.last4Digits,80),account={accountNumber,balance:null,balanceDate:null,cardType:'',cardFrame:null,availableCredit:null,frameStatus:'missing',frameFetchStatus:'unavailable',frameFetchedAt:null,frameErrorCode:'',frameErrorAt:null,pendingTransactions:[],pendingStatus:'missing',months:[]};
        try{const parsed=parseVisaCalFrame(await this.request(CAL_ENDPOINTS.frames,{cardsForFrameData:[{cardUniqueId:card.cardUniqueId}]},'Frames'),card),warning=parsed.warning;delete parsed.warning;Object.assign(account,parsed);if(parsed.frameFetchStatus==='success')account.frameFetchedAt=at;if(warning){account.frameErrorCode=warning.code;account.frameErrorAt=at;errors.push(coverageError(profile,warning,{accountNumber,at,component:'frames',severity:'warning'}))}}catch(error){account.frameFetchStatus=errorFetchStatus(error);account.frameErrorCode=error.code;account.frameErrorAt=at;errors.push(coverageError(profile,error,{accountNumber,at,component:'frames',severity:'warning'}))}
        if(!this.blockingError&&this.requestDelayMs>0)await sleep(this.requestDelayMs);
        try{account.pendingTransactions=parseVisaCalPending(await this.request(CAL_ENDPOINTS.pending,{cardUniqueIDArray:[card.cardUniqueId]},'Pending'));account.pendingStatus='success';account.pendingFetchedAt=at}catch(error){account.pendingStatus=errorFetchStatus(error);account.pendingErrorCode=error.code;account.pendingErrorAt=at;errors.push(coverageError(profile,error,{accountNumber,at,component:'pending',severity:'warning'}))}
        for(const entry of plan){
          if(!this.blockingError&&this.requestDelayMs>0)await sleep(this.requestDelayMs);
          try{const data=await this.request(CAL_ENDPOINTS.transactions,{cardUniqueId:card.cardUniqueId,month:String(Number(entry.month.slice(5,7))),year:entry.month.slice(0,4)},`Transactions ${entry.month}`),transactions=parseVisaCalMonthData(data,{startDate:entry.month===plan[0].month?startDate:null});account.months.push(monthlyCoverageSuccess(entry,transactions,this.now().toISOString()))}
          catch(error){const failedAt=this.now().toISOString();account.months.push(monthlyCoverageFailure(entry,error,failedAt));errors.push(coverageError(profile,error,{month:entry.month,tier:entry.tier,accountNumber,at:failedAt,component:entry.tier==='core'?'core_transactions':'forecast_transactions',severity:entry.tier==='core'?'error':'warning'}))}
        }
        accounts.push(normalizeCreditScrapeAccount(account,profile.provider));
      }
      const coreComplete=accounts.every(account=>account.months.filter(slice=>slice.tier==='core').every(slice=>slice.fetchStatus==='success')),forecastFailures=errors.filter(error=>error.tier==='forecast').length,coreFailures=errors.filter(error=>error.tier==='core').length,syncedAt=coreComplete?this.now().toISOString():null;
      const blocked=!!this.blockingError;
      if(forecastFailures)errors.unshift({profileId:profile.profileId,provider:profile.provider,label:profile.label,code:'CREDIT_PARTIAL_FORECAST',stage:'Forecast',component:'forecast_transactions',severity:blocked?'deferred':'warning',httpStatus:0,message:blocked?`קריאות התחזית הושהו לאחר 403/429; ${forecastFailures} מקטעים לא נשלחו ו־Last Known Good נשמר.`:`לכאל חסרים ${forecastFailures} מקטעי תחזית; נתונים קודמים נשמרים כ־Last Known Good.`,at:this.blockingError?.originalFailureAt||this.now().toISOString(),originalFailureAt:this.blockingError?.originalFailureAt||null,retryAfterAt:this.blockingError?.retryAfterAt||null});
      if(coreFailures)errors.unshift({profileId:profile.profileId,provider:profile.provider,label:profile.label,code:'CREDIT_CORE_COVERAGE_INCOMPLETE',stage:'CoreCoverage',component:'core_transactions',severity:blocked?'deferred':'error',httpStatus:0,message:blocked?`קריאות Core הושהו לאחר 403/429; ${coreFailures} מקטעים לא נשלחו, שעון ההצלחה לא התקדם ו־Last Known Good נשמר.`:`לכאל חסרים ${coreFailures} מקטעי ליבה; זמן ההצלחה המלאה לא התקדם ונתוני Last Known Good נשמרו.`,at:this.blockingError?.originalFailureAt||this.now().toISOString(),originalFailureAt:this.blockingError?.originalFailureAt||null,retryAfterAt:this.blockingError?.retryAfterAt||null});
      success=coreComplete;return {...creditProfilePublic(profile),syncedAt,attemptedAt:this.now().toISOString(),coreComplete,accounts,errors};
    }finally{if(initialized)try{await scraper.terminate(success)}catch{} }
  }
}

function transactionMonth(tx){const value=tx?.processedDate||tx?.date;return value&&/^\d{4}-\d{2}/.test(String(value))?String(value).slice(0,7):''}
function genericMonthlyAccount(account,provider,{startDate,now}){
  const normalized=normalizeCreditScrapeAccount(account,provider),plan=buildCreditMonthPlan({startDate,now}),byMonth=new Map(plan.map(entry=>[entry.month,[]])),pending=[],unassigned=[];
  for(const tx of normalized.txns){const key=transactionMonth(tx);if(tx.status==='pending'&&!tx.processedDate){pending.push(tx);continue}if(byMonth.has(key))byMonth.get(key).push(tx);else unassigned.push(tx)}
  return normalizeCreditScrapeAccount({...normalized,txns:undefined,pendingTransactions:pending,pendingStatus:'success',pendingFetchedAt:now.toISOString(),unassignedTransactions:unassigned,months:plan.map(entry=>monthlyCoverageSuccess(entry,byMonth.get(entry.month),now.toISOString(),CREDIT_PROVIDER_SCHEMA_VERSION))},provider);
}

export class GenericScraperAdapter extends CreditProviderAdapter {
  constructor(options={}){super(options);Object.assign(this,{createScraper:options.createScraper,CompanyTypes:options.CompanyTypes,companyId:options.companyId,browserPath:options.browserPath,interactive:!!options.interactive})}
  async scrape(){const profile=this.profile,startDate=creditStartDate(this.now()),scraper=this.createScraper({companyId:this.companyId,startDate,futureMonthsToScrape:CREDIT_FUTURE_MONTHS,combineInstallments:false,showBrowser:this.interactive,executablePath:this.browserPath,navigationRetryCount:1,defaultTimeout:45_000,timeout:90_000,additionalTransactionInformation:false,includeRawTransaction:false}),started=Date.now();try{const result=await scraper.scrape(profile.credentials);if(!result?.success)throw creditScrapeFailure(result,profile);const syncedAt=this.now().toISOString();this.event({stage:'Complete',durationMs:Date.now()-started});return {...creditProfilePublic(profile),syncedAt,attemptedAt:syncedAt,coreComplete:true,accounts:(Array.isArray(result.accounts)?result.accounts:[]).map(account=>genericMonthlyAccount(account,profile.provider,{startDate,now:this.now()})),errors:[]}}catch(error){this.event({stage:error?.stage||'Scrape',durationMs:Date.now()-started,errorClass:error?.code,httpStatus:error?.httpStatus});throw creditThrownScrapeFailure(error,profile)}}
}
export class MaxAdapter extends GenericScraperAdapter {}

export class IsracardAdapter extends GenericScraperAdapter {
  constructor(options={}){super(options);this.identityDir=options.identityDir}
  async scrape(){try{return await super.scrape()}catch(error){if(!isCamoufoxRetryableNativeFailure(error))throw error;return this.scrapeCamoufox()}}
  async scrapeCamoufox(){return camoufoxProfileResult(this,{provider:this.profile.provider,credentials:this.profile.credentials,startDate:creditStartDate(this.now()),futureMonthsToScrape:CREDIT_FUTURE_MONTHS,interactive:this.interactive,identityDir:this.identityDir,onDiagnostic:this.onDiagnostic,correlationId:this.correlationId,now:this.now})}
}

export class AmexAdapter extends CreditProviderAdapter {
  constructor(options={}){super(options);this.interactive=!!options.interactive;this.identityDir=options.identityDir}
  async scrape(){if(!camoufoxCreditSupported(this.profile.provider))throw safeError('Camoufox אינו תומך בחברת האשראי שנבחרה.','CREDIT_PROVIDER_UNAVAILABLE');return camoufoxProfileResult(this,{provider:this.profile.provider,credentials:this.profile.credentials,startDate:creditStartDate(this.now()),futureMonthsToScrape:CREDIT_FUTURE_MONTHS,interactive:this.interactive,identityDir:this.identityDir,onDiagnostic:this.onDiagnostic,correlationId:this.correlationId,now:this.now})}
}

async function camoufoxProfileResult(adapter,options){
  try{const result=await scrapeIsracardFamilyWithCamoufox(options),profile=adapter.profile,syncedAt=result.coreComplete===false?null:adapter.now().toISOString();return {...creditProfilePublic(profile),syncedAt,attemptedAt:adapter.now().toISOString(),coreComplete:result.coreComplete!==false,accounts:(Array.isArray(result.accounts)?result.accounts:[]).map(account=>normalizeCreditScrapeAccount(account,profile.provider)),errors:(Array.isArray(result.errors)?result.errors:[]).map(error=>({...error,profileId:profile.profileId,provider:profile.provider,label:profile.label}))}}catch(error){throw creditThrownScrapeFailure(error,adapter.profile)}
}

export function createCreditProviderAdapter({profile,CompanyTypes,createScraper,browserPath,interactive=false,identityDir='',onDiagnostic=()=>{},correlationId='',now=()=>new Date(),fetchImpl=globalThis.fetch,requestDelayMs}={}){
  const common={profile,CompanyTypes,createScraper,browserPath,interactive,identityDir,onDiagnostic,correlationId,now,fetchImpl,requestDelayMs};
  if(profile.provider==='visaCal')return new VisaCalAdapter(common);
  if(profile.provider==='max')return new MaxAdapter({...common,companyId:CompanyTypes.max});
  if(profile.provider==='isracard')return new IsracardAdapter({...common,companyId:CompanyTypes.isracard});
  if(profile.provider==='amex')return new AmexAdapter(common);
  throw safeError('חברת האשראי שנבחרה אינה נתמכת ב־Credit Connector v2.','CREDIT_PROVIDER_UNAVAILABLE');
}
