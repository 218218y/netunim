import {createOperationId} from './cloud-sync.js';
import {beginMeasure,recordPerformanceValue} from './runtime-performance.js';
import {createStorageJournalDb} from './storage-journal-idb.js';
import {sealStorageRecord,readStorageRecord,validateStoredOperation,replayStorageJournal} from './storage-journal-model.js';

// Experimental local store. Application adapters use shadow mode only; no cloud
// API, local-file authority, legacy snapshot or legacy outbox is changed here.
export function createStorageJournal({owner,schema,validate,primary=()=>true,db=createStorageJournalDb(),emergency=globalThis.localStorage,operationId=()=>createOperationId('storage-v2'),now=()=>new Date().toISOString(),maxEmergencyBytes=131072,maxEmergencyEntries=64}={}){
  if(!owner||!schema||!validate)throw new Error('storage_configuration_required');
  const prefix='netunim-storage-v2-emergency:'+encodeURIComponent(owner)+':',writer=operationId();
  let epoch=null,seq=0,queue=Promise.resolve(),ready=false,failed=null;
  const pending=new Map();
  const guard=()=>{if(!primary())throw new Error('storage_secondary_tab');if(!ready)throw new Error('storage_not_ready');if(failed)throw failed};
  function enqueue(work){const result=queue.then(work);queue=result.catch(error=>{failed=error});return result}
  function readEmergency(){
    if(!emergency)throw new Error('storage_emergency_unavailable');
    const records=[];
    for(let i=0;i<emergency.length;i++){const key=emergency.key(i);if(!key?.startsWith(prefix))continue;const raw=emergency.getItem(key);const sealed=JSON.parse(raw);const op=readStorageRecord(sealed);if(op.owner!==owner)throw new Error('storage_emergency_owner');records.push(sealed)}
    return records;
  }
  function emergencyKey(operation){return prefix+encodeURIComponent(operation.epoch)+':'+operation.seq}
  function writeEmergency(record){const done=beginMeasure('storage:journal-emergency');try{
    const text=JSON.stringify(record);recordPerformanceValue('storage:bytes:journal-emergency',new TextEncoder().encode(text).length);
    if(pending.size>=maxEmergencyEntries||text.length*2+[...pending.values()].reduce((sum,value)=>sum+value.length*2,0)>maxEmergencyBytes)return false;
    const key=emergencyKey(record.data),existing=emergency.getItem(key);
    if(existing!==null&&existing!==text)throw new Error('storage_emergency_sequence_collision');
    emergency.setItem(key,text);if(emergency.getItem(key)!==text)throw new Error('storage_emergency_verification');pending.set(key,text);return true;
  }catch{return false}finally{done()}}
  function cleanEmergency(record){const key=emergencyKey(record.data);try{
    const text=emergency.getItem(key);
    // Never remove an entry replaced by another writer or a newer operation.
    if(text&&JSON.stringify(JSON.parse(text))!==JSON.stringify(record))throw new Error('storage_emergency_changed');
    emergency.removeItem(key);pending.delete(key);
  }catch{/* A committed duplicate is safe; recovery checks its exact identity. */}}
  async function recover(){const done=beginMeasure('storage:replay');try{
    const stored=await db.load(owner);if(!stored.checkpoints)return null;
    const base=readStorageRecord(stored.checkpoints);
    if(base.owner!==owner||stored.metadata?.epoch!==base.epoch)throw new Error('storage_checkpoint_metadata');
    const committedSeq=stored.journal.reduce((maximum,record)=>Math.max(maximum,record.data.seq),base.seq);
    if(!Number.isSafeInteger(stored.metadata.seq)||committedSeq!==stored.metadata.seq)throw new Error('storage_committed_metadata_mismatch');
    const records=readEmergency();
    // A prior epoch is retained for diagnostics, but cannot cross a restore boundary.
    const applicable=records.filter(record=>record.data.epoch===base.epoch);
    const replay=replayStorageJournal(stored.checkpoints,[...stored.journal,...applicable],schema);
    if(replay.seq<stored.metadata.seq)throw new Error('storage_committed_journal_missing');
    validate(replay.state);return {...replay,stored,emergency:applicable};
  }finally{done()}}
  async function open(){if(!primary())throw new Error('storage_secondary_tab');let recovered=await recover();if(!recovered)return null;if(!primary())throw new Error('storage_secondary_tab');
    await db.claim(owner,recovered.epoch,writer);recovered=await recover();epoch=recovered.epoch;seq=recovered.seq;ready=true;failed=null;
    // Recovered emergency operations must commit before their entries are removed.
    for(const record of recovered.emergency.sort((a,b)=>a.data.seq-b.data.seq)){
      if(record.data.seq>recovered.stored.metadata.seq)await db.append(owner,epoch,writer,record);
      cleanEmergency(record);
    }
    return recovered;
  }
  async function install(state,{expectedEpoch=epoch}={}){
    if(!primary())throw new Error('storage_secondary_tab');validate(state);await queue;
    const nextEpoch=operationId(),checkpoint=sealStorageRecord({version:2,owner,epoch:nextEpoch,seq:0,state,savedAt:now()},{kind:'checkpoint'});
    const done=beginMeasure('storage:checkpoint');try{await db.install(owner,checkpoint,writer,{expectedEpoch});epoch=nextEpoch;seq=0;ready=true;failed=null;
      // The new epoch is durable before obsolete emergency entries are retired.
      for(const record of readEmergency())if(record.data.epoch!==epoch)cleanEmergency(record);
      return {epoch,seq};
    }finally{done()}
  }
  function append(changes,{generation=0,surface='unknown',mutationType='edit'}={}){
    guard();const operation={version:2,owner,epoch,seq:seq+1,generation,operationId:operationId(),at:now(),surface,mutationType,changes:structuredClone(changes)};
    validateStoredOperation(operation,schema);const record=sealStorageRecord(operation,{kind:'journal'}),emergencyDurable=writeEmergency(record);seq=operation.seq;
    const committed=enqueue(async()=>{if(!primary())throw new Error('storage_secondary_tab');const done=beginMeasure('storage:idb-journal');try{await db.append(owner,operation.epoch,writer,record);cleanEmergency(record);return true}finally{done()}});
    return {seq:operation.seq,operationId:operation.operationId,emergencyDurable,committed};
  }
  async function compact(){guard();await queue;if(failed)throw failed;const recovered=await recover();validate(recovered.state);
    const checkpoint=sealStorageRecord({version:2,owner,epoch:recovered.epoch,seq:recovered.seq,state:recovered.state,savedAt:now()},{kind:'checkpoint'}),done=beginMeasure('storage:checkpoint');
    try{await db.compact(owner,recovered.epoch,writer,checkpoint);return recovered.seq}finally{done()}
  }
  async function setCloudBase(revision,state){guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');validate(state);await queue;return db.setBase(owner,epoch,writer,sealStorageRecord({revision,state},{kind:'cloud-base'}))}
  async function materializeFlight({operationId:flightId,baseRevision,deleteIntents={},project=state=>state,validateCloud=validate}={}){
    guard();await queue;const recovered=await recover();
    if(recovered.stored.flights)return readStorageRecord(recovered.stored.flights);
    if(!flightId)throw new Error('storage_flight_id_required');
    if(!Number.isSafeInteger(baseRevision)||baseRevision<0||!recovered.stored.bases||readStorageRecord(recovered.stored.bases).revision!==baseRevision)throw new Error('storage_cloud_base_mismatch');
    const done=beginMeasure('storage:outbox-materialize');let snapshot;
    try{snapshot=project(recovered.state);validateCloud(snapshot)}finally{done()}
    const value={version:2,owner,epoch,operationId:flightId,baseRevision,endSeq:recovered.seq,snapshot,deleteIntents:structuredClone(deleteIntents)};
    const sealed=sealStorageRecord(value,{kind:'flight-payload'}),flightDone=beginMeasure('storage:flight-write');
    try{await db.beginFlight(owner,epoch,writer,sealed);return readStorageRecord(sealed)}finally{flightDone()}
  }
  async function acknowledge(flightId,revision,state){guard();validate(state);await queue;return db.acknowledge(owner,epoch,writer,flightId,sealStorageRecord({revision,state},{kind:'cloud-base'}))}
  return {open,install,append,recover,compact,setCloudBase,materializeFlight,acknowledge,settled:()=>queue,get ready(){return ready&&!failed},get epoch(){return epoch},get seq(){return seq},get error(){return failed}};
}
