"""Shared popup behavior, exercised by runtime_events in the real app browser."""

POPUP_CASES = r"""
 const wait=()=>new Promise(r=>setTimeout(r,60));
 const assert=(value,message)=>{if(!value)throw new Error(message)};
 const visible=panel=>{
   assert(panel.matches(':popover-open'),'panel must use the native top layer');
   const r=panel.getBoundingClientRect();
   assert(r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,'panel must fit the viewport '+JSON.stringify(r.toJSON()));
   const hit=document.elementFromPoint(r.left+r.width/2,r.top+Math.min(15,r.height/2));
   assert(panel.contains(hit),'panel must be hit-testable above clipping containers');
 };
 const open=async host=>{host.querySelector('summary,[data-menu-trigger]').click();await wait();visible(host.querySelector('[data-menu-panel]'))};
 const fixture=document.createElement('div');fixture.id='popupFixture';
 fixture.style.cssText='position:fixed;left:10px;bottom:15px;width:220px;height:44px;overflow:hidden;transform:translateZ(0);z-index:100;direction:rtl';
 fixture.innerHTML='<details data-dismiss-on-outside><summary>First</summary><div data-menu-panel style="width:200px;height:260px;background:white"><button id="popupAction" data-action="close-modal">Action</button><input aria-label="filter"></div></details><details data-dismiss-on-outside><summary>Second</summary><div data-menu-panel style="width:200px;height:120px;background:white"><button>Second action</button></div></details>';
 document.body.append(fixture);
 const [first,second]=fixture.querySelectorAll('details');
 await open(first);const trigger=first.querySelector('summary');
 assert(first.querySelector('[data-menu-panel]').getBoundingClientRect().bottom<=trigger.getBoundingClientRect().top,'bottom-edge menu opens above');
 first.querySelector('input').click();await wait();assert(first.open,'form interaction keeps menu open');
 await open(second);assert(!first.open&&second.open,'only one popup may remain open');
 document.body.click();await wait();assert(!second.open,'outside click closes menu');
 await open(first);trigger.click();await wait();assert(!first.open,'same trigger closes its menu');
 await open(first);first.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait();
 assert(!first.open&&document.activeElement===trigger,'Escape closes and restores focus');
 await open(first);trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert(document.activeElement.id==='popupAction','keyboard enters actions');
 first.querySelector('button').click();await wait();assert(!first.open,'completed action closes menu');
 await open(first);fixture.remove();await wait();assert(!document.querySelector('[data-menu-panel]:popover-open'),'removed screen leaves no floating panel');
 const {creditHistoryMenuMarkup}=await import('./assets/js/shared/credit-detail-controls.js');
 const credit=document.createElement('div');credit.style.cssText='position:fixed;left:12px;bottom:20px;overflow:hidden;width:210px;height:44px;z-index:100';
 credit.innerHTML=creditHistoryMenuMarkup({months:Array.from({length:20},(_,n)=>({key:`2025-${String(n+1).padStart(2,'0')}`,total:100})),formatMoney:String,formatMonth:String,escapeHtml:String,monthAction:'close-modal',monthDayAction:'close-modal'});
 document.body.append(credit);const creditMenu=credit.querySelector('details');await open(creditMenu);
 const list=credit.querySelector('.credit-cycle-menu-list');assert(list.scrollHeight>list.clientHeight,'long credit menu has internal scrolling');
 list.scrollTop=80;await wait();assert(creditMenu.open,'scrolling inside the menu keeps it open');
 document.body.click();await wait();assert(!creditMenu.open,'credit menu outside dismissal');credit.remove();
 return {outside:true,single:true,escape:true,keyboard:true,topLayer:true,viewport:true,action:true,removed:true};
"""

WAREHOUSE_CASES = r"""
 const wait=()=>new Promise(r=>setTimeout(r,60));
 const assert=(value,message)=>{if(!value)throw new Error(message)};
 state.inventoryItems=Array.from({length:18},(_,i)=>({id:'MENU-'+i,name:'Item '+i,category:'Test',defaultLocation:'מחסן גדול'}));
 state.inventoryEvents=[{id:'MENU-ORDER',itemId:'MENU-0',type:'order',quantity:2,location:'מחסן גדול'},{id:'MENU-RESERVE',itemId:'MENU-0',type:'reserve',quantity:1,customerName:'Customer',location:'מחסן גדול'}];
 switchView('warehouse');await wait();
 const check=async host=>{
   const button=host.querySelector('summary');button.scrollIntoView({block:'center'});await wait();button.click();await wait();
   const panel=host.querySelector('[data-menu-panel]'),r=panel.getBoundingClientRect();
   assert(host.open&&panel.matches(':popover-open'),'real menu must open');
   assert(r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1,'real menu stays on screen');
   assert(panel.contains(document.elementFromPoint(r.left+r.width/2,r.top+12)),'real menu is not clipped by its panel/table');
   return panel;
 };
 let last=[...document.querySelectorAll('.inventory-table .warehouse-menu')].at(-1);
 let panel=await check(last);
 panel.querySelector('[data-action="open-inventory-item-modal"]').click();await wait();
 assert(document.querySelector('#invName').value==='Item 9','delegated action receives the row ID after floating');closeModal();
 for(const tab of ['attention','incoming','reservations','orders']){
   setWarehouseTab(tab);await wait();
   const menus=[...document.querySelectorAll('.warehouse-menu')];
   for(const menu of menus){await check(menu);document.body.click();await wait();assert(!menu.open,'outside dismissal works on '+tab)}
 }
 setWarehouseTab('stock');await wait();
 await check(document.querySelector('.warehouse-menu'));renderWarehouse();await wait();
 assert(!document.querySelector('[data-menu-panel]:popover-open'),'rerender closes old top layer');
 switchView('supplier');await wait();
 const supplier=document.querySelector('[data-floating-menu]'),supplierCommand=supplier.closest('.supplier-command'),supplierOptions=supplier.querySelector('#supplierMenuOptions');
 // Supplier filtering changes the rendered height of an already-open top-layer
 // menu. Force an upward placement with enough rows so a stale anchor is
 // deterministic: after filtering to one row, the popup must remain attached.
 for(let i=0;i<24;i++)supplierOptions.querySelector('[data-supplier-menu-empty]').insertAdjacentHTML('beforebegin',`<button type="button" class="supplier-menu-item" data-supplier-picker-option data-supplier-name="Resize Probe ${i}" data-action="choose-supplier" data-click-arg0="RESIZE-PROBE-${i}"><span>Resize Probe ${i}</span><span></span></button>`);
 Object.assign(supplierCommand.style,{position:'fixed',top:'auto',bottom:'10px',right:'10px',left:'auto',width:'340px'});
 supplier.querySelector('[data-menu-trigger]').click();await wait();
 const supplierPanel=supplier.querySelector('[data-menu-panel]');
 assert(supplierPanel.matches(':popover-open'),'supplier uses the same top layer');
 const supplierInput=supplier.querySelector('#supplierMenuSearch');supplierInput.value='Resize Probe 23';supplierInput.dispatchEvent(new Event('input',{bubbles:true}));await wait();await wait();
 const supplierTriggerRect=supplier.querySelector('[data-menu-trigger]').getBoundingClientRect(),supplierPanelRect=supplierPanel.getBoundingClientRect();
 // Repositioning may legitimately flip sides after filtering: a tall popup can
 // open upward, then the shortened result can fit below. Validate attachment to
 // either edge of the trigger rather than prescribing which side wins.
 const supplierAboveGap=supplierTriggerRect.top-supplierPanelRect.bottom,supplierBelowGap=supplierPanelRect.top-supplierTriggerRect.bottom,supplierAnchorGap=Math.max(supplierAboveGap,supplierBelowGap);
 assert(supplierAnchorGap>=-2&&supplierAnchorGap<=12,'supplier popup did not re-anchor after filtered content resized it: '+JSON.stringify({above:supplierAboveGap,below:supplierBelowGap,anchor:supplierAnchorGap}));
 const resizeProbe=supplier.querySelector('[data-supplier-name="Resize Probe 23"]'),resizeRect=resizeProbe.getBoundingClientRect(),resizeHit=document.elementFromPoint(resizeRect.left+resizeRect.width/2,resizeRect.top+resizeRect.height/2);
 assert(resizeProbe===resizeHit||resizeProbe.contains(resizeHit),'resized supplier option is not the pointer hit target');
 document.body.click();await wait();assert(!supplier.classList.contains('open'),'supplier outside closes through shared controller');
 return {warehouse:true,attention:true,reservations:true,orders:true,supplier:true,supplierResize:true,rerender:true};
"""

BANK_CASES = r"""
 const wait=()=>new Promise(r=>setTimeout(r,60));await wait();
 const menu=document.querySelector('.bank-date-filter');
 if(!menu)throw new Error('Bank date filter is missing');
 menu.querySelector('summary').scrollIntoView({block:'center'});await wait();menu.querySelector('summary').click();await wait();
 const panel=menu.querySelector('[data-menu-panel]');
 if(!panel.matches(':popover-open'))throw new Error('Bank date filter must use the shared top layer '+JSON.stringify({open:menu.open,connected:menu.isConnected,rect:menu.getBoundingClientRect().toJSON(),popup:panel.outerHTML.slice(0,150)}));
 const rect=panel.getBoundingClientRect();
 if(rect.top<0||rect.left<0||rect.right>innerWidth+1||rect.bottom>innerHeight+1)throw new Error('Bank date filter exceeds viewport');
 const input=panel.querySelector('input:not([type=hidden]):not([aria-hidden=true])');
 if(input){input.focus();input.click();await wait();if(!menu.open)throw new Error('Date editing unexpectedly closed menu')}
 document.body.click();await wait();if(menu.open)throw new Error('Bank date filter outside click failed');
 return true;
"""
