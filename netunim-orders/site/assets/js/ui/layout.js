import {$} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiLayout({ui, supplierUi}){
function scrollViewportSnapshot(el){if(!el)return null;const maxTop=Math.max(0,el.scrollHeight-el.clientHeight);return{top:el.scrollTop,left:el.scrollLeft,atEnd:maxTop<=1||el.scrollTop>=maxTop-2}}

function storeScrollViewport(key,el){if(!key||!el)return;ui.scrollViewportMemory.set(key,scrollViewportSnapshot(el))}

function restoreScrollViewport(key,el,{fallback='start'}={}){if(!el)return;const saved=key?ui.scrollViewportMemory.get(key):null;requestAnimationFrame(()=>{if(saved){const maxTop=Math.max(0,el.scrollHeight-el.clientHeight);el.scrollTop=saved.atEnd?maxTop:Math.min(saved.top,maxTop);el.scrollLeft=saved.left}else if(fallback==='end')el.scrollTop=el.scrollHeight;if(key)storeScrollViewport(key,el)})}

function bindScrollViewport(key,el,{fallback='start'}={}){if(!el)return;el.addEventListener('scroll',()=>storeScrollViewport(key,el),{passive:true});restoreScrollViewport(key,el,{fallback})}

function mountViewLayout({sourceSelector='',headCount=1,className='',scrollKey=''}={}){
  const main=$('#main'),source=sourceSelector?main?.querySelector(sourceSelector):main;
  if(!main||!source)return;
  const nodes=[...source.children];
  if(!nodes.length)return;
  const shell=document.createElement('div'),head=document.createElement('div'),body=document.createElement('div');
  shell.className=`view-shell${className?` ${className}`:''}`;
  head.className='view-head';
  body.className='view-scroll';
  nodes.slice(0,headCount).forEach(node=>head.appendChild(node));
  nodes.slice(headCount).forEach(node=>body.appendChild(node));
  shell.append(head,body);
  main.replaceChildren(shell);
  if(!shell.classList.contains('supplier-view-shell'))delete main.dataset.supplierId;
  if(scrollKey)bindScrollViewport(scrollKey,body);
}

function captureSupplierViewport(){const main=$('#main'),wrap=main?.querySelector('.supplier-view-shell .supplier-table-panel .table-wrap'),supplierId=main?.dataset?.supplierId;if(!wrap||!supplierId)return null;const snap=scrollViewportSnapshot(wrap);return{supplierId,...snap,windowY:window.scrollY}}

function storeSupplierViewport(supplierId,wrap){if(!supplierId||!wrap)return;supplierUi.supplierViewportMemory.set(supplierId,{...scrollViewportSnapshot(wrap),windowY:window.scrollY})}

function restoreSupplierViewport(viewport,supplierId,scrollMode='auto'){const wrap=$('#main')?.querySelector('.table-wrap');if(!wrap)return;wrap.addEventListener('scroll',()=>storeSupplierViewport(supplierId,wrap),{passive:true});requestAnimationFrame(()=>{const same=viewport?.supplierId===supplierId,saved=same?viewport:supplierUi.supplierViewportMemory.get(supplierId),maxTop=Math.max(0,wrap.scrollHeight-wrap.clientHeight);if(scrollMode==='end')wrap.scrollTop=maxTop;else if(scrollMode==='start')wrap.scrollTop=0;else if(saved){wrap.scrollTop=saved.atEnd?maxTop:Math.min(saved.top,maxTop);wrap.scrollLeft=saved.left;if(Number.isFinite(saved.windowY))window.scrollTo({top:saved.windowY,left:window.scrollX,behavior:'auto'})}else wrap.scrollTop=maxTop;storeSupplierViewport(supplierId,wrap)})}

return { scrollViewportSnapshot, storeScrollViewport, restoreScrollViewport, bindScrollViewport, mountViewLayout, captureSupplierViewport, storeSupplierViewport, restoreSupplierViewport };
}
