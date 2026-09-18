import {beginMeasure} from './runtime-performance.js';

// Synchronous render scope only. Nothing survives into the next action, rebase,
// date change or async continuation. Callers must not mutate inputs in a scope.
let active=null;
export function withFinanceDerivations(render){
  if(active)return render();
  active=new WeakMap();
  try{return render()}finally{active=null}
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
  }
  return value;
}
