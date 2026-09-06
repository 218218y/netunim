// One coordinator per app instance. Reserve slots before running user code, including
// while queued behind the opposite operation. A failed predecessor releases the
// queue; each operation must re-read session/network/outbox when it actually starts.
// Never await a nested flight from inside an operation (that would await itself).
export function createSharedChecksFlight({state,pullKey,saveKey,busyKey}){
  let active=null;
  Object.defineProperty(state,busyKey,{configurable:true,enumerable:true,get:()=>active!==null});
  function run(kind,work){
    const key=kind==='pulling'?pullKey:saveKey,other=kind==='pulling'?saveKey:pullKey;
    if(state[key])return state[key];
    const predecessor=state[other];
    const tracked=Promise.resolve(predecessor).catch(()=>{}).then(async()=>{
      active=kind;
      try{return await work()}finally{active=null}
    }).finally(()=>{if(state[key]===tracked)state[key]=null});
    state[key]=tracked;
    return tracked;
  }
  function status({online=true,pending=null,localWork=false}={}){
    if(active)return active;
    if(!online)return 'offline';
    if(pending?.conflict)return 'conflict';
    if(state[pullKey]||state[saveKey]||pending||localWork)return 'deferred';
    return 'idle';
  }
  return {pull:work=>run('pulling',work),save:work=>run('saving',work),status};
}
