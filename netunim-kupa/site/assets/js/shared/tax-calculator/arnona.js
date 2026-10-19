import { rate, ratio } from './contracts.js';

const DISCOUNTS = [9000, 7000, 5000, 3000];

/** Resolve amounts and their provenance before testing bands. Never turn a forecast into a tax assessment. */
export function calculateArnona(input, rules, businessProfit, people) {
  const businessAutomatic = input.arnonaBusinessAnnual === null;
  const rentalAutomatic = input.arnonaRentReceivedMonthly === null;
  const businessAnnual = businessAutomatic
    ? input.revenue === null ? null : Math.max(0, businessProfit)
    : input.arnonaBusinessAnnual;
  const receivedRent = rentalAutomatic ? input.rentMonthly : input.arnonaRentReceivedMonthly;
  const rentalMonthly = Math.max(0, receivedRent - input.rentPaidMonthly);
  const requiredAssessmentYear = input.taxYear === 2026 && rules.jurisdiction === 'בני ברק'
    ? 2025 : null;
  const periodMatches = requiredAssessmentYear !== null && input.assessmentYear === requiredAssessmentYear;
  const incomeComplete = businessAnnual !== null;
  const assessmentComplete = incomeComplete && periodMatches && !businessAutomatic && !rentalAutomatic;
  const basis = !incomeComplete ? 'incomplete' : assessmentComplete ? 'assessment' : 'forecast';
  const reasons = [];
  if (input.assessmentYear === null)
    reasons.push({ field: 'assessmentYear', text: 'לא נבחרה שנת הכנסה לשומה; מוצגת תחזית מהסכומים הידועים.' });
  else if (!periodMatches)
    reasons.push({ field: 'assessmentYear', text: requiredAssessmentYear === null
      ? 'תקופת ההכנסה הנדרשת אינה מוגדרת בכללים אלה; מוצגת תחזית בלבד.'
      : `הוזנו הכנסות ${input.assessmentYear}; מבחן ${input.taxYear} מתייחס להכנסות ${requiredAssessmentYear}. ההשוואה היא תחזית בלבד.` });
  if (businessAutomatic)
    reasons.push({ field: 'arnonaBusinessAnnual', text: businessAnnual === null
      ? 'חסר מחזור עסקי לחישוב אוטומטי; יש להזין מחזור או סכום עסק ידני מהשומה.'
      : `בסיס העסק מחושב אוטומטית מהרווח לפני ניכויים בשנת ${input.taxYear}, ולכן זהו אומדן.` });
  if (rentalAutomatic)
    reasons.push({ field: 'arnonaRentReceivedMonthly', text: `תקבולי השכירות נלקחים אוטומטית משנת ${input.taxYear}; לשומה יש להזין סכום מפורש, גם אפס.` });
  const assessedAnnualIncome = incomeComplete
    ? businessAnnual + 12 * (rentalMonthly + input.householdOtherMonthly + input.otherResidentsMonthly)
    : null;
  const assessedIncome = assessedAnnualIncome === null ? null : ratio(assessedAnnualIncome, 1, 12);
  const limits = rules.groups.arnonaIncome.values;
  const thresholds = limits.thresholds[Math.min(people, 9) - 1].map(
    (amount, index) => amount + Math.max(0, people - 9) * limits.extraPerson[index],
  );
  const jurisdictionMatches = input.profile.city.trim() === rules.jurisdiction.trim();
  const band = assessedIncome === null ? -1 : thresholds.findIndex(amount => assessedIncome <= amount);
  const estimatedDiscount = incomeComplete && jurisdictionMatches ? band < 0 ? 0 : DISCOUNTS[band] : null;
  const discount = input.approvedDiscount ?? 0;
  const annualPayment = rate(input.arnonaAnnual ?? 0, 10000 - discount);
  const estimatedAnnualPayment = estimatedDiscount === null || input.arnonaAnnual === null
    ? null : rate(input.arnonaAnnual, 10000 - estimatedDiscount);
  const warnings = reasons.map(reason => reason.text);
  if (!jurisdictionMatches) warnings.push('טבלת הנחות הארנונה אינה תואמת ליישוב; אין אומדן הנחה מקומי.');
  if (estimatedDiscount !== null && input.approvedDiscount === null)
    warnings.push('ההנחה והתשלום לאחריה מוצגים כתחזית; החיוב שבנטו משתמש רק בהנחה מאושרת שהוזנה.');
  if (discount > 0)
    warnings.push('השיעור המאושר חייב להיות אפקטיבי על כל החשבון, לאחר מגבלות שטח וסיווג.');
  return {
    annualPayment,
    warnings,
    detail: {
      basis, reasons, requiredAssessmentYear, periodMatches, incomeComplete, assessmentComplete,
      businessAutomatic, rentalAutomatic, businessAnnual,
      businessMonthly: businessAnnual === null ? null : ratio(businessAnnual, 1, 12),
      rentalMonthly, rentalReceivedMonthly: receivedRent, householdOtherMonthly: input.householdOtherMonthly,
      otherResidentsMonthly: input.otherResidentsMonthly,
      assessedIncome, assessedAnnualIncome, jurisdictionMatches, thresholds,
      estimatedDiscount, discount, approved: input.approvedDiscount !== null,
      assessmentYear: input.assessmentYear, automaticIncomeYear: input.taxYear,
      estimatedAnnualPayment,
      estimatedMonthlyPayment: estimatedAnnualPayment === null ? null : ratio(estimatedAnnualPayment, 1, 12),
      discountBands: thresholds.map((maximum, index) => ({
        maximum, percent: DISCOUNTS[index], matches: estimatedDiscount !== null && index === band,
        hypotheticalAnnualPayment: input.arnonaAnnual === null ? null : rate(input.arnonaAnnual, 10000 - DISCOUNTS[index]),
      })),
    },
  };
}
