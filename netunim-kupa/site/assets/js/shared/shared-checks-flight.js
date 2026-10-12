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
