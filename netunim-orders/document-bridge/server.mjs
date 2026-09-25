import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto,{timingSafeEqual} from 'node:crypto';
import readline from 'node:readline/promises';
import {execFile as execFileCb,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {
  BRIDGE_PORT,BRIDGE_SERVICE,BRIDGE_VERSION,DEFAULT_ALLOWED_ORIGINS,DEFAULT_RESULT_LIMIT,MAX_RESULTS,RESULT_TTL_MS,
  buildContentQuery,buildEsSearchArgs,mergeDocumentResults,normalizeRoots,originAllowed,parseEsJson,pathInsideRoot,
} from './lib.mjs';

const execFile=promisify(execFileCb);
const APP_ROOT=process.env.NETUNIM_DOCUMENT_BRIDGE_HOME||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NetunimDocumentBridge');
const CONFIG_PATH=path.join(APP_ROOT,'config.json');
const TOKEN_PATH=path.join(APP_ROOT,'bridge-token.txt');
const LOG_PATH=path.join(APP_ROOT,'bridge.log');
const TOOL_ES=path.join(APP_ROOT,'tools','es.exe');
const requestResults=new Map();
let server=null,cachedProbe=null;

async function ensureRoot(){await fs.mkdir(APP_ROOT,{recursive:true})}
async function appendLog(message){try{await ensureRoot();await fs.appendFile(LOG_PATH,`${new Date().toISOString()} ${message}\n`,'utf8')}catch{}}
async function readJsonFile(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}}
async function writeJsonFile(file,value){await ensureRoot();const tmp=`${file}.tmp`;await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',mode:0o600});await fs.rename(tmp,file)}
async function ensureToken(){await ensureRoot();try{const token=(await fs.readFile(TOKEN_PATH,'utf8')).trim();if(token)return token}catch{}const token=crypto.randomBytes(32).toString('hex');await fs.writeFile(TOKEN_PATH,token+'\n',{encoding:'utf8',mode:0o600});return token}
async function loadConfig(){
  const raw=await readJsonFile(CONFIG_PATH,{});
  return {
    roots:normalizeRoots(raw.roots),
    everythingInstance:String(raw.everythingInstance||'').trim(),
    allowedOrigins:Array.isArray(raw.allowedOrigins)&&raw.allowedOrigins.length?raw.allowedOrigins.map(String):DEFAULT_ALLOWED_ORIGINS,
    searchTimeoutMs:Math.max(1500,Math.min(15000,Number(raw.searchTimeoutMs)||6000)),
  };
}
async function saveConfig(config){await writeJsonFile(CONFIG_PATH,{roots:normalizeRoots(config.roots),everythingInstance:String(config.everythingInstance||'').trim(),allowedOrigins:Array.isArray(config.allowedOrigins)&&config.allowedOrigins.length?config.allowedOrigins:DEFAULT_ALLOWED_ORIGINS,searchTimeoutMs:Math.max(1500,Math.min(15000,Number(config.searchTimeoutMs)||6000))})}
async function init(){await ensureToken();const existing=await loadConfig();if(!fsSync.existsSync(CONFIG_PATH))await saveConfig(existing);return existing}

async function whereEs(){
  const candidates=[process.env.NETUNIM_EVERYTHING_ES_PATH,TOOL_ES,path.join(process.env.LOCALAPPDATA||'','Microsoft','WindowsApps','es.exe'),path.join(process.env.PROGRAMFILES||'C:\\Program Files','Everything','es.exe'),path.join(process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)','Everything','es.exe')].filter(Boolean);
  for(const candidate of candidates){try{await fs.access(candidate);return candidate}catch{}}
  if(process.platform==='win32')try{const {stdout}=await execFile('where.exe',['es.exe'],{encoding:'utf8',windowsHide:true,timeout:3000});const candidate=stdout.split(/\r?\n/).map(x=>x.trim()).find(Boolean);if(candidate)return candidate}catch{}
  const e=new Error('es.exe לא נמצא. יש להריץ מחדש את מתקין Document Bridge.');e.code='ES_NOT_FOUND';throw e;
}
function instanceArgs(instance){return instance?['-instance',instance]:[]}
async function runEs(esPath,args,{timeout=8000}={}){
  try{return await execFile(esPath,args,{encoding:'utf8',windowsHide:true,timeout,maxBuffer:16*1024*1024})}
  catch(error){const e=new Error(String(error?.stderr||error?.message||'ES failed').trim()||'ES failed');e.code=`ES_EXIT_${Number.isFinite(Number(error?.code))?Number(error.code):'ERROR'}`;e.exitCode=Number(error?.code);e.stderr=String(error?.stderr||'');throw e}
}
async function probeEverything({fresh=false}={}){
  if(!fresh&&cachedProbe&&Date.now()-cachedProbe.at<30000)return cachedProbe;
  const config=await loadConfig(),esPath=await whereEs();
  let esVersion='';try{esVersion=(await runEs(esPath,['-version'],{timeout:3000})).stdout.trim()}catch{}
  const instances=config.everythingInstance?[config.everythingInstance]:['','1.5a'];let lastError=null;
  for(const instance of instances){
    try{const {stdout}=await runEs(esPath,['-ipc3',...instanceArgs(instance),'-timeout','3000','-get-everything-version'],{timeout:4500});const everythingVersion=stdout.trim();cachedProbe={at:Date.now(),esPath,esVersion,everythingVersion,instance};return cachedProbe}catch(error){lastError=error;if(error.exitCode!==8&&!String(error.code).includes('ES_EXIT_8'))break}
  }
  const e=new Error(lastError?.exitCode===8?'Everything אינו פועל במחשב זה או שמופע Everything לא נמצא.':'לא ניתן להתחבר ל-Everything המקומי.');e.code=lastError?.exitCode===8?'EVERYTHING_NOT_RUNNING':'EVERYTHING_UNAVAILABLE';e.cause=lastError;throw e;
}

async function searchRoot({esPath,instance},config,root,query,limit){
  const perRoot=Math.max(10,Math.min(MAX_RESULTS,Number(limit)||DEFAULT_RESULT_LIMIT));
  const args=buildEsSearchArgs({root,query,limit:perRoot,timeoutMs:config.searchTimeoutMs,instance});
  const {stdout}=await runEs(esPath,args,{timeout:config.searchTimeoutMs+2500});
  return parseEsJson(stdout,{root});
}
function pruneResults(){const now=Date.now();for(const [id,row] of requestResults)if(row.expiresAt<=now)requestResults.delete(id)}
function publicResult(row){const id=crypto.randomUUID();requestResults.set(id,{fullPath:row.fullPath,rootId:row.rootId,expiresAt:Date.now()+RESULT_TTL_MS});return {id,name:row.name,relativePath:row.relativePath,modified:row.modified,size:row.size,rootId:row.rootId,rootLabel:row.rootLabel}}
async function searchDocuments(query,limit){
  const everythingQuery=buildContentQuery(query);if(!everythingQuery){const e=new Error('יש להקליד לפחות שני תווים לחיפוש בתוכן המסמכים.');e.code='QUERY_TOO_SHORT';throw e}
  const config=await loadConfig();if(!config.roots.length){const e=new Error('לא הוגדרה תיקיית מסמכים במחשב זה. הרץ configure_document_bridge.bat.');e.code='ROOTS_NOT_CONFIGURED';throw e}
  const probe=await probeEverything();const started=Date.now();
  const settled=await Promise.allSettled(config.roots.map(root=>searchRoot(probe,config,root,query,Math.min(MAX_RESULTS,Number(limit)||DEFAULT_RESULT_LIMIT))));
  const groups=[],errors=[];for(let i=0;i<settled.length;i++){const item=settled[i];if(item.status==='fulfilled')groups.push(item.value);else errors.push({rootId:config.roots[i].id,rootLabel:config.roots[i].label,code:item.reason?.code||'ES_SEARCH_FAILED',message:item.reason?.message||'חיפוש נכשל'})}
  if(!groups.length){const e=new Error(errors[0]?.message||'החיפוש ב-Everything נכשל.');e.code=errors[0]?.code||'ES_SEARCH_FAILED';e.rootErrors=errors;throw e}
  pruneResults();const merged=mergeDocumentResults(groups,limit).map(publicResult);
  return {ok:true,query:String(query||'').trim(),results:merged,elapsedMs:Date.now()-started,partial:errors.length>0,rootErrors:errors};
}

function tokenEqual(expected,actual){const a=Buffer.from(String(expected||'')),b=Buffer.from(String(actual||''));return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)}
function authToken(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():''}
function corsHeaders(req,config){const origin=String(req.headers.origin||'');return {'Access-Control-Allow-Origin':origin&&originAllowed(origin,config.allowedOrigins)?origin:'null','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Private-Network':'true','Access-Control-Max-Age':'600','Cache-Control':'no-store','Vary':'Origin'}}
function sendJson(req,res,status,data,config){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...corsHeaders(req,config)});res.end(JSON.stringify(data))}
async function readJson(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192){const e=new Error('הבקשה גדולה מדי');e.code='REQUEST_TOO_LARGE';throw e}chunks.push(chunk)}if(!chunks.length)return {};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{const e=new Error('JSON לא תקין');e.code='INVALID_JSON';throw e}}
function safeError(error){return {ok:false,code:error?.code||'DOCUMENT_BRIDGE_ERROR',message:error?.message||'שגיאת Document Bridge',rootErrors:Array.isArray(error?.rootErrors)?error.rootErrors:[]}}

async function openDocument(id){
  pruneResults();const row=requestResults.get(String(id||''));if(!row){const e=new Error('תוצאת החיפוש פגה. חפש שוב את המסמך.');e.code='RESULT_EXPIRED';throw e}
  const config=await loadConfig(),root=config.roots.find(x=>x.id===row.rootId);if(!root||!pathInsideRoot(row.fullPath,root.path)||!row.fullPath.toLowerCase().endsWith('.pdf')){const e=new Error('המסמך אינו בתוך תיקייה מורשית.');e.code='OPEN_NOT_ALLOWED';throw e}
  if(process.platform!=='win32'){const e=new Error('פתיחת מסמך נתמכת רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',row.fullPath],{detached:true,windowsHide:true,stdio:'ignore'});child.unref();return {ok:true};
}

async function handle(req,res){
  const config=await loadConfig(),origin=String(req.headers.origin||'');
  if(origin&&!originAllowed(origin,config.allowedOrigins)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'});res.end(JSON.stringify({ok:false,code:'ORIGIN_NOT_ALLOWED',message:'מקור האתר אינו מורשה לגשת ל-Document Bridge.'}));return}
  if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders(req,config));res.end();return}
  if(req.method==='GET'&&req.url==='/health'){sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION},config);return}
  const expected=await ensureToken();if(!tokenEqual(expected,authToken(req))){sendJson(req,res,401,{ok:false,code:'UNAUTHORIZED',message:'מפתח Document Bridge שגוי או חסר.'},config);return}
  try{
    if(req.method==='GET'&&req.url==='/status'){
      const probe=await probeEverything({fresh:true});sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,esVersion:probe.esVersion,everythingVersion:probe.everythingVersion,instance:probe.instance,roots:config.roots.map(({id,label})=>({id,label}))},config);return;
    }
    if(req.method==='POST'&&req.url==='/documents/search'){const body=await readJson(req),result=await searchDocuments(body.query,body.limit);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/open'){const body=await readJson(req),result=await openDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/shutdown'){sendJson(req,res,200,{ok:true},config);setTimeout(()=>server?.close(()=>process.exit(0)),20);return}
    sendJson(req,res,404,{ok:false,code:'NOT_FOUND',message:'נתיב לא קיים'},config);
  }catch(error){await appendLog(`${req.method} ${req.url} ${error?.code||'ERROR'} ${error?.message||error}`);const status=error?.code==='QUERY_TOO_SHORT'?400:error?.code==='ROOTS_NOT_CONFIGURED'?409:error?.code==='RESULT_EXPIRED'?410:503;sendJson(req,res,status,safeError(error),config)}
}

async function configure(){
  const config=await init();
  const envRoots=String(process.env.NETUNIM_DOCUMENT_ROOTS||'').split(';').map(x=>x.trim()).filter(Boolean);
  if(envRoots.length){config.roots=normalizeRoots(envRoots);await saveConfig(config);console.log(`Configured ${config.roots.length} document root(s).`);return}
  if(!process.stdin.isTTY){if(!config.roots.length)throw new Error('No document roots configured and no interactive console is available. Set NETUNIM_DOCUMENT_ROOTS.');return}
  console.log('\nהגדרת תיקיות PDF לחיפוש מקומי');console.log('אפשר להגדיר גם תיקיית Drive מקומית וגם כונן רשת/UNC. כל מחשב נשמר בנפרד.');
  if(config.roots.length){console.log('תיקיות קיימות:');for(const root of config.roots)console.log(`  - ${root.path}`)}
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  try{const answer=(await rl.question('הדבק נתיבים מופרדים בנקודה-פסיק (;), או Enter לשמירת הקיים:\n> ')).trim();if(answer){const roots=normalizeRoots(answer.split(';'));if(!roots.length)throw new Error('לא התקבל נתיב תקין');config.roots=roots;await saveConfig(config)}console.log(`נשמרו ${config.roots.length} תיקיות.`)}finally{rl.close()}
}
async function printDoctor(){
  await init();const config=await loadConfig();const probe=await probeEverything({fresh:true});console.log(`Document Bridge v${BRIDGE_VERSION}`);console.log(`ES: ${probe.esVersion||'unknown'} (${probe.esPath})`);console.log(`Everything: ${probe.everythingVersion||'unknown'}${probe.instance?` [instance ${probe.instance}]`:''}`);console.log(`Roots: ${config.roots.length}`);for(const root of config.roots)console.log(`  ${root.label}: ${root.path}`);if(!config.roots.length)throw new Error('No document roots configured. Run --configure.');
}
async function stopExisting(){try{const token=(await fs.readFile(TOKEN_PATH,'utf8')).trim();const response=await fetch(`http://127.0.0.1:${BRIDGE_PORT}/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);await new Promise(r=>setTimeout(r,300));return}catch(error){try{const health=await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`,{signal:AbortSignal.timeout(1000)});if(health.ok)throw error}catch(inner){if(inner===error)throw error}return}}

async function main(){
  const arg=process.argv[2]||'';
  if(arg==='--init'){await init();return}
  if(arg==='--configure'){await configure();return}
  if(arg==='--doctor'){await printDoctor();return}
  if(arg==='--print-token'){console.log(await ensureToken());return}
  if(arg==='--stop-existing'){await stopExisting();return}
  if(process.platform!=='win32')throw new Error('Document Bridge is intended for Windows.');
  await init();server=http.createServer((req,res)=>{handle(req,res).catch(async error=>{await appendLog(`UNHANDLED ${error?.stack||error}`);try{res.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(safeError(error)))}catch{}})});
  server.on('error',error=>appendLog(`SERVER ${error?.code||''} ${error?.message||error}`));
  server.listen(BRIDGE_PORT,'127.0.0.1',()=>appendLog(`START ${BRIDGE_SERVICE} v${BRIDGE_VERSION} on 127.0.0.1:${BRIDGE_PORT}`));
}
main().catch(async error=>{await appendLog(`FATAL ${error?.stack||error}`);console.error(error?.message||error);process.exitCode=1});
