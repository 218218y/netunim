import test from 'node:test';
import assert from 'node:assert/strict';
import {maxResponseShape,maxResponseDecision,safeMaxResponseEvidence,optionalMaxMonthFailure} from '../netunim-kupa/bank-bridge/max-response-diagnostics.mjs';
import {maxGetJsonWithinPage} from '../netunim-kupa/bank-bridge/credit-http.mjs';
import {extractMaxTransactionCandidates} from '../netunim-kupa/bank-bridge/max-model.mjs';
import {bankBridgeCreditErrors} from '../netunim-kupa/bank-bridge/wire-errors.mjs';
test('MAX no-transaction envelopes require a numeric known code, null result and the exact reviewed fields',()=>{
 const empty={returnCode:10,rcDesc:null,result:null,correlationID:'synthetic'};
 assert.deepEqual(extractMaxTransactionCandidates(empty).transactions,[]);
 for(const data of [{result:null},{...empty,returnCode:0},{...empty,returnCode:'10'},{...empty,result:{transactions:[]}},
  {...empty,result:[]},{...empty,unexpectedRows:[{amount:1}]},{...empty,rcDesc:{}},{...empty,correlationID:{}},
  {returnCode:10,rcDesc:null,result:null}])assert.throws(()=>extractMaxTransactionCandidates(data));
});
test('MAX business codes and filter flags are bounded metadata while rcDesc values remain private',()=>{
 const shape=maxResponseShape({returnCode:10,rcDesc:'PRIVATE-DESCRIPTION',result:{isMyMAXCardsFiltered:true}});
 const safe=safeMaxResponseEvidence(shape);assert.equal(safe.returnCode,10);assert.equal(safe.descriptionType,'string');
 assert.ok(safe.flags.some(f=>f.path==='$.result.isMyMAXCardsFiltered'&&f.value));assert.doesNotMatch(JSON.stringify(safe),/PRIVATE-DESCRIPTION/);
 assert.equal(safeMaxResponseEvidence({...shape,returnCode:123456789}).returnCode,null);
});
test('MAX known unavailable and row-limit errors keep distinct safe messages on the public wire',()=>{
 const errors=bankBridgeCreditErrors([{code:'CREDIT_PROVIDER_PERIOD_UNAVAILABLE',message:'PRIVATE'}, {code:'CREDIT_PROVIDER_ROW_LIMIT_EXCEEDED',message:'PRIVATE'}]);
 assert.match(errors[0].message,/מאוחר יותר/);assert.match(errors[1].message,/יותר מדי תנועות/);assert.doesNotMatch(JSON.stringify(errors),/PRIVATE/);
});
test('MAX structural evidence keeps unknown array shape and count but no scalar response values',()=>{
 const shape=maxResponseShape({result:{newList:[{merchantName:'PRIVATE-MERCHANT',token:'PRIVATE-TOKEN',originalAmount:7123}]},owner:'PRIVATE-NAME'},{httpStatus:200,bodyType:'json'});
 const result=safeMaxResponseEvidence({...shape,outcome:'unrecognized_schema',reason:'schema_validation_failed',tier:'forecast'});
 assert.equal(result.arrays[0].path,'$.result.newList');assert.equal(result.arrays[0].count,1);
 assert.deepEqual(result.arrays[0].sampleKeys,['merchantName','originalAmount','token']);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE-|7123/);
});
test('MAX evidence is bounded, revalidates exported metadata and rejects dynamic key/path values',()=>{
 let deep={};for(let i=0;i<12;i++)deep={deep};
 const shape=maxResponseShape({result:{deep,rows:Array.from({length:200},()=>({amount:1}))}});
 assert.equal(shape.truncated,true);assert.ok(JSON.stringify(shape).length<5000);
 const safe=safeMaxResponseEvidence({...shape,bodyType:'PRIVATE',reason:'PRIVATE',arrays:[{path:'$.private@example.com',count:-3,sampleKeys:['bad@example.com','safeKey']}]});
 assert.equal(safe.arrays[0].path,'[redacted]');assert.deepEqual(safe.arrays[0].sampleKeys,['safeKey']);
 assert.doesNotMatch(JSON.stringify(safe),/PRIVATE|private@example/);
});
test('MAX empty body, null result and an explicit empty list remain different evidence',async()=>{
 for(const [body,status,reason,resultType,bodyType]of [['',204,'empty_body','missing','empty'],['{"result":null}',200,'result_null','null','json'],['{"result":{"transactions":[]}}',200,'verified','object','json']]){
  let metadata;const value=await maxGetJsonWithinPage({evaluate:async()=>({status,body,retryAfter:''})},'https://synthetic.invalid','MaxTransactions',0,reply=>{metadata=maxResponseShape(reply.data,reply)});
  const decision=maxResponseDecision(metadata,reason==='verified'?null:{code:'CREDIT_PROVIDER_SCHEMA_ERROR'},'parse');
  assert.equal(metadata.httpStatus,status);assert.equal(metadata.resultType,resultType);assert.equal(metadata.bodyType,bodyType);assert.equal(decision.reason,reason);
  if(reason==='verified')assert.deepEqual(value,{result:{transactions:[]}});
 }
});
test('MAX diagnostic observers cannot alter a successful or failed HTTP request',async()=>{
 const observer=()=>{throw Error('storage failure')};
 const page=status=>({evaluate:async()=>({status,body:'{"result":{"transactions":[]}}',retryAfter:''})});
 assert.deepEqual(await maxGetJsonWithinPage(page(200),'https://synthetic.invalid','Month',0,observer),{result:{transactions:[]}});
 await assert.rejects(maxGetJsonWithinPage(page(503),'https://synthetic.invalid','Month',0,observer),e=>e.httpStatus===503&&e.code==='CREDIT_PROVIDER_HTTP_ERROR');
});
test('MAX optional isolation excludes authentication, rate limits and unknown programming failures',()=>{
 for(const error of [new TypeError('bug'),{code:'CREDIT_AUTOMATION_BLOCKED'},{code:'CREDIT_PROVIDER_RATE_LIMITED'},
  {code:'CREDIT_PROVIDER_HTTP_ERROR',httpStatus:401},{code:'CREDIT_PROVIDER_HTTP_ERROR',httpStatus:400}])assert.equal(optionalMaxMonthFailure(error),false);
 assert.equal(optionalMaxMonthFailure({code:'CREDIT_PROVIDER_HTTP_ERROR',httpStatus:503}),true);
});
test('MAX the browser transport enforces its timeout without logging network exception values',async t=>{
 const delay=globalThis.setTimeout;
 t.mock.method(globalThis,'setTimeout',callback=>delay(callback,1));
 t.mock.method(globalThis,'fetch',async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('PRIVATE-NETWORK')),{once:true})));
 let metadata;
 await assert.rejects(maxGetJsonWithinPage({evaluate:(fn,url)=>fn(url)},'https://synthetic.invalid','Month',0,value=>{metadata=value}),
  e=>e.code==='CREDIT_PROVIDER_NETWORK_ERROR'&&!e.message.includes('PRIVATE-NETWORK'));
 assert.equal(metadata.bodyType,'transport_failure');assert.equal(metadata.httpStatus,0);
});
