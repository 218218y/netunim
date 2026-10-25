import {beginMeasure} from './runtime-performance.js';

// Active scopes are synchronous: they never leak into an async continuation.
// A revision store may retain detached results across scopes; callers must not
// mutate inputs while a scope is active. Date/options remain part of each key.
/** @type {WeakMap<object,Map<string,unknown>>|null} */
let active=null;
/** @template T @param {()=>T} render @param {WeakMap<object,Map<string,unknown>>|null} [cache] @returns {T} */
export function withFinanceDerivations(render,cache=null){
  if(active&&!cache)return render();
  const previous=active;active=cache||new WeakMap();
  try{return render()}finally{active=previous}
}

// One store per application, explicitly invalidated by business revisions.
// The source identity also participates: untracked replacement cannot reuse data.
/** @param {{revision?:()=>unknown}} [options] */
export function createFinanceDerivationStore({revision}={}){
  /** @type {unknown} */
  let stamp;
  /** @type {WeakMap<object,Map<string,unknown>>} */
  let cache=new WeakMap();
  /** @template T @param {()=>T} render @returns {T} */
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
/** @template T @param {unknown} source @param {string} kind @param {string} key @param {()=>T} calculate @returns {T} */
export function financeDerivation(source,kind,key,calculate){
  const scopedSource=source&&typeof source==='object'?source:null,scope=active&&scopedSource?active:null;
  let entries=scopedSource?scope?.get(scopedSource):undefined;
  const id=`${kind}:${key}`;
  if(entries?.has(id)){
    const done=beginMeasure(`finance:reuse:${kind}`);
    // The source/kind/options key belongs to this selector; only its own typed
    // calculation writes this cache entry. This is not an external-data reader.
    try{return /** @type {T} */(structuredClone(entries.get(id)))}finally{done()}
  }
  const done=beginMeasure(`finance:compute:${kind}`);
  let value;
  try{value=calculate()}finally{done()}
  if(scope&&scopedSource){
    entries=scope.get(scopedSource);
    if(!entries){entries=new Map();scope.set(scopedSource,entries)}
    entries.set(id,structuredClone(value));
    // Custom forecast dates and history windows cannot grow without bound.
    while(entries.size>64){const first=entries.keys().next();if(first.done)break;entries.delete(first.value)}
  }
  return value;
}
