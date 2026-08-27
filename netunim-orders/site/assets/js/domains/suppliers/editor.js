import {esc, uid} from '../../core/values.js';
import {validSupplierYear, supplierSortValue} from './model.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsSuppliersEditor({model, supplierUi, ui, modal, triSelect, resequenceSupplier, insertTransactionAfter, toast, scheduleSave, render, renderSupplier, closeModal, parseTri}){
function openTransactionModal(id=null,supplierId=null,insertAfterId=null){
  const t=id?model.state.transactions.find(x=>x.id===id):null;
  const anchor=insertAfterId?model.state.transactions.find(x=>x.id===insertAfterId):null;
  const sid=t?.supplierId||anchor?.supplierId||supplierId||supplierUi.currentSupplierId||model.state.suppliers[0]?.id||'';
  const opts=model.state.suppliers.map(s=>`<option value="${esc(s.id)}" ${s.id===sid?'selected':''}>${esc(s.name)}</option>`).join('');
  const positionNotice=!t&&anchor?`<div class="field full"><div class="notice">התנועה תתווסף <b>מיד אחרי שורה ${esc(anchor.sequence)}</b>. שאר השורות ימוספרו מחדש אוטומטית, והיתרות יחושבו מחדש.</div></div>`:'',yearNotice=t&&validSupplierYear(t.yearEnd)!==null?`<div class="field full"><div class="notice">שורה זו מסומנת כ<b>סוף שנה ${esc(t.yearEnd)}</b>. כדי להעביר אותה לספק אחר יש להסיר קודם את סימון סוף השנה דרך מצב “בחירה”.</div></div>`:'';
  modal(t?'עריכת תנועה':anchor?'הוספת תנועה באמצע הכרטיס':'תנועה חדשה',`<div class="form-grid"><div class="field full"><label>ספק</label><select id="fSupplier" ${anchor||validSupplierYear(t?.yearEnd)!==null?'disabled':''}>${opts}</select></div>${positionNotice}${yearNotice}<div class="field full"><label>פעולה</label><input id="fAction" value="${esc(t?.action||'')}" placeholder="לדוגמה: הזמנה 1234 / תשלום"></div><div class="field"><label>סכום חובה</label><input id="fDebit" class="number-input" type="number" step="1" value="${esc(Number(t?.debit||0)||'')}"></div><div class="field"><label>סכום זכות</label><input id="fCredit" class="number-input" type="number" step="1" value="${esc(Number(t?.credit||0)||'')}"></div>${triSelect('fInvoice','חשבונית התקבלה',t?.invoiceReceived??false,true)}${triSelect('fSigned','חתום',t?.signed??false,true)}${triSelect('fSupplied','סופק',t?.supplied??false,true)}<div class="field"><label>זמן / פרטי אספקה</label><input id="fSupplyInfo" value="${esc(t?.supplyInfo||'')}" placeholder="תאריך, שבוע, הערה…"></div><div class="field"><label>ח״מ יצא</label><select id="fHm"><option value="false" ${!t?.hmIssued?'selected':''}>לא</option><option value="true" ${t?.hmIssued?'selected':''}>כן</option></select></div><div class="field full"><label>הערה</label><textarea id="fNote">${esc(t?.note||'')}</textarea></div>${t?.source?`<div class="field full"><div class="notice">מקור: ${esc(t.source.sheet)} · שורה ${esc(t.source.row)}. עריכה כאן אינה משנה את קובץ האקסל המקורי.</div></div>`:''}</div>`,`<button class="btn primary" data-action="save-transaction" data-click-arg0="${esc(id||'')}" data-click-arg1="${esc(insertAfterId||'')}">שמור</button>${t?`<button class="btn danger" data-action="delete-transaction" data-click-arg0="${esc(t.id)}">מחק תנועה</button>`:''}<button class="btn" data-action="close-modal">ביטול</button>`)
}

function saveTransaction(id,insertAfterId=''){
  const existing=id?model.state.transactions.find(x=>x.id===id):null;
  const oldSupplierId=existing?.supplierId||null;
  const supplierId=$('#fSupplier').value,action=$('#fAction').value.trim(),debit=Math.max(0,Number($('#fDebit').value||0)),credit=Math.max(0,Number($('#fCredit').value||0));
  if(!supplierId)return toast('יש לבחור ספק');
  if(!action&&!debit&&!credit)return toast('יש להזין פעולה או סכום');
  if(debit&&credit&&!confirm('הוזנו גם חובה וגם זכות באותה תנועה. לשמור כך?'))return;
  const row={...(existing||{}),id:existing?.id||uid(),supplierId,sequence:existing?.sequence||0,kind:debit?'חיוב':credit?'זיכוי/תשלום':'הערה',action,debit,credit,invoiceReceived:parseTri('fInvoice'),signed:parseTri('fSigned'),supplied:parseTri('fSupplied'),supplyInfo:$('#fSupplyInfo').value.trim(),hmIssued:$('#fHm').value==='true',note:$('#fNote').value.trim(),updatedAt:new Date().toISOString()};
  if(existing){
    Object.assign(existing,row);
    if(oldSupplierId!==supplierId){resequenceSupplier(oldSupplierId);insertTransactionAfter(existing,supplierId,null)}
  }else{
    model.state.transactions.push(row);
    insertTransactionAfter(row,supplierId,insertAfterId||null)
  }
  supplierUi.currentSupplierId=supplierId;closeModal();scheduleSave(existing?'התנועה עודכנה':insertAfterId?'התנועה נוספה במיקום שבחרת':'התנועה נוספה');if(ui.currentView==='supplier')renderSupplier({scrollMode:(!existing&&!insertAfterId)?'end':'preserve'});else render()
}

function deleteTransaction(id){const t=model.state.transactions.find(x=>x.id===id);if(!t)return;if(validSupplierYear(t.yearEnd)!==null)return toast(`יש להסיר קודם את סימון סוף שנה ${t.yearEnd} מהשורה`);if(!confirm('למחוק את התנועה? היתרות יחושבו מחדש אוטומטית.'))return;const sid=t.supplierId;model.state.transactions=model.state.transactions.filter(x=>x.id!==id);resequenceSupplier(sid);closeModal();scheduleSave('התנועה נמחקה');if(ui.currentView==='supplier')renderSupplier({scrollMode:'preserve'});else render()}

function openSelectedSupplierEditor(){const id=$('#settingsSupplierEdit')?.value;if(!id)return toast('יש לבחור ספק לעריכה');openSupplierModal(id)}

function openSupplierModal(id=null){const s=id?model.state.suppliers.find(x=>x.id===id):null;modal(s?'עריכת ספק':'ספק חדש',`<div class="form-grid"><div class="field full"><label>שם ספק</label><input id="sName" value="${esc(s?.name||'')}"></div><div class="field full"><label>הערה</label><input id="sNote" value="${esc(s?.note||'')}"></div></div>`,`<button class="btn primary" data-action="save-supplier" data-click-arg0="${esc(id||'')}">שמור</button><button class="btn" data-action="close-modal">ביטול</button>`)}

function saveSupplier(id){const name=$('#sName').value.trim();if(!name)return toast('יש להזין שם ספק');let s=id?model.state.suppliers.find(x=>x.id===id):null;if(s){s.name=name;s.note=$('#sNote').value.trim()}else{const nextOrder=model.state.suppliers.reduce((m,x)=>Math.max(m,supplierSortValue(x)),-1)+1;s={id:uid('SUP'),name,note:$('#sNote').value.trim(),active:true,sortOrder:nextOrder};model.state.suppliers.push(s);supplierUi.currentSupplierId=s.id}closeModal();scheduleSave(s?'הספק נשמר':'הספק נוסף');render()}

return { openTransactionModal, saveTransaction, deleteTransaction, openSelectedSupplierEditor, openSupplierModal, saveSupplier };
}
