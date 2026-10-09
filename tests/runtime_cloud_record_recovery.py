"""Cloud record kind/scope authority in isolated real IndexedDB profiles."""
import json
from browser_harness import BrowserSession, ROOT

all_failures=[]
for app in ('kupa', 'orders'):
    with BrowserSession(ROOT/f'netunim-{app}/site', f'{app}-cloud-record-recovery') as browser:
        result=browser.evaluate(r"""(async()=>{
          const app=APP,clone=structuredClone,dump=JSON.stringify,report=[];let serial=0;
          const {INITIAL_STATE}=await import('./assets/js/state/constants.js');
          const {createStateNormalization}=await import(app==='kupa'?'./assets/js/composition/state-normalization.js':'./assets/js/state/normalization.js');
          const validation=await import('./assets/js/state/validation.js');
          const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
          const {createSharedChecksStorageV2,validateSharedChecksState}=await import('./assets/js/shared/shared-checks-storage-v2.js');
          const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const {STORAGE_SCHEMAS}=await import('./assets/js/shared/storage-v2-schema.js');
          const {sealStorageRecord}=await import('./assets/js/shared/storage-journal-model.js');
          const db=createStorageJournalDb(),slots=['checkpoints','metadata','journal','bases','flights','controls'];
          async function write(owner,values){
            const handle=await new Promise((resolve,reject)=>{const request=indexedDB.open('netunim-storage-v2');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
            try{await new Promise((resolve,reject)=>{const tx=handle.transaction(slots,'readwrite');
              for(const [slot,value] of Object.entries(values)){
                const store=tx.objectStore(slot);
                if(slot==='journal'){for(const record of value)store.put(record,[owner,record.data.epoch,record.data.seq])}
                else if(value==null)store.delete(owner);else store.put(value,owner);
              }
              tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
            })}finally{handle.close()}
          }
          for(const domain of ['main','shared'])for(const [scenario,slot,patch,expected] of [
            ['materialize','flights',{owner:'foreign-account'},'storage_cloud_flight_mismatch'],
            ['ack','flights',{owner:'foreign-account'},'storage_cloud_flight_mismatch'],
            ['recover','controls',{retry:{attempts:-1}},'storage_invalid_cloud_control'],
            ['cloud','bases',{version:1},'storage_invalid_cloud_base'],
          ]){
            const account='cloud-record-'+(++serial),owner=account+':'+(domain==='main'?app:'shared-checks');
            const model={state:clone(INITIAL_STATE)},normalization=createStateNormalization({model});model.state=normalization.normalizeState(model.state);
            const initial=domain==='shared'?{checks:[],bankEvents:[]}:app==='kupa'?normalization.prepareKupaStorageState(model.state):clone(model.state);
            if(domain==='main'){delete initial.checks;initial.notes=[]}
            const validate=domain==='shared'?validateSharedChecksState:state=>app==='kupa'?validation.assertKupaEntityInvariants(state,{required:true,includeChecks:false}):validation.assertOrderEntityInvariants(state,{required:true});
            const schema=domain==='main'?STORAGE_SCHEMAS[app]:{collections:['checks'],fields:['bankEvents']};
            const make=()=>createStorageJournal({owner,schema,validate,db}),seed=make();
            await seed.initializeCloudHead(7,initial,{appMetadata:{storageRole:domain==='main'?'primary':'shared-checks-primary',...(domain==='main'?{mainProjectionVersion:2}:{})}});
            const collection=domain==='main'?'notes':'checks',entry=domain==='main'?{id:'N',content:'retained'}:{id:'C',amount:125};
            await seed.append([{type:'put',collection,mode:'insert',index:0,id:entry.id,record:entry}],{generation:1}).committed;
            const flight=await seed.materializeFlight({operationId:'immutable-'+serial,baseRevision:7});await seed.setCloudControl({retry:{attempts:1}});
            const original=await db.load(owner);await write(owner,{[slot]:sealStorageRecord({...original[slot].data,...patch})});const before=dump(await db.load(owner));
            let code=null,ready=false,fatal=true;
            try{
              if(scenario==='materialize')await seed.materializeFlight({operationId:'replacement',baseRevision:7});
              else if(scenario==='ack')await seed.acknowledge(flight.operationId,8,flight.snapshot);
              else if(scenario==='cloud')await seed.cloudState();
              else if(domain==='main'){
                const runtime=createStorageV2Runtime({app,owner:()=>account,primary:()=>true,mode:()=> 'primary',validate,createJournal:options=>createStorageJournal({...options,db})});
                await runtime.recover();code=runtime.diagnostics.lastError;ready=runtime.primaryReady;fatal=runtime.diagnostics.recoveryFailure==='fatal';
              }else{
                const runtime=createSharedChecksStorageV2({owner:()=>account,primary:()=>true,db});await runtime.open();ready=true;
              }
            }catch(error){code=error.message}
            const unchanged=dump(await db.load(owner))===before;
            // Test-only restoration of the exact captured record set, including
            // the original writer. A baseline ACK may have changed several slots.
            await write(owner,original);const fresh=make(),recovered=await fresh.open(),cloud=await fresh.cloudState();
            const retained=dump(recovered.state[collection])===dump([entry])&&cloud.pending&&cloud.base.revision===7&&cloud.base.ackSeq===0&&dump(cloud.flight)===dump(flight);
            await fresh.acknowledge(flight.operationId,8,flight.snapshot);
            const last=make(),final=await last.open(),clean=await last.cloudState();
            const replay=dump(final.state[collection])===dump([entry])&&!clean.pending&&!clean.flight&&!clean.control&&clean.base.revision===8&&clean.base.ackSeq===1;
            report.push({domain,scenario,slot,expected,code,ready,fatal,unchanged,retained,replay});
          }
          return report;
        })()""".replace('APP',json.dumps(app)),timeout=40)
        failures=[row for row in result if not (row['code']==row['expected'] and not row['ready'] and row['fatal'] and row['unchanged'] and row['retained'] and row['replay'])]
        print(f'{app} cloud-record recovery: {json.dumps(result,ensure_ascii=False)}',flush=True)
        assert not browser.drain_serious_errors()
        all_failures.extend({'app':app,**row} for row in failures)
        if not failures:
            print(f'PASS {app} real IDB cloud record decoding: {len(result)} Main/Shared scenarios, retained stores/writer, exact restoration and original IDs after durable ACK')
assert not all_failures, f'real IDB cloud record failures: {json.dumps(all_failures,ensure_ascii=False)}'
