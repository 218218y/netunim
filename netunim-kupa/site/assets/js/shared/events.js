import {beginMeasure} from './runtime-performance.js';
// Stable-container delegation; handlers receive the actual actionable element.
export function bindActionEvents(root,actions,{canRun=()=>true}={}){
  const types=['click','change','input','keydown','focus','blur','dragstart','dragover','drop','dragend'];
  for(const type of types){
    root.addEventListener(type,event=>{
      const path=event.composedPath();
      for(const element of path){
        if(element===root)break;
        if(!(element instanceof Element))continue;
        if((type==='focus'||type==='blur')&&element!==event.target)continue;
        const name=element.getAttribute(type==='click'?'data-action':'data-'+type);
        if(name){
          if(!canRun(name,element,event)){event.preventDefault();event.stopPropagation();return}
          const action=actions[name];
          if(typeof action!=='function')throw new Error('Unknown UI action: '+name);
          if(!element.matches(':disabled')){const done=beginMeasure(`action:${name}`,{paint:true});try{action(element,event)}finally{done()}}
        }
        if(event.cancelBubble)break;
      }
    },type==='focus'||type==='blur');
  }
}

// A backdrop dismissal is a pointer gesture that both starts and ends on the
// backdrop itself. Tracking the pointer origin prevents a text-selection drag
// that begins inside a modal and is released outside from being mistaken for
// an outside click.
export function bindBackdropDismissal(backdrop,onDismiss){
  let backdropPointerId=null;
  backdrop.addEventListener('pointerdown',event=>{
    backdropPointerId=event.target===backdrop?event.pointerId:null;
  });
  backdrop.addEventListener('pointerup',event=>{
    const shouldDismiss=backdropPointerId===event.pointerId&&event.target===backdrop;
    backdropPointerId=null;
    if(shouldDismiss)onDismiss(event);
  });
  backdrop.addEventListener('pointercancel',event=>{
    if(backdropPointerId===event.pointerId)backdropPointerId=null;
  });
}

// Popup menus opt in with data-dismiss-on-outside (details) or data-floating-menu
// (a host whose open state is the .open class). The panel stays in its DOM parent:
// native top-layer rendering escapes clipping without breaking delegated actions,
// form lookups, inherited RTL styling, or modal ownership. Disclosure sections do
// not opt in. New menus need markup only, never component-specific event handlers.
export function floatingMenuPosition(anchor,size,viewport,{rtl=false,gap=6,edge=8}={}){
  const left=viewport.left+edge,right=viewport.left+viewport.width-edge;
  const top=viewport.top+edge,bottom=viewport.top+viewport.height-edge;
  const below=Math.max(0,bottom-anchor.bottom-gap),above=Math.max(0,anchor.top-top-gap);
  const up=size.height>below&&above>below,height=Math.min(size.height,up?above:below);
  const width=Math.min(size.width,Math.max(0,right-left));
  return {left:Math.max(left,Math.min(rtl?anchor.right-width:anchor.left,right-width)),top:up?Math.max(top,anchor.top-gap-height):Math.max(top,Math.min(anchor.bottom+gap,bottom-height)),maxHeight:Math.max(0,up?above:below),width,up};
}

export function floatingMenuWidth(rectWidth,cssWidth,scrollWidth,fallback=180){
  const authoredWidth=Number.parseFloat(cssWidth);
  return rectWidth||(Number.isFinite(authoredWidth)&&authoredWidth>0?authoredWidth:0)||scrollWidth||fallback;
}

const numberWheelBindings=new WeakSet();
export function bindNumberInputWheelGuard(root){
  if(numberWheelBindings.has(root))return;
  numberWheelBindings.add(root);
  const doc=root.ownerDocument||root;
  root.addEventListener('wheel',event=>{
    const input=event.target instanceof HTMLInputElement?event.target:null;
    if(input?.type==='number'&&doc.activeElement===input)input.blur();
  },{capture:true,passive:true});
}

const menuBindings=new WeakMap();
export function bindDismissibleDetails(root,{selector='details[data-dismiss-on-outside], [data-floating-menu]'}={}){
  if(menuBindings.has(root))return menuBindings.get(root);
  const doc=root.ownerDocument||root,win=doc.defaultView;
  let active=null,frame=0,popupResizeObserver=null;
  const isOpen=host=>host.tagName==='DETAILS'?host.open:host.classList.contains('open');
  const trigger=host=>host.querySelector(':scope > summary, :scope > [data-menu-trigger]');
  const panel=host=>host.querySelector(':scope > [data-menu-panel]');
  const setOpen=(host,open)=>{if(host.tagName==='DETAILS')host.open=open;else host.classList.toggle('open',open);trigger(host)?.setAttribute('aria-expanded',String(open))};
  const close=(restoreFocus=false)=>{
    const current=active;if(!current)return;active=null;
    popupResizeObserver?.unobserve(current.panel);
    if(current.panel.matches(':popover-open'))current.panel.hidePopover();
    if(current.style===null)current.panel.removeAttribute('style');else current.panel.setAttribute('style',current.style);
    if(current.popover===null)current.panel.removeAttribute('popover');else current.panel.setAttribute('popover',current.popover);
    setOpen(current.host,false);
    if(restoreFocus&&current.trigger.isConnected)current.trigger.focus({preventScroll:true});
  };
  const viewport=()=>({left:win.visualViewport?.offsetLeft||0,top:win.visualViewport?.offsetTop||0,width:win.visualViewport?.width||win.innerWidth,height:win.visualViewport?.height||win.innerHeight});
  const position=()=>{
    if(!active)return;
    const {host,panel:popup,trigger:button}=active;
    if(!host.isConnected||!isOpen(host)){close();return}
    const rect=button.getBoundingClientRect(),view=viewport();
    // A scrolled-out trigger must not leave a detached-looking floating menu.
    let visible={left:view.left,top:view.top,right:view.left+view.width,bottom:view.top+view.height};
    for(let parent=host.parentElement;parent;parent=parent.parentElement){
      const css=win.getComputedStyle(parent),box=parent.getBoundingClientRect();
      if(/auto|scroll|hidden|clip/.test(css.overflowY)){visible.top=Math.max(visible.top,box.top);visible.bottom=Math.min(visible.bottom,box.bottom)}
      if(/auto|scroll|hidden|clip/.test(css.overflowX)){visible.left=Math.max(visible.left,box.left);visible.right=Math.min(visible.right,box.right)}
    }
    if(rect.bottom<=visible.top||rect.top>=visible.bottom||rect.right<=visible.left||rect.left>=visible.right){close();return}
    const size={width:active.width,height:Math.max(popup.scrollHeight,popup.getBoundingClientRect().height)};
    const place=floatingMenuPosition(rect,size,view,{rtl:win.getComputedStyle(host).direction==='rtl'});
    for(const [key,value] of Object.entries({left:`${place.left}px`,top:`${place.top}px`,width:`${place.width}px`,'max-height':`${place.maxHeight}px`}))popup.style.setProperty(key,value,'important');
  };
  const schedulePosition=()=>{if(active&&!frame)frame=win.requestAnimationFrame(()=>{frame=0;position()})};
  // Dynamic menus can change their own size while open (for example, a filtered
  // supplier picker). A top-layer popover keeps the fixed coordinates we assigned
  // at open time, so a size change must be followed by a fresh anchor calculation.
  // Observe the rendered popup box instead of coupling components to positioning.
  popupResizeObserver=typeof win.ResizeObserver==='function'?new win.ResizeObserver(entries=>{
    if(active&&entries.some(entry=>entry.target===active.panel))schedulePosition();
  }):null;
  const open=host=>{
    if(active?.host===host){position();return}
    close();
    for(const other of root.querySelectorAll(selector))if(other!==host&&isOpen(other))setOpen(other,false);
    const popup=panel(host),button=trigger(host);if(!popup||!button)return;
    setOpen(host,true);
    active={host,panel:popup,trigger:button,style:popup.getAttribute('style'),popover:popup.getAttribute('popover'),width:0};
    // Read the designed width before replacing its layout context with the top layer.
    // A <details> panel can report zero geometry for one turn after it was closed
    // programmatically (outside-dismissal), even though its authored CSS width is
    // already resolved. Falling straight to 180px makes the next opening depend on
    // how the previous opening was closed. Preserve the CSS design as the stable
    // fallback; content width remains the fallback for genuinely auto-sized menus.
    active.width=floatingMenuWidth(popup.getBoundingClientRect().width,win.getComputedStyle(popup).width,popup.scrollWidth);
    popup.setAttribute('popover','manual');
    for(const [key,value] of Object.entries({position:'fixed',inset:'auto',margin:'0',transform:'none',visibility:'visible',opacity:'1','pointer-events':'auto','box-sizing':'border-box','min-width':'0','max-width':`${Math.max(0,viewport().width-16)}px`,'overflow-y':'auto','overscroll-behavior':'contain'}))popup.style.setProperty(key,value,'important');
    popup.showPopover();position();popupResizeObserver?.observe(popup);
  };
  const outside=event=>{if(active&&!active.host.contains(event.target))close()};
  root.addEventListener('pointerdown',outside,true);
  root.addEventListener('focusin',outside);
  root.addEventListener('click',event=>{
    outside(event);
    const target=event.target instanceof Element?event.target:null,host=target?.closest(selector);
    // Runs after native summary toggling and application actions, including ones
    // that stop propagation or replace the current screen/modal.
    queueMicrotask(()=>{
      if(host?.isConnected&&isOpen(host))open(host);
      if(active&&!active.host.isConnected)close();
      if(active&&target?.closest('button[data-action],a[href]')&&!target.closest('[data-menu-keep-open]')&&panel(active.host)?.contains(target))close();
    });
  },true);
  root.addEventListener('toggle',event=>{
    const host=event.target instanceof Element&&event.target.matches(selector)?event.target:null;
    if(!host)return;
    if(isOpen(host))open(host);else if(active?.host===host)close();
  },true);
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&active){event.preventDefault();event.stopPropagation();close(true);return}
    if(!active||!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||event.target.matches('input,textarea,select'))return;
    if(!active.host.contains(event.target))return;
    const buttons=[...active.panel.querySelectorAll('button:not(:disabled),a[href]')].filter(el=>el.getClientRects().length);
    if(!buttons.length)return;
    const current=buttons.indexOf(doc.activeElement),index=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?(current+1)%buttons.length:(current-1+buttons.length)%buttons.length;
    event.preventDefault();buttons[index].focus();
  },true);
  root.addEventListener('scroll',event=>{if(active&&!active.panel.contains(event.target))schedulePosition()},true);
  win.addEventListener('resize',schedulePosition);
  win.visualViewport?.addEventListener('resize',schedulePosition);
  win.visualViewport?.addEventListener('scroll',schedulePosition);
  const observer=new MutationObserver(records=>{
    if(active&&(!active.host.isConnected||!isOpen(active.host)))close();
    for(const record of records)if(record.type==='attributes'&&record.target.matches(selector)&&isOpen(record.target))open(record.target);
  });
  observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['open','class']});
  const binding={close};menuBindings.set(root,binding);return binding;
}
