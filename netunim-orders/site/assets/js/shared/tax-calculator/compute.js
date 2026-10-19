import { assertAnnual, assertRules, ENGINE_VERSION, rate, ratio, fraction } from './contracts.js';
import { ruleWarnings } from './rules.js';
import { calculateArnona } from './arnona.js';

const positive = (n) => Math.max(0, n);
export function progressiveTax(income, brackets) {
  let previous = 0,
    total = 0;
  const steps = [];
  for (const band of brackets) {
    const base = positive(Math.min(income, band.ceiling ?? income) - previous),
      tax = rate(base, band.rate);
    total += tax;
    steps.push({ from: previous, to: band.ceiling, rate: band.rate, base, tax });
    previous = band.ceiling ?? income;
  }
  return { total, steps };
}
export function ageOn(birth, date) {
  if (birth > date) return -1;
  return (
    Number(date.slice(0, 4)) - Number(birth.slice(0, 4)) - (date.slice(5) < birth.slice(5) ? 1 : 0)
  );
}
export function calculateTax(input, rules = input.rules) {
  const i = assertAnnual(input),
    r = assertRules(rules),
    g = r.groups,
    warnings = ruleWarnings(r, i.taxYear),
    missing = [];
  if (i.revenue === null) missing.push('מחזור עסקי');
  if (i.arnonaAnnual === null) missing.push('חיוב ארנונה שנתי');
  const annualRevenue = (i.revenue ?? 0) * (i.revenuePeriod === 'monthly' ? 12 : 1);
  const revenue =
    i.vatIncluded && !i.vatExempt
      ? ratio(annualRevenue, 10000, 10000 + g.vat.values.rate)
      : annualRevenue;
  const outputVat = i.vatExempt ? 0 : rate(revenue, g.vat.values.rate),
    inputVat = i.vatExempt ? 0 : i.inputVatMonthly * 12;
  if (i.vatExempt && i.inputVatMonthly)
    warnings.push('בעוסק פטור לא חושב קיזוז מע״מ תשומות; יש לכלול הוצאה מוכרת לפי הכללים');
  const expenses = i.expensesMonthly * 12,
    profit = revenue - expenses,
    p = g.pension.values;
  const halfAverage = p.averageMonthly * 6,
    average = p.averageMonthly * 12;
  const pensionMinimum = i.pensionRequired
    ? rate(Math.min(positive(profit), halfAverage), p.mandatoryLow) +
      rate(positive(Math.min(profit, average) - halfAverage), p.mandatoryHigh)
    : 0;
  const pension = i.pensionActual === null ? pensionMinimum : i.pensionActual;
  if (i.pensionActual === null)
    warnings.push('הפקדת הפנסיה היא תחזית לפי מינימום חובה; טרם הוזנה הפקדה בפועל');
  if (i.pensionMethod !== 'manual')
    warnings.push('הטבת הפנסיה היא אומדן בסיסי; זכאות עמית מוטב/הכנסה מבוטחת אינה נקבעת אוטומטית');
  if (pension < pensionMinimum) warnings.push('ההפקדה בפועל נמוכה ממינימום הפנסיה המחושב');
  const qualifying = Math.min(positive(profit), p.qualifyingAnnual),
    creditCap = rate(qualifying, p.creditBase + (i.extraPensionCredit ? p.extraCreditBase : 0));
  const creditFirst = i.pensionMethod === 'credit',
    deductionAuto = Math.min(
      positive(pension - (creditFirst ? Math.min(pension, creditCap) : 0)),
      rate(qualifying, p.deduction),
    );
  const deduction = i.pensionMethod === 'manual' ? i.pensionDeduction : deductionAuto;
  const pensionCredit =
    i.pensionMethod === 'manual'
      ? i.pensionCredit
      : rate(Math.min(positive(pension - (creditFirst ? 0 : deduction)), creditCap), p.creditRate);
  if (
    i.pensionMethod === 'manual' &&
    (deduction > pension || pensionCredit > rate(positive(pension - deduction), p.creditRate))
  )
    warnings.push('ניכוי/זיכוי פנסיה ידני חורג מההפקדה; יש לבדוק מול אישור המס');
  const n = g.insurance.values,
    beforeInsurance = positive(profit - deduction),
    low = n.reducedMonthly * 12,
    max = n.maximumMonthly * 12;
  // Solve B + 52% * NI(B) = income with integer rational arithmetic.
  const adjusted =
    beforeInsurance <= low + rate(rate(low, n.nationalLow), n.deductible)
      ? ratio(beforeInsurance, 100000000, 100000000 + n.deductible * n.nationalLow)
      : fraction(
          BigInt(beforeInsurance) * 100000000n +
            BigInt(low) * BigInt(n.deductible) * BigInt(n.nationalHigh - n.nationalLow),
          BigInt(100000000 + n.deductible * n.nationalHigh),
        );
  const insuranceBase = i.activeSelfEmployed
    ? Math.min(max, Math.max(adjusted, n.minimumMonthly * 12))
    : 0;
  const national =
    rate(Math.min(insuranceBase, low), n.nationalLow) +
    rate(positive(insuranceBase - low), n.nationalHigh);
  const health =
    rate(Math.min(insuranceBase, low), n.healthLow) +
    rate(positive(insuranceBase - low), n.healthHigh);
  if (i.activeSelfEmployed && adjusted < n.minimumMonthly * 12)
    warnings.push('ביטוח לאומי ובריאות כוללים בסיס מזערי לעצמאי פעיל, גם בהכנסה אפסית או הפסד');
  const insuranceDeduction = rate(national, n.deductible),
    taxable = positive(profit - deduction - insuranceDeduction);
  const children = i.profile.children.map((child) => {
    const taxAge = i.taxYear - Number(child.birthDate.slice(0, 4)),
      age = ageOn(child.birthDate, i.ageDate),
      points =
        taxAge >= 0 && taxAge <= 18
          ? g.children.values.points[taxAge][i.profile.creditTrack === 'recipient' ? 0 : 1]
          : 0;
    return { ...child, taxAge, age, points };
  });
  const childPoints = children.reduce((s, c) => s + c.points, 0),
    points = i.profile.basePoints + i.profile.extraPoints + childPoints;
  const pointCredit = ratio(g.credits.values.pointAnnual, Math.round(points * 100), 100),
    credits = pointCredit + pensionCredit,
    t = g.incomeTax.values;
  const businessTax = progressiveTax(taxable, t.brackets),
    baseTax =
      positive(businessTax.total - credits) +
      rate(positive(taxable - t.surtaxThreshold), t.surtaxRate);
  const rentEligible = i.rentMode !== 'other-ordinary';
  const requestedRentRoute = { 'other-ordinary': 'ordinary', 'residential-exemption': 'ordinary', 'residential-flat': 'flat', 'residential-auto': 'auto', excluded: 'none' }[i.rentMode];
  const rent = i.rentMonthly * 12,
    exemption = rentEligible
      ? positive(Math.min(i.rentMonthly, g.rent.values.exemptionMonthly * 2 - i.rentMonthly)) * 12
      : 0;
  const rentBeforeExpenses = positive(rent - exemption),
    rentAllowedExpenses = rent
      ? Math.min(rentBeforeExpenses, ratio(i.rentExpenses, rentBeforeExpenses, rent))
      : 0,
    rentTaxable = positive(rentBeforeExpenses - rentAllowedExpenses);
  const passiveBands = t.brackets.map((b) => ({ ...b, rate: Math.max(b.rate, 3100) }));
  const combinedTax = i.over60
    ? progressiveTax(taxable + rentTaxable, t.brackets).total
    : businessTax.total +
      progressiveTax(taxable + rentTaxable, passiveBands).total -
      progressiveTax(taxable, passiveBands).total;
  const ordinary =
    positive(combinedTax - credits) +
    rate(positive(taxable + rentTaxable - t.surtaxThreshold), t.surtaxRate) +
    rate(positive(rentTaxable - t.capitalThreshold), t.capitalRate);
  const flat =
    positive(businessTax.total - credits) +
    rate(rent, g.rent.values.flatRate) +
    rate(positive(taxable + rent - t.surtaxThreshold), t.surtaxRate) +
    rate(positive(rent - t.capitalThreshold), t.capitalRate);
  let route = !rent
    ? 'none'
    : !rentEligible
      ? 'ordinary'
      : requestedRentRoute === 'auto'
        ? ordinary <= flat
          ? 'ordinary'
          : 'flat'
        : requestedRentRoute;
  if (rent && !rentEligible)
    warnings.push(
      'השכירות אינה זכאית למסלולים המיוחדים; חושב מס רגיל ללא פטור, במקום השמטת ההכנסה שבאקסל',
    );
  if (rent && route === 'none') {
    warnings.push('הכנסת שכירות קיימת אך הוחרגה מהמס לפי הבחירה; הנטו אינו חישוב מלא');
    missing.push('מסלול מס לשכירות');
  }
  const incomeTax = route === 'ordinary' ? ordinary : route === 'flat' ? flat : baseTax,
    rentTax = positive(incomeTax - baseTax);
  const people = i.profile.adults + children.filter((c) => c.resident && c.age >= 0).length;
  const arnonaCalculation = calculateArnona(i, r, profit, people);
  warnings.push(...arnonaCalculation.warnings);
  const arnona = arnonaCalculation.annualPayment;
  const net = profit + rent - i.rentExpenses - national - health - pension - incomeTax - arnona;
  const annual = {
    revenue,
    expenses,
    profit,
    outputVat,
    inputVat,
    netVat: outputVat - inputVat,
    national,
    health,
    insurance: national + health,
    pensionMinimum,
    pension,
    pensionDeduction: deduction,
    pensionCredit,
    insuranceDeduction,
    taxable,
    pointCredit,
    incomeTax,
    businessTax: baseTax,
    rentTax,
    rent,
    rentTaxable,
    arnona,
    net,
  };
  return {
    engineVersion: ENGINE_VERSION,
    rulesVersion: r.version,
    taxYear: i.taxYear,
    complete: missing.length === 0,
    missing,
    warnings,
    annual,
    monthly: Object.fromEntries(Object.entries(annual).map(([k, v]) => [k, ratio(v, 1, 12)])),
    family: { children, childPoints, points, people },
    arnona: arnonaCalculation.detail,
    rental: {
      route,
      exemption,
      rentAllowedExpenses,
      comparisons: [
        { route: 'ordinary', tax: ordinary, valid: true },
        { route: 'flat', tax: flat, valid: rentEligible },
      ],
    },
    trace: [
      { label: 'מחזור ללא מע״מ פחות הוצאות מוכרות', value: profit },
      { label: 'הפקדה לפנסיה (ריק = מינימום; אפס = לא הופקד)', value: pension },
      { label: 'בסיס ביטוח לאחר התאמת ניכוי 52% ולאחר מינימום/תקרה', value: insuranceBase },
      { label: 'רווח פחות ניכוי פנסיה ופחות 52% ביטוח לאומי', value: taxable },
      { label: 'נקודות זיכוי × שווי נקודה + זיכוי פנסיה', value: credits },
      { label: 'מס הכנסה כולל המסלול שנבחר ויסף', value: incomeTax },
      { label: 'ארנונה לפי החשבון, לאחר הנחה אפקטיבית שהוזנה ואושרה בלבד', value: arnona },
      { label: 'רווח + שכירות פחות הוצאות שכירות, ביטוח, פנסיה, מס וארנונה', value: net },
    ],
    taxSteps: businessTax.steps,
  };
}
