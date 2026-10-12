import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {indexFixture} from './pdf_index_file_fixture.mjs';

const script=fileURLToPath(new URL('./fixtures/pdf_index_write_process_worker.mjs',import.meta.url));
function worker(t,root,label,mode='append'){
  const child=spawn(process.execPath,[script,root,label,mode],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']}),messages=[],waiters=[];let stderr='';
  const closed=new Promise(resolve=>child.once('close',resolve));child.stderr.setEncoding('utf8');child.stderr.on('data',text=>{stderr+=text});
  child.on('message',message=>{messages.push(message);for(const waiter of waiters.splice(0))waiter()});
  t.after(async()=>{if(child.exitCode===null&&!child.killed)child.kill();await closed});
  async function receive(kind){let timer;try{return await Promise.race([new Promise(resolve=>{const inspect=()=>{const message=messages.find(value=>value.kind===kind);if(message)resolve(message);else waiters.push(inspect)};inspect()}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`writer ${label} missing ${kind}: ${stderr}`)),12000)})])}finally{clearTimeout(timer)}}
  return {child,closed,receive,messages};
}
test('two native writers serialize append and compaction without erasing either update',async t=>{
  const f=await indexFixture(t),root=path.dirname(f.snapshotPath),first=worker(t,root,'first');await first.receive('locked');
  const second=worker(t,root,'second','compact');await second.receive('ready');assert.equal(second.messages.some(value=>value.kind==='locked'),false);
  first.child.send('release');await first.receive('done');assert.equal(await first.closed,0);await second.receive('locked');second.child.send('release');await second.receive('done');assert.equal(await second.closed,0);
  const recovered=await f.fresh();assert.equal(recovered.entries.get('c:\\synthetic\\first.pdf').text,'first');assert.equal(recovered.entries.get('c:\\synthetic\\second.pdf').text,'second');assert.equal(recovered.entries.size,4);
  assert.equal(await fs.readFile(f.journalPath,'utf8'),'');assert.deepEqual((await fs.readdir(root)).filter(name=>name.includes('lock')||name.includes('.tmp-')),[]);
});
test('native crash after snapshot commit preserves replay; a fresh owner can finish compaction',async t=>{
  const f=await indexFixture(t),expected=[... (await f.fresh()).entries.values()].map(JSON.stringify),root=path.dirname(f.snapshotPath),crashed=worker(t,root,'crashed','crash');
  await crashed.receive('locked');crashed.child.send('release');await crashed.receive('snapshot-committed');crashed.child.kill('SIGKILL');await crashed.closed;
  assert.equal(await fs.readFile(f.journalPath,'utf8'),f.journalBytes);assert.deepEqual([... (await f.fresh()).entries.values()].map(JSON.stringify),expected);
  const next=worker(t,root,'next','compact');await next.receive('locked');next.child.send('release');await next.receive('done');assert.equal(await next.closed,0);
  const recovered=await f.fresh();assert.deepEqual([...recovered.entries.values()].filter(entry=>entry.fullPath!=='C:\\synthetic\\next.pdf').map(JSON.stringify),expected);
  assert.equal(recovered.entries.size,3);assert.equal(recovered.entries.get('c:\\synthetic\\next.pdf').text,'next');assert.equal(await fs.readFile(f.journalPath,'utf8'),'');
});
