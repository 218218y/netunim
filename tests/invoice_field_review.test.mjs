import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invoiceFieldReview} from '../netunim-orders/site/assets/js/core/invoice-field-review.js';

const field = value => ({value, status:'verified', sources:[]});
const proposal = {fields:{supplier:{...field('123456789'),canonicalVerified:true},documentType:field(305),invoiceNumber:{...field('0007'),rawNumber:'SI0007',suggestedNumber:'0007'},
  date:field('2026-10-20'),net:{...field(600000),status:'review',reason:'computed_net'},vat:field(108000),gross:field(708000),allocationNumber:{value:null,status:'missing'}}};
const draft = {supplierId:'canonical',documentType:305,number:'0007',date:'2026-10-20',net:'6000.00',vat:'1080.00',gross:'7080.00',allocationNumber:'',pcnClassification:'T'};
const review = (edits={}, values=draft, tax='123456789') => invoiceFieldReview(proposal,edits,values,tax);

test('field statuses distinguish source evidence, computed amounts, missing allocation and manual correction', () => {
  const result=review();
  assert.equal(result.supplierId.status,'verified');assert.equal(result.documentType.status,'verified');
  assert.equal(result.net.status,'review');assert.match(result.net.detail,/חושב/);
  assert.equal(result.allocationNumber.status,'missing');assert.match(result.allocationNumber.detail,/ייתכן שנדרש/);
  assert.match(result.number.detail,/SI0007/);assert.match(result.number.detail,/0007/);
  const manual=review({number:'manual',net:'manual',allocationNumber:'manual'},{...draft,number:'0008',allocationNumber:'123456789'});
  assert.equal(manual.number.status,'manual');assert.equal(manual.net.status,'manual');assert.equal(manual.allocationNumber.status,'manual');
  assert.match(manual.allocationNumber.detail,/לא אומת מול רשות המסים/);assert.equal(proposal.fields.invoiceNumber.status,'verified');
});

test('changing supplier invalidates source-specific confidence; unfilled defaults never become verified', () => {
  const changed=review({supplierId:'manual'},draft,'987654321');
  assert.equal(changed.supplierId.status,'manual');assert.equal(changed.number.status,'review');assert.equal(changed.vat.status,'review');
  assert.equal(review({}, {...draft,number:'other'}).number.status,'review');
  assert.equal(review({number:'manual'}, {...draft,number:''}).number.status,'missing');
});

test('current date and amounts recalculate allocation applicability and monetary consistency without changing the source', () => {
  assert.equal(review({}, {...draft,net:'1000.00',vat:'180.00',gross:'1180.00'}).allocationNumber.allocationPolicy,'below_threshold_or_no_vat');
  const changed=review({net:'manual',vat:'calculated'}, {...draft,net:'1000.00'});
  assert.equal(changed.net.status,'review');assert.equal(changed.vat.status,'review');assert.match(changed.gross.detail,/אינם תואמים/);
  assert.equal(proposal.fields.net.value,600000);
});
