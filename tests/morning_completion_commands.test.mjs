import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMorningIssueCommand} from '../netunim-orders/site/assets/js/domains/customers/morning-issue-command.js';
import {createMorningRecoveryDecision} from '../netunim-orders/site/assets/js/domains/customers/morning-recovery-decision.js';
import {createMorningDebtRecoveryContext,morningFinancialSnapshot} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js';
const OP='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function issueFixture(factory=createMorningIssueCommand){
 const state={createBusy:false,blocked:false,completed:false},calls=[],control={active:true,current:true,epoch:0,online:true,rejected:false};
 const assertCurrent=()=>{if(!control.current)throw Object.assign(Error('replaced'),{code:'MORNING_OPERATION_SCOPE_CHANGED'})};
 const payload={operation_id:OP,document:{type:320,amount:42,client:{name:'Customer'}}},context={operationId:OP};
 const ports={
  session:{read:()=>state,update:next=>Object.assign(state,next),reject:()=>control.rejected,assertModal:assertCurrent,capture:()=>assertCurrent,generation:()=>1,signal:()=>new AbortController().signal,interruptionEpoch:()=>control.epoch,operationId:()=>OP,isActive:()=>control.active,scopeChanged:error=>error.code==='MORNING_OPERATION_SCOPE_CHANGED',cancelStatus:()=>calls.push('cancel-status')},
  form:{read:()=>payload,policy:()=>({}),context:()=>context,confirmation:()=>''},
  issuance:{issue:async()=>{calls.push('issue');state.blocked=true;return {document:{id:'official',number:'4001',amount:42,type:320}}}},
  application:{apply:async(c,evidence,options)=>{calls.push({apply:true,context:c,evidence,options});return {changed:true,persisted:true}}},
  recovery:{settle:()=>({durable:true,recoveryCleared:true,blocked:false}),notify:()=>calls.push('notify'),adopt:id=>calls.push({adopt:id}),reset:id=>{calls.push({reset:id});state.blocked=false},schedule:ms=>calls.push({schedule:ms})},
  display:{confirmDialog:async()=>true,busy:()=>{},operation:()=>calls.push('render'),status:()=>calls.push('status'),markSaved:()=>calls.push('saved')},
  media:{invalidateCache:()=>calls.push('invalidate'),viewDocument:async()=>{calls.push('view');return true}},feedback:{toast:()=>calls.push('toast')},connectivity:{isOnline:()=>control.online},
 };
 return {ports,state,calls,control,command:()=>factory(ports)};
}
for(const key of ['createBusy','blocked','completed'])test('issuance admission rejects '+key,async()=>{
 const f=issueFixture();f.state[key]=true;await f.command().create();assert.deepEqual(f.calls,[]);
});
test('a held confirmation excludes a second create and cancellation never reserves',async()=>{
 const f=issueFixture(),held=gate();f.ports.display.confirmDialog=()=>held.promise;const command=f.command(),work=command.create();
 await command.create();assert.equal(f.state.createBusy,true);held.resolve(false);await work;assert.equal(f.calls.includes('issue'),false);assert.equal(f.state.createBusy,false);
});
for(const change of ['current','active','rejected'])test('confirmation rechecks '+change+' before official issuance',async()=>{
 const f=issueFixture(),held=gate();f.ports.display.confirmDialog=()=>held.promise;const work=f.command().create();f.control[change]=change==='rejected';held.resolve(true);await work;assert.equal(f.calls.includes('issue'),false);
});
test('closed presentation does not cancel accepted verified work or publish into a replacement modal',async()=>{
 const f=issueFixture(),held=gate(),issue=f.ports.issuance.issue;f.ports.issuance.issue=async(...args)=>{await held.promise;return issue(...args)};const work=f.command().create();await Promise.resolve();f.control.active=false;f.control.epoch++;held.resolve();await work;
 const application=f.calls.find(row=>row.apply);assert.equal(application.options.immediate,false);assert.equal(application.options.isCurrent(),false);assert.equal(f.calls.includes('render'),false);assert.equal(f.calls.includes('view'),false);assert.equal(f.calls.includes('notify'),true);assert.equal(f.state.completed,true);
});
test('account replacement after a sent create cannot apply or clear recovery',async()=>{
 const f=issueFixture(),held=gate();f.ports.issuance.issue=async()=>{f.state.blocked=true;await held.promise;return {document:{id:'official'}}};const work=f.command().create();await Promise.resolve();f.control.current=false;held.resolve();await work;
 assert.equal(f.calls.some(row=>row.apply),false);assert.equal(f.calls.includes('notify'),false);assert.equal(f.state.blocked,true);assert.equal(f.state.createBusy,false);
});
for(const [name,error,reset] of [
 ['lost response',Error('lost'),false],['server failure',Object.assign(Error('server'),{status:503}),false],
 ['uncertain rejection',Object.assign(Error('uncertain'),{status:409,details:{uncertain:true}}),false],
 ['explicit rejection',Object.assign(Error('rejected'),{status:400}),true],
])test(name+' preserves retry policy',async()=>{
 const f=issueFixture();f.ports.issuance.issue=async()=>{f.state.blocked=true;throw error};await f.command().create();assert.equal(f.calls.some(row=>row.reset===OP),reset);assert.equal(f.state.blocked,!reset);
});
test('verified duplicate adopts the server operation and blocks another issuance',async()=>{
 const f=issueFixture();f.ports.issuance.issue=async()=>{throw Object.assign(Error('duplicate'),{status:409,details:{operation_id:OTHER,prevent_retry:true,document:{id:'existing'}}})};const command=f.command();await command.create();await command.create();assert.equal(f.state.blocked,true);assert.equal(f.state.completed,true);assert.equal(f.calls.some(row=>row.adopt===OTHER),true);assert.equal(f.calls.some(row=>row.schedule===15000),true);assert.equal(f.calls.some(row=>row.reset),false);
});
for(const serverLinkPending of [false,true])test('settlement retains the durability lock: '+serverLinkPending,async()=>{
 const f=issueFixture();f.ports.recovery.settle=()=>({durable:!serverLinkPending,recoveryCleared:!serverLinkPending,blocked:serverLinkPending});await f.command().create();assert.equal(f.state.blocked,serverLinkPending);assert.equal(f.calls.includes('notify'),!serverLinkPending);assert.equal(f.calls.some(row=>row.schedule===60000),serverLinkPending);
});
function decisionFixture(factory=createMorningRecoveryDecision){
 const debt={id:'debt',amount:42},snapshot=morningFinancialSnapshot(debt),calls=[],control={current:true,active:true,blocked:false,saves:0,failSave:0};
 let stored=createMorningDebtRecoveryContext({operationId:OP,debtId:'debt',type:320,amount:42,applyPayment:true,applyInvoice:true,financialSnapshot:snapshot});
 const assertCurrent=()=>{if(!control.current)throw Object.assign(Error('replaced'),{code:'MORNING_OPERATION_SCOPE_CHANGED'})};
 const panel={replaceChildren(){},hidden:true},ports={
  session:{isActive:()=>control.active,generation:()=>1,assertModal:assertCurrent,capture:()=>assertCurrent,scopeChanged:e=>e.code==='MORNING_OPERATION_SCOPE_CHANGED'},
  debts:{read:()=>debt,refresh:async()=>true,isBlocked:()=>control.blocked},
  recovery:{read:()=>stored,save:value=>{control.saves++;if(control.saves===control.failSave)return false;stored=value;return true},adopt:()=>calls.push('adopt'),isPending:()=>false,run:async()=>calls.push('recover')},
  application:{isPending:()=>false},display:{isOpen:()=>true,open:()=>{},field:id=>id==='morningRecoveryDecision'?panel:{checked:true},status:()=>{},markSaved:()=>{},busy:()=>{}},feedback:{toast:()=>calls.push('toast')},
 };
 const command=factory(ports);command.show(stored,snapshot);
 return {ports,command,calls,control,debt,read:()=>stored,replace:value=>{stored=value}};
}
test('recovery confirms the saved current snapshot before joining reconciliation',async()=>{
 const f=decisionFixture();await f.command.confirm();assert.ok(f.read().resolution.confirmedAt);assert.equal(f.calls.includes('recover'),true);
});
for(const changed of ['refresh','snapshot','context','authority','blocked','save'])test('recovery does not confirm after '+changed+' changes',async()=>{
 const f=decisionFixture(),held=gate();f.ports.debts.refresh=()=>held.promise;const work=f.command.confirm();
 if(changed==='snapshot')f.debt.amount=43;
 if(changed==='context')f.replace({...f.read(),operationId:OTHER});
 if(changed==='authority')f.control.current=false;
 if(changed==='blocked')f.control.blocked=true;
 if(changed==='save')f.control.failSave=2;
 held.resolve(changed!=='refresh');await work;assert.equal(f.calls.includes('recover'),false);assert.equal(f.read().resolution.confirmedAt,'');
});
test('failed choice save and cleared display cannot grant a recovery confirmation',async()=>{
 const f=decisionFixture();f.control.failSave=1;await f.command.confirm();assert.equal(f.calls.includes('recover'),false);f.command.clear();assert.equal(f.command.save(),false);
});
async function mutant(file,from,to,exported){
 const url=new URL('../netunim-orders/site/assets/js/domains/customers/'+file,import.meta.url);let source=readFileSync(url,'utf8');assert.ok(source.includes(from));source=source.replace(from,to).replace(/from '([^']+)'/g,(_,relative)=>'from '+JSON.stringify(new URL(relative,url).href));return (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')))[exported];
}
test('negative implementation: removing confirmation allows a forbidden official issue',async()=>{
 const factory=await mutant('morning-issue-command.js','if(!confirmed)return;','void confirmed;','createMorningIssueCommand');const f=issueFixture(factory);f.ports.display.confirmDialog=async()=>false;await f.command().create();assert.equal(f.calls.includes('issue'),true,'the cancellation scenario must detect this policy mutation');
});
test('negative implementation: skipping financial comparison applies a stale recovery choice',async()=>{
 const factory=await mutant('morning-recovery-decision.js','morningFinancialChanges(chosen.resolution.financialSnapshot,current).changed','false','createMorningRecoveryDecision');const f=decisionFixture(factory),held=gate();f.ports.debts.refresh=()=>held.promise;const work=f.command.confirm();f.debt.amount=43;held.resolve(true);await work;assert.equal(f.calls.includes('recover'),true,'the changed-debt scenario must detect this policy mutation');
});
