import test from 'node:test';
import assert from 'node:assert/strict';
import {createKupaCreditRuntime} from '../netunim-kupa/site/assets/js/composition/credit.js';
import {createCreditConnectionDialog} from '../netunim-kupa/site/assets/js/ui/credit-connection-dialog.js';

const noop=()=>{},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(){
  const model={state:{creditSync:{version:4,profiles:[],errors:[]}}},events=[],jobs=new Map();let timerId=0;
  const timers={setTimeout:run=>{const id=++timerId;jobs.set(id,()=>{jobs.delete(id);return run()});return id},clearTimeout:id=>jobs.delete(id)};
  const preferences={read:()=>({ok:true,value:{enabled:false,mode:'smart',attemptAt:0}}),setEnabled:noop,setMode:noop,markAttempt:noop,reset:noop};
  const effects={writeText:async()=>events.push('clipboard'),saveJson:()=>events.push('download'),dispose:()=>events.push('effects disposed')};
  const credit=createKupaCreditRuntime({model,ui:{},platform:{effects,preferences,timers}});
  const bridge={getBridgeToken:()=> 'paired',creditStatus:async()=>({bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]})};
  const ports={bridge,authority:{scope:{capture:()=>noop},automaticAccess:()=> 'local'},
    cloud:{refresh:async()=>({verified:true,state:model.state}),commit:async mutate=>{events.push('commit');return {saved:true,row:{state:mutate(model.state)}}},
      claimLease:async()=>({acquired:true,leaseName:'credit',leaseToken:'L',fenceEpoch:1}),releaseLease:async(_kind,_token,{assertCurrent})=>{assertCurrent();events.push('release')}},
    persistence:{save:async()=>{events.push('checkpoint');return true}},
    presentation:{toast:()=>events.push('toast'),render:()=>events.push('render'),renderStatus:()=>events.push('status'),closeModal:noop,confirmDialog:async()=>true}};
  return {credit,ports,model,events,jobs,effects,bind:()=>credit.bindServices(ports)};
}

test('Credit construction and service binding are inert and expose only capability roles',()=>{
  const f=fixture();assert.deepEqual(f.events,[]);assert.equal(f.jobs.size,0);
  assert.throws(()=>f.credit.runtime.start(),/credit_services_not_bound/);f.bind();
  assert.deepEqual(f.events,[]);assert.equal(f.credit.creditController,undefined);
  assert.equal(typeof f.credit.commands.saveCreditConnection,'function');
  assert.equal(typeof f.credit.queries.uiState,'function');
  assert.equal(f.credit.runtime.dispose(),true);assert.equal(f.credit.runtime.dispose(),false);
});

for(const dispose of [false,true])test(`Credit ${dispose?'disposal fences publication':'ordinary stop preserves accepted publication'} during a held provider result`,async()=>{
  const f=fixture(),entered=gate(),held=gate(),before=structuredClone(f.model.state);
  f.ports.bridge.syncCreditCards=()=>{entered.resolve();return held.promise};f.bind();
  const request=f.credit.commands.refreshCreditSync();await entered.promise;
  assert.equal(f.jobs.size,1,'the lease heartbeat belongs to the injected timer owner');
  assert.equal(f.credit.runtime.isPending(),true);
  let drained=false;
  if(dispose){f.credit.runtime.dispose();assert.equal(f.jobs.size,0,'disposal immediately stops renewal while the provider is held')}
  else{f.credit.runtime.stop();assert.equal(f.jobs.size,1,'stopping automation does not revoke a manual lease')}
  const drain=f.credit.runtime.drain().then(()=>{drained=true});await Promise.resolve();assert.equal(drained,false);
  const events=f.events.length;
  held.resolve({profiles:[{profileId:'P',provider:'max',accounts:[]}],errors:[],attemptedCount:1});await request;await drain;
  assert.equal(f.credit.runtime.isPending(),false);assert.equal(f.jobs.size,0);
  if(dispose){assert.deepEqual(f.model.state,before);assert.deepEqual(f.events.slice(events),[])}
  else{assert.equal(f.model.state.creditSync.profiles[0].profileId,'P');assert.ok(f.events.includes('commit')&&f.events.includes('checkpoint'));f.credit.runtime.dispose()}
  assert.equal(Object.hasOwn(f.credit.queries.uiState(),'autoTimer'),false);
});

for(const method of ['deleteCreditConnection','resetCreditSync'])test(`Credit closes held ${method} confirmation before any destructive Bridge request`,async()=>{
  const f=fixture(),opened=gate(),held=gate();let mutations=0;
  f.ports.presentation.confirmDialog=()=>{opened.resolve();return held.promise};
  f.ports.bridge.deleteCreditProfile=f.ports.bridge.resetCreditProfiles=async()=>{mutations++};f.bind();
  const pending=f.credit.commands[method]('P');await opened.promise;f.credit.runtime.dispose();held.resolve(true);
  await pending;await f.credit.runtime.drain();assert.equal(mutations,0);
  assert.equal(await f.credit.commands[method]('P'),false);
});

test('Credit command completion and drain join a held renewal after the provider result arrives',async()=>{
  const f=fixture(),entered=gate(),provider=gate(),renewed=gate(),renewal=gate();let claims=0;
  f.ports.bridge.syncCreditCards=()=>{entered.resolve();return provider.promise};
  const lease={acquired:true,leaseName:'credit',leaseToken:'L',fenceEpoch:1};
  f.ports.cloud.claimLease=()=>{if(++claims===1)return lease;renewed.resolve();return renewal.promise};f.bind();
  const request=f.credit.commands.refreshCreditSync();await entered.promise;
  const pulse=[...f.jobs.values()][0]();await renewed.promise;f.credit.runtime.dispose();
  let drained=false;const drain=f.credit.runtime.drain().then(()=>{drained=true});
  let completed=false;void request.then(()=>{completed=true});
  provider.resolve({profiles:[],errors:[],attemptedCount:1});
  try{
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(completed,false,'the command must retain its accepted renewal through cleanup');
    assert.equal(drained,false);assert.equal(f.credit.runtime.isPending(),true);assert.equal(f.jobs.size,0);
  }finally{renewal.resolve(lease);await pulse;await request;await drain}
  assert.equal(f.credit.runtime.isPending(),false);assert.equal(f.jobs.size,0);assert.ok(!f.events.includes('commit'));
});

test('Credit drains an accepted clipboard write without a late UI notification',async()=>{
  const f=fixture(),entered=gate(),held=gate();
  f.ports.bridge.creditDiagnostics=async()=>({events:[{stage:'safe'}]});
  f.effects.writeText=text=>{assert.ok(JSON.parse(text).events.length===1);entered.resolve();return held.promise};f.bind();
  const copy=f.credit.commands.copySafeCreditDiagnostics();await entered.promise;f.credit.runtime.dispose();
  let drained=false;const drain=f.credit.runtime.drain().then(()=>{drained=true});await Promise.resolve();assert.equal(drained,false);
  held.resolve();assert.equal(await copy,false);await drain;assert.ok(!f.events.includes('toast'));
});

test('Credit disposal drains a durability receipt already accepted by the existing manual editor',async t=>{
  const f=fixture(),held=gate();f.model.state.credits=[{id:'legacy',card:'old card'}];f.model.state.cards=[];f.bind();
  const date={dateEditorMarkup:()=>'',setDateValue:noop};
  f.credit.bindView({uiBulk:{syncBulkUi:noop,bulkControls:noop,bulkHeader:noop,bulkCell:noop},uiDateEditor:date,
    financeDerivations:{run:fn=>fn()},domainRevisions:{stamp:()=>0},expensesMarkup:()=>''});
  let save,receipts=0;
  f.credit.bindEditor({uiModal:{modal:(_title,_body,_label,submit)=>{save=submit},armModalDraftGuard:noop,closeModal:noop},
    uiDateEditor:date,uiStatus:{toast:noop},domainsRecordsCommands:{deleteRecord:noop},
    storagePersistence:{saveState:(_message,options)=>{assert.deepEqual(options.domains,['credits']);receipts++;f.credit.runtime.dispose();return held.promise}}});
  f.credit.actions['open-credit-modal-2']({dataset:{clickArg0:'legacy'}});
  const previous=globalThis.document;t.after(()=>{globalThis.document=previous});
  const values={cAccount:'עסקי',cOwner:'owner',cCard:'retained card',cDesc:'same edit',cTx:'2026-10-12',cTotal:'23',cParts:'1',cFirst:'2026-11-10',cActive:'כן',cNote:'accepted content'};
  globalThis.document={getElementById:id=>({value:values[id]})};
  // Rendering is outside this editor receipt scenario; close the capability
  // synchronously inside acceptance to also exercise its late render guard.
  const pendingSave=save;
  // The real editor starts persistence synchronously and retains the receipt.
  assert.equal(typeof pendingSave,'function');
  pendingSave();assert.equal(receipts,1);assert.equal(f.credit.runtime.isPending(),true);
  assert.equal(f.credit.runtime.dispose(),false);let drained=false;const drain=f.credit.runtime.drain().then(()=>{drained=true});
  await Promise.resolve();assert.equal(drained,false);held.resolve(true);await drain;
  assert.equal(f.model.state.credits[0].note,'accepted content');assert.equal(pendingSave(),false);assert.equal(receipts,1);
});

test('replaced or disposed Credit forms cannot read another form or submit retained callbacks',async t=>{
  const previous=globalThis.document,forms=[],saved=[];let nodes;
  const fieldIds=['ccProvider','ccLabel','ccOwner','ccAccount','ccUsername','ccId','ccCard6','ccPassword'];
  const document={getElementById:id=>nodes[id],querySelector:selector=>nodes[selector]};
  globalThis.document=document;t.after(()=>{globalThis.document=previous});
  const dialog=createCreditConnectionDialog({isActive:()=>true,armModalDraftGuard:noop,
    readProfile:id=>({profileId:id,provider:'max',local:true}),saveConnection:async input=>saved.push(input),
    modal:(_title,_body,_label,save)=>{
      nodes=Object.fromEntries(fieldIds.map(id=>[id,Object.assign(new EventTarget(),{value:id==='ccProvider'?'max':''})]));
      for(const selector of ['.cc-username','.cc-id','.cc-card6','.cc-isracard-note'])nodes[selector]={hidden:false};
      nodes.creditConnectionForm=Object.assign(new EventTarget(),{isConnected:true});
      nodes.modalBackdrop={classList:{contains:()=>true}};forms.push({save,nodes});
    }});
  dialog.open('first');dialog.open('second');
  nodes.ccLabel.value='  label  ';nodes.ccOwner.value=' owner ';nodes.ccAccount.value='ביתי';nodes.ccPassword.value=' secret ';
  nodes.ccProvider.value='amex';nodes.ccId.value='123456789';nodes.ccCard6.value='654321';
  assert.equal(await forms[0].save(),false);assert.equal(saved.length,0);
  forms[0].nodes.ccProvider.dispatchEvent(new Event('change'));
  assert.equal(nodes['.cc-id'].hidden,true,'a previous form event cannot change the current form');
  nodes.ccProvider.dispatchEvent(new Event('change'));assert.equal(nodes['.cc-id'].hidden,false);
  await forms[1].save();assert.deepEqual(saved,[{profileId:'second',provider:'amex',label:'label',ownerLabel:'owner',defaultAccount:'ביתי',username:'',id:'123456789',card6Digits:'654321',password:' secret '}]);
  dialog.dispose();document.getElementById=()=>assert.fail('a disposed callback read browser fields');
  assert.equal(await forms[1].save(),false);assert.equal(saved.length,1);
});
