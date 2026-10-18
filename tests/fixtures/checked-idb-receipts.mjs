import {completeIndexedDbTransaction} from '../../shared/indexed-db-connection.js';
import {completeIndexedDbTransaction as kupa} from '../../netunim-kupa/site/assets/js/shared/indexed-db-connection.js';
import {completeIndexedDbTransaction as orders} from '../../netunim-orders/site/assets/js/shared/indexed-db-connection.js';
/** @type {()=>IDBTransaction} */ const begin=()=>{throw Error('compile only')};
/** @type {Promise<boolean>} */ const receipt=completeIndexedDbTransaction(begin,(_tx,done)=>{done(true)});
/** @type {Promise<number>} */ const generated=kupa(begin,(_tx,done)=>{done(1)});
orders(begin,(_tx,done,fail)=>{try{done({owner:'A'})}catch(error){fail(error)}});
// @ts-expect-error An asynchronous callback can lose the active transaction.
completeIndexedDbTransaction(begin,async(_tx,done)=>{done(true)});
// @ts-expect-error Starting a request is not a transaction port.
completeIndexedDbTransaction(()=>indexedDB.open('wrong'),()=>{});
// @ts-expect-error A boolean receipt cannot be replaced with text.
/** @type {Promise<boolean>} */ const wrong=completeIndexedDbTransaction(begin,(_tx,done)=>{done('true')});
void [receipt,generated,wrong];
