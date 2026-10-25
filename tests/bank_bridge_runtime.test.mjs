import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {bankStage} from './bank_stage_fixture.mjs';

test('staged Bank runtime starts its real HTTP capabilities with isolated files and no provider login',{timeout:process.platform==='win32'?120000:30000},async t=>{
  const key='a'.repeat(64),image=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const f=await bankStage(t,{prepare:async({app})=>{
    const cache=path.join(app,'cheque-image-cache'),now=new Date(),eventDate=String(now.getFullYear())+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0');
    await fs.mkdir(cache);await fs.writeFile(path.join(cache,key+'.bin'),image);await fs.writeFile(path.join(cache,key+'.json'),JSON.stringify({key,contentType:'image/png',size:image.length,eventDate}));
  }});
  const {app,request,exited}=f;
  assert.deepEqual(await (await request('/health?probe=1',{token:'wrong'})).json(),{ok:true,service:'netunim-kupa-bank-bridge',version:75,creditContractVersion:2});
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
  const [code]=await exited;assert.equal(code,0,f.output());assert.ok(!f.output().includes('native-fixture-token'));assert.ok(!f.output().includes('synthetic'));

  // Revoke only this disposable installation's token after a confirmed drain.
  // Persisted vault bytes and retained images must survive re-pairing.
  const vault=new Map();
  if(process.platform==='win32')for(const file of ['hapoalim-credentials.dpapi','credit-card-profiles.dpapi'])vault.set(file,await fs.readFile(path.join(app,file)));
  await fs.rename(path.join(app,'bridge-token.txt'),path.join(app,'revoked-test-token.txt'));
  await f.restart();
  const replacement=(await fs.readFile(path.join(app,'bridge-token.txt'),'utf8')).trim();
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(replacement),'replacement must encode 32 random bytes');
  assert.equal(Buffer.from(replacement,'base64url').length,32);assert.notEqual(replacement,'native-fixture-token');
  for(const [target,method] of [['/status','GET'],['/credentials','DELETE'],['/reset','POST'],['/shutdown','POST']]){
    assert.equal((await request(target,{method,token:'native-fixture-token'})).status,401,`old token remained authorized for ${target}`);
  }
  const repaired=await (await request('/status',{token:replacement})).json();
  assert.equal(repaired.configured,process.platform==='win32');
  for(const [file,bytes] of vault)assert.deepEqual(await fs.readFile(path.join(app,file)),bytes);
  if(process.platform==='win32')assert.equal((await (await request('/v2/credit/status',{token:replacement})).json()).profiles.length,2);
  assert.deepEqual(Buffer.from(await (await request('/bank/cheque-image/'+key,{token:replacement})).arrayBuffer()),image);
  assert.equal((await request('/shutdown',{method:'POST',token:replacement})).status,200);
  assert.equal((await f.exited)[0],0,f.output());assert.ok(!f.output().includes(replacement));
});
