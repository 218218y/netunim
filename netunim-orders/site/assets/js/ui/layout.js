import {$} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiLayout({ui, supplierUi}){
const pendingViewportRestores=new Map(),pendingSupplierRestores=new Map();
let restoreToken=0;
function nextRestoreToken(){restoreToken+=1;return restoreToken}
function connected(el){return !!el&&(!('isConnected' in el)||el.isConnected!==false)}
function copyViewport(viewport){return viewport?{top:Number(viewport.top)||0,left:Number(viewport.left)||0,atEnd:viewport.atEnd===true}:null}

function scrollViewportSnapshot(el){if(!el)return null;const maxTop=Math.max(0,el.scrollHeight-el.clientHeight);return{top:el.scrollTop,left:el.scrollLeft,atEnd:maxTop>1&&el.scrollTop>=maxTop-2}}

function storeScrollViewport(key,el){if(!key||!el)return;ui.scrollViewportMemory.set(key,scrollViewportSnapshot(el))}

function viewportRestoreIntent(key,{fallback='start',resetTop=false}={}){
  if(resetTop)return{kind:fallback==='end'?'end':'start'};
  const pending=key?pendingViewportRestores.get(key):null;
  if(pending)return pending.intent;
  const saved=key?ui.scrollViewportMemory.get(key):null;
  if(saved)return{kind:'saved',viewport:copyViewport(saved)};
  return{kind:fallback==='end'?'end':'start'};
}

function restoreScrollViewport(key,el,{fallback='start',resetTop=false}={}){
  if(!el)return;
  const intent=viewportRestoreIntent(key,{fallback,resetTop}),token=nextRestoreToken();
  if(key)pendingViewportRestores.set(key,{token,el,intent});
  requestAnimationFrame(()=>{
    if(key){const pending=pendingViewportRestores.get(key);if(!pending||pending.token!==token||pending.el!==el)return}
    if(!connected(el)){if(key)pendingViewportRestores.delete(key);return}
    if(key)pendingViewportRestores.delete(key);
    const maxTop=Math.max(0,el.scrollHeight-el.clientHeight);
    if(intent.kind==='end')el.scrollTop=maxTop;
    else if(intent.kind==='start')el.scrollTop=0;
    else if(intent.viewport){el.scrollTop=intent.viewport.atEnd?maxTop:Math.min(intent.viewport.top,maxTop);el.scrollLeft=intent.viewport.left}
    if(key){const snapshot=scrollViewportSnapshot(el);if(intent.kind==='end'&&maxTop<=1)snapshot.atEnd=true;ui.scrollViewportMemory.set(key,snapshot)}
  })
}

function bindScrollViewport(key,el,{fallback='start',resetTop=false}={}){
  if(!el)return;
  el.addEventListener('scroll',()=>{const pending=key?pendingViewportRestores.get(key):null;if(pending?.el===el)pendingViewportRestores.delete(key);storeScrollViewport(key,el)},{passive:true});
  restoreScrollViewport(key,el,{fallback,resetTop})
}

function mountViewLayout({sourceSelector='',headCount=1,className='',scrollKey='',resetTop=false}={}){
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
  if(scrollKey)bindScrollViewport(scrollKey,body,{resetTop});
}

function pendingSupplierViewport(supplierId,wrap){
  const pending=supplierId?pendingSupplierRestores.get(supplierId):null;
  if(!pending||pending.el!==wrap)return null;
  if(pending.mode==='end'||pending.mode==='start')return{supplierId,top:pending.mode==='start'?0:Number(pending.saved?.top)||0,left:Number(pending.saved?.left)||0,atEnd:false,windowY:Number.isFinite(pending.saved?.windowY)?pending.saved.windowY:window.scrollY,pendingScrollMode:pending.mode};
  if(pending.saved)return{supplierId,...pending.saved};
  return null;
}

function captureSupplierViewport(){const main=$('#main'),wrap=main?.querySelector('.supplier-view-shell .supplier-table-panel .table-wrap'),supplierId=main?.dataset?.supplierId;if(!wrap||!supplierId)return null;const pending=pendingSupplierViewport(supplierId,wrap);if(pending)return pending;const snap=scrollViewportSnapshot(wrap);return{supplierId,...snap,windowY:window.scrollY}}

function storeSupplierViewport(supplierId,wrap){if(!supplierId||!wrap)return;supplierUi.supplierViewportMemory.set(supplierId,{...scrollViewportSnapshot(wrap),windowY:window.scrollY})}

function supplierTransactionsEndTop(wrap){
  if(!wrap)return 0;
  const maxTop=Math.max(0,wrap.scrollHeight-wrap.clientHeight),summary=wrap.querySelector(':scope > .supplier-bottom-summary');
  if(!summary)return maxTop;
  const style=getComputedStyle(summary),marginTop=Number.parseFloat(style.marginTop)||0,marginBottom=Number.parseFloat(style.marginBottom)||0;
  const summaryTail=Math.max(0,summary.offsetHeight+marginTop+marginBottom),afterLastRow=24;
  return Math.max(0,maxTop-Math.max(0,summaryTail-afterLastRow));
}

function scrollSupplierTransactionsEnd(wrap){if(wrap)wrap.scrollTop=supplierTransactionsEndTop(wrap)}

function supplierRestorePlan(viewport,supplierId,scrollMode){
  const same=viewport?.supplierId===supplierId,saved=same?viewport:supplierUi.supplierViewportMemory.get(supplierId);
  const propagated=same&&(viewport?.pendingScrollMode==='end'||viewport?.pendingScrollMode==='start')?viewport.pendingScrollMode:null;
  const mode=scrollMode==='end'||scrollMode==='start'?scrollMode:propagated||'auto';
  return{mode,saved:saved?{top:Number(saved.top)||0,left:Number(saved.left)||0,atEnd:saved.atEnd===true,windowY:Number.isFinite(saved.windowY)?saved.windowY:window.scrollY}:null};
}

function restoreSupplierViewport(viewport,supplierId,scrollMode='auto'){
  const wrap=$('#main')?.querySelector('.table-wrap');if(!wrap)return;
  const plan=supplierRestorePlan(viewport,supplierId,scrollMode),token=nextRestoreToken();
  pendingSupplierRestores.set(supplierId,{token,el:wrap,...plan});
  wrap.addEventListener('scroll',()=>{const pending=pendingSupplierRestores.get(supplierId);if(pending?.el===wrap)pendingSupplierRestores.delete(supplierId);storeSupplierViewport(supplierId,wrap)},{passive:true});
  requestAnimationFrame(()=>{
    const pending=pendingSupplierRestores.get(supplierId);if(!pending||pending.token!==token||pending.el!==wrap||!connected(wrap))return;
    pendingSupplierRestores.delete(supplierId);
    const maxTop=Math.max(0,wrap.scrollHeight-wrap.clientHeight);
    if(plan.mode==='end')scrollSupplierTransactionsEnd(wrap);
    else if(plan.mode==='start')wrap.scrollTop=0;
    else if(plan.saved){wrap.scrollTop=plan.saved.atEnd?maxTop:Math.min(plan.saved.top,maxTop);wrap.scrollLeft=plan.saved.left;if(Number.isFinite(plan.saved.windowY))window.scrollTo({top:plan.saved.windowY,left:window.scrollX,behavior:'auto'})}
    else scrollSupplierTransactionsEnd(wrap);
    storeSupplierViewport(supplierId,wrap)
  })
}

return { scrollViewportSnapshot, storeScrollViewport, restoreScrollViewport, bindScrollViewport, mountViewLayout, captureSupplierViewport, storeSupplierViewport, supplierTransactionsEndTop, scrollSupplierTransactionsEnd, restoreSupplierViewport };
}
