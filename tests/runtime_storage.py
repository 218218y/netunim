"""Real IndexedDB transactions, journal recovery, fault injection and byte scaling."""
import json
from browser_harness import LegacyBrowserSession as BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-kupa/site','storage-v2-crash-matrix') as browser:
    result=browser.evaluate(r"""(async()=>{
      const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {readStorageRecord}=await import('./assets/js/shared/storage-journal-model.js');
      const schema={collections:['notes'],fields:['setting']},done=[];
      const validate=state=>{if(!Array.isArray(state.notes)||new Set(state.notes.map(row=>row.id)).size!==state.notes.length)throw Error('invalid state')};
      const initial={notes:[{id:'n',text:'original'}],setting:1};
      const change=text=>[{type:'put',collection:'notes',mode:'replace',id:'n',record:{id:'n',text}}];
      const check=(condition,label)=>{if(!condition)throw Error(label);done.push(label)};
      const fails=async work=>{try{await work()}catch{return true}return false};
      const db=createStorageJournalDb(),make=(owner,options={})=>createStorageJournal({owner,schema,validate,db,...options});
      const text=async journal=>(await journal.recover()).state.notes[0]?.text;

      let journal=make('matrix');await journal.install(initial);
      // No acknowledged operation exists before emergency or IDB durability.
      check(await text(make('matrix'))==='original','before emergency: durable checkpoint unchanged');
      const failDb={...db,append:async()=>{throw Error('injected IDB failure')}};
      journal=make('matrix',{db:failDb});await journal.open();let write=journal.append(change('emergency'));
      check(write.emergencyDurable,'emergency verified before IDB');await fails(()=>write.committed);
      journal=make('matrix');await journal.open();check(await text(journal)==='emergency','restart replays emergency after failed IDB');

      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='journal'){this.transaction.abort();throw Error('injected transaction abort')}return result};
      write=journal.append(change('aborted'));await fails(()=>write.committed);IDBObjectStore.prototype.put=put;
      check((await db.load('matrix')).metadata.seq===1,'aborted journal transaction leaves metadata atomic');
      journal=make('matrix');await journal.open();check(await text(journal)==='aborted','restart recovers aborted journal operation');

      const noCleanup={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:()=>{throw Error('crash before cleanup')},key:index=>localStorage.key(index),get length(){return localStorage.length}};
      journal=make('matrix',{emergency:noCleanup});await journal.open();write=journal.append(change('committed'));await write.committed;
      journal=make('matrix');await journal.open();check(await text(journal)==='committed','IDB plus emergency duplicate replays exactly once');

      const before=await db.load('matrix');
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='checkpoints'){this.transaction.abort();throw Error('crash in compaction')}return result};
      check(await fails(()=>journal.compact()),'checkpoint transaction abort reported');IDBObjectStore.prototype.put=put;
      const after=await db.load('matrix');check(JSON.stringify(before)===JSON.stringify(after),'aborted checkpoint preserves checkpoint and journal');
      await journal.compact();check((await db.load('matrix')).journal.length===0&&await text(journal)==='committed','atomic compaction retains state');

      let release,entered;const atCompact=new Promise(resolve=>{entered=resolve}),hold=new Promise(resolve=>{release=resolve});
      const delayedDb={...db,compact:async(...args)=>{entered();await hold;return db.compact(...args)}};
      journal=make('matrix',{db:delayedDb});await journal.open();const compacting=journal.compact();await atCompact;
      write=journal.append(change('during compaction'));await write.committed;release();await compacting;
      check((await db.load('matrix')).journal.length===1&&await text(journal)==='during compaction','new operation survives checkpoint boundary');

      let local=make('local-import');await local.install(initial);
      write=local.append(change('before import'));await write.committed;
      const beforeImport=await db.load('local-import'),imported={notes:[{id:'n',text:'imported'}],setting:1};
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='checkpoints'){this.transaction.abort();throw Error('injected local import abort')}return result};
      check(await fails(()=>local.replaceLocalAuthoritativeState(imported,{boundaryId:'local-import-1',expectedSeq:1})),'aborted local import transaction reported');
      IDBObjectStore.prototype.put=put;
      check(JSON.stringify(await db.load('local-import'))===JSON.stringify(beforeImport),'aborted local import preserves checkpoint and journal');
      await local.replaceLocalAuthoritativeState(imported,{boundaryId:'local-import-1',expectedSeq:1});
      check((await db.load('local-import')).journal.length===0,'local import atomically retires superseded operations');
      local=make('local-import');await local.open();
      check(await text(local)==='imported'&&(await local.cloudState()).base===null,'local import survives restart without a cloud cursor');

      const cloudBaseState=(await journal.recover()).state;
      check(await fails(()=>journal.setCloudBase(4,cloudBaseState)),'cloud base requires an explicit acknowledged cursor');
      await journal.setCloudBase(4,cloudBaseState,{ackSeq:journal.seq});
      check(await journal.materializeFlight({operationId:'empty-flight',baseRevision:4})===null,'cloud cursor does not materialize an empty flight');
      write=journal.append(change('sent'));await write.committed;
      const flight=await journal.materializeFlight({operationId:'cloud-operation',baseRevision:4});
      check(flight?.snapshot?.notes?.[0]?.text==='sent','real pending mutation materializes the immutable flight');
      write=journal.append(change('during RPC'));await write.committed;
      journal=make('matrix');await journal.open();
      const retry=await journal.materializeFlight({operationId:'do-not-replace',baseRevision:4});
      check(JSON.stringify(retry)===JSON.stringify(flight),'lost ACK retry retains exact flight and operation ID');
      check(await fails(()=>journal.install(initial)),'restore cannot discard unresolved flight');
      check(await fails(()=>journal.acknowledge('wrong-operation',5,flight.snapshot)),'wrong ACK rejected');
      await journal.acknowledge(flight.operationId,5,flight.snapshot);
      check(await text(journal)==='during RPC'&&!(await db.load('matrix')).flights,'ACK preserves later mutations');
      const next=await journal.materializeFlight({operationId:'second-flight',baseRevision:5});
      check(next.snapshot.notes[0].text==='during RPC','next flight materializes newer generation');
      await journal.acknowledge(next.operationId,6,next.snapshot);
      write=journal.append([{type:'delete',collection:'notes',id:'n'}],{deleteIntents:{notes:['n']}});await write.committed;await journal.compact();
      check((await db.load('matrix')).journal.length===1,'checkpoint retains cloud-unacknowledged operations');
      const deleteFlight=await journal.materializeFlight({operationId:'delete-flight',baseRevision:6});
      check(deleteFlight.deleteIntents.notes[0]==='n','flight derives explicit delete intents from pending journal range');
      await journal.acknowledge(deleteFlight.operationId,7,deleteFlight.snapshot);await journal.compact();
      check((await db.load('matrix')).journal.length===0,'acknowledged operation compacts after checkpoint');
      journal=make('matrix');await journal.open();check((await journal.recover()).state.notes.length===0,'explicit deletion never resurrects on restart');

      journal=make('projection');await journal.install(initial);await journal.setCloudBase(2,{document:{value:'base'}},{ackSeq:0,validateBase:value=>{if(!value?.document)throw Error('bad projection')}});
      write=journal.append(change('projected'));await write.committed;
      const projected=await journal.materializeFlight({operationId:'projection-flight',baseRevision:2,project:state=>({document:{value:state.notes[0].text}}),validateCloud:value=>{if(!value?.document)throw Error('bad projection')}});
      check(projected.snapshot.document.value==='projected','cloud base and flight use an explicit projection contract');
      await journal.acknowledge(projected.operationId,3,projected.snapshot,{validateBase:value=>{if(!value?.document)throw Error('bad projection')}});

      journal=make('rebase-crash');await journal.install(initial);await journal.setCloudBase(10,initial,{ackSeq:0});
      write=journal.append(change('local'));await write.committed;
      const rejectedFlight=await journal.materializeFlight({operationId:'rebase-old-flight',baseRevision:10});
      const remoteRebase={notes:[{id:'n',text:'original'}],setting:2},mergedRebase={notes:[{id:'n',text:'local'}],setting:2};
      const beforeRebase=await db.load('rebase-crash');
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='bases'){this.transaction.abort();throw Error('crash during atomic rebase')}return result};
      check(await fails(()=>journal.rejectAndRebase(rejectedFlight.operationId,11,remoteRebase,{checkpointState:mergedRebase,expectedSeq:1})),'rebase transaction abort reported');
      IDBObjectStore.prototype.put=put;
      check(JSON.stringify(await db.load('rebase-crash'))===JSON.stringify(beforeRebase),'aborted rebase retains old base, checkpoint and flight together');
      await journal.rejectAndRebase(rejectedFlight.operationId,11,remoteRebase,{checkpointState:mergedRebase,expectedSeq:1});
      journal=make('rebase-crash');await journal.open();
      const rebasedState=await journal.recover(),rebasedCloud=await journal.cloudState();
      check(rebasedState.state.notes[0].text==='local'&&rebasedState.state.setting===2&&rebasedCloud.base.revision===11&&!rebasedCloud.flight,'restart after reject retains remote-only and local changes');
      const replacement=await journal.materializeFlight({operationId:'rebase-new-flight',baseRevision:11});
      check(replacement.snapshot.notes[0].text==='local'&&replacement.snapshot.setting===2,'replacement flight cannot revert remote-only change');

      const quota={...noCleanup,removeItem:key=>localStorage.removeItem(key),setItem:()=>{throw Error('quota')}};
      journal=make('quota',{emergency:quota});await journal.install(initial);write=journal.append(change('IDB fallback'));
      check(!write.emergencyDurable,'quota failure is not reported durable');await write.committed;check(await text(journal)==='IDB fallback','IDB commit remains durable when LocalStorage fails');
      journal=make('both-fail',{emergency:quota,db:failDb});await journal.install(initial);write=journal.append(change('not durable'));
      check(!write.emergencyDurable&&await fails(()=>write.committed)&&!journal.ready,'both stores fail closed');
      check(await text(make('both-fail'))==='original','unacknowledged failed operation does not replace checkpoint');

      journal=make('fence');await journal.install(initial);const successor=make('fence');await successor.open();write=journal.append(change('stale writer'));
      check(await fails(()=>write.committed),'stale writer fenced by IDB transaction');
      check(await fails(()=>make('secondary',{primary:()=>false}).install(initial)),'secondary tab cannot install');

      journal=make('restore');await journal.install(initial);const oldEpoch=journal.epoch;write=journal.append(change('before restore'));await write.committed;
      await journal.install({notes:[{id:'restored',text:'backup'}],setting:2});
      check(journal.epoch!==oldEpoch&&(await journal.recover()).state.notes[0].id==='restored','restore changes epoch only after checkpoint commit');

      journal=make('authoritative-reset');await journal.install(initial);await journal.setCloudBase(8,initial,{ackSeq:0});
      write=journal.append(change('obsolete local'));await write.committed;await journal.materializeFlight({operationId:'obsolete-flight',baseRevision:8});await journal.setCloudControl({retry:{attempts:2}});
      const authoritativeEpoch=journal.epoch;await journal.replaceAuthoritativeState({notes:[{id:'restored',text:'authoritative'}],setting:3},{appMetadata:{storageRole:'primary',revision:0}});
      journal=make('authoritative-reset');await journal.open();let resetCloud=await journal.cloudState(),resetRecovered=await journal.recover();
      check(journal.epoch!==authoritativeEpoch&&resetRecovered.seq===0&&resetRecovered.state.notes[0].text==='authoritative'&&!resetCloud.base&&!resetCloud.flight&&!resetCloud.control&&!resetCloud.pending,'authoritative replacement atomically resets epoch, journal and cloud lifecycle across restart');

      journal=make('cloud-reset');await journal.install(initial);await journal.setCloudBase(9,initial,{ackSeq:0});
      write=journal.append(change('superseded local'));await write.committed;await journal.materializeFlight({operationId:'superseded-flight',baseRevision:9});await journal.setCloudControl({conflict:{kind:'restore'}});
      const cloudResetEpoch=journal.epoch,remoteReset={notes:[{id:'n',text:'restored remote'}],setting:4};await journal.resetCloudHead(12,remoteReset,remoteReset,{appMetadata:{storageRole:'primary',revision:12}});
      journal=make('cloud-reset');await journal.open();resetCloud=await journal.cloudState();resetRecovered=await journal.recover();
      check(journal.epoch!==cloudResetEpoch&&resetRecovered.seq===0&&resetRecovered.state.notes[0].text==='restored remote'&&resetCloud.base.revision===12&&resetCloud.base.ackSeq===0&&!resetCloud.flight&&!resetCloud.control&&!resetCloud.pending,'cloud reset atomically installs authoritative checkpoint and cursor across restart');

      journal=make('hard-restart',{db:failDb});await journal.install(initial);write=journal.append(change('survives navigation'));await fails(()=>write.committed);
      check(write.emergencyDurable,'hard restart fixture safely staged');

      const sizes=[];
      for(const count of [100,10000,50000]){
        const owner='scale-'+count,state={notes:Array.from({length:count},(_,i)=>({id:'n'+i,text:'x'.repeat(80)})),setting:1};
        journal=make(owner);const checkpointStart=performance.now();await journal.install(state);const checkpointMs=performance.now()-checkpointStart;
        const start=performance.now(),write=journal.append([{type:'put',collection:'notes',mode:'replace',id:'n0',record:{id:'n0',text:'small edit'}}]);
        const syncMs=performance.now()-start,raw=Object.keys(localStorage).filter(key=>key.startsWith('netunim-storage-v2-emergency:'+encodeURIComponent(owner)+':')).map(key=>localStorage.getItem(key));
        await write.committed;const idbMs=performance.now()-start,replayStart=performance.now();await journal.recover();
        sizes.push({count,syncMs,idbMs,checkpointMs,replayMs:performance.now()-replayStart,emergencyBytes:new TextEncoder().encode(raw.join('')).length,checkpointBytes:JSON.stringify(state).length});
      }
      check(Math.max(...sizes.map(x=>x.emergencyBytes))-Math.min(...sizes.map(x=>x.emergencyBytes))<32,'small edit bytes independent of total document');
      check(sizes.every(x=>x.emergencyBytes<2048),'bounded emergency payload');
      return {cases:done,sizes};
    })()""",timeout=90)
    browser._navigate()
    assert browser.evaluate("""(async()=>{
      const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
      const journal=createStorageJournal({owner:'hard-restart',schema:{collections:['notes'],fields:['setting']},validate:()=>{}});
      const recovered=await journal.open();return recovered.state.notes[0].text==='survives navigation';
    })()""")
    assert not browser.drain_serious_errors()
    directory=ROOT/'.work/storage-performance';directory.mkdir(parents=True,exist_ok=True)
    (directory/'latest.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print('PASS real IndexedDB crash/restart matrix and constant emergency bytes: '+json.dumps(result))

with BrowserSession(ROOT/'netunim-kupa/site','shared-checks-v2-primary-crash-matrix') as browser:
    result=browser.evaluate(r"""(async()=>{
      const {createSharedChecksStorageV2}=await import('./assets/js/shared/shared-checks-storage-v2.js');
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const db=createStorageJournalDb({name:'shared-checks-v2-primary-crash-matrix'}),owner=()=> 'browser-primary-account';
      const make=()=>createSharedChecksStorageV2({owner,primary:()=>true,db});
      const initial={checks:[{id:'C',amount:100}],bankEvents:[]};
      const put=IDBObjectStore.prototype.put,checks=[];
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='bases'){this.transaction.abort();throw Error('injected initialization abort')}return result};
      let rejected=false;
      try{await make().initializeCloudHead(0,initial,{intent:'upload-local',sourceOwner:'local',legacyPendingClean:true})}catch{rejected=true}
      IDBObjectStore.prototype.put=put;
      if(!rejected)throw Error('bootstrap transaction did not abort');
      const absent=await db.load('browser-primary-account:shared-checks');
      if(absent.checkpoints||absent.bases||absent.metadata||absent.journal.length)throw Error('bootstrap left a partial namespace');
      let store=make();await store.initializeCloudHead(0,initial,{intent:'upload-local',sourceOwner:'local',legacyPendingClean:true});
      store=make();await store.open();
      if((await store.recover()).state.checks[0].id!=='C'||!(await store.cloudState()).pending)throw Error('first upload not recovered');
      const flight=await store.materializeFlight({operationId:'first-upload'});
      if(flight.snapshot.checks[0].id!=='C'||flight.baseRevision!==0)throw Error('first upload flight changed');
      store=make();await store.open();const again=await store.materializeFlight({operationId:'must-reuse'});
      if(again.operationId!==flight.operationId||JSON.stringify(again.snapshot)!==JSON.stringify(flight.snapshot))throw Error('lost ACK changed flight');
      const remote={checks:[{id:'C',amount:100},{id:'D',amount:200}],bankEvents:[{seq:5,checkId:'D',delta:200}]};
      const merged={checks:remote.checks,bankEvents:remote.bankEvents};
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='bases'){this.transaction.abort();throw Error('injected rebase abort')}return result};
      rejected=false;try{await store.rejectAndRebase(flight.operationId,1,remote,{currentState:merged,expectedSeq:1})}catch{rejected=true}
      IDBObjectStore.prototype.put=put;
      if(!rejected||(await store.cloudState()).flight.operationId!==flight.operationId)throw Error('aborted rebase lost immutable flight');
      await store.rejectAndRebase(flight.operationId,1,remote,{currentState:merged,expectedSeq:1});
      store=make();await store.open();
      if((await store.recover()).state.bankEvents[0].seq!==5||(await store.cloudState()).base.revision!==1)throw Error('rebase restart lost bank event');
      checks.push('atomic first document','immutable lost ACK','aborted rebase','bank event after restart');
      return checks;
    })()""",timeout=60)
    assert not browser.drain_serious_errors()
    print('PASS Shared Checks V2 real IDB crash matrix: '+json.dumps(result))

with BrowserSession(ROOT/'netunim-kupa/site','storage-v2-boundary-crash-matrix') as browser:
    result=browser.evaluate(r"""(async()=>{
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const name='storage-v2-boundary-crash-matrix';
      await new Promise((resolve,reject)=>{const request=indexedDB.open(name,2);request.onupgradeneeded=()=>{for(const store of ['checkpoints','journal','metadata','bases','flights','controls'])if(!request.result.objectStoreNames.contains(store))request.result.createObjectStore(store)};request.onsuccess=()=>{request.result.close();resolve()};request.onerror=()=>reject(request.error)});
      const db=createStorageJournalDb({name}),record={version:2,owner:'A',id:'restore-1',kind:'restore',phase:'prepared',main:{kind:'replace-authoritative',state:{notes:[]}},shared:{kind:'replace-authoritative',state:{checks:[],bankEvents:[]}}};
      await db.beginBoundary('A',record);
      if((await db.readBoundary('A')).phase!=='prepared'||await db.readBoundary('B'))throw Error('v2 to v3 boundary upgrade failed');
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='boundaries'){this.transaction.abort();throw Error('injected boundary phase abort')}return result};
      let aborted=false;try{await db.advanceBoundary('A','restore-1','prepared','shared-applied')}catch{aborted=true}
      IDBObjectStore.prototype.put=put;
      if(!aborted||(await db.readBoundary('A')).phase!=='prepared')throw Error('aborted boundary stage changed durable intent');
      await db.advanceBoundary('A','restore-1','prepared','shared-applied');
      await db.advanceBoundary('A','restore-1','shared-applied','main-applied');await db.completeBoundary('A','restore-1');
      if((await db.readBoundary('A')).phase!=='complete')throw Error('completion marker missing');
      const duplicate=await db.beginBoundary('A',record);
      if(duplicate.phase!=='complete')throw Error('restore operation ID not idempotent');
      return ['v2 schema upgrade','account isolation','aborted phase remains prepared','complete operation ID is idempotent'];
    })()""",timeout=60)
    assert not browser.drain_serious_errors()
    print('PASS V2 boundary real IDB crash matrix: '+json.dumps(result))

with BrowserSession(ROOT/'netunim-kupa/site','storage-v2-local-import-idb') as browser:
    result=browser.evaluate(r"""(async()=>{
      const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const db=createStorageJournalDb(),schema={collections:['notes'],fields:[]},validate=state=>{if(!Array.isArray(state.notes))throw Error('invalid notes')};
      const owner='import-account:kupa',make=()=>createStorageJournal({owner,schema,validate,db});
      let journal=make();await journal.install({notes:[{id:'old'}]},{expectedEpoch:null,appMetadata:{storageRole:'primary'}});
      await journal.captureCloudCursor(8);
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='journal'){this.transaction.abort();throw Error('injected import abort')}return result};
      let aborted=false;try{await journal.replaceLocalWithPending({notes:[{id:'new'}]},{boundaryId:'import-idb',expectedSeq:0,expectedBaseRevision:8})}catch{aborted=true}
      IDBObjectStore.prototype.put=put;
      if(!aborted||(await db.load(owner)).metadata.seq!==0||(await journal.recover()).state.notes[0].id!=='old')throw Error('aborted import changed durable head');
      await journal.replaceLocalWithPending({notes:[{id:'new'}]},{boundaryId:'import-idb',expectedSeq:0,expectedBaseRevision:8});
      journal=make();const recovered=await journal.open(),cloud=await journal.cloudState();
      if(recovered.state.notes[0].id!=='new'||recovered.appMetadata.boundaryId!=='import-idb'||cloud.base.revision!==8||!cloud.pending||cloud.pendingDeleteIntents.notes[0]!=='old')throw Error('import restart lost state or delete intent');
      const flight=await journal.materializeFlight({operationId:'import-flight',baseRevision:8});
      if(flight.snapshot.notes[0].id!=='new'||flight.deleteIntents.notes[0]!=='old')throw Error('import flight incorrect');
      const shared=createStorageJournal({owner:'import-account:shared-checks',schema:{collections:['checks'],fields:['bankEvents']},validate:state=>{if(!Array.isArray(state.checks)||!Array.isArray(state.bankEvents))throw Error('invalid shared')},db});
      await shared.install({checks:[],bankEvents:[]},{expectedEpoch:null,appMetadata:{storageRole:'shared-checks-primary'}});await shared.captureCloudCursor(3);
      let cutoverBlocked=false;try{await db.markCutover('kupa','import-account')}catch(error){cutoverBlocked=error.message==='storage_cutover_head_not_clean'}
      if(!cutoverBlocked)throw Error('pending import permitted cutover marker');
      await journal.acknowledge(flight.operationId,9,flight.snapshot,{checkpointState:recovered.state,expectedSeq:1});
      if((await db.markCutover('kupa','import-account')).version!==2)throw Error('clean heads cannot mark cutover');
      return ['aborted import leaves old state and cursor atomic','restart recovers local pending import','flight carries exact deleted ID','cutover requires both clean heads'];
    })()""",timeout=60)
    assert not browser.drain_serious_errors()
    print('PASS V2 local import real IDB crash matrix: '+json.dumps(result))

with BrowserSession(ROOT/'netunim-kupa/site','storage-v2-local-engine-idb') as browser:
    result=browser.evaluate(r"""(async()=>{
      const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {verifyStorageV2LocalEngine,storageLocalEngineKey}=await import('./assets/js/shared/storage-v2-local-birth.js');
      const db=createStorageJournalDb(),scope='kupa:local',mainState={notes:[]},sharedState={checks:[],bankEvents:[]},stamp=new Date().toISOString();
      await db.initializeOwnerBinding('kupa','local');
      const plan={version:2,scope,app:'kupa',owner:'local',id:'local-birth-idb',phase:'prepared',mainState,sharedState,createdAt:stamp,updatedAt:stamp};
      await db.beginLocalBirth(scope,plan);
      const main=createStorageJournal({owner:'local:kupa',schema:{collections:['notes'],fields:[]},validate:()=>{},db});
      const shared=createStorageJournal({owner:'local:shared-checks',schema:{collections:['checks'],fields:['bankEvents']},validate:()=>{},db});
      await main.install(mainState,{expectedEpoch:null,appMetadata:{storageRole:'primary'}});
      let incomplete=false;try{await db.markLocalEngine('kupa')}catch(error){incomplete=error.message==='storage_local_engine_head_missing'}
      if(!incomplete)throw Error('incomplete local head marked V2');
      await shared.install(sharedState,{expectedEpoch:null,appMetadata:{storageRole:'shared-checks-primary'}});
      await db.advanceLocalBirth(scope,plan.id,'prepared','main-initialized');
      await db.advanceLocalBirth(scope,plan.id,'main-initialized','shared-initialized');
      await db.advanceLocalBirth(scope,plan.id,'shared-initialized','verified');
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='cutovers'){this.transaction.abort();throw Error('injected local marker abort')}return result};
      let aborted=false;try{await db.markLocalEngine('kupa')}catch{aborted=true}finally{IDBObjectStore.prototype.put=put}
      if(!aborted||await db.readLocalEngine('kupa'))throw Error('aborted local marker became visible');
      await db.markLocalEngine('kupa');
      const owner=()=> 'local',key=storageLocalEngineKey('kupa');
      if(!await verifyStorageV2LocalEngine({app:'kupa',owner,db})||localStorage.getItem(key)!=='2')throw Error('IDB marker did not repair cache');
      localStorage.removeItem(key);if(!await verifyStorageV2LocalEngine({app:'kupa',owner,db})||localStorage.getItem(key)!=='2')throw Error('cache repair failed');
      await db.advanceLocalBirth(scope,plan.id,'verified','complete');
      const settled=await db.readLocalBirth(scope);
      if(settled.mainState||settled.sharedState)throw Error('completed birth retained duplicate full snapshots');
      await db.reserveLocalOwnerTarget('kupa','another-account',{id:'adoption',intent:'upload-local'});
      let ownerFenced=false;try{await db.markLocalEngine('kupa')}catch(error){ownerFenced=error.message==='storage_local_engine_owner_changed'}
      if(!ownerFenced)throw Error('owner reservation did not fence marker retry');
      return ['two local heads required','marker transaction abort is atomic','IDB repairs cache','completed plan retires duplicate snapshots','owner reservation fences marker retry'];
    })()""",timeout=60)
    assert not browser.drain_serious_errors()
    print('PASS V2 local engine real IDB marker: '+json.dumps(result))

with BrowserSession(ROOT/'netunim-kupa/site','sheet-warm-navigation-freshness') as browser:
    assert browser.evaluate("""(async()=>{
      const {createDefaultNotesSheet}=await import('./assets/js/shared/notes-sheet-model.js');
      const book=createDefaultNotesSheet();book.rows=[{id:'fresh-row',sheetId:book.sheets[0].id,cells:{[book.columns[0].id]:'before'},createdAt:'',updatedAt:''}];
      let remote={revision:1,state:book},reads=0;
      cloudAuth.loadSupaSession=()=>({user:{id:'freshness-owner'}});cloudAuth.supaRest=async()=>{reads++;return new Response(JSON.stringify([remote]))};
      session.connectionMode='supabase';session.backendReady=false;ui.notesTab='sheet';
      await spreadsheetWorkspace.sync.open();setPage('notes');await spreadsheetWorkspace.activate();
      // Establish the navigation stamp after the asynchronous initial load.
      render();const previous=document.getElementById('content').firstChild;setPage('cash');
      remote=structuredClone(remote);remote.revision=2;remote.state.rows[0].cells[book.columns[0].id]='updated elsewhere';
      const before=reads;setPage('notes');
      const restoredImmediately=document.getElementById('content').firstChild===previous;
      await spreadsheetWorkspace.activate();
      if(!restoredImmediately||reads<=before||spreadsheetWorkspace.sync.revision!==2)throw Error('Warm sheet navigation did not poll immediately');
      const cell=document.querySelector('[data-sheet-cell][data-sheet-row-id="fresh-row"]');
      if(!cell||cell.value!=='updated elsewhere')throw Error('Remote sheet change was not rendered');
      return true;
    })()""")
    assert not browser.drain_serious_errors()
    print('PASS cached Kupa spreadsheet refreshes immediately on return without the 20-second timer')

with BrowserSession(ROOT/'netunim-kupa/site','storage-v2-fenced-cloud-recovery') as browser:
    result=browser.evaluate(r"""(async()=>{
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
      const {createSharedChecksStorageV2}=await import('./assets/js/shared/shared-checks-storage-v2.js');
      const {createStorageV2FencedRecovery}=await import('./assets/js/shared/storage-v2-fenced-recovery.js');
      const {createSharedChecksV2Composition}=await import('./assets/js/shared/shared-checks-v2-composition.js');
      const db=createStorageJournalDb({name:'storage-v2-fenced-cloud-recovery'}),owner='stale-account';
      await db.initializeOwnerBinding('kupa',owner);
      localStorage.setItem('kupa.browser.state.v1',JSON.stringify({notes:[{id:'legacy'}]}));
      const legacyMain={snapshot:{notes:[{id:'unsent-note'}]},operationId:'old-main-operation'};
      localStorage.setItem('kupa.cloud.pending.local.v1',JSON.stringify(legacyMain));
      const legacyChecks={snapshot:[{id:'unsent-check'}],bankEvents:[{id:'old-bank-event'}],operationId:'old-check-operation'};
      localStorage.setItem('kupa.shared.checks.pending.v1',JSON.stringify(legacyChecks));
      const legacyDatabase=await new Promise((resolve,reject)=>{const request=indexedDB.open('kupa-portable-handles',2);
        request.onupgradeneeded=()=>{request.result.createObjectStore('handles');request.result.createObjectStore('sync')};
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
      await new Promise((resolve,reject)=>{const tx=legacyDatabase.transaction('sync','readwrite');
        tx.objectStore('sync').put(legacyChecks,'shared-checks-outbox-v3');tx.objectStore('sync').put(legacyMain,'cloud-pending-v3');
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
      legacyDatabase.close();
      const main={notes:[{id:'cloud',content:'authoritative'}]},shared={checks:[{id:'check',amount:100}],bankEvents:[{seq:1,checkId:'check',type:'deposit'}]};
      let primary=true,protocol=2,remoteReads=0;
      const make=()=>createStorageV2FencedRecovery({app:'kupa',owner:()=>owner,primary:()=>primary,authenticatedOwner:()=>owner,
        readProtocolState:async()=>({orders:protocol,kupa:protocol,sharedChecks:protocol}),
        readMainRemote:async()=>{remoteReads++;return {revision:17,state:structuredClone(main)}},projectMainRemote:row=>row.state,
        readSharedRemote:async()=>({revision:9,state:structuredClone(shared)}),projectSharedRemote:row=>row.state,
        composeMainState:(cloud,checks)=>({...cloud,checks:checks.checks}),projectMainState:state=>({notes:state.notes}),
        validateMainState:state=>{if(!Array.isArray(state.notes)||!Array.isArray(state.checks))throw Error('invalid main')},
        validateMainCloud:state=>{if(!Array.isArray(state.notes))throw Error('invalid cloud')},db,storage:localStorage});
      const fails=async(work,match)=>{try{await work()}catch(error){return error.message===match}return false};
      primary=false;if(!await fails(()=>make().recover(),'storage_fenced_recovery_primary_required')||remoteReads)throw Error('secondary recovery read remote');
      primary=true;protocol=1;if(!await fails(()=>make().recover(),'storage_fenced_recovery_protocol_required')||remoteReads)throw Error('protocol 1 adopted');
      protocol=2;
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='cutovers'){this.transaction.abort();throw Error('injected marker abort')}return result};
      let aborted=false;try{await make().recover()}catch{aborted=true}finally{IDBObjectStore.prototype.put=put}
      if(!aborted||(await db.load(owner+':kupa')).checkpoints||(await db.load(owner+':shared-checks')).checkpoints||await db.readCutover('kupa:'+owner)||await db.readLegacyRecovery('kupa:'+owner))throw Error('aborted adoption exposed partial head');
      let legacyReads=0;const getItem=Storage.prototype.getItem;
      Storage.prototype.getItem=function(key){if(String(key).startsWith('kupa.browser.state.')||String(key).startsWith('kupa.cloud.pending.')||String(key).startsWith('kupa.shared.checks.'))legacyReads++;return getItem.call(this,key)};
      let adopted;try{adopted=await make().recover()}finally{Storage.prototype.getItem=getItem}
      if(legacyReads)throw Error('fenced cloud adoption read obsolete V1 storage');
      if(adopted.mainRevision!==17||adopted.sharedRevision!==9||localStorage.getItem('netunim-storage-cutover-version:kupa:'+owner)!=='2')throw Error('atomic adoption did not mark V2');
      const mainJournal=createStorageJournal({owner:owner+':kupa',schema:{collections:['notes','checks'],fields:[]},validate:()=>{},db});
      const recoveredMain=await mainJournal.open();
      const sharedJournal=createSharedChecksStorageV2({owner:()=>owner,primary:()=>true,db});
      const recoveredShared=await sharedJournal.open();
      if(recoveredMain.state.notes[0].id!=='cloud'||recoveredMain.state.checks[0].id!=='check'||
        recoveredShared.state.checks[0].id!=='check'||recoveredShared.state.bankEvents[0].seq!==1||
        (await mainJournal.cloudState()).base.revision!==17||(await sharedJournal.cloudState()).base.revision!==9)throw Error('restart did not recover matching cloud heads');
      if(!localStorage.getItem('kupa.browser.state.v1')?.includes('legacy'))throw Error('read-only legacy copy was unexpectedly modified');
      if(await db.readLegacyRecovery('kupa:'+owner)||!await db.fencedLegacyInactive('kupa',owner)||
        (await db.readCutover('kupa:'+owner)).legacyDisposition!=='discarded')throw Error('obsolete V1 data was not durably marked inactive');
      let cleanCalls=0;const model={state:{checks:[]}};
      const composition=createSharedChecksV2Composition({site:'kupa',owner:()=>owner,primary:()=>true,model,checksSession:{},eventsKey:'bankEvents',
        domainRevisions:{touch:()=>{}},merge:()=>{},readRemote:async()=>({revision:9,state:structuredClone(shared)}),rpc:async()=>{throw Error('discarded V1 reached cloud RPC')},
        verifyLegacyClean:async()=>{cleanCalls++;return false},validateMainCloud:()=>{},applyMainState:()=>{},main:{setBoundaryGate:()=>{}},db});
      if(!await composition.recoverPrimary()||cleanCalls||model.state.checks[0].id!=='check')throw Error('discarded outbox blocked Shared V2 recovery');
      if(!await composition.runtime.sync()||cleanCalls)throw Error('discarded outbox blocked ordinary Shared V2 sync');
      if(!(await make().recover()).already)throw Error('repeat adoption did not use marker');
      const interrupted='interrupted-account',incompleteDb=createStorageJournalDb({name:'storage-v2-fenced-incomplete'});
      await incompleteDb.initializeOwnerBinding('kupa',interrupted);
      const unfinished=createStorageJournal({owner:interrupted+':kupa',schema:{collections:['notes','checks'],fields:[]},validate:()=>{},db:incompleteDb});
      await unfinished.install({notes:[{id:'new-v2'}],checks:[]},{appMetadata:{storageRole:'primary'}});
      if(!await fails(()=>incompleteDb.adoptFencedAccount('kupa',interrupted,{mainState:{...main,checks:shared.checks},mainCloudState:main,mainRevision:17,sharedState:shared,sharedRevision:9}),
        'storage_fenced_recovery_existing_v2_head'))throw Error('unfinished primary V2 was overwritten');
      if((await unfinished.recover()).state.notes[0].id!=='new-v2'||await incompleteDb.readCutover('kupa:'+interrupted))throw Error('rejected adoption changed the V2 head');
      const shadowOwner='shadow-account',shadowDb=createStorageJournalDb({name:'storage-v2-fenced-shadow'});
      await shadowDb.initializeOwnerBinding('kupa',shadowOwner);
      const oldMain=createStorageJournal({owner:shadowOwner+':kupa',schema:{collections:['notes','checks'],fields:[]},validate:()=>{},db:shadowDb});
      const oldShared=createStorageJournal({owner:shadowOwner+':shared-checks',schema:{collections:['checks'],fields:['bankEvents']},validate:()=>{},db:shadowDb});
      await oldMain.install({notes:[{id:'shadow'}],checks:[]},{appMetadata:{storageRole:'shadow'}});
      await oldShared.install({checks:[],bankEvents:[]},{appMetadata:{storageRole:'shared-checks-shadow'}});
      await shadowDb.adoptFencedAccount('kupa',shadowOwner,{mainState:{...main,checks:shared.checks},mainCloudState:main,mainRevision:17,sharedState:shared,sharedRevision:9});
      if((await oldMain.recover()).state.notes[0].id!=='cloud'||(await oldShared.recover()).state.checks[0].id!=='check')throw Error('legacy shadow remained active');
      const localDb=createStorageJournalDb({name:'storage-v2-fenced-legacy-local'}),target='account-from-legacy-local';
      await localDb.initializeOwnerBinding('kupa','local');let activeOwner='local';
      const localRecovery=createStorageV2FencedRecovery({app:'kupa',owner:()=>activeOwner,primary:()=>true,authenticatedOwner:()=>target,
        refreshOwnerBinding:async()=>{activeOwner=(await localDb.readOwnerBinding('kupa')).owner},
        readProtocolState:async()=>({orders:2,kupa:2,sharedChecks:2}),
        readMainRemote:async()=>({revision:17,state:structuredClone(main)}),projectMainRemote:row=>row.state,
        readSharedRemote:async()=>({revision:9,state:structuredClone(shared)}),projectSharedRemote:row=>row.state,
        composeMainState:(cloud,checks)=>({...cloud,checks:checks.checks}),projectMainState:state=>({notes:state.notes}),
        validateMainState:state=>{if(!Array.isArray(state.notes)||!Array.isArray(state.checks))throw Error('invalid main')},
        validateMainCloud:state=>{if(!Array.isArray(state.notes))throw Error('invalid cloud')},db:localDb,storage:localStorage});
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='cutovers'){this.transaction.abort();throw Error('injected local adoption abort')}return result};
      let localAborted=false;try{await localRecovery.recover()}catch{localAborted=true}finally{IDBObjectStore.prototype.put=put}
      if(!localAborted||(await localDb.readOwnerBinding('kupa')).owner!=='local'||await localDb.readCutover('kupa:'+target)||await localDb.readLegacyRecovery('kupa:'+target)||
        (await localDb.load(target+':kupa')).checkpoints||(await localDb.load(target+':shared-checks')).checkpoints)throw Error('aborted local adoption changed the owner or either head');
      await localRecovery.recover();
      if(activeOwner!==target||(await localDb.readOwnerBinding('kupa')).owner!==target||
        !(await localDb.readCutover('kupa:'+target))||
        (await localDb.load(target+':shared-checks')).checkpoints?.data?.state?.bankEvents?.[0]?.seq!==1)throw Error('legacy local owner was not atomically rebound to cloud');
      const protectedDb=createStorageJournalDb({name:'storage-v2-fenced-local-protected'});
      await protectedDb.initializeOwnerBinding('kupa','local');
      const localV2=createStorageJournal({owner:'local:kupa',schema:{collections:['notes','checks'],fields:[]},validate:()=>{},db:protectedDb});
      await localV2.install({notes:[{id:'private-local'}],checks:[]},{appMetadata:{storageRole:'primary'}});
      if(!await fails(()=>protectedDb.adoptFencedAccount('kupa',target,{mainState:{...main,checks:shared.checks},mainCloudState:main,mainRevision:17,sharedState:shared,sharedRevision:9,sourceOwner:'local'}),
        'storage_fenced_recovery_existing_local_v2'))throw Error('local V2 was silently replaced');
      if((await protectedDb.readOwnerBinding('kupa')).owner!=='local'||(await localV2.recover()).state.notes[0].id!=='private-local')throw Error('rejected local adoption changed the owner');
      return ['protocol and primary gates','atomic abort leaves neither head nor marker','Main and Shared recover from cloud','legacy keys ignored','idempotent startup','unfinished V2 primary preserved','old shadow superseded atomically','legacy local binding atomically rebinds','existing local V2 is protected'];
    })()""",timeout=60)
    assert not browser.drain_serious_errors()
    print('PASS fenced stale-device cloud recovery: '+json.dumps(result))
