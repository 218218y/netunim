import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionFixture,browserPage} from './bank_session_fixture.mjs';

test('bank session adapter accepts authenticated accounts on an unfamiliar URL and preserves pinned login options',async()=>{
  const f=sessionFixture(),original={possibleResults:{SUCCESS:['/known'],INVALID_PASSWORD:['/invalid']},fixtureOption:42};
  const scraper={page:browserPage(),getLoginOptions:()=>original,login:async()=>({success:true})};
  assert.equal(f.api.decorate(scraper),scraper);const options=scraper.getLoginOptions({});await options.postAction();
  const [kind,results,wait]=f.calls.find(row=>row[0]==='terminal');assert.equal(kind,'terminal');assert.equal(await results.SUCCESS.at(-1)(),true);
  assert.equal(options.fixtureOption,42);assert.equal(original.possibleResults.SUCCESS.length,1);assert.equal(await options.possibleResults.SUCCESS.at(-1)(),true);
  assert.equal(wait.timeoutMs,90000);assert.equal(wait.timeoutCode,'SILENT_AUTH_TIMEOUT');assert.equal(wait.closedCode,'BANK_PAGE_CLOSED');
});

test('session-aware login recovers only transient navigation and retains interactive terminal policy',async()=>{
  const f=sessionFixture(),transient=new Error('Execution context was destroyed, most likely because of a navigation.');
  const scraper={page:browserPage(),getLoginOptions:()=>({possibleResults:{SUCCESS:['/known']}}),login:async()=>{scraper.getLoginOptions({});throw transient}};
  f.api.decorate(scraper,{interactive:true});assert.equal((await scraper.login({})).success,true);
  const wait=f.calls.find(row=>row[0]==='terminal')[2];assert.equal(wait.pollMs,350);assert.equal(wait.timeoutMs,600000);assert.equal(wait.closedCode,'INTERACTIVE_BROWSER_CLOSED');
  const ordinary=new Error('fixture invalid credentials'),other={page:browserPage(),getLoginOptions:()=>({}),login:async()=>{throw ordinary}};
  f.api.decorate(other);await assert.rejects(other.login({}),error=>error===ordinary);
});

test('terminal login state belongs to each decorated scraper',async()=>{
  let resultKey='SUCCESS';const f=sessionFixture({terminal:async()=>({resultKey})});
  const make=()=>({page:browserPage(),getLoginOptions:()=>({possibleResults:{SUCCESS:[],INVALID_PASSWORD:[]}}),login:async()=>({success:true})});
  const first=make(),second=make();f.api.decorate(first);f.api.decorate(second);
  const a=first.getLoginOptions({}),b=second.getLoginOptions({});await a.postAction();
  assert.equal(await a.possibleResults.SUCCESS.at(-1)(),true);assert.equal(await b.possibleResults.SUCCESS.at(-1)(),false);
  resultKey='INVALID_PASSWORD';await b.postAction();assert.equal(await b.possibleResults.INVALID_PASSWORD.at(-1)(),true);assert.equal(await a.possibleResults.SUCCESS.at(-1)(),true);
});

test('session readiness resets stability after navigation or a transient read failure',async()=>{
  const f=sessionFixture(),a={ready:true,href:'A',restContext:'one'},b={ready:true,href:'B',restContext:'two'};
  const values=[a,a,new Error('Execution context was destroyed'),b,b,b];let reads=0;
  const page={isClosed:()=>false,evaluate:async()=>{const value=values[Math.min(reads++,values.length-1)];if(value instanceof Error)throw value;return value}};
  assert.equal((await f.api.ready(page,{timeoutMs:2000,pollMs:100,stableMs:200})).href,'B');assert.equal(reads,6);assert.equal(f.clock.now(),500);
});

test('bank readiness timeout and closed-page failures retain classified detail without claiming readiness',async()=>{
  const f=sessionFixture(),last={ready:false,href:'fixture',restContext:'',status:403,message:'fixture denial'};
  await assert.rejects(f.api.ready({isClosed:()=>false,evaluate:async()=>last},{timeoutMs:1000,pollMs:350}),error=>error.code==='BANK_SESSION_NOT_READY'&&error.detail.status===403);
  await assert.rejects(f.api.ready({isClosed:()=>true}),{code:'BANK_PAGE_CLOSED'});
});

test('saved-session navigation strips sensitive query/hash and refuses foreign origins',async()=>{
  const f=sessionFixture({saved:'https://login.bankhapoalim.co.il/dashboard?token=secret#fragment'}),page=browserPage();let navigated='';page.goto=async url=>{navigated=url};
  assert.equal((await f.api.reuse(page)).ready,true);assert.equal(navigated,'https://login.bankhapoalim.co.il/dashboard');
  const foreign=sessionFixture({saved:'https://foreign.example/dashboard'});assert.equal(await foreign.api.reuse({goto:async()=>{throw new Error('must not navigate')}}),null);
  assert.equal(f.api.safeUrl('/relative'), '');
});

test('malformed accounts JSON or missing app context cannot become authenticated session evidence',async()=>{
  for(const page of [browserPage({text:'{}'}),browserPage({restContext:''}),browserPage({status:403,text:'fixture'})]){
    const f=sessionFixture();await assert.rejects(f.api.ready(page,{timeoutMs:1000,pollMs:350,stableMs:0}),error=>error.code==='BANK_SESSION_NOT_READY'&&error.detail.ready===false);
  }
});
