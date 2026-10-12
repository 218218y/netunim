import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {configurationHandler,profile} from './bank_configuration_fixture.mjs';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
async function fixture(t,ports){
  const api=configurationHandler(ports);
  const server=http.createServer((req,res)=>api.handler(req,res,'fixture-token').catch(error=>{res.writeHead(500);res.end(JSON.stringify({message:error.message}))}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
  const request=async(path,body={},method='POST')=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{Authorization:'Bearer fixture-token','Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
  return {api,request};
}
test('two accepted credit profile updates retain both connections',async t=>{
  let stored=[],reads=0;const entered=gate(),held=gate();
  const f=await fixture(t,{readProfiles:async()=>{const snapshot=structuredClone(stored);if(++reads===1){entered.resolve();await held.promise}return snapshot},writeProfiles:async value=>{stored=structuredClone(value)},resetProfiles:async()=>{stored=[]}});
  const first=f.request('/credit/profiles',profile('first'));await entered.promise;
  const second=f.request('/credit/profiles',profile('second'));
  // Allow the second native HTTP request to enter, without requiring it to read
  // before the first releases (the correct owner will deliberately serialize).
  await new Promise(resolve=>setTimeout(resolve,30));held.resolve();
  assert.deepEqual((await Promise.all([first,second])).map(row=>row.status),[200,200]);
  assert.deepEqual(stored.map(row=>row.profileId).sort(),['first','second']);
});

test('queued configuration reserves ownership before any provider reads credentials',async t=>{
  const entered=gate(),held=gate();let providerReads=0,providerRuns=0;
  const f=await fixture(t,{readProfiles:async()=>{entered.resolve();await held.promise;return []},writeProfiles:async()=>{},resetProfiles:async()=>{},
    vault:{readCredentials:async()=>{providerReads++;return {userCode:'fixture'}}},
    providerPorts:{scrapeHapoalimSnapshot:async()=>{providerRuns++;return {accounts:{}}}}});
  const changing=f.request('/credit/profiles',profile('accepted'));await entered.promise;
  try{const response=await f.request('/balance');assert.equal(response.status,400);assert.equal(response.data.code,'SCRAPE_BUSY');assert.equal(providerReads,0);assert.equal(providerRuns,0)}
  finally{held.resolve();await changing}
});

for(const route of ['/balance','/v2/credit/sync']){
  test(`${route} retains ownership through status publication and releases after failure`,async t=>{
    const publishing=gate(),held=gate();let mutations=0,providers=0;
    const publish=async()=>{publishing.resolve();await held.promise;throw Object.assign(new Error('fixture publication failure'),{code:'FIXTURE_PUBLICATION'})};
    const f=await fixture(t,{readProfiles:async()=>[],writeProfiles:async()=>{mutations++},resetProfiles:async()=>{mutations++},
      providerPorts:{scrapeHapoalimSnapshot:async()=>{providers++;return {accounts:{}}},scrapeAllCreditProfiles:async()=>{providers++;return {profiles:[],errors:[],attemptedCount:0}},writeMeta:publish,writeCreditMeta:publish}});
    const syncing=f.request(route);await publishing.promise;
    try{
      for(const path of ['/credit/profiles','/credit/reset','/balance','/credit/sync']){
        const response=await f.request(path,profile('blocked'));
        assert.equal(response.status,400);assert.equal(response.data.code,'SCRAPE_BUSY');
      }
      assert.equal(mutations,0);assert.equal(providers,1);
    }finally{held.resolve();await syncing}
    assert.equal((await f.request('/credit/profiles',profile('after'))).status,200);assert.equal(mutations,1);
  });
}

test('a failed reset retains outstanding deletion before the next accepted save',async t=>{
  const deleting=gate(),held=gate();let stored=[profile('old')],writes=0;
  const f=await fixture(t,{readProfiles:async()=>stored,writeProfiles:async value=>{writes++;stored=value},
    resetProfiles:async()=>{deleting.resolve();await held.promise;stored=[]},
    artifacts:{resetCredit:async()=>{throw new Error('fixture metadata deletion failed')}}});
  const resetting=f.request('/credit/reset');await deleting.promise;
  const saving=f.request('/credit/profiles',profile('after-reset'));
  try{await new Promise(resolve=>setTimeout(resolve,30));assert.equal(writes,0)}finally{held.resolve()}
  assert.deepEqual((await Promise.all([resetting,saving])).map(row=>row.status),[400,200]);
  assert.deepEqual(stored.map(row=>row.profileId),['after-reset']);
});

test('concurrent duplicate login attempts validate the latest committed identity',async t=>{
  let stored=[];const f=await fixture(t,{readProfiles:async()=>structuredClone(stored),writeProfiles:async value=>{stored=structuredClone(value)},resetProfiles:async()=>{}});
  const results=await Promise.all([f.request('/credit/profiles',profile('first')),f.request('/credit/profiles',{...profile('second'),username:'first'})]);
  assert.deepEqual(results.map(row=>row.status).sort(),[200,400]);
  assert.equal(results.find(row=>row.status===400).data.code,'CREDIT_DUPLICATE_LOGIN');assert.equal(stored.length,1);
  assert.equal((await f.request('/credit/profiles',profile('third'))).status,200);
});

test('a provider failure does not write bank status over a rejected concurrent request',async t=>{
  const entered=gate(),held=gate();let writes=0;
  const f=await fixture(t,{readProfiles:async()=>[],writeProfiles:async()=>{},resetProfiles:async()=>{},
    providerPorts:{scrapeHapoalimSnapshot:async()=>{entered.resolve();await held.promise;throw Object.assign(new Error('fixture bank failure'),{code:'BANK_DATA_ERROR',stage:'data',accountRole:'home',httpStatus:503,availableAccounts:[{accountId:7}]})},writeMeta:async()=>{writes++}}});
  const syncing=f.request('/balance');await entered.promise;
  try{const busy=await f.request('/balance');assert.equal(busy.data.code,'SCRAPE_BUSY');assert.equal(writes,0)}finally{held.resolve()}
  const failed=await syncing;assert.equal(failed.data.code,'BANK_DATA_ERROR');assert.equal(failed.data.accountRole,'home');assert.equal(failed.data.httpStatus,503);assert.deepEqual(failed.data.availableAccounts,[{accountId:7}]);assert.equal(writes,1);
});

test('simultaneous business/home selections preserve both roles and secret bytes',async t=>{
  const entered=gate(),held=gate();let reads=0,stored={userCode:'0012',password:' padded secret ',businessBranchNumber:'',businessAccountNumber:'',homeBranchNumber:'',homeAccountNumber:''};
  const f=await fixture(t,{readProfiles:async()=>[],writeProfiles:async()=>{},resetProfiles:async()=>{},vault:{readCredentials:async()=>{const snapshot=structuredClone(stored);if(++reads===1){entered.resolve();await held.promise}return snapshot},writeCredentials:async value=>{stored=structuredClone(value)}}});
  const business=f.request('/account-selection',{role:'business',branchNumber:'001',accountNumber:'000123'});await entered.promise;
  const home=f.request('/account-selection',{role:'home',branchNumber:'002',accountNumber:'000456'});
  held.resolve();assert.deepEqual((await Promise.all([business,home])).map(row=>row.status),[200,200]);
  assert.equal(stored.businessAccountNumber,'000123');assert.equal(stored.homeAccountNumber,'000456');assert.equal(stored.password,' padded secret ');assert.equal(stored.userCode,'0012');
});
test('reset is ordered after an already accepted profile update and cannot be undone by it',async t=>{
  let stored=[profile('existing')],resetCalls=0;const entered=gate(),held=gate();
  const f=await fixture(t,{readProfiles:async()=>{const snapshot=structuredClone(stored);entered.resolve();await held.promise;return snapshot},writeProfiles:async value=>{stored=structuredClone(value)},resetProfiles:async()=>{resetCalls++;stored=[]}});
  const updating=f.request('/credit/profiles',profile('new'));await entered.promise;const resetting=f.request('/credit/reset');
  try{await new Promise(resolve=>setTimeout(resolve,30));assert.equal(resetCalls,0,'reset must wait for the accepted read/modify/write')}
  finally{held.resolve();await Promise.allSettled([updating,resetting])}
  assert.deepEqual(stored,[]);assert.equal(resetCalls,1);
});
test('an active provider session rejects configuration mutation before reading its vault',async t=>{
  const held=gate();let reads=0,writes=0;const f=await fixture(t,{readProfiles:async()=>{reads++;return []},writeProfiles:async()=>{writes++},resetProfiles:async()=>{}});
  const provider=f.api.operations.provider(()=>held.promise);
  try{
    const response=await f.request('/credit/profiles',profile('during-provider'));
    assert.equal(response.status,400);assert.equal(response.data.code,'SCRAPE_BUSY');assert.equal(reads,0);assert.equal(writes,0);
  }finally{held.resolve();await provider}
});

test('every configuration route rejects active provider ownership before validation or persistence',async t=>{
  let touched=0;const unexpected=async()=>{touched++;throw new Error('unexpected vault access')};
  const f=await fixture(t,{readProfiles:unexpected,writeProfiles:unexpected,resetProfiles:unexpected,
    vault:{writeCredentials:unexpected,deleteCredentials:unexpected,replaceConnections:unexpected}});
  const held=gate(),provider=f.api.operations.provider(()=>held.promise);
  try{
    for(const [method,path] of [['POST','/credentials'],['DELETE','/credentials'],['POST','/account-selection'],['POST','/credit/profiles'],['DELETE','/credit/profiles'],['POST','/credit/reset'],['POST','/settings/import']]){
      const response=await f.request(path,{},method);assert.equal(response.data.code,'SCRAPE_BUSY',path);assert.equal(response.status,400,path);
    }
    assert.equal(touched,0);
  }finally{held.resolve();await provider}
});

test('HTTP status waits for accepted configuration cleanup and exposes no credentials',async t=>{
  const entered=gate(),held=gate();let reads=0,stored=[];
  const f=await fixture(t,{readProfiles:async()=>{reads++;return stored},writeProfiles:async value=>{stored=value},resetProfiles:async()=>{},artifacts:{clearCreditData:async()=>{entered.resolve();await held.promise}}});
  const changing=f.request('/credit/profiles',profile('accepted'));await entered.promise;
  const query=f.request('/v2/credit/status',{},'GET');
  try{await new Promise(resolve=>setTimeout(resolve,30));assert.equal(reads,1,'status cannot read the vault while configuration still owns cleanup')}
  finally{held.resolve();await changing}
  const status=await query;assert.equal(status.status,200);assert.equal(status.data.profiles[0].profileId,'accepted');assert.ok(!JSON.stringify(status.data).includes('synthetic password'));assert.equal(reads,2);
});
