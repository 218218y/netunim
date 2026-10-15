import test from 'node:test';
import assert from 'node:assert/strict';
import {createKupaBankSnapshotPolicy} from '../netunim-kupa/site/assets/js/domains/bank/snapshot-policy.js';
import {readBankBalanceResult} from '../netunim-kupa/site/assets/js/shared/bank-balance-result.js';
import {normalizeBankFeed} from '../netunim-kupa/site/assets/js/domains/bank/feed.js';
import {bankRecurringDebitHistoryData} from '../shared/bank-recurring-debits.js';
import {wholeMoney} from '../netunim-kupa/site/assets/js/core/money.js';
const stamp='2026-10-15T00:00:00.000Z';
const coverage=complete=>({complete,from:'2025-10-15',to:'2026-10-15',days:365});
function fixture({cloud=true,days=365,ready=false,businessComplete=true,home='complete'}={}){
 const prior={currentBalance:100,feed:normalizeBankFeed({accountNumber:'B',balance:100,transactions:[]}),homeFeed:{accountNumber:'H',balance:80},archiveInitialized:ready,archiveVersion:ready?2:1,archiveInitializedAt:'2025-01-01',archiveBaselineAudit:{id:'prior'},archiveAudit:{id:'prior-audit'},adjustments:[{id:'manual'}]};
 const evidence=readBankBalanceResult({accounts:{business:{balance:500.4,accountId:'B',transactionCoverage:coverage(businessComplete),transactions:[]},...(home==='complete'||home==='partial'?{home:{balance:250,accountId:'H',transactionCoverage:coverage(home==='complete'),transactions:[]}}:{})}});
 let sequence=7,now=stamp,identityReads=0,watermarkReads=0;
 const policy=createKupaBankSnapshotPolicy({
  feeds:{normalize:normalizeBankFeed,recurringHistory:bankRecurringDebitHistoryData,roundMoney:wholeMoney},
  source:{readBank:()=>prior,observedSequence:()=>{watermarkReads++;return sequence}},
  identity:{now:()=>{identityReads++;return now},today:()=>{identityReads++;return now.slice(0,10)},createToken:()=>{identityReads++;return 'BANK:'+sequence}},
 });
 const request={...evidence,homeFailure:home==='failure'?{message:'home unavailable'}:null,fetchedAt:stamp,businessAccount:'B',businessArchive:[],homeArchive:[],archiveAudit:{id:'current'},imageSyncWarning:'',cloudArchive:cloud,historyDays:days,archiveReady:ready,archiveVersion:ready?2:1};
 return {policy,request,prior,counts:()=>({identityReads,watermarkReads}),advance:()=>{sequence=11;now='2026-10-16T00:00:00.000Z'}};
}
test('Candidate preparation reads prior feeds before Checks while identity/watermark are captured after the barrier',()=>{
 const f=fixture(),prepared=f.policy.prepare(f.request);
 assert.deepEqual(f.counts(),{identityReads:0,watermarkReads:0});
 f.advance();const candidate=f.policy.build(prepared);
 assert.equal(candidate.snapshotSeq,11);assert.equal(candidate.snapshotToken,'BANK:11');assert.equal(candidate.updatedAt,'2026-10-16T00:00:00.000Z');assert.equal(candidate.asOfDate,'2026-10-16');
 assert.deepEqual(f.counts(),{identityReads:3,watermarkReads:1});assert.equal(candidate.bankSyncAt,stamp);assert.equal(f.prior.currentBalance,100);assert.deepEqual(candidate.adjustments,[]);
 for(const field of ['availableBalance','creditLimit','creditLimitUsed','creditLimitUsedPercent'])assert.equal(candidate[field],null,field);
});
for(const [name,options,initialized,baseline]of [
 ['manual verified dual backfill',{},true,'current'],
 ['rolling scan',{days:30},false,'prior'],
 ['local scan',{cloud:false},false,'prior'],
 ['partial business backfill',{businessComplete:false},false,'prior'],
 ['partial home backfill',{home:'partial'},false,'prior'],
 ['home failure',{home:'failure'},false,'prior'],
 ['single configured account',{home:'none'},true,'current'],
 ['already verified rolling scan',{days:30,ready:true},true,'prior'],
 ['already verified local scan',{cloud:false,days:30,ready:true},true,'prior'],
])test('Candidate retains established audit/home policy: '+name,()=>{
 const f=fixture(options),candidate=f.policy.build(f.policy.prepare(f.request));
 assert.equal(candidate.archiveInitialized,initialized);assert.equal(candidate.archiveBaselineAudit.id,baseline);
 assert.equal(candidate.currentBalance,500);assert.equal(candidate.snapshotSeq,7);assert.equal(candidate.feed.accountNumber,'B');
 if(options.home==='failure')assert.deepEqual(candidate.homeFeed,f.prior.homeFeed);
 if(options.home==='none')assert.equal(candidate.homeFeed,null);
 if(!options.cloud&&Object.hasOwn(options,'cloud'))assert.equal(candidate.archiveAudit.id,'prior-audit');
});
test('Candidate construction cannot manufacture financial fields from a forged decoder snapshot',()=>{
 const f=fixture();const prepared=f.policy.prepare(f.request);
 assert.throws(()=>f.policy.build({...prepared,business:{balance:500}}),{code:'BANK_BALANCE_INVALID'});
});
