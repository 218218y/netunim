import {ALL_SUPPLIERS_ID, validSupplierYear} from './model.js';
import {$} from '../../state/constants.js';
import {searchMatch} from '../../core/search.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsSuppliersNavigation({supplierUi, ui, supplierYearContext, renderSupplier, render}){
function setSupplierYearView(value){const ctx=supplierUi.currentSupplierId===ALL_SUPPLIERS_ID?null:supplierYearContext(supplierUi.currentSupplierId);supplierUi.supplierMoveTargetId=null;if(value==='all')supplierUi.supplierYearView='all';else{const year=value==='current'?null:validSupplierYear(value);supplierUi.supplierYearView=year!==null&&(ctx===null||ctx.years.includes(year))?String(year):'current'}supplierUi.supplierBulkSelected.clear();supplierUi.supplierBulkAnchorId=null;renderSupplier({scrollMode:'end'})}

function switchSupplier(id){if(!id||id===supplierUi.currentSupplierId)return;supplierUi.supplierMoveTargetId=null;supplierUi.supplierBulkSelected.clear();supplierUi.supplierBulkAnchorId=null;if(id===ALL_SUPPLIERS_ID)supplierUi.supplierBulkMode=false;supplierUi.currentSupplierId=id;ui.currentView='supplier';supplierUi.supplierYearView='current';supplierUi.searchText='';render({supplierScrollMode:'end'})}

function supplierMenuOptions(menu=$('#supplierMenu')){return menu?[...menu.querySelectorAll('[data-supplier-picker-option]')]:[]}

function setSupplierMenuActive(menu,item=null){
  for(const option of supplierMenuOptions(menu))option.classList.toggle('keyboard-active',option===item);
  const input=menu?.querySelector('#supplierMenuSearch');
  if(input){if(item?.id)input.setAttribute('aria-activedescendant',item.id);else input.removeAttribute('aria-activedescendant')}
  if(item)item.scrollIntoView({block:'nearest'});
}

function filterSupplierMenu(value){
  const menu=$('#supplierMenu');if(!menu)return[];
  const query=String(value??'').trim(),options=supplierMenuOptions(menu);
  for(const option of options){
    const isAll=option.hasAttribute('data-supplier-menu-all');
    option.hidden=!!query&&(isAll||!searchMatch(query,[option.dataset.supplierName||'']));
  }
  const visible=options.filter(option=>!option.hidden),empty=menu.querySelector('[data-supplier-menu-empty]');
  if(empty)empty.hidden=visible.length>0;
  setSupplierMenuActive(menu,visible.length===1?visible[0]:null);
  return visible;
}

function supplierMenuSearchKeydown(event,input){
  if(event?.isComposing)return;
  const menu=input?.closest('#supplierMenu');if(!menu)return;
  const visible=supplierMenuOptions(menu).filter(option=>!option.hidden);
  if(event.key==='Enter'){
    const active=menu.querySelector('.supplier-menu-item.keyboard-active:not([hidden])'),choice=active||(visible.length===1?visible[0]:null);
    if(choice){event.preventDefault();chooseSupplier(choice.dataset.clickArg0)}
    return;
  }
  if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
  if(!visible.length)return;
  event.preventDefault();
  const current=visible.indexOf(menu.querySelector('.supplier-menu-item.keyboard-active:not([hidden])'));
  const next=current<0?(event.key==='ArrowDown'?0:visible.length-1):(event.key==='ArrowDown'?(current+1)%visible.length:(current-1+visible.length)%visible.length);
  setSupplierMenuActive(menu,visible[next]);
}

function toggleSupplierMenu(event){
  if(event)event.stopPropagation();const menu=$('#supplierMenu');if(!menu)return;const open=!menu.classList.contains('open');closeSupplierMenu();
  if(open){
    menu.classList.add('open');$('#supplierMenuTrigger')?.setAttribute('aria-expanded','true');
    const input=menu.querySelector('#supplierMenuSearch');if(input){input.value='';filterSupplierMenu('');queueMicrotask(()=>input.isConnected&&input.focus({preventScroll:true}))}
  }
}

function closeSupplierMenu(){const menu=$('#supplierMenu');if(!menu)return;setSupplierMenuActive(menu,null);menu.classList.remove('open');$('#supplierMenuTrigger')?.setAttribute('aria-expanded','false')}

function chooseSupplier(id){closeSupplierMenu();switchSupplier(id)}

function openSupplier(id){supplierUi.supplierMoveTargetId=null;supplierUi.supplierBulkSelected.clear();supplierUi.supplierBulkAnchorId=null;supplierUi.currentSupplierId=id;ui.currentView='supplier';supplierUi.supplierYearView='current';supplierUi.filterMode='all';supplierUi.searchText='';render({supplierScrollMode:'end'})}

return { setSupplierYearView, switchSupplier, toggleSupplierMenu, closeSupplierMenu, filterSupplierMenu, supplierMenuSearchKeydown, chooseSupplier, openSupplier };
}
