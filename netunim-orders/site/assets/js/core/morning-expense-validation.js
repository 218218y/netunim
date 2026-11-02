import {validReportDate, validateExpenseReporting, expenseBimonth} from './morning-report-period.js';
import {allocationPolicy} from './invoice-allocation.js';

const uuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
// Add calendar months, clamping the day at month end (six months is not 180 days).
export function expenseInputTaxDeadline(date) {
  if (!validReportDate(date)) return '';
  const [year, month, day] = date.split('-').map(Number);
  const end = new Date(Date.UTC(year, month + 6, 0));
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(day, end.getUTCDate()))).toISOString().slice(0, 10);
}
export function expenseInputIssues(input, today, {allowP = false, cents} = {}) {
  const issues = [], add = (fields, code, message) => issues.push({fields, code, message});
  if (!input) return [{fields:[], code:'invalid_expense_input', message:'יש להשלים את פרטי ההוצאה.'}];
  for (const [key, label] of [['supplierId','ספק'], ['classificationExpenseId','סיווג']]) {
    if (!uuid(input[key])) add([key], 'invalid_expense_input', `יש לבחור ${label} מתוך הרשימה.`);
  }
  if (![305,330,320].includes(input.documentType)) add(['documentType'], 'invalid_expense_input', 'יש לבחור סוג מסמך.');
  if (typeof input.number !== 'string' || !input.number.trim() || input.number.length > 20 || /[\u0000-\u001f\u007f]/.test(input.number)) add(['number'], 'invalid_expense_input', 'יש להזין מספר חשבונית תקין, עד 20 תווים.');
  if (!validReportDate(input.date) || input.date < '2010-01-01' || input.date > today) add(['date'], 'invalid_expense_input', 'יש להזין תאריך חשבונית מלא ותקין שאינו בעתיד.');
  else {
    try {validateExpenseReporting(input, today);}
    catch {add(['date','reportingPeriod'], 'invalid_expense_reporting_period', 'תקופת הדיווח אינה תקינה או קודמת לחשבונית. יש לבחור תקופה הכוללת את תאריך החשבונית או מאוחרת ממנו.');}
  }
  const net = cents(input.net), vat = cents(input.vat), gross = cents(input.gross);
  for (const [key, value, label] of [['net',net,'סכום לפני מע״מ'], ['vat',vat,'מע״מ'], ['gross',gross,'סכום כולל']]) {
    if (value === null || key === 'gross' && value <= 0) add([key], 'invalid_expense_amounts', `יש להזין ${label} תקין, בשקלים ועד שתי ספרות אחרי הנקודה.`);
  }
  if (net !== null && vat !== null && gross !== null && net + vat !== gross) add(['net','vat','gross'], 'invalid_expense_amounts', 'לפני מע״מ ומע״מ חייבים להסתכם לסכום הכולל, בדיוק של אגורות.');
  const p = input.pcnClassification === 'P';
  if (input.pcnClassification !== 'T' && !(p && allowP)) add(['pcnClassification'], 'morning_expense_p_unverified', 'דיווח P דורש ספק P מאומת וקליטה פעילה בחשבון.');
  if (p && (typeof input.number !== 'string' || !/^\d{1,9}$/.test(input.number.trim()) || /^0+$/.test(input.number.trim()))) add(['number'], 'invalid_expense_p_number', 'מספר חשבונית P חייב להכיל 1–9 ספרות בלבד ואינו יכול להיות אפס.');
  if (typeof input.description !== 'string' || input.description.length > 250) add(['description'], 'invalid_expense_input', 'התיאור מוגבל ל־250 תווים.');
  if (typeof (input.allocationNumber ?? '') !== 'string' || !/^(?:\d{9})?$/.test(input.allocationNumber ?? '')) add(['allocationNumber'], 'invalid_expense_input', 'מספר הקצאה חייב להכיל תשע ספרות, או להישאר ריק כשאינו נדרש.');
  else if (/^0{9}$/.test(input.allocationNumber || '') || !input.allocationNumber && net !== null && vat !== null && allocationPolicy({date:input.date,documentType:input.documentType,netCents:net,vatCents:vat,pcnClassification:input.pcnClassification}).status === 'check_business_conditions') add(['allocationNumber'], 'expense_allocation_required', 'יש להשלים מספר הקצאה תקין ממסמך המקור.');
  if (vat > 0 && [305,320].includes(input.documentType) && validReportDate(input.date)) {
    const deadline = expenseInputTaxDeadline(input.date);
    if (today > deadline) add(['date'], 'invalid_expense_input_tax_expired', `חלפו שישה חודשים מתאריך החשבונית (המועד הרגיל לניכוי: ${deadline}). ניכוי מע״מ באתר חסום; יש להסדיר הארכה או טיפול מתאים עם המייצג ומשרד מע״מ. רישום הוצאה לצורכי מס הכנסה הוא עניין נפרד.`);
    if (p && validReportDate(input.reportingDate) && expenseBimonth(input.date).key !== expenseBimonth(input.reportingDate).key) add(['date','reportingPeriod'], 'invalid_expense_p_reporting_period', 'חשבונית P דורשת דיווח בתקופת החשבונית. אין להעבירה לתקופה מאוחרת ללא בירור עם המייצג.');
  }
  return issues;
}
