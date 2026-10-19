import {clone,GROUPS} from './contracts.js';

export const RULE_LABELS={vat:'מע״מ',insurance:'ביטוח לאומי ובריאות',pension:'פנסיה',credits:'נקודות זיכוי',incomeTax:'מדרגות מס ויסף',rent:'שכירות',arnonaIncome:'מבחן הכנסה לארנונה',children:'נקודות ילדים',arnonaRates:'תעריפי ארנונה'};
const taxSource='https://www.gov.il/BlobFolder/generalpage/income-tax-monthly-deductions-booklet/he/generalInformation_income-tax-monthly-deductions-booklet_monthly-deductions-booklet-2026.pdf';
const municipalSource='https://www.bnei-brak.muni.il/הנחיות-להגשת-בקשת-הנחה-בארנונה-לשנת-2026/';
const shekels=n=>Math.round(n*100);
function group(values,source,notes='') { return {year:2026,status:'draft',checkedAt:null,checkedBy:null,validFrom:'2026-01-01',validTo:'2026-12-31',source,notes,values}; }
const seed={kind:'rules',schema:1,taxYear:2026,version:'2026.1',jurisdiction:'בני ברק',groups:{
  vat:group({rate:1800},'https://www.gov.il/BlobFolder/dynamiccollectorresultitem/represent-info-051224-2/he/vat_represent-info-051224-2.pdf'),
  insurance:group({minimumMonthly:344200,reducedMonthly:770300,maximumMonthly:5191000,nationalLow:447,nationalHigh:1283,healthLow:323,healthHigh:517,deductible:5200},'https://www.btl.gov.il/Insurance/National%20Insurance/type_list/Self_Employed/Pages/rates.aspx','מעמד עצמאי בגיל עבודה. בסיס מזערי חל גם בהפסד כל עוד המעמד פעיל; מעמד אחר מחייב התאמה.'),
  pension:group({averageMonthly:1376900,qualifyingAnnual:16440000,beneficiaryAnnual:23280000,beneficiaryMinimum:2643600,mandatoryLow:445,mandatoryHigh:1255,deduction:1100,creditBase:500,extraCreditBase:50,creditRate:3500},taxSource,'הקצאה אוטומטית בסיסית ללא הכנסה מבוטחת. זכאות עמית מוטב/הכנסה כשכיר דורשות בדיקה; ניתן להזין ניכוי וזיכוי מהשומה.'),
  credits:group({pointAnnual:290400},taxSource),
  incomeTax:group({brackets:[{ceiling:8412000,rate:1000},{ceiling:12072000,rate:1400},{ceiling:22800000,rate:2000},{ceiling:30120000,rate:3100},{ceiling:56028000,rate:3500},{ceiling:null,rate:4700}],surtaxThreshold:72156000,surtaxRate:300,capitalThreshold:72156000,capitalRate:200},taxSource,'מדרגות 2026 לאחר ריווח; מס יסף מחושב לאחר זיכויים.'),
  rent:group({exemptionMonthly:565400,flatRate:1000},taxSource,'מסלול רגיל להכנסה שאינה זכאית לפטור/10%; מתחת לגיל 60 שיעור התחלתי 31%. אין כאן חישוב מסלול שוכר-משכיר לפי סעיף 122(ו).'),
  arnonaIncome:group({thresholds:[[3513,4295,5076,5857],[5621,6872,8122,9372],[7449,9106,10762,12417],[8996,10996,12995,14994],[10541,12886,15229,17572],[11948,14604,17259,19914],[13352,16322,19290,22257],[14618,17868,21117,24366],[15743,19243,22742,26240]].map(row=>row.map(shekels)),extraPerson:[1125,1374,1624,1874].map(shekels)},municipalSource,'שיעורים מרביים; נדרשת שומת הכנסה מתאימה והחלטת הרשות. התאמות הכנסות ילדים/קצבאות יוזנו לפי מסמכי הרשות.'),
  children:group({points:Array.from({length:19},(_,age)=>age===0?[2.5,2.5]:age<=2?[4.5,4.5]:age===3?[3.5,3.5]:age<=5?[2.5,2.5]:age<=17?[2,1]:[0.5,0])},'https://www.gov.il/he/service/tax-credit','גיל בתום שנת המס. דחיית נקודה בשנת לידה ומקרי משמורת מיוחדים באמצעות נקודות נוספות לאחר בדיקה.'),
  arnonaRates:group({rates:[[68.87,62.43],[75.4,70.06],[106.09,103.34],[76.73,70.06],[40.95,40.95]].map(row=>row.map(shekels))},'https://www.bnei-brak.muni.il/תושבים/ארנונה/arnonh-tarif/','מידע להשוואה בלבד; החיוב המחושב נקבע לפי החשבון השנתי שהוזן, ללא ניחוש שטח וסיווג.')
}};
export function defaultRules(taxYear=2026) { const value=clone(seed);value.taxYear=taxYear;value.version=taxYear===2026?'2026.1':`${taxYear}.historical-2026`;return value; }
export function ruleWarnings(rules,taxYear) {
  return GROUPS.filter(key=>{const g=rules.groups[key];return g.status!=='reviewed'||g.year!==taxYear||g.validFrom>`${taxYear}-01-01`||g.validTo<`${taxYear}-12-31`}).map(key=>`${RULE_LABELS[key]}: הכללים לשנת ${taxYear} טרם נבדקו לכל התקופה`);
}
