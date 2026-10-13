import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {bankStage} from './bank_stage_fixture.mjs';

test('native Bank provider composition keeps browser cleanup owned before public metadata publication',{timeout:30000},async t=>{
  const f=await bankStage(t,{prepare:async({runtime})=>{
    await fs.copyFile(new URL('./fixtures/bank_provider_runtime.mjs',import.meta.url),path.join(runtime,'fixture-scrapers.mjs'));
    const file=path.join(runtime,'server.mjs'),source=await fs.readFile(file,'utf8');
    const locate=/findInstalled:\s*browserLocator\.find/,load=/loadScrapers:\s*\(\)\s*=>\s*import\('israeli-bank-scrapers'\)/,vault='const vault=createConnectionVault({directory:APP_DIR,protectText,unprotectText});';
    assert.ok(locate.test(source));assert.ok(load.test(source));assert.ok(source.includes(vault));
    await fs.writeFile(file,source.replace(locate,"findInstalled:async()=> 'fixture-browser'").replace(load,"loadScrapers:()=>import('./fixture-scrapers.mjs')")
      .replace(vault,"const vault={...createConnectionVault({directory:APP_DIR,protectText,unprotectText}),readCredentials:async()=>({userCode:'0012',password:' exact synthetic secret ',branchNumber:'345',accountNumber:'678901'})};"));
  }});
  const reading=f.request('/balance',{method:'POST',body:{historyDays:30}}),entered=path.join(f.app,'fixture-terminate-entered'),deadline=Date.now()+10000;
  let completed=false;void reading.then(()=>{completed=true},()=>{completed=true});
  try{
    while(true){try{await fs.access(entered);break}catch(error){if(error.code!=='ENOENT')throw error;if(Date.now()>deadline)throw new Error('provider did not reach cleanup: '+f.output());await new Promise(resolve=>setTimeout(resolve,10))}}
    assert.equal(completed,false);assert.equal((await (await f.request('/credit/reset',{method:'POST'})).json()).code,'SCRAPE_BUSY');
    const diagnostic=JSON.parse(await fs.readFile(path.join(f.app,'diagnostics','bank-latest.json'),'utf8'));assert.equal(diagnostic.bridgeVersion,73);
    const interim=JSON.parse(await fs.readFile(path.join(f.app,'status.json'),'utf8'));assert.equal(interim.sessionUrl,'https://login.bankhapoalim.co.il/dashboard');assert.equal(interim.lastScrapeAt,null);
  }finally{await fs.writeFile(path.join(f.app,'fixture-terminate-release'),'release')}
  const response=await reading;assert.equal(response.status,200);const result=await response.json();assert.equal(result.balance,42);assert.equal(result.accounts.business.accountNumber,'678901');assert.equal(result.accounts.business.transactionCoverage.complete,true);
  assert.equal(result.sessionHref,undefined);const status=await (await f.request('/status')).json();assert.equal(status.lastScrapeAt,result.fetchedAt);
  const events=(await fs.readFile(path.join(f.app,'fixture-provider-trace.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(event=>event.stage),['initialize','login','terminate','terminated']);assert.equal(events[2].success,true);
  assert.deepEqual(await (await f.request('/shutdown',{method:'POST'})).json(),{ok:true});assert.equal((await f.exited)[0],0,f.output());assert.ok(!f.output().includes('exact synthetic secret'));
});
