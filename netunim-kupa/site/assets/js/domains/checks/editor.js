import {esc, uid, clone} from '../../core/values.js';
import {num, wholeMoney} from '../../core/money.js';
import {generatedCheckSeriesRow, nextSeriesCheckNumber} from './model.js';
import {addMonthsISO, todayISO} from '../../core/dates.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsChecksEditor({model, checkDateEditorMarkup, toast, armModalDraftGuard, modal, deleteRecord, setCheckDateValue, saveChecksState, normalizeCheckModalDates, closeModal}){
function openCheckModal(id){
  if(id){
    const c=model.state.checks.find(x=>x.id===id);if(!c)return toast('הצק לא נמצא');
    modal('עריכת צק',`<div class="form-grid"><div class="form-group"><label>שם</label><input id="fName" value="${esc(c.name)}" autofocus></div><div class="form-group"><label>סכום</label><input id="fAmount" type="number" min="0" step="1" inputmode="numeric" value="${esc(c.amount||'')}"></div><div class="form-group"><label>תאריך פירעון</label>${checkDateEditorMarkup('fDue',c.dueDate||'',{label:'תאריך פירעון'})}<div class="check-date-hint">יום / חודש / 2 ספרות שנה</div></div><div class="form-group"><label>סטטוס</label><select id="fStatus">${['בקופה','הופקד - במעקב','נפרע','חזר','בוטל'].map(s=>`<option ${c.status===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div class="form-group"><label>מספר צק</label><input id="fNum" value="${esc(c.checkNumber)}"></div><div class="form-group full"><label>הערה</label><textarea id="fNote">${esc(c.note)}</textarea></div></div>`,'שמור שינויים',()=>saveCheck(id),()=>deleteRecord('checks',id));armModalDraftGuard();return;
  }
  modal('צק חדש',`<div class="form-grid"><div class="form-group"><label>שם לקוח</label><input id="fName" autofocus></div><div class="form-group"><label>מספר צקים</label><input id="fCheckCount" class="check-count-input" type="number" min="1" max="60" step="1" inputmode="numeric" value="1" data-change="change-check-series-count"></div><div class="form-group"><label>סטטוס</label><select id="fStatus">${['בקופה','הופקד - במעקב','נפרע','חזר','בוטל'].map(s=>`<option ${s==='בקופה'?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div class="check-series-wrap"><div class="check-series-head"><span>#</span><span>תאריך פירעון</span><span>סכום</span><span>מספר צק</span></div><div id="checkSeriesRows"></div></div><div class="check-series-note">ממלאים את השורה הראשונה ובוחרים מספר צקים. השורות הבאות נוצרות חודש אחר חודש באותו יום ובאותו סכום. אפשר לשנות ידנית כל תאריך, סכום או מספר צק לפני השמירה. בשנה מקלידים רק שתי ספרות, למשל 26 = 2026.</div><div class="form-group full"><label>הערה</label><textarea id="fNote"></textarea></div></div>`,'הוסף צקים',saveCheckSeries);
  renderCheckSeriesRows([{date:'',amount:'',number:'',manualDate:false,manualAmount:false,manualNumber:false}]);
  armModalDraftGuard();
}

function checkSeriesDrafts(){return [...document.querySelectorAll('#checkSeriesRows .check-series-row')].map(row=>({date:row.querySelector('[data-series-field="date"]')?.value||'',amount:row.querySelector('[data-series-field="amount"]')?.value||'',number:row.querySelector('[data-series-field="number"]')?.value.trim()||'',manualDate:row.querySelector('[data-series-field="date"]')?.dataset.manual==='1',manualAmount:row.querySelector('[data-series-field="amount"]')?.dataset.manual==='1',manualNumber:row.querySelector('[data-series-field="number"]')?.dataset.manual==='1'}))}

function renderCheckSeriesRows(rows){const host=document.getElementById('checkSeriesRows');if(!host)return;host.innerHTML=rows.map((r,i)=>`<div class="check-series-row"><div class="check-series-index">${i+1}</div>${checkDateEditorMarkup('',r.date||'',{series:true,seriesField:'date',manual:r.manualDate,role:i===0?'series-first':'series-manual',label:`תאריך פירעון בצק ${i+1}`})}<input data-series-field="amount" data-manual="${esc(r.manualAmount?'1':'0')}" type="number" min="0" step="1" inputmode="numeric" value="${esc(r.amount||'')}" ${i===0?'data-input="sync-check-series-from-first"':`data-input="mark-check-series-manual"`}><input data-series-field="number" data-manual="${esc(r.manualNumber?'1':'0')}" value="${esc(r.number||'')}" ${i===0?'data-input="sync-check-series-from-first"':`data-input="mark-check-series-manual"`}></div>`).join('')}

function markCheckSeriesManual(input){input.dataset.manual='1'}

function changeCheckSeriesCount(){const input=document.getElementById('fCheckCount');if(!input)return;let count=Math.round(num(input.value));count=Math.min(60,Math.max(1,count||1));input.value=count;const current=checkSeriesDrafts();const first=current[0]||{date:'',amount:'',number:''};const rows=[];for(let i=0;i<count;i++)rows.push(current[i]||generatedCheckSeriesRow(first,i));renderCheckSeriesRows(rows);syncCheckSeriesFromFirst()}

function syncCheckSeriesFromFirst(){const rows=[...document.querySelectorAll('#checkSeriesRows .check-series-row')];if(!rows.length)return;const first={date:rows[0].querySelector('[data-series-field="date"]')?.value||'',amount:rows[0].querySelector('[data-series-field="amount"]')?.value||'',number:rows[0].querySelector('[data-series-field="number"]')?.value.trim()||''};rows.slice(1).forEach((row,j)=>{const i=j+1,date=row.querySelector('[data-series-field="date"]'),amount=row.querySelector('[data-series-field="amount"]'),number=row.querySelector('[data-series-field="number"]');if(date?.dataset.manual!=='1')setCheckDateValue(date,first.date?addMonthsISO(first.date,i):'');if(amount?.dataset.manual!=='1')amount.value=first.amount;if(number?.dataset.manual!=='1')number.value=nextSeriesCheckNumber(first.number,i)})}

function saveCheckSeries(){
  if(!normalizeCheckModalDates())return;
  syncCheckSeriesFromFirst();
  const name=document.getElementById('fName').value.trim(),status=document.getElementById('fStatus').value,note=document.getElementById('fNote').value.trim();const drafts=checkSeriesDrafts();
  if(!name)return toast('יש למלא שם לקוח');
  if(!drafts.length)return toast('יש להוסיף לפחות צק אחד');
  const invalid=drafts.findIndex(r=>!r.date||wholeMoney(r.amount)<=0);if(invalid>=0)return toast(`יש למלא תאריך וסכום בצק ${invalid+1}`);
  const depositedStatus=['הופקד - במעקב','נפרע'].includes(status);
  const createdAt=todayISO(),depositedAt=depositedStatus?new Date().toISOString():null,records=drafts.map(r=>({id:uid('CHK'),name,amount:wholeMoney(r.amount),dueDate:r.date,status,depositDate:depositedStatus?r.date:null,depositedAt,depositSeq:null,clearedDate:status==='נפרע'?todayISO():null,checkNumber:r.number,note,createdAt}));
  model.state.checks.push(...records);
  closeModal(true);saveChecksState(records.length===1?'הצק נוסף':`${records.length} צקים נוספו`);
}

function saveCheck(id){
  if(!normalizeCheckModalDates())return;
  const oldRec=clone(model.state.checks.find(x=>x.id===id));if(!oldRec)return toast('הצק לא נמצא');
  const rec={id,name:document.getElementById('fName').value.trim(),amount:wholeMoney(document.getElementById('fAmount').value),dueDate:document.getElementById('fDue').value,status:document.getElementById('fStatus').value,depositDate:null,depositedAt:oldRec.depositedAt||null,depositSeq:oldRec.depositSeq||null,clearedDate:oldRec.clearedDate||null,checkNumber:document.getElementById('fNum').value.trim(),note:document.getElementById('fNote').value.trim(),createdAt:oldRec.createdAt||todayISO()};
  if(!rec.name||!rec.amount||!rec.dueDate)return toast('יש למלא שם, סכום ותאריך');
  const wasDeposited=['הופקד - במעקב','נפרע'].includes(oldRec.status),isDeposited=['הופקד - במעקב','נפרע'].includes(rec.status);rec.depositDate=isDeposited?rec.dueDate:(rec.status==='חזר'&&oldRec.depositDate?rec.dueDate:null);if(isDeposited&&!wasDeposited){rec.depositedAt=new Date().toISOString();rec.depositSeq=null}if(rec.status==='נפרע'&&!rec.clearedDate)rec.clearedDate=todayISO();if(rec.status!=='נפרע')rec.clearedDate=null;
  model.state.checks[model.state.checks.findIndex(x=>x.id===id)]=rec;
  closeModal(true);saveChecksState('הצק עודכן');
}

function markDeposited(id){const c=model.state.checks.find(x=>x.id===id);if(!c||c.status==='הופקד - במעקב')return;c.status='הופקד - במעקב';c.depositDate=c.dueDate;c.depositedAt=new Date().toISOString();c.depositSeq=null;c.clearedDate=null;saveChecksState('הצק סומן כהופקד')}

function markCleared(id){const c=model.state.checks.find(x=>x.id===id);if(!c)return;const wasDeposited=['הופקד - במעקב','נפרע'].includes(c.status);c.status='נפרע';c.clearedDate=todayISO();c.depositDate=c.dueDate;if(!wasDeposited){c.depositedAt=new Date().toISOString();c.depositSeq=null}saveChecksState('הצק סומן כנפרע')}

return { openCheckModal, checkSeriesDrafts, renderCheckSeriesRows, markCheckSeriesManual, changeCheckSeriesCount, syncCheckSeriesFromFirst, saveCheckSeries, saveCheck, markDeposited, markCleared };
}
