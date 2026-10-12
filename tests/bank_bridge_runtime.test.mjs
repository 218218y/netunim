import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

test('staged Bank runtime starts its real HTTP capabilities with isolated files and no provider login',{timeout:30000},async t=>{
  const probe=net.createServer();
  const port=await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();assert.ok(address&&typeof address==='object');probe.close(()=>resolve(address.port))})});
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'netunim bank runtime '));
  let child=null,exited=null;
  t.after(async()=>{
    if(child&&child.exitCode===null)child.kill();if(exited)await exited;
    const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('netunim bank runtime '));await fs.rm(resolved,{recursive:true,force:true});
  });
  const root=fileURLToPath(new URL('../netunim-kupa/bank-bridge/',import.meta.url)),runtime=path.join(directory,'staged runtime'),app=path.join(directory,'NetunimKupaBankBridge');
  await fs.mkdir(runtime);await fs.mkdir(app);
  const installer=await fs.readFile(path.join(root,'install_bank_bridge.bat'),'utf8'),staged=installer.match(/for %%F in \((server\.mjs[^)]+)\)/)?.[1];assert.ok(staged);
  for(const file of staged.split(/\s+/).filter(file=>file.endsWith('.mjs')))await fs.copyFile(path.join(root,file),path.join(runtime,file));
  // The private staged copy uses an ephemeral listener. Only the port constant
  // changes; no operator service is stopped, paired, read or written.
  const entry=path.join(runtime,'server.mjs'),original=await fs.readFile(entry,'utf8');assert.ok(original.includes('const PORT=8765;'));
  await fs.writeFile(entry,original.replace('const PORT=8765;',`const PORT=${port};`));
  await fs.writeFile(path.join(app,'bridge-token.txt'),'native-fixture-token\n');
  const key='a'.repeat(64),image=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),cache=path.join(app,'cheque-image-cache'),now=new Date(),eventDate=String(now.getFullYear())+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0');
  await fs.mkdir(cache);await fs.writeFile(path.join(cache,key+'.bin'),image);await fs.writeFile(path.join(cache,key+'.json'),JSON.stringify({key,contentType:'image/png',size:image.length,eventDate}));
  let output='';child=spawn(process.execPath,[path.join(runtime,'server.mjs')],{cwd:runtime,env:{...process.env,LOCALAPPDATA:directory,CAMOUFOX_INSTALL_DIR:path.join(app,'camoufox')},windowsHide:true,stdio:['ignore','pipe','pipe']});
  exited=once(child,'exit');
  child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Bank staged startup deadline: '+output)),10000);
    const inspect=()=>{if(output.includes('listening on')){clearTimeout(timer);resolve()}};
    child.stdout.on('data',inspect);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Bank exited during startup '+code+': '+output))});inspect();
  });
  const request=(target,{method='GET',body,token='native-fixture-token'}={})=>new Promise((resolve,reject)=>{
    const req=http.request(`http://127.0.0.1:${port}`+target,{method,agent:false,headers:{Authorization:'Bearer '+token}},res=>{
      const chunks=[];res.on('error',reject);res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
        const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:{get:key=>res.headers[key.toLowerCase()]},json:async()=>JSON.parse(bytes),arrayBuffer:async()=>bytes});
      });
    });
    req.on('error',reject);req.setTimeout(10000,()=>req.destroy(new Error('staged HTTP deadline')));req.end(body===undefined?'':JSON.stringify(body));
  });
  assert.deepEqual(await (await request('/health?probe=1',{token:'wrong'})).json(),{ok:true,service:'netunim-kupa-bank-bridge',version:73,creditContractVersion:2});
  assert.equal((await request('/credentials',{method:'POST',body:{password:'never-save-this'},token:'wrong'})).status,401);await assert.rejects(fs.access(path.join(app,'hapoalim-credentials.dpapi')),{code:'ENOENT'});
  const status=await (await request('/status')).json();assert.equal(status.configured,false);assert.equal(status.branchNumber,'');
  assert.equal((await (await request('/balance',{method:'POST',body:{}})).json()).code,'NOT_CONFIGURED');
  assert.equal((await (await request('/v2/credit/sync',{method:'POST',body:{}})).json()).code,'CREDIT_NOT_CONFIGURED');
  const binary=await request('/bank/cheque-image/'+key);assert.equal(binary.status,200);assert.deepEqual(Buffer.from(await binary.arrayBuffer()),image);assert.equal(binary.headers.get('x-content-type-options'),'nosniff');
  if(process.platform==='win32'){
    assert.equal((await request('/credentials',{method:'POST',body:{userCode:'0012',password:' synthetic bank secret ',branchNumber:'001',accountNumber:'000123'}})).status,200);
    const bank=await (await request('/status')).json();assert.equal(bank.businessAccountNumber,'000123');assert.ok(!JSON.stringify(bank).includes('secret'));
    const profiles=await Promise.all(['first','second'].map(profileId=>request('/credit/profiles',{method:'POST',body:{profileId,provider:'max',username:profileId,password:' synthetic credit secret '}})));
    assert.deepEqual(profiles.map(response=>response.status),[200,200]);assert.equal((await (await request('/v2/credit/status')).json()).profiles.length,2);
    for(const file of ['hapoalim-credentials.dpapi','credit-card-profiles.dpapi'])assert.ok(!(await fs.readFile(path.join(app,file),'utf8')).includes('synthetic'));
  }
  assert.deepEqual(await (await request('/shutdown',{method:'POST'})).json(),{ok:true});
  const [code]=await exited;assert.equal(code,0,output);assert.ok(!output.includes('native-fixture-token'));assert.ok(!output.includes('synthetic'));
});
