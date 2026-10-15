import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {BRIDGE_PORT as DEFAULT_BRIDGE_PORT} from './lib.mjs';
const executeDefault=promisify(execFile);

// Shared Windows process operations used by native preview and installation.
// Accepted operation lifetimes remain with their respective command owners.
export function createWindowsProcessControl({platform=process.platform,execute=executeDefault,port=DEFAULT_BRIDGE_PORT,clock=Date,timers=globalThis}={}){
const process={platform},execFile=execute,BRIDGE_PORT=port,Date=clock,setTimeout=timers.setTimeout;
async function bridgeListenerPid(){
  if(process.platform!=='win32')return 0;
  try{const {stdout}=await execFile('netstat.exe',['-ano','-p','tcp'],{encoding:'utf8',windowsHide:true,timeout:3000});for(const line of stdout.split(/\r?\n/)){const parts=line.trim().split(/\s+/);if(parts.length<5||String(parts[0]).toUpperCase()!=='TCP'||String(parts[3]).toUpperCase()!=='LISTENING')continue;const local=String(parts[1]||'');if(!local.endsWith(`:${BRIDGE_PORT}`))continue;const pid=Number(parts[4]);if(Number.isInteger(pid)&&pid>0)return pid}}catch{}return 0;
}
async function processAlive(pid){
  if(process.platform!=='win32'||!Number.isInteger(Number(pid))||Number(pid)<=0)return false;
  try{const {stdout}=await execFile('tasklist.exe',['/FI',`PID eq ${Number(pid)}`,'/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true,timeout:3000});return stdout.split(/\r?\n/).some(line=>line.includes(`\"${Number(pid)}\"`))}catch{return false}
}
async function forceStopProcessTree(pid){
  if(process.platform!=='win32'||!Number.isInteger(Number(pid))||Number(pid)<=0)return;
  try{await execFile('taskkill.exe',['/PID',String(Number(pid)),'/T','/F'],{encoding:'utf8',windowsHide:true,timeout:5000})}catch(error){if(await processAlive(pid))throw error}
}
async function waitForProcessExit(pid,timeoutMs){
  if(!pid)return true;const deadline=Date.now()+Math.max(0,Number(timeoutMs)||0);while(Date.now()<deadline){if(!(await processAlive(pid)))return true;await new Promise(r=>setTimeout(r,150))}return !(await processAlive(pid));
}
return {bridgeListenerPid,processAlive,forceStopProcessTree,waitForProcessExit};
}
