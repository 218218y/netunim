import {createAuthSessionPersistence} from '../../netunim-kupa/site/assets/js/cloud/session-store.js';
const ports={key:'session',initial:null,storage:()=>localStorage,decode:/** @param {unknown} value */ value=>typeof value==='string'?value:null,
  mirror:{read:async()=> 'token',write:/** @param {string} value */ async value=>value,remove:async()=>{}}};
const owner=createAuthSessionPersistence(ports);
owner.store('token');owner.store(null);
/** @type {string|null} */ const restored=await owner.restore();void restored;
/** @type {Promise<void>} */ const drained=owner.drain();void drained;
// @ts-expect-error Credential commands must match the decoded session type.
owner.store({user:{id:'A'}});
// @ts-expect-error Persistence acknowledgements cannot be synchronous values.
createAuthSessionPersistence({...ports,mirror:{...ports.mirror,remove:()=>true}});
// @ts-expect-error Local authority must acknowledge storage synchronously.
createAuthSessionPersistence({...ports,storage:()=>({getItem:async()=>null,setItem(){}})});
