import {createStorageV2BootstrapCoordinator,createStorageV2BootstrapExecutor,assertStorageV2BootstrapGroup} from '../../shared/storage-v2-bootstrap.js';
const coordinator=createStorageV2BootstrapCoordinator({app:'orders',owner:()=> 'A'});
const group=assertStorageV2BootstrapGroup(/** @type {unknown} */ ({}));
/** @type {import('../../shared/storage-bootstrap-contracts.js').Phase} */ const phase=group.phase;
// @ts-expect-error historical coercible sequence evidence is not normalized money/sequence
/** @type {number} */ const seq=group.main.sourceSeq;
// @ts-expect-error persisted identity validation preserves historical raw scalars
/** @type {string} */ const id=group.id;
// @ts-expect-error closed phase domain
coordinator.advance('published');
// @ts-expect-error frozen proof scope must be a string
coordinator.advance('prepared',{}, {scope:200,id:'G',planHash:'H'});
// @ts-expect-error discovery requires both source snapshots and intent
coordinator.prepare({sourceOwner:'local',transferIntent:'load-account'});
// @ts-expect-error phase proofs must be serializable local evidence
createStorageV2BootstrapExecutor({coordinator,initializeMain:async()=>new Date()});
void [phase,seq,id];
