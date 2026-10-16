import test from 'node:test';
import assert from 'node:assert/strict';
import {readCreditRefreshResult,readCreditStatusProfiles} from '../shared/credit-refresh-result.js';
import {normalizeCreditScrapeAccount} from '../netunim-kupa/bank-bridge/credit-transaction-model.mjs';
import {creditProfilePublic} from '../netunim-kupa/bank-bridge/credit-profile-model.mjs';
import {mergeCreditSyncResult as ordersMerge,normalizeCreditSync as ordersHistory} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {mergeCreditSyncResult as kupaMerge,normalizeCreditSync as kupaHistory} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';

const profile={profileId:'P',provider:'max',defaultAccount:'ביתי',accounts:[{accountNumber:'0012',balance:100}]};
const result=row=>({contractVersion:2,profiles:[row]});
const malformed=[null,true,false,123,{},[],['0012'],'',' ',' x','x ','a  b','x\nY','x\0Y','x'.repeat(81)];

for(const [name,merge] of [['Orders',ordersMerge],['Kupa',kupaMerge]]){
  test(name+' supported omitted issuer/routing metadata preserves known identity',()=>{
    const initial=merge({cardMappings:{'P:0012':{included:true}}},readCreditRefreshResult(result(profile)));
    const merged=merge(initial,readCreditRefreshResult({profiles:[{profileId:'P',accounts:[{accountNumber:'0012',balance:200}]}]}));
    assert.equal(merged.profiles[0].provider,'max');
    assert.equal(merged.profiles[0].defaultAccount,'ביתי');
    assert.equal(merged.profiles[0].accounts[0].balance,200);
  });
  test(name+' invalid identity cannot erase the provider, change routing or create a ghost account',()=>{
    const initial=merge({cardMappings:{'P:0012':{included:true,account:'ביתי'}}},readCreditRefreshResult(result(profile)));
    const before=JSON.stringify(initial),snapshot=structuredClone(initial);
    const badProfiles=[
      ...['garbage',null,123,{},['max']].map(provider=>({...profile,provider})),
      ...['garbage',null,123,{},['ביתי']].map(defaultAccount=>({...profile,defaultAccount})),
      ...malformed.map(profileId=>({...profile,profileId})),
      ...[...malformed,'P:C',undefined].map(accountNumber=>({...profile,accounts:[{accountNumber,balance:999}]})),
      {...profile,accounts:[{accountNumber:'0012'},{accountNumber:'0012',balance:999}]},
    ];
    for(const row of badProfiles){
      assert.throws(()=>merge(initial,readCreditRefreshResult(result(row))),{code:'CREDIT_REFRESH_RESULT_INVALID'});
      assert.equal(JSON.stringify(initial),before);
      assert.deepEqual(initial,snapshot);
    }
  });
}

test('current planning/refresh reject duplicate profile IDs and lossy keys before mapping',()=>{
  for(const read of [readCreditStatusProfiles,readCreditRefreshResult]){
    assert.throws(()=>read({profiles:[profile,profile]}),{code:'CREDIT_REFRESH_RESULT_INVALID'});
    for(const profileId of malformed)assert.throws(()=>read({profiles:[{profileId}]}),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  }
});

test('owner labels used for cross-profile identity cannot be invented or truncated by normalization',()=>{
  for(const ownerLabel of [null,123,{},[],['Owner'],' Owner','Owner ','a  b','x'.repeat(101)]){
    assert.throws(()=>readCreditRefreshResult(result({...profile,ownerLabel})),{code:'CREDIT_REFRESH_RESULT_INVALID'});
    assert.throws(()=>creditProfilePublic({...profile,ownerLabel}),{code:'CREDIT_PROVIDER_SCHEMA_ERROR'});
  }
  for(const ownerLabel of ['', 'משפחה א'])assert.doesNotThrow(()=>readCreditRefreshResult(result({...profile,ownerLabel})));
});

test('Bridge profile/account producers validate supplied identity before conversion',()=>{
  for(const accountNumber of [...malformed,'P:C'])
    assert.throws(()=>normalizeCreditScrapeAccount({accountNumber}),{code:'CREDIT_PROVIDER_SCHEMA_ERROR'});
  for(const row of [{...profile,provider:'garbage'},{...profile,defaultAccount:null},{...profile,profileId:{}}])
    assert.throws(()=>creditProfilePublic(row),{code:'CREDIT_PROVIDER_SCHEMA_ERROR'});
});

test('supported providers, roles, portable import IDs and string account numbers remain exact',()=>{
  for(const provider of ['visaCal','max','isracard','amex'])for(const defaultAccount of ['עסקי','ביתי']){
    const row={...profile,profileId:'import:connection-key',provider,defaultAccount};
    assert.deepEqual(readCreditRefreshResult(result(row)).profiles[0],row);
    assert.equal(creditProfilePublic(row).provider,provider);
  }
  // Older Bridge responses may omit optional metadata, never an account key.
  assert.doesNotThrow(()=>readCreditRefreshResult({profiles:[{profileId:'P',accounts:[{accountNumber:'0012'}]}]}));
  for(const normalize of [ordersHistory,kupaHistory]){
    const saved=normalize({profiles:[{profileId:'old',provider:'unknown',defaultAccount:null,
      accounts:[{accountNumber:123,txns:[{id:'old'}]}]}]});
    assert.equal(saved.profiles[0].accounts[0].accountNumber,'123');
    assert.equal(saved.profiles[0].defaultAccount,'עסקי');
  }
});
