import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeOperationOwner} from '../netunim-kupa/bank-bridge/operation-owner.mjs';
import {bankProviderFixture,credentials,gate} from './bank_provider_fixture.mjs';

test('saved bank session skips login and publishes only after diagnostic and browser cleanup',async()=>{
  const f=bankProviderFixture();assert.deepEqual(f.calls,[]);
  const result=await f.read(credentials,{interactive:true,historyDays:365});
  assert.deepEqual(f.calls.map(row=>row[0]),['cache','locate','profile','load','create','decorate','initialize','reuse','read','remember','diagnostic','terminate']);
  assert.equal(result.balance,42);assert.equal(result.sessionHref,undefined);assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
  const options=f.calls.find(row=>row[0]==='create')[1];assert.equal(options.showBrowser,true);assert.equal(options.navigationRetryCount,1);assert.equal(options.defaultTimeout,30000);
  assert.deepEqual([...options.args],['--user-data-dir=fixture-profile','--profile-directory=Default','--no-first-run','--no-default-browser-check']);
  assert.equal(f.calls.at(-1)[1],true);assert.equal(f.calls.find(row=>row[0]==='read')[3],365);
});

test('fresh bank session logs in with exact secret bytes and establishes readiness before account reads',async()=>{
  const f=bankProviderFixture({session:{reuse:async()=>null}});await f.read(credentials);
  const names=f.calls.map(row=>row[0]);assert.ok(names.indexOf('login')<names.indexOf('ready'));assert.ok(names.indexOf('ready')<names.indexOf('read'));
  const login=f.calls.find(row=>row[0]==='login')[1];assert.equal(login.userCode,credentials.userCode);assert.equal(login.password,credentials.password);
});

test('provider reservation includes awaited diagnostic publication and terminal browser cleanup',async()=>{
  const diagnostic=gate(),terminate=gate(),entered=gate(),closing=gate(),owner=createBridgeOperationOwner();
  const f=bankProviderFixture({diagnostics:{write:async()=>{entered.resolve();await diagnostic.promise}},scraper:{terminate:async()=>{closing.resolve();await terminate.promise}}});
  let complete=false;const reading=owner.provider(()=>f.read(credentials)).then(value=>{complete=true;return value});
  await entered.promise;assert.equal(complete,false);await assert.rejects(owner.configuration(()=>{}),{code:'SCRAPE_BUSY'});
  owner.close();let drained=false;const drain=owner.drain().then(()=>{drained=true});diagnostic.resolve();await closing.promise;assert.equal(drained,false);
  terminate.resolve();assert.equal((await reading).balance,42);await drain;assert.equal(complete,true);
});

test('partial bank evidence is written on failure and cleanup errors cannot replace the original error',async()=>{
  const error=Object.assign(new Error('fixture read failed'),{code:'ACCOUNT_DATA_FAILED',stage:'transactions'});
  const f=bankProviderFixture({accounts:{read:async(page,input,ready,days,{diagnosticRun})=>{diagnosticRun.accounts.home.captured=1;throw error}},
    diagnostics:{write:async()=>{throw new Error('fixture diagnostic failure')}},scraper:{terminate:async()=>{throw new Error('fixture cleanup failure')}}});
  await assert.rejects(f.read(credentials),value=>value===error);assert.equal(f.calls.filter(row=>row[0]==='report').length,2);
});

test('failed initialization still terminates the allocated scraper without claiming a successful bank read',async()=>{
  const f=bankProviderFixture({scraper:{initialize:async()=>{throw new Error('fixture initialize')}}});
  await assert.rejects(f.read(credentials),{code:'BROWSER_START_FAILED',stage:'browser'});
  assert.equal(f.calls.at(-1)[0],'terminate');assert.equal(f.calls.at(-1)[1],false);assert.ok(!f.calls.some(row=>row[0]==='read'||row[0]==='diagnostic'));
});

test('bank login rejection retains its established taxonomy and never enters account reads',async()=>{
  const f=bankProviderFixture({session:{reuse:async()=>null},scraper:{login:async()=>({success:false,errorType:'INVALID_PASSWORD',errorMessage:'fixture'})}});
  await assert.rejects(f.read(credentials),{stage:'login'});assert.ok(!f.calls.some(row=>row[0]==='read'));assert.equal(f.calls.at(-1)[1],false);
});

test('bank cache housekeeping stays best effort while unsafe session URLs are never remembered',async()=>{
  const f=bankProviderFixture({cache:{cleanup:async()=>{throw new Error('fixture cache')}},session:{reuse:async()=>({ready:true,href:'https://other.example/secret'})},
    accounts:{read:async()=>({balance:7,sessionHref:'https://other.example/secret'})}});
  assert.equal((await f.read(credentials)).balance,7);assert.ok(f.calls.some(row=>row[0]==='report'));assert.ok(!f.calls.some(row=>row[0]==='remember'));
});
