import {createStorageJournalDb} from '../../shared/storage-journal-idb.js';
import {sealStorageRecord,replayStorageJournal} from '../../shared/storage-journal-model.js';
import {createStorageCheckpoint,createStorageCloudBase,createStorageJournalRecord} from '../../shared/storage-records.js';

const db=createStorageJournalDb({operationSchema:{collections:['notes']}});
const owner='A:orders',epoch='E',writer='W';
const checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch,seq:0,state:{notes:[]},appMetadata:{},savedAt:'T'}));
const base=sealStorageRecord(createStorageCloudBase({owner,epoch,revision:1,ackSeq:0,state:{notes:[]}}));
const operation=sealStorageRecord(createStorageJournalRecord({owner,epoch,seq:1,generation:1,operationId:'OP',at:'T',surface:'test',mutationType:'edit',changes:[{type:'set',field:'setting',value:1}],deleteIntents:{},appMetadata:{}}));
/** @type {Promise<boolean>} */ const committed=db.append(owner,epoch,writer,operation);
/** @type {Promise<boolean>} */ const installed=db.initializeCloudHead(owner,checkpoint,base,writer);
const replayed=replayStorageJournal(checkpoint,[operation],{fields:['setting']});
/** @type {number} */ const seq=replayed.seq;
// @ts-expect-error Local completion is asynchronous; admission is not a commit.
/** @type {boolean} */ const premature=committed;
// @ts-expect-error A local commit cannot serve as a cloud acknowledgement.
db.acknowledge(owner,epoch,writer,'OP',committed);
// @ts-expect-error An ACK requires a cloud base, not a checkpoint with local seq.
db.acknowledge(owner,epoch,writer,'OP',checkpoint);
// @ts-expect-error Sequences remain numeric through the actual journal writer.
db.append(owner,epoch,writer,{...operation,data:{...operation.data,seq:'1'}});
// @ts-expect-error An epoch is an identity, not a revision.
db.append(owner,1,writer,operation);
// @ts-expect-error A cloud base cannot replace a transaction operation.
db.append(owner,epoch,writer,base);
// @ts-expect-error Atomic account adoption needs both documents and revisions.
db.adoptFencedAccount('orders','A',{mainState:{},mainCloudState:{},mainRevision:1});
db.adoptFencedAccount('orders','A',{mainState:{},mainCloudState:{},mainRevision:1,sharedState:{},sharedRevision:2});
// @ts-expect-error The scope owner cannot be inferred from a numeric account ID.
db.install(42,checkpoint,writer);
void [installed,seq,premature];
