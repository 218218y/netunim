import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto,{timingSafeEqual} from 'node:crypto';
import {execFile as execFileCb,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {
  BRIDGE_PORT,BRIDGE_SERVICE,BRIDGE_VERSION,DEFAULT_ALLOWED_ORIGINS,DEFAULT_RESULT_LIMIT,MAX_RESULTS,RESULT_TTL_MS,
  buildDocumentQuery,buildEsCountArgs,buildEsRawSearchArgs,buildEsSearchArgs,mergeDocumentResults,normalizeDocumentSearchMode,
  originAllowed,parseEsCount,parseEsJson,parseRegistryInstallLocation,
} from './lib.mjs';

const execFile=promisify(execFileCb);
const APP_ROOT=process.env.NETUNIM_DOCUMENT_BRIDGE_HOME||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NetunimDocumentBridge');
const CONFIG_PATH=path.join(APP_ROOT,'config.json');
const TOKEN_PATH=path.join(APP_ROOT,'bridge-token.txt');
const LOG_PATH=path.join(APP_ROOT,'bridge.log');
const SUMMARY_PATH=path.join(APP_ROOT,'INSTALLATION-LOG.txt');
const TOOL_ES=path.join(APP_ROOT,'tools','es.exe');
const requestResults=new Map();
let server=null,cachedProbe=null,everythingStartPromise=null;

async function ensureRoot(){await fs.mkdir(APP_ROOT,{recursive:true})}
async function appendLog(message){try{await ensureRoot();await fs.appendFile(LOG_PATH,`${new Date().toISOString()} ${message}\n`,'utf8')}catch{}}
async function readJsonFile(file,fallback){try{return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''))}catch{return fallback}}
async function writeJsonFile(file,value){await ensureRoot();const tmp=`${file}.tmp`;await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',mode:0o600});await fs.rename(tmp,file)}
async function ensureToken(){await ensureRoot();try{const token=(await fs.readFile(TOKEN_PATH,'utf8')).trim();if(token)return token}catch{}const token=crypto.randomBytes(32).toString('hex');await fs.writeFile(TOKEN_PATH,token+'\n',{encoding:'utf8',mode:0o600});return token}
async function loadConfig(){
  const raw=await readJsonFile(CONFIG_PATH,{});
  return {
    everythingInstance:String(raw.everythingInstance||'').trim(),
    everythingExecutable:String(raw.everythingExecutable||'').trim(),
    allowedOrigins:Array.isArray(raw.allowedOrigins)&&raw.allowedOrigins.length?raw.allowedOrigins.map(String):DEFAULT_ALLOWED_ORIGINS,
    searchTimeoutMs:Math.max(3000,Math.min(30000,Number(raw.searchTimeoutMs)||15000)),
  };
}
async function saveConfig(config){await writeJsonFile(CONFIG_PATH,{everythingInstance:String(config.everythingInstance||'').trim(),everythingExecutable:String(config.everythingExecutable||'').trim(),allowedOrigins:Array.isArray(config.allowedOrigins)&&config.allowedOrigins.length?config.allowedOrigins:DEFAULT_ALLOWED_ORIGINS,searchTimeoutMs:Math.max(3000,Math.min(30000,Number(config.searchTimeoutMs)||15000))})}
async function init(){await ensureToken();const existing=await loadConfig();if(!fsSync.existsSync(CONFIG_PATH))await saveConfig(existing);return existing}
async function existsFile(candidate){if(!candidate)return false;try{return (await fs.stat(candidate)).isFile()}catch{return false}}

async function whereEs(){
  const candidates=[process.env.NETUNIM_EVERYTHING_ES_PATH,TOOL_ES,path.join(process.env.LOCALAPPDATA||'','Microsoft','WindowsApps','es.exe'),path.join(process.env.PROGRAMFILES||'C:\\Program Files','Everything','es.exe'),path.join(process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)','Everything','es.exe')].filter(Boolean);
  for(const candidate of candidates)if(await existsFile(candidate))return candidate;
  if(process.platform==='win32')try{const {stdout}=await execFile('where.exe',['es.exe'],{encoding:'utf8',windowsHide:true,timeout:3000});const candidate=stdout.split(/\r?\n/).map(x=>x.trim()).find(Boolean);if(candidate)return candidate}catch{}
  const e=new Error('es.exe לא נמצא. יש להריץ מחדש את מתקין Document Bridge.');e.code='ES_NOT_FOUND';throw e;
}
function instanceArgs(instance){return instance?['-instance',instance]:[]}
async function runEs(esPath,args,{timeout=18000}={}){
  try{return await execFile(esPath,args,{encoding:'utf8',windowsHide:true,timeout,maxBuffer:16*1024*1024})}
  catch(error){const e=new Error(String(error?.stderr||error?.message||'ES failed').trim()||'ES failed');e.code=`ES_EXIT_${Number.isFinite(Number(error?.code))?Number(error.code):'ERROR'}`;e.exitCode=Number(error?.code);e.stderr=String(error?.stderr||'');throw e}
}
function instanceCandidates(config){return [...new Set([config.everythingInstance,'','1.5a'].filter(value=>value!==undefined&&value!==null))]}
async function probeRunningInstances(config,esPath){
  let esVersion='';try{esVersion=(await runEs(esPath,['-version'],{timeout:3000})).stdout.trim()}catch{}
  let lastError=null,onlyNotRunning=true;
  for(const instance of instanceCandidates(config)){
    try{
      const {stdout}=await runEs(esPath,['-ipc3',...instanceArgs(instance),'-timeout','3000','-get-everything-version'],{timeout:4500});
      return {at:Date.now(),esPath,esVersion,everythingVersion:stdout.trim(),instance,startedByBridge:false};
    }catch(error){lastError=error;if(error.exitCode!==8)onlyNotRunning=false}
  }
  const e=new Error(onlyNotRunning?'Everything אינו פועל כרגע.':'לא ניתן להתחבר ל-Everything המקומי.');
  e.code=onlyNotRunning?'EVERYTHING_NOT_RUNNING':'EVERYTHING_UNAVAILABLE';e.cause=lastError;throw e;
}
async function registryValue(key,value='InstallLocation'){
  if(process.platform!=='win32')return '';
  try{const {stdout}=await execFile('reg.exe',['query',key,'/v',value],{encoding:'utf8',windowsHide:true,timeout:3000});return parseRegistryInstallLocation(stdout,value)}catch{return ''}
}
function executableNamesForLocation(location){return location?[path.win32.join(location,'Everything.exe'),path.win32.join(location,'Everything64.exe')]:[]}
async function findEverythingExecutable(config){
  const direct=[process.env.NETUNIM_EVERYTHING_EXE_PATH,config.everythingExecutable].filter(Boolean);
  for(const candidate of direct)if(await existsFile(candidate))return candidate;

  const registryKeys=[
    'HKLM\\SOFTWARE\\voidtools\\Everything',
    'HKCU\\SOFTWARE\\voidtools\\Everything',
    'HKLM\\SOFTWARE\\voidtools\\Everything 1.5a',
    'HKCU\\SOFTWARE\\voidtools\\Everything 1.5a',
    'HKLM\\SOFTWARE\\WOW6432Node\\voidtools\\Everything',
    'HKLM\\SOFTWARE\\WOW6432Node\\voidtools\\Everything 1.5a',
  ];
  for(const key of registryKeys){
    const location=await registryValue(key);
    for(const candidate of executableNamesForLocation(location))if(await existsFile(candidate))return candidate;
  }

  const programFiles=process.env.PROGRAMFILES||'C:\\Program Files';
  const programFilesX86=process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)';
  const localAppData=process.env.LOCALAPPDATA||'';
  const known=[
    ...executableNamesForLocation(path.join(programFiles,'Everything')),
    ...executableNamesForLocation(path.join(programFiles,'Everything 1.5a')),
    ...executableNamesForLocation(path.join(programFilesX86,'Everything')),
    ...executableNamesForLocation(path.join(programFilesX86,'Everything 1.5a')),
    ...executableNamesForLocation(path.join(localAppData,'Everything')),
    ...executableNamesForLocation(path.join(localAppData,'Programs','Everything')),
  ];
  for(const candidate of known)if(await existsFile(candidate))return candidate;

  if(process.platform==='win32'){
    for(const exeName of ['Everything.exe','Everything64.exe']){
      try{const {stdout}=await execFile('where.exe',[exeName],{encoding:'utf8',windowsHide:true,timeout:3000});for(const candidate of stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))if(await existsFile(candidate))return candidate}catch{}
    }
  }
  const e=new Error('Everything מותקן אך לא ניתן לאתר את Everything.exe. התקן את Everything 1.5 באמצעות המתקין הרשמי או הגדר NETUNIM_EVERYTHING_EXE_PATH.');e.code='EVERYTHING_EXE_NOT_FOUND';throw e;
}
async function waitForEverything(config,esPath,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs,lastErrors=[];
  while(Date.now()<deadline){
    try{return await probeRunningInstances(config,esPath)}catch(error){lastErrors.push(error);await new Promise(resolve=>setTimeout(resolve,250))}
  }
  const e=new Error('Everything הופעל ברקע אך לא היה מוכן לחיפוש בזמן.');e.code='EVERYTHING_START_TIMEOUT';e.cause=lastErrors.at(-1);throw e;
}
async function startEverythingBackground(config,esPath){
  if(everythingStartPromise)return everythingStartPromise;
  everythingStartPromise=(async()=>{
    const executable=await findEverythingExecutable(config);
    const instance=config.everythingInstance||(/1\.5a/i.test(executable)?'1.5a':'');
    const args=[...instanceArgs(instance),'-startup','-first-instance'];
    await appendLog(`EVERYTHING_START exe=${executable} instance=${instance||'(default)'}`);
    const child=spawn(executable,args,{detached:true,windowsHide:true,stdio:'ignore'});child.unref();
    const probe=await waitForEverything({...config,everythingInstance:instance},esPath,15000);
    const latest=await loadConfig();
    if(latest.everythingExecutable!==executable||latest.everythingInstance!==probe.instance){latest.everythingExecutable=executable;latest.everythingInstance=probe.instance;await saveConfig(latest)}
    return {...probe,startedByBridge:true,everythingExecutable:executable};
  })();
  try{return await everythingStartPromise}finally{everythingStartPromise=null}
}
async function probeEverything({fresh=false,autoStart=true}={}){
  if(!fresh&&cachedProbe&&Date.now()-cachedProbe.at<30000)return cachedProbe;
  const config=await loadConfig(),esPath=await whereEs();
  try{cachedProbe=await probeRunningInstances(config,esPath)}catch(error){
    if(error.code!=='EVERYTHING_NOT_RUNNING'||!autoStart)throw error;
    cachedProbe=await startEverythingBackground(config,esPath);
  }
  if(!cachedProbe.everythingExecutable){try{cachedProbe.everythingExecutable=await findEverythingExecutable(config)}catch{}}
  return cachedProbe;
}

async function countIndex({esPath,instance},config,search='*'){
  const args=buildEsCountArgs({search,timeoutMs:config.searchTimeoutMs,instance,filesOnly:true});
  const {stdout}=await runEs(esPath,args,{timeout:config.searchTimeoutMs+3000});
  return parseEsCount(stdout);
}
async function sampleIndex({esPath,instance},config){
  const args=buildEsRawSearchArgs({search:'*',limit:1,timeoutMs:config.searchTimeoutMs,instance,filesOnly:false});
  const {stdout}=await runEs(esPath,args,{timeout:config.searchTimeoutMs+3000});
  return parseEsJson(stdout);
}
async function diagnoseIndex({freshProbe=false}={}){
  const config=await loadConfig(),probe=await probeEverything({fresh:freshProbe,autoStart:true});
  let fileCount=null,indexedContentCount=null,sampleOk=false,error='';
  try{
    fileCount=await countIndex(probe,config,'*');
    indexedContentCount=await countIndex(probe,config,'is-indexed-property:content');
    if(fileCount>0)sampleOk=(await sampleIndex(probe,config)).length>0;
  }catch(err){error=String(err?.message||err)}
  return {config,probe,diagnostics:{fileCount,indexedContentCount,sampleOk,error}};
}

function pruneResults(){const now=Date.now();for(const [id,row] of requestResults)if(row.expiresAt<=now)requestResults.delete(id)}
function publicResult(row){const id=crypto.randomUUID();requestResults.set(id,{fullPath:row.fullPath,expiresAt:Date.now()+RESULT_TTL_MS});return {id,name:row.name,relativePath:row.relativePath,modified:row.modified,size:row.size,extension:row.extension,rootId:'everything',rootLabel:'Everything'}}
async function searchDocuments(query,limit,mode='everything'){
  const normalizedMode=normalizeDocumentSearchMode(mode),everythingQuery=buildDocumentQuery(query,normalizedMode);
  if(!everythingQuery){const e=new Error(normalizedMode==='content'?'יש להקליד לפחות שני תווים לחיפוש בתוכן הקבצים.':'יש להקליד לפחות תו אחד לחיפוש ב-Everything.');e.code='QUERY_TOO_SHORT';throw e}
  const config=await loadConfig(),probe=await probeEverything({autoStart:true}),started=Date.now();
  const args=buildEsSearchArgs({query,mode:normalizedMode,limit:Math.min(MAX_RESULTS,Number(limit)||DEFAULT_RESULT_LIMIT),timeoutMs:config.searchTimeoutMs,instance:probe.instance});
  const {stdout}=await runEs(probe.esPath,args,{timeout:config.searchTimeoutMs+5000});
  const rows=parseEsJson(stdout);
  pruneResults();const merged=mergeDocumentResults([rows],limit).map(publicResult),elapsedMs=Date.now()-started;
  await appendLog(`SEARCH mode=${normalizedMode} scope=everything-index results=${merged.length} elapsedMs=${elapsedMs} input=${JSON.stringify(String(query||''))} everythingQuery=${JSON.stringify(everythingQuery)}`);
  return {ok:true,query:String(query||'').trim(),mode:normalizedMode,results:merged,elapsedMs,partial:false,rootErrors:[]};
}

function tokenEqual(expected,actual){const a=Buffer.from(String(expected||'')),b=Buffer.from(String(actual||''));return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)}
function authToken(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():''}
function corsHeaders(req,config){const origin=String(req.headers.origin||'');return {'Access-Control-Allow-Origin':origin&&originAllowed(origin,config.allowedOrigins)?origin:'null','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Private-Network':'true','Access-Control-Max-Age':'600','Cache-Control':'no-store','Vary':'Origin'}}
function sendJson(req,res,status,data,config){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...corsHeaders(req,config)});res.end(JSON.stringify(data))}
async function readJson(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192){const e=new Error('הבקשה גדולה מדי');e.code='REQUEST_TOO_LARGE';throw e}chunks.push(chunk)}if(!chunks.length)return {};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{const e=new Error('JSON לא תקין');e.code='INVALID_JSON';throw e}}
function safeError(error){return {ok:false,code:error?.code||'DOCUMENT_BRIDGE_ERROR',message:error?.message||'שגיאת Document Bridge',rootErrors:Array.isArray(error?.rootErrors)?error.rootErrors:[]}}

async function openDocument(id){
  pruneResults();const row=requestResults.get(String(id||''));if(!row){const e=new Error('תוצאת החיפוש פגה. חפש שוב את הקובץ.');e.code='RESULT_EXPIRED';throw e}
  if(process.platform!=='win32'){const e=new Error('פתיחת קובץ נתמכת רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
  let stat;try{stat=await fs.stat(row.fullPath)}catch{const e=new Error('הקובץ כבר אינו קיים או שאינו נגיש.');e.code='OPEN_TARGET_MISSING';throw e}
  // Use the Windows shell default action for both files and folders. explorer.exe
  // may return a non-zero exit code even after accepting a folder open request,
  // which caused valid folders to be reported as failures. Invoke-Item -LiteralPath
  // handles folders and registered file types and reports PowerShell errors reliably.
  await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','Invoke-Item -LiteralPath $env:NETUNIM_OPEN_TARGET -ErrorAction Stop'],{windowsHide:true,timeout:8000,env:{...process.env,NETUNIM_OPEN_TARGET:row.fullPath}});
  await appendLog(`OPEN type=${stat.isDirectory()?'folder':'file'} path=${JSON.stringify(row.fullPath)}`);
  return {ok:true};
}

async function handle(req,res){
  const config=await loadConfig(),origin=String(req.headers.origin||'');
  if(origin&&!originAllowed(origin,config.allowedOrigins)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'});res.end(JSON.stringify({ok:false,code:'ORIGIN_NOT_ALLOWED',message:'מקור האתר אינו מורשה לגשת ל-Document Bridge.'}));return}
  if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders(req,config));res.end();return}
  if(req.method==='GET'&&req.url==='/health'){sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION},config);return}
  const expected=await ensureToken();if(!tokenEqual(expected,authToken(req))){sendJson(req,res,401,{ok:false,code:'UNAUTHORIZED',message:'מפתח Document Bridge שגוי או חסר.'},config);return}
  try{
    if(req.method==='GET'&&req.url==='/status'){
      const {probe,diagnostics}=await diagnoseIndex({freshProbe:true});
      sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,esVersion:probe.esVersion,everythingVersion:probe.everythingVersion,everythingExecutable:probe.everythingExecutable||'',instance:probe.instance,index:{fileCount:diagnostics.fileCount,indexedContentCount:diagnostics.indexedContentCount,sampleOk:diagnostics.sampleOk,error:diagnostics.error||''}},config);return;
    }
    if(req.method==='POST'&&req.url==='/documents/search'){const body=await readJson(req),result=await searchDocuments(body.query,body.limit,body.mode);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/open'){const body=await readJson(req),result=await openDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/shutdown'){sendJson(req,res,200,{ok:true},config);setTimeout(()=>{server?.close(async()=>{await appendLog('STOP graceful shutdown complete')})},20);return}
    sendJson(req,res,404,{ok:false,code:'NOT_FOUND',message:'נתיב לא קיים'},config);
  }catch(error){await appendLog(`${req.method} ${req.url} ${error?.code||'ERROR'} ${error?.message||error}`);const status=error?.code==='QUERY_TOO_SHORT'?400:error?.code==='RESULT_EXPIRED'?410:503;sendJson(req,res,status,safeError(error),config)}
}

function loopbackRequest(urlPath,{method='GET',token='',timeoutMs=2500}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:BRIDGE_PORT,path:urlPath,method,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},agent:false},res=>{
      let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size<=65536)chunks.push(chunk)});res.on('end',()=>{let data={};try{data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}resolve({statusCode:Number(res.statusCode)||0,data})});
    });
    req.setTimeout(timeoutMs,()=>req.destroy(Object.assign(new Error('Loopback request timed out'),{code:'ETIMEDOUT'})));req.on('error',reject);req.end();
  });
}
async function checkRunning(){const response=await loopbackRequest('/health',{timeoutMs:2500});if(response.statusCode!==200||response.data?.service!==BRIDGE_SERVICE||Number(response.data?.version)<BRIDGE_VERSION){const e=new Error('Document Bridge health check failed.');e.code='HEALTHCHECK_FAILED';throw e}return response.data}
async function stopExisting(){
  let health;try{health=await loopbackRequest('/health',{timeoutMs:900})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return;throw error}
  if(health.statusCode!==200||health.data?.service!==BRIDGE_SERVICE){const e=new Error(`Port ${BRIDGE_PORT} is already in use by another service.`);e.code='PORT_IN_USE';throw e}
  let token='';try{token=(await fs.readFile(TOKEN_PATH,'utf8')).trim()}catch{}if(!token){const e=new Error('Existing Document Bridge is running but its local token is unavailable.');e.code='TOKEN_MISSING';throw e}
  const response=await loopbackRequest('/shutdown',{method:'POST',token,timeoutMs:2500});if(response.statusCode!==200){const e=new Error(`Existing Document Bridge refused shutdown (HTTP ${response.statusCode}).`);e.code='SHUTDOWN_FAILED';throw e}
  const deadline=Date.now()+3500;while(Date.now()<deadline){await new Promise(r=>setTimeout(r,120));try{await loopbackRequest('/health',{timeoutMs:300})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return}}
  const e=new Error('Existing Document Bridge did not stop in time.');e.code='SHUTDOWN_TIMEOUT';throw e;
}

async function printDoctor(){
  await init();const {probe,diagnostics}=await diagnoseIndex({freshProbe:true});
  const executable=probe.everythingExecutable||await findEverythingExecutable(await loadConfig());
  console.log(`Document Bridge v${BRIDGE_VERSION}`);console.log(`Node: ${process.versions.node}`);console.log(`ES: ${probe.esVersion||'unknown'} (${probe.esPath})`);console.log(`Everything: ${probe.everythingVersion||'unknown'}${probe.instance?` [instance ${probe.instance}]`:''}`);console.log(`Everything background executable: ${executable}`);console.log('Search scope: complete Everything index (same database as Everything UI)');
  console.log(`Files visible in Everything: ${diagnostics.fileCount===null?'ERROR':diagnostics.fileCount}`);console.log(`Files with indexed content: ${diagnostics.indexedContentCount===null?'ERROR':diagnostics.indexedContentCount}`);console.log(`ES UTF-8 JSON parsing: ${diagnostics.fileCount>0?(diagnostics.sampleOk?'OK':'FAILED'):'not tested'}`);if(diagnostics.error)console.log(`ES error: ${diagnostics.error}`);
  if(diagnostics.error||(diagnostics.fileCount>0&&!diagnostics.sampleOk)){const e=new Error('Everything/ES diagnostics failed.');e.code='INDEX_DIAGNOSTICS_FAILED';throw e}
  if(diagnostics.fileCount===0)console.log('WARNING: Everything currently sees no files. The website will mirror that empty Everything index.');
}
async function writeInstallSummary(){
  const token=await ensureToken(),config=await loadConfig();let probe=null,diagnostics={fileCount:null,indexedContentCount:null,sampleOk:false,error:''},everythingExecutable='';
  try{const data=await diagnoseIndex({freshProbe:true});probe=data.probe;diagnostics=data.diagnostics;everythingExecutable=probe.everythingExecutable||await findEverythingExecutable(config)}catch{}
  const lines=['NETUNIM DOCUMENT BRIDGE - INSTALLATION LOG','==========================================','','הקוד שצריך להדביק באתר:',token,'','באתר: Ctrl+K -> קבצים במחשב -> הדבק את הקוד שלמעלה פעם אחת.','',`Bridge version: ${BRIDGE_VERSION}`,`Node version: ${process.versions.node}`,`Local address: http://127.0.0.1:${BRIDGE_PORT}`,probe?`Everything: ${probe.everythingVersion||'unknown'}`:'Everything: status unavailable',`Everything background executable: ${everythingExecutable||'(not found)'}`,'','Search scope: COMPLETE EVERYTHING INDEX','The Bridge no longer maintains a separate folder allowlist. Whatever Everything indexes is searchable from the website.','','בדיקת האינדקס:',`   files visible in Everything: ${diagnostics.fileCount??'ERROR'}`,`   files with indexed content: ${diagnostics.indexedContentCount??'ERROR'}`,`   ES UTF-8 JSON parsing: ${diagnostics.fileCount>0?(diagnostics.sampleOk?'OK':'FAILED'):'not tested'}`,...(diagnostics.error?[`   error: ${diagnostics.error}`]:[]),'',`Runtime log: ${LOG_PATH}`,`Console log: ${path.join(APP_ROOT,'bridge-console.log')}`,`ES installer log: ${path.join(APP_ROOT,'install-es.log')}`,'','ES is forced to UTF-8 output (-cp 65001) and Unicode argv parsing (-argv).','Search text is passed after -- to preserve Everything quotes; -max-results limits only the IPC viewport.','Everything.exe is started automatically in background mode (-startup) when needed. No search window is opened.','Searches use the same Everything index/database as the Everything UI.','Files and extracted content stay on this computer and are not uploaded to the website or Supabase.'];
  await fs.writeFile(SUMMARY_PATH,lines.join('\r\n')+'\r\n','utf8');console.log(SUMMARY_PATH);
}

async function main(){
  const arg=process.argv[2]||'';
  if(arg==='--init'){await init();return}if(arg==='--doctor'){await printDoctor();return}if(arg==='--ensure-everything'){await init();const probe=await probeEverything({fresh:true,autoStart:true});console.log(`${probe.everythingVersion||'unknown'} ${probe.everythingExecutable||''}`.trim());return}if(arg==='--print-token'){console.log(await ensureToken());return}if(arg==='--stop-existing'){await stopExisting();return}if(arg==='--check-running'){await checkRunning();return}if(arg==='--write-install-summary'){await writeInstallSummary();return}
  if(process.platform!=='win32')throw new Error('Document Bridge is intended for Windows.');
  await init();server=http.createServer((req,res)=>{handle(req,res).catch(async error=>{await appendLog(`UNHANDLED ${error?.stack||error}`);try{res.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(safeError(error)))}catch{}})});server.on('error',error=>appendLog(`SERVER ${error?.code||''} ${error?.message||error}`));server.listen(BRIDGE_PORT,'127.0.0.1',()=>{appendLog(`START ${BRIDGE_SERVICE} v${BRIDGE_VERSION} node=${process.versions.node} on 127.0.0.1:${BRIDGE_PORT}`);probeEverything({fresh:true,autoStart:true}).then(probe=>appendLog(`EVERYTHING_READY version=${probe.everythingVersion} instance=${probe.instance||'(default)'}`)).catch(error=>appendLog(`EVERYTHING_BACKGROUND_START_FAILED ${error?.code||'ERROR'} ${error?.message||error}`))});
}
main().catch(async error=>{await appendLog(`FATAL ${error?.stack||error}`);console.error(error?.message||error);process.exitCode=1});
