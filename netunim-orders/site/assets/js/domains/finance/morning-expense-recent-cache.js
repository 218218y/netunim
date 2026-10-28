import {createIndexedDbConnection,completeIndexedDbTransaction} from '../../shared/indexed-db-connection.js';
import {expenseRecentSnapshot,updateExpenseRecentSnapshot} from './morning-expense-recent-model.js';

// One bounded snapshot per account/environment, shared by tabs on this browser.
// Read/modify/write in one transaction so a delayed refresh cannot erase an
// intake that a different tab has already committed.
export function createExpenseRecentCache({indexedDB = globalThis.indexedDB} = {}) {
  const open = createIndexedDbConnection('netunim-morning-expense-recent',1,db => db.createObjectStore('snapshots'),{indexedDB,stopOnVersionChange:true});
  let database = null, closed = false;
  const key = scope => {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(scope.owner) || !['production','sandbox'].includes(scope.environment)) throw Error('invalid_expense_recent_scope');
    return scope.environment + ':' + scope.owner;
  };
  async function transact(scope, check, change) {
    const id = key(scope);
    return completeIndexedDbTransaction(async () => {
      check(); if (closed) throw Error('expense_recent_cache_closed');
      const db = await open(); database = db;
      if (closed) {open.invalidate(db);throw Error('expense_recent_cache_closed');}
      check(); return db.transaction('snapshots',change ? 'readwrite' : 'readonly');
    },(tx,done,fail) => {
      const store = tx.objectStore('snapshots'), request = store.get(id);
      request.onsuccess = () => {try {
        check();
        let prior = null;
        try {prior = expenseRecentSnapshot(request.result);} catch { /* A corrupt cache can be rebuilt from a verified read. */ }
        const next = change ? updateExpenseRecentSnapshot(prior,change) : prior;
        if (change) store.put(next,id);
        done(next);
      } catch (error) {fail(error);}};
    },'expense_recent_cache_aborted');
  }
  return {read:(scope,check) => transact(scope,check),update:(scope,change,check) => transact(scope,check,change),
    close:() => {closed = true;if (database) open.invalidate(database);}};
}
