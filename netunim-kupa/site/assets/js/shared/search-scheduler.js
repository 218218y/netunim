export const SEARCH_RENDER_DELAY_MS=100;

export function createSearchScheduler(callback,{delay=SEARCH_RENDER_DELAY_MS,setTimer=globalThis.setTimeout?.bind(globalThis),clearTimer=globalThis.clearTimeout?.bind(globalThis)}={}){
  if(typeof callback!=='function')throw new TypeError('Search scheduler callback must be a function');
  if(typeof setTimer!=='function'||typeof clearTimer!=='function')throw new TypeError('Search scheduler requires timer functions');
  let timer=null,pending=false,lastArgs=[];
  const wait=Math.max(0,Number(delay)||0);
  const invoke=()=>{timer=null;if(!pending)return;pending=false;const args=lastArgs;lastArgs=[];return callback(...args)};
  const schedule=(...args)=>{lastArgs=args;pending=true;if(timer!==null)clearTimer(timer);timer=setTimer(invoke,wait)};
  schedule.flush=()=>{if(!pending)return;if(timer!==null){clearTimer(timer);timer=null}return invoke()};
  schedule.cancel=()=>{if(timer!==null)clearTimer(timer);timer=null;pending=false;lastArgs=[]};
  schedule.pending=()=>pending;
  return schedule;
}

export function createDeferredSearchUpdater(update,render,options={}){
  if(typeof update!=='function'||typeof render!=='function')throw new TypeError('Deferred search updater requires update and render functions');
  const scheduled=createSearchScheduler(({value,source})=>{
    if(source&&'isConnected' in source&&source.isConnected===false)return;
    render(value);
  },options);
  const apply=(value,source=null)=>{
    const normalized=String(value??'');
    update(normalized);
    scheduled({value:normalized,source});
  };
  apply.flush=scheduled.flush;
  apply.cancel=scheduled.cancel;
  apply.pending=scheduled.pending;
  return apply;
}

export function createLazyDeferredSearchUpdater(update,render,options={}){
  if(typeof update!=='function')throw new TypeError('Lazy deferred search updater requires an update function');
  let deferred=null;
  const getDeferred=()=>deferred||(deferred=createDeferredSearchUpdater(update,render,options));
  const apply=(value,source=null)=>getDeferred()(value,source);
  apply.flush=()=>deferred?.flush();
  apply.cancel=()=>deferred?.cancel();
  apply.pending=()=>deferred?.pending()||false;
  return apply;
}
