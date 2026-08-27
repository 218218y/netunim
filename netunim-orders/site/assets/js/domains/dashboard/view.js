import {esc} from '../../core/values.js';
import {money, wholeShekel, moneyWhole} from '../../core/money.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsDashboardView({model, checksSession, supplierTx, supplierBalance, totalStats, mountViewLayout, customerStats}){
function renderSummary(){const st=totalStats(),cst=customerStats(),kupaNet=checksSession.kupaNetReadout?.net??null,supplierNetWhole=wholeShekel(st.net),customerOpenWhole=wholeShekel(cst.openTotal),kupaNetWhole=kupaNet===null?null:wholeShekel(kupaNet),expected=kupaNetWhole===null?null:supplierNetWhole+customerOpenWhole+kupaNetWhole;const suppliers=model.state.suppliers.map(s=>{const tx=supplierTx(s.id),b=supplierBalance(s.id);return{id:s.id,name:s.name,b,txCount:tx.length,pending:tx.filter(t=>t.supplied===false).length,missing:tx.filter(t=>t.invoiceReceived===false).length,hm:tx.filter(t=>t.hmIssued).length,unsigned:tx.filter(t=>t.signed===false).length}}).sort((a,b)=>Math.abs(b.b)-Math.abs(a.b));$('#main').innerHTML=`<section class="hero summary-hero"><div><h1>מאזן</h1><p>תמונה מרוכזת של ספקים, חובות לקוחות ומאזן הקופה, עם תחזית תזרימית לאחר גבייה ותשלום.</p></div></section>
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
<section class="summary-section customer-summary-section"><div class="summary-section-head"><div><h2>סיכום חובות לקוחות</h2><p>מצב הגבייה והחשבוניות לפי הנתונים הפעילים.</p></div></div><div class="customer-summary-grid">
  <div class="customer-summary-stat"><span>חוב פתוח</span><b class="badtext">${money(cst.openTotal)}</b><small>${esc(cst.open)} לקוחות</small></div>
  <div class="customer-summary-stat"><span>שולם · חסרה חשבונית</span><b class="warntext">${esc(cst.missingInvoice)}</b><small>דורש השלמת חשבונית</small></div>
  <div class="customer-summary-stat"><span>נסגרו</span><b class="goodtext">${esc(cst.closed)}</b><small>שולם + חשבונית יצאה</small></div>
  <div class="customer-summary-stat"><span>מעקב הזמנות</span><b>${esc(cst.trackedOrders)}</b><small>רשומות פעילות במעקב</small></div>
</div></section>
<section class="summary-section supplier-summary-section"><div class="summary-section-head"><div><h2>סיכום לפי ספק</h2><p>כל המידע שהוסר מלוח הספקים מרוכז כאן, עם מעבר ישיר לכרטיס הספק.</p></div><div class="summary-inline-totals"><span>טרם סופק <b>${esc(st.pending)}</b></span><span>חשבוניות חסרות <b>${esc(st.missing)}</b></span><span>ח״מ <b>${esc(st.hm)}</b></span></div></div><div class="supplier-summary-grid">${suppliers.map(s=>`<button type="button" class="supplier-summary-card" data-action="open-supplier" data-click-arg0="${esc(s.id)}"><div class="supplier-summary-head"><div><h3>${esc(s.name)}</h3><span>${s.b<0?'יתרה לתשלום':'יתרה בזכות'}</span></div><span class="supplier-summary-arrow">‹</span></div><div class="supplier-summary-balance ${esc(s.b<0?'badtext':'goodtext')}">${money(s.b)}</div><div class="supplier-summary-details"><div><span>תנועות</span><b>${esc(s.txCount)}</b></div><div><span>טרם סופק</span><b class="${esc(s.pending?'warntext':'')}">${esc(s.pending)}</b></div><div><span>חשבונית חסרה</span><b class="${esc(s.missing?'badtext':'')}">${esc(s.missing)}</b></div><div><span>לא חתום</span><b class="${esc(s.unsigned?'warntext':'')}">${esc(s.unsigned)}</b></div><div><span>ח״מ</span><b>${esc(s.hm)}</b></div></div></button>`).join('')}</div></section>`;mountViewLayout({headCount:1,className:'summary-view-shell',scrollKey:'summary'})}

return { renderSummary };
}
