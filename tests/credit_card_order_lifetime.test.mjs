import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditCardOrderView} from '../shared/credit-card-order-view.js';

for(const fails of [false,true])test(`card order ${fails?'failure':'success'} cannot repaint or close a modal after its capability closes`,async t=>{
  const previous=globalThis.document;t.after(()=>{globalThis.document=previous});
  let active=true,finish,entered,closed=0,renders=0,opened=0,paints=0;
  const held=new Promise((resolve,reject)=>{finish=fails?()=>reject(new Error('held write failed')):()=>resolve(true)});
  const started=new Promise(resolve=>{entered=resolve});
  const list={set innerHTML(_value){paints++}},error={textContent:'retained error'};
  globalThis.document={getElementById:id=>id==='creditCardOrderList'?list:error,querySelector:()=>null};
  const view=createCreditCardOrderView({isActive:()=>active,getSync:()=>({}),escapeHtml:String,
    modal:()=>opened++,closeModal:()=>closed++,render:()=>renders++,saveOrder:()=>{entered();return held}});
  view.actions['open-credit-card-order']();const saving=view.actions['credit-card-order-save']();await started;
  active=false;const before=paints;finish();await saving;
  assert.equal(closed,0);assert.equal(renders,0);assert.equal(paints,before);assert.equal(error.textContent,'retained error');
  assert.equal(view.actions['open-credit-card-order'](),false);assert.equal(opened,1);
});
