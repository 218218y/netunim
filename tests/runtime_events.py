"""Characterization of real DOM events, independent of handler implementation."""
import json
from browser_harness import BrowserSession, ROOT

common = r"""
 const clickText=(root,text)=>{
   const el=[...document.querySelectorAll(root+' button')].find(x=>x.textContent.trim()===text);
   if(!el)throw new Error('Missing button: '+text);el.click();return el;
 };
 const fire=(el,type)=>el.dispatchEvent(new Event(type,{bubbles:true}));
 const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const respondConfirm=async accept=>{
   const backdrop=document.getElementById('confirmBackdrop');
   if(!backdrop?.classList.contains('open'))throw new Error('Expected styled confirmation dialog');
   const button=document.getElementById(accept?'confirmAccept':'confirmCancel');
   if(!button)throw new Error('Missing confirmation response button');
   button.click();
   await frame();
 };
 const assertBackdropGestureContract=(openModal)=>{
   openModal();
   const backdrop=document.getElementById('modalBackdrop');
   const field=document.querySelector('#modal input, #modal textarea, #modal select');
   if(!field)throw new Error('Backdrop contract test needs a modal field');
   const pointer=(target,type,pointerId)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerdown'?1:0}));
   pointer(field,'pointerdown',71);
   pointer(backdrop,'pointerup',71);
   backdrop.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));
   if(!backdrop.classList.contains('open'))throw new Error('Release outside after selection closed modal');
   pointer(backdrop,'pointerdown',72);
   pointer(backdrop,'pointerup',72);
   if(backdrop.classList.contains('open'))throw new Error('Genuine backdrop gesture did not close modal');
 };
"""

# Open through the public UI and exercise the same modal actions before and after
# event delegation. Business persistence is covered by the recovery suites.
expressions = {
 'kupa': r"""
 state=normalizeState({version:4,checks:[],credits:[],cash:[],expenses:[],cards:[{name:'VISA',active:true,chargeDay:10}]});
 backendReady=false;connectionMode='';
 setPage('dashboard');
 assertBackdropGestureContract(()=>openCheckModal());
 const tile=document.querySelector('.kpi.clickable');
 tile.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 if(currentPage!=='cash')throw new Error('KPI keyboard navigation failed');
 openCheckModal();
 document.getElementById('fName').value='event customer';
 let rows=document.querySelectorAll('#checkSeriesRows .check-series-row');
 rows[0].querySelector('[data-series-field="amount"]').value='120';
 fire(rows[0].querySelector('[data-series-field="amount"]'),'input');
 document.getElementById('fCheckCount').value='3';fire(document.getElementById('fCheckCount'),'change');
 rows=document.querySelectorAll('#checkSeriesRows .check-series-row');
 if(rows.length!==3||rows[2].querySelector('[data-series-field="amount"]').value!=='120')throw new Error('Series change/input failed');
 rows[1].querySelector('[data-series-field="amount"]').value='77';fire(rows[1].querySelector('[data-series-field="amount"]'),'input');
 rows[0].querySelector('[data-series-field="amount"]').value='200';fire(rows[0].querySelector('[data-series-field="amount"]'),'input');
 if(rows[1].querySelector('[data-series-field="amount"]').value!=='77'||rows[2].querySelector('[data-series-field="amount"]').value!=='200')throw new Error('Manual series override lost');
 clickText('#modal','ביטול');
 if(!document.getElementById('confirmBackdrop').classList.contains('open'))throw new Error('Draft protection confirmation did not open');
 await respondConfirm(false);
 if(!document.getElementById('modalBackdrop').classList.contains('open'))throw new Error('Draft protection lost');
 clickText('#modal','ביטול');
 await respondConfirm(true);
 if(document.getElementById('modalBackdrop').classList.contains('open'))throw new Error('Modal cancellation failed');
 const strangeId=`check'\"<&`;
 state.checks=[{id:strangeId,name:'quote test',amount:25,dueDate:'2026-09-01',status:'בקופה'}];
 setPage('checks');clickText('#content','עריכה');
 if(document.getElementById('fName').value!=='quote test')throw new Error('Data ID was interpreted as executable code');
 clickText('#modal','שמור שינויים');
 if(state.checks.length!==1||state.checks[0].id!==strangeId)throw new Error('Modal callback lost ID');
 return {keyboard:true,series:true,manualOverride:true,draft:true,quotedId:true};
 """,
 'orders': r"""
 state.suppliers=[{id:'S1',name:'Supplier',active:true,sortOrder:0},{id:'S2',name:'Second',active:true,sortOrder:1}];
 state.transactions=[{id:'T1',supplierId:'S1',sequence:1,action:'Action',debit:10,credit:0,invoiceReceived:null,signed:null,supplied:null,note:'',supplyInfo:''}];
 currentSupplierId='S1';switchView('supplier');await frame();
 assertBackdropGestureContract(()=>openTransactionModal('T1'));
 openTransactionModal('T1');
 if(document.getElementById('fInvoice').value!=='null'||document.getElementById('fSigned').value!=='null'||document.getElementById('fSupplied').value!=='null')throw new Error('Tri-state modal did not preserve not-applicable values');
 document.getElementById('fNote').value='Edited note';clickText('#modal','שמור');await frame();
 if(state.transactions[0].invoiceReceived!==null||state.transactions[0].signed!==null||state.transactions[0].supplied!==null)throw new Error('Editing another field changed not-applicable tri-state values');
 const yes=document.querySelector('.status-toggle .yes');yes.click();
 if(state.transactions[0].invoiceReceived!==true)throw new Error('Tri-state yes failed');
 document.querySelector('.status-toggle .yes').click();
 if(state.transactions[0].invoiceReceived!==null)throw new Error('Tri-state toggle failed');
 const search=document.querySelector('.supplier-search');search.value='missing';fire(search,'input');
 if(!document.querySelector('tr[data-tx-id]').hidden)throw new Error('Delegated search failed');
 search.value='';fire(search,'input');
 toggleSupplierBulkMode();const cb=document.querySelector('tbody .bulk-check');cb.checked=true;fire(cb,'change');
 if(!supplierBulkSelected.has('T1'))throw new Error('Bulk selection failed');
 openSupplierOrderModal();await frame();clickText('#modal','↓');
 if(supplierOrderDraft[0]!=='S2')throw new Error('Supplier order action failed');
 const dragRow=document.querySelector('.supplier-order-row'),dataTransfer=new DataTransfer();
 dragRow.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
 if(!dragRow.classList.contains('dragging')||document.getElementById('modal').classList.contains('dragging'))throw new Error('Drag action used the delegated container instead of its row');
 const dropRow=document.querySelectorAll('.supplier-order-row')[1];
 const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer});dropRow.dispatchEvent(over);
 if(!over.defaultPrevented)throw new Error('Drop not enabled');
 dropRow.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
 if(supplierOrderDraft[0]!=='S1')throw new Error('Drag reorder failed');
 clickText('#modal','ביטול');await frame();
 if(document.getElementById('modalBackdrop').classList.contains('open'))throw new Error('Supplier order cancellation failed after restoring the original order');
 if(document.getElementById('confirmBackdrop').classList.contains('open'))throw new Error('Unchanged supplier order incorrectly triggered draft confirmation');
 return {triState:true,search:true,bulk:true,supplierOrder:true,dragDrop:true};
 """
}

for label, expression in expressions.items():
    with BrowserSession(ROOT / f'netunim-{label}/site', label+'-events') as browser:
        result = browser.evaluate('(async()=>{'+common+expression+'})()')
        errors = browser.drain_serious_errors()
        print(label, json.dumps(result), errors)
        assert result and all(result.values()) and not errors
print('ALL EVENT CHARACTERIZATION TESTS PASSED')
