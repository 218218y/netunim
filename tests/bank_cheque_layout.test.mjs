import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const apps = [
  {
    name: 'Orders',
    path: '../netunim-orders/site/assets/app.css',
  },
  {
    name: 'Kupa',
    path: '../netunim-kupa/site/assets/app.css',
  },
];

function declarations(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Expected CSS rule for ${selector}`);
  return match[1];
}

for (const app of apps) {
  const css = await readFile(new URL(app.path, import.meta.url), 'utf8');

  // Main transaction-table rules must not leak into the nested cheque table.
  assert.ok(
    css.includes('.bank-transactions-table>thead>tr>th:nth-child(1){width:125px}')
      || css.includes('.bank-transactions-table>thead>tr>th:first-child:not(.bank-transaction-actions-head){width:125px}'),
    `${app.name} outer transaction-table width must be scoped to its own header row`,
  );
  assert.match(css, /\.bank-transactions-table>tbody>tr>td\{[^}]*background:#fff/);
  assert.doesNotMatch(css, /\.bank-transactions-table\s+th:nth-child/);
  assert.doesNotMatch(css, /\.bank-transactions-table\s+td\{/);

  const wrapper = declarations(css, '.bank-cheque-items-wrap');
  assert.match(wrapper, /max-width:400px/);
  assert.match(wrapper, /margin-left:0/);
  assert.match(wrapper, /margin-right:auto/);
  assert.match(wrapper, /overflow:hidden/);
  assert.doesNotMatch(wrapper, /overflow-x:\s*(auto|scroll)/);
  assert.doesNotMatch(wrapper, /justify-self:end/);

  assert.match(declarations(css, '.bank-cheque-items'), /table-layout:fixed!important/);
  assert.match(declarations(css, '.bank-cheque-items th,.bank-cheque-items td'), /text-align:center!important/);
  assert.match(declarations(css, '.bank-cheque-image-actions'), /justify-content:center/);

  const widths = Array.from({length: 6}, (_, index) => {
    const rule = declarations(css, `.bank-cheque-items th:nth-child(${index + 1}),.bank-cheque-items td:nth-child(${index + 1})`);
    return Number(rule.match(/width:([\d.]+)%/)?.[1]);
  });
  assert.deepEqual(widths, [9, 11, 18, 19, 15, 28], `${app.name} cheque columns should retain readable content proportions`);
  assert.equal(widths.reduce((sum, width) => sum + width, 0), 100);

  assert.match(declarations(css, '.bank-transactions-table>tbody>tr.pending>td'), /background:var\(--marker-yellow\)/);
  assert.match(declarations(css, '.bank-transactions-table>tbody>tr.pending:hover>td'), /background:var\(--marker-yellow-hover\)/);
  assert.match(declarations(css, '.credit-detail-table tbody tr.credit-pending-detail-row td'), /background:var\(--marker-yellow\)/);
  assert.match(declarations(css, '.credit-detail-table tbody tr.credit-pending-detail-row:hover td'), /background:var\(--marker-yellow-hover\)/);
  assert.match(declarations(css, '.credit-detail-table tbody tr.credit-pending-detail-row.stale:hover td'), /background:var\(--marker-yellow-hover\)/);

  if (app.name === 'Kupa') {
    assert.match(css, /--marker-yellow:#fff6ac/);
    assert.match(css, /--marker-yellow-hover:#fff39a/);
  }
}

console.log('bank cheque layout tests passed');
