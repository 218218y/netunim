"""Real workbook controls, responsive toolbar and durable deletion RPC routing."""
from browser_harness import BrowserSession, ROOT


def run():
    with BrowserSession(ROOT/'netunim-kupa/site', 'notes-workbook') as browser:
        browser.evaluate(r"""(()=>{
          document.getElementById('connectScreen').style.display='none';
          Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
          state=normalizeState({notesSheet:{version:2,sheets:[{id:'S1',name:'Keep'},{id:'S2',name:'Delete'}],
            columns:[{id:'C1',sheetId:'S1',title:'Value'},{id:'C2',sheetId:'S2',title:'Value'}],
            rows:[{id:'R1',sheetId:'S1',cells:{C1:'kept'}},{id:'R2',sheetId:'S2',cells:{C2:'removed'}}]}});
          backendReady=true;connectionMode='supabase';dbRevision=1;lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(state));
          setPage('notes');document.querySelector('[data-action="notes-workspace-sheet"]').click();return true;
        })()""")
        for width in (1280, 390):
            browser.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
            browser.evaluate(r"""(()=>{
              const toolbar=document.querySelector('.notes-hero'),tabs=toolbar.querySelector('.notes-tabs'),search=toolbar.querySelector('.local-search'),actions=toolbar.querySelector('.notes-actions');
              const boxes=[tabs,search,actions].map(el=>el.getBoundingClientRect());
              if(toolbar.textContent.includes('גיליונות נפרדים'))throw new Error('Redundant description remains');
              if(boxes.some(rect=>rect.left<0||rect.right>innerWidth))throw new Error('Toolbar overflows');
              if(innerWidth>780){
                const centers=boxes.map(rect=>rect.top+rect.height/2);
                if(Math.max(...centers)-Math.min(...centers)>2)throw new Error('Tabs, search and actions are not on the same line');
                if(boxes[2].right>boxes[1].left)throw new Error('Actions must be to the left of search in RTL');
              }
              return true;
            })()""")
        browser.evaluate(r"""(async()=>{
          const waitFor=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw new Error('Workbook action timed out')};
          document.querySelector('[data-action="set-active-notes-sheet"][data-click-arg0="S2"]').click();
          document.querySelector('[data-action="delete-notes-sheet"]').click();
          await waitFor(()=>document.getElementById('confirmBackdrop').classList.contains('open'));
          document.getElementById('confirmAccept').click();
          await waitFor(()=>state.notesSheet.sheets.length===1);
          if(state.notesSheet.rows.length!==1||state.notesSheet.rows[0].cells.C1!=='kept')throw new Error('Wrong sheet content removed');
          // Another offline edit changes the outbox metadata to autosave. The
          // pending parent deletion must still select the dedicated bulk RPC.
          document.querySelector('.notes-actions [data-action="add-notes-sheet-row"]').click();
          await new Promise(r=>setTimeout(r,150));
          const pending=await getCloudPending();
          if(pending.deleteIntents['notesSheet.sheets'][0]!=='S2'||pending.snapshot.notesSheet.sheets.length!==1)throw new Error('Deletion was not durably staged');
          const requests=[];cloudAuth.supaRest=async(path,options)=>{
            requests.push({path,body:JSON.parse(options.body)});
            return {ok:true,text:async()=>JSON.stringify([{revision:2,state:pending.snapshot}])};
          };
          Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
          if(!await syncDocument.reconcileCloudPending({revision:1,state:pending.baseState}))throw new Error('Workbook deletion did not synchronize');
          const request=requests.find(row=>row.path.includes('bulk_delete_save_kupa_document_v5'));
          if(!request||request.body.p_delete_intents['notesSheet.sheets'][0]!=='S2')throw new Error('Sheet deletion lost its exact intent or bulk RPC after autosave');
          if(await getCloudPending())throw new Error('Acknowledged deletion remains pending');
          return true;
        })()""", timeout=30)
        assert not browser.drain_serious_errors()
    print('PASS workbook browser: desktop/mobile toolbar, confirmed deletion, preserved sibling, offline outbox, autosave and bulk RPC ACK')


if __name__ == '__main__':
    run()
