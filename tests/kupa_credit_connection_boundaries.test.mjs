import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import {restoreCreditPublicationAuthority} from './credit_publication_authority_fixture.mjs';

const root = new URL('../', import.meta.url),
  read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const owner = 'netunim-kupa/site/assets/js/domains/credit/connection-owner.js';
const controller = 'netunim-kupa/site/assets/js/domains/credit/controller.js';
function factory(source, name) {
  return parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true }).body.find(
    (row) => row.declaration?.id?.name === name
  ).declaration;
}

test('Credit local connections own six explicit ports and no browser/storage/network globals', () => {
  const source = read(owner),
    tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  assert.equal(factory(source, 'createCreditConnectionOwner').params[0].properties.length, 6);
  assert.equal(tree.body.filter((row) => row.type === 'ImportDeclaration').length, 0);
  for (const ref of analyze(tree, { ecmaVersion: 2022, sourceType: 'module' }).globalScope
    .through) {
    assert.ok(
      ![
        'window',
        'document',
        'navigator',
        'fetch',
        'localStorage',
        'globalThis',
        'Blob',
        'URL',
        'setTimeout',
        'setInterval',
      ].includes(ref.identifier.name),
      ref.identifier.name
    );
  }
  assert.ok(Buffer.byteLength(source) < 15000);
});

test('Credit financial controller delegates local connection state/effects with a narrower boundary', () => {
  const source = read(controller),
    fields = factory(source, 'createDomainsCreditController').params[0].properties.map(
      (row) => row.key.name
    );
  assert.equal(fields.length, 15);
  assert.ok(fields.includes('syncLeases'));
  assert.ok(fields.includes('connections'));
  assert.ok(!fields.includes('effects'));
  assert.ok(!fields.includes('closeModal'));
  for (const method of [
    'creditStatus',
    'creditDiagnostics',
    'creditDataDiagnostics',
    'saveCreditProfile',
    'deleteCreditProfile',
  ])
    assert.ok(!source.includes('bridge.' + method), method);
  assert.ok(!source.includes('local.status'));
  assert.ok(!source.includes('profileFromBridge'));
  assert.ok(source.includes('connections.queries.capture()'));
  const composition = read('netunim-kupa/site/assets/js/composition/credit.js');
  assert.ok(composition.includes('connections=createCreditConnectionOwner('));
  assert.ok(composition.includes('connections?.runtime.dispose()'));
  assert.ok(composition.includes('connections?.runtime.drain()'));
});

test('Bridge wire/fallback, issuer merge, Finance publication and credential input retain their baseline bodies', () => {
  const fixture = JSON.parse(read('tests/fixtures/kupa-credit-connection-policy.json'));
  assert.equal(fixture.baseline, '665d6245eca1d8500f5ba7ed689480f882a1f57b');
  assert.equal(Object.keys(fixture.sha256).length, 5);
  for (const [file, expected] of Object.entries(fixture.sha256)) {
    let source = read(file).replace(/\r\n/g, '\n');
    if(file.endsWith('/credit/publication.js'))source=restoreCreditPublicationAuthority(source);
    assert.equal(createHash('sha256').update(source).digest('hex'), expected, file);
  }
});
