import {createHapoalimSessionAdapter} from './hapoalim-session.mjs';
import {createHapoalimProvider} from './hapoalim-provider.mjs';
import {createCreditProfileSession} from './credit-session.mjs';
import {createCreditProvider} from './credit-provider.mjs';
import {runStage,stageError} from './provider-errors.mjs';
import {createBridgeShutdownOwner} from './shutdown-owner.mjs';
import {createBridgeReplacementCommand} from './replacement-command.mjs';
import {isLoopbackPortClosed} from './loopback-port.mjs';
import {createBankBridgeHttpHandler} from './http-handler.mjs';
import {createBankBridgeRoutes} from './http-routes.mjs';
import {bankBridgeErrorResponse as safeError} from './wire-errors.mjs';
import {createConnectionQueries} from './connection-queries.mjs';
import {createFinanceCommands} from './finance-commands.mjs';
import {createDiagnosticQueries} from './diagnostic-queries.mjs';
import http from 'node:http';
import {createBridgeOperationOwner} from './operation-owner.mjs';
import {createConnectionVault} from './connection-vault.mjs';
import {createConnectionCommands,settleConnectionJobs} from './connection-commands.mjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {runProcess,protectText,unprotectText} from './windows-platform.mjs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {
  HAPOALIM_NAVIGATION_STABLE_MS,
  HAPOALIM_DATA_RETRY_LIMIT,
  HAPOALIM_TRANSACTION_LOOKBACK_DAYS,
  HAPOALIM_INITIAL_BACKFILL_DAYS,
  HAPOALIM_TRANSACTION_LIMIT,
  hapoalimTransactionPageState,
  buildHapoalimAdditionalDetailsUrl,
  hapoalimChequeTransactionKind,
  hapoalimCreditSettlementProvider,
  isHapoalimCompletedCreditSettlement,
  isHapoalimCreditPermissionDetails,
  normalizeHapoalimCreditPermissionDetails,
  mergeHapoalimCreditPermissionDetails,
  normalizeHapoalimAdditionalDetails,
  mergeHapoalimAdditionalDetails,
  normalizeRecentTransactions,
  normalizeHapoalimTransaction,
  retryTransientNavigation,
  scraperFailureMessage,
  selectAccountDescriptor,
  waitForTerminalLoginResult,
  ymdDate,
} from './lib.mjs';
import {doctorCamoufox} from './isracard-camoufox.mjs';
import {CREDIT_CONNECTOR_CONTRACT_VERSION,createCreditProviderAdapter} from './credit-adapters.mjs';
import {createCreditDiagnosticLog} from './credit-diagnostics.mjs';
import {creditIdentityDirectory,deleteCreditIdentity,resetCreditIdentities} from './credit-identity.mjs';
import {createBankDiagnosticRun,finishBankDiagnosticRun,recordBankAccountDiagnostic,recordBankTransactionDiagnostic} from './bank-diagnostics.mjs';

const HOST='127.0.0.1';
const PORT=8765;
const BRIDGE_VERSION=73;
const BROWSER_IDENTITY_PROBE_URL=`http://${HOST}:${PORT}/health`;
const HAPOALIM_BASE_URL='https://login.bankhapoalim.co.il';
const APP_DIR=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NetunimKupaBankBridge');
const TOKEN_FILE=path.join(APP_DIR,'bridge-token.txt');
const CREDIT_META_FILE=path.join(APP_DIR,'credit-card-status.json');
const META_FILE=path.join(APP_DIR,'status.json');
const BROWSER_PROFILE_DIR=path.join(APP_DIR,'browser-profile');
const CAMOUFOX_INSTALL_DIR=path.join(APP_DIR,'camoufox');
const CREDIT_IDENTITIES_DIR=path.join(APP_DIR,'credit-identities');
const BANK_DIAGNOSTICS_DIR=path.join(APP_DIR,'diagnostics');
const BANK_DIAGNOSTIC_FILE=path.join(BANK_DIAGNOSTICS_DIR,'bank-latest.json');
const CREDIT_DATA_DIAGNOSTIC_FILE=path.join(BANK_DIAGNOSTICS_DIR,'credit-data-latest.json');
const CHEQUE_IMAGE_CACHE_DIR=path.join(APP_DIR,'cheque-image-cache');
const CHEQUE_IMAGE_RETENTION_DAYS=183;
const CHEQUE_IMAGE_MAX_BYTES=5*1024*1024;
const LEGACY_BANK_CHEQUE_DIAGNOSTIC_FILE=path.join(BANK_DIAGNOSTICS_DIR,'bank-cheque-latest.json');
const creditDiagnostics=createCreditDiagnosticLog({directory:path.join(APP_DIR,'diagnostics'),bridgeVersion:BRIDGE_VERSION,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION});
process.env.CAMOUFOX_INSTALL_DIR=process.env.CAMOUFOX_INSTALL_DIR||CAMOUFOX_INSTALL_DIR;
const operations=createBridgeOperationOwner();
const vault=createConnectionVault({directory:APP_DIR,protectText,unprotectText});
const connections=createConnectionCommands({operations,vault,artifacts:{
  writeBankMeta:writeMeta,
  clearCreditData:deleteCreditDataDiagnostic,
  creditIdentity:profile=>creditIdentityDirectory(CREDIT_IDENTITIES_DIR,profile),
  deleteCreditIdentity:profile=>deleteCreditIdentity(CREDIT_IDENTITIES_DIR,profile),
  clearBank:()=>settleConnectionJobs([deleteBankDiagnostic(),deleteChequeImageCache()]),
  resetCredit:()=>settleConnectionJobs([fs.rm(CREDIT_META_FILE,{force:true}),deleteCreditDataDiagnostic(),resetCreditIdentities(CREDIT_IDENTITIES_DIR)]),
  clearImported:clearImportedConnectionArtifacts,
}});
let activeServer=null;
let cachedBrowserPath='';

async function ensureAppDir(){await fs.mkdir(APP_DIR,{recursive:true,mode:0o700})}
async function ensureToken(){
  await ensureAppDir();
  try{const token=(await fs.readFile(TOKEN_FILE,'utf8')).trim();if(token)return token}catch{}
  const token=randomBytes(32).toString('base64url');
  await fs.writeFile(TOKEN_FILE,token+'\n',{encoding:'utf8',mode:0o600});
  return token;
}
async function readMeta(){
  try{return JSON.parse(await fs.readFile(META_FILE,'utf8'))}
  catch{return {lastScrapeAt:null,lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,lastAvailableAccounts:[],lastAccountRole:'',browserPath:'',sessionUrl:''}}
}
async function writeMeta(patch){const current=await readMeta();await ensureAppDir();await fs.writeFile(META_FILE,JSON.stringify({...current,...patch},null,2),{encoding:'utf8',mode:0o600})}
async function writeBankDiagnostic(run){
  if(!run)return;
  await fs.mkdir(BANK_DIAGNOSTICS_DIR,{recursive:true,mode:0o700});
  const temp=`${BANK_DIAGNOSTIC_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp,JSON.stringify(run,null,2),{encoding:'utf8',mode:0o600});
  await fs.rename(temp,BANK_DIAGNOSTIC_FILE);
}
async function readBankDiagnostic(){
  for(const file of [BANK_DIAGNOSTIC_FILE,LEGACY_BANK_CHEQUE_DIAGNOSTIC_FILE]){
    try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(error){if(error?.code!=='ENOENT')throw error}
  }
  return null;
}
async function deleteBankDiagnostic(){await settleConnectionJobs([fs.rm(BANK_DIAGNOSTIC_FILE,{force:true}),fs.rm(LEGACY_BANK_CHEQUE_DIAGNOSTIC_FILE,{force:true})])}
async function writeCreditDataDiagnostic(payload){
  if(!payload)return;
  await fs.mkdir(BANK_DIAGNOSTICS_DIR,{recursive:true,mode:0o700});
  const temp=`${CREDIT_DATA_DIAGNOSTIC_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp,JSON.stringify(payload,null,2),{encoding:'utf8',mode:0o600});
  await fs.rename(temp,CREDIT_DATA_DIAGNOSTIC_FILE);
}
async function readCreditDataDiagnostic(){try{return JSON.parse(await fs.readFile(CREDIT_DATA_DIAGNOSTIC_FILE,'utf8'))}catch(error){if(error?.code==='ENOENT')return null;throw error}}
async function deleteCreditDataDiagnostic(){await fs.rm(CREDIT_DATA_DIAGNOSTIC_FILE,{force:true})}

function bankCalendarDay(value){
  const digits=String(value??'').replace(/\D/g,'').slice(0,8);if(!/^\d{8}$/.test(digits))return null;
  const y=Number(digits.slice(0,4)),m=Number(digits.slice(4,6)),d=Number(digits.slice(6,8)),time=Date.UTC(y,m-1,d);return Number.isFinite(time)?Math.floor(time/86400000):null;
}
function currentCalendarDay(){const now=new Date();return Math.floor(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/86400000)}
function chequeImageInRetention(eventDate){const day=bankCalendarDay(eventDate),age=day===null?NaN:currentCalendarDay()-day;return Number.isFinite(age)&&age>=0&&age<CHEQUE_IMAGE_RETENTION_DAYS}
function chequeImageRequest(relativeUrl){
  const raw=String(relativeUrl||'').trim();if(!raw)return null;
  let url;try{url=new URL(raw,HAPOALIM_BASE_URL)}catch{return null}
  if(url.origin!==new URL(HAPOALIM_BASE_URL).origin||!url.pathname.startsWith('/ServerServices/current-account/cheques/'))return null;
  const side=url.searchParams.get('isFront');if(side!=='true'&&side!=='false')return null;
  return {url:url.toString(),relative:`${url.pathname}${url.search}`,side:side==='true'?'front':'back'};
}
function chequeImageKey(relative){return createHash('sha256').update(String(relative||''),'utf8').digest('hex')}
function chequeImageCachePaths(key){return {data:path.join(CHEQUE_IMAGE_CACHE_DIR,`${key}.bin`),meta:path.join(CHEQUE_IMAGE_CACHE_DIR,`${key}.json`)}}
function supportedImageType(buffer,declared=''){
  let detected='';
  if(buffer?.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)detected='image/jpeg';
  else if(buffer?.length>=8&&buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))detected='image/png';
  else if(buffer?.length>=12&&buffer.subarray(0,4).toString('ascii')==='RIFF'&&buffer.subarray(8,12).toString('ascii')==='WEBP')detected='image/webp';
  else if(buffer?.length>=6&&['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString('ascii')))detected='image/gif';
  else if(buffer?.length>=2&&buffer.subarray(0,2).toString('ascii')==='BM')detected='image/bmp';
  if(!detected)return '';
  const type=String(declared||'').split(';')[0].trim().toLowerCase();return !type||type==='application/octet-stream'||type===detected?detected:'';
}
async function readCachedChequeImage(key){
  if(!/^[a-f0-9]{64}$/.test(String(key||'')))return null;const files=chequeImageCachePaths(key);
  try{const [metaText,data]=await Promise.all([fs.readFile(files.meta,'utf8'),fs.readFile(files.data)]),meta=JSON.parse(metaText),contentType=supportedImageType(data,meta?.contentType);if(meta?.key!==key||!contentType||!data.length||data.length>CHEQUE_IMAGE_MAX_BYTES||Number(meta?.size)!==data.length)return null;return {key,data,contentType,size:data.length,eventDate:String(meta?.eventDate||'')}}catch{return null}
}
async function writeCachedChequeImage(key,data,{contentType,eventDate}){
  await fs.mkdir(CHEQUE_IMAGE_CACHE_DIR,{recursive:true,mode:0o700});const files=chequeImageCachePaths(key),stamp=`${process.pid}.${Date.now()}`,dataTemp=`${files.data}.${stamp}.tmp`,metaTemp=`${files.meta}.${stamp}.tmp`,meta={schemaVersion:1,key,contentType,size:data.length,eventDate:String(eventDate||''),cachedAt:new Date().toISOString()};
  await fs.writeFile(dataTemp,data,{mode:0o600});await fs.writeFile(metaTemp,JSON.stringify(meta),{encoding:'utf8',mode:0o600});await fs.rename(dataTemp,files.data);await fs.rename(metaTemp,files.meta);return {key,data,contentType,size:data.length,eventDate:meta.eventDate};
}
async function refreshCachedChequeImageDate(cached,eventDate){
  const oldDay=bankCalendarDay(cached?.eventDate),newDay=bankCalendarDay(eventDate);if(newDay===null||oldDay!==null&&newDay<=oldDay)return cached;const files=chequeImageCachePaths(cached.key),stamp=`${process.pid}.${Date.now()}`,metaTemp=`${files.meta}.${stamp}.tmp`,meta={schemaVersion:1,key:cached.key,contentType:cached.contentType,size:cached.size,eventDate:String(eventDate||''),cachedAt:new Date().toISOString()};await fs.writeFile(metaTemp,JSON.stringify(meta),{encoding:'utf8',mode:0o600});await fs.rename(metaTemp,files.meta);return {...cached,eventDate:meta.eventDate};
}
async function fetchChequeImageIntoCache(page,relativeUrl,eventDate){
  const request=chequeImageRequest(relativeUrl);if(!request||!chequeImageInRetention(eventDate))return '';
  const key=chequeImageKey(request.relative),cached=await readCachedChequeImage(key);if(cached){await refreshCachedChequeImageDate(cached,eventDate);return key}
  const result=await page.evaluate(async({url,maxBytes})=>{try{const response=await fetch(url,{method:'GET',credentials:'include',cache:'no-store',headers:{Accept:'image/*'}});if(!response.ok)return {ok:false,status:response.status};const headerSize=Number(response.headers.get('content-length')||0);if(Number.isFinite(headerSize)&&headerSize>maxBytes)return {ok:false,status:413};const blob=await response.blob();if(!blob.size||blob.size>maxBytes)return {ok:false,status:413};const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('image read failed'));reader.readAsDataURL(blob)}),comma=dataUrl.indexOf(',');return {ok:true,status:response.status,contentType:blob.type||response.headers.get('content-type')||'',size:blob.size,base64:comma>=0?dataUrl.slice(comma+1):''}}catch(error){return {ok:false,status:0,message:String(error?.message||error)}}},{url:request.url,maxBytes:CHEQUE_IMAGE_MAX_BYTES});
  if(!result?.ok||!result.base64)return '';const data=Buffer.from(result.base64,'base64');if(!data.length||data.length>CHEQUE_IMAGE_MAX_BYTES)return '';const contentType=supportedImageType(data,result.contentType);if(!contentType)return '';await writeCachedChequeImage(key,data,{contentType,eventDate});return key;
}
function chequeRowIdentity(value){const bank=String(value?.bankNumber??value?.bank??'').trim(),branch=String(value?.branchNumber??value?.branch??'').trim(),account=String(value?.accountNumber??value?.account??'').trim(),number=String(value?.checkNumber??value?.number??'').trim(),amount=Number(value?.amount);return bank&&branch&&account&&number&&Number.isFinite(amount)?`${bank}|${branch}|${account}|${number}|${amount}`:''}
async function attachChequeImageKeys(page,transaction,payload,normalized){
  if(!normalized||!chequeImageInRetention(transaction?.eventDate)||!payload||typeof payload!=='object'||!Array.isArray(payload.list))return normalized;
  const byIdentity=new Map();
  for(const row of payload.list.slice(0,50)){const identity=chequeRowIdentity(row);if(!identity)continue;let imageFrontKey='',imageBackKey='';try{imageFrontKey=await fetchChequeImageIntoCache(page,row?.imageFrontLink,transaction.eventDate)}catch(error){console.error('Bank Bridge cheque front image cache failed:',error?.message||error)}try{imageBackKey=await fetchChequeImageIntoCache(page,row?.imageBackLink,transaction.eventDate)}catch(error){console.error('Bank Bridge cheque back image cache failed:',error?.message||error)}if(imageFrontKey||imageBackKey)byIdentity.set(identity,{imageFrontKey,imageBackKey})}
  if(!byIdentity.size)return normalized;return {...normalized,checkItems:(Array.isArray(normalized.checkItems)?normalized.checkItems:[]).map(item=>({...item,...(byIdentity.get(chequeRowIdentity(item))||{})}))};
}
async function cleanupChequeImageCache(){
  let names;try{names=await fs.readdir(CHEQUE_IMAGE_CACHE_DIR)}catch(error){if(error?.code==='ENOENT')return;throw error}const keys=new Set(names.map(name=>name.match(/^([a-f0-9]{64})\.(?:bin|json)$/)?.[1]).filter(Boolean));for(const key of keys){const cached=await readCachedChequeImage(key);if(cached&&chequeImageInRetention(cached.eventDate))continue;const files=chequeImageCachePaths(key);await Promise.all([fs.rm(files.data,{force:true}),fs.rm(files.meta,{force:true})])}
}
async function deleteChequeImageCache(){await fs.rm(CHEQUE_IMAGE_CACHE_DIR,{recursive:true,force:true})}

async function clearImportedConnectionArtifacts(){
  const cleanupJobs=[
    ['bank-meta',writeMeta({lastScrapeAt:null,lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,lastAvailableAccounts:[],lastAccountRole:''})],
    ['credit-meta',fs.rm(CREDIT_META_FILE,{force:true})],
    ['credit-data-diagnostic',deleteCreditDataDiagnostic()],
    ['bank-diagnostic',deleteBankDiagnostic()],
    ['cheque-image-cache',deleteChequeImageCache()],
    ['credit-browser-identities',resetCreditIdentities(CREDIT_IDENTITIES_DIR)],
  ];
  const cleanupResults=await Promise.allSettled(cleanupJobs.map(([,job])=>job));
  const cleanupWarnings=cleanupResults.flatMap((result,index)=>result.status==='rejected'?[cleanupJobs[index][0]]:[]);
  return cleanupWarnings;
}
async function readCreditMeta(){try{return JSON.parse(await fs.readFile(CREDIT_META_FILE,'utf8'))}catch{return {lastSyncAt:null,lastErrors:[]}}}
async function writeCreditMeta(patch){const current=await readCreditMeta();await ensureAppDir();await fs.writeFile(CREDIT_META_FILE,JSON.stringify({...current,...patch},null,2),{encoding:'utf8',mode:0o600})}
function browserCandidates(){
  const pf=process.env.PROGRAMFILES||'C:\\Program Files';
  const pfx86=process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)';
  const local=process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local');
  return [
    path.join(pf,'Google','Chrome','Application','chrome.exe'),
    path.join(pfx86,'Google','Chrome','Application','chrome.exe'),
    path.join(local,'Google','Chrome','Application','chrome.exe'),
    path.join(pf,'Microsoft','Edge','Application','msedge.exe'),
    path.join(pfx86,'Microsoft','Edge','Application','msedge.exe'),
    path.join(local,'Microsoft','Edge','Application','msedge.exe'),
  ];
}
async function rememberBrowser(candidate){cachedBrowserPath=candidate;await writeMeta({browserPath:candidate});return candidate}
async function findInstalledBrowser(){
  if(cachedBrowserPath)return cachedBrowserPath;
  if(process.platform!=='win32')throw Object.assign(new Error('Bank Bridge is intended for Windows'),{code:'WINDOWS_REQUIRED'});
  const saved=String((await readMeta()).browserPath||'').trim();
  if(saved){try{await fs.access(saved);cachedBrowserPath=saved;return saved}catch{}}
  for(const candidate of browserCandidates()){try{await fs.access(candidate);return rememberBrowser(candidate)}catch{}}
  for(const name of ['chrome.exe','msedge.exe']){
    try{const output=await runProcess('where.exe',[name]);const candidate=output.split(/\r?\n/).map(x=>x.trim()).find(Boolean);if(candidate)return rememberBrowser(candidate)}catch{}
  }
  throw Object.assign(new Error('לא נמצא Google Chrome או Microsoft Edge מותקן במחשב'),{code:'BROWSER_NOT_FOUND'});
}
async function doctorModernPuppeteer(browserPath){
  const imported=await import('puppeteer-modern'),puppeteer=imported.default||imported;
  if(typeof puppeteer?.launch!=='function')throw new Error('puppeteer-modern did not expose a compatible launch API');
  let browser=null;
  try{
    browser=await puppeteer.launch({headless:true,executablePath:browserPath,args:['--no-first-run','--no-default-browser-check']});
    const version=String(await browser.version()||'').trim();
    if(!version)throw new Error('puppeteer-modern launched the browser but did not return a browser version');
    return version;
  }finally{if(browser)try{await browser.close()}catch{}}
}

async function pageFetchJsonOnce(page,{url,method='GET',headers={},body}={}){
  const result=await page.evaluate(async({url,method,headers,body})=>{
    try{
      const response=await fetch(url,{method,headers,body,credentials:'include',cache:'no-store'});
      const text=await response.text();let data=null;
      try{data=text?JSON.parse(text):null}catch{}
      return {ok:response.ok,status:response.status,data,text:text.slice(0,600)};
    }catch(error){return {ok:false,status:0,data:null,text:String(error?.message||error)}}
  },{url,method,headers,body});
  if(!result?.ok){const e=new Error(`בנק הפועלים החזיר שגיאה בקריאת הנתונים${result?.status?` (HTTP ${result.status})`:''}`);e.code='HAPOALIM_API_ERROR';e.httpStatus=result?.status||0;e.detail=result?.text||'';throw e}
  return result.data;
}

async function pageFetchJson(page,requestFactory,{initialReady=null}={}){
  let reusableReady=initialReady;
  return retryTransientNavigation(async()=>{
    let ready=reusableReady;reusableReady=null;
    if(ready&&String(page?.url?.()||'')!==String(ready.href||''))ready=null;
    if(!ready)ready=await waitForHapoalimSessionReady(page,{timeoutMs:20000,pollMs:300,stableMs:HAPOALIM_NAVIGATION_STABLE_MS});
    const request=await requestFactory(ready);
    const data=await pageFetchJsonOnce(page,request);
    return {data,ready};
  },{attempts:HAPOALIM_DATA_RETRY_LIMIT});
}

async function enrichHapoalimTransactions(page,rawTransactions,accountId,{initialReady=null,role='business',diagnosticRun=null}={}){
  const source=Array.isArray(rawTransactions)?rawTransactions:[];
  const enriched=[];
  let reusableReady=initialReady;
  for(const transaction of source){
    const pfmDetails=String(transaction?.pfmDetails||'').trim();
    const transactionDetails=String(transaction?.details||'').trim();
    const chequeKind=hapoalimChequeTransactionKind(transaction);
    const creditProvider=hapoalimCreditSettlementProvider(transaction);
    if(!chequeKind&&creditProvider){
      if(!isHapoalimCompletedCreditSettlement(transaction)){
        recordBankTransactionDiagnostic(diagnosticRun,{role,chequeKind:'',transaction,normalizedTransaction:normalizeHapoalimTransaction(transaction),detailSources:[],mergedAdditionalDetails:null});
        enriched.push(transaction);continue;
      }
      const creditSources=[],warnings=[],diagnosticSources=[];
      const fetchCreditSource=async(relativeUrl,label)=>{
        try{
          const requestUrl=buildHapoalimAdditionalDetailsUrl(HAPOALIM_BASE_URL,relativeUrl,accountId);
          const extraResult=await pageFetchJson(page,async()=>({url:requestUrl}),{initialReady:reusableReady});
          reusableReady=extraResult.ready;
          const normalized=normalizeHapoalimCreditPermissionDetails(extraResult.data);
          creditSources.push(normalized);diagnosticSources.push({source:label,request:requestUrl,response:extraResult.data,normalized});return normalized;
        }catch(error){
          warnings.push(`${label}: ${error?.message||error}`);diagnosticSources.push({source:label,request:relativeUrl,response:null,normalized:null,error:{code:error?.code||'',stage:error?.stage||'',httpStatus:Number(error?.httpStatus)||0,message:error?.message||String(error)}});reusableReady=null;return null;
        }
      };
      if(pfmDetails)await fetchCreditSource(pfmDetails,'פרטי אסמכתת חיוב אשראי');
      if(isHapoalimCreditPermissionDetails(transaction)&&transactionDetails!==pfmDetails)await fetchCreditSource(transactionDetails,'פירוט הרשאת חיוב אשראי');
      const merged=mergeHapoalimCreditPermissionDetails(...creditSources),creditDetails={...merged,detailFetched:creditSources.length>0,...(warnings.length?{warning:`לא ניתן היה לטעון את כל פירוט חיוב האשראי מהבנק: ${warnings.join(' | ')}`}:{})};
      const enrichedTransaction={...transaction,netunimCreditSettlementDetails:creditDetails};
      recordBankTransactionDiagnostic(diagnosticRun,{role,chequeKind:'',transaction,normalizedTransaction:normalizeHapoalimTransaction(enrichedTransaction),detailSources:diagnosticSources,mergedAdditionalDetails:{creditSettlementDetails:creditDetails}});
      enriched.push(enrichedTransaction);continue;
    }
    if(!chequeKind){
      recordBankTransactionDiagnostic(diagnosticRun,{role,chequeKind:'',transaction,normalizedTransaction:normalizeHapoalimTransaction(transaction),detailSources:[],mergedAdditionalDetails:null});
      enriched.push(transaction);continue;
    }
    const detailSources=[],warnings=[],diagnosticSources=[];
    if((!pfmDetails&&!transactionDetails)||Number(transaction?.serialNumber)===0){
      recordBankTransactionDiagnostic(diagnosticRun,{role,chequeKind,transaction,normalizedTransaction:normalizeHapoalimTransaction(transaction),detailSources:[],mergedAdditionalDetails:null});
      enriched.push(transaction);continue;
    }
    let pfmNormalized=null;
    const fetchDetailSource=async(relativeUrl,label,includeTransaction=false)=>{
      try{
        const requestUrl=buildHapoalimAdditionalDetailsUrl(HAPOALIM_BASE_URL,relativeUrl,accountId);
        const extraResult=await pageFetchJson(page,async()=>({url:requestUrl}),{initialReady:reusableReady});
        reusableReady=extraResult.ready;
        let normalized=normalizeHapoalimAdditionalDetails(includeTransaction?{transaction,additionalInformation:extraResult.data}:{additionalInformation:extraResult.data});
        if(!includeTransaction)normalized=await attachChequeImageKeys(page,transaction,extraResult.data,normalized);
        detailSources.push(normalized);
        diagnosticSources.push({source:label,request:requestUrl,response:extraResult.data,normalized});
        return normalized;
      }catch(error){
        warnings.push(`${label}: ${error?.message||error}`);diagnosticSources.push({source:label,request:relativeUrl,response:null,normalized:null,error:{code:error?.code||'',stage:error?.stage||'',httpStatus:Number(error?.httpStatus)||0,message:error?.message||String(error)}});reusableReady=null;return null;
      }
    };
    if(pfmDetails)pfmNormalized=await fetchDetailSource(pfmDetails,'פרטי אסמכתה',true);
    // Hapoalim exposes a second per-transaction `details` link. For cheque rows this can point
    // at the dedicated /current-account/cheques/... endpoint used by the bank's expanded UI.
    // Keep it separate from PFM so a cheque-row reference can never replace the deposit reference.
    if(transactionDetails&&transactionDetails!==pfmDetails)await fetchDetailSource(transactionDetails,'פירוט שיקים',false);
    const details=mergeHapoalimAdditionalDetails(...detailSources);
    const enrichedTransaction={
      ...transaction,
      ...(chequeKind==='deposit'&&pfmNormalized?.referenceNumber?{referenceNumber:pfmNormalized.referenceNumber}:{}),
      ...(detailSources.length?{netunimAdditionalDetails:details}:{}),
      ...(warnings.length?{netunimAdditionalDetailsWarning:`לא ניתן היה לטעון את כל פירוט השיק מהבנק: ${warnings.join(' | ')}`}:{})
    };
    recordBankTransactionDiagnostic(diagnosticRun,{role,chequeKind,transaction,normalizedTransaction:normalizeHapoalimTransaction(enrichedTransaction),detailSources:diagnosticSources,mergedAdditionalDetails:details});
    enriched.push(enrichedTransaction);
  }
  return {transactions:enriched,ready:reusableReady};
}

async function fetchHapoalimAccountSnapshot(page,selected,ready,historyDays=HAPOALIM_TRANSACTION_LOOKBACK_DAYS,{role='business',diagnosticRun=null}={}){
  const accountId=selected.accountId;
  const balanceResult=await runStage('balance',()=>pageFetchJson(page,async current=>{
    const restContext=String(current.restContext||'').replace(/^\/+/, '');
    const apiSiteUrl=`${HAPOALIM_BASE_URL}/${restContext}`;
    return {url:`${apiSiteUrl}/current-account/composite/balanceAndCreditLimit?accountId=${encodeURIComponent(accountId)}&view=details&lang=he`};
  },{initialReady:ready}), 'BALANCE_FETCH_FAILED');
  const balanceData=balanceResult.data,balanceReady=balanceResult.ready;
  const balance=Number(balanceData?.currentBalance);
  const availableBalance=Number.isFinite(Number(balanceData?.withdrawalBalance))?Number(balanceData.withdrawalBalance):null;
  const creditLimit=Number.isFinite(Number(balanceData?.creditLimitAmount))?Number(balanceData.creditLimitAmount):null;
  const creditLimitUsed=Number.isFinite(Number(balanceData?.creditLimitUtilizationAmount))?Number(balanceData.creditLimitUtilizationAmount):null;
  const creditLimitUsedPercent=Number.isFinite(Number(balanceData?.creditLimitUtilizationPercent))?Number(balanceData.creditLimitUtilizationPercent):null;
  if(!Number.isFinite(balance))throw stageError('balance',Object.assign(new Error('בנק הפועלים לא החזיר יתרת עו״ש מספרית לחשבון שנבחר'),{code:'NO_BALANCE'}));

  const end=new Date(),days=Math.min(HAPOALIM_INITIAL_BACKFILL_DAYS,Math.max(1,Number(historyDays)||HAPOALIM_TRANSACTION_LOOKBACK_DAYS));
  const coverageStart=new Date(end);coverageStart.setDate(coverageStart.getDate()-(days-1));
  const isoLocalDate=value=>{const compact=ymdDate(value);return compact?`${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`:''};
  let transactions=[],transactionWarning='',reusableReady=balanceReady;
  let transactionCoverage={complete:false,from:isoLocalDate(coverageStart),to:isoLocalDate(end),days};
  try{
    const all=[],coverageWarnings=[];
    async function fetchWindow(windowStart,windowEnd){
      const txResult=await pageFetchJson(page,async current=>{
        const restContext=String(current.restContext||'').replace(/^\/+/, '');
        const apiSiteUrl=`${HAPOALIM_BASE_URL}/${restContext}`;
        const cookies=await page.cookies(),xsrf=String(cookies.find(cookie=>cookie.name==='XSRF-TOKEN')?.value||'');
        const headers={'Content-Type':'application/json;charset=UTF-8','pageUuid':'/current-account/transactions','uuid':randomUUID()};if(xsrf)headers['X-XSRF-TOKEN']=xsrf;
        return {url:`${apiSiteUrl}/current-account/transactions?accountId=${encodeURIComponent(accountId)}&numItemsPerPage=${HAPOALIM_TRANSACTION_LIMIT}&retrievalEndDate=${ymdDate(windowEnd)}&retrievalStartDate=${ymdDate(windowStart)}&sortCode=1`,method:'POST',headers,body:'[]'};
      },{initialReady:reusableReady});
      reusableReady=txResult.ready;const pageState=hapoalimTransactionPageState(txResult.data,HAPOALIM_TRANSACTION_LIMIT),raw=pageState.transactions;
      const startDay=ymdDate(windowStart),endDay=ymdDate(windowEnd),dayIndex=value=>Date.UTC(Number(value.slice(0,4)),Number(value.slice(4,6))-1,Number(value.slice(6,8)))/86400000,spanDays=Math.max(1,dayIndex(endDay)-dayIndex(startDay)+1);
      if(pageState.isFull&&spanDays>1){
        const mid=new Date(windowStart);mid.setDate(mid.getDate()+Math.floor((spanDays-1)/2));
        const next=new Date(mid);next.setDate(next.getDate()+1);
        await fetchWindow(windowStart,mid);await fetchWindow(next,windowEnd);return;
      }
      if(pageState.isFull){
        const day=isoLocalDate(windowStart),limit=pageState.effectivePageSize||raw.length;
        coverageWarnings.push(`ב-${day} הבנק החזיר ${raw.length} תנועות בגבול העמוד (${limit}); התנועות שהתקבלו נשמרו, אך ייתכן שחסרות תנועות נוספות באותו יום.`);
      }
      const enriched=await enrichHapoalimTransactions(page,raw,accountId,{initialReady:reusableReady,role,diagnosticRun});reusableReady=enriched.ready||reusableReady;all.push(...enriched.transactions);
    }
    const chunkDays=days>HAPOALIM_TRANSACTION_LOOKBACK_DAYS?60:days;
    for(let offset=0;offset<days;offset+=chunkDays){
      const chunkEnd=new Date(end);chunkEnd.setDate(chunkEnd.getDate()-offset);
      const chunkStart=new Date(chunkEnd);chunkStart.setDate(chunkStart.getDate()-Math.min(chunkDays-1,days-offset-1));
      await fetchWindow(chunkStart,chunkEnd);
    }
    transactions=normalizeRecentTransactions(all,all.length);
    transactionCoverage={...transactionCoverage,complete:coverageWarnings.length===0};
    if(coverageWarnings.length)transactionWarning=coverageWarnings.join(' ');
  }catch(e){transactionWarning=`היתרה התקבלה, אבל לא ניתן היה לטעון כרגע תנועות אחרונות: ${e?.message||e}`}

  recordBankAccountDiagnostic(diagnosticRun,{role,bankNumber:selected.bankNumber||'12',branchNumber:selected.branchNumber,accountNumber:selected.accountNumber,balance,availableBalance,creditLimit,creditLimitUsed,creditLimitUsedPercent,transactionCoverage,transactionWarning,normalizedTransactionCount:transactions.length});
  return {snapshot:{balance,availableBalance,creditLimit,creditLimitUsed,creditLimitUsedPercent,accountNumber:selected.accountNumber,branchNumber:selected.branchNumber,accountId,transactions,transactionWarning,transactionCoverage},ready:reusableReady};
}

function configuredAccountSelector(credentials,role){
  const home=role==='home';
  return {bankNumber:'12',branchNumber:home?credentials.homeBranchNumber||'':credentials.businessBranchNumber||credentials.branchNumber||'',accountNumber:home?credentials.homeAccountNumber||'':credentials.businessAccountNumber||credentials.accountNumber||''};
}

function selectConfiguredAccount(openAccounts,credentials,role){
  const selector=configuredAccountSelector(credentials,role);
  try{return selectAccountDescriptor(openAccounts,selector)}
  catch(error){error.accountRole=role;throw error}
}

async function fetchSelectedHapoalimSnapshot(page,credentials,ready,historyDays=HAPOALIM_TRANSACTION_LOOKBACK_DAYS,{diagnosticRun=null}={}){
  const stableReady=ready?.ready?ready:await waitForHapoalimSessionReady(page,{timeoutMs:20000,pollMs:300,stableMs:HAPOALIM_NAVIGATION_STABLE_MS});
  const rawAccounts=Array.isArray(stableReady?.accounts)?stableReady.accounts:[];
  const openAccounts=rawAccounts.filter(account=>Number(account?.accountClosingReasonCode)===0);
  const businessSelected=await runStage('account',()=>Promise.resolve(selectConfiguredAccount(openAccounts,credentials,'business')),'ACCOUNT_SELECTION_FAILED');
  const homeRequested=!!(credentials.homeBranchNumber||credentials.homeAccountNumber);
  let homeSelected=null,homeFailure=null;
  if(homeRequested){
    try{homeSelected=await runStage('account',()=>Promise.resolve(selectConfiguredAccount(openAccounts,credentials,'home')),'ACCOUNT_SELECTION_FAILED')}
    catch(error){homeFailure=safeError(error)}
  }
  if(homeSelected&&homeSelected.accountId===businessSelected.accountId){
    homeFailure=safeError(stageError('account',Object.assign(new Error('החשבון העסקי והחשבון הביתי חייבים להיות שני חשבונות שונים'),{code:'DUPLICATE_ACCOUNT_ROLE',accountRole:'home'}),'ACCOUNT_SELECTION_FAILED'));
    homeSelected=null;
  }
  const businessResult=await fetchHapoalimAccountSnapshot(page,businessSelected,stableReady,historyDays,{role:'business',diagnosticRun});
  let homeResult=null;
  if(homeSelected&&!homeFailure){
    try{homeResult=await fetchHapoalimAccountSnapshot(page,homeSelected,businessResult.ready,historyDays,{role:'home',diagnosticRun})}
    catch(error){error.accountRole='home';homeFailure=safeError(error)}
  }
  const business=businessResult.snapshot,home=homeResult?.snapshot||null;
  const sessionHref=String(page?.url?.()||homeResult?.ready?.href||businessResult.ready?.href||stableReady?.href||'');
  return {...business,accounts:{business,home},accountFailures:{home:homeFailure},sessionHref};
}

async function fetchLocal(pathname,{method='GET',token='',timeoutMs=1200}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(`http://${HOST}:${PORT}${pathname}`,{method,headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal:controller.signal});
    const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
    return {response,data};
  }finally{clearTimeout(timer)}
}
async function waitForPortToClose(timeoutMs=5000){
  const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(await isLoopbackPortClosed({host:HOST,port:PORT}))return true;await new Promise(r=>setTimeout(r,150))}return false;
}
const replacement=createBridgeReplacementCommand({
  probe:async()=>{try{return await fetchLocal('/health')}catch(error){if(await isLoopbackPortClosed({host:HOST,port:PORT}))return null;throw error}},readToken:()=>fs.readFile(TOKEN_FILE,'utf8'),
  shutdown:token=>fetchLocal('/shutdown',{method:'POST',token,timeoutMs:1500}),
  waitUntilStopped:()=>waitForPortToClose(),
});

const providerBrowser={
  findInstalled:findInstalledBrowser,
  loadScrapers:()=>import('israeli-bank-scrapers'),
  profileDirectory:BROWSER_PROFILE_DIR,
  ensureProfile:async()=>{await fs.mkdir(BROWSER_PROFILE_DIR,{recursive:true})},
  identityProbeUrl:BROWSER_IDENTITY_PROBE_URL,
};
const bankSession=createHapoalimSessionAdapter({
  metadata:{read:readMeta},
  clock:{now:()=>Date.now(),delay:ms=>new Promise(resolve=>setTimeout(resolve,ms))},
  waitForTerminal:waitForTerminalLoginResult,
});
const enableHapoalimSessionAwareLogin=bankSession.decorate;
const waitForHapoalimSessionReady=bankSession.ready;
const bankProvider=createHapoalimProvider({
  browser:providerBrowser,
  session:{...bankSession,failureMessage:scraperFailureMessage},
  accounts:{read:fetchSelectedHapoalimSnapshot,lookbackDays:HAPOALIM_TRANSACTION_LOOKBACK_DAYS},
  diagnostics:{
    create:createBankDiagnosticRun,
    finish:finishBankDiagnosticRun,
    write:writeBankDiagnostic,
    report:(label,error)=>console.error(label,error?.message||error),
  },
  cache:{cleanup:cleanupChequeImageCache},
  metadata:{write:writeMeta},
  version:BRIDGE_VERSION,
});
const creditSession=createCreditProfileSession({
  browser:providerBrowser,
  identity:{directory:profile=>creditIdentityDirectory(CREDIT_IDENTITIES_DIR,profile)},
  createAdapter:createCreditProviderAdapter,
  diagnostics:creditDiagnostics,
});
const creditProvider=createCreditProvider({
  sessions:creditSession,
  identity:{remove:profile=>deleteCreditIdentity(CREDIT_IDENTITIES_DIR,profile)},
  diagnostics:creditDiagnostics,
});

const args=new Set(process.argv.slice(2));
if(args.has('--stop-existing')){try{await replacement.stop();process.exit(0)}catch(e){console.error(e?.message||e);process.exit(1)}}
if(args.has('--doctor')){
  try{
    const browserPath=await findInstalledBrowser();
    const digitalV3BrowserVersion=await doctorModernPuppeteer(browserPath);
    const pkg=await import('israeli-bank-scrapers');
    if(!pkg?.createScraper||!pkg?.CompanyTypes?.hapoalim||!pkg?.CompanyTypes?.visaCal||!pkg?.CompanyTypes?.max||!pkg?.CompanyTypes?.isracard||!pkg?.CompanyTypes?.amex)throw new Error('israeli-bank-scrapers did not expose required Hapoalim/Cal/Max/Isracard/Amex support');
    const probe=pkg.createScraper({companyId:pkg.CompanyTypes.hapoalim,startDate:new Date(),showBrowser:false,executablePath:browserPath});
    enableHapoalimSessionAwareLogin(probe,{interactive:true});
    if(typeof probe.initialize!=='function'||typeof probe.login!=='function'||typeof probe.terminate!=='function')throw new Error('Hapoalim scraper lifecycle API is incompatible');
    await doctorCamoufox();
    console.log(`Browser: ${browserPath}`);
    console.log(`DigitalV3 Puppeteer: ${digitalV3BrowserVersion}`);
    console.log(`Camoufox: ${CAMOUFOX_INSTALL_DIR}`);
    console.log('Scraper: Hapoalim + Cal + Max + Isracard native/fallback + Amex Camoufox support, secure multi-profile credit sync, session-aware bank reads OK');
    process.exit(0);
  }catch(e){console.error(e?.message||e);process.exit(1)}
}

const token=await ensureToken();
if(args.has('--init')||args.has('--print-token')){console.log('Bank Bridge key:');console.log(token);console.log(`Credentials directory: ${APP_DIR}`);process.exit(0)}

const service=createConnectionQueries({operations,vault,metadata:{bank:readMeta,credit:readCreditMeta}});
const finance=createFinanceCommands({operations,
  bank:{readCredentials:vault.readCredentials,scrape:bankProvider.read,writeMeta},
  credit:{readProfiles:vault.readCreditProfiles,readMeta:readCreditMeta,scrape:creditProvider.scrape,writeDataDiagnostic:writeCreditDataDiagnostic,writeMeta:writeCreditMeta},
});
const diagnostics=createDiagnosticQueries({creditLog:creditDiagnostics,read:{bank:readBankDiagnostic,creditData:readCreditDataDiagnostic}});
const shutdown=createBridgeShutdownOwner({operations,diagnostics:creditDiagnostics,platform:{
  schedule:(run,delayMs)=>{const timer=setTimeout(run,delayMs);return ()=>clearTimeout(timer)},
  subscribeStop:listener=>{process.on('SIGINT',listener);process.on('SIGTERM',listener);return ()=>{process.off('SIGINT',listener);process.off('SIGTERM',listener)}},
  closeListener:()=>new Promise((resolve,reject)=>activeServer.close(error=>error?reject(error):resolve())),
  exit:()=>process.exit(0),reportError:error=>console.error('Bank Bridge shutdown failed; accepted work was not force-stopped:',error?.message||error),
}});
const routes=createBankBridgeRoutes({version:BRIDGE_VERSION,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION,
  service,connections,finance,diagnostics,
  cheques:{read:async key=>{const image=await readCachedChequeImage(key);return image&&chequeImageInRetention(image.eventDate)?image:null}},
  shutdown:{afterResponse:()=>{void shutdown.request()}},
});
const handler=createBankBridgeHttpHandler({token,routes,admission:{assertAccepting:operations.assertAccepting},health:()=>({ok:true,service:'netunim-kupa-bank-bridge',version:BRIDGE_VERSION,creditContractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION})});
activeServer=http.createServer(handler);
shutdown.start();
activeServer.on('error',e=>{if(e?.code==='EADDRINUSE'){console.error(`Bank Bridge already appears to be running on ${HOST}:${PORT}`);process.exit(0)}console.error(e);process.exit(1)});
activeServer.listen(PORT,HOST,()=>console.log(`Netunim Kupa Bank Bridge v${BRIDGE_VERSION} listening on http://${HOST}:${PORT}`));
