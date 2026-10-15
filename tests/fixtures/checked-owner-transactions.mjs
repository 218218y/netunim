import {createStorageOwnerTransactions} from '../../shared/storage-owner-idb.js';
/** @param {()=>Promise<IDBDatabase>} open */
export async function consumer(open){
  const db=createStorageOwnerTransactions({open}),state=await db.readOwnerState('orders');
  if(state.binding){const generation=state.binding.generation;await db.activateOwnerHandoff('orders','H','B',{expectedGeneration:generation});}
  // @ts-expect-error Every ownership mutation needs a captured generation.
  await db.beginOwnerHandoff('orders',{});
  // @ts-expect-error A textual counter cannot authorize an atomic owner write.
  await db.completeOwnerHandoff('orders','H','B',{expectedGeneration:'1'});
}
// @ts-expect-error An IDB open request is not a completed database connection.
createStorageOwnerTransactions({open:()=>indexedDB.open('test')});
