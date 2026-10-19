import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnnual,createProfile} from '../shared/tax-calculator/contracts.js';
import {defaultRules} from '../shared/tax-calculator/rules.js';
import {calculateTax} from '../shared/tax-calculator/compute.js';
import {inputMarkup,arnonaResultsMarkup} from '../shared/tax-calculator/view.js';

function input(patch={}) {
  const profile={...createProfile(),adults:10};
  return {...createAnnual(2026,profile,defaultRules()),revenue:27000000,
    rentMonthly:400000,householdOtherMonthly:100000,arnonaAnnual:600000,...patch};
}
test('an unassigned assessment year still produces a labeled forecast and projected payment',()=>{
  const i=input({mode:'actual',arnonaBusinessAnnual:20000000,arnonaRentReceivedMonthly:400000});
  const result=calculateTax(i),a=result.arnona;
  assert.equal(a.assessmentYear,null);
  assert.equal(a.basis,'forecast');
  assert.equal(a.assessmentComplete,false);
  assert.equal(a.assessedAnnualIncome,26000000);
  assert.equal(a.assessedIncome,2166667);
  assert.equal(a.estimatedDiscount,5000);
  assert.equal(a.estimatedAnnualPayment,300000);
  assert.equal(a.estimatedMonthlyPayment,25000);
  assert.equal(result.annual.arnona,600000,'forecast must not approve itself or alter actual-bill net');
  assert.match(arnonaResultsMarkup(result),/תחזית הנחת ארנונה/);
});
test('automatic business base is profit before personal deductions, VAT and period safe',()=>{
  const i=input({revenue:31860000,vatIncluded:true,expensesMonthly:200000});
  const result=calculateTax(i),a=result.arnona;
  assert.equal(result.annual.revenue,27000000);
  assert.equal(a.businessAnnual,24600000);
  assert.equal(a.businessAutomatic,true);
  assert.equal(a.rentalAutomatic,true);
  assert.equal(a.basis,'forecast');
  assert.notEqual(a.businessAnnual,result.annual.taxable);
  assert.equal(calculateTax({...i,revenue:2655000,revenuePeriod:'monthly'}).arnona.businessAnnual,a.businessAnnual);
});
test('manual overrides including zero survive business changes; null explicitly returns to automatic',()=>{
  const i=input({arnonaBusinessAnnual:20000000,arnonaRentReceivedMonthly:0});
  const manual=calculateTax(i).arnona;
  assert.equal(manual.businessAutomatic,false);
  assert.equal(manual.rentalReceivedMonthly,0);
  assert.equal(manual.rentalAutomatic,false);
  assert.equal(calculateTax({...i,revenue:80000000}).arnona.businessAnnual,20000000);
  assert.equal(calculateTax({...i,arnonaBusinessAnnual:0}).arnona.businessAnnual,0);
  const automatic=calculateTax({...i,arnonaBusinessAnnual:null,arnonaRentReceivedMonthly:null}).arnona;
  assert.equal(automatic.businessAnnual,27000000);
  assert.equal(automatic.rentalReceivedMonthly,400000);
  assert.equal(automatic.estimatedDiscount,3000);
  assert.equal(i.arnonaBusinessAnnual,20000000,'calculation does not mutate the persisted override');
});
test('only explicit income from the required period is labeled as an assessment',()=>{
  const i=input({assessmentYear:2025,arnonaBusinessAnnual:20000000,arnonaRentReceivedMonthly:0});
  assert.equal(calculateTax(i).arnona.basis,'assessment');
  for(const patch of [{assessmentYear:2024},{assessmentYear:null},{arnonaBusinessAnnual:null},{arnonaRentReceivedMonthly:null}]) {
    const a=calculateTax({...i,...patch}).arnona;
    assert.equal(a.basis,'forecast');
    assert.equal(a.assessmentComplete,false);
    assert.ok(a.reasons.length>0);
  }
});
test('missing business input remains unknown; explicit zero and loss forecasts are zero',()=>{
  const unknown=calculateTax(input({revenue:null})).arnona;
  assert.equal(unknown.basis,'incomplete');assert.equal(unknown.businessAnnual,null);
  assert.equal(unknown.assessedIncome,null);assert.equal(unknown.estimatedDiscount,null);
  assert.equal(unknown.estimatedAnnualPayment,null);
  assert.equal(calculateTax(input({revenue:null,arnonaBusinessAnnual:0})).arnona.businessAnnual,0);
  assert.equal(calculateTax(input({revenue:0,expensesMonthly:100000})).arnona.businessAnnual,0);
});
test('automatic fields display resolved amounts and provide explicit return to automatic',()=>{
  const i=input(),html=inputMarkup('family',i,calculateTax(i));
  assert.match(html,/data-tax-auto-field="arnonaBusinessAnnual"/);
  assert.match(html,/value="270000"/);
  assert.match(html,/data-type="year"/);
  assert.match(html,/data-tax-arnona-results/);
  assert.equal(i.arnonaBusinessAnnual,null,'rendering a derived amount does not save it as a manual assessment');
});
