import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCashView} from '../netunim-kupa/site/assets/js/domains/cash/view.js';
import {createDomainsCashEditor} from '../netunim-kupa/site/assets/js/domains/cash/editor.js';
import {createUiActions} from '../netunim-kupa/site/assets/js/ui/actions.js';

function fakeKpi(label,value){return `<article class="test-kpi" data-label="${label}" data-value="${value}"></article>`}

test('cash page renders only the two requested independent ledger columns',()=>{
  const content={innerHTML:''};
  Object.defineProperty(globalThis,'document',{value:{getElementById:id=>id==='content'?content:null},configurable:true});
  const synced=[];
  const model={state:{cash:[{id:'C1',date:'2026-09-01',type:'הכנסה',description:'מזומן',amount:100,note:''}],rights:[{id:'R1',date:'2026-08-31',type:'הכנסה',description:'זכות',amount:40,note:''}]}};
  const view=createDomainsCashView({model,ui:{bulkSelected:new Set()},cashBalance:()=>100,rightsBalance:()=>40,kpi:fakeKpi,syncBulkUi:c=>synced.push(c),bulkControls:()=>'',bulkHeader:()=>'',bulkCell:()=>''});
  view.renderCash();
  assert.match(content.innerHTML,/cash-ledgers/);
  assert.ok(content.innerHTML.indexOf('cash-ledger-cash')<content.innerHTML.indexOf('cash-ledger-rights'),'cash is the first RTL grid item (right column)');
  assert.match(content.innerHTML,/יתרת מזומן/);assert.match(content.innerHTML,/תנועות מזומן/);
  assert.match(content.innerHTML,/יתרת מעשר/);assert.match(content.innerHTML,/תנועות מעשר/);
  assert.doesNotMatch(content.innerHTML,/יציאות \/ התאמות/);assert.doesNotMatch(content.innerHTML,/>כניסות</);
  assert.match(content.innerHTML,/data-action="open-right-modal"/);assert.match(content.innerHTML,/data-action="open-right-modal-2"/);
  assert.deepEqual(synced,['cash','rights']);
});

test('rights editor writes only to rights and routes add/edit actions independently',()=>{
  const fields={
    mDate:{value:'2026-09-01'},mType:{value:'הכנסה'},mDesc:{value:'בדיקה'},mAmount:{value:'75'},mNote:{value:'הערה'}
  };
  Object.defineProperty(globalThis,'document',{value:{getElementById:id=>fields[id]},configurable:true});
  let modalSave=null,saved='',cashOpened=0,rightOpened=0;
  const model={state:{cash:[],rights:[]}};
  const editor=createDomainsCashEditor({model,armModalDraftGuard:()=>{},modal:(_t,_b,_s,onSave)=>{modalSave=onSave},deleteRecord:()=>{},saveState:msg=>{saved=msg},toast:msg=>{throw new Error(msg)},closeModal:()=>{}});
  editor.openRightModal();modalSave();
  assert.equal(model.state.cash.length,0);assert.equal(model.state.rights.length,1);assert.equal(model.state.rights[0].amount,75);assert.equal(saved,'תנועת הזכות נשמרה');
  const actions=createUiActions({ui:{},openCashModal:()=>cashOpened++,openRightModal:()=>rightOpened++});
  actions['open-cash-modal']({dataset:{}},{});actions['open-right-modal']({dataset:{}},{});
  assert.equal(cashOpened,1);assert.equal(rightOpened,1);
});
