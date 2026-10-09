import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

// Deterministic inputs also used to capture the pre-refactor sealed records.
// This exercises production writers, not the constructors in isolation.
export async function storageWriterScenario(createStorageJournal){
  const db=memoryDb(),emergency=emergencyStore(),snapshots={};let nextId=0;
  const schema={collections:['notes'],fields:['setting']};
  const validate=state=>{if(!Array.isArray(state.notes)||new Set(state.notes.map(note=>note.id)).size!==state.notes.length)throw Error('invalid fixture state')};
  const journal=createStorageJournal({owner:'writer-contract',schema,validate,db,emergency,
    operationId:()=>`id-${++nextId}`,now:()=> '2026-10-09T00:00:00.000Z'});
  const initial={notes:[{id:'N',text:'original'}],setting:true};
  const capture=async name=>{snapshots[name]=await db.load()};
  await journal.initializeCloudHead(5,initial,{appMetadata:{storageRole:'primary',mainProjectionVersion:2}});
  await capture('initialized');
  await journal.append([{type:'put',collection:'notes',id:'N',mode:'replace',record:{id:'N',text:'sent'}}],{generation:1,surface:'notes'}).committed;
  await journal.append([{type:'put',collection:'notes',id:'M',mode:'insert',index:1,record:{id:'M',text:'inserted'}}],{generation:2,surface:'notes'}).committed;
  await capture('appended');
  await journal.compact();await capture('compactedPending');
  const flight=await journal.materializeFlight({operationId:'send-1',baseRevision:5,
    prepareAudit:value=>({deviceLabel:'fixture',generation:value.generation})});
  await capture('flight');
  await journal.append([{type:'put',collection:'notes',id:'N',mode:'replace',record:{id:'N',text:'newer pending'}}],{generation:3,surface:'notes'}).committed;
  await capture('newerPending');
  const newer=(await journal.recover()).state;
  await journal.acknowledge(flight.operationId,6,flight.snapshot,{checkpointState:newer,expectedSeq:3,
    appMetadata:{revision:6},control:{retry:{attempts:1}}});
  await capture('acknowledged');
  await journal.compact();await capture('compactedAcknowledged');
  const retry=await journal.materializeFlight({operationId:'send-2',baseRevision:6});
  const remote={notes:[...newer.notes,{id:'R',text:'other device'}],setting:false};
  await journal.rejectAndRebase(retry.operationId,7,remote,{checkpointState:remote,expectedSeq:3,
    appMetadata:{revision:7},control:{conflict:{kind:'remote'}}});
  await capture('rebased');
  return {snapshots,db,emergency,schema,validate};
}
