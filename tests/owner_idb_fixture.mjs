import {sealStorageJsonRecord} from '../shared/storage-json-codec.js';
// Deterministic request/complete/abort scheduling, not an IndexedDB substitute.
// Native browser tests separately prove actual multi-store isolation.
export function ownerDatabase({binding=null,handoff=null,abort=false,held=false}={}){
  const stores=new Map([['owner-bindings',new Map()],['owner-handoffs',new Map()]]),writes=[];
  const seed=(name,data)=>{const target=stores.get(name);if(data==null)target.delete('orders');else target.set('orders',sealStorageJsonRecord(data))};
  seed('owner-bindings',binding);seed('owner-handoffs',handoff);
  let release;const gate=new Promise(resolve=>{release=resolve});
  const database={transaction(names,mode){
    const snapshot=structuredClone(stores);let requests=0,cancelled=false;
    const tx={error:null,objectStore(name){return {
      get(key){const request={result:undefined,onsuccess:null};requests++;queueMicrotask(()=>{if(cancelled)return;request.result=structuredClone(snapshot.get(name).get(key));request.onsuccess?.();if(!--requests)queueMicrotask(async()=>{if(held)await gate;if(cancelled)return;if(abort){tx.abort();return}if(mode==='readwrite')for(const scope of names)stores.set(scope,structuredClone(snapshot.get(scope)));tx.oncomplete?.()})});return request},
      put(value,key){if(mode!=='readwrite')throw Error('readonly');writes.push({name,key,value:structuredClone(value)});snapshot.get(name).set(key,structuredClone(value))},
    }},abort(){if(cancelled)return;cancelled=true;tx.error=Error('fixture-transaction-aborted');queueMicrotask(()=>tx.onabort?.())}};
    return tx;
  }};
  return {database,open:async()=>database,seed,writes,release,snapshot:()=>structuredClone(stores)};
}
export const binding=()=>({version:1,app:'orders',owner:'A',generation:1,source:'bootstrap',createdAt:'T',updatedAt:'T'});
export const handoff=()=>({version:1,app:'orders',id:'H',sourceOwner:'A',targetOwner:'B',intent:'account-switch',phase:'freezing-source',createdAt:'T',updatedAt:'T'});
