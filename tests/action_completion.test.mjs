import test from 'node:test';
import assert from 'node:assert/strict';
import {bindActionEvents} from '../shared/events.js';
import {createFinanceBankActions} from '../netunim-orders/site/assets/js/ui/action-packs/finance-bank.js';
import {createBankActions} from '../netunim-kupa/site/assets/js/ui/action-packs/bank.js';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t,actions,options={}){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'Element');
  class Element{
    getAttribute(name){return name==='data-action'?'save':null}
    matches(){return false}
  }
  globalThis.Element=Element;
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'Element',previous);else delete globalThis.Element});
  const listeners={},root={addEventListener:(type,handler)=>{listeners[type]=handler}};
  const element=new Element(),event={target:element,composedPath:()=>[element,root]};
  bindActionEvents(root,actions,options);
  return {fire:()=>listeners.click(event),element,event};
}

test('delegation observes rejected commands once and keeps DOM dispatch synchronous',async t=>{
  const failure=new Error('storage unavailable'),reports=[];
  let reject;
  const command=new Promise((_,no)=>{reject=no});
  const {fire}=harness(t,{save:()=>command},{onError:(...args)=>reports.push(args)});
  assert.equal(fire(),undefined);
  reject(failure);
  await turn();
  assert.deepEqual(reports,[[failure,{name:'save',type:'click'}]]);
});

test('domain-handled failures and successful commands produce no fallback notice',async t=>{
  const reports=[];
  const {fire}=harness(t,{save:()=>Promise.reject(new Error('handled')).catch(()=>false)},
    {onError:error=>reports.push(error)});
  fire();await turn();assert.deepEqual(reports,[]);
});

test('synchronous programming errors retain their existing throw contract',t=>{
  const failure=new Error('invalid command');
  const {fire}=harness(t,{save:()=>{throw failure}});
  assert.throws(fire,error=>error===failure);
});

test('a broken asynchronous reporter cannot leave a second unobserved rejection',async t=>{
  const logs=[];
  t.mock.method(console,'error',(...args)=>logs.push(args));
  const {fire}=harness(t,{save:()=>Promise.reject(new Error('command'))},
    {onError:()=>Promise.reject(new Error('reporter'))});
  fire();await turn();assert.equal(logs.length,1);
});

for(const site of ['kupa','orders']){
  test(`${site} bank configuration action returns the owning command completion`,async()=>{
    const failure=new Error('preflight failed'),pending=Promise.reject(failure);
    // Attach before the pre-fix action can lose it; identity proves the broken path.
    pending.catch(()=>{});
    const actions=site==='kupa'
      ?createBankActions({connectionForms:{configure:()=>pending},ui:{}})
      :createFinanceBankActions({domainsFinanceView:{configureBank:()=>pending},ui:{}});
    const result=actions[site==='kupa'?'configure-bank-bridge':'configure-orders-bank']({},{});
    assert.equal(result,pending);
    await assert.rejects(result,error=>error===failure);
  });
}
