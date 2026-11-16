import test from 'node:test';
import assert from 'node:assert/strict';
import {creditVersionDiff,financeBackup,readFinanceBackup,sha256} from '../shared/finance-history-model.js';
import {creditRestorePreflight} from '../shared/credit-restore-validation.js';
import {normalizeCreditSync as kupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {normalizeCreditSync as orders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
const tx={id:'T',status:'completed',date:'2026-11-10',processedDate:'2026-11-20',originalAmount:-365,originalCurrency:'ILS',chargedAmount:-365,chargedCurrency:'ILS'};
const source=()=>({creditSync:{version:4,profiles:[{profileId:'P',defaultAccount:'עסקי',accounts:[{accountNumber:'C',months:[{month:'2026-11',transactions:[tx]}]}]}],cardMappings:{'P:C':{included:true,hidden:false,account:'עסקי'}}}});
for(const projectCredit of [kupa,orders])test('actual product projection exposes inclusion, role, hidden, legacy normalization and transitions',()=>{
 const before=source(),target=source();target.creditSync.cardMappings['P:C'].included=false;
 const diff=creditVersionDiff(before,target,{asOf:'2026-11-16',projectCredit});
 assert.equal(diff.changes.length,0);assert.equal(diff.settingChanges.length,1);assert.equal(diff.calculatedChanged,true);
 assert.equal(diff.calculated[0].before.cents,36500);assert.equal(diff.calculated[0].after.cents,0);
 target.creditSync.cardMappings['P:C']={included:true,account:'ביתי',accountTransitions:[{effectiveDate:'2026-11-01',fromAccount:'עסקי',toAccount:'ביתי'}]};
 const moved=creditVersionDiff(before,target,{asOf:'2026-11-16',projectCredit});
 assert.equal(moved.calculated.find(row=>row.account==='עסקי').after.cents,0);assert.equal(moved.calculated.find(row=>row.account==='ביתי').after.cents,36500);
 target.creditSync.cardMappings['P:C'].accountTransitions[0].effectiveDate='2026-12-01';
 assert.equal(creditVersionDiff(before,target,{asOf:'2026-11-16',projectCredit}).calculatedChanged,false,'historical assignment uses the actual transition engine');
 target.creditSync.cardMappings['P:C'].manualFrame=500;target.creditSync.profiles[0].accounts[0].balanceDate='2026-12-15';
 assert.ok(creditVersionDiff(before,target,{projectCredit}).settingChanges.some(row=>row.path.endsWith('manualFrame')));
 const legacy=source();legacy.creditSync.version=1;delete legacy.creditSync.cardMappings;
 assert.equal(creditVersionDiff(before,legacy,{projectCredit}).calculatedChanged,false,'legacy v1 implicit inclusion is projected through the product normalizer');
 assert.deepEqual(before,source(),'preview does not mutate financial state');
});
for(const [name,mutate] of [
 ['duplicate_profile',s=>s.creditSync.profiles.push(structuredClone(s.creditSync.profiles[0]))],
 ['duplicate_account',s=>s.creditSync.profiles[0].accounts.push(structuredClone(s.creditSync.profiles[0].accounts[0]))],
 ['duplicate_month',s=>s.creditSync.profiles[0].accounts[0].months.push(structuredClone(s.creditSync.profiles[0].accounts[0].months[0]))],
 ['invalid_month',s=>s.creditSync.profiles[0].accounts[0].months[0].month='2026-13'],
 ['ambiguous_billing_identity',s=>s.creditSync.profiles[0].accounts[0].months[0].transactions.push({...tx})],
 ['duplicate_placement',s=>s.creditSync.profiles[0].accounts[0].unassignedTransactions=[{...tx,processedDate:null}]],
 ['invalid_amount',s=>s.creditSync.profiles[0].accounts[0].months[0].transactions=[{...tx,chargedAmount:'365'}]],
 ['invalid_date',s=>s.creditSync.profiles[0].accounts[0].months[0].transactions=[{...tx,date:'2026-02-30'}]],
 ['invalid_mapping',s=>s.creditSync.cardMappings['P:C'].included='false']
])test('transport-verifiable archive remains exportable, ordinary restore rejects '+name,async()=>{
 const state=source();mutate(state);const wire=JSON.stringify(state),backup=await financeBackup({revision:2,state_text:wire,state_hash:await sha256(wire)});
 assert.deepEqual(await readFinanceBackup(backup),state);const validation=creditRestorePreflight(state);
 assert.equal(validation.ok,false);assert.ok(validation.issues.some(issue=>issue.code===name));
});
test('flattened pending/unassigned cache is not counted as a second active source',()=>{
 const state=source(),a=state.creditSync.profiles[0].accounts[0];a.months=[];
 a.pendingTransactions=[{...tx,status:'pending'}];a.unassignedTransactions=[{...tx,processedDate:null}];a.txns=[...a.pendingTransactions,...a.unassignedTransactions];
 assert.equal(creditRestorePreflight(state).ok,true);
});
test('retained issuer currency symbols stay valid without guessing a foreign conversion',()=>{
 const state=source(),row=state.creditSync.profiles[0].accounts[0].months[0].transactions[0];
 row.originalCurrency='$';row.chargedCurrency='₪';
 assert.equal(creditRestorePreflight(state).ok,true);
 assert.equal(creditVersionDiff(state,state).calculated[0].before.cents,36500);
 row.chargedAmount=null;
 assert.equal(creditRestorePreflight(state).ok,true);
 const foreign=creditVersionDiff(state,state).calculated[0];assert.equal(foreign.currency,'₪');assert.equal(foreign.before.unknown,1);assert.equal(foreign.before.cents,0,'missing conversion cannot become invented billed money');
 row.chargedAmount=-365;row.chargedCurrency='invalid currency';
 assert.ok(creditRestorePreflight(state).issues.some(issue=>issue.code==='invalid_currency'));
});
