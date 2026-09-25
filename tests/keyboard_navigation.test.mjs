import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiKeyboardNavigation,NAV_SHORTCUTS} from '../netunim-orders/site/assets/js/ui/keyboard-navigation.js';

class FakeElement{
  constructor({id='',view='',tag='button'}={}){this.id=id;this.dataset={};if(view)this.dataset.view=view;this.tagName=tag.toUpperCase();this.attrs=new Map();this.blurCount=0;this.classList={values:new Set(),toggle:(name,on)=>on?this.classList.values.add(name):this.classList.values.delete(name),contains:name=>this.classList.values.has(name)};}
  blur(){this.blurCount++}
  setAttribute(name,value){this.attrs.set(name,String(value))}
  closest(selector){if(selector.includes('input')&&['INPUT','TEXTAREA','SELECT'].includes(this.tagName))return this;return null}
}

function event(props={}){return {key:'',code:'',altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,repeat:false,target:null,prevented:false,preventDefault(){this.prevented=true},...props}}

function harness(){
  const listeners=new Map(),windowListeners=new Map(),root=new FakeElement({id:'root'}),nav=new FakeElement({id:'nav'});
  let overlay=false;
  const buttons=new Map(NAV_SHORTCUTS.map(([,number,view])=>[view,new FakeElement({view})]));
  nav.querySelectorAll=()=>[...buttons.values()];
  nav.querySelector=selector=>{const match=selector.match(/data-view="([^"]+)"/);return match?buttons.get(match[1])||null:null};
  const previous={document:globalThis.document,window:globalThis.window,Element:globalThis.Element};
  globalThis.Element=FakeElement;
  globalThis.document={
    hidden:false,
    activeElement:root,
    documentElement:root,
    getElementById:id=>id==='nav'?nav:null,
    querySelector:()=>overlay?root:null,
    addEventListener:(type,fn)=>listeners.set(type,fn),
  };
  globalThis.window={addEventListener:(type,fn)=>windowListeners.set(type,fn)};
  const views=[];
  const keyboard=createUiKeyboardNavigation({switchView:view=>views.push(view)});
  keyboard.bind();
  return {keyboard,views,buttons,nav,root,listeners,windowListeners,setOverlay:value=>{overlay=!!value},dispatch(type,e){listeners.get(type)?.(e)},restore(){globalThis.document=previous.document;globalThis.window=previous.window;globalThis.Element=previous.Element}};
}

test('primary tabs receive stable Alt+number metadata',()=>{
  const h=harness();
  try{
    NAV_SHORTCUTS.forEach(([,number,view])=>{
      const button=h.buttons.get(view);
      assert.equal(button.dataset.navKeytip,number);
      assert.equal(button.attrs.get('aria-keyshortcuts'),`Alt+${number}`);
    });
  }finally{h.restore()}
});

test('Alt+number navigates immediately without leaving KeyTips open',()=>{
  const h=harness();
  try{
    const altDown=event({key:'Alt',target:h.root});h.dispatch('keydown',altDown);
    const digit=event({key:'2',code:'Digit2',altKey:true,target:h.root});h.dispatch('keydown',digit);
    const altUp=event({key:'Alt',target:h.root});h.dispatch('keyup',altUp);
    assert.deepEqual(h.views,['customers']);
    assert.equal(digit.prevented,true);
    assert.equal(h.keyboard.isKeyTipsActive(),false);
  }finally{h.restore()}
});

test('Alt alone toggles KeyTips and a plain number activates the matching tab',()=>{
  const h=harness();
  try{
    h.dispatch('keydown',event({key:'Alt',target:h.root}));
    h.dispatch('keyup',event({key:'Alt',target:h.root}));
    assert.equal(h.keyboard.isKeyTipsActive(),true);
    assert.equal(h.nav.classList.contains('keytips-active'),true);
    const digit=event({key:'6',code:'Digit6',target:h.root});h.dispatch('keydown',digit);
    assert.deepEqual(h.views,['kupa']);
    assert.equal(digit.prevented,true);
    assert.equal(h.keyboard.isKeyTipsActive(),false);
  }finally{h.restore()}
});

test('a second standalone Alt closes KeyTips and pointer interaction closes it too',()=>{
  const h=harness();
  try{
    for(let i=0;i<2;i++){h.dispatch('keydown',event({key:'Alt',target:h.root}));h.dispatch('keyup',event({key:'Alt',target:h.root}))}
    assert.equal(h.keyboard.isKeyTipsActive(),false);
    h.keyboard.openKeyTips();
    h.dispatch('pointerdown',event({target:h.root}));
    assert.equal(h.keyboard.isKeyTipsActive(),false);
  }finally{h.restore()}
});

test('Word-like Alt mode works from an inline editor and commits it before navigation',()=>{
  const h=harness(),input=new FakeElement({tag:'input'});
  try{
    globalThis.document.activeElement=input;
    h.dispatch('keydown',event({key:'Alt',target:input}));
    h.dispatch('keyup',event({key:'Alt',target:input}));
    assert.equal(h.keyboard.isKeyTipsActive(),true);
    const digit=event({key:'3',code:'Digit3',target:input});h.dispatch('keydown',digit);
    assert.deepEqual(h.views,['customer-orders']);
    assert.equal(input.blurCount,1);
    assert.equal(digit.prevented,true);
    assert.equal(h.keyboard.isKeyTipsActive(),false);
  }finally{h.restore()}
});

test('direct Alt+number also commits an active inline editor before switching',()=>{
  const h=harness(),input=new FakeElement({tag:'input'});
  try{
    globalThis.document.activeElement=input;
    const digit=event({key:'7',code:'Digit7',altKey:true,target:input});h.dispatch('keydown',digit);
    assert.deepEqual(h.views,['notes']);
    assert.equal(input.blurCount,1);
    assert.equal(digit.prevented,true);
  }finally{h.restore()}
});

test('modal-like overlays block both direct shortcuts and KeyTips mode',()=>{
  const h=harness();
  try{
    h.setOverlay(true);
    const direct=event({key:'1',code:'Digit1',altKey:true,target:h.root});h.dispatch('keydown',direct);
    h.dispatch('keydown',event({key:'Alt',target:h.root}));
    h.dispatch('keyup',event({key:'Alt',target:h.root}));
    assert.deepEqual(h.views,[]);
    assert.equal(h.keyboard.isKeyTipsActive(),false);
    assert.equal(direct.prevented,false);
  }finally{h.restore()}
});
