import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {bankStage} from './bank_stage_fixture.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('the actual replacement CLI cannot mistake an unanswered health probe for an absent process',{timeout:15000},async t=>{
  const f=await bankStage(t,{prepare:async({runtime})=>{
    const entry=path.join(runtime,'server.mjs'),source=await fs.readFile(entry,'utf8');
    const anchor='activeServer=http.createServer(handler);';assert.ok(source.includes(anchor));
    await fs.writeFile(entry,source.replace(anchor,"activeServer=http.createServer((req,res)=>req.url==='/health'?undefined:handler(req,res));"));
  }});
  let output='';const cli=spawn(process.execPath,[path.join(f.runtime,'server.mjs'),'--stop-existing'],{cwd:f.runtime,env:{...process.env,LOCALAPPDATA:f.directory},windowsHide:true,stdio:['ignore','pipe','pipe']});const exited=once(cli,'exit');
  cli.stdout.on('data',chunk=>{output+=chunk});cli.stderr.on('data',chunk=>{output+=chunk});t.after(async()=>{if(cli.exitCode===null)cli.kill();await exited});
  assert.equal((await exited)[0],1,output);assert.match(output,/listener state could not be confirmed/);assert.equal(f.child.exitCode,null);
  assert.deepEqual(await (await f.request('/shutdown',{method:'POST'})).json(),{ok:true});assert.equal((await f.exited)[0],0,f.output());
});

test('native shutdown retains an accepted vault deletion after its HTTP client disconnects',{timeout:15000},async t=>{
  const f=await bankStage(t,{prepare:async({runtime,app})=>{
    await fs.writeFile(path.join(app,'credit-card-profiles.dpapi'),'retained ciphertext fixture\n');
    const file=path.join(runtime,'connection-vault.mjs'),source=await fs.readFile(file,'utf8');
    const before='deleteCreditProfiles: () => fs.rm(CREDIT_PROFILES_FILE, { force: true })';assert.ok(source.includes(before));
    const held=`deleteCreditProfiles: async () => {
      await fs.writeFile(path.join(directory,'fixture-deletion-entered'),'entered');
      while(true){try{await fs.access(path.join(directory,'fixture-deletion-release'));break}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(resolve=>setTimeout(resolve,10))}}
      await fs.rm(CREDIT_PROFILES_FILE,{force:true});
    }`;
    await fs.writeFile(file,source.replace(before,held));
  }});
  const deleting=http.request(f.base+'/credit/reset',{method:'POST',agent:false,headers:{Authorization:'Bearer native-fixture-token'}},res=>res.resume());deleting.on('error',()=>{});deleting.end();
  const entered=path.join(f.app,'fixture-deletion-entered'),deadline=Date.now()+5000;
  while(true){try{await fs.access(entered);break}catch(error){if(error.code!=='ENOENT')throw error;if(Date.now()>deadline)throw new Error('vault deletion did not enter');await pause(10)}}
  const disconnected=new Promise(resolve=>deleting.once('close',resolve));deleting.destroy();await disconnected;
  try{
    assert.deepEqual(await (await f.request('/shutdown',{method:'POST'})).json(),{ok:true});
    const stopped=await Promise.race([f.exited.then(()=>true),pause(150).then(()=>false)]);
    assert.equal(stopped,false,'closing HTTP sockets must not terminate the accepted vault obligation');
    assert.equal((await fs.readFile(path.join(f.app,'credit-card-profiles.dpapi'),'utf8')),'retained ciphertext fixture\n');
    assert.equal((await f.request('/health')).status,200,'the listener must remain visible until obligations drain');
    const refused=await f.request('/credit/reset',{method:'POST'});assert.equal(refused.status,400);assert.equal((await refused.json()).code,'BRIDGE_STOPPING');
  }finally{await fs.writeFile(path.join(f.app,'fixture-deletion-release'),'release')}
  const [code]=await f.exited;assert.equal(code,0,f.output());await assert.rejects(fs.access(path.join(f.app,'credit-card-profiles.dpapi')),{code:'ENOENT'});
});

test('native shutdown waits for accepted diagnostic bytes after its HTTP listener becomes otherwise idle',{timeout:15000},async t=>{
  const f=await bankStage(t,{prepare:async({runtime})=>{
    const entry=path.join(runtime,'server.mjs'),source=await fs.readFile(entry,'utf8');
    assert.ok(source.includes('shutdown.start();'));await fs.writeFile(entry,source.replace('shutdown.start();',"shutdown.start();creditDiagnostics.record({profileId:'native-fixture',stage:'FixtureDrain'});"));
    const logger=path.join(runtime,'credit-diagnostics.mjs'),original=await fs.readFile(logger,'utf8'),anchor='await fs.appendFile(logPath,';assert.ok(original.includes(anchor));
    const held="await fs.writeFile(path.join(directory,'fixture-log-entered'),'entered');while(true){try{await fs.access(path.join(directory,'fixture-log-release'));break}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(resolve=>setTimeout(resolve,10))}};";
    await fs.writeFile(logger,original.replace(anchor,held+anchor));
  }});
  const diagnostics=path.join(f.app,'diagnostics'),deadline=Date.now()+5000;
  while(true){try{await fs.access(path.join(diagnostics,'fixture-log-entered'));break}catch(error){if(error.code!=='ENOENT')throw error;if(Date.now()>deadline)throw new Error('diagnostic append did not enter');await pause(10)}}
  try{
    assert.deepEqual(await (await f.request('/shutdown',{method:'POST'})).json(),{ok:true});
    assert.equal(await Promise.race([f.exited.then(()=>true),pause(150).then(()=>false)]),false,'an idle socket set cannot authorize dropping the logger queue');
  }finally{await fs.writeFile(path.join(diagnostics,'fixture-log-release'),'release')}
  const [code]=await f.exited;assert.equal(code,0,f.output());
  const records=(await fs.readFile(path.join(diagnostics,'credit-diagnostics.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(records[0].profileId,'native-fixture');assert.equal(records[0].stage,'FixtureDrain');
});

test('the actual replacement CLI refuses to force-stop a bridge still draining',{timeout:15000},async t=>{
  const f=await bankStage(t,{prepare:async({runtime})=>{
    const file=path.join(runtime,'server.mjs'),source=await fs.readFile(file,'utf8');
    const original='waitUntilStopped:()=>waitForPortToClose(),';assert.ok(source.includes(original));
    await fs.writeFile(file,source.replace(original,'waitUntilStopped:()=>waitForPortToClose(200),'));
    // Hold a native diagnostic obligation past the CLI's shorter test wait.
    const logger=path.join(runtime,'credit-diagnostics.mjs'),originalLogger=await fs.readFile(logger,'utf8'),anchor='await fs.appendFile(logPath,';
    const held="await fs.writeFile(path.join(directory,'fixture-log-entered'),'entered');while(true){try{await fs.access(path.join(directory,'fixture-log-release'));break}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(resolve=>setTimeout(resolve,10))}};";
    await fs.writeFile(logger,originalLogger.replace(anchor,held+anchor));
    await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace('shutdown.start();',"shutdown.start();creditDiagnostics.record({stage:'FixtureReplacement'});"));
  }});
  const diagnostics=path.join(f.app,'diagnostics'),deadline=Date.now()+5000;
  while(true){try{await fs.access(path.join(diagnostics,'fixture-log-entered'));break}catch(error){if(error.code!=='ENOENT')throw error;if(Date.now()>deadline)throw new Error('diagnostic append did not enter');await pause(10)}}
  let output='';const cli=spawn(process.execPath,[path.join(f.runtime,'server.mjs'),'--stop-existing'],{cwd:f.runtime,env:{...process.env,LOCALAPPDATA:f.directory},windowsHide:true,stdio:['ignore','pipe','pipe']});const exited=once(cli,'exit');
  cli.stdout.on('data',chunk=>{output+=chunk});cli.stderr.on('data',chunk=>{output+=chunk});t.after(async()=>{if(cli.exitCode===null)cli.kill();await exited});
  try{
    const [code]=await exited;assert.equal(code,1,output);assert.match(output,/still finishing accepted work/);assert.equal(f.child.exitCode,null,'the installer must leave its draining service alive');
  }finally{await fs.writeFile(path.join(diagnostics,'fixture-log-release'),'release')}
  assert.equal((await f.exited)[0],0,f.output());assert.ok(!output.includes('native-fixture-token'));
});
