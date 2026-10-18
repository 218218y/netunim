import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsBankView} from '../netunim-kupa/site/assets/js/domains/bank/view.js';
import {createDomainsFinanceView} from '../netunim-orders/site/assets/js/domains/finance/view.js';

for(const [site,create] of [['kupa',createDomainsBankView],['orders',createDomainsFinanceView]]){
  test(`${site} bank filters admit real calendar days through both public entry points`,t=>{
    const ui={};
    const original=Object.getOwnPropertyDescriptor(globalThis,'document');
    t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document});
    globalThis.document={querySelector:()=>null};
    const view=create({ui,controller:{snapshot:()=>({})}});
    for(const invalid of ['2026-02-30','2026-13-40','2025-02-29','2026-2-03',' 2026-02-28',null,{},20260228]){
      view.setBankDateMode('range',invalid,invalid);
      assert.equal(ui.bankDateMode,'all',String(invalid));
      assert.equal(ui.bankDateFrom,'');
      assert.equal(ui.bankDateTo,'');
      view.setBankDateBoundary('from',invalid);
      view.setBankDateBoundary('to',invalid);
      assert.equal(ui.bankDateFrom,'');
      assert.equal(ui.bankDateTo,'');
    }
    view.setBankDateMode('range','2026-03-02','2026-02-28');
    assert.equal(ui.bankDateFrom,'2026-02-28');
    assert.equal(ui.bankDateTo,'2026-03-02');
    view.setBankDateMode('range','2024-02-29','');
    assert.equal(ui.bankDateFrom,'2024-02-29');
    assert.equal(ui.bankDateTo,'');
    view.setBankDateBoundary('to','2024-02-28');
    assert.equal(ui.bankDateFrom,'2024-02-28');
    assert.equal(ui.bankDateTo,'2024-02-28');
    view.setBankDateMode('all');
    assert.equal(ui.bankDateMode,'all');
    assert.equal(ui.bankDateFrom,'');
    assert.equal(ui.bankDateTo,'');
  });
}
