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
  HAPOALIM_POST_LOGIN_TIMEOUT_MS,
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
  INTERACTIVE_AUTH_TIMEOUT_MS,
  SILENT_AUTH_TIMEOUT_MS,
  isTransientNavigationError,
  normalizeRecentTransactions,
  normalizeHapoalimTransaction,
  retryTransientNavigation,
  scraperFailureMessage,
  selectAccountDescriptor,
  waitForTerminalLoginResult,
  ymdDate,
  creditProviderSupported,
  creditAutomaticRetryAfterAt,
  deferredCreditProfileError,
  deferredCamoufoxProfileError,
  expiredCamoufoxLoginPageBlock,
  creditErrorSeverity,
  creditErrorComponent,
} from './lib.mjs';
import {doctorCamoufox} from './isracard-camoufox.mjs';
import {CREDIT_CONNECTOR_CONTRACT_VERSION,createCreditProviderAdapter,normalizeCreditSyncMode} from './credit-adapters.mjs';
import {createCreditDiagnosticLog,diagnosticFingerprint} from './credit-diagnostics.mjs';
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

function stageError(stage,error,code='BANK_DATA_ERROR'){
  const e=error instanceof Error?error:new Error(String(error||'שגיאה לא ידועה'));
  if(!e.stage)e.stage=stage;if(!e.code)e.code=code;return e;
}
async function runStage(stage,fn,code){try{return await fn()}catch(e){throw stageError(stage,e,code)}}

async function readHapoalimSessionState(page){
  return page.evaluate(async()=>{
    const href=String(window.location.href||'');
    const restContext=String(window.bnhpApp?.restContext||'').replace(/^\/+/, '');
    if(!restContext)return {ready:false,href,restContext,status:0,message:'bank app context is not ready'};
    try{
      const response=await fetch(`${window.location.origin}/ServerServices/general/accounts`,{credentials:'include',cache:'no-store'});
      const text=await response.text();let accounts=[];
      try{accounts=text?JSON.parse(text):[]}catch{}
      return {ready:response.ok&&Array.isArray(accounts),href,restContext,status:response.status,accounts,message:response.ok?'':text.slice(0,240)};
    }catch(error){return {ready:false,href,restContext,status:0,message:String(error?.message||error)}}
  });
}

async function hapoalimSessionIsAuthenticated(page){
  try{return !!(await readHapoalimSessionState(page))?.ready}catch{return false}
}

function scraperLoginResultFromTerminal(resultKey,successKey){
  const key=String(resultKey||'').toUpperCase(),success=String(successKey||'SUCCESS').toUpperCase();
  if(key===success)return {success:true};
  const failureKey=key||'GENERAL';
  return {success:false,errorType:failureKey,errorMessage:`Login failed with ${failureKey} error`};
}

function enableHapoalimSessionAwareLogin(scraper,{interactive=false}={}){
  const originalGetLoginOptions=scraper?.getLoginOptions?.bind(scraper),originalLogin=scraper?.login?.bind(scraper);
  if(typeof originalGetLoginOptions!=='function'||typeof originalLogin!=='function')throw Object.assign(new Error('גרסת scraper של הפועלים אינה תואמת למתאם ההתחברות'),{code:'SCRAPER_ADAPTER_INCOMPATIBLE'});
  let activeLogin=null;
  scraper.getLoginOptions=(credentials)=>{
    const options=originalGetLoginOptions(credentials),originalResults=options.possibleResults||{};
    const successKey=Object.keys(originalResults).find(key=>String(key).toUpperCase()==='SUCCESS')||'SUCCESS';
    const originalSuccess=Array.isArray(originalResults[successKey])?originalResults[successKey]:[originalResults[successKey]].filter(Boolean);
    const detectionResults={...originalResults,[successKey]:[...originalSuccess,async()=>hapoalimSessionIsAuthenticated(scraper.page)]};
    const state={successKey,detectionResults,terminalResultKey:''};activeLogin=state;
    const possibleResults=Object.fromEntries(Object.entries(originalResults).map(([key,conditions])=>[key,[...(Array.isArray(conditions)?conditions:[conditions]),async()=>state.terminalResultKey===key]]));
    if(!possibleResults[successKey])possibleResults[successKey]=[async()=>state.terminalResultKey===successKey];
    const timeoutMs=interactive?INTERACTIVE_AUTH_TIMEOUT_MS:SILENT_AUTH_TIMEOUT_MS;
    return {...options,possibleResults,postAction:async()=>{
      const terminal=await waitForTerminalLoginResult(scraper.page,detectionResults,{
        timeoutMs,pollMs:500,
        timeoutCode:interactive?'INTERACTIVE_AUTH_TIMEOUT':'SILENT_AUTH_TIMEOUT',
        timeoutMarker:interactive?'NETUNIM_INTERACTIVE_AUTH_TIMEOUT':'NETUNIM_SILENT_AUTH_TIMEOUT',
        closedCode:interactive?'INTERACTIVE_BROWSER_CLOSED':'BANK_PAGE_CLOSED',
        closedMarker:interactive?'NETUNIM_INTERACTIVE_BROWSER_CLOSED':'NETUNIM_BANK_PAGE_CLOSED',
      });
      state.terminalResultKey=terminal.resultKey;
    }};
  };
  scraper.login=async(credentials)=>{
    try{return await originalLogin(credentials)}
    catch(error){
      if(!isTransientNavigationError(error)||!activeLogin)throw error;
      let resultKey=activeLogin.terminalResultKey;
      if(!resultKey){
        const timeoutMs=interactive?INTERACTIVE_AUTH_TIMEOUT_MS:SILENT_AUTH_TIMEOUT_MS;
        const terminal=await waitForTerminalLoginResult(scraper.page,activeLogin.detectionResults,{
          timeoutMs,pollMs:350,
          timeoutCode:interactive?'INTERACTIVE_AUTH_TIMEOUT':'SILENT_AUTH_TIMEOUT',
          timeoutMarker:interactive?'NETUNIM_INTERACTIVE_AUTH_TIMEOUT':'NETUNIM_SILENT_AUTH_TIMEOUT',
          closedCode:interactive?'INTERACTIVE_BROWSER_CLOSED':'BANK_PAGE_CLOSED',
          closedMarker:interactive?'NETUNIM_INTERACTIVE_BROWSER_CLOSED':'NETUNIM_BANK_PAGE_CLOSED',
        });
        resultKey=terminal.resultKey;activeLogin.terminalResultKey=resultKey;
      }
      return scraperLoginResultFromTerminal(resultKey,activeLogin.successKey);
    }
  };
  return scraper;
}

async function waitForHapoalimSessionReady(page,{timeoutMs=HAPOALIM_POST_LOGIN_TIMEOUT_MS,pollMs=350,stableMs=HAPOALIM_NAVIGATION_STABLE_MS}={}){
  const deadline=Date.now()+Math.max(1000,Number(timeoutMs)||HAPOALIM_POST_LOGIN_TIMEOUT_MS);
  let last={href:'',restContext:'',status:0,message:''},stableKey='',stableSince=0;
  while(Date.now()<deadline){
    if(page?.isClosed?.())throw Object.assign(new Error('חלון הבנק נסגר לפני שניתן היה לקרוא את נתוני החשבון'),{code:'BANK_PAGE_CLOSED'});
    try{
      last=await readHapoalimSessionState(page);
      if(last?.ready){
        const key=`${String(last.href||'')}|${String(last.restContext||'')}`;
        if(key!==stableKey){stableKey=key;stableSince=Date.now()}
        if(Date.now()-stableSince>=Math.max(0,Number(stableMs)||0))return last;
      }else{stableKey='';stableSince=0}
    }catch(e){
      if(!isTransientNavigationError(e))last={...last,message:String(e?.message||e)};
      stableKey='';stableSince=0;
    }
    await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,Math.max(50,deadline-Date.now()))));
  }
  const status=last?.status?` HTTP ${last.status}`:'';
  const e=new Error(`הכניסה לבנק הצליחה, אבל שירות הנתונים של הפועלים לא נשאר יציב מספיק לקריאת נתונים בתוך ${Math.round(timeoutMs/1000)} שניות.${status}`);
  e.code='BANK_SESSION_NOT_READY';e.detail=last;throw e;
}

function safeHapoalimSessionUrl(value){
  try{const url=new URL(String(value||''));return url.origin===HAPOALIM_BASE_URL?`${url.origin}${url.pathname}`:''}catch{return ''}
}

async function tryReuseSavedHapoalimSession(page){
  const sessionUrl=safeHapoalimSessionUrl((await readMeta()).sessionUrl);
  if(!sessionUrl)return null;
  try{
    await page.goto(sessionUrl,{waitUntil:'domcontentloaded',timeout:30000});
    return await waitForHapoalimSessionReady(page,{timeoutMs:8000,pollMs:400});
  }catch{return null}
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

async function scrapeHapoalimSnapshot(credentials,{interactive=false,historyDays=HAPOALIM_TRANSACTION_LOOKBACK_DAYS}={}){
  let scraper=null,success=false,failure=null;
  const diagnosticRun=createBankDiagnosticRun({bridgeVersion:BRIDGE_VERSION});
  try{
    try{await cleanupChequeImageCache()}catch(error){console.error('Bank Bridge cheque image cache cleanup failed:',error?.message||error)}
    const browserPath=await runStage('browser',()=>findInstalledBrowser(),'BROWSER_NOT_FOUND');
    await fs.mkdir(BROWSER_PROFILE_DIR,{recursive:true});
    const {CompanyTypes,createScraper}=await import('israeli-bank-scrapers');
    scraper=createScraper({
      companyId:CompanyTypes.hapoalim,
      startDate:new Date(),
      combineInstallments:false,
      showBrowser:!!interactive,
      executablePath:browserPath,
      args:[`--user-data-dir=${BROWSER_PROFILE_DIR}`,'--profile-directory=Default','--no-first-run','--no-default-browser-check'],
      navigationRetryCount:1,
      defaultTimeout:30000,
    });
    enableHapoalimSessionAwareLogin(scraper,{interactive});
    await runStage('browser',()=>scraper.initialize(),'BROWSER_START_FAILED');
    let ready=await tryReuseSavedHapoalimSession(scraper.page);
    if(!ready){
      let loginResult;
      try{loginResult=await scraper.login({userCode:credentials.userCode,password:credentials.password})}
      catch(e){const [message,code]=scraperFailureMessage({errorType:'GENERIC',errorMessage:e?.message||String(e)});throw stageError('login',Object.assign(new Error(message),{code}))}
      if(!loginResult?.success){const [message,code]=scraperFailureMessage(loginResult);throw stageError('login',Object.assign(new Error(message),{code}))}
      ready=await runStage('session',()=>waitForHapoalimSessionReady(scraper.page),'BANK_SESSION_NOT_READY');
    }
    const snapshot=await runStage('data',()=>fetchSelectedHapoalimSnapshot(scraper.page,credentials,ready,historyDays,{diagnosticRun}),'BANK_DATA_ERROR');
    const sessionUrl=safeHapoalimSessionUrl(snapshot?.sessionHref||ready?.href);
    if(sessionUrl)await writeMeta({sessionUrl});
    success=true;
    const {sessionHref:_,...publicSnapshot}=snapshot;return {...publicSnapshot,fetchedAt:new Date().toISOString()};
  }catch(error){failure=error;throw error}
  finally{
    try{finishBankDiagnosticRun(diagnosticRun,{failure});const captured=['business','home'].some(role=>Number(diagnosticRun.accounts?.[role]?.captured)>0);if(success||captured)await writeBankDiagnostic(diagnosticRun)}catch(error){console.error('Bank Bridge diagnostic write failed:',error?.message||error)}
    if(scraper){try{await scraper.terminate(success)}catch(e){console.error('Bank Bridge browser cleanup failed:',e?.message||e)}}
  }
}

function excludedAccountsForProfile(selection,profileId){return selection.find(row=>row.profileId===profileId)?.excludedAccounts||[]}

async function scrapeCreditProfile(profile,{interactive=false,correlationId='',syncMode='quick',excludedAccountNumbers=[],allowCamoufoxFallback=true}={}){
  const browserPath=await findInstalledBrowser(),{CompanyTypes,createScraper}=await import('israeli-bank-scrapers'),identityDir=creditIdentityDirectory(CREDIT_IDENTITIES_DIR,profile);
  const adapter=createCreditProviderAdapter({profile,CompanyTypes,createScraper,browserPath,identityProbeUrl:BROWSER_IDENTITY_PROBE_URL,interactive,identityDir,correlationId,syncMode,excludedAccountNumbers,allowCamoufoxFallback,onDiagnostic:event=>creditDiagnostics.record({browserEngine:'chromium',...event})});
  return adapter.scrape();
}
async function scrapeAllCreditProfiles(profiles,{interactive=false,previousErrors=[],syncMode='quick',selection=[]}={}){
  const enabled=(Array.isArray(profiles)?profiles:[]).filter(p=>p?.active!==false&&creditProviderSupported(p?.provider));
  if(!enabled.length)throw Object.assign(new Error('לא הוגדרו חיבורי חברות אשראי פעילים'),{code:'CREDIT_NOT_CONFIGURED'});
  const correlationId=randomUUID(),success=[],errors=[],dataDiagnostics=[];let attemptedCount=0,deferredCount=0,coreSuccessCount=0;
  // Deliberately sequential: two identities can use the same issuer, and isolated sequential sessions avoid cross-login cookie races.
  for(const profile of enabled){
    const deferred=deferredCreditProfileError(previousErrors,profile);
    if(deferred){errors.push(deferred);deferredCount++;continue}
    const camoufoxDeferred=deferredCamoufoxProfileError(previousErrors,profile);
    const expiredBlockedIdentity=expiredCamoufoxLoginPageBlock(previousErrors,profile);
    attemptedCount++;
    try{
      if(expiredBlockedIdentity){
        await deleteCreditIdentity(CREDIT_IDENTITIES_DIR,profile);
        await creditDiagnostics.record({correlationId,provider:profile.provider,profileId:profile.profileId,browserEngine:'camoufox',stage:'IdentityRecovery'});
      }
      const result=await scrapeCreditProfile(profile,{interactive,correlationId,syncMode,excludedAccountNumbers:excludedAccountsForProfile(selection,profile.profileId),allowCamoufoxFallback:!camoufoxDeferred});
      if(Array.isArray(result?._dataDiagnostics))dataDiagnostics.push(...result._dataDiagnostics);
      const {_dataDiagnostics:ignoredDataDiagnostics,...publicResult}=result||{};success.push(publicResult);if(publicResult.coreComplete!==false)coreSuccessCount++;if(Array.isArray(publicResult.errors))for(const raw of publicResult.errors){const base={...raw,profileId:raw.profileId||profile.profileId,provider:raw.provider||profile.provider,label:raw.label||profile.label,correlationId},retryAfterAt=creditAutomaticRetryAfterAt(base,Date.parse(base.originalFailureAt||base.at||new Date().toISOString())),severity=creditErrorSeverity(base),component=creditErrorComponent(base),fingerprint=diagnosticFingerprint({...base,errorClass:base.code});errors.push({...base,severity,component,originalFailureAt:base.originalFailureAt||base.at||null,...(retryAfterAt?{retryAfterAt}:{}),diagnosticFingerprint:fingerprint})}
    }
    catch(error){
      const at=new Date().toISOString(),browserEngine=['chromium','camoufox'].includes(String(error?.browserEngine||''))?String(error.browserEngine):'chromium',fallbackFromBrowserEngine=['chromium','camoufox'].includes(String(error?.fallbackFromBrowserEngine||''))?String(error.fallbackFromBrowserEngine):'',base={profileId:profile.profileId,provider:profile.provider,label:profile.label,code:error?.code||'CREDIT_SCRAPE_FAILED',stage:String(error?.stage||'').slice(0,80),httpStatus:Number(error?.httpStatus)||0,message:error?.message||String(error),at,originalFailureAt:at,retryAfterAt:error?.retryAfterAt||null,correlationId,browserEngine,providerStatus:String(error?.providerStatus||'').slice(0,24),providerReturnCode:String(error?.providerReturnCode||'').slice(0,24),loginStep:['navigation','landing-readiness','open-login-popup','credentials-submit','post-submit-navigation','result-detection'].includes(String(error?.loginStep||''))?String(error.loginStep):'',loginState:['authenticated-session','session-init-only','session-auth-only','invalid-password-route','change-password-route','connect-frame','dashboard-url','no-connect-frame','unavailable'].includes(String(error?.loginState||''))?String(error.loginState):'',fallbackFromBrowserEngine,fallbackFromCode:String(error?.fallbackFromCode||'').slice(0,80),fallbackFromStage:String(error?.fallbackFromStage||'').slice(0,80),fallbackFromHttpStatus:Number(error?.fallbackFromHttpStatus)||0},retryAfterAt=creditAutomaticRetryAfterAt(base,Date.parse(at)),severity=creditErrorSeverity(base),component=creditErrorComponent(base),fingerprint=diagnosticFingerprint({...base,errorClass:base.code});
      errors.push({...base,severity,component,...(retryAfterAt?{retryAfterAt}:{}),diagnosticFingerprint:fingerprint});
      // If Chromium was attempted while a prior Camoufox 403 was still cooling down,
      // retain that engine-scoped not-before record when Chromium also fails. This
      // prevents a second manual refresh from immediately re-entering Camoufox.
      if(camoufoxDeferred&&browserEngine!=='camoufox')errors.push(camoufoxDeferred);
      creditDiagnostics.record({correlationId,provider:profile.provider,profileId:profile.profileId,browserEngine,syncMode:normalizeCreditSyncMode(syncMode),stage:base.stage||'Profile',errorClass:base.code,httpStatus:base.httpStatus,retryAfterAt,startupFailureReason:error?.startupFailureReason,providerStatus:base.providerStatus,providerReturnCode:base.providerReturnCode,loginStep:base.loginStep,loginState:base.loginState,fallbackFromBrowserEngine:base.fallbackFromBrowserEngine,fallbackFromCode:base.fallbackFromCode,fallbackFromStage:base.fallbackFromStage,fallbackFromHttpStatus:base.fallbackFromHttpStatus});
    }
  }
  const syncedAt=coreSuccessCount?new Date().toISOString():null;
  return {contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION,correlationId,profiles:success,errors,syncedAt,attemptedCount,deferredCount,coreSuccessCount,_dataDiagnostics:dataDiagnostics};
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
  bank:{readCredentials:vault.readCredentials,scrape:scrapeHapoalimSnapshot,writeMeta},
  credit:{readProfiles:vault.readCreditProfiles,readMeta:readCreditMeta,scrape:scrapeAllCreditProfiles,writeDataDiagnostic:writeCreditDataDiagnostic,writeMeta:writeCreditMeta},
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
