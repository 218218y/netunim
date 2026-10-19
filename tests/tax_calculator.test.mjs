import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnnual,createProfile,assertAnnual,assertRules,toMinor,ratio,currentTaxYear,same} from '../shared/tax-calculator/contracts.js';
import {defaultRules,ruleWarnings} from '../shared/tax-calculator/rules.js';
import {calculateTax,progressiveTax,ageOn} from '../shared/tax-calculator/compute.js';
import {normalizeDate,inputMarkup,summaryMarkup} from '../shared/tax-calculator/view.js';

const rules=defaultRules();
function input(patch={}){const p=createProfile();p.basePoints=0;return {...createAnnual(2026,p,rules),revenue:0,arnonaAnnual:0,activeSelfEmployed:false,pensionRequired:false,pensionActual:0,...patch};}
test('official 2026 progressive table has independently calculated boundary taxes',()=>{
  const cases=[[0,0],[8412000,841200],[12072000,1353600],[22800000,3499200],[25000000,4181200],[30120000,5768400],[56028000,14836200],[60000000,16703040]];
  for(const [base,tax] of cases)assert.equal(progressiveTax(base,rules.groups.incomeTax.values.brackets).total,tax);
  for(const b of rules.groups.incomeTax.values.brackets.filter(b=>b.ceiling!==null))assert.ok(progressiveTax(b.ceiling+100,rules.groups.incomeTax.values.brackets).total>progressiveTax(b.ceiling-100,rules.groups.incomeTax.values.brackets).total);
});
test('monthly/annual and VAT-inclusive/exclusive entries yield identical annual profit',()=>{
  const annual=calculateTax(input({revenue:18000000}));
  assert.deepEqual(annual.annual,calculateTax(input({revenue:1500000,revenuePeriod:'monthly'})).annual);
  assert.deepEqual(annual.annual,calculateTax(input({revenue:21240000,vatIncluded:true})).annual);
  assert.equal(annual.annual.outputVat,3240000);
  const refund=calculateTax(input({inputVatMonthly:10000}));assert.equal(refund.annual.netVat,-120000);
});
test('money uses integer agorot with explicit half-away-from-zero rounding',()=>{
  assert.equal(toMinor('12.34'),1234);assert.equal(toMinor('0.29'),29);assert.equal(ratio(-1,1,2),-1);
  for(const bad of ['NaN','Infinity','1.234','1e4',''])assert.throws(()=>toMinor(bad));
  assert.ok(same({a:1,b:2},{b:2,a:1}));
});
test('active zero and losses retain minimum NI; inactive status is explicit',()=>{
  const zero=calculateTax(input({activeSelfEmployed:true}));assert.equal(zero.annual.national,184629);assert.equal(zero.annual.health,133412);
  const loss=calculateTax(input({activeSelfEmployed:true,expensesMonthly:100000}));assert.equal(loss.annual.insurance,zero.annual.insurance);assert.equal(loss.annual.incomeTax,0);assert.ok(loss.annual.net<0);
  assert.equal(calculateTax(input()).annual.insurance,0);
});
test('NI solution agrees with an independently rearranged insurance equation',()=>{
  for(const amount of [5000000,9000000,10000000,25000000,100000000]){
    const result=calculateTax(input({revenue:amount,activeSelfEmployed:true}));
    if(amount<60000000)assert.ok(Math.abs(result.annual.taxable-(amount-result.annual.insuranceDeduction))<=1);
    if(amount===5000000){const independent=Math.round(amount/(1+0.52*0.0447));assert.ok(Math.abs(result.annual.national-Math.round(independent*0.0447))<=1);}
  }
});
test('pension zero is distinct from unknown; manual credit and priority are preserved',()=>{
  const zero=calculateTax(input({revenue:18000000,pensionRequired:true,pensionActual:0}));
  const unknown=calculateTax(input({revenue:18000000,pensionRequired:true,pensionActual:null}));assert.equal(zero.annual.pension,0);assert.ok(unknown.annual.pension>0);
  const deduction=calculateTax(input({revenue:18000000,pensionActual:2000000,pensionMethod:'deduction'})),credit=calculateTax(input({revenue:18000000,pensionActual:2000000,pensionMethod:'credit'}));assert.ok(credit.annual.pensionCredit>deduction.annual.pensionCredit);
  const manual=calculateTax(input({revenue:18000000,pensionMethod:'manual',pensionDeduction:100000,pensionCredit:50000}));assert.equal(manual.annual.pensionDeduction,100000);assert.equal(manual.annual.pensionCredit,50000);
});
test('ineligible rental income is taxed under ordinary rules rather than disappearing',()=>{
  const ordinary=calculateTax(input({rentMonthly:1000000,rentMode:'other-ordinary'}));assert.equal(ordinary.rental.route,'ordinary');assert.equal(ordinary.annual.rentTax,3720000);
  const eligible=calculateTax(input({rentMonthly:1000000,rentMode:'residential-auto'}));assert.equal(eligible.rental.route,'flat');assert.equal(eligible.annual.rentTax,1200000);
  const exempt=calculateTax(input({rentMonthly:565400,rentMode:'residential-auto'}));assert.equal(exempt.annual.rentTax,0);
  const older=calculateTax(input({rentMonthly:1000000,rentMode:'other-ordinary',over60:true}));assert.equal(older.annual.incomeTax,1343520);
  const excluded=calculateTax(input({rentMonthly:1000000,rentMode:'excluded'}));assert.equal(excluded.complete,false);
});
test('age, child points and household size use independent dates with no eight-child limit',()=>{
  const p=createProfile();p.adults=2;p.children=Array.from({length:12},(_,i)=>({id:String(i),birthDate:`${2008+i}-12-31`,resident:true}));
  const result=calculateTax(input({profile:p,ageDate:'2026-01-01'}));assert.equal(result.family.people,14);assert.equal(result.family.children[0].taxAge,18);assert.equal(result.family.children[0].age,17);assert.equal(result.family.children[0].points,0);
  p.creditTrack='recipient';assert.equal(calculateTax(input({profile:p})).family.children[0].points,0.5);
  assert.equal(ageOn('2020-12-31','2026-12-30'),5);assert.equal(ageOn('2020-12-31','2026-12-31'),6);
});
test('arnona bands, extra residents, rent offset and explicit zero approval',()=>{
  const p=createProfile();p.city='בני ברק';p.adults=12;
  const result=calculateTax(input({profile:p,revenue:12000000,assessmentYear:2025,arnonaBusinessAnnual:12000000,arnonaRentReceivedMonthly:400000,rentMonthly:800000,rentPaidMonthly:500000,approvedDiscount:0,arnonaAnnual:600000}));
  assert.equal(result.arnona.assessedIncome,1000000);assert.equal(result.arnona.thresholds[0],1911800);assert.equal(result.annual.arnona,600000);assert.equal(result.arnona.approved,true);
  p.city='ירושלים';const other=calculateTax(input({profile:p,arnonaAnnual:600000}));assert.equal(other.arnona.estimatedDiscount,null);assert.equal(other.annual.arnona,600000);
});
test('new year preserves profile and no income; snapshots do not drift',()=>{
  const old=input({revenue:10000000});const next=createAnnual(2027,old.profile,defaultRules(2027));assert.equal(next.revenue,null);assert.equal(next.rentMonthly,0);assert.equal(ruleWarnings(next.rules,2027).length,9);
  next.profile.adults=4;next.rules.groups.vat.values.rate=2000;assert.equal(old.profile.adults,1);assert.equal(old.rules.groups.vat.values.rate,1800);
  assert.equal(currentTaxYear(new Date('2026-12-31T22:30:00Z')),2027);
});
test('invalid rules, dates, amounts and enums fail closed',()=>{
  const bad=structuredClone(rules);bad.groups.incomeTax.values.brackets[1].ceiling=0;assert.throws(()=>assertRules(bad));
  assert.throws(()=>assertAnnual(input({revenue:NaN})));assert.throws(()=>assertAnnual(input({approvedDiscount:10001})));assert.throws(()=>assertAnnual(input({ageDate:'2026-02-31'})));
  assert.equal(calculateTax(createAnnual(2026,undefined,rules)).complete,false);
});
test('date typing supports explicit birth century and rejects incomplete or invalid dates',()=>{
  assert.equal(normalizeDate('31/12/1998'),'1998-12-31');assert.equal(normalizeDate('1/2/2020'),'2020-02-01');assert.equal(normalizeDate('2026-01-01'),'2026-01-01');assert.equal(normalizeDate('31/2/2026'),null);assert.equal(normalizeDate('1/2/20'),null);
});

test('arnona 2026 uses assessed 2025 business and residential rent, never current-year figures',()=>{
  const p=createProfile();p.adults=2;
  const i=input({profile:p,revenue:15000000,assessmentYear:2025,arnonaBusinessAnnual:3600000,arnonaRentReceivedMonthly:500000,rentMonthly:565400,rentMode:'residential-auto',arnonaAnnual:1200000});
  const c=calculateTax(i);
  assert.equal(c.annual.rentTax,0,'residential rent within 2026 exemption stays tax exempt');
  assert.equal(c.arnona.businessMonthly,300000);
  assert.equal(c.arnona.rentalMonthly,500000,'2025 gross rent counts even though 2026 rent is tax-exempt');
  assert.equal(c.arnona.assessedIncome,800000);
  assert.equal(c.arnona.estimatedDiscount,5000,'2026 band from verified Bnei Brak table');
  assert.equal(c.arnona.discount,0,'estimated qualification is not an approved discount');
  assert.equal(c.annual.arnona,1200000,'no speculative discount against full annual bill');
  assert.equal(c.arnona.approved,false);
  const approved=calculateTax({...i,approvedDiscount:1250});
  assert.equal(approved.annual.arnona,1050000,'input is effective approved rate against whole bill');
});
test('automatic amounts are forecasts and never become assessed 2025 income',()=>{
  const base=input({revenue:60000000,rentMonthly:565400,rentMode:'residential-auto',arnonaAnnual:1200000,assessmentYear:2025});
  for(const update of [{},{arnonaBusinessAnnual:0},{arnonaRentReceivedMonthly:0}]){
    const c=calculateTax({...base,...update});
    assert.equal(c.arnona.basis,'forecast');
    assert.equal(c.arnona.assessmentComplete,false);
    assert.ok(c.arnona.reasons.length>0);
    assert.equal(c.annual.arnona,1200000);
  }
  const c=calculateTax({...base,arnonaBusinessAnnual:0,arnonaRentReceivedMonthly:0});
  assert.equal(c.arnona.assessedIncome,0,'an explicit zero is known income, not a missing value');
  assert.equal(c.arnona.estimatedDiscount,9000);
  assert.equal(c.arnona.discount,0);
  const none=calculateTax({...base,assessmentYear:null,arnonaBusinessAnnual:0,arnonaRentReceivedMonthly:500000});
  assert.equal(none.arnona.assessedIncome,500000);
  assert.equal(none.arnona.basis,'forecast','an unassigned year permits a labeled forecast, never assessment status');
  const wrong=calculateTax({...base,assessmentYear:2026,arnonaBusinessAnnual:0,arnonaRentReceivedMonthly:0});
  assert.equal(wrong.arnona.basis,'forecast');
  assert.equal(wrong.arnona.assessmentComplete,false,'current-year figures are not assessed prior-year income');
  assert.ok(wrong.warnings.some(w=>w.includes('2025')));
  const older=calculateTax({...base,assessmentYear:2024,arnonaBusinessAnnual:20000000,arnonaRentReceivedMonthly:350000,householdOtherMonthly:100000});
  assert.equal(older.arnona.assessedAnnualIncome,25400000,'older assessment arithmetic remains visible for inspection');
  assert.equal(older.arnona.basis,'forecast');
  assert.equal(older.arnona.assessmentComplete,false,'older assessment does not imply 2026 eligibility');
  const sameYear=calculateTax({...base,taxYear:2027,rules:defaultRules(2027),assessmentYear:2027});
  assert.equal(sameYear.arnona.basis,'forecast','matching years alone do not establish an assessment');
});
test('only complete current annual documents are accepted; no legacy normalization',()=>{
  const legacy=input({revenue:10000000,assessmentYear:2025,arnonaBusinessAnnual:0});
  delete legacy.arnonaRentReceivedMonthly;
  assert.throws(()=>assertAnnual(legacy));
  assert.throws(()=>assertAnnual({...input(),schema:1}));
  assert.throws(()=>assertAnnual({...input(),arnonaRentReceivedMonthly:undefined}));
  assert.throws(()=>assertAnnual({...input(),arnonaRentReceivedMonthly:-1}));
  assert.equal(assertAnnual(input()).arnonaRentReceivedMonthly,null);
});
test('2026 statutory rent exemption threshold vs arnona assessed income boundaries',()=>{
  for(const rentShekels of [0,4000,5654]){
    const i=input({rentMonthly:rentShekels*100,rentMode:'residential-auto',assessmentYear:2025,arnonaBusinessAnnual:0,arnonaRentReceivedMonthly:rentShekels*100,arnonaAnnual:100000});
    const c=calculateTax(i);
    assert.equal(c.annual.rentTax,0);
    assert.equal(c.arnona.assessedIncome,rentShekels*100);
  }
  const limitPlus=calculateTax(input({rentMonthly:565500,rentMode:'residential-auto'}));
  assert.ok(limitPlus.annual.rentTax>0);
});

// Synthetic reconciliation of an assessment: no user-specific figures in tests. Entered here
// as assessment-period values to prove the formula, NOT evidence of
// 2025 income or eligibility for a real 2026 discount.
test('assessment income uses gross business figure before section-5 deductions + exempt rent + kollel stipend',()=>{
  const p=createProfile();p.adults=9;
  const annual=20000000, exemptRent=350000, kollel=100000;
  const c=calculateTax(input({profile:p,revenue:80000000,expensesMonthly:100000,
    assessmentYear:2025,arnonaBusinessAnnual:annual,arnonaRentReceivedMonthly:exemptRent,
    householdOtherMonthly:kollel,rentMonthly:exemptRent,rentMode:'residential-exemption',
    arnonaAnnual:1200000}));
  assert.equal(c.annual.rentTax,0,'tax-exempt rental income does not create income tax');
  assert.equal(c.arnona.businessAnnual,20000000,'gross assessed figure, NOT income after personal deductions');
  assert.equal(c.arnona.assessedAnnualIncome,25400000);
  assert.equal(c.arnona.assessedIncome,2116667);
  assert.equal(c.arnona.estimatedDiscount,5000,'9 residents match up-to-50% band');
  assert.equal(c.arnona.discountBands[2].matches,true);
  assert.equal(c.arnona.discountBands[2].hypotheticalAnnualPayment,600000);
  assert.equal(c.arnona.discount,0,'eligibility is not a granted discount');
  assert.equal(c.annual.arnona,1200000);
  assert.ok(c.arnona.assessedAnnualIncome > 18200000 + 4200000 + 1200000);
});

test('rental single-choice control consistently sets eligibility and route',()=>{
  for(const choice of ['other-ordinary','residential-exemption','residential-flat','residential-auto','excluded']){
    const doc=input({rentMonthly:400000,rentMode:choice});
    assert.equal(assertAnnual(doc).rentMode,choice);
    assert.equal(Object.hasOwn(doc,'rentRoute'),false);
    assert.equal(Object.hasOwn(doc,'rentEligible'),false);
  }
  assert.throws(()=>assertAnnual(input({rentMode:'made-up-choice'})));
  assert.throws(()=>assertAnnual({...input(),rentEligible:true,rentRoute:'auto'}));
  const exempt=input({rentMonthly:400000,rentMode:'residential-exemption'});
  assert.equal(calculateTax(exempt).annual.rentTax,0);
  const flat=input({rentMonthly:400000,rentMode:'residential-flat'});
  assert.equal(calculateTax(flat).annual.rentTax,480000);
  assert.match(inputMarkup('rent',exempt,calculateTax(exempt)),/פטור עד התקרה ומס רגיל על היתרה/);
  assert.doesNotMatch(inputMarkup('rent',exempt,calculateTax(exempt)),/data-field="rentEligible"/);
  assert.match(inputMarkup('rent',exempt,calculateTax(exempt)),/data-input="tax-input"/);
});

test('arnona report exposes all 90/70/50/30 bands and actual rate separately',()=>{
  const p=createProfile();p.adults=9;
  const c=calculateTax(input({profile:p,assessmentYear:2025,
    arnonaBusinessAnnual:20000000,arnonaRentReceivedMonthly:350000,
    householdOtherMonthly:100000,arnonaAnnual:1200000}));
  const html=summaryMarkup(c);
  for(const rate of [90,70,50,30])assert.match(html,new RegExp('עד '+rate+'%'));
  assert.match(html,/50% — המדרגה המחושבת/);
  assert.match(html,/הוחלה: 0%/);
  assert.match(html,/לא הוזן אישור/);
  const approved=calculateTax(input({profile:p,assessmentYear:2025,
    arnonaBusinessAnnual:20000000,arnonaRentReceivedMonthly:350000,
    householdOtherMonthly:100000,arnonaAnnual:1200000,approvedDiscount:2500}));
  assert.equal(approved.annual.arnona,900000);
  assert.match(summaryMarkup(approved),/הוחלה: 25%/);
  assert.match(inputMarkup('family',input({profile:p,assessmentYear:2025,arnonaBusinessAnnual:20000000,arnonaRentReceivedMonthly:350000,householdOtherMonthly:100000}),c),/לפני ניכויי חלק 5/);
});
