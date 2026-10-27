import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyOcrSource} from '../netunim-orders/supabase/functions/morning-expenses/ocr-source.js';
const bytes = new TextEncoder().encode('%PDF-1.4 synthetic source');
const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
const expected = {sha256, size:bytes.length}, raw = {url:'https://sandbox.d.greeninvoice.co.il/api/v1/expenses/download?d=private'};
test('OCR source linkage requires byte-for-byte SHA-256 and size, never provider fileHash or filename', async () => {
  const fetch = async (_, init) => {assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.headers, undefined); return new Response(bytes);};
  assert.equal(await verifyOcrSource({...raw, expense:{fileHash:'unrelated',fileKey:'renamed'}}, expected, 'sandbox', {fetch}), true);
  assert.equal(await verifyOcrSource(raw, {...expected,sha256:'a'.repeat(64)}, 'sandbox', {fetch}), false);
  assert.equal(await verifyOcrSource(raw, {...expected,size:bytes.length - 1}, 'sandbox', {fetch}), false);
  assert.equal(await verifyOcrSource(raw, {...expected,size:bytes.length + 1}, 'sandbox', {fetch}), false);
});
test('source download rejects external origins, wrong environments, credentials, paths and oversized inputs before fetching', async () => {
  for (const url of ['http://localhost/private','https://sandbox.d.greeninvoice.co.il.attacker.example/api/v1/expenses/download',
    'https://sandbox.d.greeninvoice.co.il/api/v1/other','https://user:secret@sandbox.d.greeninvoice.co.il/api/v1/expenses/download',raw.url+'#fragment']) {
    await assert.rejects(verifyOcrSource({url}, expected, 'sandbox', {fetch:() => assert.fail('unsafe fetch')}));
  }
  await assert.rejects(verifyOcrSource(raw, expected, 'production', {fetch:() => assert.fail('wrong environment')}));
  await assert.rejects(verifyOcrSource(raw, {...expected,size:21*1024*1024}, 'sandbox', {fetch:() => assert.fail('oversized')}));
});
test('source verification bounds stalled streams and rejects malformed content lengths', async () => {
  await assert.rejects(verifyOcrSource(raw, expected, 'sandbox', {timeoutMs:10, fetch:async () => new Response(new ReadableStream({start(){}}))}), /timeout/);
  assert.equal(await verifyOcrSource(raw, expected, 'sandbox', {fetch:async () => new Response(bytes, {headers:{'Content-Length':'invalid'}})}), false);
  await assert.rejects(verifyOcrSource(raw, expected, 'sandbox', {fetch:async () => new Response(null,{status:403})}), /unavailable/);
});

test('observed www Production downloads are verified directly, without broadening environments, paths or redirects',async()=>{
  for(const host of ['www.greeninvoice.co.il','api.greeninvoice.co.il']){
    const url='https://'+host+'/api/v1/expenses/download?d=private';
    assert.equal(await verifyOcrSource({url},expected,'production',{fetch:async(actual,init)=>{
      assert.equal(actual,url);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');return new Response(bytes);
    }}),true);
  }
  for(const url of ['https://www.greeninvoice.co.il.attacker.test/api/v1/expenses/download','http://www.greeninvoice.co.il/api/v1/expenses/download',
    'https://www.greeninvoice.co.il/api/v1/other','https://user:secret@www.greeninvoice.co.il/api/v1/expenses/download'])
    await assert.rejects(verifyOcrSource({url},expected,'production',{fetch:()=>assert.fail('unsafe download')}));
  const www={url:'https://www.greeninvoice.co.il/api/v1/expenses/download?d=private'};
  await assert.rejects(verifyOcrSource(www,expected,'sandbox',{fetch:()=>assert.fail('cross-environment download')}));
  await assert.rejects(verifyOcrSource(www,expected,'production',{fetch:async()=>new Response(null,{status:302,headers:{Location:'https://attacker.test'}})}),/unavailable/);
});
