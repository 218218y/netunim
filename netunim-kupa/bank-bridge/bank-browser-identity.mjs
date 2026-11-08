import fs from 'node:fs/promises';
import path from 'node:path';
import {runPowerShell} from './windows-platform.mjs';

// Only processes explicitly launched with this exact private user-data-dir are
// eligible. Never stop a user's general Chrome/Edge session.
const STOP_PROFILE_SCRIPT=`$ErrorActionPreference='Stop'
$root=([Console]::In.ReadToEnd() | ConvertFrom-Json).directory
$escaped=[regex]::Escape($root)
$pattern='(?:^|\\s)(?:"--user-data-dir='+$escaped+'"|--user-data-dir="'+$escaped+'"|--user-data-dir='+$escaped+'(?=\\s|$))'
$targets=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern })
foreach($target in $targets){
  $process=Get-Process -Id $target.ProcessId -ErrorAction SilentlyContinue
  if($process){$process.Kill();if(-not $process.WaitForExit(10000)){throw 'Bank browser did not exit'}}
}`;

export function createBankBrowserIdentity({directory,files=fs,stop=async target=>{
  if(process.platform==='win32')await runPowerShell(STOP_PROFILE_SCRIPT,JSON.stringify({directory:target}));
}}){
  const target=path.resolve(directory);
  if(path.basename(target)!=='browser-profile'||path.basename(path.dirname(target))!=='NetunimKupaBankBridge')throw new Error('BANK_IDENTITY_PATH_INVALID');
  return Object.freeze({clear:async()=>{
    try{await files.access(target)}catch(error){if(error?.code==='ENOENT')return;throw error}
    await stop(target);
    await files.rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    try{await files.access(target)}catch(error){if(error?.code==='ENOENT')return;throw error}
    throw new Error('BANK_IDENTITY_DELETE_INCOMPLETE');
  }});
}
