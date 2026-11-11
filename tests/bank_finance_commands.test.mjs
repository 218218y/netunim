import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {configurationHandler} from './bank_configuration_fixture.mjs';
import {httpFixture} from './bank_http_fixture.mjs';
import {createBankBridgeClient} from '../shared/bank-bridge-client.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};

test('authorized refresh reports real progress before the final result and keeps the legacy JSON contract',async t=>{
  const held=gate(),reported=gate(),result={fetchedAt:'בדיקה',accounts:{}};
  const f=await httpFixture(t,{providerPorts:{scrapeHapoalimSnapshot:async(_credentials,{onProgress})=>{
    onProgress?.('business');
    await held.promise;
    return result;
  }}});
  const denied=await f.request('/balance',{method:'POST',body:'{"streamProgress":true}',token:'wrong'});
  assert.equal(denied.status,401);
  assert.match(denied.headers['content-type'],/^application\/json/);
  const client=createBankBridgeClient({
    tokenStore:{get:()=>'fixture-token',set:()=>{}},
    fetchRequest:(url,options)=>fetch(f.base+new URL(url).pathname,options),
    timers:{setTimeout:callback=>setTimeout(callback,3000),clearTimeout},
    createAbortController:()=>new AbortController(),
  });
  const request=client.fetchBalance({onProgress:reported.resolve});
  try{
    const progress=await Promise.race([reported.promise,request.then(()=>assert.fail('final result preceded progress'))]);
    assert.deepEqual(progress,{stage:'business'});
  }finally{held.resolve()}
  assert.deepEqual(await request,{ok:true,...result});
  const legacy=await f.request('/balance',{method:'POST',body:'{}'});
  assert.match(legacy.headers['content-type'],/^application\/json/);
  assert.deepEqual(legacy.data,{ok:true,...result});
});

test('a streamed credit provider failure retains its error and never retries the operation',async t=>{
  let attempts=0;
  const f=await httpFixture(t,{providerPorts:{scrapeAllCreditProfiles:async(_profiles,{onProgress})=>{
    attempts++;
    onProgress?.('profile',1,2);
    throw Object.assign(new Error('בדיקה'),{code:'NOT_FOUND',stage:'data'});
  }}});
  const client=createBankBridgeClient({
    tokenStore:{get:()=>'fixture-token',set:()=>{}},
    fetchRequest:(url,options)=>fetch(f.base+new URL(url).pathname,options),
    timers:globalThis,
    createAbortController:()=>new AbortController(),
  });
  const progress=[];
  await assert.rejects(client.syncCreditCards({onProgress:event=>progress.push(event)}),
    error=>error.code==='BRIDGE_ERROR'&&error.stage==='data'&&!error.message.includes('בדיקה'));
  assert.deepEqual(progress,[{stage:'profile',index:1,total:2}]);
  assert.equal(attempts,1);
});

test('bank command keeps partial home/transaction warnings and complete business data',async()=>{
  const metadata=[],input=[];
  const result={fetchedAt:'2026-10-12T10:00:00Z',accounts:{business:{balance:42,transactionWarning:'fixture history unavailable'},home:null},accountFailures:{home:{message:'fixture home missing',code:'ACCOUNT_NOT_FOUND',stage:'account',httpStatus:404,availableAccounts:[{accountNumber:'0007'}]}}};
  const f=configurationHandler({providerPorts:{scrapeHapoalimSnapshot:async(credentials,options)=>{input.push({credentials,options});return result},writeMeta:async value=>metadata.push(value)}});
  assert.deepEqual(await f.finance.balance({historyDays:9999,interactive:1}),result);
  assert.equal(input[0].options.historyDays,365);assert.equal(input[0].options.interactive,true);
  assert.equal(metadata[0].lastScrapeAt,result.fetchedAt);assert.equal(metadata[0].lastError,'');assert.equal(metadata[0].lastWarning,'עסקי: fixture history unavailable | ביתי: fixture home missing');assert.equal(metadata[0].lastWarningCode,'ACCOUNT_NOT_FOUND');assert.equal(metadata[0].lastAccountRole,'home');assert.deepEqual(metadata[0].lastAvailableAccounts,[{accountNumber:'0007'}]);
  await f.finance.balance({historyDays:1});assert.equal(input[1].options.historyDays,30);
});

test('not-configured and vault read failure never enter providers or manufacture bank metadata',async()=>{
  for(const readCredentials of [async()=>null,async()=>{throw Object.assign(new Error('vault corrupt'),{code:'VAULT_CORRUPT'})}]){
    let providers=0,metadata=0;const f=configurationHandler({vault:{readCredentials},providerPorts:{scrapeHapoalimSnapshot:async()=>{providers++},writeMeta:async()=>{metadata++}}});
    await assert.rejects(f.finance.balance({}),error=>['NOT_CONFIGURED','VAULT_CORRUPT'].includes(error.code));assert.equal(providers,0);assert.equal(metadata,0);
    assert.equal(await f.operations.configuration(()=>42),42);
  }
});

test('credit command preserves partial success, exclusion normalization and local-only raw samples',async()=>{
  const calls=[],profile={profileId:'P',provider:'max',accounts:[],coreComplete:false},issuerError={profileId:'P',code:'PARTIAL',stage:'',httpStatus:0,message:'חלק מנתוני הספק לא התקבלו. יש לבדוק את שלמות הנתונים לפני שימוש בהם.'},previous=[{code:'PRIOR'}];
  const result={contractVersion:2,correlationId:'fixture-correlation',profiles:[profile],errors:[issuerError],syncedAt:null,attemptedCount:1,deferredCount:0,_dataDiagnostics:[{provider:'max',profileId:'P',secretFixture:'raw-local-only'}]};
  const f=configurationHandler({readProfiles:async()=>[{profileId:'P',credentials:{password:'private'}}],providerPorts:{
    readCreditMeta:async()=>({lastErrors:previous}),scrapeAllCreditProfiles:async(profiles,options)=>{calls.push(['scrape',profiles,options]);return result},
    writeCreditDataDiagnostic:async value=>calls.push(['diagnostic',value]),writeCreditMeta:async value=>calls.push(['meta',value])}});
  const output=await f.finance.syncCredit({interactive:1,syncMode:'forecast',selection:[{profileId:' P ',excludedAccounts:['123',' 123 ','456','']},{profileId:'empty',excludedAccounts:[]}]});
  assert.deepEqual(calls.map(row=>row[0]),['scrape','diagnostic','meta']);assert.equal(calls[0][2].interactive,true);assert.equal(calls[0][2].syncMode,'forecast');assert.deepEqual(calls[0][2].previousErrors,previous);assert.deepEqual(calls[0][2].selection,[{profileId:'P',excludedAccounts:['123','456']}]);
  assert.equal(output._dataDiagnostics,undefined);assert.ok(!JSON.stringify(output).includes('raw-local-only'));assert.deepEqual(output.errors,[issuerError]);assert.equal(output.profiles[0].coreComplete,false);assert.equal(calls[2][1].lastSyncAt,undefined);assert.equal(calls[2][1].lastAttemptedCount,1);
});

for(const attemptedCount of [0,1])test(`credit ${attemptedCount?'failure':'deferral'} publishes metadata with its existing success/error envelope`,async t=>{
  const error={code:'CREDIT_SYNC_FAILED',stage:'',httpStatus:0,message:'סנכרון האשראי נכשל. בדוק את מצב החיבור ואת קוד התקלה.'},metadata=[];
  const f=await httpFixture(t,{providerPorts:{scrapeAllCreditProfiles:async()=>({contractVersion:2,profiles:[],errors:[error],syncedAt:null,attemptedCount,deferredCount:1,correlationId:'fixture'}),writeCreditMeta:async value=>metadata.push(value)}});
  const response=await f.request('/v2/credit/sync',{method:'POST',body:'{}'});
  assert.equal(metadata.length,1);assert.equal(metadata[0].lastSyncAt,undefined);assert.deepEqual(metadata[0].lastErrors,[error]);
  assert.equal(response.status,attemptedCount?400:200);
  if(attemptedCount){assert.equal(response.data.code,'CREDIT_SYNC_FAILED');assert.deepEqual(response.data.creditErrors,[error])}
  else{assert.equal(response.data.ok,true);assert.equal(response.data.deferredCount,1)}
});

test('HTTP client disconnect retains accepted provider work and metadata ownership',async t=>{
  const entered=gate(),held=gate(),publishing=gate(),finish=gate(),committed=gate();let effects=0,mutations=0;
  const f=await httpFixture(t,{writeProfiles:async()=>{mutations++},providerPorts:{
    scrapeHapoalimSnapshot:async()=>{entered.resolve();await held.promise;effects++;return {fetchedAt:'fixture',accounts:{}}},
    writeMeta:async()=>{publishing.resolve();await finish.promise;committed.resolve()}}});
  const request=http.request(f.base+'/balance',{method:'POST',headers:{Authorization:'Bearer fixture-token'}},res=>res.resume());request.on('error',()=>{});request.end('{}');
  await entered.promise;request.destroy();
  try{
    const busy=await f.request('/credit/profiles',{method:'POST',body:'{}'});assert.equal(busy.data.code,'SCRAPE_BUSY');
    held.resolve();await publishing.promise;
    const publishingBusy=await f.request('/credit/reset',{method:'POST'});assert.equal(publishingBusy.data.code,'SCRAPE_BUSY');assert.equal(mutations,0);assert.equal(effects,1);
  }finally{held.resolve();finish.resolve();await committed.promise}
  await f.drain();await f.api.operations.configuration(()=>{});assert.equal(await f.api.operations.provider(()=>7),7);
});
