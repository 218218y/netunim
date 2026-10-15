import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport as kupa} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createCloudTransport as orders} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createFinanceManualQueue,readManualFinanceGrant} from '../shared/finance-fence.js';
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const grant={acquired:true,lease_token:'operation',fence_epoch:7,leased_until:'2030-01-01T00:00:00Z'};
const invalidRelease=error=>error.code==='FINANCE_LEASE_RELEASE_INVALID'&&error.kind==='confirmation_unknown'&&error.retryable===false;
for(const [app,create] of [['kupa',kupa],['orders',orders]]){
 function api(send){return create({supaFetch:send,supaRest:send})}
 for(const response of [true,false,{released:true},{released:false},[true],[false]])test(app+' release decodes '+JSON.stringify(response),async()=>{
  const calls=[],transport=api(async(path,options)=>{calls.push({path,options});return new Response(JSON.stringify(response))});
  const value=await transport.releaseFinanceSyncLease('credit','operation');assert.equal(value,Array.isArray(response)?response[0]:typeof response==='object'?response.released:response);
  assert.equal(calls[0].path,'/rest/v1/rpc/release_finance_sync_lease');assert.deepEqual(JSON.parse(calls[0].options.body),{p_lease_name:'credit',p_lease_token:'operation'});
 });
 for(const response of [null,{},'true',{released:'true'},[],[true,false]])test(app+' release rejects ambiguous '+JSON.stringify(response),async()=>{
  await assert.rejects(api(async()=>new Response(JSON.stringify(response))).releaseFinanceSyncLease('bank','operation'),invalidRelease);
 });
 for(const method of ['claimFinanceSyncLease','releaseFinanceSyncLease'])for(const phase of ['request','request-rejection','body','body-rejection'])test(app+' '+method+' fences late '+phase,async()=>{
  const held=gate(),entered=gate();let current=true,bodyReads=0;
  const assertCurrent=()=>{if(!current)throw Object.assign(Error('account replaced'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
  const transport=api(async()=>{
   if(phase.startsWith('request')){entered.resolve();await held.promise}
   return {ok:true,text:async()=>{bodyReads++;if(phase.startsWith('body')){entered.resolve();await held.promise}return JSON.stringify(method==='claimFinanceSyncLease'?grant:true)}};
  });
  const work=transport[method]('credit','operation',{assertCurrent});await entered.promise;current=false;
  if(phase.endsWith('rejection'))held.reject(Object.assign(Error('private former account error'),{code:'SUPABASE_NETWORK_FAILED'}));else held.resolve();
  await assert.rejects(work,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});if(phase.startsWith('request'))assert.equal(bodyReads,0);
 });
 test(app+' claims preserve bounded TTL, scoped retries and exact requested identity',async()=>{
  const calls=[],assertCurrent=()=>{},transport=api(async(path,options)=>{calls.push({path,options});return new Response(JSON.stringify([grant]))});
  const lease=await transport.claimFinanceSyncLease('credit','operation',{ttlSeconds:99999,assertCurrent});assert.equal(lease.fenceEpoch,7);
  assert.deepEqual(JSON.parse(calls[0].options.body),{p_lease_name:'credit',p_lease_token:'operation',p_ttl_seconds:1800});assert.equal(calls[0].options.networkRetry,true);assert.equal(calls[0].options.assertRequestScope,assertCurrent);
 });
}
const valid={acquired:true,leaseName:'credit',leaseToken:'operation',fenceEpoch:7};
for(const [name,value] of [['missing',{}],['truthy',{...valid,acquired:'true'}],['wrong token',{...valid,leaseToken:'foreign'}],['wrong kind',{...valid,leaseName:'bank'}],['missing fence',{acquired:true}],['zero fence',{...valid,fenceEpoch:0}],['unsafe fence',{...valid,fenceEpoch:Number.MAX_SAFE_INTEGER+1}],['coerced fence',{...valid,fenceEpoch:'7'}],['ambiguous local',{...valid,localOnly:'true'}],['hybrid local',{...valid,localOnly:true}]])test('manual command rejects '+name+' without work, wait or cleanup',async()=>{
 let work=0,wait=0,release=0;const queue=createFinanceManualQueue({claim:async()=>value,release:async()=>release++,createToken:()=> 'operation',wait:async()=>wait++});
 await assert.rejects(queue(()=>work++),{code:'FINANCE_MANUAL_LEASE_INVALID'});assert.deepEqual({work,wait,release},{work:0,wait:0,release:0});
});
for(const value of [valid,{acquired:true,localOnly:true}])test('manual command receives immutable acquired evidence: '+JSON.stringify(value),async()=>{
 let releases=0;const queue=createFinanceManualQueue({claim:async()=>value,release:async()=>releases++,createToken:()=> 'operation'});
 assert.equal(await queue(lease=>{assert.equal(lease.acquired,true);return 42}),42);assert.equal(releases,1);assert.equal(Object.isFrozen(readManualFinanceGrant(value,'operation')),true);
});
test('a canceled acquisition cannot execute work or release using a replacement account',async()=>{
 const held=gate();let current=true,work=0,releases=0;
 const assertCurrent=()=>{if(!current)throw Object.assign(Error('replaced'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
 const queue=createFinanceManualQueue({claim:()=>held.promise,release:async()=>releases++,createToken:()=> 'operation'}),pending=queue(()=>work++,{assertCurrent});await Promise.resolve();current=false;held.resolve(valid);
 await assert.rejects(pending,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.deepEqual({work,releases},{work:0,releases:0});
 current=true;assert.equal(await queue(()=>true,{assertCurrent}),true);assert.equal(releases,1,'a rejected queue head cannot poison later valid commands');
});

test('negative implementation: skipping exact token comparison authorizes a foreign manual lease',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../shared/finance-fence.js',import.meta.url),'utf8');
 const changed=source.replace('leaseToken===token','true');assert.notEqual(changed,source);
 const {createFinanceManualQueue:mutated}=await import('data:text/javascript;base64,'+Buffer.from(changed).toString('base64'));
 let work=0;const queue=mutated({claim:async()=>({...valid,leaseToken:'foreign'}),release:async()=>true,createToken:()=> 'operation'});
 await queue(()=>work++);assert.equal(work,1,'the foreign-token scenario must detect removal of this implementation guard');
});
