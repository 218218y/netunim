import {beginMeasure} from './runtime-performance.js';

// Fragments are owned by the index. Query/rank functions must not mutate them.
export function createSearchFragmentIndex({fragments,revision,build}){
  const cache=new Map();let combined=[];
  return ()=>{
    let changed=false;
    for(const name of fragments){
      const stamp=revision?.(name),prior=cache.get(name);
      if(stamp!==undefined&&stamp!==null&&prior?.stamp===stamp)continue;
      const done=beginMeasure(`search:index:${name}`);
      try{cache.set(name,{stamp,rows:build(name)});changed=true}finally{done()}
    }
    if(changed)combined=fragments.flatMap(name=>cache.get(name).rows);
    return combined;
  };
}
