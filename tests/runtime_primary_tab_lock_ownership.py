"""Native tab ownership, fallback resources and exact retained journal recovery."""
import json
from browser_harness import BrowserSession, ROOT

for app in ('kupa','orders'):
    with BrowserSession(ROOT/f'netunim-{app}/site',f'{app}-primary-lock-ownership') as browser:
        result=browser.evaluate(r"""(async()=>{
          await appReady;const app=APP,kupa=app==='kupa';
          if(kupa){financeAutomation.stop();syncDocument.stopCloudPolling();session.connectionMode='file';session.backendReady=true}
          else{finance.runtime.stop();syncDocument.stopPolling()}
          const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
          const note={id:'primary-owner-note',content:'original retained note'},record={id:'primary-owner-check',name:'retained check',amount:47,dueDate:'2026-10-12',status:'בקופה',account:'עסקי',note:'original retained check'};
          state.notes.push(note);
          const options={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]};
          if(kupa)await storagePersistence.saveState('retained note',options);else storagePersistence.scheduleSave('retained note',options);
          await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending?.();await storagePersistence.runtime.drain();
          state.checks.push(record);const checkOptions={operations:[{type:'put',collection:'checks',id:record.id,mode:'insert',index:state.checks.length-1,record}]};
          if(kupa)await checks.commands.saveLocal('retained check',checkOptions);else checks.commands.scheduleSave('retained check',checkOptions);
          checks.runtime.cancelPending();await checks.runtime.drain();await sharedChecksV2.commitPromise;
          const {TAB_LOCK}=await import('./assets/js/state/constants.js');
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
          const {createSharedChecksStorageV2}=await import('./assets/js/shared/shared-checks-storage-v2.js');
          const {createPrimaryTabLock}=await import('./assets/js/shared/tab-lock.js');
          const {createBrowserTabLockPlatform}=await import('./assets/js/shared/browser-tab-lock-platform.js');
          const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load('local:'+app)),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
          check((await navigator.locks.query()).held.filter(lock=>lock.name===TAB_LOCK).length===1,'application owns exactly one native writer lock');
          check((await Promise.all(Array.from({length:4},()=>storageTabLock.acquirePrimaryTabLock()))).every(Boolean)&&tab.primaryTab&&!tab.readOnlyTab,'repeated production acquisition retains the native writer and its authority');
          check(!Object.hasOwn(tab,'primaryLockRelease'),'native lock release is private rather than a context callback');
          const native=createBrowserTabLockPlatform(),key='netunim:primary:owned-fallback-test',callbacks=[];
          const timers=new Set(),listeners=new Set(),channels=new Set();
          const tracked={...native,requestNative:null,
            clock:{...native.clock,setInterval:(run,delay)=>{const id=native.clock.setInterval(run,delay);timers.add(id);callbacks.push(run);return id},clearInterval:id=>{timers.delete(id);native.clock.clearInterval(id)}},
            events:{
              pageHide:run=>{const remove=native.events.pageHide(run);listeners.add(remove);return ()=>{listeners.delete(remove);remove()}},
              storage:(name,run)=>{const remove=native.events.storage(name,run);listeners.add(remove);callbacks.push(()=>run(null));return ()=>{listeners.delete(remove);remove()}},
              channel:(name,run)=>{const channel=native.events.channel(name,run);channels.add(channel);callbacks.push(()=>run('late other owner'));return {notify:channel.notify,close:()=>{channels.delete(channel);channel.close()}}},
            }};
          // Both instances see the same inherited historical identity, while
          // lease bytes/channels/events/timers use the actual browser.
          sessionStorage.setItem(key+':id','inherited-opener-id');
          const firstState={primaryTab:true,primaryTabReady:false,readOnlyTab:false},secondState={...firstState};
          const first=createPrimaryTabLock({lockName:'owned-fallback-test',tab:firstState,showSecondaryTabGuard:()=>{},platform:tracked});
          const second=createPrimaryTabLock({lockName:'owned-fallback-test',tab:secondState,showSecondaryTabGuard:()=>{},platform:{...native,requestNative:null}});
          try{
            check(await first.acquirePrimaryTabLock()===true,'native storage fallback grants its first writer');
            const firstLease=localStorage.getItem(key);
            check(await second.acquirePrimaryTabLock()===false&&firstState.primaryTab&&secondState.readOnlyTab,'inherited sessionStorage cannot grant a second fallback writer');
            check(JSON.parse(firstLease).id!=='inherited-opener-id','fallback lease identity belongs to the instance');
            check(await first.acquirePrimaryTabLock()===true&&timers.size===1&&listeners.size===2&&channels.size===1,'repeated fallback acquisition owns one native heartbeat/channel/listener set');
            check(second.runtime.dispose()&&!second.runtime.dispose(),'denied fallback disposal is idempotent');await second.runtime.drain();
            check(JSON.parse(localStorage.getItem(key)).id===JSON.parse(firstLease).id,'disposing the denied owner preserves the actual writer lease');
            const replacement=JSON.stringify({id:'independent replacement',expiresAt:Date.now()+50_000});localStorage.setItem(key,replacement);
            check(first.runtime.dispose()&&!first.runtime.dispose(),'fallback writer disposal is idempotent');await first.runtime.drain();
            check(!timers.size&&!listeners.size&&!channels.size,'fallback disposal removes every owned native timer/channel/listener');
            for(const callback of callbacks)callback();
            check(localStorage.getItem(key)===replacement&&!firstState.primaryTab&&await first.acquirePrimaryTabLock()===false,'delivered stale callbacks cannot rewrite another owner lease or regrant authority');
          }finally{first.runtime.dispose();second.runtime.dispose();await Promise.all([first.runtime.drain(),second.runtime.drain()]);localStorage.removeItem(key);sessionStorage.removeItem(key+':id')}
          check(storageTabLock.runtime.dispose()&&!storageTabLock.runtime.dispose(),'production native owner disposal is final and idempotent');await storageTabLock.runtime.drain();
          check(!tab.primaryTab&&tab.readOnlyTab&&await storageTabLock.acquirePrimaryTabLock()===false,'disposed native owner stays read-only and rejects reacquisition');
          check(!(await navigator.locks.query()).held.some(lock=>lock.name===TAB_LOCK),'private native release completes before drain returns');
          check(await navigator.locks.request(TAB_LOCK,{mode:'exclusive',ifAvailable:true},lock=>!!lock),'a fresh native contender can acquire the released writer lock');
          check(JSON.stringify(await db.load('local:'+app))===mainBefore&&JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'native/fallback ownership leaves exact Main and Shared IDB records unchanged');
          const fresh=createStorageV2Runtime({app,owner:()=> 'local',primary:()=>false,mode:()=> 'primary',validate:()=>{}}),recovered=await fresh.recoverReadOnly();
          const shared=createSharedChecksStorageV2({owner:()=> 'local',primary:()=>false}),recoveredShared=await shared.recoverReadOnly();
          check(recovered.state.notes.some(row=>row.id===note.id&&row.content===note.content),'fresh Main recovery retains original note ID/content');
          check(recoveredShared.state.checks.some(row=>row.id===record.id&&row.note===record.note&&row.amount===47),'fresh Shared recovery retains original check ID/content');
          return done;
        })()""".replace('APP',json.dumps(app)),timeout=40)
        assert not browser.drain_serious_errors()
        with browser.second_tab():
            fresh=browser.evaluate("""(async()=>{
              await appReady;return tab.primaryTab&&!tab.readOnlyTab
                &&state.notes.some(row=>row.id==='primary-owner-note'&&row.content==='original retained note')
                &&state.checks.some(row=>row.id==='primary-owner-check'&&row.note==='original retained check'&&row.amount===47);
            })()""",timeout=20)
            assert fresh, 'Fresh actual tab must own the released lock and retain original note/check contents'
            assert not browser.drain_serious_errors()
            with browser.second_tab():
                denied=browser.evaluate("""(async()=>{
                  await appReady;return !tab.primaryTab&&tab.readOnlyTab
                    &&await storageTabLock.acquirePrimaryTabLock()===false;
                })()""",timeout=20)
                assert denied, 'Another actual tab must remain read-only while the fresh writer holds its lock'
                assert not browser.drain_serious_errors()
        print(f'PASS {app} primary lock ownership: {len(result)+2} native resource, journal and actual fresh/secondary-tab assertions')
