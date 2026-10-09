// Compile-only current-writer and ACK consumers; never execute invalid calls.
import {createStorageCheckpoint,createStorageJournalRecord,createStorageCloudBase,createStorageCloudFlight} from '../../shared/storage-records.js';
import {assertStorageCloudAck} from '../../shared/storage-cloud-ack.js';
import {cloudHeadIsSynced} from '../../shared/storage-cloud-status.js';
import {createStorageCheckpoint as createKupaCheckpoint} from '../../netunim-kupa/site/assets/js/shared/storage-records.js';
import {createStorageCheckpoint as createOrdersCheckpoint} from '../../netunim-orders/site/assets/js/shared/storage-records.js';

const scope={owner:'account:kupa',epoch:'journal-epoch'};
const state={notes:[{id:'N',text:'retained'}],settings:{enabled:true}};
const checkpointInput={...scope,seq:3,state,appMetadata:{storageRole:'primary'},savedAt:'2026-10-09T00:00:00Z'};
const checkpoint=createStorageCheckpoint(checkpointInput);
createKupaCheckpoint(checkpointInput);
createOrdersCheckpoint(checkpointInput);
// @ts-expect-error generated Kupa contracts must resolve data types and reject callbacks
createKupaCheckpoint({...checkpointInput,state:{callback:()=>{}}});
// @ts-expect-error generated Orders contracts must resolve data types and reject Date
createOrdersCheckpoint({...checkpointInput,state:{date:new Date()}});
/** @type {2} */ const checkpointVersion=checkpoint.version;
const firstNote=checkpoint.state.notes[0];
if(!firstNote)throw new Error('fixture needs its first note');
/** @type {string} */ const noteId=firstNote.id;
// @ts-expect-error numeric journal epoch cannot be confused with login epoch
createStorageCheckpoint({...checkpointInput,epoch:1});
// @ts-expect-error current checkpoint sequence is numeric
createStorageCheckpoint({...checkpointInput,seq:'3'});
// @ts-expect-error checkpoint metadata is required for a current writer
createStorageCheckpoint({...scope,seq:3,state,savedAt:'stamp'});
// @ts-expect-error callbacks are not persisted JSON state
createStorageCheckpoint({...checkpointInput,state:{notes:[],clock:()=>0}});
// @ts-expect-error Date instances must be converted by the business owner
createStorageCheckpoint({...checkpointInput,state:{createdAt:new Date()}});
// @ts-expect-error undefined metadata cannot be silently serialized away
createStorageCheckpoint({...checkpointInput,appMetadata:{missing:undefined}});
// @ts-expect-error checkpoint state is an object, not a detached scalar
createStorageCheckpoint({...checkpointInput,state:noteId});
// @ts-expect-error current writers do not select a different persisted version
createStorageCheckpoint({...checkpointInput,version:1});
// @ts-expect-error a base cursor is not a local checkpoint
/** @type {import('../../shared/storage-records.js').StorageCloudBase<typeof state>} */ const wrongBase=checkpoint;

/** @type {import('../../shared/storage-records.js').StorageChange[]} */
const changes=[{type:'put',collection:'notes',id:'N',mode:'replace',record:{id:'N',text:'changed'}},
  {type:'put',collection:'notes',id:'M',mode:'insert',index:1,record:{id:'M',text:'inserted'}},
  {type:'delete',collection:'notes',id:'old'}, {type:'set',field:'settings',value:{enabled:false}}];
const operationInput={...scope,seq:4,generation:2,operationId:'local-4',at:'stamp',surface:'notes',mutationType:'edit',changes,deleteIntents:{notes:['old']},appMetadata:{}};
const operation=createStorageJournalRecord(operationInput);
/** @type {2} */ const journalVersion=operation.version;
// @ts-expect-error operation identity cannot be numeric
createStorageJournalRecord({...operationInput,operationId:4});
// @ts-expect-error generation is a local numeric counter
createStorageJournalRecord({...operationInput,generation:'2'});
// @ts-expect-error insert requires its explicit ordering index
createStorageJournalRecord({...operationInput,changes:[{type:'put',collection:'notes',id:'M',mode:'insert',record:{id:'M'}}]});
// @ts-expect-error ID-preserving records require a string ID
createStorageJournalRecord({...operationInput,changes:[{type:'put',collection:'notes',id:'M',mode:'replace',record:{id:5}}]});
// @ts-expect-error implicit upsert is not a journal operation
createStorageJournalRecord({...operationInput,changes:[{type:'put',collection:'notes',id:'M',mode:'upsert',record:{id:'M'}}]});
// @ts-expect-error unsupported replace-collection cannot express deletion
createStorageJournalRecord({...operationInput,changes:[{type:'replace-collection',collection:'notes',records:[]}]});
// @ts-expect-error deleted identities are an explicit string array
createStorageJournalRecord({...operationInput,deleteIntents:{notes:[5]}});
// @ts-expect-error scalar updates cannot contain executable callbacks
createStorageJournalRecord({...operationInput,changes:[{type:'set',field:'settings',value:()=>{}}]});
// @ts-expect-error non-JSON app metadata is not a durable operation
createStorageJournalRecord({...operationInput,appMetadata:{pending:Promise.resolve(true)}});
// @ts-expect-error persisted surface is a string
createStorageJournalRecord({...operationInput,surface:5});

const baseInput={...scope,revision:8,state,ackSeq:3};
const base=createStorageCloudBase(baseInput);
/** @type {'cloud'} */ const projection=base.projection;
/** @type {2} */ const baseVersion=base.version;
// @ts-expect-error ACK counter is mandatory, independent of cloud revision
createStorageCloudBase({...scope,revision:8,state});
// @ts-expect-error cloud revision is numeric
createStorageCloudBase({...baseInput,revision:'8'});
// @ts-expect-error ACK sequence is numeric
createStorageCloudBase({...baseInput,ackSeq:'3'});
// @ts-expect-error callers cannot override the current cloud projection
createStorageCloudBase({...baseInput,projection:'local'});
// @ts-expect-error a Cloud Base is not an immutable send Flight
/** @type {import('../../shared/storage-records.js').StorageCloudFlight<typeof state>} */ const wrongFlight=base;

const flightInput={...scope,operationId:'send-4',baseRevision:8,startSeq:4,endSeq:4,snapshot:state,deleteIntents:{notes:['old']},generation:2,mutationType:'edit',surface:'notes'};
const flight=createStorageCloudFlight(flightInput);
flight.audit={mutationType:'edit',version:journalVersion};
/** @type {2} */ const flightVersion=flight.version;
// @ts-expect-error RPC generation cannot replace the numeric flight end sequence
createStorageCloudFlight({...flightInput,endSeq:'4'});
// @ts-expect-error flight base revision is not a serialized string
createStorageCloudFlight({...flightInput,baseRevision:'8'});
// @ts-expect-error snapshot must preserve JSON-compatible business state
createStorageCloudFlight({...flightInput,snapshot:{notes:[],latest:new Map()}});
// @ts-expect-error delete intents retain record identities as strings
createStorageCloudFlight({...flightInput,deleteIntents:{notes:[7]}});
// @ts-expect-error audit cannot hold an asynchronous work result
flight.audit={result:Promise.resolve(true)};
const flightNote=flight.snapshot.notes[0];
if(!flightNote)throw new Error('fixture needs its flight note');
// @ts-expect-error State generic retains its original identity field type
/** @type {number} */ const wrongNoteId=flightNote.id;

const acknowledged=createStorageCloudBase({...baseInput,ackSeq:flight.endSeq});
assertStorageCloudAck(acknowledged,flight,scope);
cloudHeadIsSynced({seq:4,base:acknowledged,flight:null,control:null,pending:false},{revision:8});
// @ts-expect-error a local checkpoint is not durable ACK cursor evidence
assertStorageCloudAck(checkpoint,flight,scope);
// @ts-expect-error ACK revision evidence is numeric
assertStorageCloudAck({...acknowledged,revision:'8'},flight,scope);
// @ts-expect-error operation identity alone does not prove acknowledged range
assertStorageCloudAck(acknowledged,{operationId:'send-4'},scope);
// @ts-expect-error a captured owner epoch is required by the durable boundary
assertStorageCloudAck(acknowledged,flight,{owner:scope.owner});
