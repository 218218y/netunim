import {createFinanceHistoryService} from './finance-history-service.js';
import {createFinanceLeaseOwner} from './finance-lease-owner.js';
import {createRuntimeTaskOwner} from './runtime-task-owner.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=cents=>new Intl.NumberFormat('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);
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
    async function perform(work){if(busy||!visible(root))return;busy=true;root.querySelectorAll('button,select,input').forEach(node=>node.disabled=true);try{await run(work)}catch(cause){error(cause)}finally{busy=false;if(visible(root))root.querySelectorAll('button,select,input').forEach(node=>node.disabled=false)}}
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
      const changes=diff.changes.slice(0,500).map(row=>`<tr>
<td>${row.kind==='removed'?'ייגרע':'יתווסף'}</td>
<td>${esc(row.provider)} ••${esc(row.card.slice(-4))}</td>
<td>${esc(row.month)}</td>
<td>${esc(String(row.tx.date||'').slice(0,10))}<br>${esc(row.tx.description||row.tx.id||'')}</td>
<td>${esc(row.tx.chargedAmount??'לא ידוע')} ${esc(row.tx.chargedCurrency||'')}</td>
<td>${esc(row.tx.originalAmount??'')} ${esc(row.tx.originalCurrency||'')}</td>
</tr>`).join('');
      panel.innerHTML=`<h3>השוואת המצב הנוכחי לגרסה ${esc(preview.revision)}</h3>
<p>${diff.beforeCount} רשומות כיום ← ${diff.afterCount} לאחר שחזור; ${diff.changes.length} שינויי רשומות.</p>
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
<summary>פירוט רשומות שיוחלפו (${diff.changes.length})</summary>${diff.changes.length>500?'<p>מוצגות 500 רשומות ראשונות. יש לייצא את הגרסה לבדיקה מלאה לפני אישור.</p>':''}<div class="finance-history-table">
<table>
<thead>
<tr>
<th>שינוי</th>
<th>כרטיס</th>
<th>חודש</th>
<th>עסקה</th>
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
</p>
<label>סיבת השחזור (8 תווים לפחות)<input data-history-reason type="text" minlength="8" maxlength="500" autocomplete="off">
</label>
<label>
<input type="checkbox" data-history-reviewed> בדקתי את ההפרשים ואת החיובים שייגרעו</label>
<button type="button" class="btn danger" data-history-restore>שחזור האשראי מהגרסה שנבחרה</button>
<p class="soft-note">סכומי מטבע חוץ ללא חיוב שקלי אינם מומרים לצורך ההשוואה. הקובץ כולל את המקור המלא; בשחזור הבנק נשאר עדכני.</p>`;
      panel.querySelector('[data-history-export]').addEventListener('click',()=>perform(async()=>{await service.exportVersion(preview,guard);guard();root.querySelector('[data-history-status]').textContent='קובץ הגיבוי נוצר ונבדקה תקינותו. יש לשמור אותו במקום עצמאי.'}));
      panel.querySelector('[data-history-restore]').addEventListener('click',()=>{
        const reason=panel.querySelector('[data-history-reason]').value.trim();
        if(!panel.querySelector('[data-history-reviewed]').checked||reason.length<8){error(Error('יש לבדוק את ההפרשים, לסמן אישור ולציין סיבה מפורטת'));return}
        return perform(async()=>{
          if(!await ports.confirmDialog('לשחזר את האשראי מהגרסה שנבחרה?','חיובי האשראי יוחלפו לפי ההשוואה. נתוני הבנק לא יוחלפו.'))return;
          guard();if(!visible(root))return;const result=await service.restore(preview,reason,guard);guard();
          if(visible(root))root.innerHTML=`<p role="status">${result.displayConfirmed?'השחזור נשמר ואומת בקריאה חוזרת מהענן.':'השחזור נשמר ואומת בענן, אך עדכון התצוגה עדיין לא אושר. יש לרענן מהענן.'}</p>`;
        });
      });
    }
    try{versions=await service.list(null,guard);guard();cursor=versions.length===100?Number(versions.at(-1).revision):null;render();if(!versions.length)root.querySelector('[data-history-status]').textContent='עדיין אין גרסאות זמינות לחשבון זה.'}catch(cause){error(cause)}
  }
  return {open:guard=>run(()=>open(guard)),runtime:{isPending:()=>tasks.isPending()||leases.runtime.isPending(),drain:async()=>{await tasks.drain();await leases.runtime.drain()},dispose(){disposed=true;generation++;unsubscribe?.();service.clear();tasks.close();leases.runtime.dispose();currentRoot?.replaceChildren()}}};
}
