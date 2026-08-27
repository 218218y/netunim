import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {validSupplierYear, transactionWorkflowComplete, transactionFinancialStatsData} from './model.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsSuppliersView({model, supplierUi, balanceRows, supplierYearContext, mountViewLayout, orderedSuppliers, captureSupplierViewport, restoreSupplierViewport, syncSupplierBulkUi, supplierMoveTargetRow, storeSupplierViewport, scrollSupplierTransactionsEnd, scheduleSave}){
function supplierSearchText(t,assignedYear=null){return `${t.action||''} ${t.note||''} ${t.supplyInfo||''} ${t.source?.row||''} ${assignedYear||''}`}

function supplierRowsForView(all,yearCtx,selectedArchiveYear,{includeSearch=false}={}){
  if(supplierUi.supplierMoveTargetId)return all;
  const q=includeSearch?supplierUi.searchText.trim():'';
  return all.filter(({t})=>{
    const assignedYear=yearCtx.yearById.get(t.id)??null;
    if(supplierUi.supplierYearView==='current'){if(assignedYear!==null&&transactionWorkflowComplete(t))return false}
    else if(supplierUi.supplierYearView!=='all'&&assignedYear!==selectedArchiveYear)return false;
    if(supplierUi.filterMode==='pending'&&t.supplied!==false)return false;
    if(supplierUi.filterMode==='invoice'&&t.invoiceReceived!==false)return false;
    if(supplierUi.filterMode==='hm'&&!t.hmIssued)return false;
    if(q&&!supplierSearchText(t,assignedYear).includes(q))return false;
    return true
  })
}

function supplierFinancialPeriod(yearCtx,selectedArchiveYear){return supplierUi.supplierYearView==='all'?'כל השנים':supplierUi.supplierYearView==='current'?`שנה שוטפת ${yearCtx.currentYear}`:`שנת ${selectedArchiveYear}`}

function supplierDisplayedFinancial(){
  const s=model.state.suppliers.find(x=>x.id===supplierUi.currentSupplierId);
  if(!s)return{financial:transactionFinancialStatsData([]),financialPeriod:''};
  const all=balanceRows(s.id),yearCtx=supplierYearContext(s.id),selectedArchiveYear=['current','all'].includes(supplierUi.supplierYearView)?null:validSupplierYear(supplierUi.supplierYearView),rows=supplierRowsForView(all,yearCtx,selectedArchiveYear,{includeSearch:true});
  return{financial:transactionFinancialStatsData(rows.map(({t})=>t)),financialPeriod:supplierFinancialPeriod(yearCtx,selectedArchiveYear)}
}

function updateSupplierBottomSummary(){
  const summary=$('#main')?.querySelector('.supplier-bottom-summary');if(!summary)return;
  const {financial,financialPeriod}=supplierDisplayedFinancial(),debit=summary.querySelector('[data-supplier-summary="debit"]'),credit=summary.querySelector('[data-supplier-summary="credit"]'),net=summary.querySelector('[data-supplier-summary="net"]'),meta=summary.querySelector('[data-supplier-summary="meta"]');
  if(debit)debit.textContent=money(financial.debit);if(credit)credit.textContent=money(financial.credit);if(net){net.textContent=money(financial.net);net.classList.toggle('badtext',financial.net<0);net.classList.toggle('goodtext',financial.net>=0)}if(meta)meta.textContent=`${financialPeriod} · ${financial.txCount} תנועות מוצגות`
}

function renderSupplier({scrollMode='auto'}={}){
  const viewport=captureSupplierViewport();
  const suppliers=orderedSuppliers();
  let s=model.state.suppliers.find(x=>x.id===supplierUi.currentSupplierId);
  if(!s){supplierUi.currentSupplierId=suppliers[0]?.id;s=suppliers[0]}
  if(!s){$('#main').innerHTML='<div class="empty">אין ספקים.</div>';return}
  const all=balanceRows(s.id),b=all.length?all.at(-1).balance:0,yearCtx=supplierYearContext(s.id);
  if(supplierUi.supplierMoveTargetId&&(!supplierUi.supplierBulkMode||!model.state.transactions.some(t=>t.id===supplierUi.supplierMoveTargetId&&t.supplierId===s.id)))supplierUi.supplierMoveTargetId=null;
  let selectedArchiveYear=['current','all'].includes(supplierUi.supplierYearView)?null:validSupplierYear(supplierUi.supplierYearView);if(!['current','all'].includes(supplierUi.supplierYearView)&&(selectedArchiveYear===null||!yearCtx.years.includes(selectedArchiveYear))){supplierUi.supplierYearView='current';selectedArchiveYear=null}
  const rows=supplierRowsForView(all,yearCtx,selectedArchiveYear);
  const yearOptions=yearCtx.years.map(y=>`<option value="${esc(y)}" ${String(y)===supplierUi.supplierYearView?'selected':''}>ארכיון ${esc(y)}</option>`).join(''),allYearsOption=`<option value="all" ${supplierUi.supplierYearView==='all'?'selected':''}>כל השנים</option>`,currentLabel=`שוטף ${yearCtx.currentYear}${yearCtx.carryOpen?` · ${yearCtx.carryOpen} פתוחות ישנות`:''}`,movingTx=supplierUi.supplierMoveTargetId?model.state.transactions.find(t=>t.id===supplierUi.supplierMoveTargetId&&t.supplierId===s.id):null,moveLocked=!!movingTx,moveRowsHtml=rows.length?`${moveLocked?supplierMoveTargetRow(null,0):''}${rows.map(({t,balance})=>`${txRow(t,balance,yearCtx.yearById.get(t.id)??null)}${moveLocked?supplierMoveTargetRow(t.id,t.sequence):''}`).join('')}`:`<tr><td colspan="${esc(supplierUi.supplierBulkMode?13:12)}" class="empty">אין שורות המתאימות לסינון.</td></tr>`,moveGuide=moveLocked?`<div class="supplier-move-guide"><div class="supplier-move-guide-main"><span class="supplier-move-guide-icon">↕</span><div class="supplier-move-guide-text"><b>בחירת יעד לתנועה ${esc(movingTx.sequence)}</b><span>כל התנועות מוצגות זמנית לפי הסדר האמיתי. העבר את העכבר בין שורות ולחץ על ＋ במקום הרצוי.</span></div></div><button class="btn small" data-action="cancel-supplier-move-target">ביטול</button></div>`:'',visibleRows=supplierRowsForView(all,yearCtx,selectedArchiveYear,{includeSearch:true}),financial=transactionFinancialStatsData(visibleRows.map(({t})=>t)),financialPeriod=supplierFinancialPeriod(yearCtx,selectedArchiveYear);
  const main=$('#main');main.dataset.supplierId=s.id;
  main.innerHTML=`<section class="supplier-command">
    <div class="supplier-primary">
      <div id="supplierMenu" class="supplier-menu">
        <button id="supplierMenuTrigger" class="supplier-menu-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" ${moveLocked?'disabled':''} data-action="toggle-supplier-menu"><span class="supplier-menu-label">ספק</span><span class="supplier-menu-current">${esc(s.name)}</span><span class="supplier-menu-chevron">⌄</span></button>
        <div class="supplier-menu-popover" role="listbox" aria-label="בחירת ספק" data-action="stop-propagation">${suppliers.map(sp=>`<button type="button" role="option" aria-selected="${esc(sp.id===s.id?'true':'false')}" class="supplier-menu-item ${esc(sp.id===s.id?'active':'')}" data-action="choose-supplier" data-click-arg0="${esc(sp.id)}"><span>${esc(sp.name)}</span><span class="supplier-menu-check">${sp.id===s.id?'✓':''}</span></button>`).join('')}</div>
      </div>
      <button class="btn primary supplier-add-btn" ${moveLocked?'disabled':''} data-action="open-transaction-modal" data-click-arg0="${esc(s.id)}">＋ הוספת תנועה</button>
    </div>
    <span class="supplier-balance">יתרה <b class="${esc(b<0?'badtext':'goodtext')}">${money(b)}</b></span>
    <div class="supplier-year-picker"><span>שנה</span><select class="supplier-year-select" aria-label="תצוגת שנה" ${moveLocked?'disabled':''} data-change="set-supplier-year-view"><option value="current" ${supplierUi.supplierYearView==='current'?'selected':''}>${esc(currentLabel)}</option>${allYearsOption}${yearOptions}</select></div>
    <div class="supplier-search-wrap"><input class="supplier-search" aria-label="חיפוש בכרטיס ספק" placeholder="חיפוש פעולה, הערה או אספקה…" value="${esc(supplierUi.searchText)}" ${moveLocked?'disabled':''} data-input="filter-supplier-search"></div>
    <div class="filters"><button class="chip-filter ${esc(supplierUi.filterMode==='all'?'active':'')}" ${moveLocked?'disabled':''} data-action="filter-mode">הכל</button><button class="chip-filter ${esc(supplierUi.filterMode==='pending'?'active':'')}" ${moveLocked?'disabled':''} data-action="filter-mode-2">טרם סופק</button><button class="chip-filter ${esc(supplierUi.filterMode==='invoice'?'active':'')}" ${moveLocked?'disabled':''} data-action="filter-mode-3">חשבונית חסרה</button><button class="chip-filter ${esc(supplierUi.filterMode==='hm'?'active':'')}" ${moveLocked?'disabled':''} data-action="filter-mode-4">ח״מ</button></div>
    <div class="actions supplier-actions"><button class="btn small bulk-select-toggle ${esc(supplierUi.supplierBulkMode?'active':'')}" data-action="toggle-supplier-bulk-mode">${supplierUi.supplierBulkMode?'סיום בחירה':'בחירה'}</button>${supplierUi.supplierBulkMode?`<div class="supplier-bulk-tray" role="group" aria-label="פעולות על תנועות שנבחרו"><button id="supplierBulkMove" class="btn small supplier-move-btn ${esc(moveLocked?'active':'')}" data-action="${esc(moveLocked?'cancel-supplier-move-target':'open-selected-supplier-move')}" ${moveLocked?'':'disabled'}>${moveLocked?'בטל העברה':'העבר תנועה'}</button><button id="supplierBulkYear" class="btn small year-boundary-btn" data-action="open-selected-supplier-year-boundary" disabled>סוף שנה</button><button id="supplierBulkDelete" class="btn danger small bulk-delete-btn" data-action="delete-selected-transactions" disabled>מחק נבחרים</button></div>`:''}</div>
  </section>
  <div class="panel supplier-table-panel ${esc(moveLocked?'supplier-move-mode':'')}">${moveGuide}<div class="table-wrap"><table><thead><tr>${supplierUi.supplierBulkMode?'<th class="bulk-check-col"><input id="supplierBulkAll" class="bulk-check" type="checkbox" title="בחר את כל השורות המוצגות" data-change="toggle-supplier-bulk-visible"></th>':''}<th class="col-seq">#</th><th class="col-invoice">חשבונית</th><th class="col-action">פעולה</th><th class="col-money">חובה</th><th class="col-money">זכות</th><th class="col-balance">יתרה</th><th class="col-status">חתום</th><th class="col-status">סופק</th><th class="col-supply">זמן / אספקה</th><th class="col-status">ח״מ</th><th class="col-note">הערה</th><th class="col-row-actions"></th></tr></thead><tbody>${moveRowsHtml}</tbody></table><section class="supplier-bottom-summary" aria-label="סיכום כספי לספק"><div class="supplier-bottom-head"><h2>סיכום כספי</h2><small class="supplier-bottom-meta" data-supplier-summary="meta">${esc(financialPeriod)} · ${esc(financial.txCount)} תנועות מוצגות</small></div><div class="supplier-bottom-grid"><div><span>סה״כ חובה</span><b class="badtext" data-supplier-summary="debit">${money(financial.debit)}</b></div><div><span>סה״כ זכות</span><b class="goodtext" data-supplier-summary="credit">${money(financial.credit)}</b></div><div><span>סה״כ יתרה</span><b class="${esc(financial.net<0?'badtext':'goodtext')}" data-supplier-summary="net">${money(financial.net)}</b></div></div></section></div></div>`;
  mountViewLayout({headCount:1,className:'supplier-view-shell'});
  filterSupplierSearch(supplierUi.searchText);
  syncSupplierBulkUi();
  restoreSupplierViewport(viewport,s.id,scrollMode)
}

function filterSupplierSearch(value){if(supplierUi.supplierMoveTargetId){document.querySelectorAll('tbody tr[data-search]').forEach(row=>row.hidden=false);updateSupplierBottomSummary();syncSupplierBulkUi();return}const hadQuery=!!supplierUi.searchText.trim();supplierUi.searchText=value;const q=value.trim();document.querySelectorAll('tbody tr[data-search]').forEach(row=>row.hidden=!!q&&!row.dataset.search.includes(q));updateSupplierBottomSummary();syncSupplierBulkUi();if(hadQuery&&!q){const wrap=$('#main')?.querySelector('.supplier-table-panel .table-wrap');if(wrap)requestAnimationFrame(()=>{scrollSupplierTransactionsEnd(wrap);storeSupplierViewport(supplierUi.currentSupplierId,wrap)})}}

function boolText(v){return v===true?'כן':v===false?'לא':'—'}

function triStatusClass(value){return value===true?'tri-status-yes':value===false?'tri-status-no':''}

function inlineTri(t,field,label){const v=t[field];return `<div class="status-toggle" title="${esc(label)} · לחיצה חוזרת על הבחירה מבטלת אותה"><button class="yes ${esc(v===true?'active':'')}" data-action="set-inline-tri" data-click-arg0="${esc(t.id)}" data-click-arg1="${esc(field)}">כן</button><button class="no ${esc(v===false?'active':'')}" data-action="set-inline-tri-2" data-click-arg0="${esc(t.id)}" data-click-arg1="${esc(field)}">לא</button></div>`}

function inlineBool(t,field,label){const v=!!t[field];return `<div class="status-toggle binary" title="${esc(label)}"><button class="yes ${esc(v?'active':'')}" data-action="set-inline-bool" data-click-arg0="${esc(t.id)}" data-click-arg1="${esc(field)}">כן</button><button class="no ${esc(!v?'active':'')}" data-action="set-inline-bool-2" data-click-arg0="${esc(t.id)}" data-click-arg1="${esc(field)}">לא</button></div>`}

function setInlineTri(id,field,value){const t=model.state.transactions.find(x=>x.id===id);if(!t||!['invoiceReceived','signed','supplied'].includes(field))return;t[field]=t[field]===value?null:value;t.updatedAt=new Date().toISOString();scheduleSave('הסטטוס עודכן');renderSupplier({scrollMode:'preserve'})}

function setInlineBool(id,field,value){const t=model.state.transactions.find(x=>x.id===id);if(!t||field!=='hmIssued')return;if(t[field]===value)return;t[field]=value;t.updatedAt=new Date().toISOString();scheduleSave('הסטטוס עודכן');renderSupplier({scrollMode:'preserve'})}

function saveInlineText(id,field,el){const t=model.state.transactions.find(x=>x.id===id);if(!t||!['supplyInfo','note'].includes(field))return;const value=el.value.trim();if((t[field]||'')===value)return;t[field]=value;t.updatedAt=new Date().toISOString();scheduleSave(field==='supplyInfo'?'פרטי האספקה עודכנו':'ההערה עודכנה')}

function txRow(t,balance,assignedYear=null){const invoiceStatus=triStatusClass(t.invoiceReceived),signedStatus=triStatusClass(t.signed),suppliedStatus=triStatusClass(t.supplied),boundaryYear=validSupplierYear(t.yearEnd),carry=supplierUi.supplierYearView==='current'&&assignedYear!==null,yearTag=carry?`<span class="year-tag carry">פתוח מ־${esc(assignedYear)}</span>`:boundaryYear!==null?`<span class="year-tag">סוף ${esc(boundaryYear)}</span>`:'';return `<tr class="${esc(t.supplied===false?'pending':'')} ${esc(supplierUi.supplierBulkSelected.has(t.id)?'bulk-selected-row':'')} ${esc(supplierUi.supplierMoveTargetId===t.id?'supplier-move-source-row':'')} ${esc(carry?'year-carry-row':'')} ${esc(boundaryYear!==null?'year-boundary-row':'')}" data-tx-id="${esc(t.id)}" data-search="${esc(supplierSearchText(t,assignedYear))}">${supplierUi.supplierBulkMode?`<td class="bulk-check-col"><input class="bulk-check" type="checkbox" ${supplierUi.supplierBulkSelected.has(t.id)?'checked':''} aria-label="בחר תנועה ${esc(t.sequence)}" data-change="toggle-supplier-bulk-row" data-change-arg0="${esc(t.id)}"></td>`:''}<td class="col-seq" title="${esc(t.source?.sheet?`${esc(t.source.sheet)}${t.source?.row?` · שורת מקור ${esc(t.source.row)}`:''}`:'')}">${esc(t.sequence)}</td><td class="col-invoice ${esc(invoiceStatus)}">${inlineTri(t,'invoiceReceived','חשבונית התקבלה')}</td><td class="col-action"><div class="action-text">${esc(t.action||'')}${yearTag}</div>${t.correction?'<div class="badge red correction-badge">תיקון ייבוא</div>':''}</td><td class="money col-money badtext">${t.debit?`<b>${money(t.debit)}</b>`:''}</td><td class="money col-money goodtext">${t.credit?`<b>${money(t.credit)}</b>`:''}</td><td class="money col-balance ${esc(balance<0?'badtext':'goodtext')}"><b>${money(balance)}</b></td><td class="col-status ${esc(signedStatus)}">${inlineTri(t,'signed','חתום')}</td><td class="col-status ${esc(suppliedStatus)}">${inlineTri(t,'supplied','סופק')}</td><td class="col-supply"><input class="inline-input" value="${esc(t.supplyInfo||'')}" placeholder="תאריך / פרטי אספקה" data-keydown="blur-input" data-blur="save-inline-text" data-blur-arg0="${esc(t.id)}"></td><td class="col-status">${inlineBool(t,'hmIssued','ח״מ יצא')}</td><td class="col-note"><input class="inline-input" value="${esc(t.note||'')}" placeholder="הערה" data-keydown="blur-input" data-blur="save-inline-text-2" data-blur-arg0="${esc(t.id)}"></td><td class="col-row-actions"><div class="row-actions"><button class="icon-btn add-row" title="הוסף תנועה מתחת לשורה זו" data-action="open-transaction-modal-2" data-click-arg0="${esc(t.supplierId)}" data-click-arg1="${esc(t.id)}">＋</button><button class="icon-btn" title="עריכת כל פרטי התנועה" data-action="open-transaction-modal-3" data-click-arg0="${esc(t.id)}">✎</button></div></td></tr>`}

return { renderSupplier, filterSupplierSearch, boolText, triStatusClass, inlineTri, inlineBool, setInlineTri, setInlineBool, saveInlineText, txRow };
}
