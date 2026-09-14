import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {
  HAPOALIM_POST_LOGIN_TIMEOUT_MS,
  HAPOALIM_NAVIGATION_STABLE_MS,
  HAPOALIM_DATA_RETRY_LIMIT,
  HAPOALIM_TRANSACTION_LOOKBACK_DAYS,
  HAPOALIM_INITIAL_BACKFILL_DAYS,
  HAPOALIM_TRANSACTION_LIMIT,
  buildHapoalimAdditionalDetailsUrl,
  hapoalimChequeTransactionKind,
  normalizeHapoalimAdditionalDetails,
  mergeHapoalimAdditionalDetails,
  INTERACTIVE_AUTH_TIMEOUT_MS,
  SILENT_AUTH_TIMEOUT_MS,
  isTransientNavigationError,
  normalizeRecentTransactions,
  normalizeHapoalimTransaction,
  parseAccountSelector,
  retryTransientNavigation,
  scraperFailureMessage,
  selectAccountDescriptor,
  waitForTerminalLoginResult,
  ymdDate,
  creditProviderSupported,
  creditProfilePublic,
  creditProfilesShareLoginIdentity,
  normalizeCreditProfileInput,
  creditAutomaticRetryAfterAt,
  deferredCreditProfileError,
  deferredCamoufoxProfileError,
  expiredCamoufoxLoginPageBlock,
  creditErrorSeverity,
  creditErrorComponent,
} from './lib.mjs';
import {doctorCamoufox} from './isracard-camoufox.mjs';
import {CREDIT_CONNECTOR_CONTRACT_VERSION,createCreditProviderAdapter} from './credit-adapters.mjs';
import {createCreditDiagnosticLog,diagnosticFingerprint} from './credit-diagnostics.mjs';
import {buildCreditDataDiagnosticPayload,creditDataDiagnosticFilename} from './credit-data-diagnostics.mjs';
import {creditIdentityDirectory,deleteCreditIdentity,resetCreditIdentities} from './credit-identity.mjs';
import {bankDiagnosticExportPayload,bankDiagnosticFilename,createBankDiagnosticRun,finishBankDiagnosticRun,recordBankAccountDiagnostic,recordBankTransactionDiagnostic} from './bank-diagnostics.mjs';

const HOST='127.0.0.1';
const PORT=8765;
const BRIDGE_VERSION=53;
const HAPOALIM_BASE_URL='https://login.bankhapoalim.co.il';
const APP_DIR=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NetunimKupaBankBridge');
const TOKEN_FILE=path.join(APP_DIR,'bridge-token.txt');
const CREDENTIALS_FILE=path.join(APP_DIR,'hapoalim-credentials.dpapi');
const CREDIT_PROFILES_FILE=path.join(APP_DIR,'credit-card-profiles.dpapi');
const CREDIT_META_FILE=path.join(APP_DIR,'credit-card-status.json');
const META_FILE=path.join(APP_DIR,'status.json');
const BROWSER_PROFILE_DIR=path.join(APP_DIR,'browser-profile');
const CAMOUFOX_INSTALL_DIR=path.join(APP_DIR,'camoufox');
const CREDIT_IDENTITIES_DIR=path.join(APP_DIR,'credit-identities');
const BANK_DIAGNOSTICS_DIR=path.join(APP_DIR,'diagnostics');
const BANK_DIAGNOSTIC_FILE=path.join(BANK_DIAGNOSTICS_DIR,'bank-latest.json');
const CREDIT_DATA_DIAGNOSTIC_FILE=path.join(BANK_DIAGNOSTICS_DIR,'credit-data-latest.json');
const CHEQUE_IMAGE_CACHE_DIR=path.join(APP_DIR,'cheque-image-cache');
const CHEQUE_IMAGE_RETENTION_DAYS=60;
const CHEQUE_IMAGE_MAX_BYTES=5*1024*1024;
const LEGACY_BANK_CHEQUE_DIAGNOSTIC_FILE=path.join(BANK_DIAGNOSTICS_DIR,'bank-cheque-latest.json');
const creditDiagnostics=createCreditDiagnosticLog({directory:path.join(APP_DIR,'diagnostics'),bridgeVersion:BRIDGE_VERSION,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION});
process.env.CAMOUFOX_INSTALL_DIR=process.env.CAMOUFOX_INSTALL_DIR||CAMOUFOX_INSTALL_DIR;
let scrapeBusy=false;
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
async function deleteBankDiagnostic(){await Promise.all([fs.rm(BANK_DIAGNOSTIC_FILE,{force:true}),fs.rm(LEGACY_BANK_CHEQUE_DIAGNOSTIC_FILE,{force:true})])}
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

function runProcess(command,args,{input=''}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
    child.on('error',reject);
    child.on('close',code=>code===0?resolve(out.trim()):reject(Object.assign(new Error(err.trim()||out.trim()||`${command} exited with ${code}`),{exitCode:code})));
    child.stdin.end(input);
  });
}
function runPowerShell(script,input=''){
  if(process.platform!=='win32')return Promise.reject(new Error('Bank Bridge credential encryption is supported on Windows only'));
  return runProcess('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{input});
}

async function protectText(text){
  const source=Buffer.from(text,'utf8').toString('base64');
  const script="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=[Console]::In.ReadToEnd().Trim();$raw=[Convert]::FromBase64String($s);$enc=[System.Security.Cryptography.ProtectedData]::Protect($raw,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($enc))";
  return runPowerShell(script,source);
}
async function unprotectText(blob){
  const script="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=[Console]::In.ReadToEnd().Trim();$enc=[Convert]::FromBase64String($s);$raw=[System.Security.Cryptography.ProtectedData]::Unprotect($enc,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($raw))";
  const plain64=await runPowerShell(script,blob);return Buffer.from(plain64,'base64').toString('utf8');
}
async function writeCredentials(credentials){await ensureAppDir();const encrypted=await protectText(JSON.stringify(credentials));await fs.writeFile(CREDENTIALS_FILE,encrypted+'\n',{encoding:'utf8',mode:0o600})}
function normalizeStoredCredentials(value){
  if(!value||typeof value!=='object')return null;
  const legacyAccount=String(value.accountNumber||'').trim(),legacyBranch=String(value.branchNumber||'').trim();
  const legacySelector=legacyBranch?{bankNumber:'12',branchNumber:legacyBranch.replace(/\D/g,''),accountNumber:legacyAccount.replace(/\D/g,'')}:parseAccountSelector(legacyAccount);
  const businessBranchNumber=String(value.businessBranchNumber??legacySelector.branchNumber??'').replace(/\D/g,'');
  const businessAccountNumber=String(value.businessAccountNumber??legacySelector.accountNumber??'').replace(/\D/g,'');
  const homeBranchNumber=String(value.homeBranchNumber||'').replace(/\D/g,'');
  const homeAccountNumber=String(value.homeAccountNumber||'').replace(/\D/g,'');
  return {...value,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber,branchNumber:businessBranchNumber,accountNumber:businessAccountNumber};
}
async function readCredentials(){try{const encrypted=(await fs.readFile(CREDENTIALS_FILE,'utf8')).trim();if(!encrypted)return null;return normalizeStoredCredentials(JSON.parse(await unprotectText(encrypted)))}catch(e){if(e?.code==='ENOENT')return null;throw e}}
async function deleteCredentials(){await fs.rm(CREDENTIALS_FILE,{force:true})}

async function readCreditProfiles(){
  try{
    const encrypted=(await fs.readFile(CREDIT_PROFILES_FILE,'utf8')).trim();if(!encrypted)return [];
    const parsed=JSON.parse(await unprotectText(encrypted));return Array.isArray(parsed)?parsed.filter(x=>x&&typeof x==='object'):[];
  }catch(e){if(e?.code==='ENOENT')return [];throw e}
}
async function writeCreditProfiles(profiles){await ensureAppDir();const encrypted=await protectText(JSON.stringify(Array.isArray(profiles)?profiles:[]));await fs.writeFile(CREDIT_PROFILES_FILE,encrypted+'\n',{encoding:'utf8',mode:0o600})}
async function resetCreditProfiles(){await Promise.all([fs.rm(CREDIT_PROFILES_FILE,{force:true}),fs.rm(CREDIT_META_FILE,{force:true}),deleteCreditDataDiagnostic(),resetCreditIdentities(CREDIT_IDENTITIES_DIR)])}
async function readCreditMeta(){try{return JSON.parse(await fs.readFile(CREDIT_META_FILE,'utf8'))}catch{return {lastSyncAt:null,lastErrors:[]}}}
async function writeCreditMeta(patch){const current=await readCreditMeta();await ensureAppDir();await fs.writeFile(CREDIT_META_FILE,JSON.stringify({...current,...patch},null,2),{encoding:'utf8',mode:0o600})}
function publicCreditProfiles(profiles){return (Array.isArray(profiles)?profiles:[]).map(creditProfilePublic).filter(x=>x.profileId&&creditProviderSupported(x.provider))}

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

function tokenEqual(expected,actual){const a=Buffer.from(String(expected||'')),b=Buffer.from(String(actual||''));return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)}
function corsHeaders(req){const origin=req.headers.origin||'*';return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Private-Network':'true','Access-Control-Max-Age':'600','Cache-Control':'no-store','Vary':'Origin'}}
function sendJson(req,res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...corsHeaders(req)});res.end(JSON.stringify(data))}
async function readJson(req){
  let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw Object.assign(new Error('הבקשה גדולה מדי'),{code:'REQUEST_TOO_LARGE'});chunks.push(chunk)}
  if(!chunks.length)return {};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(new Error('JSON לא תקין'),{code:'INVALID_JSON'})}
}
function authToken(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():''}
function safeError(error){return {ok:false,code:error?.code||'BRIDGE_ERROR',stage:error?.stage||'',message:error?.message||'שגיאת Bank Bridge',httpStatus:Number(error?.httpStatus)||0,availableAccounts:Array.isArray(error?.availableAccounts)?error.availableAccounts:[],accountRole:error?.accountRole==='home'?'home':error?.accountRole==='business'?'business':'',creditErrors:Array.isArray(error?.creditErrors)?error.creditErrors:[]}}
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
    const all=[];
    async function fetchWindow(windowStart,windowEnd){
      const txResult=await pageFetchJson(page,async current=>{
        const restContext=String(current.restContext||'').replace(/^\/+/, '');
        const apiSiteUrl=`${HAPOALIM_BASE_URL}/${restContext}`;
        const cookies=await page.cookies(),xsrf=String(cookies.find(cookie=>cookie.name==='XSRF-TOKEN')?.value||'');
        const headers={'Content-Type':'application/json;charset=UTF-8','pageUuid':'/current-account/transactions','uuid':randomUUID()};if(xsrf)headers['X-XSRF-TOKEN']=xsrf;
        return {url:`${apiSiteUrl}/current-account/transactions?accountId=${encodeURIComponent(accountId)}&numItemsPerPage=${HAPOALIM_TRANSACTION_LIMIT}&retrievalEndDate=${ymdDate(windowEnd)}&retrievalStartDate=${ymdDate(windowStart)}&sortCode=1`,method:'POST',headers,body:'[]'};
      },{initialReady:reusableReady});
      reusableReady=txResult.ready;const raw=Array.isArray(txResult.data?.transactions)?txResult.data.transactions:[];
      const spanDays=Math.floor((windowEnd-windowStart)/86400000)+1;
      if(raw.length>=HAPOALIM_TRANSACTION_LIMIT){
        if(spanDays<=1)throw Object.assign(new Error('יום יחיד החזיר 1000 תנועות או יותר; אי אפשר להבטיח היסטוריה מלאה בלי pagination של הבנק'),{code:'BANK_HISTORY_DAY_FULL'});
        const mid=new Date(windowStart.getTime()+Math.floor((windowEnd-windowStart)/2));
        const next=new Date(mid);next.setDate(next.getDate()+1);
        await fetchWindow(windowStart,mid);await fetchWindow(next,windowEnd);return;
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
    transactionCoverage={...transactionCoverage,complete:true};
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
  if(scrapeBusy)throw Object.assign(new Error('כבר מתבצע עדכון מול הבנק'),{code:'SCRAPE_BUSY'});
  scrapeBusy=true;
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
    scrapeBusy=false;
  }
}

function normalizeCreditSyncSelection(value){return (Array.isArray(value)?value:[]).slice(0,100).map(row=>({profileId:String(row?.profileId||'').trim().slice(0,80),excludedAccounts:[...new Set((Array.isArray(row?.excludedAccounts)?row.excludedAccounts:[]).slice(0,100).map(account=>String(account||'').trim().slice(0,80)).filter(Boolean))]})).filter(row=>row.profileId&&row.excludedAccounts.length)}
function excludedAccountsForProfile(selection,profileId){return selection.find(row=>row.profileId===profileId)?.excludedAccounts||[]}

async function scrapeCreditProfile(profile,{interactive=false,correlationId='',syncMode='daily',excludedAccountNumbers=[],allowCamoufoxFallback=true}={}){
  const browserPath=await findInstalledBrowser(),{CompanyTypes,createScraper}=await import('israeli-bank-scrapers'),identityDir=creditIdentityDirectory(CREDIT_IDENTITIES_DIR,profile);
  const adapter=createCreditProviderAdapter({profile,CompanyTypes,createScraper,browserPath,interactive,identityDir,correlationId,syncMode,excludedAccountNumbers,allowCamoufoxFallback,onDiagnostic:event=>creditDiagnostics.record({browserEngine:'chromium',...event})});
  return adapter.scrape();
}
async function scrapeAllCreditProfiles(profiles,{interactive=false,previousErrors=[],syncMode='daily',selection=[]}={}){
  if(scrapeBusy)throw Object.assign(new Error('כבר מתבצע עדכון פיננסי ב-Bank Bridge'),{code:'SCRAPE_BUSY'});
  scrapeBusy=true;
  try{
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
        const at=new Date().toISOString(),browserEngine=['chromium','camoufox'].includes(String(error?.browserEngine||''))?String(error.browserEngine):'chromium',base={profileId:profile.profileId,provider:profile.provider,label:profile.label,code:error?.code||'CREDIT_SCRAPE_FAILED',stage:String(error?.stage||'').slice(0,80),httpStatus:Number(error?.httpStatus)||0,message:error?.message||String(error),at,originalFailureAt:at,retryAfterAt:error?.retryAfterAt||null,correlationId,browserEngine},retryAfterAt=creditAutomaticRetryAfterAt(base,Date.parse(at)),severity=creditErrorSeverity(base),component=creditErrorComponent(base),fingerprint=diagnosticFingerprint({...base,errorClass:base.code});
        errors.push({...base,severity,component,...(retryAfterAt?{retryAfterAt}:{}),diagnosticFingerprint:fingerprint});
        // If Chromium was attempted while a prior Camoufox 403 was still cooling down,
        // retain that engine-scoped not-before record when Chromium also fails. This
        // prevents a second manual refresh from immediately re-entering Camoufox.
        if(camoufoxDeferred&&browserEngine!=='camoufox')errors.push(camoufoxDeferred);
        creditDiagnostics.record({correlationId,provider:profile.provider,profileId:profile.profileId,browserEngine,stage:base.stage||'Profile',errorClass:base.code,httpStatus:base.httpStatus,retryAfterAt,startupFailureReason:error?.startupFailureReason});
      }
    }
    const syncedAt=coreSuccessCount?new Date().toISOString():null;
    return {contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION,correlationId,profiles:success,errors,syncedAt,attemptedCount,deferredCount,coreSuccessCount,_dataDiagnostics:dataDiagnostics};
  }finally{scrapeBusy=false}
}

async function handler(req,res,token){
  const pathname=new URL(req.url||'/',`http://${HOST}:${PORT}`).pathname,route=pathname.startsWith('/v2/credit')?pathname.slice(3):pathname;
  if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders(req));res.end();return}
  if(req.method==='GET'&&pathname==='/health'){sendJson(req,res,200,{ok:true,service:'netunim-kupa-bank-bridge',version:BRIDGE_VERSION,creditContractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION});return}
  if(!tokenEqual(token,authToken(req))){sendJson(req,res,401,{ok:false,code:'UNAUTHORIZED',message:'מפתח Bank Bridge שגוי'});return}
  try{
    if(req.method==='GET'&&pathname==='/status'){
      const credentials=await readCredentials(),meta=await readMeta();
      sendJson(req,res,200,{ok:true,bridgeVersion:BRIDGE_VERSION,configured:!!credentials,branchNumber:credentials?.businessBranchNumber||credentials?.branchNumber||'',accountNumber:credentials?.businessAccountNumber||credentials?.accountNumber||'',businessBranchNumber:credentials?.businessBranchNumber||credentials?.branchNumber||'',businessAccountNumber:credentials?.businessAccountNumber||credentials?.accountNumber||'',homeBranchNumber:credentials?.homeBranchNumber||'',homeAccountNumber:credentials?.homeAccountNumber||'',lastScrapeAt:meta.lastScrapeAt||null,lastError:meta.lastError||'',lastErrorAt:meta.lastErrorAt||null,lastErrorCode:meta.lastErrorCode||'',lastErrorStage:meta.lastErrorStage||'',lastErrorHttpStatus:Number(meta.lastErrorHttpStatus)||0,lastWarning:meta.lastWarning||'',lastWarningCode:meta.lastWarningCode||'',lastWarningStage:meta.lastWarningStage||'',lastWarningHttpStatus:Number(meta.lastWarningHttpStatus)||0,accountRole:meta.lastAccountRole==='home'?'home':meta.lastAccountRole==='business'?'business':'',availableAccounts:Array.isArray(meta.lastAvailableAccounts)?meta.lastAvailableAccounts:[]});return;
    }
    if(req.method==='GET'&&route==='/credit/status'){
      const profiles=await readCreditProfiles(),meta=await readCreditMeta();
      sendJson(req,res,200,{ok:true,bridgeVersion:BRIDGE_VERSION,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION,profiles:publicCreditProfiles(profiles),lastSyncAt:meta.lastSyncAt||null,lastErrors:Array.isArray(meta.lastErrors)?meta.lastErrors:[],lastCorrelationId:meta.lastCorrelationId||null,lastAttemptedCount:Math.max(0,Math.trunc(Number(meta.lastAttemptedCount)||0)),lastDeferredCount:Math.max(0,Math.trunc(Number(meta.lastDeferredCount)||0))});return;
    }
    if(req.method==='GET'&&route==='/credit/diagnostics'){
      sendJson(req,res,200,{ok:true,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION,events:await creditDiagnostics.summary({limit:500})});return;
    }
    if(req.method==='GET'&&route==='/credit/data-diagnostics'){
      const payload=await readCreditDataDiagnostic();
      if(!payload){sendJson(req,res,200,{ok:true,available:false,message:'עדיין אין אבחון נתוני אשראי מקומי. בצע רענון אשראי ולאחריו ייצא את הקובץ.'});return}
      const cardCount=(Array.isArray(payload.profiles)?payload.profiles:[]).reduce((sum,profile)=>sum+(Array.isArray(profile?.accounts)?profile.accounts.length:0),0);
      sendJson(req,res,200,{ok:true,available:true,generatedAt:payload.generatedAt||null,filename:creditDataDiagnosticFilename(payload),data:payload,cardCount,schemaVersion:Number(payload.schemaVersion)||1});return;
    }
    if(req.method==='GET'&&pathname==='/bank/diagnostics'){
      const diagnostic=await readBankDiagnostic();
      if(!diagnostic){sendJson(req,res,200,{ok:true,available:false,message:'עדיין אין אבחון בנק מקומי. בצע רענון בנק ולאחריו ייצא את הקובץ.'});return}
      const payload=bankDiagnosticExportPayload(diagnostic),accounts=payload?.accounts||{};
      const transactionCount=['business','home'].reduce((sum,role)=>sum+Number(accounts?.[role]?.captured||0),0);
      sendJson(req,res,200,{ok:true,available:true,generatedAt:payload.finishedAt||payload.startedAt||null,filename:bankDiagnosticFilename(payload),data:payload,transactionCount,schemaVersion:Number(payload.schemaVersion)||1});return;
    }
    const chequeImageMatch=req.method==='GET'?pathname.match(/^\/bank\/cheque-image\/([a-f0-9]{64})$/):null;
    if(chequeImageMatch){const image=await readCachedChequeImage(chequeImageMatch[1]);if(!image||!chequeImageInRetention(image.eventDate)){sendJson(req,res,404,{ok:false,code:'CHEQUE_IMAGE_NOT_FOUND',message:'תמונת השיק אינה זמינה עוד ב-Bank Bridge המקומי'});return}res.writeHead(200,{...corsHeaders(req),'Content-Type':image.contentType,'Content-Length':String(image.size),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(image.data);return}
    if(req.method==='POST'&&route==='/credit/profiles'){
      const body=await readJson(req),profiles=await readCreditProfiles(),requestedId=String(body.profileId||'').trim();
      const existing=requestedId?profiles.find(p=>p.profileId===requestedId):null;
      const normalized=normalizeCreditProfileInput({...body,profileId:requestedId||randomUUID()},existing||null);
      const duplicate=profiles.find(p=>p.profileId!==normalized.profileId&&creditProfilesShareLoginIdentity(p,normalized));
      if(duplicate)throw Object.assign(new Error(`כבר קיים חיבור ${creditProfilePublic(duplicate).label} לאותה זהות בחברה. חיבור אחד מחזיר את כל הכרטיסים של אותה זהות; אין ליצור חיבור נפרד לכל כרטיס.`),{code:'CREDIT_DUPLICATE_LOGIN'});
      const next=existing?profiles.map(p=>p.profileId===existing.profileId?normalized:p):[...profiles,normalized];
      await writeCreditProfiles(next);await deleteCreditDataDiagnostic();if(existing&&creditIdentityDirectory(CREDIT_IDENTITIES_DIR,existing)!==creditIdentityDirectory(CREDIT_IDENTITIES_DIR,normalized))await deleteCreditIdentity(CREDIT_IDENTITIES_DIR,existing);sendJson(req,res,200,{ok:true,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION,profile:creditProfilePublic(normalized),profiles:publicCreditProfiles(next)});return;
    }
    if(req.method==='POST'&&route==='/credit/reset'){
      if(scrapeBusy)throw Object.assign(new Error('לא ניתן לאפס חיבורי אשראי בזמן שמתבצע סנכרון'),{code:'SCRAPE_BUSY'});
      await resetCreditProfiles();sendJson(req,res,200,{ok:true,profiles:[],lastSyncAt:null,lastErrors:[]});return;
    }
    if(req.method==='DELETE'&&route==='/credit/profiles'){
      const body=await readJson(req),profileId=String(body.profileId||'').trim(),profiles=await readCreditProfiles();
      if(!profileId)throw Object.assign(new Error('חסר מזהה חיבור אשראי למחיקה'),{code:'MISSING_PROFILE_ID'});
      const removed=profiles.find(p=>p.profileId===profileId),next=profiles.filter(p=>p.profileId!==profileId);await writeCreditProfiles(next);await deleteCreditDataDiagnostic();if(removed)await deleteCreditIdentity(CREDIT_IDENTITIES_DIR,removed);sendJson(req,res,200,{ok:true,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION,profiles:publicCreditProfiles(next)});return;
    }
    if(req.method==='POST'&&route==='/credit/sync'){
      const body=await readJson(req),profiles=await readCreditProfiles(),meta=await readCreditMeta(),syncMode=body.syncMode==='full'?'full':'daily',selection=normalizeCreditSyncSelection(body.selection);
      const result=await scrapeAllCreditProfiles(profiles,{interactive:!!body.interactive,previousErrors:meta.lastErrors,syncMode,selection}),rawSamples=Array.isArray(result?._dataDiagnostics)?result._dataDiagnostics:[],publicResult={...result};delete publicResult._dataDiagnostics;
      if(publicResult.profiles.length)await writeCreditDataDiagnostic(buildCreditDataDiagnosticPayload({correlationId:publicResult.correlationId,profiles:publicResult.profiles,rawSamples}));
      await writeCreditMeta({...(publicResult.syncedAt?{lastSyncAt:publicResult.syncedAt}:{}),lastErrors:publicResult.errors,lastCorrelationId:publicResult.correlationId,lastAttemptedCount:publicResult.attemptedCount,lastDeferredCount:publicResult.deferredCount});
      if(!publicResult.profiles.length&&publicResult.errors.length&&publicResult.attemptedCount>0){const e=new Error(publicResult.errors.map(x=>x.message).join(' | '));e.code='CREDIT_SYNC_FAILED';e.creditErrors=publicResult.errors;throw e}
      sendJson(req,res,200,{ok:true,...publicResult});return;
    }
    if(req.method==='POST'&&pathname==='/credentials'){
      const body=await readJson(req),userCode=String(body.userCode||'').trim(),password=String(body.password||'');
      const businessBranchNumber=String(body.businessBranchNumber??body.branchNumber??'').replace(/\D/g,''),businessAccountNumber=String(body.businessAccountNumber??body.accountNumber??'').replace(/\D/g,'');
      const homeBranchNumber=String(body.homeBranchNumber||'').replace(/\D/g,''),homeAccountNumber=String(body.homeAccountNumber||'').replace(/\D/g,'');
      if(!userCode||!password)throw Object.assign(new Error('חסרים קוד משתמש או סיסמה'),{code:'MISSING_CREDENTIALS'});
      if((businessBranchNumber&&!businessAccountNumber)||(!businessBranchNumber&&businessAccountNumber))throw Object.assign(new Error('לחשבון העסקי יש להזין גם סניף וגם מספר חשבון'),{code:'INCOMPLETE_ACCOUNT_SELECTOR',accountRole:'business'});
      if((homeBranchNumber&&!homeAccountNumber)||(!homeBranchNumber&&homeAccountNumber))throw Object.assign(new Error('לחשבון הביתי יש להזין גם סניף וגם מספר חשבון'),{code:'INCOMPLETE_ACCOUNT_SELECTOR',accountRole:'home'});
      if(businessBranchNumber&&homeBranchNumber&&businessBranchNumber===homeBranchNumber&&businessAccountNumber===homeAccountNumber)throw Object.assign(new Error('החשבון העסקי והחשבון הביתי חייבים להיות שני חשבונות שונים'),{code:'DUPLICATE_ACCOUNT_ROLE',accountRole:'home'});
      await writeCredentials({userCode,password,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber});
      await writeMeta({lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,lastAvailableAccounts:[],lastAccountRole:''});
      sendJson(req,res,200,{ok:true,configured:true,branchNumber:businessBranchNumber,accountNumber:businessAccountNumber,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber});return;
    }
    if(req.method==='POST'&&pathname==='/account-selection'){
      const body=await readJson(req),role=body.role==='home'?'home':'business',branchNumber=String(body.branchNumber||'').replace(/\D/g,''),accountNumber=String(body.accountNumber||'').replace(/\D/g,'');
      if(!branchNumber||!accountNumber)throw Object.assign(new Error('יש לבחור גם סניף וגם מספר חשבון'),{code:'INCOMPLETE_ACCOUNT_SELECTOR',accountRole:role});
      const credentials=await readCredentials();if(!credentials)throw Object.assign(new Error('לא נשמרו פרטי בנק הפועלים ב-Bank Bridge'),{code:'NOT_CONFIGURED'});
      const patch=role==='home'?{homeBranchNumber:branchNumber,homeAccountNumber:accountNumber}:{businessBranchNumber:branchNumber,businessAccountNumber:accountNumber,branchNumber,accountNumber};
      const next=normalizeStoredCredentials({...credentials,...patch});
      if(next.businessBranchNumber&&next.homeBranchNumber&&next.businessBranchNumber===next.homeBranchNumber&&next.businessAccountNumber===next.homeAccountNumber)throw Object.assign(new Error('החשבון העסקי והחשבון הביתי חייבים להיות שני חשבונות שונים'),{code:'DUPLICATE_ACCOUNT_ROLE',accountRole:role});
      await writeCredentials(next);
      await writeMeta({lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,lastAvailableAccounts:[],lastAccountRole:''});
      sendJson(req,res,200,{ok:true,configured:true,role,branchNumber,accountNumber,businessBranchNumber:next.businessBranchNumber,businessAccountNumber:next.businessAccountNumber,homeBranchNumber:next.homeBranchNumber,homeAccountNumber:next.homeAccountNumber});return;
    }
    if(req.method==='DELETE'&&pathname==='/credentials'){
      await Promise.all([deleteCredentials(),deleteBankDiagnostic(),deleteChequeImageCache()]);await writeMeta({lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,lastAvailableAccounts:[],lastAccountRole:''});sendJson(req,res,200,{ok:true,configured:false});return;
    }
    if(req.method==='POST'&&pathname==='/balance'){
      const body=await readJson(req),credentials=await readCredentials();if(!credentials)throw Object.assign(new Error('לא נשמרו פרטי בנק הפועלים ב-Bank Bridge'),{code:'NOT_CONFIGURED'});
      try{
        const historyDays=Math.min(HAPOALIM_INITIAL_BACKFILL_DAYS,Math.max(HAPOALIM_TRANSACTION_LOOKBACK_DAYS,Number(body.historyDays)||HAPOALIM_TRANSACTION_LOOKBACK_DAYS));
        const result=await scrapeHapoalimSnapshot(credentials,{interactive:!!body.interactive,historyDays});
        const homeFailure=result.accountFailures?.home||null;
        const warnings=[result.accounts?.business?.transactionWarning?`עסקי: ${result.accounts.business.transactionWarning}`:'',result.accounts?.home?.transactionWarning?`ביתי: ${result.accounts.home.transactionWarning}`:'',homeFailure?.message?`ביתי: ${homeFailure.message}`:''].filter(Boolean).join(' | ');
        await writeMeta({lastScrapeAt:result.fetchedAt,lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:warnings,lastWarningCode:homeFailure?.code||'',lastWarningStage:homeFailure?.stage||'',lastWarningHttpStatus:Number(homeFailure?.httpStatus)||0,lastAvailableAccounts:Array.isArray(homeFailure?.availableAccounts)?homeFailure.availableAccounts:[],lastAccountRole:homeFailure?'home':''});
        sendJson(req,res,200,{ok:true,...result});return;
      }catch(e){await writeMeta({lastError:e?.message||String(e),lastErrorAt:new Date().toISOString(),lastErrorCode:e?.code||'BRIDGE_ERROR',lastErrorStage:e?.stage||'',lastErrorHttpStatus:Number(e?.httpStatus)||0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,lastAvailableAccounts:Array.isArray(e?.availableAccounts)?e.availableAccounts:[],lastAccountRole:e?.accountRole==='home'?'home':e?.accountRole==='business'?'business':''});throw e}
    }
    if(req.method==='POST'&&pathname==='/shutdown'){
      sendJson(req,res,200,{ok:true});setTimeout(()=>activeServer?.close(()=>process.exit(0)),50);return;
    }
    sendJson(req,res,404,{ok:false,code:'NOT_FOUND',message:'נתיב Bank Bridge לא קיים'});
  }catch(e){sendJson(req,res,e?.code==='REQUEST_TOO_LARGE'?413:400,safeError(e))}
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
  const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){try{await fetchLocal('/health',{timeoutMs:400})}catch{return true}await new Promise(r=>setTimeout(r,150))}return false;
}
async function stopVerifiedListener(){
  if(process.platform!=='win32')throw new Error('Automatic Bank Bridge replacement is supported on Windows only');
  const script=`$ErrorActionPreference='Stop';$c=Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '0.0.0.0'} | Select-Object -First 1;if(-not $c){exit 0};$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$c.OwningProcess);if(-not $p){exit 0};if($p.Name -notmatch '^node(.exe)?$'){throw 'Listener is not Node.js'};if($p.CommandLine -notmatch 'server\\.mjs'){throw 'Listener is not the Netunim Bank Bridge'};Stop-Process -Id $p.ProcessId -Force`;
  await runPowerShell(script);
}
async function stopExistingBridge(){
  let health;try{health=await fetchLocal('/health')}catch{return}
  if(health.data?.service!=='netunim-kupa-bank-bridge')throw new Error(`Port ${PORT} is occupied by another local service`);
  let token='';try{token=(await fs.readFile(TOKEN_FILE,'utf8')).trim()}catch{}
  if(token){try{const r=await fetchLocal('/shutdown',{method:'POST',token,timeoutMs:1500});if(r.response.ok&&await waitForPortToClose())return}catch{}}
  await stopVerifiedListener();if(!await waitForPortToClose())throw new Error('The existing Bank Bridge process did not stop');
}

const args=new Set(process.argv.slice(2));
if(args.has('--stop-existing')){try{await stopExistingBridge();process.exit(0)}catch(e){console.error(e?.message||e);process.exit(1)}}
if(args.has('--doctor')){
  try{
    const browserPath=await findInstalledBrowser();
    const pkg=await import('israeli-bank-scrapers');
    if(!pkg?.createScraper||!pkg?.CompanyTypes?.hapoalim||!pkg?.CompanyTypes?.visaCal||!pkg?.CompanyTypes?.max||!pkg?.CompanyTypes?.isracard||!pkg?.CompanyTypes?.amex)throw new Error('israeli-bank-scrapers did not expose required Hapoalim/Cal/Max/Isracard/Amex support');
    const probe=pkg.createScraper({companyId:pkg.CompanyTypes.hapoalim,startDate:new Date(),showBrowser:false,executablePath:browserPath});
    enableHapoalimSessionAwareLogin(probe,{interactive:true});
    if(typeof probe.initialize!=='function'||typeof probe.login!=='function'||typeof probe.terminate!=='function')throw new Error('Hapoalim scraper lifecycle API is incompatible');
    await doctorCamoufox();
    console.log(`Browser: ${browserPath}`);
    console.log(`Camoufox: ${CAMOUFOX_INSTALL_DIR}`);
    console.log('Scraper: Hapoalim + Cal + Max + Isracard native/fallback + Amex Camoufox support, secure multi-profile credit sync, session-aware bank reads OK');
    process.exit(0);
  }catch(e){console.error(e?.message||e);process.exit(1)}
}

const token=await ensureToken();
if(args.has('--init')||args.has('--print-token')){console.log('Bank Bridge key:');console.log(token);console.log(`Credentials directory: ${APP_DIR}`);process.exit(0)}

activeServer=http.createServer((req,res)=>{handler(req,res,token).catch(e=>sendJson(req,res,500,safeError(e)))});
activeServer.on('error',e=>{if(e?.code==='EADDRINUSE'){console.error(`Bank Bridge already appears to be running on ${HOST}:${PORT}`);process.exit(0)}console.error(e);process.exit(1)});
activeServer.listen(PORT,HOST,()=>console.log(`Netunim Kupa Bank Bridge v${BRIDGE_VERSION} listening on http://${HOST}:${PORT}`));
