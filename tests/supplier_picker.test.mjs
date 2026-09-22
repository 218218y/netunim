import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsSuppliersNavigation} from '../netunim-orders/site/assets/js/domains/suppliers/navigation.js';

class FakeClassList{
  constructor(...names){this.names=new Set(names.filter(Boolean))}
  contains(name){return this.names.has(name)}
  add(name){this.names.add(name)}
  remove(name){this.names.delete(name)}
  toggle(name,force){if(force===undefined)force=!this.names.has(name);force?this.names.add(name):this.names.delete(name);return force}
}

function option(id,name,arg,{all=false}={}){
  return {
    id,hidden:false,dataset:{supplierName:name,clickArg0:arg},classList:new FakeClassList('supplier-menu-item'),
    hasAttribute(attr){return all&&attr==='data-supplier-menu-all'},
    scrollIntoView(){this.scrolled=true}
  };
}

function harness(){
  const all=option('supplierMenuOptionAll','', '__all_suppliers__',{all:true});
  const first=option('supplierMenuOption0','שלמה אסייג','S1');
  const second=option('supplierMenuOption1','שמואל אסייג','S2');
  const other=option('supplierMenuOption2','משה כהן','S3');
  const options=[all,first,second,other],empty={hidden:true},attrs=new Map();let focused=false;
  const trigger={setAttribute:(key,value)=>attrs.set(key,value)};
  const menu={
    classList:new FakeClassList(),
    querySelectorAll(selector){return selector==='[data-supplier-picker-option]'?options:[]},
    querySelector(selector){
      if(selector==='#supplierMenuSearch')return input;
      if(selector==='[data-supplier-menu-empty]')return empty;
      if(selector==='.supplier-menu-item.keyboard-active:not([hidden])')return options.find(row=>!row.hidden&&row.classList.contains('keyboard-active'))||null;
      return null;
    }
  };
  const input={
    value:'stale',isConnected:true,attributes:new Map(),
    closest(selector){return selector==='#supplierMenu'?menu:null},
    setAttribute(key,value){this.attributes.set(key,value)},removeAttribute(key){this.attributes.delete(key)},
    focus(){focused=true}
  };
  globalThis.document={querySelector(selector){if(selector==='#supplierMenu')return menu;if(selector==='#supplierMenuTrigger')return trigger;return null}};
  const supplierUi={currentSupplierId:'S3',supplierMoveTargetId:null,supplierBulkSelected:new Set(),supplierBulkAnchorId:null,supplierBulkMode:false,supplierYearView:'current',searchText:''};
  const renders=[];
  const navigation=createDomainsSuppliersNavigation({supplierUi,ui:{currentView:'supplier'},supplierYearContext:()=>({years:[]}),renderSupplier:()=>{},render:options=>renders.push(options)});
  return {navigation,supplierUi,renders,menu,input,options,all,first,second,other,empty,attrs,focused:()=>focused};
}

function key(name){return {key:name,isComposing:false,preventDefault(){this.defaultPrevented=true}}}

test('supplier picker focuses search, filters names and Enter opens the unique result',async()=>{
  const h=harness();h.navigation.toggleSupplierMenu({stopPropagation(){}});await Promise.resolve();
  assert.equal(h.menu.classList.contains('open'),true);assert.equal(h.input.value,'');assert.equal(h.focused(),true);assert.equal(h.attrs.get('aria-expanded'),'true');
  const visible=h.navigation.filterSupplierMenu('שלמה');
  assert.deepEqual(visible,[h.first]);assert.equal(h.all.hidden,true);assert.equal(h.second.hidden,true);assert.equal(h.other.hidden,true);assert.equal(h.empty.hidden,true);
  assert.equal(h.first.classList.contains('keyboard-active'),true);assert.equal(h.input.attributes.get('aria-activedescendant'),h.first.id);
  const enter=key('Enter');h.navigation.supplierMenuSearchKeydown(enter,h.input);
  assert.equal(enter.defaultPrevented,true);assert.equal(h.supplierUi.currentSupplierId,'S1');assert.deepEqual(h.renders,[{supplierScrollMode:'end'}]);
});

test('supplier picker arrows move among filtered matches while the search input keeps ownership',()=>{
  const h=harness(),visible=h.navigation.filterSupplierMenu('אסייג');
  assert.deepEqual(visible,[h.first,h.second]);assert.equal(h.all.hidden,true);assert.equal(h.other.hidden,true);assert.equal(h.empty.hidden,true);
  const down1=key('ArrowDown');h.navigation.supplierMenuSearchKeydown(down1,h.input);assert.equal(h.first.classList.contains('keyboard-active'),true);assert.equal(h.input.attributes.get('aria-activedescendant'),h.first.id);
  const down2=key('ArrowDown');h.navigation.supplierMenuSearchKeydown(down2,h.input);assert.equal(h.second.classList.contains('keyboard-active'),true);assert.equal(h.input.attributes.get('aria-activedescendant'),h.second.id);
  const up=key('ArrowUp');h.navigation.supplierMenuSearchKeydown(up,h.input);assert.equal(h.first.classList.contains('keyboard-active'),true);
  h.navigation.filterSupplierMenu('לא קיים');assert.equal(h.empty.hidden,false);assert.equal(h.options.every(row=>row.hidden),true);assert.equal(h.input.attributes.has('aria-activedescendant'),false);
});
