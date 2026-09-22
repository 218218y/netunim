import {beginMeasure} from './runtime-performance.js';

// Active scopes are synchronous: they never leak into an async continuation.
// A revision store may retain detached results across scopes; callers must not
// mutate inputs while a scope is active. Date/options remain part of each key.
let active=null;
export function withFinanceDerivations(render,cache=null){
  if(active&&!cache)return render();
  const previous=active;active=cache||new WeakMap();
  try{return render()}finally{active=previous}
}

// One store per application, explicitly invalidated by business revisions.
// The source identity also participates: untracked replacement cannot reuse data.
export function createFinanceDerivationStore({revision}={}){
  let stamp,cache=new WeakMap();
  function run(render){
    const next=revision?.();
    if(next===undefined||next===null)return withFinanceDerivations(render);
    if(next!==stamp){stamp=next;cache=new WeakMap()}
    return withFinanceDerivations(render,cache);
  }
  return {run,clear(){stamp=undefined;cache=new WeakMap()}};
}

// Cache detached copies, and never expose the cached value to a consumer.
// A view sorting or annotating its result cannot poison a later selector.
export function financeDerivation(source,kind,key,calculate){
  const scope=active&&source&&typeof source==='object'?active:null;
  let entries=scope?.get(source);
  const id=`${kind}:${key}`;
  if(entries?.has(id)){
    const done=beginMeasure(`finance:reuse:${kind}`);
    try{return structuredClone(entries.get(id))}finally{done()}
  }
  const done=beginMeasure(`finance:compute:${kind}`);
  let value;
  try{value=calculate()}finally{done()}
  if(scope){
    entries=scope.get(source);
    if(!entries){entries=new Map();scope.set(source,entries)}
    entries.set(id,structuredClone(value));
    // Custom forecast dates and history windows cannot grow without bound.
    while(entries.size>64)entries.delete(entries.keys().next().value);
  }
  return value;
}
