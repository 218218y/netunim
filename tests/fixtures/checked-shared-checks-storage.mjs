import {createSharedChecksStorageV2,validateSharedChecksState} from '../../shared/shared-checks-storage-v2.js';
const store=createSharedChecksStorageV2({owner:()=> 'A',primary:()=>true});
const admission=store.append([{type:'put',collection:'checks',id:'C',mode:'replace'}],{checks:[{id:'C'}],bankEvents:[]});
/** @type {Promise<boolean>} */ const committed=admission.committed;
// @ts-expect-error local durability is asynchronous
/** @type {boolean} */ const durable=admission.committed;
// @ts-expect-error an admission is not a cloud ACK
/** @type {import('../../shared/storage-journal-contracts.js').CloudAck} */ const ack=admission;
// @ts-expect-error Shared Checks cannot append into Main collections
store.append([{type:'delete',collection:'notes',id:'N'}],{});
// @ts-expect-error insertion order is mandatory
store.append([{type:'put',collection:'checks',id:'C',mode:'insert'}],{});
// @ts-expect-error checkpoint sequence is mandatory with the current state
store.acknowledge('flight',2,{}, {currentState:{}});
// @ts-expect-error a boundary needs its frozen sequence and cloud revision
store.replaceLocalWithPending({}, {boundaryId:'B'});
const state=validateSharedChecksState(/** @type {unknown} */ ({}));
/** @type {string|undefined} */ const id=state.checks[0]?.id;
/** @type {number|undefined} */ const seq=state.bankEvents[0]?.seq;
// @ts-expect-error validation proves identity, not monetary normalization
/** @type {number} */ const amount=state.checks[0]?.amount;
// @ts-expect-error owner callbacks are synchronous
createSharedChecksStorageV2({owner:async()=> 'A',primary:()=>true});
void [committed,durable,ack,id,seq,amount];
