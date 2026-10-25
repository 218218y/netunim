import {createStorageJournal} from '../../shared/storage-journal.js';
const journal=createStorageJournal({owner:'A:orders',schema:{collections:['notes'],fields:['setting']},validate:()=>{}});
const admission=journal.append([{type:'set',field:'setting',value:1}],{generation:1});
/** @type {number} */ const seq=admission.seq;
/** @type {Promise<boolean>} */ const committed=admission.committed;
// @ts-expect-error Queue admission does not grant a completed local write.
/** @type {boolean} */ const premature=admission.committed;
// @ts-expect-error A local commit is not a cloud ACK receipt.
/** @type {import('../../shared/storage-journal-contracts.js').CloudAck} */ const ack=admission;
// @ts-expect-error Generation metadata must remain numeric.
journal.append([],{generation:'1'});
// @ts-expect-error Cloud revisions cannot be replaced by local success.
journal.acknowledge('OP',true,{});
// @ts-expect-error A projection must finish synchronously before materialization.
journal.captureCloudCursor(1,{project:async()=>({})});
// @ts-expect-error A scope callback must not return an unfinished Promise.
journal.setCloudControl({},{isCurrent:async()=>true});
// @ts-expect-error Validation must complete before the guarded write continues.
createStorageJournal({owner:'A:orders',schema:{collections:[]},validate:async()=>{}});
// Existing immutable flights can be reread without allocating an operation ID.
const retained=journal.materializeFlight();
/** @type {Promise<import('../../shared/storage-cloud-records.js').StoredCloudFlight|null>} */ const flight=retained;
const serverAck=journal.acknowledge('OP',2,{});
/** @type {Promise<import('../../shared/storage-journal-contracts.js').CloudAck>} */ const confirmed=serverAck;
serverAck.then(value=>{
  // @ts-expect-error A cloud ACK sequence cannot become textual success.
  /** @type {string} */ const wrong=value.ackSeq;
  void wrong;
});
const recovered=journal.recover();
recovered.then(value=>{if(value){/** @type {number} */ const durable=value.stored.metadata.seq;void durable}});
void [seq,committed,premature,ack,flight,confirmed];
