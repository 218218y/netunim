import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reportDocument, reportExpense} from '../netunim-orders/supabase/functions/morning-documents/reports.js';

const source = overrides => ({id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', amount:0.7, vat:0.7,
    currency:'USD', currencyRate:3.65, status:0, type:320, documentDate:'2026-07-05',
    payment:[{type:3, price:0.7}], business:{type:1}, ...overrides});
const expense = overrides => reportExpense({...source(), status:10, documentType:305,
    date:'2026-07-05', reportingDate:'2026-07-01', deductibleAmount:0, deductibleVat:0, ...overrides});

test('source amounts, VAT and split payments round exact decimal exchange products once', () => {
    const row = reportDocument(source());
    assert.equal(row.grossCents, 256); assert.equal(row.vatCents, 256); assert.equal(row.payments[0].amountCents, 256);
    for (const [amount, expected] of [[4.1, 1497], [4.3, 1570], [5.1, 1862]]) {
        assert.equal(expense({amount, vat:amount}).grossCents, expected);
        assert.equal(expense({amount, vat:amount}).vatCents, expected);
    }
    const reversed = reportDocument(source({amount:-0.7, vat:-0.7, payment:[{type:3, price:-0.7}]}));
    assert.equal(reversed.grossCents, -256); assert.equal(reversed.vatCents, -256); assert.equal(reversed.payments[0].amountCents, -256);
});

test('ILS half cents round symmetrically and explicit zero remains a known zero', () => {
    for (const [amount, expected] of [['1.005', 101], ['-1.005', -101], ['0.0049', 0], ['-0.005', -1], [0, 0]]) {
        const row = expense({currency:'ILS', amount, vat:amount, deductibleVat:amount});
        assert.equal(row.grossCents, expected); assert.equal(row.vatCents, expected); assert.equal(row.deductibleVatCents, expected);
    }
});

test('positive and negative decimal exchange conversions agree with an integer fraction reference', () => {
    for (const rateCents of [365, 367, 370, 375, 380, 385, 405, 410, 425, 605]) {
        for (let sourceCents = 1; sourceCents <= 200; sourceCents++) {
            const expected = Math.floor((sourceCents * rateCents + 50) / 100);
            assert.equal(expense({amount:sourceCents / 100, currencyRate:rateCents / 100}).grossCents, expected);
            assert.equal(expense({amount:-sourceCents / 100, currencyRate:rateCents / 100}).grossCents, -expected);
        }
    }
});

test('decimal string precision and safe integer cent boundaries are preserved', () => {
    assert.equal(expense({currency:'ILS', amount:'90071992547409.91'}).grossCents, Number.MAX_SAFE_INTEGER);
    assert.equal(expense({currency:'ILS', amount:'-90071992547409.91'}).grossCents, -Number.MAX_SAFE_INTEGER);
    assert.equal(expense({currency:'ILS', amount:'90071992547409.915'}).grossCents, null);
    assert.equal(expense({amount:'0.1', currencyRate:'1.049999999999999999999'}).grossCents, 10);
    assert.equal(expense({amount:'0.1', currencyRate:'1.050000000000000000001'}).grossCents, 11);
    assert.equal(expense({amount:Number.MAX_SAFE_INTEGER + 1, currencyRate:0.00001}).grossCents, null);
});

test('scientific JSON numbers work while invalid, absent and excessive decimal sources remain unknown', () => {
    assert.equal(expense({amount:1e-7, currencyRate:50000}).grossCents, 1);
    for (const amount of [null, undefined, NaN, Infinity, '', '1e3', '+1', '1,000', '0'.repeat(101)])
        assert.equal(expense({amount}).grossCents, null);
    for (const currencyRate of [null, undefined, 0, -1, NaN, Infinity, '', '3e0'])
        assert.equal(expense({currencyRate}).grossCents, null);
});

test('local gross and deductible VAT are already ILS; missing foreign payment rates never default to one', () => {
    const row = expense({amount:100, amountLocal:'10.075', currencyRate:null, vat:10, deductibleVat:'1.005'});
    assert.equal(row.grossCents, 1008); assert.equal(row.vatCents, null); assert.equal(row.deductibleVatCents, 101);
    const document = reportDocument(source({payment:[{type:3, currency:'EUR', price:10}, {type:1, currency:'ILS', price:'1.005'}]}));
    assert.equal(document.payments[0].amountCents, null); assert.equal(document.payments[1].amountCents, 101);
});
