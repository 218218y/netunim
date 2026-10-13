import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrdersFinanceControllerFixture as createDomainsFinanceController} from './orders_finance_controller_fixture.mjs';
import {createFinanceBrowserEffects} from '../shared/finance-browser-effects.js';

for (const kind of ['bank', 'credit']) {
  test(`${kind} diagnostic export failure releases its temporary URL and anchor`, async t => {
    const urls = new Set(), anchors = new Set();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const anchor = {remove:() => anchors.delete(anchor), click() { throw Error('injected click failure'); }};
    Object.defineProperty(globalThis, 'document', {configurable:true, value:{
      createElement:() => anchor, body:{appendChild:node => anchors.add(node)},
    }});
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
    t.mock.method(URL, 'createObjectURL', () => { urls.add('blob:fixture'); return 'blob:fixture'; });
    t.mock.method(URL, 'revokeObjectURL', url => urls.delete(url));
    t.mock.method(globalThis, 'setTimeout', () => 1);
    const result = {available:true, filename:'diagnostic.json', data:{version:1}};
    const controller = createDomainsFinanceController({
      effects:createFinanceBrowserEffects(),
      tab:{primaryTab:true}, checksSession:{}, toast:() => {},
      operationScope:{capture:() => () => {}, captureRead:() => () => {}},
      bridge:{getBridgeToken:() => 'fixture', bankAutoEnabled:() => false,
        creditAutoEnabled:() => false, creditAutoMode:() => 'quick',
        bankDiagnostics:async () => result, creditDataDiagnostics:async () => result},
    });
    assert.equal(await controller[kind === 'bank' ? 'exportBankChequeDiagnostics' : 'exportCreditDataDiagnostics'](), false);
    assert.equal(urls.size, 0, 'a failed click must revoke the already allocated URL');
    assert.equal(anchors.size, 0, 'a failed click must remove the already appended anchor');
  });
}
