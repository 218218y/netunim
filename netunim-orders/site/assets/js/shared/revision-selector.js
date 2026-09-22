import {beginMeasure} from './runtime-performance.js';

// JSON read projections only. Clone first: freezing a view must never freeze
// the mutable authoritative state or a caller's input collections.
export function immutableProjection(value){
  const result=structuredClone(value),pending=[result];
  while(pending.length){const item=pending.pop();if(!item||typeof item!=='object'||Object.isFrozen(item))continue;Object.freeze(item);for(const value of Object.values(item))pending.push(value)}
  return result;
}

export function createRevisionSelector({revision,select,name='projection'}={}){
  let stamp,value,valid=false;
  return ()=>{
    const next=revision?.();
    if(valid&&next!==undefined&&next!==null&&next===stamp)return value;
    const done=beginMeasure(`selector:compute:${name}`);
    try{const result=select();value=immutableProjection(result);stamp=next;valid=true;return value}finally{done()}
  };
}
