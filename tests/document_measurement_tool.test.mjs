import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {measurePlan, compareReports, percentile} from '../tools/measure-document-bridge.mjs';

const privateValue = 'PRIVATE-client-account-query-token-path';
const fingerprintKey = Buffer.alloc(32, 7);
const config = {machine: 'computer-1', origin: 'https://orders.bargig-furniture.com', repetitions: 20, warmups: 0};
const search = {query: privateValue, scopePath: 'Y:\\Business', offset: 150, fileType: 'pdf'};
const single = (body = search) => ({...config, scenarios: [{id: 'case-01', operation: 'search', search: body}]});
const options = {token: privateValue, fingerprintKey};

function json(data = {}, headers = {}) {
  return Response.json({ok: true, results: [{id: privateValue}], ...data}, {headers});
}

test('reads Server-Timing for search and both preview formats without retaining private input or response data', async () => {
  const calls = [];
  const plan = {...config, warmups: 1, scenarios: [
    {id: 'case-01', operation: 'search', search},
    {id: 'case-02', operation: 'preview', search},
    {id: 'case-03', operation: 'binary', search},
  ]};
  const report = await measurePlan(plan, {...options, fetchRequest: async (url, init) => {
    calls.push(url);
    assert.ok(url.startsWith('http://127.0.0.1:8766/documents/'));
    assert.equal(init.headers.Authorization, 'Bearer ' + privateValue);
    assert.equal(init.redirect, 'error');
    const headers = {'Server-Timing': 'bridge;dur=88.25, operation;dur=71, privateMetric;dur=7'};
    if (url.endsWith('preview-file')) return new Response(privateValue, {headers});
    if (url.endsWith('/preview')) return json({name: privateValue}, headers);
    return json({query: privateValue, timings: {everythingMs: 2, [privateValue + 'Ms']: 9}}, headers);
  }});
  assert.equal(calls.length, 68);
  for (const scenario of report.scenarios) {
    assert.equal(scenario.firstTimings.bridgeMs, 88.25);
    assert.deepEqual(scenario.phases.bridgeMs, {sampleCount: 20, p50Ms: 88.25, p95Ms: 88.25});
    assert.equal(scenario.phases.operationMs.p95Ms, 71);
    assert.equal(scenario.phases.privateMetricMs, undefined);
    assert.equal(scenario.outcomes.complete, 20);
  }
  assert.equal(report.scenarios[0].phases.everythingMs.p95Ms, 2);
  assert.equal(report.scenarios[2].phases.everythingMs, undefined);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE-client-account-query-token-path|Business/);
  assert.equal(percentile([4, 1, 3, 2], .5), 2);
});

test('baseline requires the same request, machine and secret, independent of JSON property order', async () => {
  const run = (plan, key = fingerprintKey) => measurePlan(plan, {...options, fingerprintKey: key, fetchRequest: async () => json()});
  const baseline = await run(single());
  baseline.scenarios[0].p95Ms = 100;
  const current = await run(single({fileType: search.fileType, offset: search.offset, scopePath: search.scopePath, query: search.query}));
  current.scenarios[0].p95Ms = 121;
  assert.equal(compareReports(current, baseline)[0].reviewRequired, true);
  for (const change of [{query: 'other'}, {offset: 300}, {scopePath: 'C:\\Business'}, {fileType: 'word'}]) {
    const changed = await run(single({...search, ...change}));
    assert.throws(() => compareReports(changed, baseline), /baseline_scenario_changed/);
  }
  const differentKey = await run(single(), Buffer.alloc(32, 8));
  assert.throws(() => compareReports(differentKey, baseline), /baseline_scenario_changed/);
  assert.throws(() => compareReports({...current, machine: 'computer-2'}, baseline), /baseline_machine_mismatch/);
  assert.throws(() => compareReports(current, {...baseline, schema: 1}), /baseline_schema_mismatch/);
  assert.throws(() => compareReports(current, {...baseline, scenarios: []}), /baseline_scenario_set_mismatch/);
});

test('failed and partial responses are counted and never used as latency samples', async () => {
  let count = 0;
  const report = await measurePlan(single(), {...options, fetchRequest: async () => {
    count++;
    if (count === 2) return json({partial: true});
    if (count === 3) return new Response('malformed', {status: 200});
    if (count === 4) return Response.json({ok: false}, {status: 503});
    return json();
  }});
  const [row] = report.scenarios;
  assert.equal(row.attempts, 20);
  assert.equal(row.sampleCount, 17);
  assert.deepEqual(row.outcomes, {complete: 17, partial: 1, failed: 2, timedOut: 0, cancelled: 0});
  assert.throws(() => compareReports(report, report), /baseline_insufficient_complete_samples/);
});

test('cancellation during response decoding records the attempt without retrying', async () => {
  const controller = new AbortController();
  let calls = 0;
  const report = await measurePlan(single(), {...options, signal: controller.signal, fetchRequest: async () => {
    if (++calls === 2) controller.abort();
    return json();
  }});
  assert.equal(calls, 2);
  assert.equal(report.cancelled, true);
  assert.equal(report.scenarios[0].outcomes.cancelled, 1);
  assert.equal(report.scenarios[0].sampleCount, 0);
});

test('a real 307 cannot send measurement details to a second endpoint', async t => {
  let redirected = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/documents/search') {
      res.writeHead(307, {Location: '/redirect-target'});
    } else {
      redirected++;
      res.writeHead(200, {'Content-Type': 'application/json'});
    }
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {server.closeAllConnections(); server.close()});
  const report = await measurePlan(single(), {...options, port: server.address().port});
  assert.equal(redirected, 0);
  assert.equal(report.scenarios[0].outcomes.failed, 20);
  assert.equal(report.scenarios[0].p95Ms, null);
});

test('measurement refuses mutations and insufficient samples before sending a request', async () => {
  let calls = 0;
  const opts = {...options, fetchRequest: async () => {calls++; throw Error('unexpected')}};
  const plan = {...config, scenarios: [{id: 'case-01', operation: 'delete'}]};
  await assert.rejects(measurePlan(plan, opts), /invalid_scenario/);
  await assert.rejects(measurePlan({...plan, repetitions: 1}, opts), /invalid_repetitions/);
  assert.equal(calls, 0);
});
