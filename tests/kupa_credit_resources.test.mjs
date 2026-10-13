import test from 'node:test';
import assert from 'node:assert/strict';
import {createKupaCreditControllerFixture as createDomainsCreditController} from './kupa_credit_controller_fixture.mjs';
import {createFinanceBrowserEffects} from '../shared/finance-browser-effects.js';

const noop=()=>{},gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
function ports(){return {model:{state:{creditSync:{profiles:[]}}},captureOperation:()=>noop,autoScope:()=>null,
  preferences:{read:()=>({ok:true,value:{enabled:false,mode:'smart',attemptAt:0}}),setEnabled:noop,setMode:noop,markAttempt:noop,reset:noop},
  saveState:async()=>true,toast:noop,render:noop,bridge:{getBridgeToken:()=> 'paired'},modal:noop,armModalDraftGuard:noop,closeModal:noop,confirmDialog:async()=>true}}

test('failed Credit diagnostic click leaves no temporary URL or anchor',async t=>{
  const urls=new Set(),anchors=[],failure=new Error('native click failed');
  const document={body:{appendChild:anchor=>{anchor.connected=true}},createElement:()=>{const anchor={connected:false,click(){throw failure},remove(){this.connected=false}};anchors.push(anchor);return anchor}};
  const URL={createObjectURL:()=>{urls.add('blob:credit');return 'blob:credit'},revokeObjectURL:url=>urls.delete(url)};
  const previous={document:globalThis.document,URL:globalThis.URL};globalThis.document=document;globalThis.URL=URL;
  t.after(()=>{globalThis.document=previous.document;globalThis.URL=previous.URL});
  const environment={document,URL,Blob:globalThis.Blob,navigator:{onLine:true}},effects=createFinanceBrowserEffects({environment});
  const p=ports();p.bridge.creditDataDiagnostics=async()=>({available:true,data:{fixture:'safe'},filename:'credit.json'});
  const api=createDomainsCreditController({...p,effects});
  assert.equal(await api.exportCreditDataDiagnostics(),false);
  assert.equal(urls.size,0);assert.ok(anchors.every(anchor=>!anchor.connected));effects.dispose();
});

test('Credit disposal drains a held status read and blocks its late publication',async()=>{
  const held=gate(),entered=gate(),p=ports(),events=[];
  p.bridge.creditStatus=async()=>{entered.resolve();return held.promise};p.render=()=>events.push('render');
  const api=createDomainsCreditController({...p,effects:createFinanceBrowserEffects()});
  const reading=api.refreshCreditBridgeStatus({quiet:false});await entered.promise;
  try{
    assert.equal(api.runtime.dispose(),true);assert.equal(api.runtime.dispose(),false);
    let drained=false;const drain=api.runtime.drain().then(()=>{drained=true});await Promise.resolve();assert.equal(drained,false);
    held.resolve({bridgeVersion:73,contractVersion:2,profiles:[]});await reading;await drain;
    assert.equal(api.creditSyncUiState().status,null);assert.deepEqual(events,[]);
  }finally{held.resolve({bridgeVersion:73,contractVersion:2,profiles:[]});await reading}
});
