import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

export async function bankStage(t,{prepare=async()=>{}}={}){
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
  const entry=path.join(runtime,'server.mjs'),original=await fs.readFile(entry,'utf8');assert.ok(original.includes('const PORT=8765;'));
  await fs.writeFile(entry,original.replace('const PORT=8765;',`const PORT=${port};`));
  await fs.writeFile(path.join(app,'bridge-token.txt'),'native-fixture-token\n');
  await prepare({runtime,app,directory,port});
  let output='';
  async function start(){
    assert.ok(!child||child.exitCode!==null,'only a stopped owned child can be restarted');
    const offset=output.length;
    child=spawn(process.execPath,[entry],{cwd:runtime,env:{...process.env,LOCALAPPDATA:directory,CAMOUFOX_INSTALL_DIR:path.join(app,'camoufox')},windowsHide:true,stdio:['ignore','pipe','pipe']});
    exited=once(child,'exit');child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Bank staged startup deadline: '+output.slice(offset))),10000);
      const inspect=()=>{if(output.slice(offset).includes('listening on')){clearTimeout(timer);resolve()}};
      child.stdout.on('data',inspect);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Bank exited during startup '+code+': '+output.slice(offset)))});inspect();
    });
  }
  await start();
  const base=`http://127.0.0.1:${port}`;
  const request=(target,{method='GET',body,token='native-fixture-token',origin}={})=>new Promise((resolve,reject)=>{
    const req=http.request(base+target,{method,agent:false,headers:{Authorization:'Bearer '+token,...(origin===undefined?{}:{Origin:origin})}},res=>{
      const chunks=[];res.on('error',reject);res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
        const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:{get:key=>res.headers[key.toLowerCase()]},json:async()=>JSON.parse(bytes),arrayBuffer:async()=>bytes});
      });
    });
    // Functional native-vault coverage includes cold PowerShell/DPAPI startup.
    // A Windows CI DPAPI roundtrip alone took 12.4s; this is not a latency gate.
    const deadline=process.platform==='win32'?30000:10000;
    req.on('error',reject);req.setTimeout(deadline,()=>req.destroy(new Error(`staged HTTP deadline: ${method} ${new URL(base+target).pathname}`)));req.end(body===undefined?'':JSON.stringify(body));
  });
  return {directory,runtime,app,port,base,get child(){return child},get exited(){return exited},restart:start,request,output:()=>output};
}
