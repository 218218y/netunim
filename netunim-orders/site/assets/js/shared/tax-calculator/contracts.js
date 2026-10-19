// @ts-check
/** Money is integer agorot; rates are integer basis points (10000 = 100%). */
export const ENGINE_VERSION = '1.1.0';
export const GROUPS = [
  'vat',
  'insurance',
  'pension',
  'credits',
  'incomeTax',
  'rent',
  'arnonaIncome',
  'children',
  'arnonaRates',
];
export const clone = (value) => structuredClone(value);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function israelDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function currentTaxYear(now = new Date()) {
  return Number(israelDate(now).slice(0, 4));
}
export function createProfile() {
  return {
    kind: 'profile',
    schema: 1,
    city: 'בני ברק',
    creditTrack: 'other',
    basePoints: 2.25,
    extraPoints: 0,
    adults: 1,
    children: [],
  };
}
export function createAnnual(taxYear, profile = createProfile(), rules = null) {
  return {
    kind: 'annual',
    schema: 2,
    taxYear,
    mode: 'forecast',
    source: 'manual',
    ageDate: taxYear === currentTaxYear() ? israelDate() : `${taxYear}-12-31`,
    assessmentYear: null,
    profile: clone(profile),
    rules: clone(rules),
    revenue: null,
    revenuePeriod: 'annual',
    vatIncluded: false,
    vatExempt: false,
    expensesMonthly: 0,
    inputVatMonthly: 0,
    activeSelfEmployed: true,
    pensionRequired: true,
    pensionActual: null,
    pensionMethod: 'deduction',
    extraPensionCredit: false,
    pensionDeduction: 0,
    pensionCredit: 0,
    rentMonthly: 0,
    rentExpenses: 0,
    rentMode: 'other-ordinary',
    over60: false,
    arnonaAnnual: null,
    rentPaidMonthly: 0,
    // Income-test rent belongs to the assessment year, not the selected tax year.
    arnonaRentReceivedMonthly: null,
    householdOtherMonthly: 0,
    otherResidentsMonthly: 0,
    arnonaBusinessAnnual: null,
    approvedDiscount: null,
  };
}
export function toMinor(value) {
  const text = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text))
    throw new Error('יש להזין סכום עם עד שתי ספרות אחרי הנקודה');
  const negative = text.startsWith('-'),
    [whole, fraction = ''] = text.replace('-', '').split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > 1000000000000n) throw new Error('הסכום גדול מדי');
  return Number(negative ? -result : result);
}
export function ratio(amount, numerator, denominator) {
  if (![amount, numerator, denominator].every(Number.isSafeInteger) || denominator <= 0)
    throw new Error('יחידות חישוב לא תקינות');
  return fraction(BigInt(amount) * BigInt(numerator), BigInt(denominator));
}
export function fraction(value, den) {
  const sign = value < 0n ? -1n : 1n,
    abs = value * sign;
  const result = Number(sign * ((abs + den / 2n) / den));
  if (!Number.isSafeInteger(result)) throw new Error('חריגה מטווח החישוב');
  return result;
}
export const rate = (amount, bps) => ratio(amount, bps, 10000);
export const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) > 0 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value
  );
}
function integer(value, min = 0, max = 1000000000000) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function exactKeys(value, keys) {
  return (
    object(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function assertProfile(value) {
  if (
    !exactKeys(value, Object.keys(createProfile())) ||
    value.kind !== 'profile' ||
    value.schema !== 1 ||
    typeof value.city !== 'string' ||
    value.city.length > 120 ||
    !['recipient', 'other'].includes(value.creditTrack) ||
    !integer(value.adults, 1, 1000) ||
    ![value.basePoints, value.extraPoints].every(
      (n) =>
        typeof n === 'number' &&
        Number.isFinite(n) &&
        n >= 0 &&
        n <= 1000 &&
        Math.abs(n * 100 - Math.round(n * 100)) < 1e-8,
    ) ||
    !Array.isArray(value.children) ||
    value.children.length > 1000
  )
    throw new Error('פרופיל משפחה אינו תקין');
  const ids = new Set();
  for (const child of value.children) {
    if (
      !exactKeys(child, ['id', 'birthDate', 'resident']) ||
      typeof child.id !== 'string' ||
      !child.id ||
      child.id.length > 100 ||
      ids.has(child.id) ||
      !validDate(child.birthDate) ||
      typeof child.resident !== 'boolean'
    )
      throw new Error('פרטי ילד אינם תקינים');
    ids.add(child.id);
  }
  return clone(value);
}
export function assertRules(value) {
  if (
    !exactKeys(value, ['kind', 'schema', 'taxYear', 'version', 'jurisdiction', 'groups']) ||
    value.kind !== 'rules' ||
    value.schema !== 1 ||
    !integer(value.taxYear, 2000, 2200) ||
    typeof value.version !== 'string' ||
    !value.version ||
    value.version.length > 100 ||
    typeof value.jurisdiction !== 'string' ||
    value.jurisdiction.length > 120 ||
    !exactKeys(value.groups, GROUPS)
  )
    throw new Error('גרסת כללים אינה תקינה');
  const valueKeys = {
    vat: ['rate'],
    insurance: [
      'minimumMonthly',
      'reducedMonthly',
      'maximumMonthly',
      'nationalLow',
      'nationalHigh',
      'healthLow',
      'healthHigh',
      'deductible',
    ],
    pension: [
      'averageMonthly',
      'qualifyingAnnual',
      'beneficiaryAnnual',
      'beneficiaryMinimum',
      'mandatoryLow',
      'mandatoryHigh',
      'deduction',
      'creditBase',
      'extraCreditBase',
      'creditRate',
    ],
    credits: ['pointAnnual'],
    incomeTax: ['brackets', 'surtaxThreshold', 'surtaxRate', 'capitalThreshold', 'capitalRate'],
    rent: ['exemptionMonthly', 'flatRate'],
    arnonaIncome: ['thresholds', 'extraPerson'],
    children: ['points'],
    arnonaRates: ['rates'],
  };
  for (const key of GROUPS) {
    const group = value.groups[key];
    if (
      !exactKeys(group, [
        'year',
        'status',
        'checkedAt',
        'checkedBy',
        'validFrom',
        'validTo',
        'source',
        'notes',
        'values',
      ]) ||
      !['draft', 'reviewed'].includes(group.status) ||
      !integer(group.year, 2000, 2200) ||
      !validDate(group.validFrom) ||
      !validDate(group.validTo) ||
      group.validFrom > group.validTo ||
      typeof group.source !== 'string' ||
      group.source.length > 2000 ||
      !/^https:\/\//.test(group.source) ||
      typeof group.notes !== 'string' ||
      group.notes.length > 4000 ||
      !(group.checkedAt === null || validDate(group.checkedAt)) ||
      !(
        group.checkedBy === null ||
        (typeof group.checkedBy === 'string' &&
          group.checkedBy.length > 0 &&
          group.checkedBy.length <= 100)
      ) ||
      (group.status === 'reviewed' &&
        (!group.checkedAt || !group.checkedBy || group.year !== value.taxYear)) ||
      !exactKeys(group.values, valueKeys[key])
    )
      throw new Error('קבוצת כללים אינה תקינה: ' + key);
  }
  const g = value.groups,
    v = g.vat.values,
    n = g.insurance.values,
    p = g.pension.values,
    c = g.credits.values,
    t = g.incomeTax.values,
    r = g.rent.values,
    a = g.arnonaIncome.values,
    k = g.children.values,
    h = g.arnonaRates.values;
  const money = (x) => integer(x),
    bps = (x) => integer(x, 0, 10000),
    points = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
  if (
    !bps(v.rate) ||
    !['minimumMonthly', 'reducedMonthly', 'maximumMonthly'].every((key) => money(n[key])) ||
    n.minimumMonthly > n.reducedMonthly ||
    n.reducedMonthly > n.maximumMonthly ||
    !['nationalLow', 'nationalHigh', 'healthLow', 'healthHigh', 'deductible'].every((key) =>
      bps(n[key]),
    ) ||
    !['averageMonthly', 'qualifyingAnnual', 'beneficiaryAnnual', 'beneficiaryMinimum'].every(
      (key) => money(p[key]),
    ) ||
    ![
      'mandatoryLow',
      'mandatoryHigh',
      'deduction',
      'creditBase',
      'extraCreditBase',
      'creditRate',
    ].every((key) => bps(p[key])) ||
    !money(c.pointAnnual) ||
    !money(t.surtaxThreshold) ||
    !bps(t.surtaxRate) ||
    !money(t.capitalThreshold) ||
    !bps(t.capitalRate) ||
    !money(r.exemptionMonthly) ||
    !bps(r.flatRate) ||
    !Array.isArray(t.brackets) ||
    t.brackets.length < 1 ||
    t.brackets.length > 20 ||
    !Array.isArray(a.thresholds) ||
    a.thresholds.length !== 9 ||
    !Array.isArray(a.extraPerson) ||
    a.extraPerson.length !== 4 ||
    !a.extraPerson.every(money) ||
    !a.thresholds.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 4 &&
        row.every(money) &&
        row.every((n, i) => i === 0 || n >= row[i - 1]),
    ) ||
    !Array.isArray(k.points) ||
    k.points.length !== 19 ||
    !k.points.every((row) => Array.isArray(row) && row.length === 2 && row.every(points)) ||
    !Array.isArray(h.rates) ||
    h.rates.length !== 5 ||
    !h.rates.every((row) => Array.isArray(row) && row.length === 2 && row.every(money))
  )
    throw new Error('ערכי הכללים אינם תקינים');
  let previous = 0;
  for (const [i, band] of t.brackets.entries()) {
    if (
      !exactKeys(band, ['ceiling', 'rate']) ||
      !bps(band.rate) ||
      (i === t.brackets.length - 1 ? band.ceiling !== null : !integer(band.ceiling, previous + 1))
    )
      throw new Error('מדרגות המס אינן תקינות');
    previous = band.ceiling;
  }
  return clone(value);
}
export function assertAnnual(value) {
  if (
    !exactKeys(value, Object.keys(createAnnual(2026))) ||
    value.kind !== 'annual' ||
    value.schema !== 2 ||
    !integer(value.taxYear, 2000, 2200) ||
    !['forecast', 'actual'].includes(value.mode) ||
    !['manual', 'assessment'].includes(value.source) ||
    !validDate(value.ageDate) ||
    !(value.assessmentYear === null || integer(value.assessmentYear, 2000, 2200))
  )
    throw new Error('נתוני השנה אינם תקינים');
  assertProfile(value.profile);
  if (value.rules !== null) {
    assertRules(value.rules);
    if (value.rules.taxYear !== value.taxYear) throw new Error('גרסת הכללים אינה שייכת לשנת המס');
  }
  for (const field of [
    'revenue',
    'expensesMonthly',
    'inputVatMonthly',
    'pensionActual',
    'pensionDeduction',
    'pensionCredit',
    'rentMonthly',
    'rentExpenses',
    'arnonaAnnual',
    'rentPaidMonthly',
    'arnonaRentReceivedMonthly',
    'householdOtherMonthly',
    'otherResidentsMonthly',
    'arnonaBusinessAnnual',
  ]) {
    if (
      value[field] === null &&
      ['revenue', 'pensionActual', 'arnonaAnnual', 'arnonaBusinessAnnual', 'arnonaRentReceivedMonthly'].includes(field)
    )
      continue;
    if (!integer(value[field])) throw new Error('סכום אינו תקין: ' + field);
  }
  if (
    !['annual', 'monthly'].includes(value.revenuePeriod) ||
    !['deduction', 'credit', 'manual'].includes(value.pensionMethod) ||
    !['other-ordinary', 'residential-exemption', 'residential-flat', 'residential-auto', 'excluded'].includes(value.rentMode) ||
    ![
      'vatIncluded',
      'vatExempt',
      'activeSelfEmployed',
      'pensionRequired',
      'extraPensionCredit',
      'over60',
    ].every((key) => typeof value[key] === 'boolean') ||
    !(value.approvedDiscount === null || integer(value.approvedDiscount, 0, 10000))
  )
    throw new Error('אפשרויות השנה אינן תקינות');
  return clone(value);
}
export function assertDocument(name, value) {
  if (name === 'profile') return assertProfile(value);
  if (/^year\/\d{4}$/.test(name) && Number(name.slice(5)) === value?.taxYear)
    return assertAnnual(value);
  if (
    /^rules\/\d{4}\/[a-zA-Z0-9._-]{1,100}$/.test(name) &&
    Number(name.split('/')[1]) === value?.taxYear &&
    name.split('/')[2] === value?.version
  )
    return assertRules(value);
  throw new Error('מסמך מחשבון אינו תקין');
}
