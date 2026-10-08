import test from 'node:test';
import assert from 'node:assert/strict';
import {createBankBridgeIntegration} from '../netunim-kupa/site/assets/js/integrations/bank-bridge.js';
import {createFinanceBridgeIntegration} from '../netunim-orders/site/assets/js/integrations/bank-bridge.js';
import {createBankBridgeClient} from '../shared/bank-bridge-client.js';

const TOKEN_KEY='netunim_kupa_bank_bridge_token_v1';
test('constructing browser integrations does not read preferences or start a request',t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get:()=>assert.fail('storage read during construction')});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage});
  t.mock.method(globalThis,'fetch',()=>assert.fail('network request during construction'));
  assert.equal(typeof createBankBridgeIntegration().fetchBalance,'function');
  assert.equal(typeof createFinanceBridgeIntegration().syncCreditCards,'function');
});

test('canonical Bridge client rejects unbound I/O ports before any request',()=>{
  assert.throws(()=>createBankBridgeClient({tokenStore:{get:()=>'',set:()=>{}},fetchRequest:()=>assert.fail('network before validation'),timers:{setTimeout:()=>{}},createAbortController:()=>{}}),/bank_bridge_ports_required/);
});

function fixture(app,t){
  const values=new Map([[TOKEN_KEY,'paired-token']]),calls=[],timers=new Map(),cleared=[];
  const preferences={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  let reply=()=>new Response('{"ok":true}'),nextTimer=0,now=Date.parse('2026-10-08T10:00:00Z');
  const fetchRequest=async(url,options)=>{calls.push({url,options});return reply(url,options)};
  const setTimer=(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id};
  const clearTimer=id=>{timers.delete(id);cleared.push(id)};
  const platform={preferences,fetchRequest,timers:{setTimeout:setTimer,clearTimeout:clearTimer},clock:{now:()=>now},createAbortController:()=>new AbortController()};
  t.after(()=>assert.equal(timers.size,0,'all request deadlines are released'));
  const make=()=> (app==='kupa'?createBankBridgeIntegration:createFinanceBridgeIntegration)({platform});
  return {api:make(),make,preferences,values,calls,timers,cleared,reply:value=>{reply=value},advance:ms=>{now+=ms}};
}

for(const app of ['kupa','orders']){
  const routes=[
    ['status',[], '/status','GET',undefined,3500],
    ['importConnectionSettings',[{version:1}],'/settings/import','POST',{version:1},20000],
    ['selectAccount',[{role:'home',branchNumber:'1',accountNumber:'2'}],'/account-selection','POST',{role:'home',branchNumber:'1',accountNumber:'2'},10000],
    ['deleteCredentials',[],'/credentials','DELETE',undefined,10000],
    ['bankDiagnostics',[],'/bank/diagnostics','GET',undefined,10000],
    ['fetchBalance',[{historyDays:1}],'/balance','POST',{interactive:false,historyDays:30},240000],
    ['creditStatus',[],'/v2/credit/status','GET',undefined,5000],
    ['saveCreditProfile',[{profileId:'P'}],'/v2/credit/profiles','POST',{profileId:'P'},15000],
    ['deleteCreditProfile',['P'],'/v2/credit/profiles','DELETE',{profileId:'P'},15000],
    ['resetCreditProfiles',[],'/v2/credit/reset','POST',{},15000],
    ['creditDiagnostics',[],'/v2/credit/diagnostics','GET',undefined,5000],
    ['creditDataDiagnostics',[],'/v2/credit/data-diagnostics','GET',undefined,10000],
    ['syncCreditCards',[{syncMode:'full',selection:['P']}],'/v2/credit/sync','POST',{interactive:false,syncMode:'recovery',selection:['P']},900000],
  ];
  for(const [method,args,path,verb,body,timeout] of routes)test(`${app} ${method} preserves its local protocol`,async t=>{
    const f=fixture(app,t);f.reply((_url,options)=>{
      assert.equal([...f.timers.values()][0].delay,timeout);
      assert.deepEqual(options.body===undefined?undefined:JSON.parse(options.body),body);
      return new Response('{"ok":true}');
    });
    await f.api[method](...args);assert.equal(f.calls[0].url,'http://127.0.0.1:8765'+path);assert.equal(f.calls[0].options.method,verb);
    assert.equal(f.calls[0].options.headers.Authorization,'Bearer paired-token');
  });
  for(const body of ['', '<html>proxy error</html>', 'null', '[]', '"text"'])test(`${app} successful malformed Bridge response is rejected (${body||'empty'})`,async t=>{
    const f=fixture(app,t);f.reply(()=>new Response(body,{status:200}));
    await assert.rejects(f.api.status(),error=>error.code==='BRIDGE_RESPONSE_INVALID');
    assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
  });

  test(`${app} Bridge balance keeps local pairing, request shape and timeout cleanup`,async t=>{
    const f=fixture(app,t);f.reply((_url,options)=>{
      assert.equal([...f.timers.values()][0].delay,15*60*1000);
      assert.equal(options.signal.aborted,false);
      return new Response('{"ok":true,"balance":100}');
    });
    assert.equal((await f.api.fetchBalance({interactive:true,historyDays:1000})).balance,100);
    const {url,options}=f.calls[0];assert.equal(url,'http://127.0.0.1:8765/balance');
    assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer paired-token');
    assert.deepEqual(JSON.parse(options.body),{interactive:true,historyDays:365});
    assert.equal(f.timers.size,0);assert.equal(f.cleared.length,1);
  });

  test(`${app} missing local token makes no request or timer`,async t=>{
    const f=fixture(app,t);f.api.setBridgeToken('');
    await assert.rejects(f.api.status(),error=>error.code==='BRIDGE_NOT_PAIRED');
    assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);
  });

  for(const status of [401,403,500])test(`${app} HTTP ${status} never triggers credit legacy fallback`,async t=>{
    const f=fixture(app,t);f.reply(()=>new Response('{"message":"rejected","stage":"auth"}',{status}));
    await assert.rejects(f.api.creditStatus(),error=>error.code===`HTTP_${status}`&&error.stage==='auth');
    assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
  });

  test(`${app} credit legacy fallback remains restricted to a missing endpoint`,async t=>{
    const f=fixture(app,t);f.reply(url=>url.includes('/v2/')?new Response('missing',{status:404}):new Response('{"ok":true,"profiles":[]}'));
    assert.equal((await f.api.creditStatus()).rollbackMode,true);
    assert.deepEqual(f.calls.map(call=>call.url),['http://127.0.0.1:8765/v2/credit/status','http://127.0.0.1:8765/credit/status']);
    assert.equal(f.timers.size,0);assert.equal(f.cleared.length,2);
  });

  test(`${app} timeout aborts its own request and clears the owned timer`,async t=>{
    const f=fixture(app,t);f.reply((_url,options)=>new Promise((resolve,reject)=>{
      options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
      queueMicrotask(()=>[...f.timers.values()][0].callback());
    }));
    await assert.rejects(f.api.status(),error=>error.code==='BRIDGE_TIMEOUT');
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.timers.size,0);
  });

  test(`${app} response-body timeout remains owned after HTTP headers arrive`,async t=>{
    const f=fixture(app,t);f.reply((_url,options)=>({ok:true,status:200,text:()=>new Promise((resolve,reject)=>{
      options.signal.addEventListener('abort',()=>reject(new DOMException('body aborted','AbortError')),{once:true});
      queueMicrotask(()=>[...f.timers.values()][0].callback());
    })}));
    await assert.rejects(f.api.status(),error=>error.code==='BRIDGE_TIMEOUT');
    assert.equal(f.timers.size,0);assert.equal(f.cleared.length,1);
  });

  test(`${app} offline failure releases resources and a later request can recover`,async t=>{
    const f=fixture(app,t);f.reply(()=>{throw new TypeError('network offline')});
    await assert.rejects(f.api.status(),error=>error.code==='BRIDGE_UNAVAILABLE');
    assert.equal(f.timers.size,0);
    f.reply(()=>new Response('{"ok":true,"configured":true}'));
    assert.equal((await f.api.status()).configured,true);assert.equal(f.calls.length,2);assert.equal(f.timers.size,0);
  });

  test(`${app} concurrent requests have independent abort and timer ownership`,async t=>{
    const f=fixture(app,t),responses=[];
    f.reply((_url,options)=>new Promise((resolve,reject)=>{
      responses.push(resolve);options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
    }));
    const first=f.api.status(),second=f.api.creditStatus();assert.equal(f.timers.size,2);
    assert.notEqual(f.calls[0].options.signal,f.calls[1].options.signal);
    const failed=assert.rejects(first,error=>error.code==='BRIDGE_TIMEOUT');[...f.timers.values()][0].callback();
    assert.equal(f.calls[1].options.signal.aborted,false);responses[1](new Response('{"ok":true}'));
    await failed;assert.equal((await second).ok,true);
  });

  test(`${app} malformed credit success never triggers a legacy retry`,async t=>{
    const f=fixture(app,t);f.reply(()=>new Response('<html>wrong service</html>'));
    await assert.rejects(f.api.syncCreditCards(),error=>error.code==='BRIDGE_RESPONSE_INVALID');
    assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
  });

  test(`${app} provider errors retain safe diagnostic fields`,async t=>{
    const f=fixture(app,t),data={ok:false,code:'ACCOUNT_NOT_FOUND',stage:'account',message:'choose account',httpStatus:403,
      availableAccounts:[{accountNumber:'123'}],accountRole:'home',creditErrors:[{code:'AUTH_REQUIRED'}]};
    f.reply(()=>new Response(JSON.stringify(data),{status:400}));
    await assert.rejects(f.api.fetchBalance(),error=>{
      for(const key of ['code','stage','message','httpStatus','availableAccounts','accountRole','creditErrors'])assert.deepEqual(error[key],data[key]);
      return true;
    });assert.equal(f.timers.size,0);
  });

  test(`${app} credentials are sent only to the fixed local endpoint and never stored in preferences`,async t=>{
    const f=fixture(app,t);await f.api.configureCredentials({token:' new-token ',userCode:'sensitive-user',password:'sensitive-password',businessAccountNumber:'123'});
    const call=f.calls[0];assert.equal(call.url,'http://127.0.0.1:8765/credentials');assert.equal(call.options.redirect,'error');
    assert.equal(call.options.headers.Authorization,'Bearer new-token');assert.equal(JSON.parse(call.options.body).password,'sensitive-password');
    assert.deepEqual([...f.values.entries()],[[TOKEN_KEY,'new-token']]);
    assert.equal(JSON.stringify([...f.values]).includes('sensitive-'),false);
  });

  test(`${app} failed local token write cannot send credentials with an unverified token`,async t=>{
    const f=fixture(app,t),failure=new DOMException('quota','QuotaExceededError');
    f.preferences.setItem=()=>{throw failure};
    await assert.rejects(async()=>f.api.configureCredentials({token:'new-token',password:'secret'}),error=>error===failure);
    assert.equal(f.calls.length,0);assert.equal(f.values.get(TOKEN_KEY),'paired-token');
  });

  test(`${app} preferences retain historical keys and cooldowns across integration reconstruction`,t=>{
    const f=fixture(app,t),autoKey=`netunim_${app}_bank_auto_daily_v1`;
    const enabled=api=>app==='kupa'?api.autoEnabled():api.bankAutoEnabled();
    const setEnabled=api=>app==='kupa'?api.setAutoEnabled(false):api.setBankAutoEnabled(false);
    const delay=api=>app==='kupa'?api.autoAttemptDelayMs():api.bankAttemptDelayMs();
    assert.equal(enabled(f.api),true);setEnabled(f.api);assert.equal(f.values.get(autoKey),'0');assert.equal(enabled(f.make()),false);
    if(app==='kupa')f.api.markAutoAttempt();else f.api.markBankAttempt();
    assert.equal(delay(f.make()),60*60*1000);f.advance(60*60*1000);assert.equal(delay(f.make()),0);
    if(app==='orders'){
      assert.equal(f.api.creditAutoEnabled(),true);f.api.markCreditAttempt();assert.equal(f.make().creditAttemptDelayMs(),24*60*60*1000);
      f.api.setCreditAutoMode('full');assert.equal(f.make().creditAutoMode(),'recovery');
    }
    assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);
  });

  test(`${app} invalid image key and missing image never cause document-like writes`,async t=>{
    const f=fixture(app,t);assert.equal(await f.api.fetchChequeImage('bad-key'),null);assert.equal(f.calls.length,0);
    f.reply(()=>new Response('missing',{status:404}));assert.equal(await f.api.fetchChequeImage('a'.repeat(64)),null);
    assert.equal(f.calls[0].options.headers.Accept,'image/*');assert.equal(f.timers.size,0);
  });

  test(`${app} cheque image preserves bytes and rejects an unexpected content type`,async t=>{
    const f=fixture(app,t),bytes=new Uint8Array([1,2,3]);
    f.reply(()=>new Response(bytes,{headers:{'Content-Type':'image/png'}}));
    const blob=await f.api.fetchChequeImage('A'.repeat(64));assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes);
    assert.equal(f.calls[0].url,'http://127.0.0.1:8765/bank/cheque-image/'+ 'a'.repeat(64));
    f.reply(()=>new Response('<html>error</html>',{headers:{'Content-Type':'text/html'}}));
    await assert.rejects(f.api.fetchChequeImage('a'.repeat(64)),error=>error.code==='CHEQUE_IMAGE_INVALID');assert.equal(f.timers.size,0);
  });
}
