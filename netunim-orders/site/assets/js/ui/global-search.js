import {esc} from '../core/values.js';
import {money} from '../core/money.js';
import {searchGlobalData} from '../domains/search/model.js';

// Global search is a UI coordinator: data matching stays in domains/search/model.js,
// while navigation reuses the existing view renderers and their native state.
export function createUiGlobalSearch({model,ui,supplierUi,customerUi,serviceUi,warehouseUi,prepareView,render,openInventoryItemModal}){
  let resultByKey=new Map(),highlightTimer=null,backdropPointerId=null;
  const byId=id=>document.getElementById(id);
  const refs=()=>({trigger:byId('globalSearchButton'),backdrop:byId('globalSearchBackdrop'),input:byId('globalSearchInput'),results:byId('globalSearchResults'),meta:byId('globalSearchMeta'),close:byId('globalSearchClose')});

  function scopeIntro(){return `<div class="global-search-empty"><div class="global-search-empty-icon">⌕</div><b>חיפוש בכל מאגר ניהול ההזמנות</b><p>אפשר לחפש שם ספק או לקוח, מספר הזמנה, טלפון, מספר צ'ק, סכום, הערה, מיקום, תוכן שירות ועוד.</p><div class="global-search-scopes"><span>ספקים</span><span>לקוחות</span><span>שירות</span><span>צ'קים</span><span>מחסן ומלאי</span><span>הערות</span></div></div>`}

  function resultMeta(item){const parts=[...(item.meta||[])];if(item.amount!==undefined&&item.amount!==null&&Number.isFinite(Number(item.amount)))parts.unshift(money(item.amount));return parts.filter(Boolean)}

  function renderResults(value=''){
    const {results,meta}=refs();if(!results||!meta)return;
    const raw=String(value||'').trim();resultByKey=new Map();
    if(!raw){meta.textContent='כל המאגרים במקום אחד';results.innerHTML=scopeIntro();return}
    const data=searchGlobalData(model.state,raw),visibleGroups=data.groups.filter(group=>group.total>0);meta.textContent=data.total?`${data.total} תוצאות בכל המאגרים`:'לא נמצאו תוצאות';
    if(!visibleGroups.length){results.innerHTML=`<div class="global-search-empty"><div class="global-search-empty-icon">∅</div><b>לא נמצאו תוצאות</b><p>החיפוש נבדק בכל ספקים, לקוחות, שירות, צ'קים, מחסן והערות.</p></div>`;return}
    results.innerHTML=visibleGroups.map(group=>{
      const rows=group.items.map((item,index)=>{const key=`${group.key}:${item.kind}:${item.id}:${index}`;resultByKey.set(key,item);const metaParts=resultMeta(item);return `<button class="global-search-result" type="button" data-global-result-key="${esc(key)}"><span class="global-search-result-main"><span class="global-search-result-kicker">${esc(item.context||group.label)} · ${esc(item.badge||group.label)}</span><b>${esc(item.title||'תוצאה')}</b>${item.subtitle?`<span class="global-search-result-subtitle">${esc(item.subtitle)}</span>`:''}</span>${metaParts.length?`<span class="global-search-result-meta">${metaParts.map(x=>`<em>${esc(x)}</em>`).join('')}</span>`:''}<span class="global-search-result-arrow" aria-hidden="true">←</span></button>`}).join('');
      const hidden=group.total-group.items.length;return `<section class="global-search-group"><header><b>${esc(group.label)}</b><span>${esc(group.total)}</span></header><div class="global-search-group-results">${rows}</div>${hidden>0?`<div class="global-search-more">יש עוד ${esc(hidden)} תוצאות בקבוצה — אפשר לצמצם את החיפוש.</div>`:''}</section>`
    }).join('')
  }

  function open(){const {backdrop,input,trigger}=refs();if(!backdrop)return;backdrop.hidden=false;backdrop.setAttribute('aria-hidden','false');trigger?.setAttribute('aria-expanded','true');renderResults(input?.value||'');requestAnimationFrame(()=>input?.focus())}
  function close({restoreFocus=true}={}){const {backdrop,trigger}=refs();if(!backdrop)return;backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true');trigger?.setAttribute('aria-expanded','false');if(restoreFocus)requestAnimationFrame(()=>trigger?.focus())}
  function toggle(){const {backdrop}=refs();if(!backdrop)return;backdrop.hidden?open():close()}

  function findDataElement(attribute,id){return [...document.querySelectorAll(`[${attribute}]`)].find(el=>el.getAttribute(attribute)===String(id))||null}
  function reveal(attribute,id){requestAnimationFrame(()=>{const target=findDataElement(attribute,id);if(!target)return;target.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});target.classList.add('global-search-target');if(highlightTimer)clearTimeout(highlightTimer);highlightTimer=setTimeout(()=>target.classList.remove('global-search-target'),2600)})}

  function navigateSupplier(item){prepareView('supplier');supplierUi.currentSupplierId=item.kind==='supplier'?item.id:item.parentId;supplierUi.filterMode='all';supplierUi.searchText='';supplierUi.supplierYearView=item.kind==='supplier-transaction'?'all':'current';render({supplierScrollMode:item.kind==='supplier-transaction'?'start':'end'});if(item.kind==='supplier-transaction')reveal('data-tx-id',item.id)}

  function navigateCustomer(item){prepareView('customers');customerUi.customerSearch='';customerUi.customerOrderFilter='all';if(item.kind==='customer-debt'){customerUi.customerTab='debts';const debt=model.state.customerDebts.find(x=>x.id===item.id);customerUi.customerFilter=debt?.paid&&debt?.invoiceIssued?'closed':'all'}else{customerUi.customerTab='orders';customerUi.customerFilter='all'}render();reveal('data-customer-bulk-id',item.id)}

  function navigateService(item){prepareView('service');serviceUi.serviceSearch='';const call=model.state.serviceCalls.find(x=>x.id===item.id);serviceUi.serviceFilter=call?.closed?'closed':'all';render();reveal('data-service-bulk-id',item.id)}

  function navigateCheck(item){prepareView('checks');ui.checkTab='all';ui.checkYear='all';ui.checkSearchValue='';render();reveal('data-check-id',item.id)}

  function navigateWarehouse(item){prepareView('warehouse');warehouseUi.warehouseSearch='';if(item.kind==='inventory-item'){const inventoryItem=model.state.inventoryItems.find(x=>x.id===item.id);if(inventoryItem?.active===false){warehouseUi.warehouseTab='history';render();openInventoryItemModal(item.id);return}warehouseUi.warehouseTab='stock';render();reveal('data-stock-bulk-id',item.id);return}if(item.kind==='warehouse-order'){warehouseUi.warehouseTab='orders';render();reveal('data-warehouse-order-id',item.id);return}warehouseUi.warehouseTab='history';render();reveal('data-inventory-event-id',item.id)}

  function navigateNote(item){prepareView('notes');render();reveal('data-note-id',item.id)}

  function navigateItem(item){if(!item)return false;if(item.group==='suppliers')navigateSupplier(item);else if(item.group==='customers')navigateCustomer(item);else if(item.group==='service')navigateService(item);else if(item.group==='checks')navigateCheck(item);else if(item.group==='warehouse')navigateWarehouse(item);else if(item.group==='notes')navigateNote(item);else return false;return true}
  function openResult(key){const item=resultByKey.get(key);if(!item)return;close({restoreFocus:false});navigateItem(item)}

  function bind(){
    const {trigger,backdrop,input,results,close:closeButton}=refs();if(!trigger||!backdrop||!input||!results||!closeButton)return;
    trigger.addEventListener('click',toggle);closeButton.addEventListener('click',close);input.addEventListener('input',()=>renderResults(input.value));
    input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){const first=results.querySelector('.global-search-result');if(first){event.preventDefault();first.focus()}}});
    results.addEventListener('keydown',event=>{if(!event.target.matches('.global-search-result'))return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){const buttons=[...results.querySelectorAll('.global-search-result')],index=buttons.indexOf(event.target),next=event.key==='ArrowDown'?Math.min(buttons.length-1,index+1):Math.max(0,index-1);event.preventDefault();buttons[next]?.focus()}else if(event.key==='Escape')close()});
    results.addEventListener('click',event=>{const button=event.target.closest('[data-global-result-key]');if(button)openResult(button.dataset.globalResultKey)});
    backdrop.addEventListener('pointerdown',event=>{backdropPointerId=event.target===backdrop?event.pointerId:null});backdrop.addEventListener('pointerup',event=>{const dismiss=backdropPointerId===event.pointerId&&event.target===backdrop;backdropPointerId=null;if(dismiss)close()});backdrop.addEventListener('pointercancel',()=>{backdropPointerId=null});
    document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();open();return}if(event.key==='Escape'&&!backdrop.hidden)close()});
  }

  return{bind,open,close,toggle,renderResults,openResult,navigateItem}
}
