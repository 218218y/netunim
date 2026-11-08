import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBankBrowserIdentity} from '../netunim-kupa/bank-bridge/bank-browser-identity.mjs';

test('local bank disconnect waits for browser exit and deletes cookies/session files before returning',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bank-disconnect-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'NetunimKupaBankBridge','browser-profile');
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'Cookies'),'synthetic session');
  let stopped=false;
  const identity=createBankBrowserIdentity({directory,stop:async target=>{assert.equal(target,directory);if(!stopped)await fs.access(path.join(target,'Cookies'));stopped=true}});
  await identity.clear();assert.equal(stopped,true);await assert.rejects(fs.access(directory),{code:'ENOENT'});
  await identity.clear();
});
test('failed browser shutdown or deletion is observable and never reports disconnect success',async()=>{
  const directory=path.resolve('NetunimKupaBankBridge/browser-profile');let deletions=0;
  await assert.rejects(createBankBrowserIdentity({directory,stop:async()=>{throw Error('still running')},files:{rm:async()=>{deletions++}}}).clear(),/still running/);
  assert.equal(deletions,0);
  await assert.rejects(createBankBrowserIdentity({directory,stop:async()=>{},files:{rm:async()=>{},access:async()=>{}}}).clear(),/DELETE_INCOMPLETE/);
  assert.throws(()=>createBankBrowserIdentity({directory:path.resolve('unrelated')}),/PATH_INVALID/);
});
