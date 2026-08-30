import {ALL_SUPPLIERS_ID, validSupplierYear} from './model.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsSuppliersNavigation({supplierUi, ui, supplierYearContext, renderSupplier, render}){
function setSupplierYearView(value){const ctx=supplierUi.currentSupplierId===ALL_SUPPLIERS_ID?null:supplierYearContext(supplierUi.currentSupplierId);supplierUi.supplierMoveTargetId=null;if(value==='all')supplierUi.supplierYearView='all';else{const year=value==='current'?null:validSupplierYear(value);supplierUi.supplierYearView=year!==null&&(ctx===null||ctx.years.includes(year))?String(year):'current'}supplierUi.supplierBulkSelected.clear();renderSupplier({scrollMode:'end'})}

function switchSupplier(id){if(!id||id===supplierUi.currentSupplierId)return;supplierUi.supplierMoveTargetId=null;supplierUi.supplierBulkSelected.clear();if(id===ALL_SUPPLIERS_ID)supplierUi.supplierBulkMode=false;supplierUi.currentSupplierId=id;ui.currentView='supplier';supplierUi.supplierYearView='current';supplierUi.searchText='';render({supplierScrollMode:'end'})}

function toggleSupplierMenu(event){if(event)event.stopPropagation();const menu=$('#supplierMenu');if(!menu)return;const open=!menu.classList.contains('open');closeSupplierMenu();if(open){menu.classList.add('open');$('#supplierMenuTrigger')?.setAttribute('aria-expanded','true')}}

function closeSupplierMenu(){const menu=$('#supplierMenu');if(!menu)return;menu.classList.remove('open');$('#supplierMenuTrigger')?.setAttribute('aria-expanded','false')}

function chooseSupplier(id){closeSupplierMenu();switchSupplier(id)}

function openSupplier(id){supplierUi.supplierMoveTargetId=null;supplierUi.supplierBulkSelected.clear();supplierUi.currentSupplierId=id;ui.currentView='supplier';supplierUi.supplierYearView='current';supplierUi.filterMode='all';supplierUi.searchText='';render({supplierScrollMode:'end'})}

return { setSupplierYearView, switchSupplier, toggleSupplierMenu, closeSupplierMenu, chooseSupplier, openSupplier };
}
