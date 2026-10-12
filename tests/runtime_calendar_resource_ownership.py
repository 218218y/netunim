"""Actual Calendar control lifetime, native IDB/timers and retained Main/Shared heads."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site','calendar-resource-ownership') as browser:
    result=browser.evaluate(r"""(async()=>{
      await appReady;finance.runtime.stop();syncDocument.stopPolling();
      const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
      const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
      const note={id:'calendar-runtime-note',content:'retained Main note'},record={id:'calendar-runtime-check',name:'retained check',amount:47,dueDate:'2026-10-12',status:'בקופה',account:'עסקי',note:'retained Shared check'};
      state.notes.push(note);storagePersistence.scheduleSave('retained note',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
      await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();await storagePersistence.runtime.drain();
      state.checks.push(record);checks.commands.scheduleSave('retained check',{operations:[{type:'put',collection:'checks',id:record.id,mode:'insert',index:state.checks.length-1,record}]});
      checks.runtime.cancelPending();await checks.runtime.drain();await sharedChecksV2.commitPromise;
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
      const {createSharedChecksStorageV2}=await import('./assets/js/shared/shared-checks-storage-v2.js');
      const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');
      const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load('local:orders')),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
      const calendarId='calendar@example.test',entered=gate(),release=gate(),requests=[];
      const fetch=globalThis.fetch,set=globalThis.setTimeout,clear=globalThis.clearTimeout,descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete'),online=Object.getOwnPropertyDescriptor(navigator,'onLine');
      let appendRelease=gate(),appendEntered=gate(),armed=false;const timers=[];
      const login=owner=>cloudAuth.saveSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});
      cloudAuth.supaFetch=async(_path,options)=>{
        options.assertRequestScope?.();requests.push(cloudAuth.getAccountScope().owner);
        const response=new Response(JSON.stringify({access_token:requests.length===1?'old Google token':'current Google token',expires_in:3600,account_id:calendarId}));
        if(requests.length===1){const json=response.json.bind(response);response.json=async()=>{entered.resolve();await release.promise;return json()}}
        return response;
      };
      globalThis.fetch=async url=>new Response(JSON.stringify({items:new URL(url).pathname.endsWith('/calendarList')?[{id:calendarId,primary:true,accessRole:'owner',summary:'fixture calendar'}]:[]}));
      globalThis.setTimeout=(run,delay,...args)=>{const id=set(run,delay,...args);if(delay===320)timers.push({id,run});return id};
      try{
        ui.currentView='supplier';calendarSession.autoConnect=true;login('calendar-runtime-A');
        const old=domainsCalendarController.refreshCalendar();await entered.promise;
        login('calendar-runtime-B');const newer=domainsCalendarController.calendarAuthAction();
        check(await newer===true&&requests.length===2,'the actual new-login gesture completes before an old token body is released');
        check(calendarSession.accessToken==='current Google token'&&calendarSession.accountVerified,'only the new account credential and verified state publish');
        check(domainsCalendarController.runtime.isPending(),'the former login remains owned while its network body is held');
        release.resolve();check(await old===false,'the former-login refresh returns no success');await domainsCalendarController.runtime.drain();
        check(calendarSession.accessToken==='current Google token','the old completion cannot replace the newer credential');
        ui.currentView='calendar';calendarUi.focusDate='2026-10-12';await domainsCalendarController.renderCalendar();await domainsCalendarController.runtime.drain();
        domainsCalendarController.calendarDayCreate('2026-10-13',{detail:1});const oldDay=timers.at(-1);
        domainsCalendarController.calendarDayCreate('2026-10-14',{detail:1});const newDay=timers.at(-1);
        clear(oldDay.id);oldDay.run();for(let i=0;i<6;i++)await Promise.resolve();
        check(!document.querySelector('.calendar-quick-form'),'a delivered cancelled native day callback cannot open its old editor');
        clear(newDay.id);newDay.run();await domainsCalendarController.runtime.drain();
        check(document.getElementById('calendarQuickDate').value==='2026-10-14','the current native day task opens exactly its selected date');
        document.getElementById('calendarQuickSummary').value='accepted durable Calendar event';
        Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
        Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(handler){
          const tx=this,match=armed&&tx.db.name==='order-management-google-calendar'&&tx.mode==='readwrite'&&tx.objectStoreNames.contains('pending-operations');if(match)armed=false;
          descriptor.set.call(tx,function(event){if(match){appendEntered.resolve();void appendRelease.promise.then(()=>handler.call(tx,event))}else handler.call(tx,event)});
        }});
        armed=true;const saving=domainsCalendarController.saveQuickCalendarEvent();await appendEntered.promise;
        const storage=createCalendarStorage(),pending=await storage.listOperations(),event=pending.find(row=>row.body.summary==='accepted durable Calendar event');
        check(!!event&&event.eventId===event.body.id,'a native committed append retains its preassigned Google ID and input');
        const retained=JSON.stringify(pending);
        check(calendarRuntime.dispose()&&!calendarRuntime.dispose(),'production Calendar disposal is final and idempotent');
        let drained=false;const draining=calendarRuntime.drain().then(()=>{drained=true});for(let i=0;i<6;i++)await Promise.resolve();
        check(!drained,'runtime drain awaits the already committed native append completion');
        appendRelease.resolve();await saving;await draining;
        check(JSON.stringify(await storage.listOperations())===retained,'disposal preserves the exact committed Calendar queue');
        check(!domainsCalendarController.runtime.isPending()&&!domainsCalendarController.start(),'closed control runtime has no accepted work and cannot restart');
        for(const timer of timers)timer.run();window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));await calendarRuntime.drain();
        check(await domainsCalendarController.saveQuickCalendarEvent()===false&&requests.length===2,'closed commands and stale native wakeups cannot reconnect or append');
        check(['syncPromise','authResumePromise','pollTimer'].every(key=>!Object.hasOwn(calendarSession,key)),'Calendar context contains no operation promises or poll handle');
        check(JSON.stringify(await db.load('local:orders'))===mainBefore&&JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'Calendar resource lifecycle leaves exact Main/Shared journals unchanged');
        const fresh=createStorageV2Runtime({app:'orders',owner:()=> 'local',primary:()=>false,mode:()=> 'primary',validate:()=>{}}),recovered=await fresh.recoverReadOnly();
        const shared=createSharedChecksStorageV2({owner:()=> 'local',primary:()=>false}),recoveredShared=await shared.recoverReadOnly();
        check(recovered.state.notes.some(row=>row.id===note.id&&row.content===note.content),'fresh Main recovery retains original note ID/content');
        check(recoveredShared.state.checks.some(row=>row.id===record.id&&row.note===record.note&&row.amount===47),'fresh Shared recovery retains original check ID/content');
        check(JSON.stringify(await createCalendarStorage().listOperations())===retained,'a fresh Calendar adapter retains the exact pending ID/body/sequence');
      }finally{
        release.resolve();appendRelease.resolve();calendarRuntime.dispose();Object.defineProperty(IDBTransaction.prototype,'oncomplete',descriptor);
        globalThis.fetch=fetch;globalThis.setTimeout=set;if(online)Object.defineProperty(navigator,'onLine',online);else delete navigator.onLine;
      }
      return done;
    })()""",timeout=40)
    assert not browser.drain_serious_errors()
    print(f'PASS Calendar control resources: {len(result)} native authority/timer/IDB and exact recovery assertions')
