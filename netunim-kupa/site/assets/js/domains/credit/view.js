import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {dateFmt, todayISO, monthKey, monthLabel, addMonthsISO} from '../../core/dates.js';
import {creditProgress} from './model.js';
import {CREDIT_PROVIDER_LABELS,creditCardMappingKey,creditSyncSummary,syncedInstallmentsData,syncedCreditSeries} from './sync-feed.js';

function syncDate(value){if(!value)return 'עדיין לא סונכרן';try{return new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))}catch{return String(value)}}
function uniqueOwners(model,summary){return [...new Set([...summary.sync.profiles.map(p=>p.ownerLabel),...(model.state.credits||[]).map(cr=>cr.ownerLabel)].map(x=>String(x||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'he'))}
function filterMatch(ui,row){const account=ui.creditAccountFilter||'all',owner=ui.creditOwnerFilter||'all';return (account==='all'||row.account===account)&&(owner==='all'||String(row.ownerLabel||'')===owner)}
function summaryCard(row){return row.hidden?'כרטיסים מוסתרים':row.card}

export function createDomainsCreditView({model, ui, pendingInstallments, syncBulkUi, bulkControls, bulkHeader, bulkCell,creditSyncUiState,refreshCreditBridgeStatus}){
function renderCredit(){
  const allFuture=pendingInstallments(),summary=creditSyncSummary(model.state),syncUi=creditSyncUiState(),owners=uniqueOwners(model,summary);
  if(!['all','עסקי','ביתי'].includes(ui.creditAccountFilter))ui.creditAccountFilter='all';
  if(ui.creditOwnerFilter!=='all'&&!owners.includes(ui.creditOwnerFilter))ui.creditOwnerFilter='all';
  const future=allFuture.filter(row=>filterMatch(ui,row)),syncedFuture=syncedInstallmentsData(model.state).filter(x=>x.date>=todayISO()&&filterMatch(ui,x));
  const currentMonth=monthKey(todayISO()),currentYear=Number(currentMonth.slice(0,4));
  const futureYears=[...new Set(future.map(x=>x.date.slice(0,4)))].map(Number).filter(y=>Number.isFinite(y)&&y>=currentYear);
  const maxYear=Math.max(currentYear+1,...futureYears,currentYear),years=Array.from({length:maxYear-currentYear+1},(_,i)=>String(currentYear+i));
  if(!['rolling12','all',...years].includes(String(ui.creditView)))ui.creditView='rolling12';
  let monthKeys=[],forecastTitle='';
  if(ui.creditView==='rolling12'){monthKeys=Array.from({length:12},(_,i)=>monthKey(addMonthsISO(`${currentMonth}-01`,i)));forecastTitle='תחזית 12 חודשים קדימה'}
  else if(ui.creditView==='all'){monthKeys=[...new Set(future.map(x=>monthKey(x.date)).filter(Boolean))].sort();forecastTitle='כל חיובי האשראי העתידיים'}
  else{monthKeys=Array.from({length:12},(_,i)=>`${ui.creditView}-${String(i+1).padStart(2,'0')}`);forecastTitle=`תחזית ${ui.creditView}`}
  const months=monthKeys.map(k=>{const inst=future.filter(x=>monthKey(x.date)===k);return {k,inst,total:inst.reduce((a,x)=>a+x.amount,0)}});
  const monthCards=months.length?months.map(m=>creditMonthCard(m)).join(''):'<div class="empty">אין חיובי אשראי עתידיים.</div>';
  const statusClass=syncUi.busy?'busy':syncUi.error?'error':summary.sync.errors.length?'warn':summary.hasData?'ok':'';
  const statusTitle=syncUi.busy?'מסנכרן חברות אשראי…':syncUi.error?'סנכרון האשראי נכשל':summary.sync.errors.length?'הסנכרון האחרון הושלם חלקית':summary.hasData?'נתוני חברות האשראי זמינים':'חיבור אוטומטי לחברות האשראי';
  const statusSub=syncUi.error?syncUi.error:summary.sync.errors.length?summary.sync.errors.map(e=>`${e.label||e.provider}: ${e.message}`).join(' · '):`עדכון אחרון: ${syncDate(summary.sync.syncedAt)}`;
  const localProfiles=Array.isArray(syncUi.status?.profiles)?syncUi.status.profiles:[];
  const localIds=new Set(localProfiles.map(p=>p.profileId));
  const cloudOnly=summary.sync.profiles.filter(p=>!localIds.has(p.profileId));
  const mappingRows=summary.sync.profiles.flatMap(profile=>profile.accounts.map(account=>creditMappingRow(profile,account,summary.sync.cardMappings)));
  const detailItems=creditDetailItems(summary).filter(item=>filterMatch(ui,item));
  document.getElementById('content').innerHTML=`
    <section class="section credit-sync-section">
      <details class="credit-sync-settings">
        <summary class="credit-sync-toolbar">
          <div class="credit-sync-headline ${statusClass}"><span class="credit-sync-state-icon">${syncUi.busy?'↻':syncUi.error?'!':summary.sync.errors.length?'!':summary.hasData?'✓':'◌'}</span><span class="credit-sync-state-copy"><b>${esc(statusTitle)}</b><small>${esc(statusSub)}</small></span></div>
          <div class="credit-sync-head-actions"><button class="btn primary" type="button" data-action="refresh-credit-sync">רענן אשראי עכשיו</button><button class="btn" type="button" data-action="refresh-credit-sync-interactive">רענן עם חלון אבחון</button></div><span class="credit-sync-chevron">⌄</span>
        </summary>
        <div class="credit-sync-settings-body">
          <div class="credit-sync-mode-card"><div><b>מודל החישוב: סנכרון חברות האשראי + תוספות ידניות</b><small>אין יותר מעבר בין ״ידני״ ל״מסונכרן״. כל כרטיס שסומן ״כלול״ נכנס אוטומטית לחישוב, ותוספת ידנית חדשה מצטרפת אליו רק כהשלמה נקודתית.</small></div><span class="badge blue">מקור קבוע</span></div>
          <div class="credit-sync-settings-grid">
            <div class="credit-sync-panel"><div class="credit-sync-panel-head"><b>חיבורים במחשב זה</b><span class="credit-profile-actions"><button class="btn" type="button" data-action="open-credit-connection">+ חיבור</button><button class="btn danger-soft" type="button" data-action="reset-credit-sync" ${syncUi.busy?'disabled':''}>איפוס מלא</button></span></div>
              ${localProfiles.length?localProfiles.map(p=>creditLocalProfileRow(p)).join(''):'<div class="empty compact">עדיין לא הוגדר חיבור אשראי במחשב זה.</div>'}
              ${cloudOnly.length?`<div class="credit-cloud-only"><b>חיבורים שסונכרנו ממחשב אחר</b>${cloudOnly.map(p=>`<div class="credit-profile-row"><span><b>${esc(p.label)}</b><small>${esc(CREDIT_PROVIDER_LABELS[p.provider]||p.provider)}${p.ownerLabel?` · ${esc(p.ownerLabel)}`:''}</small></span><button class="btn" type="button" data-action="open-credit-connection" data-click-arg0="${esc(p.profileId)}">הגדר גם במחשב זה</button></div>`).join('')}</div>`:''}
            </div>
            <div class="credit-sync-panel"><div class="credit-sync-panel-head"><b>שיוך כרטיסים</b><label class="credit-auto-toggle"><input type="checkbox" data-change="set-credit-auto-refresh" ${syncUi.autoEnabled?'checked':''}> עדכון אוטומטי פעם ביום</label></div>
              ${mappingRows.length?mappingRows.join(''):'<div class="empty compact">לא התקבלו עדיין כרטיסים. בצע סנכרון ראשון.</div>'}
            </div>
          </div>
          <div class="soft-note">״כלול״ קובע אם הכרטיס נכנס לחישובי הקופה. ״הסתר״ הוא תצוגה בלבד: הכרטיס ממשיך להיכלל בסכומים אם הוא מסומן ״כלול״, אבל שמו והפירוט שלו אינם מוצגים בנתונים החיים ובטבלת העסקאות. פרטי הכניסה נשמרים מוצפנים רק ב‑Windows; נתוני הסנכרון והשיוכים נשמרים במצב הקופה ויכולים להישמר בענן.</div>
        </div>
      </details>
    </section>
    <div class="toolbar credit-filter-toolbar">
      <select aria-label="טווח תחזית אשראי" data-change="credit-view"><option value="rolling12" ${ui.creditView==='rolling12'?'selected':''}>12 חודשים קדימה</option><option value="all" ${ui.creditView==='all'?'selected':''}>כל השנים</option><optgroup label="לפי שנה">${years.map(y=>`<option value="${esc(y)}" ${ui.creditView===y?'selected':''}>${esc(y)}</option>`).join('')}</optgroup></select>
      <select aria-label="סינון עסקי או ביתי" data-change="credit-account-filter"><option value="all" ${ui.creditAccountFilter==='all'?'selected':''}>עסקי + ביתי</option><option value="עסקי" ${ui.creditAccountFilter==='עסקי'?'selected':''}>עסקי בלבד</option><option value="ביתי" ${ui.creditAccountFilter==='ביתי'?'selected':''}>ביתי בלבד</option></select>
      <select aria-label="סינון לפי בעל כרטיס" data-change="credit-owner-filter"><option value="all" ${ui.creditOwnerFilter==='all'?'selected':''}>כל בעלי הכרטיסים</option>${owners.map(owner=>`<option value="${esc(owner)}" ${ui.creditOwnerFilter===owner?'selected':''}>${esc(owner)}</option>`).join('')}</select>
      <span class="stat-pill">מסונכרן + ידני משלים</span><span class="stat-pill">סה״כ עתידי במסנן: ${money(future.reduce((a,x)=>a+x.amount,0))}</span><span style="flex:1"></span>${bulkControls('credits')}<button class="btn primary" data-action="open-credit-modal">+ תוספת ידנית</button>
    </div>
    <section class="section"><div class="section-head"><div><h3>${esc(forecastTitle)}</h3><p>הסינון עסקי/ביתי ובעל הכרטיס חל על כל הסיכומים בעמוד. כרטיס מוסתר נספר בסכום אם הוא ״כלול״, אך מוצג רק כ״כרטיסים מוסתרים״ בסיכום.</p></div></div><div class="section-body"><div class="month-cards">${monthCards}</div></div></section>
    ${summary.hasData?renderSyncedAccounts(summary,syncedFuture):''}
    <section class="section credit-detail-section" style="margin-top:16px"><div class="section-head"><div><h3>עסקאות ותשלומים</h3><p>נתוני חברות האשראי מוצגים באותו מבנה של סכום, התקדמות, תשלום הבא ויתרה עתידית. תוספות ידניות חדשות מופיעות באותה טבלה ומסומנות בנפרד.</p></div></div><div style="overflow:auto"><table><thead><tr>${bulkHeader('credits')}<th>כרטיס</th><th>תיאור</th><th>סכום כולל</th><th>התקדמות</th><th>תשלום הבא</th><th>יתרה עתידית</th><th>מצב</th><th></th></tr></thead><tbody>${detailItems.length?detailItems.map(item=>item.source==='manual'?manualCreditRow(item.record):syncedCreditRow(item.series)).join(''):`<tr><td colspan="9"><div class="empty compact">אין עסקאות להצגה במסנן הנוכחי.</div></td></tr>`}</tbody></table></div></section>`;
  syncBulkUi('credits');
  if(!syncUi.status&&!syncUi.busy)refreshCreditBridgeStatus({quiet:true}).then(status=>{if(ui.currentPage==='credit'&&status)renderCredit()}).catch(()=>{});
}

function creditLocalProfileRow(p){return `<div class="credit-profile-row"><span><b>${esc(p.label)}</b><small>${esc(CREDIT_PROVIDER_LABELS[p.provider]||p.provider)}${p.ownerLabel?` · ${esc(p.ownerLabel)}`:''} · ברירת מחדל ${esc(p.defaultAccount)}</small></span><span class="credit-profile-actions"><button class="btn" type="button" data-action="open-credit-connection" data-click-arg0="${esc(p.profileId)}">עריכה</button><button class="btn danger-soft" type="button" data-action="delete-credit-connection" data-click-arg0="${esc(p.profileId)}">מחיקה מהמחשב</button></span></div>`}
function creditMappingRow(profile,account,mappings){
  const key=creditCardMappingKey(profile.profileId,account.accountNumber),mapping=mappings[key]||{},included=mapping.included===true,hidden=mapping.hidden===true,accountClass=mapping.account||profile.defaultAccount||'עסקי',cardName=mapping.cardName||'';
  return `<div class="credit-mapping-row ${included?'included':'excluded'} ${hidden?'hidden-card':''}">
    <label class="credit-card-include"><input type="checkbox" data-change="set-credit-card-included" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}" ${included?'checked':''}><span>${included?'כלול':'לא כלול'}</span></label>
    <label class="credit-card-hide"><input type="checkbox" data-change="set-credit-card-hidden" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}" ${hidden?'checked':''}><span>${hidden?'מוסתר':'הסתר'}</span></label>
    <span><b>${esc(CREDIT_PROVIDER_LABELS[profile.provider]||profile.provider)} • ${esc(account.accountNumber||'כרטיס')}</b><small>${esc(profile.label)}${profile.ownerLabel?` · ${esc(profile.ownerLabel)}`:''}${included?' · נכנס לחישוב':' · זוהה בלבד'}${hidden?' · מוסתר מהפירוט':''}</small></span>
    <select aria-label="שיוך חשבון" data-change="set-credit-card-account" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}"><option ${accountClass==='עסקי'?'selected':''}>עסקי</option><option ${accountClass==='ביתי'?'selected':''}>ביתי</option></select>
    <input aria-label="שם הכרטיס" data-change="set-credit-card-name" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}" value="${esc(cardName)}" placeholder="שם תצוגה (רשות)">
  </div>`
}
function renderSyncedAccounts(summary,syncedFuture){
  const cardModels=summary.sync.profiles.flatMap(p=>p.accounts.map(a=>{const mapping=summary.sync.cardMappings[creditCardMappingKey(p.profileId,a.accountNumber)]||{},included=mapping.included===true,hidden=mapping.hidden===true,accountClass=mapping.account||p.defaultAccount,name=mapping.cardName||`${CREDIT_PROVIDER_LABELS[p.provider]||p.label} ••${String(a.accountNumber||'').slice(-4)}`;return {p,a,mapping,included,hidden,account:accountClass,ownerLabel:p.ownerLabel||'',name}})).filter(x=>!x.hidden&&filterMatch(ui,x));
  const selected=cardModels.filter(x=>x.included).length;
  const cards=cardModels.map(({p,a,included,account,name})=>{const pending=a.txns.filter(tx=>tx.status==='pending').length;return `<article class="credit-live-card ${included?'included':'excluded'}"><div><b>${esc(name)}</b><small>${esc(p.label)}${p.ownerLabel?` · ${esc(p.ownerLabel)}`:''} · ${esc(account)} · <span class="credit-card-state ${included?'on':'off'}">${included?'כלול בחישוב':'לא כלול בחישוב'}</span></small></div><div class="credit-live-balance"><span>${a.balance===null?'יתרה/חיוב קרוב לא זמין':'חיוב/יתרה שהחברה החזירה'}</span><b>${a.balance===null?'—':money(Math.abs(a.balance))}</b></div><small>${a.txns.length} תנועות${pending?` · ${pending} ממתינות`:''}${a.balanceDate?` · נכון ל־${dateFmt(String(a.balanceDate).slice(0,10))}`:''}</small></article>`}).join('');
  return `<section class="section credit-live-section" style="margin-top:16px"><div class="section-head"><div><h3>נתונים חיים מחברות האשראי</h3><p>${selected} כרטיסים כלולים ומוצגים במסנן · ${summary.hiddenAccountCount?`${summary.hiddenAccountCount} כרטיסים מוסתרים אינם מוצגים בשמותיהם. `:''}כרטיסים ״לא כלולים״ מוצגים כאן לבקרה בלבד.</p></div></div><div class="credit-live-grid">${cards||'<div class="empty compact">אין כרטיסים גלויים במסנן הנוכחי.</div>'}</div>${creditMonthlySummaryMarkup(syncedFuture)}</section>`
}
function creditMonthlySummaryMarkup(rows){
  if(!rows.length)return '<div class="soft-note" style="margin:14px 16px">אין חיובים עתידיים מסונכרנים במסנן הנוכחי.</div>';
  const months=[...new Set(rows.map(r=>monthKey(r.date)).filter(Boolean))].sort(),cards=[...new Set(rows.map(summaryCard).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'he'));
  const by=new Map(),cardTotals=new Map(cards.map(c=>[c,0]));let grand=0;
  for(const row of rows){const mk=monthKey(row.date),card=summaryCard(row),key=`${mk}\u0000${card}`;by.set(key,(by.get(key)||0)+row.amount);cardTotals.set(card,(cardTotals.get(card)||0)+row.amount);grand+=row.amount}
  return `<div class="credit-month-summary"><div class="credit-month-summary-head"><b>סיכום חודשי לפי כרטיס</b><small>לפי המסנן הפעיל · סה״כ ${money(grand)}</small></div><div class="credit-month-summary-scroll"><table><thead><tr><th>חודש</th>${cards.map(card=>`<th>${esc(card)}</th>`).join('')}<th>סה״כ חודש</th></tr></thead><tbody>${months.map(m=>{let total=0;const cells=cards.map(card=>{const v=by.get(`${m}\u0000${card}`)||0;total+=v;return `<td class="amount">${v?money(v):'—'}</td>`}).join('');return `<tr><th>${esc(monthLabel(m))}</th>${cells}<td class="amount total">${money(total)}</td></tr>`}).join('')}</tbody><tfoot><tr><th>סה״כ לכרטיס</th>${cards.map(card=>`<td class="amount">${money(cardTotals.get(card)||0)}</td>`).join('')}<td class="amount total">${money(grand)}</td></tr></tfoot></table></div></div>`;
}
function creditDetailItems(summary){
  const synced=syncedCreditSeries(model.state).map(series=>({source:'credit_sync',series,account:series.account,ownerLabel:series.ownerLabel,nextDate:series.next?.date||'9999-12-31'}));
  const manual=(model.state.credits||[]).map(record=>{const p=creditProgress(record);return {source:'manual',record,account:record.account,ownerLabel:record.ownerLabel||'',nextDate:p.next?.date||'9999-12-31'}});
  return [...synced,...manual].sort((a,b)=>a.nextDate.localeCompare(b.nextDate)||String((a.series||a.record)?.card||'').localeCompare(String((b.series||b.record)?.card||''),'he'));
}
function syncedCreditRow(series){
  const pct=series.totalParts?Math.min(100,(series.completedCount/series.totalParts)*100):0,status=series.complete?'הסתיים':series.partial?'אופק חלקי':'פעיל';
  return `<tr class="credit-synced-detail-row"><td></td><td><b>${esc(series.card)}</b><div class="muted">${esc(series.account)}${series.ownerLabel?` · ${esc(series.ownerLabel)}`:''} · מסונכרן</div></td><td>${esc(series.description)||'—'}</td><td class="amount">${money(series.totalAmount)}</td><td><div class="credit-progress"><b>נותרו ${esc(series.remainingCount)} מתוך ${esc(series.totalParts)}</b><div class="progress-mini"><div class="progress-track"><i style="width:${esc(pct)}%"></i></div><div class="muted" style="margin-top:4px">בוצעו ${esc(series.completedCount)}</div></div></div></td><td>${series.next?`${dateFmt(series.next.date)}<div class="muted">תשלום ${esc(series.next.part)}/${esc(series.next.totalParts)} · ${money(series.next.amount)}</div>`:series.remainingCount?'<span class="muted">לא התקבל תשלום עתידי באופק הסנכרון</span>':'—'}</td><td class="amount">${series.partial?'<span class="muted">לפחות </span>':''}${money(series.remainingAmount)}</td><td><span class="badge ${esc(status==='פעיל'?'green':status==='הסתיים'?'blue':'')}">${esc(status)}</span></td><td><span class="muted">מהחברה</span></td></tr>`
}
function manualCreditRow(cr){const p=creditProgress(cr),pct=cr.installments?Math.min(100,(p.completedCount/cr.installments)*100):0,status=!cr.active?'לא פעיל':p.complete?'הסתיים':'פעיל';return `<tr data-bulk-collection="credits" data-bulk-id="${esc(cr.id)}" class="${esc(ui.bulkSelected.has(cr.id)?'bulk-selected-row':'')}">${bulkCell('credits',cr.id)}<td><b>${esc(cr.card)}</b><div class="muted">${esc(cr.account)}${cr.ownerLabel?` · ${esc(cr.ownerLabel)}`:''} · תוספת ידנית</div></td><td>${esc(cr.description)||'—'}</td><td class="amount">${money(cr.totalAmount)}</td><td><div class="credit-progress"><b>נותרו ${esc(p.remainingCount)} מתוך ${esc(cr.installments)}</b><div class="progress-mini"><div class="progress-track"><i style="width:${esc(pct)}%"></i></div><div class="muted" style="margin-top:4px">בוצעו ${esc(p.completedCount)}</div></div></div></td><td>${p.next?`${dateFmt(p.next.date)}<div class="muted">תשלום ${esc(p.next.part)}/${esc(p.next.totalParts)} · ${money(p.next.amount)}</div>`:'—'}</td><td class="amount">${money(p.remainingAmount)}</td><td><span class="badge ${esc(status==='פעיל'?'green':status==='הסתיים'?'blue':'')}">${esc(status)}</span></td><td><button class="iconbtn" data-action="open-credit-modal-2" data-click-arg0="${esc(cr.id)}">עריכה</button></td></tr>`}
function creditMonthCard(m){const cur=monthKey(todayISO())===m.k,past=m.k<monthKey(todayISO()),by={};m.inst.forEach(x=>{const card=summaryCard(x);by[card]=(by[card]||0)+x.amount});return `<div class="month-card ${esc(cur?'current':'')}"><h4>${monthLabel(m.k)} ${cur?'<span class="badge blue">החודש</span>':past?'<span class="badge">עבר</span>':''}</h4>${Object.entries(by).length?Object.entries(by).map(([card,v])=>`<div class="metric"><span>${esc(card)}</span><b>${money(v)}</b></div>`).join(''):`<div class="muted">${past?'אין חיובים עתידיים':'אין חיובים'}</div>`}<div class="total">סה״כ ${money(m.total)}</div></div>`}
return {renderCredit,creditMonthCard};
}
