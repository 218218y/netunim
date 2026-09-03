import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const CREDIT_DIAGNOSTIC_MAX_BYTES=1024*1024;
export const CREDIT_DIAGNOSTIC_FILE_COUNT=5;
export const CREDIT_DIAGNOSTIC_RETENTION_MS=30*24*60*60*1000;

function text(value,max=120){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function iso(value){const d=new Date(value||Date.now());return Number.isFinite(d.getTime())?d.toISOString():new Date().toISOString()}
function suffix(value){const digits=String(value??'').replace(/\D/g,'');return digits?digits.slice(-4):text(value,4)}
function safeMonth(value){return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(value||''))?String(value):''}

export function diagnosticFingerprint(value={}){
  const stable=[value.provider,value.stage,value.month,value.errorClass||value.code,value.httpStatus].map(item=>text(item,80)).join('|');
  return createHash('sha256').update(stable).digest('hex').slice(0,16);
}

export function sanitizeCreditDiagnosticEvent(value={}){
  const event={
    timestamp:iso(value.timestamp),correlationId:text(value.correlationId,80),provider:text(value.provider,30),profileId:text(value.profileId,80),
    bridgeVersion:Math.max(0,Math.trunc(Number(value.bridgeVersion)||0)),contractVersion:Math.max(0,Math.trunc(Number(value.contractVersion)||0)),connectorVersion:text(value.connectorVersion,80),browserEngine:text(value.browserEngine,40),
    stage:text(value.stage,80),accountSuffix:suffix(value.accountSuffix||value.accountNumber),month:safeMonth(value.month),durationMs:Math.max(0,Math.trunc(Number(value.durationMs)||0)),
    errorClass:text(value.errorClass||value.code,80),httpStatus:Math.max(0,Math.trunc(Number(value.httpStatus)||0)),retryAfterAt:value.retryAfterAt?iso(value.retryAfterAt):null,
  };
  event.fingerprint=diagnosticFingerprint(event);return event;
}

export function createCreditDiagnosticLog({directory,bridgeVersion=0,contractVersion=2,connectorVersion='israeli-bank-scrapers-6.9.0',maxBytes=CREDIT_DIAGNOSTIC_MAX_BYTES,fileCount=CREDIT_DIAGNOSTIC_FILE_COUNT,retentionMs=CREDIT_DIAGNOSTIC_RETENTION_MS}={}){
  const logPath=path.join(directory,'credit-diagnostics.jsonl');let queue=Promise.resolve();
  async function rotate(){
    let stat;try{stat=await fs.stat(logPath)}catch{return}
    if(stat.size<maxBytes)return;
    for(let index=fileCount-1;index>=1;index--){const source=index===1?logPath:`${logPath}.${index-1}`,target=`${logPath}.${index}`;try{await fs.rm(target,{force:true});await fs.rename(source,target)}catch(error){if(error?.code!=='ENOENT')throw error}}
  }
  async function prune(now=Date.now()){
    for(let index=0;index<fileCount;index++){const file=index===0?logPath:`${logPath}.${index}`;try{const stat=await fs.stat(file);if(now-stat.mtimeMs>retentionMs)await fs.rm(file,{force:true})}catch(error){if(error?.code!=='ENOENT')throw error}}
  }
  async function append(value){await fs.mkdir(directory,{recursive:true,mode:0o700});await prune();await rotate();const event=sanitizeCreditDiagnosticEvent({...value,bridgeVersion,contractVersion,connectorVersion});await fs.appendFile(logPath,`${JSON.stringify(event)}\n`,{encoding:'utf8',mode:0o600});await prune();return event}
  function record(value){queue=queue.then(()=>append(value)).catch(()=>{});return queue}
  async function summary({limit=100}={}){
    await queue;const files=[logPath,...Array.from({length:fileCount-1},(_,index)=>`${logPath}.${index+1}`)],events=[];
    for(const file of files){try{const content=await fs.readFile(file,'utf8');for(const line of content.split(/\r?\n/)){if(!line.trim())continue;try{events.push(sanitizeCreditDiagnosticEvent(JSON.parse(line)))}catch{}}}catch(error){if(error?.code!=='ENOENT')throw error}}
    return events.sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)).slice(0,Math.max(1,Math.min(500,Math.trunc(Number(limit)||100))));
  }
  return {record,summary,logPath};
}
