"""Browser IndexedDB recovery and measured bounded spreadsheet rendering."""
import json
from browser_harness import BrowserSession, ROOT


def run():
    with BrowserSession(ROOT/'netunim-orders/site','spreadsheet-recovery-scale') as browser:
        browser.evaluate("""(async()=>{
          const store=createSpreadsheetStore(),sync=createSpreadsheetSync({domain:'orders',account:()=> 'runtime-owner',enabled:()=>false,store});
          await sync.open();const book=sync.model.state.notesSheet;
          book.rows.push({id:'runtime-row',sheetId:book.sheets[0].id,cells:{},createdAt:'',updatedAt:''});sync.changed(null,{immediate:true});await sync.flush({send:false});
          const row=book.rows[0],column=book.columns[0];row.cells[column.id]='typed without blur';row.updatedAt='2026-09-17';sync.changed({rowId:row.id,columnId:column.id,value:row.cells[column.id],updatedAt:row.updatedAt});
          await new Promise(resolve=>setTimeout(resolve,180));sync.pagehide();
          const saved=await store.load('runtime-owner:orders:main');
          if(saved.drafts[0]?.value!=='typed without blur')throw new Error('Typing did not create an IndexedDB recovery journal');
          if(Object.values(localStorage).some(value=>value.includes('"working"')))throw new Error('Workbook snapshot leaked into localStorage');
          return true;
        })()""")
        browser._navigate()
        assert browser.evaluate("""(async()=>{
          const sync=createSpreadsheetSync({domain:'orders',account:()=> 'runtime-owner',enabled:()=>false});await sync.open();
          return sync.model.state.notesSheet.rows[0].cells['sheet-main-col-1']==='typed without blur';
        })()""")
        result=browser.evaluate("""(()=>{
          const source=createDefaultNotesSheet();source.columns[0].type='number';
          source.rows=Array.from({length:5000},(_,i)=>({id:'row-'+i,sheetId:'sheet-main',cells:{'sheet-main-col-1':String(i)},createdAt:'',updatedAt:''}));
          const host=document.createElement('div');document.body.append(host);let id=0;
          const measure=threshold=>{
            const model={state:{notesSheet:structuredClone(source)}},ui={notesSheetPage:0};
            const ctrl=createNotesWorkbook({model,ui,saveState:()=>{},confirmDialog:async()=>true,renderNotes:()=>{host.innerHTML=ctrl.sheetMarkup()},uid:()=> 'new-'+(++id),esc:value=>String(value).replace(/[&<>\"]/g,'_'),searchMatch:()=>true,site:'orders',renderThreshold:threshold});
            const start=performance.now();host.innerHTML=ctrl.sheetMarkup();host.getBoundingClientRect();const renderMs=performance.now()-start,cells=host.querySelectorAll('[data-sheet-cell]').length;
            const cell=host.querySelector('[data-sheet-cell]'),inputStart=performance.now();for(let i=0;i<100;i++)ctrl.updateSheetCell('row-0','sheet-main-col-1',{value:String(i)});const inputMs=performance.now()-inputStart;
            if(host.querySelector('[data-sheet-total-column] b').textContent!=='12,497,599')throw new Error('Incremental total differs from all-row sum');
            if(threshold!==Infinity){ctrl.sheetActions['notes-sheet-page']({dataset:{clickArg0:'1'}});if(host.querySelector('[data-sheet-cell]').dataset.sheetRowId!=='row-100')throw new Error('Paging skipped rows');}
            return {renderMs,inputMs,cells,htmlBytes:new TextEncoder().encode(host.innerHTML).length};
          };
          const before=measure(Infinity),after=measure(200);host.remove();
          if(after.cells!==500||before.cells!==25000||after.htmlBytes>=before.htmlBytes/10)throw new Error('Large-sheet DOM is not bounded');
          return {rows:5000,columns:5,before,after};
        })()""",timeout=60)
        directory=ROOT/'.work/workbook-preview';directory.mkdir(parents=True,exist_ok=True)
        (directory/'benchmark.json').write_text(json.dumps(result,indent=2),encoding='utf8')
        assert not browser.drain_serious_errors()
        print('PASS browser draft reload and spreadsheet benchmark: '+json.dumps(result))


if __name__=='__main__':run()
