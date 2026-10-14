import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrdersBankRefresh} from '../netunim-orders/site/assets/js/domains/finance/bank-refresh.js';
import {createFinanceLeaseOwner} from '../shared/finance-lease-owner.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const changed=code=>Object.assign(Error(code),{code});
function fixture({hold=null,acquired=true,fresh=true,due=true,archiveReady=true}={}){
  const entered=deferred(),release=deferred(),events=[],jobs=new Map();
  let account=true,pairing=true,nextTimer=0,renewals=0,readouts=0,cleanup=null;
  const accountError=changed('FINANCE_OPERATION_SCOPE_CHANGED'),pairingError=changed('BRIDGE_PAIRING_SCOPE_CHANGED');
  const assertAccount=()=>{if(!account)throw accountError},assertPairing=()=>{if(!pairing)throw pairingError};
  const candidate={provider:'held-response'},publication={published:true,homeFailed:false,scan:{lastScrapeAt:'2026-10-14',lastError:'',lastErrorAt:null,lastWarning:'',availableAccounts:[],accountRole:''}};
  const phase=async(name,result)=>{events.push(name);if(name===hold){entered.resolve();await release.promise}return result};
  const leases=createFinanceLeaseOwner({authority:{capture:()=>assertAccount},
    leases:{
      claim:async(leaseName,leaseToken)=>{renewals++;await phase(renewals===1?'claim':'renewal',null);return {acquired,leaseName,leaseToken,fenceEpoch:7,leasedUntil:'2030-01-01T00:00:00Z'}},
      release:async(_name,_token,options)=>{options.assertCurrent();events.push('release');if(cleanup)await cleanup.promise;return true},
    },timers:{setTimeout:(run,delay)=>{const id=nextTimer++;jobs.set(id,{run,delay});return id},clearTimeout:id=>jobs.delete(id)},
  });
  const ports={authority:{capture:()=>assertAccount},
    cloud:{refresh:options=>{options.assertCurrent();return phase('refresh-'+(++readouts),fresh)},lastSyncAt:()=> 'cloud-stamp',readFinance:()=>phase('finance',{state:{bank:{archiveInitialized:archiveReady,archiveVersion:archiveReady?2:0}}})},
    device:{capture:()=>assertPairing,readStatus:()=>phase('status',{configured:true,bridgeVersion:74}),supported:()=>true,fetchBalance:options=>{events.push(['scope',options]);return phase('provider',candidate)},recordScan:(scan,guard)=>{guard();assert.equal(scan,publication.scan);events.push('scan')}},
    leases:{...leases,createToken:()=> 'captured-token',reportFailure:error=>events.push(['release-error',error])},
    publication:{prepare:guard=>{guard();return phase('prepare',undefined)},publish:(result,options)=>{options.lease.assertCurrent();assert.equal(result,candidate);events.push(['publication-scope',options]);return phase('publish',publication)}},
    automation:{allowed:()=>true,currentEpoch:()=>3,due:()=>due},
  };
  const owner=createOrdersBankRefresh(ports),request={interactive:false,auto:false,isCurrent:()=>true,onStarted:()=>{events.push('started')},onDenied:()=>{events.push('denied')},onPublished:result=>{assert.equal(result,publication);events.push('published')},onFailed:(error,_guard,epoch)=>{assert.equal(epoch,3);events.push(['failure',error])}};
  return {owner,ports,request,events,jobs,entered,release,accountError,pairingError,cleanup:gate=>{cleanup=gate},changeAccount:()=>{account=false},changePairing:()=>{pairing=false},run:options=>owner.commands.refresh({...request,...options})};
}

for(const phase of ['refresh-1','claim','refresh-2','status','prepare','finance','provider','publish'])test(`Bank disposal joins accepted ${phase}, stops renewals and fences late completion`,async()=>{
  const f=fixture({hold:phase}),pending=f.run({auto:true});await f.entered.promise;
  let drained=false;const draining=f.owner.runtime.drain().then(()=>{drained=true});
  try{
    assert.equal(f.owner.runtime.dispose(),true);assert.equal(f.owner.runtime.dispose(),false);
    assert.equal(f.jobs.size,0);assert.equal(f.owner.runtime.isPending(),true);
    await Promise.resolve();assert.equal(drained,false);assert.ok(!f.events.includes('release'));
    assert.equal(await f.run(),false);
  }finally{f.release.resolve();assert.equal(await pending,false);await draining}
  assert.equal(f.owner.runtime.isPending(),false);assert.ok(!f.events.includes('published'));
  const error=f.events.find(item=>Array.isArray(item)&&item[0]==='failure')[1];assert.equal(error.code,'FINANCE_OPERATION_SCOPE_CHANGED');
  assert.equal(f.events.filter(item=>item==='release').length,phase==='refresh-1'?0:1);
});

for(const phase of ['claim','provider','publish'])for(const change of ['account','pairing'])test(`Bank ${change} replacement during ${phase} preserves cleanup authority and blocks former diagnostics`,async()=>{
  const f=fixture({hold:phase}),pending=f.run();await f.entered.promise;
  if(change==='account')f.changeAccount();else f.changePairing();
  f.release.resolve();assert.equal(await pending,false);await f.owner.runtime.drain();
  const error=f.events.find(item=>Array.isArray(item)&&item[0]==='failure')[1];assert.equal(error,change==='account'?f.accountError:f.pairingError);
  assert.ok(!f.events.includes('published'));assert.equal(f.events.filter(item=>item==='release').length,change==='account'?0:1);
});

test('Bank success observes publication before joined cleanup and remains pending until cleanup settles',async()=>{
  const f=fixture(),gate=deferred();f.cleanup(gate);
  const pending=f.run();while(!f.events.includes('release'))await Promise.resolve();
  assert.ok(f.events.indexOf('published')<f.events.indexOf('release'));assert.equal(f.owner.runtime.isPending(),true);
  let drained=false;const drain=f.owner.runtime.drain().then(()=>{drained=true});await Promise.resolve();assert.equal(drained,false);
  gate.resolve();assert.equal(await pending,true);await drain;assert.equal(f.owner.runtime.isPending(),false);assert.equal(f.jobs.size,0);
});
test('Bank accepted lease renewal completes before provider cleanup can release',async()=>{
  const f=fixture({hold:'provider'}),renewal=deferred();let claims=0;
  const original=f.ports.leases.commands.acquire;
  // Use the actual lease owner and hold its second HTTP request.
  const owner=createFinanceLeaseOwner({authority:f.ports.authority,leases:{
    claim:async(leaseName,leaseToken)=>{if(++claims===2)await renewal.promise;return {acquired:true,leaseName,leaseToken,fenceEpoch:7,leasedUntil:'2030-01-01T00:00:00Z'}},
    release:async()=>{f.events.push('release');return true},
  },timers:{setTimeout:run=>{f.jobs.set(1,{run});return 1},clearTimeout:id=>f.jobs.delete(id)}});
  f.ports.leases.commands.acquire=owner.commands.acquire;f.ports.leases.runtime=owner.runtime;
  assert.notEqual(original,owner.commands.acquire);
  const pending=f.run();await f.entered.promise;const accepted=f.jobs.get(1).run();f.release.resolve();
  await new Promise(resolve=>setImmediate(resolve));assert.ok(!f.events.includes('release'));
  renewal.resolve();await accepted;assert.equal(await pending,true);assert.equal(claims,2);assert.equal(f.events.filter(item=>item==='release').length,1);
});
test('Bank denied lease never enters the provider or snapshot path',async()=>{
  const f=fixture({acquired:false});assert.equal(await f.run(),false);
  assert.deepEqual(f.events,['started','refresh-1','claim','denied']);assert.equal(f.jobs.size,0);
});
test('automatic shared freshness skips a scan while still closing the acquired lease',async()=>{
  const f=fixture();let dueCalls=0;f.ports.automation.due=()=>++dueCalls===1;
  assert.equal(await f.run({auto:true}),true);assert.deepEqual(f.events,['started','refresh-1','claim','refresh-2','release']);
});
for(const [auto,ready,days] of [[false,false,365],[false,true,30],[true,false,30]])test(`Bank provider history remains ${days} days (auto=${auto}, archiveReady=${ready})`,async()=>{
  const f=fixture({archiveReady:ready});assert.equal(await f.run({auto,interactive:true}),true);
  assert.deepEqual(f.events.find(item=>Array.isArray(item)&&item[0]==='scope')[1],{interactive:true,historyDays:days});
  const options=f.events.find(item=>Array.isArray(item)&&item[0]==='publication-scope')[1];assert.equal(options.historyDays,days);assert.equal(options.archiveReady,ready);
});
test('a rejected old provider cannot reveal its error after owner disposal',async()=>{
  const f=fixture({hold:'provider'});f.ports.device.fetchBalance=async()=>{f.entered.resolve();await f.release.promise;throw Error('PRIVATE_OLD_PROVIDER')};
  const pending=f.run();await f.entered.promise;f.owner.runtime.dispose();f.release.resolve();assert.equal(await pending,false);
  assert.equal(f.events.find(item=>Array.isArray(item)&&item[0]==='failure')[1].code,'FINANCE_OPERATION_SCOPE_CHANGED');
  assert.ok(!JSON.stringify(f.events).includes('PRIVATE_OLD_PROVIDER'));assert.equal(f.events.filter(item=>item==='release').length,1);
});
