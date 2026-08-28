import {esc} from '../../core/values.js';
import {money, wholeShekel, moneyWhole} from '../../core/money.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsDashboardView({model, ui, checksSession, supplierBalance, supplierArchiveYears, supplierPeriodTx, supplierFinancialStats, totalStats, mountViewLayout, customerStats}){
function summaryYearView(){
  const years=supplierArchiveYears(),value=ui.summarySupplierYearView;
  if(value==='current'||value==='all')return value;
  const year=Number(value);
  if(Number.isInteger(year)&&years.includes(year))return String(year);
  ui.summarySupplierYearView='current';
  return 'current';
}

function setSummarySupplierYearView(value){
  const years=supplierArchiveYears(),year=Number(value);
  ui.summarySupplierYearView=value==='all'?'all':value==='current'?'current':Number.isInteger(year)&&years.includes(year)?String(year):'current';
  renderSummary();
}

function renderSummary(){
  const st=totalStats(),cst=customerStats(),kupaNet=checksSession.kupaNetReadout?.net??null,supplierNetWhole=wholeShekel(st.net),customerOpenWhole=wholeShekel(cst.openTotal),kupaNetWhole=kupaNet===null?null:wholeShekel(kupaNet),expected=kupaNetWhole===null?null:supplierNetWhole+customerOpenWhole+kupaNetWhole,yearView=summaryYearView(),years=supplierArchiveYears();
  const suppliers=model.state.suppliers.map(s=>{const tx=supplierPeriodTx(s.id,yearView),financial=supplierFinancialStats(s.id,yearView),b=supplierBalance(s.id);return{id:s.id,name:s.name,b,financial,txCount:tx.length,pending:tx.filter(t=>t.supplied===false).length,missing:tx.filter(t=>t.invoiceReceived===false).length,hm:tx.filter(t=>t.hmIssued).length,unsigned:tx.filter(t=>t.signed===false).length}}).sort((a,b)=>Math.abs(b.financial.net)-Math.abs(a.financial.net)||a.name.localeCompare(b.name,'he'));
  const periodTotals=suppliers.reduce((acc,s)=>{acc.debit+=s.financial.debit;acc.credit+=s.financial.credit;return acc},{debit:0,credit:0});periodTotals.net=periodTotals.credit-periodTotals.debit;
  const yearLabel=yearView==='current'?'שנה שוטפת':yearView==='all'?'כל השנים':`שנת ${yearView}`,yearOptions=years.map(year=>`<option value="${esc(year)}" ${String(year)===yearView?'selected':''}>${esc(year)}</option>`).join('');
  $('#main').innerHTML=`<section class="hero summary-hero"><div><h1>מאזן</h1></div></section>
<section class="finance-overview">
  <article class="forecast-card">
    <div class="forecast-label">מאזן תזרימי צפוי לאחר גביית הלקוחות ותשלום לספקים</div>
    <div class="forecast-value ${esc(expected===null?'':expected<0?'badtext':'goodtext')}">${expected===null?'—':moneyWhole(expected)}</div>
    <div class="forecast-formula"><span>חוב לקוחות פתוח <b>${moneyWhole(customerOpenWhole)}</b></span><span class="formula-op">+</span><span>נטו ספקים <b class="${esc(supplierNetWhole<0?'badtext':'goodtext')}">${moneyWhole(supplierNetWhole)}</b></span><span class="formula-op">+</span><span>מאזן קופה נטו <b class="${esc(kupaNetWhole===null?'':kupaNetWhole<0?'badtext':'goodtext')}">${kupaNetWhole===null?'—':moneyWhole(kupaNetWhole)}</b></span><span class="formula-op">=</span><span><b class="${esc(expected===null?'':expected<0?'badtext':'goodtext')}">${expected===null?'—':moneyWhole(expected)}</b></span></div>
    <div class="forecast-note">חוב לקוחות פתוח + נטו ספקים + מאזן קופה נטו. זהו מאזן תזרימי צפוי ולא חישוב רווח חשבונאי.</div>
  </article>
  <div class="finance-side-grid">
    <div class="kpi"><div class="label">חוב לקוחות פתוח</div><div class="value goodtext">${money(cst.openTotal)}</div><div class="sub">${esc(cst.open)} חובות שטרם שולמו</div></div>
    <div class="kpi"><div class="label">נטו ספקים</div><div class="value ${esc(supplierNetWhole<0?'badtext':'goodtext')}">${moneyWhole(supplierNetWhole)}</div><div class="sub">זכות אצל ספקים פחות חוב לספקים</div></div>
    <div class="kpi kupa-net-kpi"><div class="label">מאזן קופה נטו</div><div class="value ${esc(kupaNet===null?'':kupaNet<0?'badtext':'goodtext')}">${kupaNet===null?'—':money(kupaNet)}</div><div class="sub">עו״ש − כל האשראי העתידי − חודש הוצאות + קופה מזומן וצ'קים${kupaNet===null?' · ממתין לקריאה מהענן':''}</div></div>
  </div>
</section>
<section class="summary-section customer-summary-section"><div class="summary-section-head"><div><h2>סיכום חובות לקוחות</h2><p>הסיכום כולל רק חובות שטרם שולמו; חוב שסומן כשולם יוצא מהחישוב.</p></div></div><div class="customer-summary-grid">
  <div class="customer-summary-stat"><span>חוב שסופק</span><b class="badtext">${money(cst.openSuppliedTotal)}</b><small>${esc(cst.openSupplied)} חובות פתוחים שסופקו</small></div>
  <div class="customer-summary-stat"><span>חוב שלא סופק</span><b class="warntext">${money(cst.openUnsuppliedTotal)}</b><small>${esc(cst.openUnsupplied)} חובות פתוחים שטרם סופקו</small></div>
  <div class="customer-summary-stat"><span>סה״כ חוב פתוח</span><b class="badtext">${money(cst.openTotal)}</b><small>${esc(cst.open)} חובות שטרם שולמו</small></div>
</div></section>
<section class="summary-section supplier-summary-section"><div class="summary-section-head supplier-summary-section-head"><div><h2>סיכום לפי ספק</h2><p>סיכום כספי ותפעולי לפי התקופה שנבחרה, עם מעבר ישיר לכרטיס הספק.</p></div><div class="supplier-summary-year-picker"><span>תקופה</span><select aria-label="תקופת סיכום ספקים" data-change="set-summary-supplier-year-view"><option value="current" ${yearView==='current'?'selected':''}>שנה שוטפת</option><option value="all" ${yearView==='all'?'selected':''}>כל השנים</option>${yearOptions}</select></div></div>
<div class="supplier-period-totals" aria-label="סיכום כל הספקים לתקופה"><span><small>סה״כ חובה</small><b class="badtext">${money(periodTotals.debit)}</b></span><span><small>סה״כ זכות</small><b class="goodtext">${money(periodTotals.credit)}</b></span><span><small>סה״כ יתרה</small><b class="${esc(periodTotals.net<0?'badtext':'goodtext')}">${money(periodTotals.net)}</b></span><em>${esc(yearLabel)}</em></div>
<div class="summary-inline-totals supplier-operational-totals"><span>טרם סופק <b>${esc(suppliers.reduce((n,s)=>n+s.pending,0))}</b></span><span>חשבוניות חסרות <b>${esc(suppliers.reduce((n,s)=>n+s.missing,0))}</b></span><span>ח״מ <b>${esc(suppliers.reduce((n,s)=>n+s.hm,0))}</b></span></div>
<div class="supplier-summary-grid">${suppliers.map(s=>`<button type="button" class="supplier-summary-card" data-action="open-supplier" data-click-arg0="${esc(s.id)}"><div class="supplier-summary-head"><div><h3>${esc(s.name)}</h3><span>${esc(yearLabel)} · ${esc(s.txCount)} תנועות</span></div><span class="supplier-summary-arrow">‹</span></div><div class="supplier-card-financial"><div><span>סה״כ חובה</span><b class="badtext">${money(s.financial.debit)}</b></div><div><span>סה״כ זכות</span><b class="goodtext">${money(s.financial.credit)}</b></div><div><span>סה״כ יתרה</span><b class="${esc(s.financial.net<0?'badtext':'goodtext')}">${money(s.financial.net)}</b></div></div><div class="supplier-summary-details"><div><span>טרם סופק</span><b class="${esc(s.pending?'warntext':'')}">${esc(s.pending)}</b></div><div><span>חשבונית חסרה</span><b class="${esc(s.missing?'badtext':'')}">${esc(s.missing)}</b></div><div><span>לא חתום</span><b class="${esc(s.unsigned?'warntext':'')}">${esc(s.unsigned)}</b></div><div><span>ח״מ</span><b>${esc(s.hm)}</b></div><div><span>יתרה כוללת</span><b class="${esc(s.b<0?'badtext':'goodtext')}">${money(s.b)}</b></div></div></button>`).join('')||'<div class="empty">אין ספקים להצגה.</div>'}</div></section>`;mountViewLayout({headCount:1,className:'summary-view-shell',scrollKey:'summary'})}

return { renderSummary, setSummarySupplierYearView };
}
