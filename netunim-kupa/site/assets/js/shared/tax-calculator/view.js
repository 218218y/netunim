import { RULE_LABELS } from './rules.js';
import { validDate, ratio } from './contracts.js';
export function normalizeDate(value) {
  const text = String(value ?? '').trim();
  if (validDate(text)) return text;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const date = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return validDate(date) ? date : null;
}
function displayDate(value) {
  return validDate(value)
    ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
    : value;
}
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const money = (value) =>
  new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 2,
  }).format(value / 100);
export const TABS = [
  ['summary', 'סיכום'],
  ['business', 'עסק ומע״מ'],
  ['tax', 'מס הכנסה ופנסיה'],
  ['rent', 'שכירות'],
  ['family', 'משפחה וארנונה'],
  ['rules', 'כללים ועדכון שנתי'],
  ['audit', 'פירוט ובדיקות'],
  ['recovery', 'גיבוי ושחזור'],
];
export const LABELS = {
  revenue: 'מחזור עסקי',
  expensesMonthly: 'הוצאות מוכרות לחודש, לפני מע״מ',
  inputVatMonthly: 'מע״מ תשומות מוכר לחודש',
  activeSelfEmployed: 'מעמד עצמאי פעיל בביטוח לאומי',
  insuranceAdvanceMonthly: 'מקדמות לביטוח לאומי לחודש, כולל בריאות (ריק = לא הוזן)',
  pensionRequired: 'חלה חובת הפקדה לפנסיה',
  pensionActual: 'הפקדת פנסיה שנתית בפועל (ריק = תחזית מינימום)',
  extraPensionCredit: 'זכאות ידועה לזיכוי נוסף 0.5%',
  pensionDeduction: 'ניכוי פנסיה שנתי לפי אישור מס',
  pensionCredit: 'זיכוי מס פנסיה שנתי לפי אישור מס',
  rentMonthly: 'שכירות חודשית מתקבלת',
  rentExpenses: 'הוצאות שכירות שנתיות מוכרות',
  over60: 'גיל 60 ומעלה לצורך המסלול הרגיל',
  arnonaAnnual: 'ארנונה שנתית מלאה מחשבון הרשות',
  rentPaidMonthly: 'שכירות מגורים ששולמה בשנת השומה לארנונה (לקיזוז כנגד השכרה באותה תקופה)',
  arnonaRentReceivedMonthly: 'שכירות חודשית שהתקבלה בשנת השומה לארנונה (גם אם פטורה ממס)',
  householdOtherMonthly: 'מלגות, תמיכות ושאר הכנסות נוספות לחודש בשנת מבחן הארנונה',
  otherResidentsMonthly: 'הכנסת בן/בת זוג ומתגוררים לחודש לאחר התאמות הרשות',
  arnonaBusinessAnnual: 'בסיס העסק לארנונה, לפני ניכויים אישיים (אפשר להזין סכום מהשומה)',
  approvedDiscount: 'הנחה אפקטיבית מאושרת על כלל חשבון הארנונה, % (ריק = 0 לתשלום)',
  ageDate: 'תאריך ייחוס לגיל ולמגורים',
  assessmentYear: 'שנת ההכנסה בשומה · ארבע ספרות (ריק = תחזית)',
  city: 'יישוב',
  basePoints: 'נקודות זיכוי בסיסיות',
  extraPoints: 'נקודות נוספות לאחר בדיקת זכאות',
  adults: 'מבוגרים שאינם ברשימת הילדים',
  creditTrack: 'מסלול נקודות ילדים',
};
export const RESULT_LABELS = {
  revenue: 'מחזור ללא מע״מ',
  profit: 'רווח עסקי לפני מסים ופנסיה',
  rent: 'שכירות שהתקבלה · נכללת בנטו',
  rentExpenses: 'הוצאות שכירות · מופחתות מהנטו',
  outputVat: 'מע״מ עסקאות',
  inputVat: 'מע״מ תשומות',
  netVat: 'מע״מ לתשלום / החזר',
  national: 'ביטוח לאומי',
  health: 'ביטוח בריאות',
  pensionMinimum: 'מינימום פנסיה',
  pension: 'הפקדת פנסיה בחישוב',
  pensionDeduction: 'ניכוי פנסיה',
  pensionCredit: 'זיכוי מס פנסיה',
  insuranceDeduction: 'ניכוי ביטוח לאומי',
  taxable: 'רווח חייב במס',
  pointCredit: 'זיכוי בגין נקודות',
  businessTax: 'מס עסק כולל יסף',
  rentTax: 'תוספת מס בשל השכירות',
  incomeTax: 'מס הכנסה כולל שכירות ויסף',
  arnona: 'ארנונה לפי הנחה מאושרת',
  net: 'נטו כולל עסק ושכירות, לאחר מסים, פנסיה וארנונה',
};
export const RATE_LABELS = {
  rate: 'שיעור',
  minimumMonthly: 'בסיס מזערי חודשי',
  reducedMonthly: 'תקרת השיעור המופחת לחודש',
  maximumMonthly: 'תקרה מרבית לחודש',
  nationalLow: 'ביטוח לאומי מופחת',
  nationalHigh: 'ביטוח לאומי רגיל',
  healthLow: 'בריאות מופחת',
  healthHigh: 'בריאות רגיל',
  deductible: 'חלק דמי הביטוח המותר בניכוי',
  averageMonthly: 'שכר ממוצע חודשי',
  qualifyingAnnual: 'תקרת הכנסה מזכה לשנה',
  beneficiaryAnnual: 'תקרת הכנסה לעמית מוטב (מידע)',
  beneficiaryMinimum: 'הפקדה לעמית מוטב (מידע)',
  mandatoryLow: 'פנסיית חובה, רובד ראשון',
  mandatoryHigh: 'פנסיית חובה, רובד שני',
  deduction: 'ניכוי אוטומטי',
  creditBase: 'בסיס לזיכוי',
  extraCreditBase: 'בסיס זיכוי נוסף',
  creditRate: 'שיעור זיכוי',
  pointAnnual: 'שווי נקודת זיכוי שנתי',
  surtaxThreshold: 'סף מס יסף שנתי',
  surtaxRate: 'מס יסף',
  capitalThreshold: 'סף מס יסף הוני שנתי',
  capitalRate: 'מס יסף הוני נוסף',
  exemptionMonthly: 'תקרת פטור שכירות לחודש',
  flatRate: 'מסלול מס מופחת',
  ceiling: 'תקרת מדרגה שנתית',
};
const get = (object, path) => path.split('.').reduce((v, k) => v?.[k], object);
export function field(path, label, value, type = 'money', options = null, action = 'tax-input') {
  const id = 'tax-' + path.replaceAll('.', '-'),
    attrs = `id="${esc(id)}" aria-describedby="${esc(id)}-error" data-field="${esc(path)}" data-type="${type}" data-input="${action}" data-change="${action === 'tax-input' ? 'tax-save' : 'tax-rule-change'}"`;
  const control = options
    ? `<select
${attrs}>
${options
  .map(
    ([v, l]) => `<option
value="${esc(v)}"
${String(value) === v ? 'selected' : ''}>
${esc(l)}</option>
`,
  )
  .join('')}</select>
`
    : type === 'boolean'
      ? `<input
${attrs}
type="checkbox"
${value ? 'checked' : ''}>
`
      : `<input
${attrs}
type="${['date', 'year', 'text'].includes(type) ? 'text' : 'number'}"
${type === 'date' ? 'inputmode="numeric" maxlength="10" placeholder="יום/חודש/שנה" dir="ltr"' : ''}
${type === 'year' ? 'inputmode="numeric" maxlength="4" placeholder="למשל 2025" dir="ltr"' : ''}
${['money', 'percent', 'points'].includes(type) ? 'step="0.01" inputmode="decimal"' : type === 'integer' ? 'step="1"' : ''}
${!['date', 'text'].includes(type) ? 'min="0"' : ''}
value="${esc(value === null ? '' : type === 'date' ? displayDate(value) : type === 'money' || type === 'percent' ? value / 100 : value)}"
${type === 'money' ? 'placeholder="₪"' : ''}>
`;
  return `<label
class="tax-field ${type === 'boolean' ? 'tax-check' : ''}"
for="${id}">
<span>
${esc(label)}</span>
${control}<small id="${esc(id)}-error" data-tax-field-error class="tax-field-error" hidden></small></label>
`;
}
function summaryValue(label, annual, note = '') {
  return `<div><span>${esc(label)}</span><b>${annual === null ? 'נדרשים נתונים' : money(annual) + ' לשנה'}</b>
${annual === null ? '' : `<small>${money(ratio(annual, 1, 12))} בממוצע לחודש</small>`}
${note ? `<small>${esc(note)}</small>` : ''}</div>`;
}
export function insuranceSettlementMarkup(result) {
  const s = result.insuranceSettlement;
  const label = { due: 'תוספת משוערת לתשלום', refund: 'החזר משוער', balanced: 'המקדמות מכסות את החיוב',
    'not-entered': 'לא הוזנו מקדמות', 'missing-income': 'נדרש מחזור עסקי לחישוב ההפרש' }[s.status];
  const amount = s.balance === null ? null : Math.abs(s.balance);
  return `<div class="tax-settlement tax-settlement-${s.status}" role="status">
<div class="tax-card-values">${summaryValue('חיוב ביטוח לאומי ובריאות לפי הרווח', s.liability)}
${summaryValue('מקדמות בחישוב שנתי · 12 חודשים', s.advancesAnnual)}
${summaryValue(label, amount)}</div>
<p>ההשוואה מניחה את המקדמה החודשית שהוזנה בכל 12 חודשי השנה, כולל דמי בריאות. זו תחזית להפרשי שומה; היא אינה אישור ששולמו המקדמות. בחיובים משתנים ניתן להזין ממוצע חודשי של הסכום השנתי. החיוב השנתי כבר מופחת פעם אחת מהנטו; המקדמות וההפרש אינם מופחתים שוב.</p>
</div>`;
}
export function summaryHighlightsMarkup(result) {
  const a = result.annual, known = !result.missing.includes('מחזור עסקי');
  const net = result.complete ? a.net : null;
  const deductions = a.insurance + a.pension + a.incomeTax + a.arnona;
  return `<div class="tax-metrics tax-summary-top">
<div><span>מחזור העסק ללא מע״מ</span><strong>${known ? money(a.revenue) : 'טרם הוזן מחזור'}</strong><small>לשנה · הסכום העסקי שהוזן, לפני הוצאות</small></div>
<div class="tax-net-metric"><span>נטו משוער כולל עסק ושכירות</span><strong>${net === null ? 'נתונים חסרים' : money(result.monthly.net)}</strong><small>${net === null ? 'יש להשלים: ' + esc(result.missing.join(', ')) : money(net) + ' לשנה · ממוצע חודשי'}</small></div>
<div><span>נקודות זיכוי</span><strong>${result.family.points}</strong><small>${result.family.people} נפשות במבחן ארנונה</small></div></div>
<section class="tax-net-explanation" aria-label="הרכב הנטו">
<h3>מה נכלל בנטו?</h3><div class="tax-net-equation">
<span>רווח עסקי <b>${known ? money(a.profit) : 'טרם הוזן'}</b></span><span>+ שכירות לאחר הוצאות <b>${money(a.rent - a.rentExpenses)}</b></span>
<span>− מסים, ביטוח, פנסיה וארנונה <b>${known ? money(deductions) : 'נדרש מחזור'}</b></span><span>= נטו לשנה <b>${net === null ? 'נתונים חסרים' : money(net)}</b></span></div>
<p>מחזור העסק והנטו הם סכומים שונים. הנטו כולל גם שכירות, ללא מלגות והכנסות מתגוררים המשמשות למבחן הארנונה בלבד. מע״מ מוצג בנפרד.</p></section>
<div class="tax-summary-grid">
<section class="tax-summary-card" aria-label="צפי מס הכנסה"><h3>צפי מס הכנסה</h3>
<div class="tax-card-values">${summaryValue('מס הכנסה כולל שכירות ויסף', known ? a.incomeTax : null)}
${summaryValue('זיכוי בגין נקודות ופנסיה', a.pointCredit + a.pensionCredit)}</div>
<p>מס העסק: ${known ? money(a.businessTax) : 'נדרש מחזור'} · תוספת בשל שכירות: ${known ? money(a.rentTax) : 'נדרש מחזור'}. הזיכוי מפחית מס עד אפס ואינו תוספת הכנסה לנטו.</p></section>
<section class="tax-summary-card" aria-label="צפי פנסיה"><h3>צפי הפקדה לפנסיה</h3>
<div class="tax-card-values">${summaryValue('מינימום הפקדה מחושב', known ? a.pensionMinimum : null)}
${summaryValue('הפקדה בפועל שהוזנה', result.pensionFunding.actual)}
${summaryValue('נותר להשלמת המינימום', known ? result.pensionFunding.remaining : null)}</div>
<p>${result.pensionFunding.actual === null ? 'לא הוזנה הפקדה בפועל; בנטו חושבה תחזית מינימום.' : 'הנטו מחושב לפי ההפקדה בפועל שהוזנה. היתרה מתייחסת למינימום בלבד.'}</p></section>
<section class="tax-summary-card tax-summary-wide" aria-label="צפי ביטוח לאומי"><h3>ביטוח לאומי ובריאות · הפרשי מקדמות</h3>
${insuranceSettlementMarkup(result)}</section>
<section class="tax-summary-card tax-summary-wide" aria-label="צפי מע״מ"><h3>צפי מע״מ · ${a.netVat < 0 ? 'יתרה להחזר' : 'יתרה לתשלום'}</h3>
<div class="tax-card-values">${summaryValue('מע״מ עסקאות', known ? a.outputVat : null)}${summaryValue('מע״מ תשומות', a.inputVat)}${summaryValue('יתרת מע״מ', known ? a.netVat : null)}</div></section>
<div class="tax-summary-wide">${arnonaResultsMarkup(result)}</div>
</div>`;
}
export function summaryMarkup(result) {
  if (!result) return '<p>יש לטעון נתוני שנה וכללים כדי לחשב.</p>';
  return `${summaryHighlightsMarkup(result)}
<h3>פירוט חודשי ושנתי</h3>
<div
class="tax-table-wrap">
<table
class="tax-results">
<thead>
<tr>
<th
scope="col">
רכיב</th>
<th
scope="col">
ממוצע לחודש</th>
<th
scope="col">
לשנה</th>
</tr>
</thead>
<tbody>
${Object.entries(RESULT_LABELS)
  .map(
    ([key, label]) =>
      `<tr>
<th
scope="row">
<a
href="#tax-breakdown"
data-action="tax-audit">
${label}${key === 'arnona' ? `<small> · ${result.arnona.basis === 'forecast' ? 'תחזית הנחה' : 'אומדן הנחה'}: ${result.arnona.estimatedDiscount === null ? 'לא חושב' : 'עד ' + result.arnona.estimatedDiscount / 100 + '%'} · הוחלה: ${result.arnona.discount / 100}% ${result.arnona.approved ? '(לפי אישור שהוזן)' : '(אין אישור)'}</small>` : ''}</a>
</th>
<td>
${money(result.monthly[key])}</td>
<td>
${money(result.annual[key])}</td>
</tr>
`,
  )
  .join('')}</tbody>
</table>
</div>
${arnonaBandMarkup(result, false)}
<p
class="tax-hint">
מע״מ מוצג בנפרד מהנטו, משום שהמחזור וההוצאות מחושבים ללא מע״מ. ממוצע חודשי הוא תוצאה שנתית חלקי 12.</p>
`;
}
/** The ceiling chart is a what-if reference, never an approved deduction. */
export function arnonaBandMarkup(result, includeOutcome = true) {
  if (!result) return '';
  const arnona = result.arnona;
  if (!arnona.jurisdictionMatches) return '<p>טבלת הנחות בני ברק אינה מתאימה ליישוב שהוגדר; לא מוצגות מדרגות זכאות.</p>';
  return `<section class="tax-arnona-bands" aria-label="מדרגות הנחה בארנונה">
<h3>מדרגות הנחת ארנונה לשנת ${result.taxYear}</h3>
${includeOutcome ? arnonaResultsMarkup(result) : ''}
<div class="tax-table-wrap"><table class="tax-results"><thead><tr><th scope="col">הכנסה חודשית עד</th><th scope="col">הנחה מרבית לפי מדרגה</th><th scope="col">תשלום שנתי תיאורטי</th></tr></thead><tbody>
${arnona.discountBands.map((entry) => `<tr${entry.matches ? ' class="tax-selected-band"' : ''}><td>${money(entry.maximum)}</td><td>עד ${entry.percent / 100}%${entry.matches ? ' — המדרגה המחושבת' : ''}</td><td>${entry.hypotheticalAnnualPayment === null ? 'חסר חיוב שנתי' : money(entry.hypotheticalAnnualPayment)}</td></tr>`).join('')}
</tbody></table></div>
<p class="tax-hint">הסכומים בטבלה להמחשה בלבד, לפני בדיקת זכאות, אישור הרשות ומגבלות שטח וסיווג; הם אינם סכומי התשלום בפועל. עבור עד חמש נפשות בבני ברק עשויה לחול מגבלת שטח של 100 מ״ר. התשלום שבסיכום מחושב רק לפי ההנחה האפקטיבית שאושרה והוזנה.</p></section>`;
}
export function arnonaResultsMarkup(result) {
  const a = result.arnona;
  return `<div class="tax-arnona-outcome" aria-live="polite">
<p><b>${a.basis === 'assessment' ? 'אומדן לפי נתוני השומה' : a.basis === 'forecast' ? 'תחזית הנחת ארנונה' : 'נדרשים נתוני הכנסה לחישוב'}</b>
 · שנת הכנסה שהוזנה: ${esc(a.assessmentYear ?? 'טרם נבחרה')}${a.requiredAssessmentYear === null ? '' : ` · התקופה הנדרשת בכללי ${result.taxYear}: ${a.requiredAssessmentYear}`}</p>
<div class="tax-arnona-values">
<span>הכנסה חודשית למבחן <b>${a.assessedIncome === null ? 'חסר בסיס הכנסה עסקית' : money(a.assessedIncome)}</b>${a.assessedAnnualIncome === null ? '' : `<small>${money(a.assessedAnnualIncome)} לשנה</small>`}</span>
<span>הנחה מרבית ${a.basis === 'forecast' ? 'בתחזית' : 'משוערת'} <b>${a.estimatedDiscount === null ? 'לא ניתן לחשב' : 'עד ' + a.estimatedDiscount / 100 + '%'}</b></span>
<span>ארנונה לאחר הנחה — תחזית בלבד <b>${a.estimatedAnnualPayment === null ? 'נדרש חיוב שנתי ובסיס הכנסה' : money(a.estimatedAnnualPayment) + ' לשנה'}</b>${a.estimatedMonthlyPayment === null ? '' : `<small>${money(a.estimatedMonthlyPayment)} לחודש</small>`}</span>
</div>
${a.reasons.length ? `<ul class="tax-arnona-reasons">${a.reasons.map(r => `<li>${esc(r.text)}</li>`).join('')}</ul>` : ''}
<p>הנחה שהוחלה בחיוב שבנטו: <b>${a.discount / 100}%</b>${a.approved ? ' (לפי נתון אישור שהוזן)' : ' (לא הוזן אישור)'}. סכום התחזית מוצג בנפרד ואינו אישור הרשות.</p>
</div>`;
}
function automaticArnonaField(path, i, result) {
  const automatic = i[path] === null;
  const amount = path === 'arnonaBusinessAnnual' ? result?.arnona.businessAnnual : result?.arnona.rentalReceivedMonthly;
  return `<div class="tax-auto-field" data-tax-auto-field="${path}">
${field(path, LABELS[path], automatic ? amount ?? null : i[path])}
<small data-tax-auto-source>${automatic ? 'מחושב אוטומטית · תחזית מנתוני העסק והשכירות' : 'הוזן ידנית · מחליף את החישוב האוטומטי'}</small>
<button class="tax-link" data-action="tax-reset-automatic" data-field="${path}" ${automatic ? 'hidden' : ''}>חזור לחישוב אוטומטי</button>
</div>`;
}
export function inputMarkup(tab, i, result) {
  const f = (key, type = 'money', options = null) => field(key, LABELS[key], i[key] ?? null, type, options);
  if (tab === 'business')
    return `<h2>
עסק ומע״מ</h2>
<p>
מזינים נתונים חשבונאיים ידנית. יתרת בנק, חובות לקוחות והמאזן אינם מחזור מס.</p>
<div
class="tax-fields">
${f('revenue')}${field('revenuePeriod', 'תקופת המחזור', i.revenuePeriod, 'text', [
      ['annual', 'שנתי'],
      ['monthly', 'חודשי'],
    ])}${field('vatIncluded', 'הסכום כולל מע״מ', i.vatIncluded, 'boolean')}${field('vatExempt', 'העסק פטור ממע״מ', i.vatExempt, 'boolean')}${f('expensesMonthly')}${f('inputVatMonthly')}${f('activeSelfEmployed', 'boolean')}</div>
`;
  if (tab === 'tax')
    return `<h2>
מס הכנסה ופנסיה</h2>
<p>
ההקצאה האוטומטית היא אומדן לעצמאי ללא הכנסה מבוטחת. סכומים מאישור מס ניתן להזין במצב ידני.</p>
<div
class="tax-fields">
${f('pensionRequired', 'boolean')}${f('pensionActual')}${field(
      'pensionMethod',
      'הקצאת הטבת הפנסיה',
      i.pensionMethod,
      'text',
      [
        ['deduction', 'ניכוי קודם'],
        ['credit', 'זיכוי קודם'],
        ['manual', 'ידני — לפי אישור מס'],
      ],
    )}${f('extraPensionCredit', 'boolean')}${f('pensionDeduction')}${f('pensionCredit')}</div>
<p>
אפס בהפקדה בפועל משמעו שלא הופקד כסף; השארת השדה ריק מחשבת תחזית לפי מינימום חובה.</p>
<h3>מקדמות ביטוח לאומי ובריאות</h3>
<div class="tax-fields">${f('insuranceAdvanceMonthly')}</div>
<div data-tax-insurance-settlement>${result ? insuranceSettlementMarkup(result) : ''}</div>
`;
  if (tab === 'rent')
    return `<h2>שכירות למגורים ומס הכנסה</h2>
<p>יש לבחור אפשרות אחת בלבד. בבחירת <strong>פטור עד לתקרה</strong> המערכת מחשבת פטור לשכירות למגורים העומדת בתנאי החוק, ומס רגיל רק על יתרה חייבת אם קיימת. אין צורך לסמן וי נוסף. בחירת 10% היא מסלול אחר, ללא פטור. בכל מקרה הכנסה משכירות נכללת בנפרד במבחן ההכנסה לארנונה של שנת השומה המתאימה.</p>
<div class="tax-fields">
${f('rentMonthly')}${f('rentExpenses')}${field('rentMode', 'סוג השכירות ומסלול המס', i.rentMode, 'text', [
  ['other-ordinary', 'השכרה שאינה זכאית למסלולי המגורים — מס רגיל'],
  ['residential-exemption', 'דירת מגורים — פטור עד התקרה ומס רגיל על היתרה'],
  ['residential-flat', 'דירת מגורים — מסלול 10% על התקבולים'],
  ['residential-auto', 'דירת מגורים — השוואה אוטומטית בין המסלולים'],
  ['excluded', 'לא לחשב כרגע מס על השכירות — חישוב חסר'],
], 'tax-input')}${f('over60', 'boolean')}</div>
${i.rentMode === 'other-ordinary' && i.rentMonthly > 0 ? '<p class="tax-warning">נבחרה השכרה שאינה זכאית למסלולי המגורים. כדי לחשב פטור על דירה למגורים העומדת בתנאים, בחרו באפשרות ״דירת מגורים — פטור עד התקרה״.</p>' : ''}
${result ? `<p>מסלול החישוב: <strong>${result.rental.route === 'ordinary' ? (i.rentMode !== 'other-ordinary' ? 'פטור עד לתקרה + מס רגיל על יתרה חייבת' : 'מס רגיל ללא פטור') : result.rental.route === 'flat' ? '10% ללא פטור' : result.rental.route === 'none' ? 'השכירות לא נכללה במס (חישוב חסר)' : 'ללא שכירות'}</strong>. הכנסה פטורה בחישוב מס הכנסה: ${money(result.rental.exemption)}. תוספת מס שכירות: ${money(result.annual.rentTax)}.</p>
<div class="tax-fields">${result.rental.comparisons.map(c => `<div class="tax-mini"><b>${c.route === 'ordinary' ? 'מסלול פטור/רגיל' : 'מסלול 10%'}</b><span>${c.valid ? money(c.tax) : 'לא זכאי לפי הקלט'}</span></div>`).join('')}</div>` : ''}`;
  if (tab === 'family') {
    const p = i.profile,
      fp = (key, type = 'points', options = null) =>
        field('profile.' + key, LABELS[key], p[key], type, options);
    return `<h2>
משפחה וארנונה</h2>
<p>
אלו פרטי השנה שנבחרה. הפרופיל הקבוע משמש ליצירת שנים חדשות; שינויו אינו משנה שנים שמורות.</p>
<div
class="tax-fields">
${fp('city', 'text')}${fp('creditTrack', 'text', [
      ['other', 'אב / הורה שאינו מקבל קצבת ילדים'],
      ['recipient', 'אם / הורה המקבל קצבת ילדים'],
    ])}${fp('basePoints')}${fp('extraPoints')}${fp('adults', 'integer')}${f('ageDate', 'date')}</div>
<h3>
ילדים ומתגוררים</h3>
<p>
אין צורך בשמות או במספרי זהות. נקודות המס נקבעות לפי הגיל בתום שנת המס; מגורים לפי תאריך הייחוס.</p>
<div
class="tax-children">
${
  p.children
    .map(
      (c, index) => `<div
class="tax-child">
${field(`profile.children.${index}.birthDate`, 'תאריך לידה', c.birthDate, 'date')}${field(`profile.children.${index}.resident`, 'מתגורר/ת בדירה', c.resident, 'boolean')}<span>
${result ? `גיל לשנת המס: ${result.family.children[index].taxAge} · נקודות: ${result.family.children[index].points}` : ''}</span>
<button
class="btn small"
data-action="tax-remove-child"
data-index="${index}">
הסרה</button>
</div>
`,
    )
    .join('') || '<p>לא הוזנו ילדים</p>'
}<div
class="tax-child">
<label>
תאריך לידה לילד נוסף <input
type="text"
inputmode="numeric"
maxlength="10"
placeholder="יום/חודש/שנה"
dir="ltr"
id="tax-new-child">
</label>
<button
class="btn"
data-action="tax-add-child">
הוסף ילד/ה</button>
</div>
</div>
<div
class="tax-toolbar">
<button
class="btn"
data-action="tax-save-profile">
שמור פרטים אלו גם כפרופיל קבוע</button>
<button
class="btn"
data-action="tax-apply-profile">
החל את הפרופיל הקבוע על שנה זו</button>
</div>
<h3>
נתוני מבחן ההכנסה</h3>
<p>
בסיס העסק מחושב אוטומטית מ<strong>המחזור ללא מע״מ פחות הוצאות עסקיות מוכרות, לפני ניכויים אישיים</strong>. אפשר להחליפו בסכום מהשומה, לפני ניכויי חלק 5. תקבולי שכירות פטורים ממס נכללים גם הם במבחן. חישוב מנתוני שנת המס או ללא שנת שומה מסומן כתחזית. אומדן לפי שומה דורש שנה מתאימה וסכומי עסק ושכירות מפורשים; לפי כללי בני ברק לשנת 2026 התקופה היא שנת 2025.</p>
<div
class="tax-fields">
${f('assessmentYear', 'year')}${f('arnonaAnnual')}${automaticArnonaField('arnonaBusinessAnnual', i, result)}${automaticArnonaField('arnonaRentReceivedMonthly', i, result)}${f('rentPaidMonthly')}${f('householdOtherMonthly')}${f('otherResidentsMonthly')}${f('approvedDiscount', 'percent')}</div>
<p>
לדוגמה, מלגת כולל של 1,000 ₪ בחודש מוזנת בשדה ״מלגות, תמיכות ושאר הכנסות״. הכנסות בני הבית מוזנות לפי שנת השומה שנבחרה, לאחר החריגים לפי הוראות הרשות. בהשכרת דירה ושכירת דירה אחרת למגורים במקביל, ניתן לקזז מההכנסה משכירות עד גובה השכירות ששולמה. הנחה בטבלת זכאות היא שיעור מרבי ולא אישור; לתשלום מחושבת הנחה רק מהשיעור האפקטיבי המאושר שהזנתם. אם ההנחה מוגבלת בשטח, יש לחשב שיעור אפקטיבי ביחס לחשבון כולו.</p>
<div data-tax-arnona-results>${result ? arnonaResultsMarkup(result) : ''}</div>`;
  }
  return '';
}
export function ruleUnit(path) {
  if (path.includes('.points.')) return 'points';
  const key = path.split('.').at(-1);
  return [
    'rate',
    'nationalLow',
    'nationalHigh',
    'healthLow',
    'healthHigh',
    'deductible',
    'mandatoryLow',
    'mandatoryHigh',
    'deduction',
    'creditBase',
    'extraCreditBase',
    'creditRate',
    'surtaxRate',
    'capitalRate',
    'flatRate',
  ].includes(key)
    ? 'percent'
    : 'money';
}
function ruleInputs(value, path = '') {
  return Object.entries(value)
    .map(([key, v]) => {
      const next = path ? path + '.' + key : key;
      if (v !== null && typeof v === 'object')
        return `<fieldset>
<legend>
${esc(key === 'brackets' ? 'מדרגות מס' : key === 'thresholds' ? 'ספים לפי מספר נפשות (90%, 70%, 50%, 30%)' : key === 'extraPerson' ? 'תוספת לכל נפש מעבר לתשע' : key === 'points' ? 'נקודות לפי גיל 0–18 (מקבל/ת קצבה, הורה אחר)' : key === 'rates' ? 'תעריפי ארנונה לפי סיווג (אזור א׳, אזור ב׳)' : Number.isInteger(Number(key)) ? 'שורה ' + (Number(key) + 1) : (RATE_LABELS[key] ?? key))}</legend>
<div
class="tax-fields">
${ruleInputs(v, next)}</div>
</fieldset>
`;
      return field(
        next,
        RATE_LABELS[key] ?? (Number.isInteger(Number(key)) ? 'עמודה ' + (Number(key) + 1) : key),
        v,
        ruleUnit(next),
        null,
        'tax-rule-input',
      ).replace('data-change="tax-save"', 'data-change="tax-rule-change"');
    })
    .join('');
}
export function rulesMarkup(rules) {
  return `<h2>
כללים ועדכון שנתי</h2>
<p>
כל קבוצה דורשת בדיקה מפורשת. פרסום יוצר גרסה חדשה; גרסאות קודמות ושנים אחרות נשמרות. תאריכי תחולה שאינם מכסים שנה מלאה גוררים אזהרה; יש לבצע התאמה מקצועית לחישוב תוך־שנתי.</p>
<p>
גרסה נוכחית: <b>
${esc(rules.version)}</b>
</p>
${Object.entries(rules.groups)
  .map(
    ([key, g]) =>
      `<details
class="tax-rule">
<summary>
${RULE_LABELS[key]} <span>
${g.status === 'reviewed' ? 'סומן כנבדק לשנת ' + g.year : 'דורש בדיקה'}</span>
</summary>
<div
class="tax-fields">
${field(`groups.${key}.year`, 'שנת תחולת הקבוצה', g.year, 'year', null, 'tax-rule-input')}${field(`groups.${key}.validFrom`, 'תחולה מתאריך', g.validFrom, 'date', null, 'tax-rule-input')}${field(`groups.${key}.validTo`, 'תחולה עד תאריך', g.validTo, 'date', null, 'tax-rule-input')}${field(`groups.${key}.source`, 'מקור (https)', g.source, 'text', null, 'tax-rule-input')}${field(`groups.${key}.notes`, 'הערות', g.notes, 'text', null, 'tax-rule-input')}</div>
<a
href="${esc(g.source)}"
target="_blank"
rel="noopener noreferrer">
פתח מקור לבדיקה</a>
${ruleInputs(g.values, `groups.${key}.values`)}<p>
בדיקה אחרונה: ${esc(g.checkedAt ?? 'טרם סומן')}</p>
<button
class="btn"
data-action="tax-review-group"
data-group="${key}">
בדקתי את הקבוצה לשנה שנבחרה</button>
</details>
`,
  )
  .join('')}<div
class="tax-toolbar">
${field('jurisdiction', 'יישוב לטבלת הארנונה', rules.jurisdiction, 'text', null, 'tax-rule-input')}<button
class="btn primary"
data-action="tax-publish-rules">
פרסם גרסה חדשה והחל על השנה</button>
<button
class="btn"
data-action="tax-rule-versions">
גרסאות שמורות לשנה</button>
</div>
`;
}
export function auditMarkup(result) {
  return `<h2
id="tax-breakdown">
פירוט חישוב ובדיקות</h2>
<p>
מנוע ${esc(result.engineVersion)} · כללים ${esc(result.rulesVersion)} · סכומים נשמרים באגורות; חישובים יחסיים מעוגלים לאגורה הקרובה, חצי כלפי חוץ.</p>
<ol
class="tax-trace">
${result.trace
  .map(
    (step) => `<li>
<span>
${esc(step.label)}</span>
<b>
${money(step.value)}</b>
</li>
`,
  )
  .join('')}</ol>
<h3>
מדרגות מס — הכנסה עסקית לפני זיכויים</h3>
<div
class="tax-table-wrap">
<table
class="tax-results">
<thead>
<tr>
<th>
מדרגה</th>
<th>
בסיס חייב במדרגה</th>
<th>
מס</th>
</tr>
</thead>
<tbody>
${result.taxSteps
  .map(
    (s) => `<tr>
<td>
${s.rate / 100}%</td>
<td>
${money(s.base)}</td>
<td>
${money(s.tax)}</td>
</tr>
`,
  )
  .join('')}</tbody>
</table>
</div>
<h3>
בדיקות והנחות מודל</h3>
<ul>
${
  result.warnings
    .map(
      (w) => `<li>
${esc(w)}</li>
`,
    )
    .join('') || '<li>קבוצות הכללים סומנו כנבדקות. אין בכך אימות משפטי של התוצאה.</li>'
}</ul>
`;
}
export function differences(before, after, path = '') {
  const rows = [];
  if (
    before !== null &&
    after !== null &&
    typeof before === 'object' &&
    typeof after === 'object'
  ) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      rows.push(...differences(before[key], after[key], path ? path + '.' + key : key));
  } else if (JSON.stringify(before) !== JSON.stringify(after))
    rows.push({ path, before: before ?? 'ריק', after: after ?? 'ריק' });
  return rows;
}
export function diffMarkup(before, after) {
  const rows = differences(before, after);
  return `<p>
${rows.length} שדות שונים</p>
<div
class="tax-table-wrap">
<table
class="tax-results">
<thead>
<tr>
<th>
שדה</th>
<th>
נוכחי</th>
<th>
מוצע</th>
</tr>
</thead>
<tbody>
${rows
  .slice(0, 500)
  .map(
    (row) =>
      `<tr>
<td>
${esc(LABELS[row.path] ?? row.path)}</td>
<td>
${esc(row.before)}</td>
<td>
${esc(row.after)}</td>
</tr>
`,
  )
  .join('')}</tbody>
</table>
</div>
`;
}
export { get };
