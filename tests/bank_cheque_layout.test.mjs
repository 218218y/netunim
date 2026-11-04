import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css = await readFile(new URL('../netunim-orders/site/assets/app.css', import.meta.url), 'utf8');

function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Expected CSS rule for ${selector}`);
  return match[1];
}

// These outer-table sizing rules must stay scoped to its own header row. A
// descendant selector also matches the nested cheque table and overrides its
// compact column widths.
assert.match(css, /\.bank-transactions-table>thead>tr>th:first-child:not\(\.bank-transaction-actions-head\)\{width:125px\}/);
assert.match(css, /\.bank-transactions-table>thead>tr>th:nth-last-child\(3\),\.bank-transactions-table>thead>tr>th:nth-last-child\(2\)\{width:96px/);
assert.match(css, /\.bank-transactions-table>thead>tr>th:last-child\{width:138px/);
assert.doesNotMatch(css, /\.bank-transactions-table\s+th:first-child:not\(\.bank-transaction-actions-head\)/);
assert.doesNotMatch(css, /\.bank-transactions-table\s+th:nth-last-child/);
assert.doesNotMatch(css, /\.bank-transactions-table\s+th:last-child/);

assert.match(declarations('.bank-cheque-items-wrap'), /max-width:480px/);
assert.match(declarations('.bank-cheque-items-wrap'), /overflow:hidden/);
assert.doesNotMatch(declarations('.bank-cheque-items-wrap'), /overflow-x:\s*(auto|scroll)/);
assert.match(declarations('.bank-cheque-items'), /table-layout:fixed!important/);

const widths = Array.from({length: 6}, (_, index) => {
  const rule = declarations(`.bank-cheque-items th:nth-child(${index + 1}),.bank-cheque-items td:nth-child(${index + 1})`);
  return Number(rule.match(/width:([\d.]+)%/)?.[1]);
});
assert.deepEqual(widths, [9, 11, 18, 19, 15, 28]);
assert.equal(widths.reduce((sum, width) => sum + width, 0), 100);

assert.match(declarations('.bank-transactions-table>tbody>tr.pending>td'), /background:var\(--marker-yellow\)/);
assert.match(declarations('.credit-detail-table tbody tr.credit-pending-detail-row td'), /background:var\(--marker-yellow\)/);
assert.match(declarations('.credit-detail-table tbody tr.credit-pending-detail-row:hover td'), /background:var\(--marker-yellow-hover\)/);

console.log('bank cheque layout tests passed');
