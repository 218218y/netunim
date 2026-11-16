import {createFinanceHistoryService} from './finance-history-service.js';
import {createFinanceLeaseOwner} from './finance-lease-owner.js';
import {createRuntimeTaskOwner} from './runtime-task-owner.js';
import {creditRestoreIssueLabel} from './credit-restore-validation.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=cents=>new Intl.NumberFormat('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);
function settingValue(value){
  if(value==null)return 'לא מוגדר';
  if(typeof value==='boolean')return value?'כן':'לא';
  if(Array.isArray(value)&&value.every(row=>row?.effectiveDate&&row.fromAccount&&row.toAccount))return value.map(row=>`${row.effectiveDate}: ${row.fromAccount} ← ${row.toAccount}`).join('; ');
  return typeof value==='object'?JSON.stringify(value):String(value);
}
function purchaseEvidence(tx){
  return `<strong>${esc(tx.description||'בית עסק לא נמסר')}</strong>
<br>מזהה מנפיק: ${esc(tx.id||tx.identifier||'לא נמסר')}
<br>תאריך מקור: ${esc(tx.date||'לא נמסר')}
<br>תאריך רכישה: ${esc(tx.transactionDate||'לא נמסר')}
<br>שעת רכישה: ${esc(tx.transactionTime||'לא נמסרה')}
<br>תאריך חיוב: ${esc(tx.processedDate||'ללא שיוך')}
<br>סוג: ${esc(tx.type||'לא נמסר')} · מט״ח: ${tx.foreignTransaction===true?'כן':tx.foreignTransaction===false?'לא':'לא נמסר'}
<br>מצב: ${esc(tx.status||'לא נמסר')} · ${esc(tx.chargeAmountStatus||'ללא תווית סכום')}
<br>תשלום: ${esc(tx.installments?.number??'—')}/${esc(tx.installments?.total??'—')}${tx.memo?`<br>הערה: ${esc(tx.memo)}`:''}`;
}
export function createFinanceHistoryDialog(ports){
  const tasks=createRuntimeTaskOwner(),leases=createFinanceLeaseOwner({leases:ports.leases,authority:{capture:ports.capture}});
  const service=createFinanceHistoryService({...ports,leases});
  let currentRoot=null,disposed=false,generation=0;
  const unsubscribe=ports.subscribeAccountScope?.(()=>{generation++;service.clear();currentRoot?.replaceChildren()});
  const visible=root=>!disposed&&ports.isActive()&&root?.isConnected&&root.closest('#modalBackdrop')?.classList.contains('open');
  function run(work){return tasks.run(work)}
  async function open(outerGuard){
    const owner=ports.capture(),turn=++generation;outerGuard();owner();
    const guard=()=>{outerGuard();owner();if(disposed||turn!==generation)throw Error('חלון הגרסאות נסגר או הוחלף')};
    const root=ports.mount('<div data-finance-history role="region" aria-label="גרסאות ושחזור אשראי"><p role="status">טוען גרסאות…</p></div>');
    currentRoot=root;
    let versions=[],cursor=null,preview=null,busy=false;
    function error(error){try{guard()}catch{if(root?.isConnected)root.replaceChildren();return}if(!visible(root))return;const output=root.querySelector('[data-history-status]');if(output){output.textContent=error.message;output.setAttribute('role','alert')}else root.textContent=error.message}
    async function perform(work){if(busy||!visible(root))return;busy=true;root.querySelectorAll('button,select,input').forEach(node=>node.disabled=true);try{await run(work)}catch(cause){error(cause)}finally{busy=false;if(visible(root)){root.querySelectorAll('button,select,input').forEach(node=>node.disabled=false);if(!preview?.validation.ok)root.querySelector('[data-history-restore]')?.setAttribute('disabled','')}}}
    function render(){
      guard();if(!visible(root))return;
      root.innerHTML=`<p class="soft-note">השחזור משנה אשראי בלבד. נתוני הבנק העדכניים נשמרים. ייצוא לקובץ הוא גיבוי עצמאי, ויש לשמור אותו מחוץ למסד.</p>
<label>גרסה להשוואה <select data-history-version>
<option value="">בחר גרסה</option>${versions.map(row=>`<option value="${esc(row.revision)}" ${Number(row.revision)===preview?.revision?'selected':''}>גרסה ${esc(row.revision)} · ${esc(new Date(row.captured_at).toLocaleString('he-IL'))}</option>`).join('')}</select>
</label>${cursor?'<button class="btn" type="button" data-history-more>גרסאות קודמות</button>':''}<p data-history-status role="status">
</p>
<div data-history-preview>
</div>`;
      root.querySelector('[data-history-version]').addEventListener('change',event=>perform(async()=>{
        const revision=Number(event.target.value);if(!revision)return;
        preview=await service.preview(revision,guard);guard();render();
      }));
      root.querySelector('[data-history-more]')?.addEventListener('click',()=>perform(async()=>{const rows=await service.list(cursor,guard);guard();versions.push(...rows);cursor=rows.length===100?Number(rows.at(-1).revision):null;render()}));
      if(!preview)return;
      const diff=preview.diff,panel=root.querySelector('[data-history-preview]');
      const exportBackup=()=>perform(async()=>{await service.exportVersion(preview,guard);guard();root.querySelector('[data-history-status]').textContent='קובץ הגיבוי נוצר ונבדקה תקינותו. יש לשמור אותו במקום עצמאי.'});
      if(!diff){
        panel.innerHTML='<p role="alert">מבנה הגרסה אינו מאפשר השוואה כספית אמינה. השחזור הרגיל חסום; ניתן לייצא את המקור לבדיקה ותיקון מבוקר.</p><button type="button" class="btn" data-history-export>ייצוא הגרסה לקובץ גיבוי</button>';
        panel.querySelector('[data-history-export]').addEventListener('click',exportBackup);return;
      }
      const changes=diff.changes.slice(0,500).map(row=>`<tr>
<td>${row.kind==='removed'?'ייגרע':'יתווסף'}</td>
<td>${esc(row.provider)} ••${esc(row.card.slice(-4))}</td>
<td>${esc(row.month)}</td>
<td>${purchaseEvidence(row.tx)}</td>
<td>${esc(row.tx.chargedAmount??'לא ידוע')} ${esc(row.tx.chargedCurrency||'')}</td>
<td>${esc(row.tx.originalAmount??'')} ${esc(row.tx.originalCurrency||'')}</td>
</tr>`).join('');
      panel.innerHTML=`<h3>השוואת המצב הנוכחי לגרסה ${esc(preview.revision)}</h3>
<p>${diff.beforeCount} רשומות כיום ← ${diff.afterCount} לאחר שחזור; ${diff.changes.length} שינויי רשומות.</p>
${!preview.validation.ok?`<p role="alert">הגרסה אינה תקינה לשחזור רגיל. נשמרת אפשרות הייצוא לצורך בדיקה ותיקון מבוקר.</p><ul>${preview.validation.issues.slice(0,100).map(issue=>`<li>${esc(creditRestoreIssueLabel(issue.code))}</li>`).join('')}</ul>`:''}
<h4>השפעה מחושבת — אשראי מסונכרן בלבד</h4>
<p>ליום ${esc(diff.asOf)}; חיובים ידניים בקופה אינם משתנים ואינם כלולים בסיכום זה. סכום ידוע אינו אישור לשלמות נתוני המנפיק.</p>
<div class="finance-history-table"><table><thead><tr><th>חודש / שיוך</th><th>מטבע / מצב</th><th>שקלים כיום</th><th>שקלים אחרי שחזור</th><th>הפרש בשקלים</th><th>לא נכלל בשקלים / כיסוי חסר</th></tr></thead>
<tbody>${diff.calculated.map(row=>`<tr><td>${esc(row.date||row.month)} / ${esc(row.account)}${row.hidden?' · מוסתר':''}</td><td>${esc(row.currency)} / ${row.pending?'ממתין':'הושלם'}</td><td>${money(row.before.cents)}</td><td>${money(row.after.cents)}</td><td>${money(row.after.cents-row.before.cents)}</td><td>${row.before.unknown}/${row.before.incomplete} ← ${row.after.unknown}/${row.after.incomplete}</td></tr>`).join('')}</tbody></table></div>
<h4>שינויי הגדרות (${diff.settingChanges.length})</h4>
<div class="finance-history-table"><table><thead><tr><th>הגדרה</th><th>כיום</th><th>אחרי שחזור</th></tr></thead><tbody>${diff.settingChanges.slice(0,500).map(row=>`<tr><td>${esc(row.label)}</td><td>${esc(settingValue(row.before))}</td><td>${esc(settingValue(row.after))}</td></tr>`).join('')}</tbody></table></div>
<div class="finance-history-table">
<table>
<thead>
<tr>
<th>כרטיס</th>
<th>חודש</th>
<th>כמות: כיום ← גרסה</th>
<th>שקלים: כיום ← גרסה</th>
<th>סכומים לא ידועים</th>
</tr>
</thead>
<tbody>${diff.groups.map(group=>`<tr>
<td>${esc(group.provider)} ••${esc(group.card)}</td>
<td>${esc(group.month)}</td>
<td>${group.before.count} ← ${group.after.count}</td>
<td dir="ltr">${money(group.before.ilsCents)} ← ${money(group.after.ilsCents)}</td>
<td>${group.before.unknown} ← ${group.after.unknown}</td>
</tr>`).join('')}</tbody>
</table>
</div>
<details>
<summary>פירוט רשומות שיוחלפו (${diff.changes.length})</summary>${(diff.changes.length>500||diff.settingChanges.length>500)?'<p>מוצגות 500 רשומות ראשונות. יש לייצא את דוח ההשוואה המלא ולבדוק אותו לפני אישור.</p>':''}<div class="finance-history-table">
<table>
<thead>
<tr>
<th>שינוי</th>
<th>כרטיס</th>
<th>חודש</th>
<th>עסקה וראיות רכישה</th>
<th>חיוב</th>
<th>מקור</th>
</tr>
</thead>
<tbody>${changes}</tbody>
</table>
</div>
</details>
<p>
<button type="button" class="btn" data-history-export>ייצוא הגרסה לקובץ גיבוי</button>
<button type="button" class="btn" data-history-comparison-export>ייצוא דוח השוואה מלא</button>
</p>
${(diff.changes.length>500||diff.settingChanges.length>500)?'<label><input type="checkbox" data-history-full-reviewed> ייצאתי ובדקתי את דוח ההשוואה המלא</label>':''}
<label>סיבת השחזור (8 תווים לפחות)<input data-history-reason type="text" minlength="8" maxlength="500" autocomplete="off">
</label>
<label>
<input type="checkbox" data-history-reviewed> בדקתי את ההפרשים ואת החיובים שייגרעו</label>
<button type="button" class="btn danger" data-history-restore>שחזור האשראי מהגרסה שנבחרה</button>
<p class="soft-note">סכומי מטבע חוץ ללא חיוב שקלי אינם מומרים לצורך ההשוואה. הקובץ כולל את המקור המלא; בשחזור הבנק נשאר עדכני.</p>`;
      panel.querySelector('[data-history-export]').addEventListener('click',exportBackup);
      panel.querySelector('[data-history-comparison-export]').addEventListener('click',()=>perform(async()=>{await service.exportComparison(preview,guard);guard();root.querySelector('[data-history-status]').textContent='דוח ההשוואה המלא יוצא. יש לבדוק אותו לפני האישור.'}));
      panel.querySelector('[data-history-restore]').addEventListener('click',()=>{
        const reason=panel.querySelector('[data-history-reason]').value.trim();
        if(!preview.validation.ok){error(Error('גרסה זו חסומה לשחזור רגיל. יש לייצא ולתקן בתהליך מבוקר'));return}
        if(!panel.querySelector('[data-history-reviewed]').checked||reason.length<8){error(Error('יש לבדוק את ההפרשים, לסמן אישור ולציין סיבה מפורטת'));return}
        return perform(async()=>{
          if(!await ports.confirmDialog('לשחזר את האשראי מהגרסה שנבחרה?',`נמצאו ${diff.settingChanges.length} שינויי הגדרות ו־${diff.changes.length} שינויי רשומות. ${diff.calculatedChanged?'הסכומים או השיוכים המחושבים משתנים לפי הטבלה.':'הסיכום המחושב נשאר זהה.'} נתוני הבנק נשארים עדכניים.`))return;
          guard();if(!visible(root))return;const result=await service.restore(preview,reason,guard,{fullReview:panel.querySelector('[data-history-full-reviewed]')?.checked===true});guard();
          if(visible(root))root.innerHTML=`<p role="status">${result.displayConfirmed?'השחזור נשמר ואומת בקריאה חוזרת מהענן.':'השחזור נשמר ואומת בענן, אך עדכון התצוגה עדיין לא אושר. יש לרענן מהענן.'}</p>`;
        });
      });
    }
    try{versions=await service.list(null,guard);guard();cursor=versions.length===100?Number(versions.at(-1).revision):null;render();if(!versions.length)root.querySelector('[data-history-status]').textContent='עדיין אין גרסאות זמינות לחשבון זה.'}catch(cause){error(cause)}
  }
  return {open:guard=>run(()=>open(guard)),runtime:{isPending:()=>tasks.isPending()||leases.runtime.isPending(),drain:async()=>{await tasks.drain();await leases.runtime.drain()},dispose(){disposed=true;generation++;unsubscribe?.();service.clear();tasks.close();leases.runtime.dispose();currentRoot?.replaceChildren()}}};
}
