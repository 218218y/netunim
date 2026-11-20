import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
const root=fileURLToPath(new URL('../netunim-kupa/bank-bridge/',import.meta.url));

test('Bank installer stages every transitive configuration/platform dependency before activation',()=>{
  const installer=fs.readFileSync(path.join(root,'runtime-files.txt'),'utf8');
  const list=installer.trim();assert.ok(list);
  const files=list.split(/\r?\n/);
  for(const file of files)assert.ok(/^[A-Za-z0-9_.-]+$/.test(file)&&fs.existsSync(path.join(root,file)),`one existing runtime file per line: ${file}`);
  assert.equal(new Set(files).size,files.length,'runtime files cannot be duplicated');
  const staged=new Set(files),seen=new Set();
  function visit(file){
    if(seen.has(file))return;seen.add(file);assert.ok(staged.has(file),`unstaged Bank runtime dependency: ${file}`);
    const ast=parse(fs.readFileSync(path.join(root,file),'utf8'),{ecmaVersion:'latest',sourceType:'module'});
    for(const node of ast.body){
      if(!['ImportDeclaration','ExportAllDeclaration','ExportNamedDeclaration'].includes(node.type)||!node.source||!String(node.source.value).startsWith('.'))continue;
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),String(node.source.value)));
      assert.ok(!dependency.startsWith('../'));visit(dependency);
    }
  }
  visit('server.mjs');
  for(const file of ['hapoalim-policy.mjs','hapoalim-navigation-policy.mjs','hapoalim-login-runtime.mjs','hapoalim-account-selector.mjs','hapoalim-account-model.mjs','hapoalim-detail-values.mjs','hapoalim-detail-keys.mjs','hapoalim-cheque-model.mjs','hapoalim-credit-settlement-model.mjs','hapoalim-additional-details-model.mjs','hapoalim-date-codec.mjs','hapoalim-transaction-model.mjs','hapoalim-failure-policy.mjs','credit-core-values.mjs','credit-profile-model.mjs','credit-transaction-model.mjs','credit-failure-policy.mjs','credit-value-codec.mjs','credit-month-plan.mjs','credit-sync-scope.mjs','credit-http-policy.mjs','credit-http.mjs','credit-scheduler.mjs','visa-cal-model.mjs','credit-coverage.mjs','visa-cal-session.mjs','credit-adapter-base.mjs','visa-cal-adapter.mjs','max-model.mjs','credit-monthly-projection.mjs','max-adapter.mjs','isracard-group-adapter.mjs','credit-adapter-factory.mjs','credit-adapter-wire.mjs','json-artifact-owner.mjs','bridge-artifacts.mjs','credit-diagnostic-model.mjs','credit-diagnostic-log.mjs','hapoalim-wire.mjs','hapoalim-json.mjs','hapoalim-enrichment.mjs','hapoalim-accounts.mjs','cheque-images.mjs','file-task-owner.mjs','browser-locator.mjs','windows-browser.mjs','provider-errors.mjs','hapoalim-session.mjs','hapoalim-provider.mjs','credit-session.mjs','credit-provider.mjs','shutdown-owner.mjs','replacement-command.mjs','loopback-port.mjs','operation-owner.mjs','connection-commands.mjs','connection-settings.mjs','connection-vault.mjs','windows-platform.mjs','http-handler.mjs','http-routes.mjs','wire-errors.mjs','connection-queries.mjs','finance-commands.mjs','diagnostic-queries.mjs'])assert.ok(seen.has(file),file);
  assert.ok(staged.has('start_bank_bridge.bat'));
  assert.ok(staged.has('package-lock.json'));
});

test('Windows sign-in launcher runs without a console, retries a failure, and respects graceful shutdown', {skip:process.platform!=='win32'}, async()=>{
  const localAppData=fs.mkdtempSync(path.join(tmpdir(),'netunim-bank-בדיקה-'));
  const appRoot=path.join(localAppData,'NetunimKupaBankBridge');
  const setup=path.join(appRoot,'setup');
  const active=path.join(appRoot,'app');
  const stop=path.join(appRoot,'finish-test');
  const log=path.join(appRoot,'autostart.log');
  const launcher=path.join(setup,'BankBridgeStartup.exe');
  const runtime='node-v24.22.2-win-x64-20261120-000000-1-aabbccdd';
  const node=path.join(appRoot,runtime,'node.exe');
  let result;
  try{
    fs.mkdirSync(setup,{recursive:true});
    fs.mkdirSync(active);
    fs.mkdirSync(path.dirname(node));
    fs.writeFileSync(path.join(appRoot,'node-runtime.txt'),runtime);
    fs.writeFileSync(path.join(active,'server.mjs'),'fixture');
    for(const file of ['bank_bridge_autostart.ps1','bank_bridge_startup.cs'])
      fs.copyFileSync(path.join(root,file),path.join(setup,file));
    const powershellArgs=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass'];
    execFileSync('powershell.exe',[...powershellArgs,'-File',path.join(setup,'bank_bridge_autostart.ps1'),'-Mode','Prepare'],{windowsHide:true});
    const image=fs.readFileSync(launcher),pe=image.readUInt32LE(60);
    assert.equal(image.readUInt16LE(pe+24+68),2,'the launcher must target the Windows GUI subsystem');

    const probe=path.join(setup,'console-probe.cs');
    fs.writeFileSync(probe,`
      using System;
      using System.IO;
      using System.Runtime.InteropServices;
      using System.Threading;
      public class ConsoleProbe {
        [DllImport("kernel32.dll")] private static extern IntPtr GetConsoleWindow();
        public static int Main() {
          if(GetConsoleWindow() != IntPtr.Zero) return 24;
          if(!File.Exists("first-attempt")) {
            File.WriteAllText("first-attempt", "");
            Console.Error.WriteLine("simulated listener failure");
            return 23;
          }
          Console.WriteLine("Netunim Kupa Bank Bridge v93 listening on http://127.0.0.1:8765");
          DateTime deadline=DateTime.UtcNow.AddSeconds(15);
          while(!File.Exists("finish-test") && DateTime.UtcNow < deadline) Thread.Sleep(50);
          return 0;
        }
      }
    `);
    execFileSync('powershell.exe',[...powershellArgs,'-Command',
      'Add-Type -LiteralPath $env:NETUNIM_TEST_PROBE -OutputType ConsoleApplication -OutputAssembly $env:NETUNIM_TEST_NODE',
    ],{windowsHide:true,env:{...process.env,NETUNIM_TEST_PROBE:probe,NETUNIM_TEST_NODE:node}});
    result=new Promise(resolve=>execFile(launcher,[],{timeout:25000},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
    const deadline=Date.now()+16000;
    let ready=false;
    while(Date.now()<deadline){
      try{ready=fs.readFileSync(log,'utf8').includes('Bank Bridge is listening')}
      catch(error){if(!['ENOENT','EBUSY'].includes(error.code))throw error}
      if(ready)break;
      await delay(50);
    }
    assert.ok(ready,'launcher should log readiness while the listener is still running');
    fs.closeSync(fs.openSync(path.join(appRoot,'setup.lock'),'r+'));
    fs.writeFileSync(stop,'');
    const {error,stderr}=await result;
    assert.equal(error,null,stderr);
    const startupLog=fs.readFileSync(log,'utf8');
    assert.match(startupLog,/exited with code 23/);
    assert.match(startupLog,/Retrying Bank Bridge in 2 seconds/);
    assert.match(startupLog,/exited with code 0/);
    assert.equal(startupLog.match(/Retrying Bank Bridge/g)?.length,1);
    assert.match(fs.readFileSync(path.join(appRoot,'bridge.log'),'utf8'),/simulated listener failure/);
  }finally{
    if(result){
      fs.writeFileSync(stop,'');
      await result;
    }
    fs.rmSync(localAppData,{recursive:true,force:true});
  }
});
