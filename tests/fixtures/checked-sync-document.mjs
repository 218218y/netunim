// @ts-check
import {createSyncDocument as orders} from '../../netunim-orders/site/assets/js/sync/document.js';
import {createSyncDocument as kupa} from '../../netunim-kupa/site/assets/js/sync/document.js';
import {createCloudAckPublication} from '../../netunim-orders/site/assets/js/sync/ack-publication.js';
import {commitCloudCheckpoint} from '../../shared/cloud-checkpoint-publication.js';
/** @type {import('../../shared/sync-document-contracts.js').OrdersDocumentPorts} */
const ordersPorts=/** @type {never} */(null);
/** @type {import('../../shared/sync-document-contracts.js').KupaDocumentPorts} */
const kupaPorts=/** @type {never} */(null);
orders(ordersPorts);kupa(kupaPorts);
// @ts-expect-error an asynchronous local commit cannot be reported as a ready receipt
orders({...ordersPorts,journal:{...ordersPorts.journal,storageV2CommitPromise:()=>true}});
// @ts-expect-error owner login epoch and storage epoch have different identities
orders({...ordersPorts,access:{...ordersPorts.access,getCloudWriteScope:()=>({owner:'A',epoch:4,accountOwner:'A',loginEpoch:'E',writable:true})}});
// @ts-expect-error an unverified HTTP row has no local checkpoint sequence
orders({...ordersPorts,journal:{...ordersPorts.journal,acknowledgeStorageV2CloudFlight:async()=>({operationId:'F',revision:3,ackSeq:1})}});
// @ts-expect-error raw finance evidence is not a cloud snapshot
kupa({...kupaPorts,journal:{...kupaPorts.journal,refreshStorageV2CloudState:async()=>({financeRevision:3,state:{}})}});
/** @type {import('../../shared/sync-document-contracts.js').OrdersAckPublicationPorts} */
const publicationPorts=/** @type {never} */(null);
const publication=createCloudAckPublication(publicationPorts);
/** @type {import('../../shared/sync-document-contracts.js').AckInput} */
const input=/** @type {never} */(null);
const result=await publication.publishAcknowledgedFlight(input);
if(result){
  /** @type {true} */ const durable=result.committed;void durable;
  // @ts-expect-error a local checkpoint is not the unverified response row
  /** @type {number} */ const revision=result.state.revision;void revision;
}
// @ts-expect-error asynchronous view publication escapes its receipt/error boundary
await commitCloudCheckpoint({commit:async()=>1,isCurrent:()=>true,publish:async()=>{}});
