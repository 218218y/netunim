import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createDocumentBridgeRoutes} from '../netunim-orders/document-bridge/http-routes.mjs';
import {createDocumentBridgeHttpHandler, documentBridgeErrorResponse} from '../netunim-orders/document-bridge/http-handler.mjs';
import {createDocumentBridgeClient} from '../shared/document-bridge-client.js';
import {fixture as maintenanceFixture,finish as finishMaintenance} from './maintenance_process_fixture.mjs';

const origin = 'https://bargig-furniture.com';
const identity = {ok: true, service: 'netunim-orders-document-bridge', version: 38, pid: 123};

async function fixture(t, overrides = {}) {
  const calls = [], logs = [], reads = {config: 0, token: 0};
  const operation = name => async (...args) => { calls.push([name, ...args]); return {ok: true, operation: name, bridgeVersion: 38}; };
  const ports = {
    service: {status: operation('status'), warm: operation('warm')},
    maintenance: {status: operation('pdf-status'), start: operation('pdf-start'), stop: operation('pdf-stop')},
    search: {selectFolder: operation('folder'), recent: operation('recent'), search: operation('search')},
    preview: {document: operation('preview'), matches: operation('matches'), file: async id => {
      calls.push(['binary', id]); return {buffer: Buffer.from([0, 1, 255, 65]), mime: 'application/pdf', name: 'דו״ח.pdf'};
    }},
    nativePreview: {open: operation('native'), move: operation('move'), hide: operation('hide')},
    files: {open: operation('open'), reveal: operation('reveal'), delete: operation('delete')},
    shutdown: {prepare: operation('shutdown'), afterResponse: () => calls.push(['shutdown-after-response'])},
    ...overrides,
  };
  let config = {allowedOrigins: [origin]}, token = 'private-pairing-token';
  const handler = createDocumentBridgeHttpHandler({
    loadConfig: async () => { reads.config++; return config; },
    readToken: async () => { reads.token++; return token; },
    routes: createDocumentBridgeRoutes(ports), health: () => identity,
    appendLog: async message => logs.push(message), ports,
  });
  const server = http.createServer((req, res) => handler(req, res).catch(error => {
    res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify(documentBridgeErrorResponse(error)));
  }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(target, {method = 'POST', body = '{}', headers = {}, chunks} = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(base + target, {method, agent: false,
        headers: {Origin: origin, Authorization: 'Bearer private-pairing-token',
          ...(chunks ? {'Transfer-Encoding': 'chunked'} : {'Content-Length': Buffer.byteLength(body)}), ...headers}}, res => {
        const received = [];
        res.on('error', reject);
        res.on('data', chunk => received.push(chunk));
        res.on('end', () => { const bytes = Buffer.concat(received); let data;
          try { data = JSON.parse(bytes.toString('utf8')); } catch { data = null; }
          resolve({status: res.statusCode, headers: res.headers, bytes, data});
        });
      });
      req.on('error', reject);
      req.setTimeout(3000, () => req.destroy(new Error('HTTP test deadline')));
      for (const chunk of chunks || [body]) req.write(chunk);
      req.end();
    });
  }
  return {calls, logs, reads, request, base, handler, server, setConfig: value => { config = value; }, setToken: value => { token = value; }};
}

test('HTTP boundary checks origin before public health, preflight, token and body', async t => {
  const f = await fixture(t);
  for (const [target, method] of [['/health', 'GET'], ['/documents/open', 'OPTIONS'], ['/documents/delete', 'POST']]) {
    const response = await f.request(target, {method, body: '{invalid', headers: {Origin: 'https://untrusted.example'}});
    assert.equal(response.status, 403);
    assert.equal(response.data.code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(f.reads.token, 0);
  assert.deepEqual(f.calls, []);
});

test('HTTP boundary keeps exact public health and private-network preflight without reading token', async t => {
  const f = await fixture(t);
  const health = await f.request('/health', {method: 'GET', headers: {Authorization: ''}});
  assert.deepEqual(health.data, identity);
  const preflight = await f.request('/documents/delete', {method: 'OPTIONS', headers: {Authorization: ''}});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.bytes.length, 0);
  assert.equal(preflight.headers['access-control-allow-private-network'], 'true');
  assert.equal(preflight.headers['access-control-allow-headers'], 'Authorization,Content-Type');
  assert.equal(preflight.headers['access-control-allow-methods'], 'GET,POST,OPTIONS');
  assert.equal(preflight.headers['access-control-max-age'], '600');
  assert.equal(f.reads.token, 0);
  assert.deepEqual(f.calls, []);
});

test('HTTP boundary rejects missing, wrong-length, wrong-case and different same-length tokens before dispatch', async t => {
  const f = await fixture(t);
  for (const value of ['', 'Bearer ', 'Basic private-pairing-token', 'bearer private-pairing-token', 'Bearer x', 'Bearer private-pairing-tokem']) {
    const response = await f.request('/documents/delete', {headers: {Authorization: value}, body: '{invalid'});
    assert.equal(response.status, 401);
    assert.equal(response.data.code, 'UNAUTHORIZED');
    assert.equal(response.headers['access-control-allow-origin'], origin);
  }
  f.setToken('');
  assert.equal((await f.request('/status', {method: 'GET', headers: {Authorization: ''}})).status, 401);
  assert.deepEqual(f.calls, []);
});

test('HTTP boundary reloads configuration and pairing token for each request', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/status', {method: 'GET'})).status, 200);
  f.setToken('rotated-token');
  assert.equal((await f.request('/status', {method: 'GET'})).status, 401);
  assert.equal((await f.request('/status', {method: 'GET', headers: {Authorization: 'Bearer rotated-token'}})).status, 200);
  f.setConfig({allowedOrigins: ['https://other.example']});
  assert.equal((await f.request('/health', {method: 'GET'})).status, 403);
  assert.equal(f.reads.config, 4);
});

test('every registered private route requires authorization without entering its capability', async t => {
  const f = await fixture(t);
  for (const [target, method] of [['/status', 'GET'], ['/documents/pdf-index/status', 'GET'], ...[
    'warm', 'pdf-index/start', 'pdf-index/stop', 'select-folder', 'recent', 'search', 'preview', 'matches',
    'preview-file', 'native-preview', 'native-preview/move', 'native-preview/hide', 'open', 'reveal', 'delete',
  ].map(name => [`/documents/${name}`, 'POST']), ['/shutdown', 'POST']]) {
    assert.equal((await f.request(target, {method, headers: {Authorization: ''}})).status, 401, target);
  }
  assert.deepEqual(f.calls, []);
});

test('disconnect during JSON consumption does not enter a file action or poison the next request', async t => {
  const f = await fixture(t);
  const received = new Promise(resolve => f.server.once('request', req => req.once('readable', resolve)));
  await new Promise(resolve => {
    const req = http.request(f.base + '/documents/delete', {method: 'POST', agent: false,
      headers: {Origin: origin, Authorization: 'Bearer private-pairing-token', 'Content-Length': '1000'}}, () => {});
    req.on('error', () => {});
    req.on('close', resolve);
    req.flushHeaders();
    req.write('{"id":"incomplete');
    received.then(() => req.destroy());
  });
  assert.equal((await f.request('/health', {method: 'GET'})).status, 200);
  assert.deepEqual(f.calls, []);
});

test('HTTP boundary preserves loopback tools without Origin and exact method/target matching', async t => {
  const f = await fixture(t);
  const response = await f.request('/status', {method: 'GET', headers: {Origin: ''}});
  assert.equal(response.status, 200);
  assert.equal(response.headers['access-control-allow-origin'], 'null');
  for (const [target, method] of [['/health?x=1', 'GET'], ['/documents/search/', 'POST'], ['/documents/open', 'GET'], ['/unknown', 'POST']]) {
    assert.equal((await f.request(target, {method})).status, 404);
  }
  assert.deepEqual(f.calls, [['status']]);
});

test('wire forwarding preserves search fields and passes only opaque IDs to file/preview owners', async t => {
  const f = await fixture(t);
  const body = {query: 'דו״ח', limit: 12, mode: 'content', contentSearch: {matchMode: 'all'}, scopePath: 'C:\\Documents', offset: 150, sort: 'date-modified-descending', fileType: 'pdf', id: 'opaque-7', geometry: {x: 1, y: 2, width: 30, height: 40}, path: 'C:\\untrusted.txt'};
  for (const target of ['search', 'recent', 'preview', 'matches', 'native-preview', 'native-preview/move', 'open', 'reveal', 'delete']) {
    const response = await f.request(`/documents/${target}`, {body: JSON.stringify(body)});
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers.vary, 'Origin');
  }
  for(const call of f.calls.slice(0,2)){
    assert.ok(call.at(-1) instanceof AbortSignal);
    assert.equal(call.at(-1).aborted,false,'normal request-body completion is not caller cancellation');
  }
  assert.deepEqual(f.calls.map(call=>['search','recent'].includes(call[0])?call.slice(0,-1):call), [
    ['search', body.query, body.limit, body.mode, body.contentSearch, body.scopePath, body.offset, body.sort, body.fileType],
    ['recent', body.limit, body.scopePath, body.fileType], ['preview', body.id], ['matches', body.id],
    ['native', body.id, body.geometry], ['move', body.geometry], ['open', body.id], ['reveal', body.id], ['delete', body.id],
  ]);
});

test('disconnect after accepted shutdown still drains the command and invokes final teardown',{timeout:3000},async t=>{
  let entered,release,finished,closed;
  const started=new Promise(resolve=>{entered=resolve}),held=new Promise(resolve=>{release=resolve});
  const stopped=new Promise(resolve=>{finished=resolve}),disconnected=new Promise(resolve=>{closed=resolve});
  const f=await fixture(t,{shutdown:{prepare:async()=>{entered();await held;return {ok:true}},afterResponse:()=>finished()}});
  f.server.once('request',(_req,res)=>res.once('close',()=>closed()));
  const client=http.request(f.base+'/shutdown',{method:'POST',headers:{Authorization:'Bearer private-pairing-token',Origin:origin}});
  client.on('error',()=>{});client.end();await started;client.destroy();await disconnected;
  release();await stopped;
  assert.deepEqual(f.logs,[]);
});

test('wire routes without payload retain independent service and maintenance ownership', async t => {
  const f = await fixture(t);
  for (const [target, method] of [['/status', 'GET'], ['/documents/warm', 'POST'], ['/documents/pdf-index/status', 'GET'], ['/documents/pdf-index/start', 'POST'], ['/documents/pdf-index/stop', 'POST'], ['/documents/select-folder', 'POST'], ['/documents/native-preview/hide', 'POST']]) {
    assert.equal((await f.request(target, {method, body: '{ignored'})).status, 200);
  }
  assert.deepEqual(f.calls, [['status'], ['warm'], ['pdf-status'], ['pdf-start'], ['pdf-stop'], ['folder'], ['hide']]);
});

test('bounded JSON body rejects invalid and oversized UTF-8 across chunks without capability entry', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/documents/search', {body: '{'})).data.code, 'INVALID_JSON');
  const exact = '{"query":"' + 'a'.repeat(8180) + '"}';
  assert.equal(Buffer.byteLength(exact), 8192);
  assert.equal((await f.request('/documents/search', {body: exact})).status, 200);
  const large = JSON.stringify({query: 'ש'.repeat(4100)});
  assert.ok(large.length < 8192 && Buffer.byteLength(large) > 8192);
  const bytes = Buffer.from(large);
  const response = await f.request('/documents/search', {chunks: [bytes.subarray(0, 4000), bytes.subarray(4000)]});
  assert.equal(response.status, 503);
  assert.equal(response.data.code, 'REQUEST_TOO_LARGE');
  assert.equal(f.calls.length, 1);
});

test('empty JSON body and legacy null-body failure retain their wire behavior', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/documents/open', {body: ''})).status, 200);
  assert.deepEqual(f.calls, [['open', undefined]]);
  const response = await f.request('/documents/open', {body: 'null'});
  assert.equal(response.status, 503);
  assert.equal(response.data.code, 'DOCUMENT_BRIDGE_ERROR');
  assert.equal(f.calls.length, 1);
});

test('binary preview preserves bytes, MIME, encoded filename, length and authenticated CORS', async t => {
  const f = await fixture(t);
  const response = await f.request('/documents/preview-file', {body: JSON.stringify({id: 'opaque-binary'})});
  assert.equal(response.status, 200);
  assert.deepEqual(response.bytes, Buffer.from([0, 1, 255, 65]));
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.equal(response.headers['content-length'], '4');
  assert.equal(response.headers['content-disposition'], `inline; filename*=UTF-8''${encodeURIComponent('דו״ח.pdf')}`);
  assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.deepEqual(f.calls, [['binary', 'opaque-binary']]);
});

for (const [code, status] of [['QUERY_TOO_SHORT', 400], ['RESULT_EXPIRED', 410], ['ES_EXIT_ERROR', 503]]) {
  test(`capability errors preserve ${code} HTTP status, body and diagnostics`, async t => {
    const f = await fixture(t, {files: {open: async () => { throw Object.assign(new Error('classified error'), {code, rootErrors: ['root']}); }, reveal: async () => ({}), delete: async () => ({})}});
    const response = await f.request('/documents/open');
    assert.equal(response.status, status);
    assert.deepEqual(response.data, {ok: false, code, message: 'classified error', rootErrors: ['root']});
    assert.deepEqual(f.logs, [`POST /documents/open ${code} classified error`]);
  });
}

test('shutdown sends its response before starting listener teardown', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/shutdown')).status, 200);
  assert.deepEqual(f.calls, [['shutdown'], ['shutdown-after-response']]);
  const writes = [];
  await f.handler({method: 'POST', url: '/shutdown', headers: {authorization: 'Bearer private-pairing-token'}}, {
    writeHead: () => writes.push('headers'), end: () => { writes.push('response'); assert.deepEqual(f.calls.at(-1), ['shutdown']); },
  });
  assert.deepEqual(writes, ['headers', 'response']);
  assert.deepEqual(f.calls.at(-1), ['shutdown-after-response']);
});

test('HTTP shutdown refuses listener teardown until the owned maintenance worker drains', async t => {
  const maintenance=maintenanceFixture();await maintenance.owner.start();let teardown=0;let drainStarted;
  const draining=new Promise(resolve=>{drainStarted=resolve});
  const f=await fixture(t,{shutdown:{prepare:()=>{const work=maintenance.owner.dispose();drainStarted();return work.then(()=>({ok:true}))},afterResponse:()=>{teardown++}}});
  const request=f.request('/shutdown');await draining;[...maintenance.timers.values()][0]();const blocked=await request;
  assert.equal(blocked.status,503);assert.equal(blocked.data.code,'PDF_MAINTENANCE_DRAIN_TIMEOUT');assert.equal(teardown,0);assert.equal(maintenance.owner.view().manual.running,true);
  finishMaintenance(maintenance.children[0],{aborted:true});assert.equal((await f.request('/shutdown')).status,200);assert.equal(teardown,1);
});

test('route and HTTP factories reject unbound ports before starting a listener', () => {
  assert.throws(() => createDocumentBridgeRoutes({}), /document_bridge_route_ports_required/);
  assert.throws(() => createDocumentBridgeHttpHandler({}), /document_bridge_http_ports_required/);
});

test('canonical browser client consumes actual HTTP routes and classified file failures', async t => {
  const f = await fixture(t, {preview: {document: async id => { throw Object.assign(new Error('expired result'), {code: 'RESULT_EXPIRED'}); }, matches: async () => ({}), file: async () => ({buffer: Buffer.from('pdf'), mime: 'application/pdf', name: 'sample.pdf'})}});
  const client = createDocumentBridgeClient({tokenStore: {get: () => 'private-pairing-token', set: () => {}},
    fetchRequest: (url, options) => fetch(url.replace('http://127.0.0.1:8766', f.base), options),
    timers: {setTimeout, clearTimeout}, createAbortController: () => new AbortController()});
  assert.deepEqual(await client.health(), identity);
  await assert.rejects(client.preview('opaque-stale'), error => error.code === 'RESULT_EXPIRED' && error.httpStatus === 410);
  assert.equal(await (await client.previewFile('opaque-current')).text(), 'pdf');
});
