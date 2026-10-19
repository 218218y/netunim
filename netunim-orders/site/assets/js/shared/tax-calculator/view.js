import { RULE_LABELS } from './rules.js';
import { validDate } from './contracts.js';
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
  pensionRequired: 'חלה חובת הפקדה לפנסיה',
  pensionActual: 'הפקדת פנסיה שנתית בפועל (ריק = תחזית מינימום)',
  extraPensionCredit: 'זכאות ידועה לזיכוי נוסף 0.5%',
  pensionDeduction: 'ניכוי פנסיה שנתי לפי אישור מס',
  pensionCredit: 'זיכוי מס פנסיה שנתי לפי אישור מס',
  rentMonthly: 'שכירות חודשית מתקבלת',
  rentExpenses: 'הוצאות שכירות שנתיות מוכרות',
  rentEligible: 'השכירות זכאית עקרונית לפטור או למסלול 10%',
  over60: 'גיל 60 ומעלה לצורך המסלול הרגיל',
  arnonaAnnual: 'ארנונה שנתית מלאה מחשבון הרשות',
  rentPaidMonthly: 'שכירות חודשית שמשולמת למגורים',
  householdOtherMonthly: 'הכנסות נוספות למשק הבית לחודש לפי מבחן הרשות',
  otherResidentsMonthly: 'הכנסת בן/בת זוג ומתגוררים לחודש לאחר התאמות הרשות',
  arnonaBusinessAnnual: 'הכנסה עסקית שנתית מהשומה לארנונה (ריק = תחזית מרווח העסק)',
  approvedDiscount: 'הנחת ארנונה שאושרה בפועל, % (ריק = אומדן)',
  ageDate: 'תאריך ייחוס לגיל ולמגורים',
  assessmentYear: 'שנת הכנסה/שומה למבחן הארנונה',
  city: 'יישוב',
  basePoints: 'נקודות זיכוי בסיסיות',
  extraPoints: 'נקודות נוספות לאחר בדיקת זכאות',
  adults: 'מבוגרים שאינם ברשימת הילדים',
  creditTrack: 'מסלול נקודות ילדים',
};
export const RESULT_LABELS = {
  revenue: 'מחזור ללא מע״מ',
  profit: 'רווח עסקי לפני מסים ופנסיה',
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
  arnona: 'ארנונה לתשלום',
  net: 'נטו לאחר מסים, פנסיה וארנונה',
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
    attrs = `id="${esc(id)}" data-field="${esc(path)}" data-type="${type}" data-input="${action}" data-change="${action === 'tax-input' ? 'tax-save' : 'tax-rule-change'}"`;
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
type="${['date', 'text'].includes(type) ? 'text' : 'number'}"
${type === 'date' ? 'inputmode="numeric" maxlength="10" placeholder="יום/חודש/שנה" dir="ltr"' : ''}
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
${control}</label>
`;
}
export function summaryMarkup(result) {
  if (!result) return '<p>יש לטעון נתוני שנה וכללים כדי לחשב.</p>';
  return `<div
class="tax-metrics">
<div>
<span>
נטו חודשי משוער</span>
<strong>
${result.complete ? money(result.monthly.net) : 'נתונים חסרים'}</strong>
<small>
${result.complete ? money(result.annual.net) + ' לשנה' : 'יש להשלים: ' + esc(result.missing.join(', '))}</small>
</div>
<div>
<span>
מסים וביטוח לשנה</span>
<strong>
${money(result.annual.incomeTax + result.annual.insurance)}</strong>
<small>
לפי הנתונים הידועים והכללים שנבחרו</small>
</div>
<div>
<span>
נקודות זיכוי</span>
<strong>
${result.family.points}</strong>
<small>
${result.family.people} נפשות במבחן ארנונה</small>
</div>
</div>
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
${label}</a>
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
<p
class="tax-hint">
מע״מ מוצג בנפרד מהנטו, משום שהמחזור וההוצאות מחושבים ללא מע״מ. ממוצע חודשי הוא תוצאה שנתית חלקי 12.</p>
`;
}
export function inputMarkup(tab, i, result) {
  const f = (key, type = 'money', options = null) => field(key, LABELS[key], i[key], type, options);
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
`;
  if (tab === 'rent')
    return `<h2>
שכירות</h2>
<div
class="tax-fields">
${f('rentMonthly')}${f('rentExpenses')}${f('rentEligible', 'boolean')}${f('over60', 'boolean')}${field(
      'rentRoute',
      'מסלול',
      i.rentRoute,
      'text',
      [
        ['auto', 'אוטומטי — המס הנמוך'],
        ['ordinary', 'פטור / רגיל'],
        ['flat', '10% — בכפוף לזכאות'],
        ['none', 'ללא — החרגה מהאומדן'],
      ],
    )}</div>
${
  result
    ? `<p>
המסלול שנבחר: <b>
${result.rental.route === 'ordinary' ? 'פטור / רגיל' : result.rental.route === 'flat' ? '10%' : 'ללא'}</b>
. ההשוואה כוללת את סך מס ההכנסה והיסף.</p>
<div
class="tax-fields">
${result.rental.comparisons
  .map(
    (c) => `<div
class="tax-mini">
<b>
${c.route === 'ordinary' ? 'פטור / רגיל' : '10%'}</b>
<span>
${c.valid ? money(c.tax) : 'אינו זכאי לפי הקלט'}</span>
</div>
`,
  )
  .join('')}</div>
`
    : ''
}`;
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
    ])}${fp('basePoints')}${fp('extraPoints')}${fp('adults', 'integer')}${f('ageDate', 'date')}${f('assessmentYear', 'integer')}</div>
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
<div
class="tax-fields">
${f('arnonaAnnual')}${f('arnonaBusinessAnnual')}${f('rentPaidMonthly')}${f('householdOtherMonthly')}${f('otherResidentsMonthly')}${f('approvedDiscount', 'percent')}</div>
<p>
הכנסות נוספות מוזנות לאחר התאמות לפי הוראות הרשות, לרבות הכנסות ילדים וקצבאות שאינן נספרות. ההנחה המשוערת היא שיעור מרבי, כפוף לאישור הרשות.</p>
${
  result
    ? `<div
class="tax-mini">
הכנסה חודשית למבחן: <b>
${money(result.arnona.assessedIncome)}</b>
 · הנחה מרבית: <b>
${result.arnona.estimatedDiscount === null ? 'לא ידועה' : result.arnona.estimatedDiscount / 100 + '%'}</b>
 · הנחה שהוחלה: <b>
${result.arnona.discount / 100}% ${result.arnona.approved ? 'מאושרת לפי הזנה' : 'משוערת'}</b>
</div>
`
    : ''
}`;
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
${field(`groups.${key}.year`, 'שנת תחולת הקבוצה', g.year, 'integer', null, 'tax-rule-input')}${field(`groups.${key}.validFrom`, 'תחולה מתאריך', g.validFrom, 'date', null, 'tax-rule-input')}${field(`groups.${key}.validTo`, 'תחולה עד תאריך', g.validTo, 'date', null, 'tax-rule-input')}${field(`groups.${key}.source`, 'מקור (https)', g.source, 'text', null, 'tax-rule-input')}${field(`groups.${key}.notes`, 'הערות', g.notes, 'text', null, 'tax-rule-input')}</div>
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
