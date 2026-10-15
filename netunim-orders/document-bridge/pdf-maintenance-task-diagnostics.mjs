import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

// Scheduled-task inspection is independent of live listener/search ownership.
// Expected paths travel in environment values, never interpolated shell code.
export function createPdfMaintenanceTaskDiagnostics({root,taskName,host={platform:process.platform,env:process.env,execute},output=console}){
const APP_ROOT=root,PDF_MAINTENANCE_TASK_NAME=taskName,process=host,execFile=host.execute,console=output;
function taskResultLabel(value){
  const numeric=Number(value);if(!Number.isFinite(numeric))return 'unknown';const unsigned=numeric>>>0;return `${Math.trunc(numeric)} (0x${unsigned.toString(16).toUpperCase().padStart(8,'0')})`;
}
async function pdfMaintenanceTaskDiagnostics(){
  if(process.platform!=='win32')return {exists:false,unsupported:true,state:'',enabled:false,triggerEnabled:false,lastRunTime:'',lastResult:null,nextRunTime:'',missedRuns:0,actionExecuteValid:false,actionRunnerValid:false,actionWorkingDirectoryValid:false,actionValid:false,scheduleActive:false,error:''};
  const expectedRunner=path.join(APP_ROOT,'run_pdf_maintenance.ps1');
  const script=[
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)',
    `$task=Get-ScheduledTask -TaskName '${PDF_MAINTENANCE_TASK_NAME}' -ErrorAction Stop`,
    `$info=Get-ScheduledTaskInfo -TaskName '${PDF_MAINTENANCE_TASK_NAME}' -ErrorAction Stop`,
    '$action=@($task.Actions)[0]',
    '$triggers=@($task.Triggers)',
    '$expectedRunner=[string]$env:NETUNIM_TASK_EXPECTED_RUNNER',
    "$expectedWorkingDirectory=([System.IO.Path]::GetFullPath([string]$env:NETUNIM_TASK_EXPECTED_WORKDIR)).TrimEnd('\\')",
    '$executeLeaf=[System.IO.Path]::GetFileName([string]$action.Execute)',
    '$arguments=[string]$action.Arguments',
    "$registeredWorkingDirectory=([string]$action.WorkingDirectory).TrimEnd('\\')",
    "$actualWorkingDirectory=if($registeredWorkingDirectory){([System.IO.Path]::GetFullPath($registeredWorkingDirectory)).TrimEnd('\\')}else{''}",
    "$executeValid=($executeLeaf -ieq 'powershell.exe')",
    '$runnerValid=($expectedRunner.Length -gt 0 -and $arguments.IndexOf($expectedRunner,[System.StringComparison]::OrdinalIgnoreCase) -ge 0)',
    '$workingDirectoryValid=($actualWorkingDirectory -ieq $expectedWorkingDirectory)',
    "$lastRun=if($info.LastRunTime.Year -gt 1900){$info.LastRunTime.ToString('o')}else{''}",
    "$nextRun=if($info.NextRunTime.Year -gt 1900){$info.NextRunTime.ToString('o')}else{''}",
    "$triggerEnabled=(@($triggers | Where-Object { $_.Enabled -ne $false }).Count -gt 0)",
    "[pscustomobject]@{state=[string]$task.State;enabled=([string]$task.State -ne 'Disabled');triggerEnabled=[bool]$triggerEnabled;lastRunTime=$lastRun;lastResult=[int64]$info.LastTaskResult;nextRunTime=$nextRun;missedRuns=[int]$info.NumberOfMissedRuns;actionExecuteValid=[bool]$executeValid;actionRunnerValid=[bool]$runnerValid;actionWorkingDirectoryValid=[bool]$workingDirectoryValid}|ConvertTo-Json -Compress",
  ].join(';');
  const env={...process.env,NETUNIM_TASK_EXPECTED_RUNNER:expectedRunner,NETUNIM_TASK_EXPECTED_WORKDIR:APP_ROOT};
  try{
    const {stdout}=await execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:1024*1024,env});
    const raw=JSON.parse(String(stdout||'').trim());
    const actionExecuteValid=raw.actionExecuteValid===true,actionRunnerValid=raw.actionRunnerValid===true,actionWorkingDirectoryValid=raw.actionWorkingDirectoryValid===true;
    const actionValid=actionExecuteValid&&actionRunnerValid&&actionWorkingDirectoryValid;
    const enabled=raw.enabled===true,triggerEnabled=raw.triggerEnabled===true,nextRunTime=String(raw.nextRunTime||''),scheduleActive=enabled&&triggerEnabled&&!!nextRunTime&&actionValid;
    return {exists:true,unsupported:false,state:String(raw.state||''),enabled,triggerEnabled,lastRunTime:String(raw.lastRunTime||''),lastResult:Number(raw.lastResult),nextRunTime,missedRuns:Math.max(0,Number(raw.missedRuns)||0),actionExecuteValid,actionRunnerValid,actionWorkingDirectoryValid,actionValid,scheduleActive,error:''};
  }catch(error){return {exists:false,unsupported:false,state:'',enabled:false,triggerEnabled:false,lastRunTime:'',lastResult:null,nextRunTime:'',missedRuns:0,actionExecuteValid:false,actionRunnerValid:false,actionWorkingDirectoryValid:false,actionValid:false,scheduleActive:false,error:String(error?.stderr||error?.message||error).trim()}}
}
function taskActionDiagnosticLabel(task){
  if(task.actionValid)return 'OK';
  return `MISMATCH (execute=${task.actionExecuteValid?'ok':'bad'}; runner=${task.actionRunnerValid?'ok':'bad'}; cwd=${task.actionWorkingDirectoryValid?'ok':'bad'})`;
}
function printPdfMaintenanceTaskDiagnostics(task){
  if(task.unsupported){console.log('PDF maintenance Task Scheduler: unavailable on this platform');return}
  if(!task.exists){console.log(`PDF maintenance Task Scheduler: NOT INSTALLED${task.error?` (${task.error})`:''}`);return}
  console.log(`PDF maintenance Task Scheduler: ${task.state||'unknown'}; enabled=${task.enabled?'yes':'no'}; trigger enabled=${task.triggerEnabled?'yes':'no'}; schedule active=${task.scheduleActive?'yes':'no'}; action=${taskActionDiagnosticLabel(task)}`);
  console.log(`  Last Run Time: ${task.lastRunTime||'never'}`);console.log(`  Last Result: ${taskResultLabel(task.lastResult)}`);console.log(`  Next Run Time: ${task.nextRunTime||'not scheduled'}`);console.log(`  Missed Runs: ${task.missedRuns}`);
}
return {pdfMaintenanceTaskDiagnostics,printPdfMaintenanceTaskDiagnostics,taskActionDiagnosticLabel,taskResultLabel};
}
