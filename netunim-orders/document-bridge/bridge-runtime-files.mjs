import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertBridgeNodeVersion,BRIDGE_NODE_WIN_X64_SHA256,DEFAULT_ALLOWED_ORIGINS} from './lib.mjs';

export function bridgeDataRoot(env=process.env,home=os.homedir()){return env.NETUNIM_DOCUMENT_BRIDGE_HOME||path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'NetunimDocumentBridge')}

// This concrete platform owns local configuration, token, logging and pinned
// executable verification. Construction performs no filesystem work.
export function createBridgeRuntimeFiles({root=bridgeDataRoot(),host=process,files=fs,syncFiles=fsSync}={}){
const APP_ROOT=root,process=host,fs=files,fsSync=syncFiles;
const CONFIG_PATH=path.join(APP_ROOT,'config.json');
const TOKEN_PATH=path.join(APP_ROOT,'bridge-token.txt');
const LOG_PATH=path.join(APP_ROOT,'bridge.log');
const SUMMARY_PATH=path.join(APP_ROOT,'INSTALLATION-LOG.txt');
const NODE_RUNTIME_POINTER_PATH=path.join(APP_ROOT,'node-runtime.txt');

const PRIVATE_NODE_RUNTIME_PATTERN=/^node-v24\.21\.0-win-x64-[0-9]{8}-[0-9]{6}-[0-9]+-[0-9a-f]{8}$/i;
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
function normalizedRuntimePath(value){return path.resolve(String(value||'')).replace(/[\\/]+$/,'').toLocaleLowerCase('en-US')}
function privateNodeRuntimeInfoSync({verifyHash=false}={}){
  assertBridgeNodeVersion(process.versions.node);
  if(process.platform!=='win32')return {runtimeName:'',expectedPath:process.execPath,actualPath:process.execPath,sha256:'',verified:true};
  let runtimeName='';try{runtimeName=fsSync.readFileSync(NODE_RUNTIME_POINTER_PATH,'utf8').replace(/^\uFEFF/,'').trim()}catch(error){const e=new Error('Private Node runtime pointer is missing. Reinstall Document Bridge.');e.code='NODE_RUNTIME_POINTER_MISSING';e.cause=error;throw e}
  if(!PRIVATE_NODE_RUNTIME_PATTERN.test(runtimeName)){const e=new Error(`Private Node runtime pointer is invalid: ${runtimeName||'(empty)'}.`);e.code='NODE_RUNTIME_POINTER_INVALID';throw e}
  const expectedPath=path.join(APP_ROOT,runtimeName,'node.exe'),actualPath=process.execPath;
  if(!fsSync.existsSync(expectedPath)){const e=new Error(`Pinned private Node runtime is missing: ${expectedPath}`);e.code='NODE_RUNTIME_MISSING';throw e}
  if(normalizedRuntimePath(expectedPath)!==normalizedRuntimePath(actualPath)){const e=new Error(`Document Bridge must run with its pinned private Node runtime. Expected ${expectedPath}; found ${actualPath}.`);e.code='NODE_RUNTIME_NOT_PRIVATE';throw e}
  let sha256='';if(verifyHash){sha256=crypto.createHash('sha256').update(fsSync.readFileSync(actualPath)).digest('hex');if(sha256!==BRIDGE_NODE_WIN_X64_SHA256){const e=new Error(`Pinned private Node runtime failed SHA-256 verification: ${sha256}.`);e.code='NODE_RUNTIME_INTEGRITY_MISMATCH';throw e}}
  return {runtimeName,expectedPath,actualPath,sha256,verified:!verifyHash||sha256===BRIDGE_NODE_WIN_X64_SHA256};
}
return {appendLog,readJsonFile,writeJsonFile,ensureToken,loadConfig,saveConfig,init,existsFile,privateNodeRuntimeInfoSync,paths:Object.freeze({APP_ROOT,CONFIG_PATH,TOKEN_PATH,LOG_PATH,SUMMARY_PATH,NODE_RUNTIME_POINTER_PATH})};
}
