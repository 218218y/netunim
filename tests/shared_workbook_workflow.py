"""Real shared workbook editing in both apps, using isolated browser profiles."""
import base64
from browser_harness import BrowserSession, ROOT


def run():
    for app in ('orders', 'kupa'):
        with BrowserSession(ROOT/f'netunim-{app}/site', f'{app}-sheet-editing') as browser:
            setup = "switchView('notes');" if app == 'orders' else "backendReady=true;connectionMode='supabase';dbRevision=1;lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(state));setPage('notes');"
            browser.evaluate("""(()=>{
              document.getElementById('connectScreen')?.style.setProperty('display','none');
              Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
              state=normalizeState({notes:[{id:'sticky',content:'Keep this note'}]});
            """+setup+"return true})()")
            if app == 'orders':
                assert browser.evaluate("!!document.querySelector('.sticky-note')&&!document.querySelector('.notes-sheet-table')")
            browser.evaluate(r"""(async()=>{
              const assert=(v,m)=>{if(!v)throw new Error(m)};
              const click=name=>document.querySelector('[data-action="'+name+'"]').click();
              const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              click('notes-workspace-sheet');click('add-notes-sheet-row');await frame();
              const originalId=state.notesSheet.sheets[0].id;
              let cell=document.querySelector('[data-sheet-cell]');cell.focus();
              const clipboard=new DataTransfer();clipboard.setData('text/plain','שם\t1,250.5\r\nשני\t25\r\n');
              cell.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));await frame();
              assert(state.notesSheet.rows.length===2,'Paste must grow the row range');
              const columns=state.notesSheet.columns;
              assert(state.notesSheet.rows[1].cells[columns[1].id]==='25','Paste maps columns in RTL order');
              const toggle=document.querySelectorAll('[data-change="set-notes-sheet-column-numeric"]')[1];toggle.click();
              assert(document.querySelector('[data-sheet-total-column] b').textContent==='1,275.5','Numeric total');
              cell=document.querySelector('[data-sheet-cell]');cell.focus();cell.select();
              cell.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
              assert(document.activeElement.dataset.sheetColumnId===columns[1].id,'Tab should skip toolbar buttons');
              document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
              assert(document.activeElement.dataset.sheetRowId===state.notesSheet.rows[1].id,'Enter moves down');
              document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await frame();
              assert(state.notesSheet.rows.length===3,'Enter grows workbook at last row');
              assert(document.activeElement.dataset.sheetColumnId===columns[1].id,'Enter keeps selected column');
              cell=document.activeElement;cell.value='edited';cell.dispatchEvent(new Event('input',{bubbles:true}));cell.blur();
              click('add-notes-sheet');await frame();
              const name=document.querySelector('.notes-sheet-name-input');name.value='הזמנות מיוחדות';name.dispatchEvent(new FocusEvent('blur'));
              assert(state.notesSheet.sheets[1].name==='הזמנות מיוחדות','Sheet rename');
              click('add-notes-sheet-row');await frame();
              assert(state.notesSheet.rows.filter(row=>row.sheetId===originalId).length===3,'Sibling rows remain independent');
              click('notes-workspace-notes');assert(document.querySelector('.sticky-note textarea').value==='Keep this note','Notes preserved');
              click('notes-workspace-sheet');
              document.querySelector('[data-action="set-active-notes-sheet"][data-click-arg0="'+originalId+'"]').click();
              return true;
            })()""")
            for width in (1280, 390):
                browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
                browser.evaluate(r"""(()=>{
                  const panel=document.querySelector('.notes-sheet-panel'),rect=panel.getBoundingClientRect();
                  if(rect.left<0||rect.right>innerWidth+1)throw new Error('Workbook overflows viewport');
                  if(getComputedStyle(document.querySelector('.notes-sheet-table thead th')).position!=='sticky')throw new Error('Column headers are not frozen');
                  return true;
                })()""")
            browser.call('Emulation.setDeviceMetricsOverride', {'width':1280,'height':900,'deviceScaleFactor':1,'mobile':False})
            shot=browser.call('Page.captureScreenshot', {'format':'png'})
            folder=ROOT/'.work/workbook-preview';folder.mkdir(parents=True,exist_ok=True)
            (folder/f'{app}.png').write_bytes(base64.b64decode(shot['result']['data']))
            if app == 'orders':
                assert browser.evaluate("JSON.stringify(loadLocal().notesSheet)===JSON.stringify(state.notesSheet)")
            assert not browser.drain_serious_errors()
    print('PASS shared workbook: independent sheets, notes default, TSV paste, totals, keyboard, persistence, desktop/mobile layout')


if __name__ == '__main__':
    run()
