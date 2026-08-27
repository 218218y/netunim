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
