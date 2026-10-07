import test from 'node:test';
import assert from 'node:assert/strict';
import {composeDocumentSearch as composeOrders} from '../netunim-orders/site/assets/js/shared/document-search-composition.js';
import {composeDocumentSearch as composeKupa} from '../netunim-kupa/site/assets/js/shared/document-search-composition.js';

test('both apps expose one document-search capability with a required cloud port',()=>{
  for(const compose of [composeOrders,composeKupa]){
    assert.throws(()=>compose({}),/document_search_cloud_port_required/);
    const search=compose({supaFetch:async()=>{throw new Error('unexpected network request')}});
    assert.equal(search.providerFor('local:opaque-id'),'everything');
    assert.equal(search.providerFor('drive:opaque-id'),'google-drive');
    assert.equal(typeof search.search,'function');
  }
});
