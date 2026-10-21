"""Independent Main/Checks wakeups with actual IndexedDB commits and aborts."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site', 'orders-save-scheduling') as browser:
    result = browser.evaluate(r"""(async()=>{
      await appReady;
      const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStoragePersistence}=await import('./assets/js/storage/persistence.js');
      const {createSyncChecksPersistence}=await import('./assets/js/sync/checks-persistence.js');
      const done=[],noop=()=>{};
      const check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
      const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
      const settle=async()=>{for(let turn=0;turn<30;turn++)await Promise.resolve()};
      const put=IDBObjectStore.prototype.put,report=console.error;
      let abortOwner=null;
      IDBObjectStore.prototype.put=function(...args){
        const result=put.apply(this,args);
        if(this.name==='journal'&&args[1]?.[0]===abortOwner){this.transaction.abort();throw Error('injected native save transaction abort')}
        return result;
      };
      const errors=[];console.error=(...args)=>errors.push(args);
      try{
        for(const scenario of ['main-first','checks-first','main-abort','checks-abort','folder-stalled']){
          const mainOwner='save-main:'+scenario+':orders',checksOwner='save-checks:'+scenario+':shared-checks';
          const mainGate=gate(),checksGate=gate(),mainEntered=gate(),checksEntered=gate(),folderGate=gate();
          const native=createStorageJournalDb(),blocked=(release,entered)=>({...native,append:async(...args)=>{
            entered.resolve();await release.promise;return native.append(...args);
          }});
          const noEmergency={getItem:()=>null,setItem:()=>{throw Error('IDB-only fixture')},removeItem:noop,key:()=>null,length:0};
          const mainJournal=createStorageJournal({owner:mainOwner,schema:{collections:['notes'],fields:[]},validate:noop,
            db:blocked(mainGate,mainEntered),emergency:scenario==='main-abort'?noEmergency:localStorage});
          const checksJournal=createStorageJournal({owner:checksOwner,schema:{collections:['checks'],fields:[]},validate:noop,
            db:blocked(checksGate,checksEntered),emergency:scenario==='checks-abort'?noEmergency:localStorage});
          const mainInitial={notes:[{id:'N',content:'before'}]},checksInitial={checks:[{id:'C',amount:10}]};
          await mainJournal.install(mainInitial);await checksJournal.install(checksInitial);
          const session={localGeneration:0},checksSession={checksGeneration:0},sent=[];
          let clock=0,sequence=0,mainWrite,checksWrite;
          const jobs=new Map(),timers={setTimeout(run,delay){const id=++sequence;jobs.set(id,{run,at:clock+delay});return id},clearTimeout:id=>jobs.delete(id)};
          function advance(ms){clock+=ms;for(const [id,job]of jobs)if(job.at<=clock){jobs.delete(id);job.run()}}
          const common={session,checksSession,tab:{primaryTab:true},timers,setSave:noop,setCloud:noop,
            toast:noop,showSecondaryTabGuard:noop,folderSaveTitle:()=>'',folderBackupAvailable:()=>false,
            syncFolderAccessButton:noop,writeStateToFolder:async()=>true};
          const main=createStoragePersistence({session,
            access:{primary:()=>true,error:()=>null,showSecondaryTabGuard:noop},
            projection:{touch:noop,touchAll:noop},
            platform:{timers,isOnline:()=>true,reload:noop},
            view:{setSave:noop,setCloud:noop,folderSaveTitle:()=>''},
            mirror:{available:()=>scenario==='folder-stalled',write:()=>folderGate.promise,refreshAccess:noop},
            journal:{localSnapshot:(_state,{operations})=>{mainWrite=mainJournal.append(operations);return mainWrite.emergencyDurable},
              storageV2DurabilityAtRisk:()=>true,storageV2CommitPromise:()=>mainWrite.committed},
            cloud:{enabled:()=>true,save:async()=>{check((await native.load(mainOwner)).metadata.seq===1,scenario+': Main cloud follows native commit');sent.push('main')}}});
          const checks=createSyncChecksPersistence({...common,rejectSecondaryMutation:()=>false,
            loadSession:()=>({user:{id:'A'}}),sharedChecksV2:{requested:true,cloudReady:true,persist:operations=>{
              checksWrite=checksJournal.append(operations);return checksWrite;
            }},saveSharedChecksToCloud:async()=>{check((await native.load(checksOwner)).metadata.seq===1,scenario+': Checks cloud follows native commit');sent.push('checks')}});
          const mainRecord={id:'N',content:'after'},checkRecord={id:'C',amount:100};
          const edit=name=>name==='main'?main.scheduleSave('Main edit',{operations:[{type:'put',collection:'notes',id:'N',mode:'replace',record:mainRecord}]}):checks.scheduleCheckSave('Check edit',{operations:[{type:'put',collection:'checks',id:'C',mode:'replace',record:checkRecord}]});
          const first=scenario==='checks-first'?'checks':'main';
          edit(first);advance(50);edit(first==='main'?'checks':'main');advance(300);
          await Promise.all([mainEntered.promise,checksEntered.promise]);await settle();
          check(sent.length===0,scenario+': no cloud publication before either IDB commit');
          check((await native.load(mainOwner)).metadata.seq===0&&(await native.load(checksOwner)).metadata.seq===0,scenario+': held native journals remain unchanged');
          abortOwner=scenario==='main-abort'?mainOwner:scenario==='checks-abort'?checksOwner:null;
          mainGate.resolve();checksGate.resolve();
          const outcomes=await Promise.allSettled([mainWrite.committed,checksWrite.committed]);
          await Promise.all([main.runtime.drain(),checks.runtime.drain()]);
          folderGate.resolve(true);
          check(outcomes[0].status===(scenario==='main-abort'?'rejected':'fulfilled')&&outcomes[1].status===(scenario==='checks-abort'?'rejected':'fulfilled'),scenario+': exact commit results retained');
          const expected=scenario==='main-abort'?['checks']:scenario==='checks-abort'?['main']:['checks','main'];
          check(JSON.stringify(sent.sort())===JSON.stringify(expected),scenario+': independent cloud obligations');
          check(jobs.size===0&&!Object.hasOwn(session,'saveTimer')&&!Object.hasOwn(checksSession,'sharedChecksSaveTimer'),scenario+': no orphan or context timer');
          abortOwner=null;
          const freshMain=createStorageJournal({owner:mainOwner,schema:{collections:['notes'],fields:[]},validate:noop,db:native});
          const freshChecks=createStorageJournal({owner:checksOwner,schema:{collections:['checks'],fields:[]},validate:noop,db:native});
          const recoveredMain=await freshMain.open(),recoveredChecks=await freshChecks.open();
          check(JSON.stringify(recoveredMain.state)===JSON.stringify(scenario==='main-abort'?mainInitial:{notes:[mainRecord]}),scenario+': fresh Main runtime retains original ID and exact content');
          check(JSON.stringify(recoveredChecks.state)===JSON.stringify(scenario==='checks-abort'?checksInitial:{checks:[checkRecord]}),scenario+': fresh Checks runtime retains original ID and exact content');
          check(main.runtime.dispose()&&checks.runtime.dispose(),scenario+': runtimes dispose once');
          check(!main.runtime.dispose()&&!checks.runtime.dispose(),scenario+': disposal is idempotent');
        }
      }finally{IDBObjectStore.prototype.put=put;console.error=report}
      return done;
    })()""", timeout=40)
    assert not browser.drain_serious_errors()
    print(f'PASS Orders native save scheduling: {len(result)} assertions for interleaved edits, IDB-only aborts, independent cloud obligations and exact restart identity')
