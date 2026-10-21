// Runs inside two independent Chromium profiles. Only the remote CAS head is
// relayed by Python; merge, validation, journal, fencing and restart are real.
export async function createRapidProfile(app,initialize){
  const clone=structuredClone;
  const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
  const {STORAGE_SCHEMAS}=await import('./assets/js/shared/storage-v2-schema.js');
  const {INITIAL_STATE}=await import('./assets/js/state/constants.js');
  const {createStateNormalization}=await import(app==='orders'?'./assets/js/state/normalization.js':'./assets/js/composition/state-normalization.js');
  const {createSyncMerge}=await import('./assets/js/sync/merge.js');
  const {structuredSyncConflict}=await import('./assets/js/shared/cloud-sync.js');
  const validation=await import('./assets/js/state/validation.js');
  const collection=app==='orders'?'transactions':'cash',model={state:clone(INITIAL_STATE)};
  const normalization=createStateNormalization({model});
  const project=app==='kupa'?normalization.prepareKupaCloudState:value=>{const out=clone(value);delete out.checks;delete out._meta;return out};
  const validate=value=>app==='orders'?validation.assertValidOrderCloudState(value,'rapid fixture'):validation.assertValidCloudState(value,'rapid fixture');
  const merger=createSyncMerge({normalizeState:normalization.normalizeState,prepareKupaCloudState:project});
  const merge=app==='orders'?merger.merge3:merger.mergeKupaCloudState3Way;
  const journal=createStorageJournal({owner:'rapid-profiles:'+app,schema:STORAGE_SCHEMAS[app],validate});
  if(initialize){
    if(app==='orders'){
      model.state.suppliers=[{id:'S',name:'Fixture supplier'}];
      model.state.transactions=[{id:'R',supplierId:'S',sequence:1,kind:'חיוב',action:'fixture',debit:100,credit:0,invoiceReceived:false,signed:false,supplied:false,supplyInfo:'',note:'base',message:'base',updatedAt:'2026-10-21T00:00:00Z'}];
    }else model.state.cash=[{id:'R',date:'2026-10-21',type:'הכנסה',amount:100,description:'base',note:'base'}];
    const base=project(normalization.normalizeState(model.state));
    await journal.initializeCloudHead(10,base,{appMetadata:{storageRole:'primary',mainProjectionVersion:2}});
  }else await journal.open();
  async function state(){const recovered=await journal.recover(),cloud=await journal.cloudState();return {state:recovered.state,seq:recovered.seq,cloud}}
  async function burst(side,count){
    let row=(await journal.recover()).state[collection].find(value=>value.id==='R');const writes=[];
    for(let i=1;i<=count;i++){
      row={...row,...(side==='A'?(app==='orders'?{invoiceReceived:i%2===0,message:`local-${i}`}:{description:`local-${i}`}):{note:`remote-${i}`}),updatedAt:new Date(Date.UTC(2026,9,21,0,0,i+(side==='B'?count:0))).toISOString()};
      writes.push(journal.append([{type:'put',collection,id:'R',mode:'replace',record:row}],{generation:i,surface:'test.rapid-profiles'}).committed);
    }
    await Promise.all(writes);
    const cloud=await journal.cloudState(),flight=await journal.materializeFlight({operationId:`rapid-${app}-${side}-${cloud.seq}`,baseRevision:cloud.base.revision});
    return {flight,head:await state()};
  }
  async function reconcile(remote){
    const cloud=await journal.cloudState(),flight=cloud.flight,local=(await journal.recover()).state;
    const merged=merge(cloud.base.state,flight.snapshot,remote.state);
    const control=merged.conflicts.length?{conflict:structuredSyncConflict({domain:app,conflicts:merged.conflicts,base:cloud.base.state,local:flight.snapshot,remote:remote.state,generation:flight.generation,baseRevision:flight.baseRevision,currentRemoteRevision:remote.revision})}:null;
    const candidate=merged.conflicts.length?local:project(merged.state);validate(candidate);
    await journal.rejectAndRebase(flight.operationId,remote.revision,remote.state,{expectedSeq:cloud.seq,checkpointState:candidate,control});
    if(control)return {conflicts:merged.conflicts,head:await state()};
    const rotated=await journal.materializeFlight({operationId:`rapid-${app}-rotated-${cloud.seq}`,baseRevision:remote.revision});
    return {conflicts:[],flight:rotated,head:await state()};
  }
  async function contradict(side){
    const row={...(await journal.recover()).state[collection][0],note:`contradiction-${side}`};
    const seq=journal.seq+1;await journal.append([{type:'put',collection,id:'R',mode:'replace',record:row}],{generation:seq}).committed;
    const cloud=await journal.cloudState();return journal.materializeFlight({operationId:`rapid-${app}-conflict-${side}`,baseRevision:cloud.base.revision});
  }
  return {collection,state,burst,reconcile,contradict,
    retry:async()=>journal.materializeFlight(),
    acknowledge:(flight,revision)=>journal.acknowledge(flight.operationId,revision,flight.snapshot),
    adopt:remote=>journal.adoptCloudHead(remote.revision,remote.state,remote.state)};
}
