"""Real IndexedDB transactions, journal recovery, fault injection and byte scaling."""
import json
from browser_harness import BrowserSession, ROOT

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

for app in ['kupa','orders']:
    with BrowserSession(ROOT/f'netunim-{app}/site',app+'-storage-shadow') as browser:
        result=browser.evaluate("""(async()=>{
          localStorage.setItem('netunim-storage-v2-shadow','1');
          const record={id:'shadow-note',content:'before',createdAt:'2026-09-22',updatedAt:'2026-09-22'};
          state.notes=[record];
          SNAPSHOT;
          if(!await storageShadow.flush())throw Error('Initial V1 checkpoint shadow failed');
          record.content='after';record.updatedAt='2026-09-22T10:00:00Z';
          const options={domains:['notes'],operations:[{type:'put',collection:'notes',id:record.id,mode:'replace',record}]};
          SAVE;
          if(!await storageShadow.flush())throw Error('Typed operation shadow failed: '+storageShadow.diagnostics.lastError);
          if(storageShadow.diagnostics.parityChecks!==1||storageShadow.diagnostics.operations!==1)throw Error('Shadow parity did not execute');
          state.notes=[];
          const deletion={domains:['notes'],deleteIntents:{notes:[record.id]},mutationType:'delete',operations:[{type:'delete',collection:'notes',id:record.id}]};
          DELETE;
          if(!await storageShadow.flush()||storageShadow.diagnostics.mismatches)throw Error('Explicit deletion differs from V1');
          localStorage.removeItem('netunim-storage-v2-shadow');return storageShadow.diagnostics;
        })()""".replace('SNAPSHOT', "storageBrowser.persistImmediateBrowserSnapshot(undefined,undefined,{storageBoundary:'test-initial-checkpoint'})" if app=='kupa' else "storageBrowser.localSnapshot(undefined,{storageBoundary:'test-initial-checkpoint'})")
        .replace('SAVE', "await storagePersistence.saveState('test',options)" if app=='kupa' else "storagePersistence.scheduleSave('test',options)")
        .replace('DELETE', "await storagePersistence.saveState('test',deletion)" if app=='kupa' else "storagePersistence.scheduleSave('test',deletion)"))
        assert result['mismatches']==0 and result['operations']==2,result
        assert not browser.drain_serious_errors()
        print('PASS '+app+' real V1 save and explicit delete match shadow replay: '+json.dumps(result))
        baseline=browser.evaluate("""(async()=>{
          const metrics=await import('./assets/js/shared/runtime-performance.js');
          metrics.configurePerformance(true);const rows=[];
          for(const count of [100,1000,5000]){
            state.notes=Array.from({length:count},(_,i)=>({id:'baseline-'+i,content:'text '.repeat(30),createdAt:'2026-09-22',updatedAt:'2026-09-22'}));
            metrics.clearPerformance();const durations=[];
            for(let attempt=0;attempt<3;attempt++){
              state.notes[0].content='small edit '+attempt;
              const start=performance.now();if(!SNAPSHOT)throw Error('V1 snapshot durability failed');
              durations.push(performance.now()-start);await files.browserStateWritePromise;
            }
            rows.push({count,localSnapshotMs:durations,metrics:metrics.performanceSummary()});
          }
          metrics.configurePerformance(false);return rows;
        })()""".replace('SNAPSHOT','storageBrowser.persistImmediateBrowserSnapshot()' if app=='kupa' else 'storageBrowser.localSnapshot()'))
        assert all(row['metrics']['storage:bytes:browser-snapshot']['count']==3 for row in baseline),baseline
        assert baseline[-1]['metrics']['storage:bytes:browser-snapshot']['p50']>baseline[0]['metrics']['storage:bytes:browser-snapshot']['p50']*10,baseline
        (directory/(app+'-v1-baseline.json')).write_text(json.dumps(baseline,indent=2),encoding='utf-8')
        assert not browser.drain_serious_errors()
        print('PASS '+app+' V1 snapshot baseline: '+json.dumps(baseline))

        primary=browser.evaluate("""(async()=>{
          const metrics=await import('./assets/js/shared/runtime-performance.js');
          localStorage.setItem('netunim-storage-v2-mode:APP','primary');
          PREF
          INITIAL;
          if(!await storageShadow.flush())throw Error('V2 primary promotion failed: '+storageShadow.diagnostics.lastError);
          const snapshotKey=Object.keys(localStorage).find(key=>key.includes('browser')||key==='orders.management.state.v1'),before=snapshotKey?localStorage.getItem(snapshotKey):null;
          metrics.configurePerformance(true);metrics.clearPerformance();
          state.notes[0].content='primary journal edit';state.notes[0].updatedAt='2026-09-22T12:00:00Z';
          const operation={type:'put',collection:'notes',id:state.notes[0].id,mode:'replace',record:state.notes[0]};
          const ok=EDIT;if(!ok)throw Error('V2 emergency durability was not acknowledged');
          if(!await storageShadow.flush())throw Error('V2 IDB commit failed: '+storageShadow.diagnostics.lastError);
          const after=snapshotKey?localStorage.getItem(snapshotKey):null,summary=metrics.performanceSummary();metrics.configurePerformance(false);
          if(before!==after)throw Error('Typed primary edit rewrote the full V1 LocalStorage snapshot');
          if(summary['storage:bytes:browser-snapshot'])throw Error('Typed primary edit serialized a browser snapshot');
          return {diagnostics:storageShadow.diagnostics,summary};
        })()""".replace('APP',app).replace('PREF',"localStorage.setItem('kupa.storage.preferred.v1','supabase');" if app=='kupa' else '')
        .replace('INITIAL', "storageBrowser.persistImmediateBrowserSnapshot(undefined,undefined,{storageBoundary:'test-primary-promotion'})" if app=='kupa' else "storageBrowser.localSnapshot(undefined,{storageBoundary:'test-primary-promotion'})")
        .replace('EDIT', "(storagePersistence.saveState('primary test',{domains:['notes'],operations:[operation],surface:'test.primary'}),true)" if app=='kupa' else "storagePersistence.scheduleSave('primary test',{domains:['notes'],operations:[operation],surface:'test.primary'})"))
        assert primary['diagnostics']['operations']==1 and primary['diagnostics']['commitFailures']==0,primary
        browser._navigate()
        recovered=browser.evaluate("""(async()=>{await appReady;return {content:state.notes[0]?.content||null,ready:storageShadow.primaryReady,modeKey:localStorage.getItem('netunim-storage-v2-mode:APP'),keys:Object.keys(localStorage),diagnostics:storageShadow.diagnostics}})()""".replace('APP',app))
        assert recovered['content']=='primary journal edit' and recovered['ready'],recovered
        assert browser.evaluate("""(async()=>{
          session.backendReady=false;
          state.notes=[{id:'restore-boundary',content:'restored checkpoint',createdAt:'2026-09-22',updatedAt:'2026-09-22'}];
          BOUNDARY;if(!await storageShadow.flush())throw Error(storageShadow.diagnostics.lastError);return true;
        })()""".replace('BOUNDARY',"storageBrowser.persistImmediateBrowserSnapshot(undefined,undefined,{storageBoundary:'restore-checkpoint'})" if app=='kupa' else "storageBrowser.localSnapshot(undefined,{storageBoundary:'restore-checkpoint'})"))
        browser._navigate()
        boundary_recovered=browser.evaluate("""(async()=>{await appReady;return state.notes[0]?.content})()""")
        assert boundary_recovered=='restored checkpoint',boundary_recovered
        assert browser.evaluate("""(()=>{
          session.backendReady=false;localStorage.setItem('netunim-storage-v2-mode:APP','off');state.notes[0].content='newer V1 fallback';
          WRITE;localStorage.setItem('netunim-storage-v2-mode:APP','primary');return true;
        })()""".replace('APP',app).replace('WRITE',"storageBrowser.persistImmediateBrowserSnapshot(undefined,undefined,{storageBoundary:'rollback-v1-write'})" if app=='kupa' else "storageBrowser.localSnapshot(undefined,{storageBoundary:'rollback-v1-write'})"))
        browser._navigate()
        fallback_recovered=browser.evaluate("""(async()=>{await appReady;return {content:state.notes[0]?.content,source:storageShadow.diagnostics.migrations,ready:storageShadow.primaryReady}})()""")
        assert fallback_recovered['content']=='newer V1 fallback' and fallback_recovered['ready'],fallback_recovered
        idb_only=browser.evaluate("""(async()=>{
          session.backendReady=false;
          const snapshotKey=Object.keys(localStorage).find(key=>key.includes('browser')||key==='orders.management.state.v1');
          const before=snapshotKey?localStorage.getItem(snapshotKey):null,original=Storage.prototype.setItem;
          Storage.prototype.setItem=function(key,value){if(String(key).startsWith('netunim-storage-v2-emergency:'))throw Error('injected emergency quota');return original.call(this,key,value)};
          try{
            state.notes[0].content='IDB-only durable edit';state.notes[0].updatedAt='2026-09-22T12:30:00Z';
            const operation={type:'put',collection:'notes',id:state.notes[0].id,mode:'replace',record:state.notes[0]};
            const immediatelyDurable=WRITE;
            if(immediatelyDurable||!storageShadow.durabilityAtRisk)throw Error('IDB-only edit was incorrectly reported synchronously durable');
            await storageShadow.commitPromise;
            if(storageShadow.durabilityAtRisk)throw Error('IDB commit did not clear the unload guard');
            if((snapshotKey?localStorage.getItem(snapshotKey):null)!==before)throw Error('Emergency failure rewrote full V1 snapshot');
            return {emergencyFailures:storageShadow.diagnostics.emergencyFailures,content:state.notes[0].content};
          }finally{Storage.prototype.setItem=original}
        })()""".replace('WRITE',"storageBrowser.persistImmediateBrowserSnapshot(undefined,undefined,{operations:[operation],surface:'test.idb-only'})" if app=='kupa' else "storageBrowser.localSnapshot(undefined,{operations:[operation],surface:'test.idb-only'})"))
        assert idb_only['content']=='IDB-only durable edit' and idb_only['emergencyFailures']>=1,idb_only
        browser._navigate()
        assert browser.evaluate("""(async()=>{await appReady;return state.notes[0]?.content})()""")== 'IDB-only durable edit'
        assert browser.evaluate("""(()=>{
          const snapshotKey=Object.keys(localStorage).find(key=>key.includes('browser')||key==='orders.management.state.v1');
          const before=snapshotKey?localStorage.getItem(snapshotKey):null;
          window.dispatchEvent(new Event('pagehide'));
          return (snapshotKey?localStorage.getItem(snapshotKey):null)===before;
        })()"""),app+' pagehide rewrote the full V1 snapshot in primary mode'
        errors=browser.drain_serious_errors();assert not errors,errors
        print('PASS '+app+' V2 primary skips full LocalStorage serialization and recovers after hard navigation: '+json.dumps(primary))
