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
          if(!element.matches(':disabled'))action(element,event);
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

// Popover-like <details> controls need menu semantics that native <details>
// intentionally does not provide: only one open menu, outside-click dismissal,
// Escape dismissal, and viewport-aware placement for an internally scrollable panel.
export function bindDismissibleDetails(root,{selector='details[data-dismiss-on-outside]'}={}){
  const openSelector=`${selector}[open]`;
  const closeOpen=keep=>{
    for(const details of root.querySelectorAll(openSelector))if(details!==keep)details.open=false;
  };
  const positionPopover=details=>{
    if(!details?.open)return;
    const summary=details.querySelector(':scope > summary'),popover=details.querySelector(':scope > .credit-cycle-menu-popover');
    if(!summary||!popover)return;
    const rect=summary.getBoundingClientRect(),viewportHeight=globalThis.visualViewport?.height||globalThis.innerHeight||document.documentElement.clientHeight||0,edgeGap=12;
    const below=Math.max(0,viewportHeight-rect.bottom-edgeGap),above=Math.max(0,rect.top-edgeGap),ideal=Math.min(Math.max(popover.scrollHeight||0,180),460),openUp=below<ideal&&above>below,available=Math.max(96,(openUp?above:below)-6);
    details.classList.toggle('credit-cycle-menu-up',openUp);
    details.style.setProperty('--credit-cycle-menu-max-height',`${Math.floor(available)}px`);
  };
  root.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    closeOpen(target?.closest(selector)||null);
  });
  root.addEventListener('toggle',event=>{
    const details=event.target instanceof Element&&event.target.matches(selector)?event.target:null;
    if(!details?.open)return;
    closeOpen(details);
    positionPopover(details);
  },true);
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape')closeOpen(null);
  });
}

