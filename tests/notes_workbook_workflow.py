"""Real workbook controls, responsive toolbar and durable deletion RPC routing."""
from browser_harness import BrowserSession, ROOT


def run():
    with BrowserSession(ROOT/'netunim-kupa/site', 'notes-workbook') as browser:
        browser.evaluate(r"""(async()=>{
          document.getElementById('connectScreen').style.display='none';
          Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
          const legacyState={notesSheet:{version:2,sheets:[{id:'S1',name:'Keep'},{id:'S2',name:'Delete'}],
            columns:[{id:'C1',sheetId:'S1',title:'Value'},{id:'C2',sheetId:'S2',title:'Value'}],
            rows:[{id:'R1',sheetId:'S1',cells:{C1:'kept'}},{id:'R2',sheetId:'S2',cells:{C2:'removed'}}]}};
          cloudAuth.loadSupaSession=()=>({user:{id:'workbook-test'}});await spreadsheetWorkspace.sync.captureLegacy(legacyState.notesSheet);state=normalizeState(legacyState);
          backendReady=true;connectionMode='supabase';dbRevision=1;lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(state));
          cloudAuth.loadSupaSession=()=>({user:{id:'workbook-test'}});setPage('notes');document.querySelector('[data-action="notes-workspace-sheet"]').click();await spreadsheetWorkspace.sync.open();return true;
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
          await waitFor(()=>spreadsheetWorkspace.model.state.notesSheet.sheets.length===1);
          if(spreadsheetWorkspace.model.state.notesSheet.rows.length!==1||spreadsheetWorkspace.model.state.notesSheet.rows[0].cells.C1!=='kept')throw new Error('Wrong sheet content removed');
          document.querySelector('.notes-actions [data-action="add-notes-sheet-row"]').click();
          await spreadsheetWorkspace.sync.flush({send:false});
          const store=createSpreadsheetStore(),saved=await store.load('workbook-test:kupa:main');
          if(saved.record.working.sheets.length!==1||saved.record.base.sheets.length!==2)throw new Error('Deletion was not durably staged');
          const requests=[];cloudAuth.supaRest=async(path,options)=>{
            if(!options.method)return new Response(JSON.stringify([{revision:1,state:saved.record.base}]));
            const body=JSON.parse(options.body);requests.push({path,body});
            return new Response(JSON.stringify([{revision:2,state:body.p_state}]));
          };
          Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
          await spreadsheetWorkspace.sync.flush();await spreadsheetWorkspace.sync.flush();
          const request=requests.find(row=>row.path.includes('save_spreadsheet_document_v1'));
          if(!request||request.body.p_delete_intents['notesSheet.sheets'][0]!=='S2'||request.body.p_kind!=='delete')throw new Error('Sheet deletion lost its exact intent');
          if(spreadsheetWorkspace.sync.status!=='saved')throw new Error('Acknowledged deletion remains pending');
          if(await getCloudPending())throw new Error('Workbook must not create main-document outbox');
          return true;
        })()""", timeout=30)
        assert not browser.drain_serious_errors()
    print('PASS workbook browser: desktop/mobile toolbar, confirmed deletion, preserved sibling, offline outbox, autosave and bulk RPC ACK')


if __name__ == '__main__':
    run()
