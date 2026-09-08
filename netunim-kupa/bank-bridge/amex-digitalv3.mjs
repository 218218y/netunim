// Adapted from israeli-bank-scrapers PR #1159 (commit 1aa792b37feec0001f5d182582cfb53b146ed18b),
// which was verified end-to-end against real Isracard and American Express accounts.
// Netunim keeps this adapter local until that upstream PR is released, so the installed
// bridge stays on a published dependency while Amex can use the current DigitalV3 flow.

export const AMEX_DIGITAL_V3_SCHEMA_VERSION='amex-digitalv3-pr1159-netunim-v41';
export const AMEX_LOGIN_BASE_URL='https://he.americanexpress.co.il';
export const AMEX_WEB_BASE_URL='https://web.americanexpress.co.il';
export const AMEX_LOGIN_COMPANY_CODE='77';
export const AMEX_TRANSACTIONS_COMPANY_CODE=77;
const GROUP_CARD_LIST_COMPANY_CODE='99';
const CARD_SUFFIX_LENGTH=4;
const COUNTRY_CODE='212';
const ID_TYPE='1';
const RATE_LIMIT_MS=2500;
const REQUEST_TIMEOUT_MS=60_000;
const NAVIGATION_TIMEOUT_MS=90_000;
const INTERCEPTION_ABORT_PRIORITY=1000;
const INTERCEPTION_CONTINUE_PRIORITY=10;
const JSON_HEADERS={'Content-Type':'application/json',Accept:'application/json'};

export function buildAmexDigitalV3LogonRequest(validateBean={},credentials={}){
  // PR #1159 deliberately models userName as optional. Keep its wire contract:
  // when the issuer omits userName, JSON.stringify omits KodMishtamesh instead of
  // inventing a substitute such as the ID number.
  return {KodMishtamesh:validateBean?.userName,MisparZihuy:credentials.id,Sisma:credentials.password,cardSuffix:credentials.card6Digits,countryCode:COUNTRY_CODE,idType:ID_TYPE};
}

function text(value,max=220){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function safeError(message,code,extra={}){const error=new Error(message);error.code=code;Object.assign(error,extra);return error}
function diagnostic(onDiagnostic,event){try{onDiagnostic?.(event)}catch{}}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function randomDelay(){await sleep(RATE_LIMIT_MS+Math.floor(Math.random()*501))}
function retryAfterAt(value,now=Date.now()){
  const raw=String(value||'').trim();if(!raw)return null;
  const seconds=Number(raw),time=Number.isFinite(seconds)&&seconds>=0?now+seconds*1000:Date.parse(raw);
  return Number.isFinite(time)?new Date(Math.max(now,time)).toISOString():null;
}
function htmlLike(value){return /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(String(value||''))}
function providerFailureMessage(data,fallback){return text(data?.errorDescription||data?.message||fallback,180)||fallback}
function utcDateIso(year,month,day,hour=0,minute=0,second=0){
  const d=new Date(Date.UTC(year,month-1,day,hour,minute,second,0));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
  return d.toISOString();
}
function parseIsraeliDate(value,{withTime=false,minuteOnly=false}={}){
  const pattern=withTime?(minuteOnly?/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/:/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/):/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const match=String(value||'').trim().match(pattern);if(!match)return null;
  return utcDateIso(Number(match[3]),Number(match[2]),Number(match[1]),Number(match[4]||0),Number(match[5]||0),Number(match[6]||0));
}
function startOfUtcMonth(value){const d=new Date(value);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1))}
function addUtcMonths(value,count){const d=startOfUtcMonth(value);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+count,1))}
function monthKey(value){const d=new Date(value);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`}
function monthBillingLabel(value){const d=new Date(value);return `${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`}
function monthRequestDate(value){const d=new Date(value);return `01/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`}
function getAllMonthMoments(startDate,futureMonths,now=new Date()){
  const start=startOfUtcMonth(startDate),end=addUtcMonths(now,Math.max(0,Math.trunc(Number(futureMonths)||0))),months=[];
  for(let cursor=new Date(start);cursor<=end;cursor=addUtcMonths(cursor,1))months.push(new Date(cursor));
  return months;
}
function addCalendarMonthsIso(value,count){
  const source=new Date(value);if(!Number.isFinite(source.getTime()))return value;
  const day=source.getUTCDate(),targetFirst=new Date(Date.UTC(source.getUTCFullYear(),source.getUTCMonth()+count,1,source.getUTCHours(),source.getUTCMinutes(),source.getUTCSeconds(),source.getUTCMilliseconds())),lastDay=new Date(Date.UTC(targetFirst.getUTCFullYear(),targetFirst.getUTCMonth()+1,0)).getUTCDate();
  targetFirst.setUTCDate(Math.min(day,lastDay));return targetFirst.toISOString();
}
function fixInstallments(txns){return txns.map(tx=>{
  if(tx?.type!=='installments'||!tx?.installments||Number(tx.installments.number)<=1)return tx;
  return {...tx,date:addCalendarMonthsIso(tx.date,Number(tx.installments.number)-1)};
})}

export async function prepareAmexDigitalV3Page(page){
  if(!page?.evaluate||!page?.setUserAgent||!page?.evaluateOnNewDocument||!page?.setRequestInterception||!page?.on)throw safeError('ממשק Chrome/Edge אינו תואם למסלול American Express DigitalV3.','CREDIT_BROWSER_IDENTITY_UNAVAILABLE',{stage:'BrowserIdentity'});
  // Match the live-tested ordering from upstream PR #1159: install request
  // interception first, then mask the HeadlessChrome UA, then patch webdriver
  // before the first issuer document is loaded.
  await page.setRequestInterception(true);
  page.on('request',request=>{
    try{
      if(request.url().includes('detector-dom.min.js'))void request.abort(undefined,INTERCEPTION_ABORT_PRIORITY);
      else void request.continue(undefined,INTERCEPTION_CONTINUE_PRIORITY);
    }catch{}
  });
  const nativeUserAgent=String(await page.evaluate(()=>navigator.userAgent)||'');
  const userAgent=nativeUserAgent.replace('HeadlessChrome/','Chrome/');
  if(!/Chrome\/\d+/i.test(userAgent))throw safeError('לא ניתן לזהות זהות Chrome/Edge תקינה עבור American Express.','CREDIT_BROWSER_IDENTITY_UNAVAILABLE',{stage:'BrowserIdentity'});
  await page.setUserAgent(userAgent);
  // PR #1159 deliberately returns undefined here (not false).
  await page.evaluateOnNewDocument(()=>{
    Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
  });
  return {userAgent,webdriver:'undefined'};
}

async function pagePost(page,url,data,{headers={},stage='DataApi',login=false,onDiagnostic=()=>{}}={}){
  const started=Date.now();
  let result;
  try{
    result=await page.evaluate(async(innerUrl,innerData,innerHeaders,timeoutMs)=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetch(innerUrl,{method:'POST',body:JSON.stringify(innerData),credentials:'include',headers:innerHeaders,signal:controller.signal});
        return {status:response.status,text:await response.text(),retryAfter:response.headers.get('retry-after')||''};
      }finally{clearTimeout(timer)}
    },url,data,headers,REQUEST_TIMEOUT_MS);
  }catch(error){
    const failure=safeError('החיבור לשירות American Express נקטע לפני שהתקבלה תשובה תקינה.','CREDIT_PROVIDER_NETWORK_ERROR',{stage,causeName:text(error?.name,40)});
    diagnostic(onDiagnostic,{stage,durationMs:Date.now()-started,errorClass:failure.code,httpStatus:0});throw failure;
  }
  const status=Number(result?.status)||0,body=String(result?.text||'');
  if(status===429){const failure=safeError('American Express הגבילה זמנית את קצב הבקשות.','CREDIT_PROVIDER_RATE_LIMITED',{stage,httpStatus:status,retryAfterAt:retryAfterAt(result?.retryAfter)});diagnostic(onDiagnostic,{stage,durationMs:Date.now()-started,errorClass:failure.code,httpStatus:status,retryAfterAt:failure.retryAfterAt});throw failure}
  if(status===403){const failure=safeError('American Express חסמה את סשן האוטומציה הנוכחי.','CREDIT_AUTOMATION_BLOCKED',{stage,httpStatus:status,browserEngine:'chromium'});diagnostic(onDiagnostic,{stage,durationMs:Date.now()-started,errorClass:failure.code,httpStatus:status});throw failure}
  if(status<200||status>=300){const failure=safeError(`American Express החזירה HTTP ${status||'לא ידוע'} בשלב ${stage}.`,'CREDIT_PROVIDER_HTTP_ERROR',{stage,httpStatus:status});diagnostic(onDiagnostic,{stage,durationMs:Date.now()-started,errorClass:failure.code,httpStatus:status});throw failure}
  if(htmlLike(body)){
    const code=login?'CREDIT_LOGIN_HTML_RESPONSE':'CREDIT_DATA_HTML_RESPONSE';
    const failure=safeError(login?'American Express החזירה HTML במקום JSON בשלב הכניסה.':'American Express החזירה HTML במקום JSON בשירות DigitalV3.',code,{stage,httpStatus:status,browserEngine:'chromium'});
    diagnostic(onDiagnostic,{stage,durationMs:Date.now()-started,errorClass:code,httpStatus:status});throw failure;
  }
  let parsed;try{parsed=body?JSON.parse(body):null}catch{const failure=safeError('American Express החזירה תשובה שאינה JSON תקין.','CREDIT_PROVIDER_RESPONSE_NOT_JSON',{stage,httpStatus:status});diagnostic(onDiagnostic,{stage,durationMs:Date.now()-started,errorClass:failure.code,httpStatus:status});throw failure}
  diagnostic(onDiagnostic,{stage,durationMs:Date.now()-started,httpStatus:status});return parsed;
}

async function navigate(page,url,{stage,onDiagnostic}){
  const started=Date.now();let response;
  try{response=await page.goto(url,{waitUntil:'load',timeout:NAVIGATION_TIMEOUT_MS})}catch(error){const failure=safeError(`American Express לא השלימה את טעינת ${stage}.`,'CREDIT_PROVIDER_NETWORK_ERROR',{stage,causeName:text(error?.name,40)});diagnostic(onDiagnostic,{stage,durationMs:Date.now()-started,errorClass:failure.code,httpStatus:0});throw failure}
  const status=Number(response?.status?.()||0);diagnostic(onDiagnostic,{stage,durationMs:Date.now()-started,httpStatus:status});
  if(status===403)throw safeError('American Express חסמה את טעינת הדף של סשן Chrome/Edge.','CREDIT_AUTOMATION_BLOCKED',{stage,httpStatus:status,browserEngine:'chromium'});
  if(status===429)throw safeError('American Express הגבילה זמנית את קצב טעינת הדף.','CREDIT_PROVIDER_RATE_LIMITED',{stage,httpStatus:status});
  if(status>=400)throw safeError(`American Express החזירה HTTP ${status} בטעינת ${stage}.`,'CREDIT_PROVIDER_HTTP_ERROR',{stage,httpStatus:status});
}

async function login(page,credentials,onDiagnostic){
  await navigate(page,`${AMEX_LOGIN_BASE_URL}/personalarea/Login`,{stage:'LoginPage',onDiagnostic});
  // This dwell exists in the upstream PR that was verified against a live Amex account.
  await randomDelay();
  const servicesUrl=`${AMEX_LOGIN_BASE_URL}/services/ProxyRequestHandler.ashx`;
  const validateRequest={id:credentials.id,cardSuffix:credentials.card6Digits,countryCode:COUNTRY_CODE,idType:ID_TYPE,checkLevel:'1',companyCode:AMEX_LOGIN_COMPANY_CODE};
  const validateResult=await pagePost(page,`${servicesUrl}?reqName=ValidateIdData`,validateRequest,{headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},stage:'LoginApi',login:true,onDiagnostic});
  if(!validateResult?.Header||validateResult.Header.Status!=='1'||!validateResult.ValidateIdDataBean)throw safeError('American Express החזירה מבנה ValidateIdData שאינו תואם לחוזה המחבר.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'LoginApi'});
  const returnCode=String(validateResult.ValidateIdDataBean.returnCode||'');
  if(returnCode==='4')throw safeError('American Express דורשת שינוי סיסמה לפני שניתן להמשיך בסנכרון.','CREDIT_CHANGE_PASSWORD',{stage:'LoginApi'});
  if(returnCode!=='1')throw safeError('פרטי ההתחברות של American Express נדחו.','CREDIT_INVALID_PASSWORD',{stage:'LoginApi'});
  const logonRequest=buildAmexDigitalV3LogonRequest(validateResult.ValidateIdDataBean,credentials);
  const logonResult=await pagePost(page,`${servicesUrl}?reqName=performLogonI`,logonRequest,{headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},stage:'LoginPassword',login:true,onDiagnostic});
  const status=String(logonResult?.status||'');
  if(status==='3')throw safeError('American Express דורשת שינוי סיסמה לפני שניתן להמשיך בסנכרון.','CREDIT_CHANGE_PASSWORD',{stage:'LoginPassword'});
  if(status!=='1')throw safeError('הסיסמה של American Express נדחתה.','CREDIT_INVALID_PASSWORD',{stage:'LoginPassword'});
  await navigate(page,`${AMEX_WEB_BASE_URL}/transactions`,{stage:'TransactionsPage',onDiagnostic});
}

function activeAmexCards(response){
  if(!response?.isSuccess||!response?.data||!Array.isArray(response.data.cardsList))throw safeError(providerFailureMessage(response,'American Express לא החזירה רשימת כרטיסים תקינה.'),'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'CardList'});
  return response.data.cardsList.filter(card=>String(card?.companyCode)==='77'&&card?.isActive===true&&card?.isBlock!==true);
}
function cardBalance(card){const value=Number(card?.limitData?.limitUsed);return Number.isFinite(value)?-value:null}
function cardFrame(card){const value=Number(card?.limitData?.creditLimitAmount);return Number.isFinite(value)?value:null}
function cardBalanceDate(card){return card?.cardChargeNext?.billingDate?parseIsraeliDate(card.cardChargeNext.billingDate):null}

export function normalizeAmexDigitalV3ApprovedTransaction(txn={}){
  const date=parseIsraeliDate(`${txn.purchaseDate||''} ${txn.israelTransactionTime||''}`,{withTime:true,minuteOnly:true});
  return {type:'normal',identifier:String(txn.seqConfirmationNumber||''),date,processedDate:date,transactionDate:date,originalAmount:Number.isFinite(Number(txn.originalAmount))?-Number(txn.originalAmount):null,originalCurrency:text(txn.currencyIso,12),chargedAmount:Number.isFinite(Number(txn.ilsBillingAmount))?-Number(txn.ilsBillingAmount):null,chargedCurrency:'ILS',description:text(txn.businessName,220)||'עסקת אשראי',memo:text(txn.extraDetails,260),status:'pending'};
}
export function normalizeAmexDigitalV3Voucher(voucher={},processedDateIso=null){
  const date=parseIsraeliDate(`${voucher.purchaseDate||''} ${voucher.purchaseTime||'00:00:00'}`,{withTime:true}),total=Number(voucher.numberOfInstallment),number=Number(voucher.currentInstallmentNum),installments=total>0&&number>0?{number:Math.trunc(number),total:Math.trunc(total)}:null;
  return {type:installments?'installments':'normal',identifier:String(voucher.seqVoucherNumber||''),date,processedDate:processedDateIso,transactionDate:date,originalAmount:Number.isFinite(Number(voucher.originalAmount))?-Number(voucher.originalAmount):null,originalCurrency:text(voucher.originalCurrencyIso,12),chargedAmount:Number.isFinite(Number(voucher.billingAmount))?-Number(voucher.billingAmount):null,chargedCurrency:'ILS',description:text(voucher.businessName,220)||'עסקת אשראי',memo:text(voucher.moreInfo,260),installments,status:'completed'};
}

async function fetchCards(page,onDiagnostic){
  const response=await pagePost(page,`${AMEX_WEB_BASE_URL}/ocp/transactions/DigitalV3.Transactions/GetCardList`,{companyCode:GROUP_CARD_LIST_COMPANY_CODE,cardSuffixLength:CARD_SUFFIX_LENGTH},{headers:JSON_HEADERS,stage:'CardList',onDiagnostic});
  const cards=activeAmexCards(response);if(!cards.length)throw safeError('American Express לא החזירה כרטיס Amex פעיל לאחר הכניסה.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'CardList'});return cards;
}
async function effectiveBillingDate(page,card,month,onDiagnostic){
  await randomDelay();const key=monthKey(month);
  const response=await pagePost(page,`${AMEX_WEB_BASE_URL}/ocp/transactions/DigitalV3.Transactions/GetMonthlyBilling`,{cards:[{cardStatus:Number(card.cardStatus),cardSuffix:card.cardSuffix,companyCode:AMEX_TRANSACTIONS_COMPANY_CODE,serviceType:Number(card.serviceType),isPartner:!!card.isPartner}],billingDate:monthBillingLabel(month)},{headers:JSON_HEADERS,stage:`Billing ${key}`,onDiagnostic});
  if(!response?.isSuccess||!response?.data||typeof response.data.cards!=='object')throw safeError(providerFailureMessage(response,'American Express לא החזירה תאריך חיוב תקין.'),'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:`Billing ${key}`});
  const billing=response.data.cards?.[card.cardSuffix];return billing?.billingDate?parseIsraeliDate(billing.billingDate):null;
}
async function monthTransactions(page,card,month,isNextBillingDate,processedDateIso,onDiagnostic){
  await randomDelay();const key=monthKey(month);
  const response=await pagePost(page,`${AMEX_WEB_BASE_URL}/ocp/transactions/DigitalV3.Transactions/GetTransactionsList`,{card4Number:card.cardSuffix,isNextBillingDate,cardStatus:Number(card.cardStatus),billingMonth:monthRequestDate(month),companyCode:AMEX_TRANSACTIONS_COMPANY_CODE,isPartner:!!card.isPartner},{headers:JSON_HEADERS,stage:`Transactions ${key}`,onDiagnostic});
  if(!response?.isSuccess||!response?.data)throw safeError(providerFailureMessage(response,'American Express לא החזירה עסקאות חודש תקינות.'),'CREDIT_PROVIDER_DATA_ERROR',{stage:`Transactions ${key}`});
  const txns=[];
  for(const txn of response.data.approvals?.approvedTransactions??[])txns.push(normalizeAmexDigitalV3ApprovedTransaction(txn));
  for(const voucher of response.data.israelAbroadVouchers?.vouchers?.israelAbroadVouchersList??[])txns.push(normalizeAmexDigitalV3Voucher(voucher,processedDateIso));
  for(const group of response.data.israelAbroadVouchers?.outOfStatementChargeDateVouchers??[]){const groupDate=group?.totalVouchersCurrencyDate?.dateImmediateVouchers,groupIso=groupDate?parseIsraeliDate(groupDate):processedDateIso;for(const voucher of group?.immediateVouchersCurrencyDate??[])txns.push(normalizeAmexDigitalV3Voucher(voucher,groupIso))}
  return txns;
}

export async function scrapeAmexDigitalV3({credentials,browserPath,interactive=false,startDate,futureMonthsToScrape=1,onDiagnostic=()=>{},now=()=>new Date(),puppeteerModule=null}={}){
  if(!credentials?.id||!credentials?.card6Digits||!credentials?.password)throw safeError('חסרים פרטי התחברות ל-American Express.','CREDIT_CREDENTIALS',{stage:'Login'});
  let puppeteer=puppeteerModule;
  if(!puppeteer){try{const imported=await import('puppeteer');puppeteer=imported.default||imported}catch{throw safeError('Puppeteer אינו מותקן ב-Bank Bridge. הרץ מחדש install_bank_bridge.bat.','CREDIT_BROWSER_RUNTIME_MISSING',{stage:'BrowserLaunch'})}}
  let browser,page,success=false;
  try{
    browser=await puppeteer.launch({headless:!interactive,executablePath:browserPath,timeout:NAVIGATION_TIMEOUT_MS});
    page=await browser.newPage();page.setDefaultTimeout(45_000);page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);await page.setCacheEnabled(false);await page.setViewport({width:1024,height:768});
    diagnostic(onDiagnostic,{stage:'BrowserLaunch'});
    const identity=await prepareAmexDigitalV3Page(page);diagnostic(onDiagnostic,{stage:'BrowserIdentity',identityState:`webdriver-${identity.webdriver}`});
    await login(page,credentials,onDiagnostic);diagnostic(onDiagnostic,{stage:'Login'});
    const cards=await fetchCards(page,onDiagnostic),months=getAllMonthMoments(startDate,futureMonthsToScrape,now()),currentMonth=startOfUtcMonth(now()),txnsByCard=new Map(cards.map(card=>[card.cardSuffix,[]]));
    for(const month of months){const isNextBillingDate=month>currentMonth;for(const card of cards){const effective=await effectiveBillingDate(page,card,month,onDiagnostic),processed=effective||month.toISOString(),txns=await monthTransactions(page,card,month,isNextBillingDate,processed,onDiagnostic);txnsByCard.get(card.cardSuffix).push(...txns)}}
    const accounts=cards.map(card=>({accountNumber:card.cardSuffix,balance:cardBalance(card),balanceDate:cardBalanceDate(card),cardFrame:cardFrame(card),txns:fixInstallments(txnsByCard.get(card.cardSuffix)||[])}));
    success=true;diagnostic(onDiagnostic,{stage:'Complete'});return {success:true,accounts};
  }catch(error){if(String(error?.code||'').startsWith('CREDIT_'))throw error;throw safeError('מסלול American Express DigitalV3 נכשל לפני השלמת הסנכרון.','CREDIT_PROVIDER_DATA_ERROR',{stage:String(error?.stage||'DigitalV3').slice(0,80)})}
  finally{try{if(page&&!page.isClosed?.())await page.close()}catch{}try{if(browser)await browser.close()}catch{}if(!success)diagnostic(onDiagnostic,{stage:'SessionClosed'})}
}
