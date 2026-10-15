// @ts-check
/**
 * @typedef {'open'|'toggle'|'renderResults'|'openResult'|'setMode'|'setFilter'} Command
 * @typedef {Record<Command,(...args:unknown[])=>unknown> & {bind:()=>unknown,close:(options?:{restoreFocus?:boolean})=>unknown,dispose:()=>boolean}} Search
 * @typedef {{open:()=>unknown,toggle:()=>unknown,close:()=>unknown}} Controls
 * @typedef {{bind:(controls:Controls)=>()=>void,showLoading:()=>void,busy:(value:boolean)=>void,hide:(restoreFocus?:boolean)=>void,invalidate:()=>void,showError:(error:unknown)=>void}} SearchPlatform
 * @typedef {{load:()=>Promise<()=>Search>,navigateItem:(item:unknown)=>unknown,subscribeAuthorization?:(changed:()=>void)=>(()=>void)|null,platform?:SearchPlatform}} LazySearchOptions
 */

/** @returns {SearchPlatform} */
function browserPlatform(){
  /** @param {string} id */
  const element=id=>document.getElementById(id);
  /** @param {boolean} [restoreFocus] */
  const hide=(restoreFocus=false)=>{
    const backdrop=element('globalSearchBackdrop');if(backdrop){backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true')}
    element('globalSearchButton')?.setAttribute('aria-expanded','false');
    if(restoreFocus)element('globalSearchButton')?.focus();
  };
  return {
    bind(controls){
      /** @type {Array<()=>void>} */ const cleanup=[];
      /** @param {EventTarget|null} target @param {string} name @param {(event:Event)=>void} handler */
      const listen=(target,name,handler)=>{target?.addEventListener(name,handler);cleanup.push(()=>target?.removeEventListener(name,handler))};
      listen(element('globalSearchButton'),'click',()=>controls.toggle());
      listen(element('globalSearchClose'),'click',()=>controls.close());
      listen(document,'keydown',event=>{
        if(!(event instanceof KeyboardEvent))return;
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();controls.open()}
        else if(event.key==='Escape')controls.close();
      });
      let pointerId=-1;const backdrop=element('globalSearchBackdrop');
      listen(backdrop,'pointerdown',event=>{pointerId=event instanceof PointerEvent&&event.target===backdrop?event.pointerId:-1});
      listen(backdrop,'pointerup',event=>{if(event instanceof PointerEvent&&event.pointerId===pointerId&&event.target===backdrop)controls.close();pointerId=-1});
      listen(backdrop,'pointercancel',()=>{pointerId=-1});
      listen(element('globalSearchResults'),'click',event=>{if(event.target instanceof Element&&event.target.closest('[data-search-load-retry]'))controls.open()});
      return ()=>{for(const remove of cleanup.splice(0))remove()};
    },
    busy(value){
      element('globalSearchBackdrop')?.setAttribute('aria-busy',String(value));
      element('globalSearchButton')?.setAttribute('aria-busy',String(value));
    },
    showLoading(){
      const backdrop=element('globalSearchBackdrop');if(backdrop){backdrop.hidden=false;backdrop.setAttribute('aria-hidden','false')}
      element('globalSearchButton')?.setAttribute('aria-expanded','true');
      const results=element('globalSearchResults');if(results)results.textContent='???? ??????';
      element('globalSearchInput')?.focus();
    },
    hide,
    invalidate(){
      hide();const input=element('globalSearchInput');if(input instanceof HTMLInputElement)input.value='';
      const results=element('globalSearchResults');if(results)results.replaceChildren();
      const meta=element('globalSearchMeta');if(meta)meta.textContent='';
    },
    showError(){
      const results=element('globalSearchResults');if(!results)return;
      const message=document.createElement('p');message.textContent='????? ?????? ?????.';
      const retry=document.createElement('button');retry.type='button';retry.className='btn';retry.dataset.searchLoadRetry='';retry.textContent='??? ???';
      results.replaceChildren(message,retry);
    },
  };
}

// Only the interaction shell is eager. No provider warmup, search model read,
// viewer creation or business command occurs while the module is loading.
/** @param {LazySearchOptions} options */
export function createLazyGlobalDocumentSearch({load,navigateItem,subscribeAuthorization,platform=browserPlatform()}){
  /** @type {Search|null} */ let view=null;
  /** @type {Promise<()=>Search>|null} */ let loading=null;
  /** @type {(()=>void)|null} */ let unbind=null;
  /** @type {(()=>void)|null} */ let unsubscribe=null;
  let bound=false,disposed=false,wanted=false,generation=0;
  function subscribe(){
    if(unsubscribe||!subscribeAuthorization)return;
    unsubscribe=subscribeAuthorization(()=>{
      generation++;wanted=false;
      if(!view){platform.busy(false);platform.invalidate()}
    });
  }
  /** @param {number} captured */
  const current=captured=>!disposed&&wanted&&captured===generation;
  /** @param {Command} command @param {unknown[]} args */
  async function invoke(command,args){
    const captured=generation;subscribe();
    try{
      if(!loading){
        const pending=Promise.resolve().then(load).catch(error=>{if(loading===pending)loading=null;throw error});loading=pending;
      }
      const create=await loading;
      if(!current(captured))return false;
      if(!view){
        const created=create();
        if(!current(captured)){created.dispose();return false}
        view=created;
        try{view.bind()}catch(error){view=null;created.dispose();throw error}
        if(!current(captured)){view.dispose();view=null;return false}
        unbind?.();unbind=null;platform.busy(false);
      }
      return view[command](...args);
    }catch(error){
      if(current(captured)){platform.busy(false);platform.showError(error)}
      return false;
    }
  }
  function open(){
    if(disposed)return false;
    if(view)return view.open();
    wanted=true;subscribe();platform.showLoading();platform.busy(true);
    return invoke('open',[]);
  }
  /** @param {{restoreFocus?:boolean}} [options] */
  function close(options){
    if(disposed)return false;
    generation++;wanted=false;
    if(view)return view.close(options);
    platform.busy(false);platform.hide(options?.restoreFocus!==false);return false;
  }
  function toggle(){if(disposed)return false;if(view)return view.toggle();return wanted?close():open()}
  function bind(){if(bound||disposed)return;bound=true;subscribe();if(!view)unbind=platform.bind({open,toggle,close})}
  function dispose(){
    if(disposed)return false;
    disposed=true;generation++;wanted=false;unbind?.();unbind=null;unsubscribe?.();unsubscribe=null;
    if(view)view.dispose();else{platform.busy(false);platform.invalidate()}
    return true;
  }
  /** @param {Command} command @param {unknown[]} args */
  function call(command,args){if(disposed)return false;return view?view[command](...args):invoke(command,args)}
  /** @param {Command} command @returns {(...args:unknown[])=>unknown} */
  const dispatch=command=>(...args)=>call(command,args);
  return {bind,open,close,toggle,dispose,navigateItem:(/** @type {unknown} */item)=>disposed?false:navigateItem(item),
    renderResults:dispatch('renderResults'),openResult:dispatch('openResult'),setMode:dispatch('setMode'),setFilter:dispatch('setFilter')};
}
