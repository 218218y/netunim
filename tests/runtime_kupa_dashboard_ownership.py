"""Production Dashboard auth epochs, native DOM and unchanged independent IDB data."""
import argparse
from browser_harness import BrowserSession, ROOT

parser = argparse.ArgumentParser()
parser.add_argument('--case', choices=['switch', 'relogin', 'logout', 'dispose'])
args = parser.parse_args()
for case in ([args.case] if args.case else ['switch', 'relogin', 'logout', 'dispose']):
    with BrowserSession(ROOT/'netunim-kupa/site', 'kupa-dashboard-'+case) as browser:
        result = browser.evaluate(r"""(async()=>{
          await appReady;financeAutomation.stop();syncDocument.stopCloudPolling();
          dashboard.runtime.stop();session.connectionMode='file';session.backendReady=true;
          const caseName=__CASE__,A='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
          const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
          const note={id:'dashboard-retained-note',content:'independent durable content'};state.notes.push(note);
          await storagePersistence.saveState('retained note',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
          await mainStorageV2.commitPromise;
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
          const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load('local:kupa')),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
          const entered=gate(),release=gate(),rowEntered=gate(),rowRelease=gate();let rows=0;
          cloudTransport.readOrdersReadOnlyMeta=async()=>({revision:rows+1});
          cloudTransport.readOrdersReadOnlyCloud=async()=>{
            const index=++rows;
            if(index===1){entered.resolve();await release.promise}
            else if(index===2&&caseName==='switch'){rowEntered.resolve();await rowRelease.promise}
            return {revision:index,state:{customerDebts:[{id:index===1?'former':'current',amount:index===1?100:200}],suppliers:[],transactions:[]}};
          };
          const login=id=>cloudAuth.storeSupaSession(id?{user:{id},access_token:'synthetic',expires_at:9999999999}:null);
          login(A);session.connectionMode='supabase';session.backendReady=true;ui.currentPage='cash';dashboard.runtime.start();
          const old=dashboard.commands.refreshOrdersSummary({force:true});await entered.promise;
          if(caseName==='switch')login(B);
          if(caseName==='relogin'){login(null);login(A)}
          if(caseName==='logout')login(null);
          if(caseName==='dispose')check(dashboard.runtime.dispose()===true&&dashboard.runtime.dispose()===false,'disposal is idempotent');
          let current;
          if(['switch','relogin'].includes(caseName))current=dashboard.commands.refreshOrdersSummary({force:true});
          if(caseName==='switch')await rowEntered.promise;
          release.resolve();
          check(await old===false,'former read cannot report current publication');
          if(caseName==='switch')check(dashboard.runtime.isPending()===true,'old completion cannot release the new account flight');
          rowRelease.resolve();
          if(current){check(await current===true,'the current account has an independent read');check(dashboard.queries.ordersSummary().customerOpen===200,'only the current read reaches the attributed summary')}
          else check(dashboard.queries.ordersSummary()===null,'logout/disposal cannot expose a former summary');
          ui.currentPage='dashboard';dashboard.presentation.renderDashboard();
          const dom=document.getElementById('content').innerHTML;
          if(caseName!=='dispose'){
            login(null);
            check(dashboard.queries.ordersSummary()===null,'authentication notification synchronously clears the cached summary');
            check(document.getElementById('content').innerHTML!==dom||!current,'the actual dashboard removes the former financial summary on logout');
          }
          dashboard.runtime.dispose();await dashboard.runtime.drain();
          check(await dashboard.commands.refreshOrdersSummary({force:true})===false,'disposed commands cannot start another read');
          check(!Object.hasOwn(session,'ordersFinanceReadPromise'),'the application session has no Dashboard promise slot');
          check(JSON.stringify(await db.load('local:kupa'))===mainBefore&&JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'readout lifecycle preserves Main and Shared journal records byte-for-byte');
          const fresh=createStorageV2Runtime({app:'kupa',owner:()=> 'local',primary:()=>true,mode:()=> 'primary',validate:()=>{}}),recovered=await fresh.recover();
          check(recovered.state.notes.some(row=>row.id===note.id&&row.content===note.content),'fresh journal recovery retains the same independent note identity/content');
          return done;
        })()""".replace('__CASE__', repr(case)), timeout=40)
        assert not browser.drain_serious_errors()
        print(f'PASS production Kupa Dashboard {case}: {len(result)} assertions for auth/read ownership, native DOM and exact IDB recovery')
