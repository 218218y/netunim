import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCreditRefreshResult} from '../shared/credit-refresh-result.js';
import {normalizeCreditScrapeAccount} from '../netunim-kupa/bank-bridge/credit-transaction-model.mjs';
import {mergeCreditSyncResult as ordersMerge} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {mergeCreditSyncResult as kupaMerge} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';

const evidenceFile=new URL('../shared/credit-transaction-evidence.js',import.meta.url);
const decoderFile=new URL('../shared/credit-refresh-result.js',import.meta.url);
const accountFile=new URL('../netunim-kupa/bank-bridge/credit-transaction-model.mjs',import.meta.url);
const profileFile=new URL('../netunim-kupa/bank-bridge/credit-profile-model.mjs',import.meta.url);
const read=file=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const profile={profileId:'P',provider:'max',defaultAccount:'ביתי'};
const tx={id:'retained',status:'pending',chargedAmount:20};
const account={accountNumber:'C',balance:100,cardFrame:1000,availableCredit:900,
  pendingStatus:'success',pendingTransactions:[tx]};
const response=(row=account,metadata=profile)=>({contractVersion:2,profiles:[{...metadata,accounts:[row]}]});
const merges=[ordersMerge,kupaMerge];

function remove(source,guard,replacement=''){
  assert.equal(source.split(guard).length,2,'mutation must remove exactly one production guard');
  return source.replace(guard,replacement);
}

async function withEvidence(file,evidence,source=read(file)){
  source=source.replace(/(['"])\.\/credit-transaction-evidence\.(?:js|mjs)\1/g,JSON.stringify(evidence));
  source=source.replace(/(['"])\.\/([^'"]+)\1/g,(_,quote,path)=>JSON.stringify(new URL(path,file).href));
  return import(data(source));
}

for(const [name,guard,patch,select,expected] of [
  ['pending status',"optionalEnum(account.pendingStatus,['success','provider_error','schema_error','network_error','missing']);",
    {pendingStatus:'garbage',pendingTransactions:[{...tx,id:'replacement'}]},row=>row.pendingTransactions[0].id,'replacement'],
  ['frame fetch status',"optionalEnum(account.frameFetchStatus,['success','unavailable','provider_error','schema_error','network_error']);",
    {frameFetchStatus:'garbage',balance:999,cardFrame:9999,availableCredit:9000},row=>[row.frameFetchStatus,row.balance,row.cardFrame,row.availableCredit],['success',999,9999,9000]],
  ['frame status',"optionalEnum(account.frameStatus,['fresh','stale','missing']);",
    {frameStatus:'garbage',balance:999},row=>[row.frameFetchStatus,row.balance],['success',999]],
])test('removing the actual '+name+' guard restores false financial replacement in both apps and Bridge',async()=>{
  const raw=response({...account,...patch});
  assert.throws(()=>readCreditRefreshResult(raw),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  assert.throws(()=>normalizeCreditScrapeAccount(raw.profiles[0].accounts[0],'max'),{code:'CREDIT_PROVIDER_SCHEMA_ERROR'});
  const evidence=data(remove(read(evidenceFile),guard));
  const decoder=await withEvidence(decoderFile,evidence),producer=await withEvidence(accountFile,evidence);
  const produced=producer.normalizeCreditScrapeAccount(raw.profiles[0].accounts[0],'max');
  assert.equal(name==='pending status'?produced.pendingStatus:produced.frameFetchStatus,'success');
  for(const merge of merges){
    const initial=merge({cardMappings:{'P:C':{included:true}}},readCreditRefreshResult(response()));
    assert.deepEqual(select(merge(initial,decoder.readCreditRefreshResult(raw)).profiles[0].accounts[0]),expected);
  }
});

for(const [field,guard,bad,expected] of [
  ['provider',"optionalEnum(profile.provider,['visaCal','max','isracard','amex']);",'garbage',''],
  ['defaultAccount',"optionalEnum(profile.defaultAccount,['עסקי','ביתי']);",'garbage','עסקי'],
])test('removing the actual '+field+' guard restores invented issuer/routing metadata',async()=>{
  const raw=response(account,{...profile,[field]:bad});
  assert.throws(()=>readCreditRefreshResult(raw),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  const evidence=data(remove(read(evidenceFile),guard));
  const decoder=await withEvidence(decoderFile,evidence),producer=await withEvidence(profileFile,evidence);
  const projected=producer.creditProfilePublic(raw.profiles[0]);
  assert.equal(projected[field],field==='provider'?'garbage':'עסקי');
  for(const merge of merges){
    const initial=merge({cardMappings:{'P:C':{included:true}}},readCreditRefreshResult(response()));
    assert.equal(merge(initial,decoder.readCreditRefreshResult(raw)).profiles[0][field],expected);
  }
});

test('removing the actual producer account key guard emits a schema-shaped ghost account',async()=>{
  const raw={...account,accountNumber:{}};
  assert.throws(()=>normalizeCreditScrapeAccount(raw,'max'),{code:'CREDIT_PROVIDER_SCHEMA_ERROR'});
  const evidence=data(remove(read(evidenceFile),'assertCreditIdentity(account.accountNumber,true);'));
  const producer=await withEvidence(accountFile,evidence);
  const ghost=producer.normalizeCreditScrapeAccount(raw,'max');
  assert.equal(ghost.accountNumber,'[object Object]');
  for(const merge of merges){
    const accepted=readCreditRefreshResult(response(ghost));
    assert.equal(merge({},accepted).profiles[0].accounts[0].accountNumber,'[object Object]');
  }
});

test('removing the required network account key guard creates an empty mapping identity',async()=>{
  const raw=response({...account,accountNumber:undefined});
  assert.throws(()=>readCreditRefreshResult(raw),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  const decoder=await withEvidence(decoderFile,evidenceFile.href,
    remove(read(decoderFile),'assertCreditIdentity(account.accountNumber,true);',';'));
  for(const merge of merges)assert.equal(merge({},decoder.readCreditRefreshResult(raw)).profiles[0].accounts[0].accountNumber,'');
});

for(const [name,file,guard,raw] of [
  ['account',evidenceFile,'if(accounts.has(account.accountNumber))invalid();',response(null)],
  ['profile',decoderFile,'if(seen.has(profile.profileId))throw invalid();',response()],
])test('removing the actual duplicate '+name+' guard restores order-dependent replacement',async()=>{
  const later={...account,balance:999};
  if(name==='account')raw.profiles[0].accounts=[account,later];
  else raw.profiles.push({...profile,accounts:[later]});
  assert.throws(()=>readCreditRefreshResult(raw),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  const evidence=file===evidenceFile?data(remove(read(file),guard)):evidenceFile.href;
  const decoder=await withEvidence(decoderFile,evidence,file===decoderFile?remove(read(file),guard):read(decoderFile));
  for(const merge of merges)assert.equal(merge({cardMappings:{'P:C':{included:true}}},decoder.readCreditRefreshResult(raw)).profiles[0].accounts[0].balance,999);
});

test('removing the monthly fetch-status guard restores successful empty replacement',async()=>{
  const guard="optionalEnum(month.fetchStatus,['success','provider_error','schema_error','network_error']);";
  const raw=response({...account,months:[{month:'2026-10',fetchStatus:['success']}]});
  assert.throws(()=>readCreditRefreshResult(raw),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  const decoder=await withEvidence(decoderFile,data(remove(read(evidenceFile),guard)));
  for(const merge of merges){
    const initial=merge({cardMappings:{'P:C':{included:true}}},readCreditRefreshResult(response({...account,
      months:[{month:'2026-10',fetchStatus:'success',transactions:[{...tx,status:'completed'}]}]})));
    assert.equal(merge(initial,decoder.readCreditRefreshResult(raw)).profiles[0].accounts[0].months[0].transactions.length,0);
  }
});

test('removing the owner-label guard restores cross-profile identity collapse',async()=>{
  const guard=`  if(profile.ownerLabel!==undefined&&(typeof profile.ownerLabel!=='string'||
    profile.ownerLabel.length>100||profile.ownerLabel!==profile.ownerLabel.trim().replace(/\\s+/g,' ')||
    /[\\u0000-\\u001f\\u007f]/.test(profile.ownerLabel)))invalid();`;
  const profiles=['P','Q'].map(profileId=>({...profile,profileId,ownerLabel:{},accounts:[account]}));
  assert.throws(()=>readCreditRefreshResult({profiles}),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  const decoder=await withEvidence(decoderFile,data(remove(read(evidenceFile),guard)));
  for(const merge of merges){
    const initial=merge({},readCreditRefreshResult({profiles:profiles.map((row,index)=>({...row,ownerLabel:'Owner '+index}))}));
    assert.equal(initial.profiles.length,2);
    assert.equal(merge(initial,decoder.readCreditRefreshResult({profiles})).profiles.length,1);
  }
});
