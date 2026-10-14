import {createFinanceBrowserEffects} from '../shared/finance-browser-effects.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createKupaBankControllerFixture as createDomainsBankController} from './kupa_bank_controller_fixture.mjs';
import {createCloudTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createBankChequeImageStorage} from '../shared/bank-cheque-images.js';
import {createFinanceOperationScope} from '../shared/finance-fence.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const changed=()=>Object.assign(new Error('fixture bank ownership changed'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});
const stamp='2026-10-08T10:00:00.000Z';
const transaction=id=>({id,date:stamp,processedDate:stamp,amount:12,currency:'ILS',status:'completed',description:id});
test('Kupa Bank waits for an accepted lease renewal before release and controller completion',async t=>{
  const f=fixture(t,{hold:'provider'}),renewal=deferred();let tick,claims=0;
  t.mock.method(globalThis,'setTimeout',(fn,ms)=>{if(ms===400000)tick=fn;return 1});
  f.ports.claimFinanceSyncLease=async(leaseName,leaseToken)=>{if(++claims===2)await renewal.promise;return {acquired:true,leaseName,leaseToken,fenceEpoch:1}};
  const api=f.create(),pending=api.refreshBankBalance();await f.entered.promise;
  const accepted=tick();f.release.resolve();
  try{await new Promise(resolve=>setImmediate(resolve));assert.equal(f.counts.release||0,0,'Bank released before renewal settled')}
  finally{renewal.resolve();await accepted;await pending;api.runtime.dispose()}
  assert.equal(f.counts.release,1);assert.equal(claims,2);
});
function fixture(t,{hold=null,home=false}={}){
  t.mock.method(globalThis,'setTimeout',()=>1);t.mock.method(globalThis,'clearTimeout',()=>{});t.mock.method(console,'error',()=>{});
  let owner='A',epoch=1,primary=true,financeReads=0,checks=0;const counts={},entered=deferred(),release=deferred();
  const model={state:{bank:{source:'hapoalim',currentBalance:100,bankSyncAt:stamp,archiveInitialized:true,archiveVersion:2,adjustments:[],feed:{accountNumber:'same-account',balance:100,syncedAt:stamp,transactions:[]}},checks:[]}},before=structuredClone(model.state);
  const capture=()=>{const observed={owner,epoch};return ()=>{if(!owner||observed.owner!==owner||observed.epoch!==epoch||!primary)throw changed()}};
  const captureRead=()=>{const observed={owner,epoch};return ()=>{if(!owner||observed.owner!==owner||observed.epoch!==epoch)throw changed()}};
  const phase=async(name,value)=>{counts[name]=(counts[name]||0)+1;if(name===hold){entered.resolve();await release.promise}return value};
  const ports={model,session:{connectionMode:'supabase',backendReady:true},checksSession:{},autoScope:()=>owner,operationScope:{capture,captureRead},toast:()=>{},render:()=>{},
    sharedChecksHaveLocalWork:()=>false,saveSharedChecksToCloud:async()=>true,syncSharedChecksFromCloud:()=>phase('checks-'+(++checks),true),sharedChecksObservedSequence:()=>7,
    saveState:()=>phase('local',true),bridge:{getBridgeToken:()=> 'fixture',autoEnabled:()=>true,autoAttemptDelayMs:()=>0,markAutoAttempt:()=>{},
      fetchBalance:()=>phase('provider',{fetchedAt:stamp,accounts:{business:{balance:500,accountId:'same-account',transactions:[]},...(home?{home:{balance:250,accountId:'home-account',transactions:[]}}:{})}})},
    refreshFinanceCloudSnapshot:()=>phase('finance-'+(++financeReads),{verified:true,state:model.state}),
    claimFinanceSyncLease:async(leaseName,leaseToken)=>({acquired:true,leaseName,leaseToken,fenceEpoch:1}),releaseFinanceSyncLease:(_kind,_token,options)=>{options?.assertCurrent?.();return phase('release',true)},
    saveFinancePatch:()=>phase('patch',{saved:true}),saveBankSyncSnapshot:()=>phase('atomic',{finance_revision:2,kupa_revision:2}),
    syncBankTransactionsSnapshot:(_key,role)=>phase('archive-'+role,{sourcePayload:[],result:{total_count:0}}),syncBankChequeImages:()=>phase('images',{warnings:[]}),
    readBankTransactions:(_key,role)=>phase('read-'+role,[]),readBankTransactionSnapshot:()=>phase('read-snapshot',null),touchBankDataRevision:()=>{},touchBankDisplayRevision:()=>{},
  };
  return {ports,model,before,counts,entered,release,create:()=>createDomainsBankController({...ports,effects:createFinanceBrowserEffects()}),handoff:()=>{owner='B';epoch++},logout:()=>{owner=null;epoch++},relogin:()=>{epoch++},secondary:()=>{primary=false}};
}

test('Kupa cloud Bank construction cannot enable a two-write fallback without the atomic writer',t=>{
  const f=fixture(t);f.ports.saveBankSyncSnapshot=undefined;
  assert.throws(f.create,/bank.*snapshot.*required/);
  assert.equal(f.counts.provider||0,0);assert.equal(f.counts.local||0,0);assert.equal(f.counts.patch||0,0);
});

test('Kupa Bank construction cannot manufacture a lease when the real claim port is absent',t=>{
  const f=fixture(t);f.ports.claimFinanceSyncLease=undefined;
  assert.throws(f.create,/bank.*lease.*required/);
  assert.equal(f.counts.provider||0,0);
});

test('Kupa file Bank snapshots do not invoke an authenticated Finance writer',async t=>{
  const f=fixture(t);f.ports.session.connectionMode='file';
  f.ports.saveFinancePatch=()=>{f.counts.patch=(f.counts.patch||0)+1;throw Error('local mode attempted authenticated Finance write')};
  const api=f.create();t.after(()=>api.runtime.dispose());
  assert.equal(await api.refreshBankBalance(),true,'file snapshot must use local durability without a cloud write');
  assert.equal(f.counts.patch||0,0);assert.equal(f.counts.local,1);assert.equal(f.counts.atomic||0,0);
  assert.equal(f.model.state.bank.currentBalance,500);
});

test('Kupa archive hydration retains its accepted snapshot sibling after rows fail',async t=>{
  const f=fixture(t),held=deferred();f.ports.readBankTransactions=async()=>{throw Error('rows failed')};f.ports.readBankTransactionSnapshot=()=>held.promise;
  const api=f.create(),pending=api.ensureBankDisplayArchive();let settled=false;void pending.then(()=>{settled=true});
  try{await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,'accepted snapshot must settle before hydration')}
  finally{held.resolve(null);await pending;api.runtime.dispose();await api.runtime.drain()}
});

test('Kupa archive rejection after handoff suppresses former-account error details',async t=>{
  const f=fixture(t),held=deferred(),entered=deferred(),reports=[];t.mock.method(console,'error',(...args)=>reports.push(args.map(String).join(' ')));
  f.ports.readBankTransactions=()=>{entered.resolve();return held.promise};const api=f.create();
  const pending=api.ensureBankDisplayArchive().catch(error=>{assert.equal(error.code,'FINANCE_OPERATION_SCOPE_CHANGED');return false});
  await entered.promise;f.handoff();held.resolve(Promise.reject(Error('private former archive failure')));
  await pending;assert.deepEqual(reports,[]);api.runtime.dispose();
});

test('Kupa Bank verification retains accepted reads and its lease through drain',async t=>{
  const f=fixture(t),held=deferred(),entered=deferred();f.ports.readBankTransactions=async()=>{throw Error('verification failed')};f.ports.readBankTransactionSnapshot=()=>{entered.resolve();return held.promise};
  const api=f.create(),pending=api.refreshBankBalance();await entered.promise;
  let drained=false;const drain=api.runtime.drain().then(()=>{drained=true});
  try{await new Promise(resolve=>setImmediate(resolve));assert.equal(f.counts.release||0,0,'lease cannot release before accepted snapshot');assert.equal(drained,false,'drain cannot abandon accepted snapshot')}
  finally{held.resolve(null);await pending;await drain;api.runtime.dispose()}
  assert.equal(f.counts.release,1);
});

test('Kupa Bank refresh invalidates earlier hydration before an uncommitted archive is displayed',async t=>{
  const f=fixture(t,{hold:'provider'}),held=deferred(),entered=deferred();let reads=0;
  f.ports.readBankTransactions=()=>{if(++reads===1){entered.resolve();return held.promise}return Promise.resolve([])};
  f.ports.saveBankSyncSnapshot=async()=>{throw Error('Bank snapshot failed')};
  const api=f.create(),hydrating=api.ensureBankDisplayArchive();await entered.promise;
  const refreshing=api.refreshBankBalance();await f.entered.promise;
  try{held.resolve([transaction('uncommitted')]);await hydrating;assert.deepEqual(api.bankBridgeUiState().feed.transactions,[],'background read cannot expose uncommitted archive')}
  finally{f.release.resolve();await refreshing;api.runtime.dispose();await api.runtime.drain()}
});

for(const [name,change] of [['account handoff',f=>f.handoff()],['logout',f=>f.logout()],['same-account relogin',f=>f.relogin()],['leadership loss',f=>f.secondary()]]){
  for(const auto of [false,true])test(`bank ${name} after ${auto?'automatic':'manual'} provider entry prevents publication`,async t=>{
    const f=fixture(t,{hold:'provider'}),api=f.create(),pending=api.refreshBankBalance({auto});await f.entered.promise;change(f);f.release.resolve();
    assert.equal(await pending,false);assert.deepEqual(f.model.state,f.before);assert.equal(f.counts['archive-business']||0,0);assert.equal(f.counts.atomic||0,0);assert.equal(f.counts.release||0,0);api.stopAutoSync();
  });
}
for(const phase of ['archive-business','images','read-business','checks-2','atomic'])test(`bank ownership loss during ${phase} cannot publish a former-owner snapshot`,async t=>{
  const f=fixture(t,{hold:phase}),api=f.create(),pending=api.refreshBankBalance();await f.entered.promise;f.handoff();f.model.state=structuredClone(f.before);f.model.state.bank.currentBalance=999;const next=structuredClone(f.model.state);f.release.resolve();
  assert.equal(await pending,false);assert.deepEqual(f.model.state,next);assert.equal(f.counts.local||0,0);assert.equal(f.counts.release||0,0);if(phase==='archive-business')assert.equal(f.counts.images||0,0);api.stopAutoSync();
});
test('bank stopping automatic scheduling drains a received result under valid ownership',async t=>{
  const f=fixture(t,{hold:'provider'}),api=f.create(),pending=api.refreshBankBalance({auto:true});await f.entered.promise;api.stopAutoSync();f.release.resolve();
  assert.equal(await pending,true);assert.equal(f.model.state.bank.currentBalance,500);assert.equal(f.counts.atomic,1);assert.equal(f.counts.release,1);
});
test('bank failed atomic publication cannot replace the displayed archive cache',async t=>{
  const f=fixture(t);f.ports.readBankTransactions=async()=>[transaction('new-uncommitted')];f.ports.saveBankSyncSnapshot=async()=>{throw Error('fixture atomic failure')};const api=f.create();
  assert.equal(await api.refreshBankBalance(),false);assert.deepEqual(f.model.state,f.before);assert.deepEqual(api.bankBridgeUiState().feed.transactions,[]);api.stopAutoSync();
});
test('bank committed snapshot with unverified refresh retains its operator warning',async t=>{
  const f=fixture(t);let reads=0;f.ports.refreshFinanceCloudSnapshot=async()=>++reads===1?{verified:true,state:f.model.state}:{verified:false,state:null};const api=f.create();
  assert.equal(await api.refreshBankBalance(),true);assert.equal(f.model.state.bank.currentBalance,500);assert.match(api.bankBridgeUiState().lastWarning,/לא אומת/);
  await api.refreshBankBridgeStatus();assert.match(api.bankBridgeUiState().lastWarning,/לא אומת/,'passive device availability cannot erase an unverified financial readout');
  await api.configureBankBridge({userCode:'',password:''});assert.match(api.bankBridgeUiState().lastWarning,/לא אומת/,'rejected local input cannot retire financial feedback');api.stopAutoSync();
});
test('manual bank balance cannot cross ownership while Shared checks are being verified',async t=>{
  const f=fixture(t,{hold:'checks-1'}),api=f.create(),pending=api.commitBankSnapshot(1234);await f.entered.promise;f.handoff();f.release.resolve();
  await assert.rejects(pending,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.deepEqual(f.model.state,f.before);assert.equal(f.counts.local||0,0);api.stopAutoSync();
});
test('bank archive cache cannot be reused by another account with identical feed keys',async t=>{
  const f=fixture(t);let reads=0;f.ports.readBankTransactions=async()=>[transaction(++reads===1?'private-A':'private-B')];const api=f.create();
  await api.ensureBankDisplayArchive();assert.equal(api.bankBridgeUiState().feed.transactions[0].id,'private-A');f.handoff();
  await api.ensureBankDisplayArchive();assert.equal(reads,2);assert.equal(api.bankBridgeUiState().feed.transactions[0].id,'private-B');api.stopAutoSync();
});
test('bank late archive response cannot join or overwrite a new login read',async t=>{
  const f=fixture(t),first=deferred(),started=deferred();let reads=0;f.ports.readBankTransactions=async()=>{if(++reads===1){started.resolve();return first.promise}return [transaction('private-B')]};const api=f.create(),old=api.ensureBankDisplayArchive();await started.promise;f.handoff();
  const current=api.ensureBankDisplayArchive();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(reads,2);await current;first.resolve([transaction('private-A')]);await old;
  assert.equal(api.bankBridgeUiState().feed.transactions[0].id,'private-B');api.stopAutoSync();
});
test('bank secondary tab can read an authorized archive but cannot change its balance',async t=>{
  const f=fixture(t);f.secondary();f.ports.readBankTransactions=async()=>[transaction('readonly')];const api=f.create();
  assert.equal(await api.ensureBankDisplayArchive(),true);assert.equal(api.bankBridgeUiState().feed.transactions[0].id,'readonly');await assert.rejects(api.commitBankSnapshot(999),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});api.stopAutoSync();
});
test('bank transaction pagination observes the same operation after each response body',async()=>{
  let valid=true,requests=0;const assertCurrent=()=>{if(!valid)throw changed()};const api=createCloudTransport({supaRest:async(_path,options)=>{options.assertRequestScope?.();requests++;return {ok:true,json:async()=>{valid=false;return Array.from({length:1000},()=>({merge_key:'row'}))}}}});
  await assert.rejects(api.readBankTransactions('key','business',{assertCurrent}),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(requests,1);
});
test('cheque upload cannot continue after ownership changes during local image retrieval',async()=>{
  const image=deferred(),entered=deferred(),requests=[];let valid=true;const assertCurrent=()=>{if(!valid)throw changed()};
  const api=createBankChequeImageStorage({ensureSession:async()=>({user:{id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'}}),now:()=>Date.parse(stamp),fetchBridgeImage:()=>{entered.resolve();return image.promise},
    supaFetch:async(path,options)=>{options.assertRequestScope?.();requests.push({path,options});return new Response(path.includes('/list/')?'[]':'{}')}});
  const pending=api.sync([{date:stamp,checkDetails:{checkItems:[{imageFrontKey:'a'.repeat(64)}]}}],{assertCurrent});await entered.promise;valid=false;image.resolve(new Blob(['image'],{type:'image/png'}));
  await assert.rejects(pending,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(requests.length,1);
});

test('an older display query cannot replace a confirmed bank snapshot with matching feed keys',async t=>{
  const f=fixture(t),gate=deferred(),entered=deferred();let reads=0;
  f.ports.readBankTransactions=async()=>{if(++reads===1){entered.resolve();return gate.promise}return [transaction('confirmed')]};
  const api=f.create(),old=api.ensureBankDisplayArchive();await entered.promise;
  assert.equal(await api.refreshBankBalance(),true);gate.resolve([transaction('stale-before-commit')]);await old;
  assert.equal(api.bankBridgeUiState().feed.transactions[0].id,'confirmed');api.stopAutoSync();
});

test('read scope remains usable by an authorized secondary tab and closes on recovery/auth changes',()=>{
  let access={account:{owner:'A',epoch:1},connectionMode:'supabase',storageOwner:'A',writable:false,readable:true};
  const scope=createFinanceOperationScope({readAccess:()=>access}),read=scope.captureRead();read();
  assert.throws(()=>scope.capture(),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});
  for(const value of [{...access,readable:false},{...access,account:{owner:'A',epoch:2}},{...access,storageOwner:'B'},{...access,account:null}]){
    const before=access;access=value;assert.throws(read,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});access=before;
  }
});

for(const committed of [false,true])test(`bank retry after ${committed?'lost atomic response':'offline atomic failure'} retains transaction identity`,async t=>{
  const f=fixture(t),rows=[transaction('provider-transaction')];let fail=true,remote=f.model.state.bank;
  f.ports.readBankTransactions=async()=>rows;
  f.ports.saveBankSyncSnapshot=async bank=>{if(!fail||committed)remote=structuredClone(bank);if(fail)throw Error('fixture missing response');return {finance_revision:2,kupa_revision:2}};
  const api=f.create();assert.equal(await api.refreshBankBalance(),false);assert.deepEqual(f.model.state,f.before);
  fail=false;assert.equal(await api.refreshBankBalance(),true);
  assert.equal(f.model.state.bank.feed.transactions.length,1);assert.equal(f.model.state.bank.feed.transactions[0].id,'provider-transaction');assert.deepEqual(f.model.state.bank.feed,remote.feed);api.stopAutoSync();
});

for(const phase of ['list-body','upload-response','retention-response','download-body'])test(`cheque image ${phase} does not publish after authorization changes`,async()=>{
  let valid=true,requests=0;const assertCurrent=()=>{if(!valid)throw changed()};const key='a'.repeat(64),userId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const api=createBankChequeImageStorage({ensureSession:async()=>({user:{id:userId}}),now:()=>Date.parse(stamp),fetchBridgeImage:async()=>new Blob(['image'],{type:'image/png'}),
    supaFetch:async(path,options)=>{
      options.assertRequestScope();requests++;
      if(path.includes('/list/'))return {ok:true,json:async()=>{if(phase==='list-body')valid=false;return phase==='retention-response'?[{name:`20200101_${key}.img`}]:[]}};
      if(phase==='upload-response'||phase==='retention-response')valid=false;
      return {ok:true,blob:async()=>{valid=false;return new Blob(['image'],{type:'image/png'})}};
    }});
  const pending=phase==='download-body'?api.download(stamp,key,{assertCurrent}):api.sync(phase==='upload-response'?[{date:stamp,checkDetails:{checkItems:[{imageFrontKey:key}]}}]:[],{assertCurrent});
  await assert.rejects(pending,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(requests,phase==='list-body'||phase==='download-body'?1:2);
});

test('bank construction requires both explicit operation access ports',()=>{
  assert.throws(()=>createDomainsBankController({autoScope:()=> 'test'}),/bank_operation_scope_required/);
});

test('local bank refresh cannot report success when persistence explicitly declines confirmation',async t=>{
  const f=fixture(t);f.ports.session.connectionMode='local';f.ports.saveState=async()=>false;const api=f.create();
  assert.equal(await api.refreshBankBalance(),false);assert.match(api.bankBridgeUiState().lastError,/שמירה/);
  assert.equal(api.bankBridgeUiState().lastScrapeAt,null);assert.equal(f.model.state.bank.currentBalance,500,'retain the staged edit for the persistence recovery path');api.stopAutoSync();
});

test('a healthy Bridge status cannot erase an unconfirmed local bank write',async t=>{
  const f=fixture(t);f.ports.session.connectionMode='local';f.ports.saveState=async()=>false;
  f.ports.bridge.status=async()=>({bridgeVersion:74,configured:true,lastScrapeAt:stamp});
  const api=f.create();assert.equal(await api.refreshBankBalance(),false);
  const failure=api.bankBridgeUiState().lastError;assert.match(failure,/שמירה/);
  await api.refreshBankBridgeStatus();
  assert.equal(api.bankBridgeUiState().lastError,failure,'Bridge availability is not a local save receipt');
  api.stopAutoSync();
});

test('a manual bank write failure is exposed independently of Bridge availability',async t=>{
  const f=fixture(t);f.ports.session.connectionMode='local';f.ports.saveState=async()=>false;
  f.ports.bridge.status=async()=>({bridgeVersion:74,configured:true,lastScrapeAt:stamp});
  const api=f.create();assert.equal(await api.commitBankSnapshot(1234),false);
  await api.refreshBankBridgeStatus();assert.match(api.bankBridgeUiState().lastError,/שמירה/);
  assert.equal(f.model.state.bank.currentBalance,1234);api.stopAutoSync();
});

for(const name of ['saveBankSyncSnapshot','syncBankTransactionsSnapshot','readBankTransactionSnapshot','acknowledgeBankTransactionMissing','acknowledgeBankTransactionAlert'])test(`bank ${name} fences its authenticated request and response body`,async()=>{
  let valid=true,requests=0;const assertCurrent=()=>{if(!valid)throw changed()},lease={assertCurrent};
  const api=createCloudTransport({supaRest:async(_path,options)=>{options.assertRequestScope();requests++;return {ok:true,text:async()=>{valid=false;return '{}'},json:async()=>{valid=false;return []}}}});
  const args={saveBankSyncSnapshot:[{},'token',7,lease],syncBankTransactionsSnapshot:['key','business',[],{lease,snapshotAt:stamp}],readBankTransactionSnapshot:['key','business',{assertCurrent}],acknowledgeBankTransactionMissing:[1,{assertCurrent}],acknowledgeBankTransactionAlert:[1,'returned_cheque',{assertCurrent}]};
  await assert.rejects(api[name](...args[name]),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(requests,1);
});


for(const balance of [null,'',false,[]])test('Kupa missing/coercible Bank balance cannot authorize archive or snapshot publication: '+JSON.stringify(balance),async t=>{
 const f=fixture(t);f.ports.bridge.fetchBalance=async()=>({fetchedAt:stamp,accounts:{business:{balance,accountId:'same-account',transactions:[]}}});
 const api=f.create(),before=structuredClone(f.model.state);
 try{assert.equal(await api.refreshBankBalance(),false,'missing balance was published as zero');
 assert.equal(f.counts.atomic||0,0);assert.equal(f.counts['archive-business']||0,0);assert.deepEqual(f.model.state,before)}finally{api.runtime.dispose()}
});
test('Kupa unavailable optional Bank money stays unknown instead of becoming zero',async t=>{
 const f=fixture(t);f.ports.bridge.fetchBalance=async()=>({fetchedAt:stamp,accounts:{business:{balance:500,accountId:'same-account',transactions:[],availableBalance:null,creditLimit:null,creditLimitUsed:null,creditLimitUsedPercent:null}}});
 const api=f.create();try{assert.equal(await api.refreshBankBalance(),true);
 const bank=f.model.state.bank;
 for(const field of ['availableBalance','creditLimit','creditLimitUsed','creditLimitUsedPercent'])assert.equal(bank[field],null,field+' lost unknown evidence')
 }finally{api.runtime.dispose()}
});


for(const version of [72,73,74])test('Kupa Bank version gate blocks former money parsing before provider entry: '+version,async t=>{
 const f=fixture(t);let providers=0;f.ports.bridge.status=async()=>({bridgeVersion:version,configured:true});f.ports.bridge.fetchBalance=async()=>{providers++;return {balance:0,accounts:{business:{balance:0,accountId:'same-account',transactions:[]}}}};
 const api=f.create();try{assert.equal(await api.refreshBankBalance(),version>=74);assert.equal(providers,version>=74?1:0);if(version>=74)assert.equal(f.model.state.bank.currentBalance,0)}finally{api.runtime.dispose()}
});


test('Kupa Bank captured version cannot authorize a replacement device',async t=>{
 const f=fixture(t);let token='A',providers=0;f.ports.bridge.getBridgeToken=()=>token;
 f.ports.bridge.status=async()=>{token='B';return {bridgeVersion:74,configured:true}};
 f.ports.bridge.fetchBalance=async()=>{providers++;return {balance:0,accounts:{business:{balance:0,accountId:'same-account',transactions:[]}}}};
 const api=f.create();try{assert.equal(await api.refreshBankBalance(),false);assert.equal(providers,0);assert.equal(f.counts.atomic||0,0);assert.equal(f.counts.release,1);
 const readout=api.bankBridgeUiState();assert.equal(readout.lastErrorCode,'BRIDGE_PAIRING_SCOPE_CHANGED');assert.ok(readout.lastError.length>0,'a safely stopped financial operation needs an operator explanation');assert.equal(readout.accountNumber,'');
 }finally{api.runtime.dispose()}
});
test('Kupa financial pairing rejection explains the stop without exposing former-device errors',async t=>{
 const f=fixture(t);let token='A';f.ports.bridge.getBridgeToken=()=>token;
 f.ports.bridge.status=async()=>{token='B';throw Error('private former-device status failure')};
 const api=f.create();try{
 assert.equal(await api.refreshBankBalance(),false);const value=api.bankBridgeUiState();
 assert.equal(value.lastErrorCode,'BRIDGE_PAIRING_SCOPE_CHANGED');assert.ok(value.lastError.length>0);assert.ok(!value.lastError.includes('private former-device'));assert.equal(value.availabilityError,'');assert.equal(f.counts.release,1);assert.equal(f.counts.provider||0,0);assert.deepEqual(f.model.state,f.before);
 }finally{api.runtime.dispose()}
});
