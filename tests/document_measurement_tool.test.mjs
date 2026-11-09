import test from 'node:test';
import assert from 'node:assert/strict';
import {measurePlan,compareReports,percentile} from '../tools/measure-document-bridge.mjs';

test('measurement report retains numeric wall/phase samples without sensitive inputs or preview bytes',async()=>{
  const secret='PRIVATE-client-account-query-token-path',calls=[];
  const plan={machine:'computer-1',origin:'https://orders.bargig-furniture.com',warmups:1,repetitions:20,
    scenarios:[{id:'case-01',operation:'search',search:{query:secret}},{id:'case-02',operation:'binary',search:{query:secret}}]};
  const report=await measurePlan(plan,{token:secret,fetchRequest:async(url,options)=>{
    calls.push([url,JSON.parse(options.body)]);
    assert.ok(url.startsWith('http://127.0.0.1:8766/documents/'));
    assert.equal(options.headers.Authorization,`Bearer ${secret}`);
    return url.endsWith('preview-file')?new Response(secret):new Response(JSON.stringify({query:secret,results:[{id:secret,path:secret}],timings:{everythingMs:2,path:secret},partial:false}));
  }});
  assert.equal(report.scenarios.length,2);assert.equal(calls.length,45);
  assert.equal(report.scenarios[0].phases.everythingMs.p95Ms,2);
  assert.doesNotMatch(JSON.stringify(report),new RegExp(secret));
  assert.equal(report.scenarios[1].failures,0);
  assert.equal(percentile([4,1,3,2],.5),2);
});

test('baseline comparison is machine-bound and identifies greater than 20 percent P95 deterioration',()=>{
  const baseline={machine:'computer-1',scenarios:[{id:'case-01',operation:'search',p95Ms:100}]};
  const current={machine:'computer-1',scenarios:[{id:'case-01',operation:'search',p95Ms:121}]};
  assert.equal(compareReports(current,baseline)[0].reviewRequired,true);
  assert.throws(()=>compareReports({...current,machine:'computer-2'},baseline),/machine_mismatch/);
});

test('measurement refuses mutations and insufficient samples before sending a request',async()=>{
  let calls=0;
  const options={token:'synthetic',fetchRequest:async()=>{calls++;throw Error('unexpected')}};
  const plan={machine:'computer-1',origin:'https://orders.bargig-furniture.com',scenarios:[{id:'case-01',operation:'delete'}]};
  await assert.rejects(measurePlan(plan,options),/invalid_scenario/);
  await assert.rejects(measurePlan({...plan,repetitions:1},options),/invalid_repetitions/);
  assert.equal(calls,0);
});
