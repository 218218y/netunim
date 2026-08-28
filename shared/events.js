// Stable-container delegation; handlers receive the actual actionable element.
export function bindActionEvents(root,actions){
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
