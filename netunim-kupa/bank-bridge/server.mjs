import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {
  HAPOALIM_POST_LOGIN_TIMEOUT_MS,
  HAPOALIM_NAVIGATION_STABLE_MS,
  HAPOALIM_DATA_RETRY_LIMIT,
  HAPOALIM_TRANSACTION_LOOKBACK_DAYS,
  HAPOALIM_TRANSACTION_LIMIT,
  buildHapoalimAdditionalDetailsUrl,
  isHapoalimChequeTransaction,
  normalizeHapoalimAdditionalDetails,
  INTERACTIVE_AUTH_TIMEOUT_MS,
  SILENT_AUTH_TIMEOUT_MS,
  isTransientNavigationError,
  normalizeRecentTransactions,
  parseAccountSelector,
  retryTransientNavigation,
  scraperFailureMessage,
  selectAccountDescriptor,
  waitForTerminalLoginResult,
  ymdDate,
} from './lib.mjs';

const HOST='127.0.0.1';
const PORT=8765;
const BRIDGE_VERSION=10;
const HAPOALIM_BASE_URL='https://login.bankhapoalim.co.il';
const APP_DIR=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NetunimKupaBankBridge');
const TOKEN_FILE=path.join(APP_DIR,'bridge-token.txt');
const CREDENTIALS_FILE=path.join(APP_DIR,'hapoalim-credentials.dpapi');
const META_FILE=path.join(APP_DIR,'status.json');
const BROWSER_PROFILE_DIR=path.join(APP_DIR,'browser-profile');
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
  catch{return {lastScrapeAt:null,lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastAvailableAccounts:[],browserPath:'',sessionUrl:''}}
}
async function writeMeta(patch){const current=await readMeta();await ensureAppDir();await fs.writeFile(META_FILE,JSON.stringify({...current,...patch},null,2),{encoding:'utf8',mode:0o600})}

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
  const rawAccount=String(value.accountNumber||'').trim(),rawBranch=String(value.branchNumber||'').trim();
  const selector=rawBranch?{bankNumber:'12',branchNumber:rawBranch.replace(/\D/g,''),accountNumber:rawAccount.replace(/\D/g,'')}:parseAccountSelector(rawAccount);
  return {...value,branchNumber:selector.branchNumber||'',accountNumber:selector.accountNumber||''};
}
async function readCredentials(){try{const encrypted=(await fs.readFile(CREDENTIALS_FILE,'utf8')).trim();if(!encrypted)return null;return normalizeStoredCredentials(JSON.parse(await unprotectText(encrypted)))}catch(e){if(e?.code==='ENOENT')return null;throw e}}
async function deleteCredentials(){await fs.rm(CREDENTIALS_FILE,{force:true})}

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
function safeError(error){return {ok:false,code:error?.code||'BRIDGE_ERROR',stage:error?.stage||'',message:error?.message||'שגיאת Bank Bridge',httpStatus:Number(error?.httpStatus)||0,availableAccounts:Array.isArray(error?.availableAccounts)?error.availableAccounts:[]}}
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

function enableHapoalimSessionAwareLogin(scraper,{interactive=false}={}){
  const originalGetLoginOptions=scraper?.getLoginOptions?.bind(scraper);
  if(typeof originalGetLoginOptions!=='function')throw Object.assign(new Error('גרסת scraper של הפועלים אינה תואמת למתאם ההתחברות'),{code:'SCRAPER_ADAPTER_INCOMPATIBLE'});
  scraper.getLoginOptions=(credentials)=>{
    const options=originalGetLoginOptions(credentials),originalResults=options.possibleResults||{};
    const successKey=Object.keys(originalResults).find(key=>String(key).toUpperCase()==='SUCCESS')||'SUCCESS';
    const originalSuccess=Array.isArray(originalResults[successKey])?originalResults[successKey]:[originalResults[successKey]].filter(Boolean);
    const detectionResults={...originalResults,[successKey]:[...originalSuccess,async()=>hapoalimSessionIsAuthenticated(scraper.page)]};
    let terminalResultKey='';
    const possibleResults=Object.fromEntries(Object.entries(originalResults).map(([key,conditions])=>[key,[...(Array.isArray(conditions)?conditions:[conditions]),async()=>terminalResultKey===key]]));
    if(!possibleResults[successKey])possibleResults[successKey]=[async()=>terminalResultKey===successKey];
    const timeoutMs=interactive?INTERACTIVE_AUTH_TIMEOUT_MS:SILENT_AUTH_TIMEOUT_MS;
    return {...options,possibleResults,postAction:async()=>{
      const terminal=await waitForTerminalLoginResult(scraper.page,detectionResults,{
        timeoutMs,pollMs:500,
        timeoutCode:interactive?'INTERACTIVE_AUTH_TIMEOUT':'SILENT_AUTH_TIMEOUT',
        timeoutMarker:interactive?'NETUNIM_INTERACTIVE_AUTH_TIMEOUT':'NETUNIM_SILENT_AUTH_TIMEOUT',
        closedCode:interactive?'INTERACTIVE_BROWSER_CLOSED':'BANK_PAGE_CLOSED',
        closedMarker:interactive?'NETUNIM_INTERACTIVE_BROWSER_CLOSED':'NETUNIM_BANK_PAGE_CLOSED',
      });
      terminalResultKey=terminal.resultKey;
    }};
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

async function enrichHapoalimChequeTransactions(page,rawTransactions,accountId,{initialReady=null}={}){
  const source=Array.isArray(rawTransactions)?rawTransactions:[];
  const enriched=[];
  let reusableReady=initialReady;
  for(const transaction of source){
    const pfmDetails=String(transaction?.pfmDetails||'').trim();
    if(!pfmDetails||Number(transaction?.serialNumber)===0||!isHapoalimChequeTransaction(transaction)){
      enriched.push(transaction);continue;
    }
    try{
      const extraResult=await pageFetchJson(page,async()=>({url:buildHapoalimAdditionalDetailsUrl(HAPOALIM_BASE_URL,pfmDetails,accountId)}),{initialReady:reusableReady});
      reusableReady=extraResult.ready;
      const details=normalizeHapoalimAdditionalDetails({transaction,additionalInformation:extraResult.data});
      enriched.push({...transaction,...(details.referenceNumber?{referenceNumber:details.referenceNumber}:{}),netunimAdditionalDetails:details});
    }catch(error){
      enriched.push({...transaction,netunimAdditionalDetailsWarning:`לא ניתן היה לטעון את פירוט השיק מהבנק: ${error?.message||error}`});
      reusableReady=null;
    }
  }
  return {transactions:enriched,ready:reusableReady};
}

async function fetchSelectedHapoalimSnapshot(page,credentials,ready){
  const stableReady=ready?.ready?ready:await waitForHapoalimSessionReady(page,{timeoutMs:20000,pollMs:300,stableMs:HAPOALIM_NAVIGATION_STABLE_MS});
  const rawAccounts=Array.isArray(stableReady?.accounts)?stableReady.accounts:[];
  const openAccounts=rawAccounts.filter(account=>Number(account?.accountClosingReasonCode)===0);
  const selected=await runStage('account',()=>Promise.resolve(selectAccountDescriptor(openAccounts,{bankNumber:'12',branchNumber:credentials.branchNumber||'',accountNumber:credentials.accountNumber||''})),'ACCOUNT_SELECTION_FAILED');
  const accountId=selected.accountId;
  const balanceResult=await runStage('balance',()=>pageFetchJson(page,async current=>{
    const restContext=String(current.restContext||'').replace(/^\/+/, '');
    const apiSiteUrl=`${HAPOALIM_BASE_URL}/${restContext}`;
    return {url:`${apiSiteUrl}/current-account/composite/balanceAndCreditLimit?accountId=${encodeURIComponent(accountId)}&view=details&lang=he`};
  },{initialReady:stableReady}), 'BALANCE_FETCH_FAILED');
  const balanceData=balanceResult.data,balanceReady=balanceResult.ready;
  const balance=Number(balanceData?.currentBalance);
  if(!Number.isFinite(balance))throw stageError('balance',Object.assign(new Error('בנק הפועלים לא החזיר יתרת עו״ש מספרית לחשבון שנבחר'),{code:'NO_BALANCE'}));

  let transactions=[],transactionWarning='';
  try{
    const end=new Date(),start=new Date(end);start.setDate(start.getDate()-Math.max(1,HAPOALIM_TRANSACTION_LOOKBACK_DAYS-1));
    const txResult=await pageFetchJson(page,async current=>{
      const restContext=String(current.restContext||'').replace(/^\/+/, '');
      const apiSiteUrl=`${HAPOALIM_BASE_URL}/${restContext}`;
      const cookies=await page.cookies();
      const xsrf=String(cookies.find(cookie=>cookie.name==='XSRF-TOKEN')?.value||'');
      const headers={'Content-Type':'application/json;charset=UTF-8','pageUuid':'/current-account/transactions','uuid':randomUUID()};
      if(xsrf)headers['X-XSRF-TOKEN']=xsrf;
      return {url:`${apiSiteUrl}/current-account/transactions?accountId=${encodeURIComponent(accountId)}&numItemsPerPage=${HAPOALIM_TRANSACTION_LIMIT}&retrievalEndDate=${ymdDate(end)}&retrievalStartDate=${ymdDate(start)}&sortCode=1`,method:'POST',headers,body:'[]'};
    },{initialReady:balanceReady});
    const enriched=await enrichHapoalimChequeTransactions(page,txResult.data?.transactions,accountId,{initialReady:txResult.ready});
    transactions=normalizeRecentTransactions(enriched.transactions,HAPOALIM_TRANSACTION_LIMIT);
  }catch(e){transactionWarning=`היתרה התקבלה, אבל לא ניתן היה לטעון כרגע תנועות אחרונות: ${e?.message||e}`}

  const sessionHref=String(page?.url?.()||balanceReady?.href||stableReady?.href||'');
  return {balance,accountNumber:selected.accountNumber,branchNumber:selected.branchNumber,accountId,transactions,transactionWarning,sessionHref};
}

async function scrapeHapoalimSnapshot(credentials,{interactive=false}={}){
  if(scrapeBusy)throw Object.assign(new Error('כבר מתבצע עדכון מול הבנק'),{code:'SCRAPE_BUSY'});
  scrapeBusy=true;
  let scraper=null,success=false;
  try{
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
    const snapshot=await runStage('data',()=>fetchSelectedHapoalimSnapshot(scraper.page,credentials,ready),'BANK_DATA_ERROR');
    const sessionUrl=safeHapoalimSessionUrl(snapshot?.sessionHref||ready?.href);
    if(sessionUrl)await writeMeta({sessionUrl});
    success=true;
    const {sessionHref:_,...publicSnapshot}=snapshot;return {...publicSnapshot,fetchedAt:new Date().toISOString()};
  }finally{
    if(scraper){try{await scraper.terminate(success)}catch(e){console.error('Bank Bridge browser cleanup failed:',e?.message||e)}}
    scrapeBusy=false;
  }
}

async function handler(req,res,token){
  if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders(req));res.end();return}
  if(req.method==='GET'&&req.url==='/health'){sendJson(req,res,200,{ok:true,service:'netunim-kupa-bank-bridge',version:BRIDGE_VERSION});return}
  if(!tokenEqual(token,authToken(req))){sendJson(req,res,401,{ok:false,code:'UNAUTHORIZED',message:'מפתח Bank Bridge שגוי'});return}
  try{
    if(req.method==='GET'&&req.url==='/status'){
      const credentials=await readCredentials(),meta=await readMeta();
      sendJson(req,res,200,{ok:true,bridgeVersion:BRIDGE_VERSION,configured:!!credentials,branchNumber:credentials?.branchNumber||'',accountNumber:credentials?.accountNumber||'',lastScrapeAt:meta.lastScrapeAt||null,lastError:meta.lastError||'',lastErrorCode:meta.lastErrorCode||'',lastErrorStage:meta.lastErrorStage||'',lastErrorHttpStatus:Number(meta.lastErrorHttpStatus)||0,lastWarning:meta.lastWarning||'',availableAccounts:Array.isArray(meta.lastAvailableAccounts)?meta.lastAvailableAccounts:[]});return;
    }
    if(req.method==='POST'&&req.url==='/credentials'){
      const body=await readJson(req),userCode=String(body.userCode||'').trim(),password=String(body.password||''),branchNumber=String(body.branchNumber||'').replace(/\D/g,''),accountNumber=String(body.accountNumber||'').replace(/\D/g,'');
      if(!userCode||!password)throw Object.assign(new Error('חסרים קוד משתמש או סיסמה'),{code:'MISSING_CREDENTIALS'});
      if((branchNumber&&!accountNumber)||(!branchNumber&&accountNumber))throw Object.assign(new Error('כאשר בוחרים חשבון יש להזין גם סניף וגם מספר חשבון'),{code:'INCOMPLETE_ACCOUNT_SELECTOR'});
      await writeCredentials({userCode,password,branchNumber,accountNumber});await writeMeta({lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastAvailableAccounts:[]});sendJson(req,res,200,{ok:true,configured:true,branchNumber,accountNumber});return;
    }
    if(req.method==='POST'&&req.url==='/account-selection'){
      const body=await readJson(req),branchNumber=String(body.branchNumber||'').replace(/\D/g,''),accountNumber=String(body.accountNumber||'').replace(/\D/g,'');
      if(!branchNumber||!accountNumber)throw Object.assign(new Error('יש לבחור גם סניף וגם מספר חשבון'),{code:'INCOMPLETE_ACCOUNT_SELECTOR'});
      const credentials=await readCredentials();if(!credentials)throw Object.assign(new Error('לא נשמרו פרטי בנק הפועלים ב-Bank Bridge'),{code:'NOT_CONFIGURED'});
      await writeCredentials({...credentials,branchNumber,accountNumber});
      await writeMeta({lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastAvailableAccounts:[]});
      sendJson(req,res,200,{ok:true,configured:true,branchNumber,accountNumber});return;
    }
    if(req.method==='DELETE'&&req.url==='/credentials'){
      await deleteCredentials();await writeMeta({lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastAvailableAccounts:[]});sendJson(req,res,200,{ok:true,configured:false});return;
    }
    if(req.method==='POST'&&req.url==='/balance'){
      const body=await readJson(req),credentials=await readCredentials();if(!credentials)throw Object.assign(new Error('לא נשמרו פרטי בנק הפועלים ב-Bank Bridge'),{code:'NOT_CONFIGURED'});
      try{
        const result=await scrapeHapoalimSnapshot(credentials,{interactive:!!body.interactive});
        await writeMeta({lastScrapeAt:result.fetchedAt,lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:result.transactionWarning||'',lastAvailableAccounts:[]});
        sendJson(req,res,200,{ok:true,...result});return;
      }catch(e){await writeMeta({lastError:e?.message||String(e),lastErrorCode:e?.code||'BRIDGE_ERROR',lastErrorStage:e?.stage||'',lastErrorHttpStatus:Number(e?.httpStatus)||0,lastWarning:'',lastAvailableAccounts:Array.isArray(e?.availableAccounts)?e.availableAccounts:[]});throw e}
    }
    if(req.method==='POST'&&req.url==='/shutdown'){
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
    if(!pkg?.createScraper||!pkg?.CompanyTypes?.hapoalim)throw new Error('israeli-bank-scrapers did not expose Hapoalim support');
    const probe=pkg.createScraper({companyId:pkg.CompanyTypes.hapoalim,startDate:new Date(),showBrowser:false,executablePath:browserPath});
    enableHapoalimSessionAwareLogin(probe,{interactive:true});
    if(typeof probe.initialize!=='function'||typeof probe.login!=='function'||typeof probe.terminate!=='function')throw new Error('Hapoalim scraper lifecycle API is incompatible');
    console.log(`Browser: ${browserPath}`);
    console.log('Scraper: Hapoalim session-aware login + navigation-stable data reads + structured cheque-deposit enrichment + persistent-session reuse + MFA + exact branch/account selector OK');
    process.exit(0);
  }catch(e){console.error(e?.message||e);process.exit(1)}
}

const token=await ensureToken();
if(args.has('--init')||args.has('--print-token')){console.log('Bank Bridge key:');console.log(token);console.log(`Credentials directory: ${APP_DIR}`);process.exit(0)}

activeServer=http.createServer((req,res)=>{handler(req,res,token).catch(e=>sendJson(req,res,500,safeError(e)))});
activeServer.on('error',e=>{if(e?.code==='EADDRINUSE'){console.error(`Bank Bridge already appears to be running on ${HOST}:${PORT}`);process.exit(0)}console.error(e);process.exit(1)});
activeServer.listen(PORT,HOST,()=>console.log(`Netunim Kupa Bank Bridge v${BRIDGE_VERSION} listening on http://${HOST}:${PORT}`));
