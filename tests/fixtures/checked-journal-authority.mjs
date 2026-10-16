import {captureStorageJournalOperation} from '../../shared/storage-journal-authority.js';
import {captureStorageCloudBase,captureStorageRecoveryHead} from '../../shared/storage-journal-authority.js';
/** @type {unknown} */ const input={};
const command=captureStorageJournalOperation(input,'A:orders','E');
/** @type {number} */ const seq=command.data.seq;
/** @type {string} */ const operationId=command.data.operationId;
// @ts-expect-error journal authority cannot accept a coercible owner
captureStorageJournalOperation(input,['A:orders'],'E');
// @ts-expect-error a checked sequence cannot become text authority
/** @type {string} */ const invalid=command.data.seq;
// @ts-expect-error business content is not inferred from the operation envelope
command.data.changes[0].record.text.toUpperCase();
void [seq,operationId,invalid];
const base=captureStorageCloudBase(input),head=captureStorageRecoveryHead(input);
/** @type {number} */ const revision=base.data.revision;
/** @type {number} */ const ack=head.ackSeq;
// @ts-expect-error revision evidence cannot become text
/** @type {string} */ const invalidBase=base.data.revision;
// @ts-expect-error sequence evidence cannot become a boolean
/** @type {boolean} */ const invalidHead=head.seq;
void [revision,ack,invalidBase,invalidHead];

import {assertStorageJournalInstall,assertStorageJournalInitialization,storageJournalCompactionThrough,
 assertStorageJournalAckCheckpoint,assertStorageJournalAdoption,assertStorageJournalCloudReset} from '../../shared/storage-journal-authority.js';
const scope={owner:'A:orders',epoch:'E',seq:1},checkpoint={...scope,seq:0},cursor={owner:scope.owner,epoch:scope.epoch,revision:1,ackSeq:0};
assertStorageJournalInstall(scope.owner,checkpoint,null,null,false);
assertStorageJournalInitialization(scope.owner,checkpoint,cursor,null);
/** @type {number} */ const retiredThrough=storageJournalCompactionThrough(scope,checkpoint,0,0);
assertStorageJournalAckCheckpoint(scope,scope);
assertStorageJournalAdoption(scope,scope,{...cursor,ackSeq:1},{...cursor,ackSeq:1},false);
assertStorageJournalCloudReset(scope.owner,checkpoint,cursor);
// @ts-expect-error a pending-flight fact cannot be text
assertStorageJournalInstall(scope.owner,checkpoint,null,null,'false');
// @ts-expect-error ACK evidence cannot be a coercible string
assertStorageJournalInitialization(scope.owner,checkpoint,{...cursor,ackSeq:'0'},null);
// @ts-expect-error compaction cannot infer an ACK from a boolean
storageJournalCompactionThrough(scope,checkpoint,0,false);
// @ts-expect-error a diagnostic checkpoint sequence is numeric authority
assertStorageJournalAckCheckpoint(scope,{...checkpoint,seq:'1'});
// @ts-expect-error a revision cursor cannot be text authority
assertStorageJournalAdoption(scope,scope,{...cursor,revision:'2'},cursor,false);
// @ts-expect-error resetting requires both decoded checkpoint and base
assertStorageJournalCloudReset(scope.owner,checkpoint,null);
void retiredThrough;

import {assertStorageJournalReplacement,assertStorageJournalLocalReplacement,assertStorageJournalFlight,
 assertStorageJournalRejection,assertStorageJournalLocalReset} from '../../shared/storage-journal-authority.js';
const flight={owner:scope.owner,epoch:scope.epoch,operationId:'F',baseRevision:1,startSeq:1,endSeq:1};
assertStorageJournalReplacement(scope,scope);
assertStorageJournalLocalReplacement(scope,scope,1,false);
assertStorageJournalFlight(scope,flight,cursor);
assertStorageJournalRejection(scope,flight,cursor,{...cursor,revision:2},scope,1,'F');
assertStorageJournalLocalReset(scope.owner,checkpoint);
// @ts-expect-error local retirement requires a boolean cloud-head fact
assertStorageJournalLocalReplacement(scope,scope,1,'false');
// @ts-expect-error a flight revision cannot be text authority
assertStorageJournalFlight(scope,{...flight,baseRevision:'1'},cursor);
// @ts-expect-error rejection requires the actual numeric committed sequence
assertStorageJournalRejection(scope,flight,cursor,cursor,scope,'1','F');
// @ts-expect-error replacement cannot accept a textual sequence
assertStorageJournalReplacement(scope,{...scope,seq:'1'});
// @ts-expect-error a local reset requires a decoded epoch
assertStorageJournalLocalReset(scope.owner,{...checkpoint,epoch:null});
