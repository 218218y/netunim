import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const PROVIDERS={
  isracard:{baseUrl:'https://digital.isracard.co.il',companyCode:'11'},
  amex:{baseUrl:'https://he.americanexpress.co.il',companyCode:'77'},
};
const COUNTRY_CODE='212';
const ID_TYPE='1';
const LOGIN_TIMEOUT_MS=90_000;
const FETCH_TIMEOUT_MS=60_000;
const RATE_DELAY_MIN_MS=2_500;
const RATE_DELAY_MAX_MS=3_000;
const INSTALLMENTS_KEYWORD='תשלום';
const CAMOUFOX_SCREEN={minWidth:1280,maxWidth:1920,minHeight:720,maxHeight:1200};
const CAMOUFOX_LOGIN_SESSION_ATTEMPTS=1;

function cleanText(value,max=260){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function finiteNumber(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback}
function currency(value){const v=String(value??'').trim();return v==='ש"ח'||v==='NIS'?'ILS':v}
function safeError(message,code='CREDIT_CAMOUFOX_FAILED',extra={}){const e=new Error(message);e.code=code;Object.assign(e,extra);return e}
function two(value){return String(value).padStart(2,'0')}
function monthKey(date){return `${date.getUTCFullYear()}-${two(date.getUTCMonth()+1)}`}
function monthDateString(date){return `${date.getUTCFullYear()}-${two(date.getUTCMonth()+1)}-01`}
function addUtcMonths(date,count){const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+count,1));return d}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function randomDelay(){const ms=Math.floor(Math.random()*(RATE_DELAY_MAX_MS-RATE_DELAY_MIN_MS+1))+RATE_DELAY_MIN_MS;await sleep(ms)}
function parseRetryAfter(value,now=Date.now()){const raw=String(value??'').trim();if(!raw)return null;const seconds=Number(raw),time=Number.isFinite(seconds)&&seconds>=0?Number(now)+seconds*1000:Date.parse(raw);return Number.isFinite(time)?new Date(Math.max(Number(now),time)).toISOString():null}

export function camoufoxCreditSupported(provider){return Object.prototype.hasOwnProperty.call(PROVIDERS,String(provider||''))}
export function isCamoufoxRetryableNativeFailure(error){return ['CREDIT_LOGIN_HTML_RESPONSE','CREDIT_AUTOMATION_BLOCKED','CREDIT_DATA_HTML_RESPONSE'].includes(String(error?.code||''))}

export function parseIsracardDate(value){
  const match=String(value??'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!match)return null;
  const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]);
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
  return d.toISOString();
}
export function buildCreditMonths(startDate,futureMonthsToScrape=1,now=new Date()){
  const start=new Date(startDate);if(!Number.isFinite(start.getTime()))throw safeError('תאריך תחילת סנכרון האשראי אינו תקין','CREDIT_CAMOUFOX_INVALID_DATE');
  let cursor=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1));
  const current=new Date(now);if(!Number.isFinite(current.getTime()))throw safeError('תאריך המערכת אינו תקין','CREDIT_CAMOUFOX_INVALID_DATE');
  const end=addUtcMonths(new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth(),1)),Math.max(0,Math.trunc(Number(futureMonthsToScrape)||0)));
  const result=[];while(cursor<=end){result.push(new Date(cursor));cursor=addUtcMonths(cursor,1)}return result;
}
function installmentInfo(txn){
  const memo=String(txn?.moreInfo||'');if(!memo.includes(INSTALLMENTS_KEYWORD))return null;
  const nums=memo.match(/\d+/g);if(!nums||nums.length<2)return null;
  const number=Number(nums[0]),total=Number(nums[1]);return number>0&&total>0?{number:Math.trunc(number),total:Math.trunc(total)}:null;
}
function shiftInstallmentDate(iso,installments){
  if(!iso||!installments||installments.number<=1)return iso;
  const date=new Date(iso);if(!Number.isFinite(date.getTime()))return iso;
  const targetFirst=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+installments.number-1,1));
  const lastDay=new Date(Date.UTC(targetFirst.getUTCFullYear(),targetFirst.getUTCMonth()+1,0)).getUTCDate();
  return new Date(Date.UTC(targetFirst.getUTCFullYear(),targetFirst.getUTCMonth(),Math.min(date.getUTCDate(),lastDay))).toISOString();
}
export function normalizeIsracardFamilyTransaction(txn={},processedDate=null){
  if(String(txn?.dealSumType)==='1'||String(txn?.voucherNumberRatz)==='000000000'||String(txn?.voucherNumberRatzOutbound)==='000000000')return null;
  const outboundAmount=finiteNumber(txn?.dealSumOutbound,0),isOutbound=outboundAmount!==0;
  const purchaseDate=parseIsracardDate(isOutbound?txn?.fullPurchaseDateOutbound:txn?.fullPurchaseDate);if(!purchaseDate)return null;
  const installments=installmentInfo(txn);
  const date=shiftInstallmentDate(purchaseDate,installments);
  const paymentDate=parseIsracardDate(txn?.fullPaymentDate)||processedDate||null;
  const voucher=String(isOutbound?txn?.voucherNumberRatzOutbound:txn?.voucherNumberRatz||'').trim();
  return {
    type:installments?'installments':'normal',
    identifier:voucher&&/^\d+$/.test(voucher)?Number(voucher):voucher,
    date,
    processedDate:paymentDate,
    transactionDate:purchaseDate,
    originalAmount:isOutbound?-Math.abs(outboundAmount):-Math.abs(finiteNumber(txn?.dealSum,0)),
    originalCurrency:currency(txn?.currentPaymentCurrency??txn?.currencyId),
    chargedAmount:isOutbound?-Math.abs(finiteNumber(txn?.paymentSumOutbound,0)):-Math.abs(finiteNumber(txn?.paymentSum,0)),
    chargedCurrency:currency(txn?.currencyId)||'ILS',
    description:cleanText(isOutbound?txn?.fullSupplierNameOutbound:txn?.fullSupplierNameHeb,220)||'עסקת אשראי',
    memo:cleanText(txn?.moreInfo,260),
    installments,
    status:'completed',
  };
}

function responseLooksHtml(text){return /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(String(text||''))}
function responseLooksRateLimited(text,status){return Number(status)===429||/too many requests|rate[ -]?limit/i.test(String(text||''))}
function responseLooksBlocked(text,status){return Number(status)===403||/block automation|bot detection|access denied|cf-chl|cloudflare/i.test(String(text||''))}
function loginStage(stage){return stage==='ValidateIdData'||stage==='performLogonI'}
export function classifyCamoufoxProviderResponse({stage='',status=0,text='',retryAfter='',now=Date.now()}){
  if(responseLooksRateLimited(text,status))return {code:'CREDIT_PROVIDER_RATE_LIMITED',message:'חברת האשראי הגבילה זמנית את קצב הבקשות. יש להמתין לפני ניסיון נוסף.',stage,httpStatus:Number(status)||0,retryAfterAt:parseRetryAfter(retryAfter,now)};
  if(responseLooksBlocked(text,status))return {code:'CREDIT_AUTOMATION_BLOCKED',message:'אתר חברת האשראי חסם את סשן הדפדפן האוטומטי.',stage,httpStatus:Number(status)||0};
  if(responseLooksHtml(text))return {code:loginStage(stage)?'CREDIT_LOGIN_HTML_RESPONSE':'CREDIT_DATA_HTML_RESPONSE',message:loginStage(stage)?'שירות ההתחברות של חברת האשראי החזיר HTML במקום JSON.':'שירות הנתונים של חברת האשראי החזיר HTML במקום JSON.',stage,httpStatus:Number(status)||0};
  if(Number(status)<200||Number(status)>=300)return {code:'CREDIT_PROVIDER_HTTP_ERROR',message:`שירות חברת האשראי החזיר HTTP ${Number(status)||'לא ידוע'} בשלב ${stage||'לא ידוע'}.`,stage,httpStatus:Number(status)||0};
  return null;
}
async function pageFetchJson(page,{url,method='GET',data=null,stage}){
  const result=await page.evaluate(async ({url,method,data,timeoutMs})=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const options={method,credentials:'include',signal:controller.signal};
      if(method==='POST'){
        options.body=JSON.stringify(data||{});
        options.headers={'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'};
      }
      const response=await fetch(url,options),text=response.status===204?'':await response.text();
      return {status:response.status,text,contentType:response.headers.get('content-type')||'',retryAfter:response.headers.get('retry-after')||''};
    }finally{clearTimeout(timer)}
  },{url,method,data,timeoutMs:FETCH_TIMEOUT_MS});
  const text=String(result?.text||''),status=Number(result?.status)||0;
  const responseFailure=classifyCamoufoxProviderResponse({stage,status,text,retryAfter:result?.retryAfter||''});
  if(responseFailure)throw safeError(responseFailure.message,responseFailure.code,{stage:responseFailure.stage,httpStatus:responseFailure.httpStatus,retryAfterAt:responseFailure.retryAfterAt||null});
  if(!text)return null;
  try{return JSON.parse(text)}catch{throw safeError(loginStage(stage)?'שירות ההתחברות של חברת האשראי החזיר תשובה שאינה JSON.':'שירות הנתונים של חברת האשראי החזיר תשובה שאינה JSON.','CREDIT_PROVIDER_RESPONSE_NOT_JSON',{stage,httpStatus:status})}
}

function accountsUrl(servicesUrl,month){const url=new URL(servicesUrl);url.searchParams.set('reqName','DashboardMonth');url.searchParams.set('actionCode','0');url.searchParams.set('billingDate',monthDateString(month));url.searchParams.set('format','Json');return url.toString()}
function transactionsUrl(servicesUrl,month){const url=new URL(servicesUrl);url.searchParams.set('reqName','CardsTransactionsList');url.searchParams.set('month',two(month.getUTCMonth()+1));url.searchParams.set('year',String(month.getUTCFullYear()));url.searchParams.set('requiredDate','N');return url.toString()}
async function fetchAccounts(page,servicesUrl,month){
  await randomDelay();const data=await pageFetchJson(page,{url:accountsUrl(servicesUrl,month),stage:`DashboardMonth ${monthKey(month)}`});
  if(data?.Header?.Status!=='1')throw safeError('חברת האשראי לא אישרה את קריאת רשימת הכרטיסים לחודש.','CREDIT_PROVIDER_DATA_ERROR',{stage:`DashboardMonth ${monthKey(month)}`});
  if(!data?.DashboardMonthBean||!Array.isArray(data.DashboardMonthBean.cardsCharges))throw safeError('חברת האשראי החזירה מבנה חשבונות חודשי שאינו תואם למחבר.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:`DashboardMonth ${monthKey(month)}`});
  return (Array.isArray(data.DashboardMonthBean.cardsCharges)?data.DashboardMonthBean.cardsCharges:[]).map(card=>({index:Number(card?.cardIndex),accountNumber:cleanText(card?.cardNumber,80),processedDate:parseIsracardDate(card?.billingDate)})).filter(card=>Number.isFinite(card.index)&&card.accountNumber);
}
async function fetchTransactionsForMonth(page,servicesUrl,month,startDate){
  const accounts=await fetchAccounts(page,servicesUrl,month);await randomDelay();
  const data=await pageFetchJson(page,{url:transactionsUrl(servicesUrl,month),stage:`CardsTransactionsList ${monthKey(month)}`});
  if(data?.Header?.Status!=='1')throw safeError('חברת האשראי לא אישרה את קריאת העסקאות לחודש.','CREDIT_PROVIDER_DATA_ERROR',{stage:`CardsTransactionsList ${monthKey(month)}`});
  const bean=data?.CardsTransactionsListBean;if(!bean||typeof bean!=='object')throw safeError('חברת האשראי החזירה מבנה עסקאות חודשי שאינו תואם למחבר.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:`CardsTransactionsList ${monthKey(month)}`});
  const result={},startMs=new Date(startDate).getTime();
  for(const account of accounts){
    const groups=bean?.[`Index${account.index}`]?.CurrentCardTransactions;if(!Array.isArray(groups))continue;
    const txns=[];for(const group of groups){for(const row of [...(Array.isArray(group?.txnIsrael)?group.txnIsrael:[]),...(Array.isArray(group?.txnAbroad)?group.txnAbroad:[])]){const tx=normalizeIsracardFamilyTransaction(row,account.processedDate);if(tx&&new Date(tx.date).getTime()>=startMs)txns.push(tx)}}
    result[account.accountNumber]=txns;
  }
  return result;
}

async function login(page,provider,credentials,servicesUrl){
  const cfg=PROVIDERS[provider];
  const validate=await pageFetchJson(page,{url:`${servicesUrl}?reqName=ValidateIdData`,method:'POST',stage:'ValidateIdData',data:{id:String(credentials?.id||''),cardSuffix:String(credentials?.card6Digits||''),countryCode:COUNTRY_CODE,idType:ID_TYPE,checkLevel:'1',companyCode:cfg.companyCode}});
  if(validate?.Header?.Status!=='1'||!validate?.ValidateIdDataBean)throw safeError('חברת האשראי לא החזירה תשובת ValidateIdData תקינה.','CREDIT_CAMOUFOX_LOGIN_PROTOCOL',{stage:'ValidateIdData'});
  const returnCode=String(validate.ValidateIdDataBean.returnCode||'');
  if(returnCode==='4')throw safeError('חברת האשראי דורשת החלפת סיסמה לפני שניתן לסנכרן.','CREDIT_CHANGE_PASSWORD',{stage:'ValidateIdData'});
  if(returnCode!=='1')throw safeError('פרטי ההתחברות הקבועים נדחו על ידי חברת האשראי.','CREDIT_INVALID_PASSWORD',{stage:'ValidateIdData'});
  const loginResult=await pageFetchJson(page,{url:`${servicesUrl}?reqName=performLogonI`,method:'POST',stage:'performLogonI',data:{KodMishtamesh:validate.ValidateIdDataBean.userName,MisparZihuy:String(credentials?.id||''),Sisma:String(credentials?.password||''),cardSuffix:String(credentials?.card6Digits||''),countryCode:COUNTRY_CODE,idType:ID_TYPE}});
  const status=String(loginResult?.status||'');
  if(status==='1')return;
  if(status==='3')throw safeError('חברת האשראי דורשת החלפת סיסמה לפני שניתן לסנכרן.','CREDIT_CHANGE_PASSWORD',{stage:'performLogonI'});
  throw safeError('פרטי ההתחברות הקבועים נדחו על ידי חברת האשראי.','CREDIT_INVALID_PASSWORD',{stage:'performLogonI'});
}


export function camoufoxLaunchOptions({interactive=false,enableCache=false,userDataDir='',identityConfig=null}={}){
  // Let Camoufox generate and map its own BrowserForge fingerprint. The upstream
  // generator uses zero for some unobserved window dimensions; Camoufox deliberately
  // skips those values instead of treating them as invalid. The real qualification
  // boundary is the anonymous issuer login-page response below, before credentials.
  return {headless:!interactive,humanize:true,os:'windows',screen:{...CAMOUFOX_SCREEN},locale:'he-IL',enable_cache:!!enableCache,...(userDataDir?{user_data_dir:userDataDir,config:identityConfig&&typeof identityConfig==='object'?identityConfig:{},i_know_what_im_doing:true}:{})};
}
async function readIdentityConfig(identityDir){try{const value=JSON.parse(await fs.readFile(path.join(identityDir,'camoufox-identity.json'),'utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return {}}}
async function writeIdentityConfig(identityDir,config){await fs.mkdir(identityDir,{recursive:true,mode:0o700});const target=path.join(identityDir,'camoufox-identity.json'),temporary=path.join(identityDir,`.camoufox-identity-${process.pid}.tmp`);try{await fs.writeFile(temporary,JSON.stringify(config,null,2),{encoding:'utf8',mode:0o600});await fs.rename(temporary,target)}finally{try{await fs.rm(temporary,{force:true})}catch{}}}
export async function launchCamoufox(Camoufox,{interactive=false,enableCache=false,identityDir=''}={}){
  if(!identityDir)return Camoufox(camoufoxLaunchOptions({interactive,enableCache}));
  await fs.mkdir(identityDir,{recursive:true,mode:0o700});const config=await readIdentityConfig(identityDir),userDataDir=path.join(identityDir,'profile');await fs.mkdir(userDataDir,{recursive:true,mode:0o700});
  try{return await Camoufox(camoufoxLaunchOptions({interactive,enableCache,userDataDir,identityConfig:config}))}finally{await writeIdentityConfig(identityDir,config)}
}
async function closeCamoufoxSession(browser,page){try{await page?.close()}catch{}try{await browser?.close()}catch{}}
async function sessionPage(session){const existing=typeof session?.pages==='function'?session.pages().find(page=>!page.isClosed?.()):null;return existing||session.newPage()}
async function camoufoxIdentityProbe(page){
  return page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;
    const context=canvas.getContext('2d');context.font='14px Arial';context.fillText('Netunim identity',2,18);
    return {userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:[...navigator.languages],hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory??null,screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight,colorDepth:screen.colorDepth,pixelDepth:screen.pixelDepth},devicePixelRatio:window.devicePixelRatio,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,canvas:canvas.toDataURL()};
  });
}
export async function verifyCamoufoxIdentityContinuity(Camoufox,{identityDir}={}){
  if(!identityDir)throw safeError('Camoufox identity verification requires an explicit local identity directory.','CREDIT_CAMOUFOX_IDENTITY_UNAVAILABLE');
  const probes=[];
  for(let launch=0;launch<2;launch++){
    let session,page;
    try{session=await launchCamoufox(Camoufox,{interactive:false,enableCache:true,identityDir});page=await sessionPage(session);await page.goto('about:blank');probes.push(await camoufoxIdentityProbe(page))}
    finally{await closeCamoufoxSession(session,page)}
  }
  if(JSON.stringify(probes[0])!==JSON.stringify(probes[1]))throw safeError('Camoufox changed observable browser identity fields between two launches that used the same local identity.','CREDIT_CAMOUFOX_IDENTITY_UNSTABLE',{stage:'IdentityContinuity'});
  return {stable:true,fields:Object.keys(probes[0]||{})};
}
async function openQualifiedLoginSession(Camoufox,cfg,{interactive=false,identityDir=''}={}){
  let lastStatus=0;
  for(let attempt=1;attempt<=CAMOUFOX_LOGIN_SESSION_ATTEMPTS;attempt++){
    let browser,page;
    try{
      browser=await launchCamoufox(Camoufox,{interactive,enableCache:true,identityDir});
      page=await sessionPage(browser);page.setDefaultTimeout(45_000);page.setDefaultNavigationTimeout(LOGIN_TIMEOUT_MS);
      // Do not install Playwright request interception here. In the Camoufox/Firefox
      // stack used by this Bridge, page.route() changes the document request's wire
      // fingerprint (cache headers/header order) and strict issuer WAFs can reject
      // the anonymous Login navigation with HTTP 403 before any page script runs.
      // The adapter does not need interception for its login/data protocol.
      const response=await page.goto(`${cfg.baseUrl}/personalarea/Login`,{waitUntil:'load',timeout:LOGIN_TIMEOUT_MS});
      const status=Number(response?.status?.()||0);lastStatus=status;
      if(status===429){const retryAfter=response?.headers?.()?.['retry-after']||response?.headers?.()?.['Retry-After']||'';throw safeError('חברת האשראי הגבילה זמנית את קצב הבקשות כבר בטעינת דף הכניסה.','CREDIT_PROVIDER_RATE_LIMITED',{stage:'LoginPage',httpStatus:status,retryAfterAt:parseRetryAfter(retryAfter)})}
      if(status===403){
        // A 403 happens before credentials. Do not rotate through fresh anonymous
        // fingerprints: repeated immediate identities add issuer/WAF pressure but
        // provide no new authenticated state. The outer per-profile circuit breaker
        // owns the next attempt. Ordinary interactive diagnostics obey the same
        // hard not-before time and never rotate the persisted identity.
        throw safeError('אתר חברת האשראי דחה את סשן Camoufox לפני שליחת פרטי ההתחברות. ניסיון אוטומטי נוסף יידחה על ידי מנגנון ההשהיה במקום ליצור זהויות דפדפן חדשות ברצף.','CREDIT_AUTOMATION_BLOCKED',{stage:'LoginPage',httpStatus:status});
      }
      if(status>=400)throw safeError(`אתר חברת האשראי לא נטען (HTTP ${status}).`,'CREDIT_PROVIDER_HTTP_ERROR',{stage:'LoginPage',httpStatus:status});
      return {browser,page};
    }catch(error){
      if(browser||page)await closeCamoufoxSession(browser,page);
      if(String(error?.code||'').startsWith('CREDIT_'))throw error;
      throw error;
    }
  }
  throw safeError('אתר חברת האשראי חסם את סשן Camoufox כבר בטעינת דף הכניסה.','CREDIT_AUTOMATION_BLOCKED',{stage:'LoginPage',httpStatus:lastStatus});
}

export async function doctorCamoufox(){
  process.env.CAMOUFOX_INSTALL_DIR=process.env.CAMOUFOX_INSTALL_DIR||'';
  let Camoufox;try{({Camoufox}=await import('camoufox-js'))}catch{throw safeError('חבילת camoufox-js אינה מותקנת ב-Bank Bridge.','CREDIT_CAMOUFOX_RUNTIME_MISSING')}
  const identityDir=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-camoufox-doctor-'));
  try{await verifyCamoufoxIdentityContinuity(Camoufox,{identityDir})}
  catch(e){if(e?.code?.startsWith?.('CREDIT_'))throw e;throw safeError(`Camoufox אינו מוכן להפעלה: ${cleanText(e?.message||e,180)}`,'CREDIT_CAMOUFOX_RUNTIME_MISSING')}
  finally{if(path.basename(identityDir).startsWith('netunim-camoufox-doctor-'))try{await fs.rm(identityDir,{recursive:true,force:true})}catch{}}
  return true;
}

function coverageFailure(month,tier,error,at){const code=String(error?.code||'CREDIT_PROVIDER_DATA_ERROR');return {month,tier,fetchStatus:code==='CREDIT_PROVIDER_SCHEMA_ERROR'||code==='CREDIT_PROVIDER_RESPONSE_NOT_JSON'?'schema_error':code==='CREDIT_PROVIDER_NETWORK_ERROR'?'network_error':'provider_error',fetchedAt:null,transactions:[],providerSchemaVersion:'isracard-family-6.9.0-camoufox-v2',lastErrorCode:code,lastErrorAt:at}}
function coverageSuccess(month,tier,transactions,at){return {month,tier,fetchStatus:'success',fetchedAt:at,transactions,providerSchemaVersion:'isracard-family-6.9.0-camoufox-v2',lastErrorCode:'',lastErrorAt:null}}
function publicMonthError(error,month,tier,at){return {code:String(error?.code||'CREDIT_PROVIDER_DATA_ERROR'),stage:String(error?.stage||`Transactions ${month}`).slice(0,80),httpStatus:Number(error?.httpStatus)||0,message:error?.message||'קריאת חודש מחברת האשראי נכשלה',at,retryAfterAt:error?.retryAfterAt||null,month,tier}}

export async function scrapeIsracardFamilyWithCamoufox({provider,credentials,startDate,futureMonthsToScrape=1,interactive=false,identityDir='',onDiagnostic=()=>{},correlationId='',now=()=>new Date()}){
  provider=String(provider||'');if(!camoufoxCreditSupported(provider))throw safeError('Camoufox credit adapter supports only Isracard/American Express.','CREDIT_CAMOUFOX_UNSUPPORTED');
  let Camoufox;try{({Camoufox}=await import('camoufox-js'))}catch{throw safeError('מנוע Camoufox של Bank Bridge אינו מותקן. הרץ שוב install_bank_bridge.bat.','CREDIT_CAMOUFOX_RUNTIME_MISSING')}
  const cfg=PROVIDERS[provider],servicesUrl=`${cfg.baseUrl}/services/ProxyRequestHandler.ashx`;let browser,page;
  try{
    ({browser,page}=await openQualifiedLoginSession(Camoufox,cfg,{interactive,identityDir}));
    await login(page,provider,credentials,servicesUrl);
    const months=buildCreditMonths(startDate,futureMonthsToScrape,now()),current=addUtcMonths(new Date(Date.UTC(now().getUTCFullYear(),now().getUTCMonth(),1)),1),results=[],knownAccounts=new Set(),errors=[];
    for(const month of months){const key=monthKey(month),tier=month<=current?'core':'forecast',started=Date.now();try{const data=await fetchTransactionsForMonth(page,servicesUrl,month,startDate);Object.keys(data).forEach(account=>knownAccounts.add(account));results.push({month:key,tier,data,at:now().toISOString()});onDiagnostic({correlationId,provider,stage:'Transactions',month:key,durationMs:Date.now()-started})}catch(error){const at=now().toISOString();results.push({month:key,tier,error,at});errors.push(publicMonthError(error,key,tier,at));onDiagnostic({correlationId,provider,stage:error?.stage||'Transactions',month:key,durationMs:Date.now()-started,errorClass:error?.code,httpStatus:error?.httpStatus,retryAfterAt:error?.retryAfterAt})}}
    if(!knownAccounts.size&&results.some(result=>!result.error))throw safeError('חברת האשראי לא החזירה כרטיסים באף חודש תקין.','CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'DashboardMonth'});
    const accounts=[...knownAccounts].map(accountNumber=>({accountNumber,months:results.map(result=>result.error?coverageFailure(result.month,result.tier,result.error,result.at):coverageSuccess(result.month,result.tier,result.data[accountNumber]||[],result.at)),pendingTransactions:[],pendingStatus:'missing'}));
    const coreComplete=!results.some(result=>result.tier==='core'&&result.error),forecastFailures=results.filter(result=>result.tier==='forecast'&&result.error).length,coreFailures=results.filter(result=>result.tier==='core'&&result.error).length;
    if(forecastFailures)errors.unshift({code:'CREDIT_PARTIAL_FORECAST',stage:'Forecast',httpStatus:0,message:`חסרים ${forecastFailures} חודשי תחזית; Last Known Good נשמר.`,at:now().toISOString()});
    if(coreFailures)errors.unshift({code:'CREDIT_CORE_COVERAGE_INCOMPLETE',stage:'CoreCoverage',httpStatus:0,message:`חסרים ${coreFailures} חודשי ליבה; זמן ההצלחה המלאה לא התקדם.`,at:now().toISOString()});
    return {success:true,coreComplete,accounts,errors};
  }catch(e){if(String(e?.code||'').startsWith('CREDIT_'))throw e;throw safeError(`סנכרון Camoufox נכשל: ${cleanText(e?.message||e,180)}`,'CREDIT_CAMOUFOX_FAILED')}
  finally{try{await page?.close()}catch{}try{await browser?.close()}catch{}}
}
