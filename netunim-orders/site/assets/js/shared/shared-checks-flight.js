// One coordinator per app instance. Reserve slots before running user code, including
// while queued behind the opposite operation. A failed predecessor releases the
// queue; each operation must re-read session/network/outbox when it actually starts.
// Never await a nested flight from inside an operation (that would await itself).
/**
 * @template T
 * @param {{state:Record<string,Promise<T>|boolean|null>,pullKey:string,saveKey:string,busyKey:string}} ports
 */
export function createSharedChecksFlight({state,pullKey,saveKey,busyKey}){
  /** @type {'pulling'|'saving'|null} */
  let active=null;
  Object.defineProperty(state,busyKey,{configurable:true,enumerable:true,get:()=>active!==null});
  /** @param {'pulling'|'saving'} kind @param {()=>T|PromiseLike<T>} work */
  function run(kind,work){
    const key=kind==='pulling'?pullKey:saveKey,other=kind==='pulling'?saveKey:pullKey;
    const reserved=state[key];
    if(reserved&&typeof reserved!=='boolean')return reserved;
    const predecessor=state[other];
    const tracked=Promise.resolve(predecessor).catch(()=>{}).then(async()=>{
      active=kind;
      try{return await work()}finally{active=null}
    }).finally(()=>{if(state[key]===tracked)state[key]=null});
    state[key]=tracked;
    return tracked;
  }
  /** @param {{online?:boolean,pending?:{conflict?:unknown}|null,localWork?:boolean}} options */
  function status({online=true,pending=null,localWork=false}={}){
    if(active)return active;
    if(!online)return 'offline';
    if(pending?.conflict)return 'conflict';
    if(state[pullKey]||state[saveKey]||pending||localWork)return 'deferred';
    return 'idle';
  }
  /** @param {()=>T|PromiseLike<T>} work */
  const pull=work=>run('pulling',work);
  /** @param {()=>T|PromiseLike<T>} work */
  const save=work=>run('saving',work);
  return {pull,save,status};
}
// Load the optional bank-review controller only after Shared V2 has acknowledged
// its head, or after an explicit click. The wrapper owns late-load cancellation.
/** @typedef {ReturnType<typeof import('./check-bank-refresh.js').createCheckBankRefresh>} BankRefreshController */
/** @param {import('./check-bank-refresh.js').CheckBankRefreshPorts} ports */
export function createDeferredCheckBankRefresh(ports){
  let disposed=false,generation=0;
  /** @type {BankRefreshController|null} */ let controller=null;
  /** @type {Promise<BankRefreshController|null>|null} */ let loading=null;
  /** @type {{owner:import('./check-bank-refresh.js').RefreshOwner,promise:Promise<void>}|null} */ let manual=null;
  /** @returns {Promise<BankRefreshController|null>} */
  function load(){
    if(disposed)return Promise.resolve(null);
    if(!loading)loading=import('./check-bank-refresh.js').then(module=>{
      if(disposed)return null;
      controller=module.createCheckBankRefresh(ports);return controller;
    }).catch(error=>{loading=null;throw error});
    return loading;
  }
  function observe(){
    if(disposed)return;
    if(controller){controller.observe();return}
    const epoch=generation;
    void load().then(value=>{if(epoch===generation)value?.observe()}).catch(()=>{});
  }
  /** @param {import('./check-bank-refresh.js').RefreshButton} button */
  function refresh(button){
    const identity=ports.owner(),epoch=generation;
    if(manual&&manual.owner===identity)return manual.promise;
    const label=button?.textContent??'';
    if(button){button.disabled=true;button.textContent='טוען בדיקת התאמות…'}
    const current=()=>!disposed&&generation===epoch&&ports.owner()===identity;
    /** @type {Promise<void>} */
    const promise=load().then(value=>{
      if(button){button.disabled=false;button.textContent=label}
      if(current())return value?.manual(button);
    }).catch(()=>{if(current())ports.toast('לא ניתן לבדוק התאמות כרגע. יש לנסות שוב לאחר הסנכרון.')}).finally(()=>{
      if(manual?.promise===promise)manual=null;
      if(button){button.disabled=false;button.textContent=label}
    });
    manual={owner:identity,promise};return promise;
  }
  return {observe,manual:refresh,cancel(){generation++;controller?.cancel()},
    async drain(){await loading?.catch(()=>{});await manual?.promise;await controller?.drain()},
    dispose(){disposed=true;generation++;controller?.dispose()}};
}
