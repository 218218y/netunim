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
  normalizeRoots,originAllowed,parseEsCount,parseEsJson,pathInsideRoot,
} from './lib.mjs';

const execFile=promisify(execFileCb);
const APP_ROOT=process.env.NETUNIM_DOCUMENT_BRIDGE_HOME||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NetunimDocumentBridge');
const CONFIG_PATH=path.join(APP_ROOT,'config.json');
const TOKEN_PATH=path.join(APP_ROOT,'bridge-token.txt');
const LOG_PATH=path.join(APP_ROOT,'bridge.log');
const SUMMARY_PATH=path.join(APP_ROOT,'INSTALLATION-LOG.txt');
const TOOL_ES=path.join(APP_ROOT,'tools','es.exe');
const requestResults=new Map();
let server=null,cachedProbe=null;

async function ensureRoot(){await fs.mkdir(APP_ROOT,{recursive:true})}
async function appendLog(message){try{await ensureRoot();await fs.appendFile(LOG_PATH,`${new Date().toISOString()} ${message}\n`,'utf8')}catch{}}
async function readJsonFile(file,fallback){try{return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''))}catch{return fallback}}
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

async function countRoot({esPath,instance},config,root,search){
  const args=buildEsCountArgs({root,search,timeoutMs:config.searchTimeoutMs,instance});
  const {stdout}=await runEs(esPath,args,{timeout:config.searchTimeoutMs+2500});
  return parseEsCount(stdout);
}
async function sampleRoot({esPath,instance},config,root){
  const args=buildEsRawSearchArgs({root,search:'ext:pdf',limit:1,timeoutMs:config.searchTimeoutMs,instance});
  const {stdout}=await runEs(esPath,args,{timeout:config.searchTimeoutMs+2500});
  return parseEsJson(stdout,{root});
}
async function diagnoseRoot(probe,config,root){
  let accessible=true,accessError='';
  try{const stat=await fs.stat(root.path);accessible=stat.isDirectory();if(!accessible)accessError='הנתיב אינו תיקייה'}catch(error){accessible=false;accessError=String(error?.code||error?.message||error)}
  let pdfCount=null,indexedContentCount=null,sampleOk=false,error='';
  try{
    pdfCount=await countRoot(probe,config,root,'ext:pdf');
    indexedContentCount=await countRoot(probe,config,root,'ext:pdf is-indexed-property:content');
    if(pdfCount>0){const sample=await sampleRoot(probe,config,root);sampleOk=sample.length>0}
  }catch(err){error=String(err?.message||err)}
  return {id:root.id,label:root.label,path:root.path,accessible,accessError,pdfCount,indexedContentCount,sampleOk,error};
}
async function diagnoseRoots({freshProbe=false}={}){
  const config=await loadConfig();
  if(!config.roots.length){const e=new Error('לא הוגדרה תיקיית מסמכים במחשב זה.');e.code='ROOTS_NOT_CONFIGURED';throw e}
  const probe=await probeEverything({fresh:freshProbe});
  const diagnostics=[];
  for(const root of config.roots)diagnostics.push(await diagnoseRoot(probe,config,root));
  return {config,probe,diagnostics};
}

async function searchRoot({esPath,instance},config,root,query,mode,limit){
  const perRoot=Math.max(10,Math.min(MAX_RESULTS,Number(limit)||DEFAULT_RESULT_LIMIT));
  const args=buildEsSearchArgs({root,query,mode,limit:perRoot,timeoutMs:config.searchTimeoutMs,instance});
  const {stdout}=await runEs(esPath,args,{timeout:config.searchTimeoutMs+2500});
  return parseEsJson(stdout,{root});
}
function pruneResults(){const now=Date.now();for(const [id,row] of requestResults)if(row.expiresAt<=now)requestResults.delete(id)}
function publicResult(row){const id=crypto.randomUUID();requestResults.set(id,{fullPath:row.fullPath,rootId:row.rootId,expiresAt:Date.now()+RESULT_TTL_MS});return {id,name:row.name,relativePath:row.relativePath,modified:row.modified,size:row.size,rootId:row.rootId,rootLabel:row.rootLabel}}
async function searchDocuments(query,limit,mode='content'){
  const normalizedMode=normalizeDocumentSearchMode(mode),everythingQuery=buildDocumentQuery(query,normalizedMode);
  if(!everythingQuery){const e=new Error(normalizedMode==='name'?'יש להקליד לפחות שני תווים לחיפוש בשם הקובץ.':'יש להקליד לפחות שני תווים לחיפוש בתוכן המסמכים.');e.code='QUERY_TOO_SHORT';throw e}
  const config=await loadConfig();if(!config.roots.length){const e=new Error('לא הוגדרה תיקיית מסמכים במחשב זה. פתח את configure_document_bridge.bat.');e.code='ROOTS_NOT_CONFIGURED';throw e}
  const probe=await probeEverything();const started=Date.now();
  const settled=await Promise.allSettled(config.roots.map(root=>searchRoot(probe,config,root,query,normalizedMode,Math.min(MAX_RESULTS,Number(limit)||DEFAULT_RESULT_LIMIT))));
  const groups=[],errors=[];for(let i=0;i<settled.length;i++){const item=settled[i];if(item.status==='fulfilled')groups.push(item.value);else errors.push({rootId:config.roots[i].id,rootLabel:config.roots[i].label,code:item.reason?.code||'ES_SEARCH_FAILED',message:item.reason?.message||'חיפוש נכשל'})}
  if(!groups.length){const e=new Error(errors[0]?.message||'החיפוש ב-Everything נכשל.');e.code=errors[0]?.code||'ES_SEARCH_FAILED';e.rootErrors=errors;throw e}
  pruneResults();const merged=mergeDocumentResults(groups,limit).map(publicResult);const elapsedMs=Date.now()-started;
  await appendLog(`SEARCH mode=${normalizedMode} roots=${config.roots.length} results=${merged.length} elapsedMs=${elapsedMs} partial=${errors.length>0}`);
  return {ok:true,query:String(query||'').trim(),mode:normalizedMode,results:merged,elapsedMs,partial:errors.length>0,rootErrors:errors};
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
      const {probe,diagnostics}=await diagnoseRoots({freshProbe:true});
      sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,esVersion:probe.esVersion,everythingVersion:probe.everythingVersion,instance:probe.instance,roots:diagnostics.map(row=>({id:row.id,label:row.label,path:row.path,accessible:row.accessible,pdfCount:row.pdfCount,indexedContentCount:row.indexedContentCount,error:row.error||''}))},config);return;
    }
    if(req.method==='POST'&&req.url==='/documents/search'){const body=await readJson(req),result=await searchDocuments(body.query,body.limit,body.mode);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/open'){const body=await readJson(req),result=await openDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/shutdown'){
      sendJson(req,res,200,{ok:true},config);
      setTimeout(()=>{server?.close(async()=>{await appendLog('STOP graceful shutdown complete')})},20);
      return;
    }
    sendJson(req,res,404,{ok:false,code:'NOT_FOUND',message:'נתיב לא קיים'},config);
  }catch(error){await appendLog(`${req.method} ${req.url} ${error?.code||'ERROR'} ${error?.message||error}`);const status=error?.code==='QUERY_TOO_SHORT'?400:error?.code==='ROOTS_NOT_CONFIGURED'?409:error?.code==='RESULT_EXPIRED'?410:503;sendJson(req,res,status,safeError(error),config)}
}

function loopbackRequest(urlPath,{method='GET',token='',timeoutMs=2500}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:BRIDGE_PORT,path:urlPath,method,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},agent:false},res=>{
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size<=65536)chunks.push(chunk)});
      res.on('end',()=>{let data={};try{data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}resolve({statusCode:Number(res.statusCode)||0,data})});
    });
    req.setTimeout(timeoutMs,()=>req.destroy(Object.assign(new Error('Loopback request timed out'),{code:'ETIMEDOUT'})));
    req.on('error',reject);req.end();
  });
}
async function checkRunning(){
  const response=await loopbackRequest('/health',{timeoutMs:2500});
  if(response.statusCode!==200||response.data?.service!==BRIDGE_SERVICE||Number(response.data?.version)<BRIDGE_VERSION){const e=new Error('Document Bridge health check failed.');e.code='HEALTHCHECK_FAILED';throw e}
  return response.data;
}
async function stopExisting(){
  let health;
  try{health=await loopbackRequest('/health',{timeoutMs:900})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return;throw error}
  if(health.statusCode!==200||health.data?.service!==BRIDGE_SERVICE){const e=new Error(`Port ${BRIDGE_PORT} is already in use by another service.`);e.code='PORT_IN_USE';throw e}
  let token='';try{token=(await fs.readFile(TOKEN_PATH,'utf8')).trim()}catch{}
  if(!token){const e=new Error('Existing Document Bridge is running but its local token is unavailable.');e.code='TOKEN_MISSING';throw e}
  const response=await loopbackRequest('/shutdown',{method:'POST',token,timeoutMs:2500});
  if(response.statusCode!==200){const e=new Error(`Existing Document Bridge refused shutdown (HTTP ${response.statusCode}).`);e.code='SHUTDOWN_FAILED';throw e}
  const deadline=Date.now()+3500;
  while(Date.now()<deadline){await new Promise(r=>setTimeout(r,120));try{await loopbackRequest('/health',{timeoutMs:300})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return}}
  const e=new Error('Existing Document Bridge did not stop in time.');e.code='SHUTDOWN_TIMEOUT';throw e;
}

async function printDoctor(){
  await init();const {probe,diagnostics}=await diagnoseRoots({freshProbe:true});
  console.log(`Document Bridge v${BRIDGE_VERSION}`);
  console.log(`Node: ${process.versions.node}`);
  console.log(`ES: ${probe.esVersion||'unknown'} (${probe.esPath})`);
  console.log(`Everything: ${probe.everythingVersion||'unknown'}${probe.instance?` [instance ${probe.instance}]`:''}`);
  console.log(`Roots: ${diagnostics.length}`);
  let fatal=false,totalPdfs=0,totalIndexedContent=0;
  for(const [index,row] of diagnostics.entries()){
    console.log(`Root ${index+1}: ${row.path}`);
    console.log(`  Folder accessible: ${row.accessible?'YES':`NO (${row.accessError||'unknown'})`}`);
    console.log(`  PDFs visible in Everything: ${row.pdfCount===null?'ERROR':row.pdfCount}`);
    console.log(`  PDFs with indexed content: ${row.indexedContentCount===null?'ERROR':row.indexedContentCount}`);
    console.log(`  ES JSON result parsing: ${row.pdfCount>0?(row.sampleOk?'OK':'FAILED'):'not tested'}`);
    if(row.error)console.log(`  ES error: ${row.error}`);
    if(Number.isFinite(row.pdfCount))totalPdfs+=row.pdfCount;
    if(Number.isFinite(row.indexedContentCount))totalIndexedContent+=row.indexedContentCount;
    if(!row.accessible||row.error||(row.pdfCount>0&&!row.sampleOk))fatal=true;
  }
  console.log(`Total PDFs visible: ${totalPdfs}`);
  console.log(`Total PDFs with indexed content: ${totalIndexedContent}`);
  if(totalPdfs===0){fatal=true;console.log('ERROR: Everything sees no PDF files inside the configured folders.');}
  if(totalPdfs>0&&totalIndexedContent===0){fatal=true;console.log('ERROR: PDFs are visible, but none has indexed Content. Enable Everything Content Indexing for these PDFs.');}
  if(fatal){const e=new Error('Document root diagnostics failed. Fix the folder/index settings shown above before using website search.');e.code='ROOT_DIAGNOSTICS_FAILED';throw e;}
}
async function writeInstallSummary(){
  const token=await ensureToken(),config=await loadConfig();let probe=null,diagnostics=[];
  try{const data=await diagnoseRoots({freshProbe:true});probe=data.probe;diagnostics=data.diagnostics}catch{}
  const totalPdfs=diagnostics.reduce((sum,row)=>sum+(Number.isFinite(row.pdfCount)?row.pdfCount:0),0);
  const totalIndexed=diagnostics.reduce((sum,row)=>sum+(Number.isFinite(row.indexedContentCount)?row.indexedContentCount:0),0);
  const lines=[
    'NETUNIM DOCUMENT BRIDGE - INSTALLATION LOG',
    '==========================================',
    '',
    'הקוד שצריך להדביק באתר:',
    token,
    '',
    'באתר: Ctrl+K -> מסמכים במחשב -> הדבק את הקוד שלמעלה פעם אחת.',
    '',
    `Bridge version: ${BRIDGE_VERSION}`,
    `Node version: ${process.versions.node}`,
    `Local address: http://127.0.0.1:${BRIDGE_PORT}`,
    probe?`Everything: ${probe.everythingVersion||'unknown'}`:'Everything: status unavailable',
    '',
    'תיקיות שהוגדרו במחשב הזה:',
    ...(config.roots.length?config.roots.map((root,index)=>`${index+1}. ${root.path}`):['(לא הוגדרו תיקיות)']),
    '',
    'בדיקת האינדקס:',
    ...(diagnostics.length?diagnostics.flatMap((row,index)=>[
      `${index+1}. ${row.path}`,
      `   folder accessible: ${row.accessible?'YES':'NO'}`,
      `   PDFs visible in Everything: ${row.pdfCount??'ERROR'}`,
      `   PDFs with indexed content: ${row.indexedContentCount??'ERROR'}`,
      `   ES JSON parsing: ${row.pdfCount>0?(row.sampleOk?'OK':'FAILED'):'not tested'}`,
      ...(row.error?[`   error: ${row.error}`]:[]),
    ]):['(הבדיקה לא הייתה זמינה)']),
    '',
    `TOTAL PDFs visible: ${totalPdfs}`,
    `TOTAL PDFs with indexed content: ${totalIndexed}`,
    '',
    `Runtime log: ${LOG_PATH}`,
    `Console log: ${path.join(APP_ROOT,'bridge-console.log')}`,
    `ES installer log: ${path.join(APP_ROOT,'install-es.log')}`,
    `Change folders: ${path.join(APP_ROOT,'configure_document_bridge.bat')}`,
    '',
    'קבצי ה-PDF ותוכן ה-OCR נשארים במחשב ואינם מועלים לאתר או ל-Supabase.',
  ];
  await fs.writeFile(SUMMARY_PATH,lines.join('\r\n')+'\r\n','utf8');
  console.log(SUMMARY_PATH);
}

async function main(){
  const arg=process.argv[2]||'';
  if(arg==='--init'){await init();return}
  if(arg==='--doctor'){await printDoctor();return}
  if(arg==='--print-token'){console.log(await ensureToken());return}
  if(arg==='--stop-existing'){await stopExisting();return}
  if(arg==='--check-running'){await checkRunning();return}
  if(arg==='--write-install-summary'){await writeInstallSummary();return}
  if(process.platform!=='win32')throw new Error('Document Bridge is intended for Windows.');
  await init();server=http.createServer((req,res)=>{handle(req,res).catch(async error=>{await appendLog(`UNHANDLED ${error?.stack||error}`);try{res.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(safeError(error)))}catch{}})});
  server.on('error',error=>appendLog(`SERVER ${error?.code||''} ${error?.message||error}`));
  server.listen(BRIDGE_PORT,'127.0.0.1',()=>appendLog(`START ${BRIDGE_SERVICE} v${BRIDGE_VERSION} node=${process.versions.node} on 127.0.0.1:${BRIDGE_PORT}`));
}
main().catch(async error=>{await appendLog(`FATAL ${error?.stack||error}`);console.error(error?.message||error);process.exitCode=1});
