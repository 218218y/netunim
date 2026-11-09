import {createHmac, randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import {Agent, request as httpRequest} from 'node:http';
import path from 'node:path';
import {arrayBuffer, json} from 'node:stream/consumers';
import {pathToFileURL} from 'node:url';
import {bridgeDataRoot} from '../netunim-orders/document-bridge/bridge-runtime-files.mjs';

const operations = new Map([
  ['search', '/documents/search'], ['recent', '/documents/recent'],
  ['preview', '/documents/preview'], ['matches', '/documents/matches'], ['binary', '/documents/preview-file']
]);
const previewOperations = new Set(['preview', 'matches', 'binary']);
const searchPhases = [
  'everythingMs', 'candidateAdmissionMs', 'rootValidationMs', 'pathValidationMs',
  'hiddenValidationMs', 'pdfPrepareMs', 'pdfSearchMs', 'publicationMs', 'auditMs'
];
const minimumSamples = 20;
const caseId = /^case-\d{2}$/;
const digest = /^[a-f0-9]{64}$/;
const directAgent = new Agent({keepAlive: true});

function requestDirectly(url, {method, headers, body, signal}) {
  // An explicit agent avoids the environment's global proxy. Node's HTTP
  // client returns redirects as responses and never follows them.
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      agent: directAgent, method, headers: {...headers, 'Content-Length': Buffer.byteLength(body)}, signal,
    }, response => {
      const status = response.statusCode;
      resolve({
        status, ok: status >= 200 && status < 300,
        headers: {get: name => response.headers[name.toLowerCase()]},
        arrayBuffer: () => arrayBuffer(response), json: () => json(response),
      });
    });
    request.once('error', reject);
    request.end(body);
  });
}

export function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function isDuration(value) {
  return Number.isFinite(value) && value >= 0;
}

function summarize(values) {
  return {
    sampleCount: values.length,
    p50Ms: values.length ? percentile(values, .5) : null,
    p95Ms: values.length ? percentile(values, .95) : null,
  };
}

// Sort object keys recursively while preserving array order and JSON value types.
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function scenarioFingerprint(key, {machine, origin, warmups}, {id, operation, search, resultIndex}) {
  return createHmac('sha256', key).update(canonicalJson({
    contract: 'netunim-document-measurement-v2', machine, origin, warmups, id, operation,
    search: search ?? {}, resultIndex: previewOperations.has(operation) ? resultIndex ?? 0 : null,
  })).digest('hex');
}

export function compareReports(current, baseline) {
  if (current.machine !== baseline.machine) throw Error('baseline_machine_mismatch');
  if (current.schema !== 2 || baseline.schema !== 2) throw Error('baseline_schema_mismatch');
  const previousRows = new Map(baseline.scenarios.map(row => [row.id, row]));
  const currentIds = new Set(current.scenarios.map(row => row.id));
  if (previousRows.size !== baseline.scenarios.length || currentIds.size !== current.scenarios.length) {
    throw Error('baseline_duplicate_scenario');
  }
  return current.scenarios.map(row => {
    const previous = previousRows.get(row.id);
    if (!previous || previousRows.size !== currentIds.size) throw Error('baseline_scenario_set_mismatch');
    if (row.operation !== previous.operation || !digest.test(row.fingerprint) || row.fingerprint !== previous.fingerprint) {
      throw Error('baseline_scenario_changed');
    }
    for (const [sample, report] of [[row, current], [previous, baseline]]) {
      if (!Number.isSafeInteger(sample.sampleCount) || sample.sampleCount < minimumSamples ||
          sample.sampleCount !== sample.attempts || sample.sampleCount !== report.repetitions ||
          sample.warmupOutcomes?.complete !== report.warmups || !isDuration(sample.p95Ms) || sample.p95Ms === 0) {
        throw Error('baseline_insufficient_complete_samples');
      }
    }
    const ratio = row.p95Ms / previous.p95Ms;
    return {id: row.id, p95Ratio: ratio, reviewRequired: ratio > 1.2};
  });
}

function responseTimings(response, payload) {
  const timings = {};
  for (const key of searchPhases) {
    const value = payload?.timings?.[key];
    if (isDuration(value)) timings[key] = value;
  }
  const header = response.headers.get('Server-Timing') || '';
  for (const metric of ['bridge', 'operation']) {
    // The Bridge emits these two metrics with an unquoted decimal duration.
    // Unknown names/descriptions never become report keys or values.
    const expression = new RegExp('(?:^|,)\\s*' + metric + '\\s*;\\s*dur\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*(?=,|$)', 'g');
    const matches = [...header.matchAll(expression)];
    const value = matches.length === 1 ? Number(matches[0][1]) : NaN;
    if (isDuration(value)) timings[metric + 'Ms'] = value;
  }
  return timings;
}

function classifySamples(samples) {
  const counts = {complete: 0, partial: 0, failed: 0, timedOut: 0, cancelled: 0};
  for (const sample of samples) counts[sample.outcome]++;
  return counts;
}

// Only fixed loopback read routes are used. Reports keep an opaque HMAC and
// numeric summaries. Bodies, selected IDs and credentials stay in memory.
export async function measurePlan(plan, {token, fingerprintKey, port = 8766, fetchRequest = requestDirectly, signal} = {}) {
  if (!/^computer-[1-3]$/.test(plan.machine) || !Array.isArray(plan.scenarios) ||
      !plan.scenarios.length || plan.scenarios.length > 50) throw Error('invalid_measurement_plan');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || !token) throw Error('invalid_loopback_configuration');
  const repetitions = plan.repetitions ?? minimumSamples;
  const warmups = plan.warmups ?? 3;
  if (!Number.isSafeInteger(repetitions) || repetitions < minimumSamples || repetitions > 200 ||
      !Number.isSafeInteger(warmups) || warmups < 0 || warmups > 10) throw Error('invalid_repetitions');
  if (typeof plan.origin !== 'string' || new URL(plan.origin).origin !== plan.origin ||
      !/^https?:/.test(plan.origin)) throw Error('invalid_origin');
  const ids = new Set();
  for (const scenario of plan.scenarios) {
    if (!scenario || typeof scenario.id !== 'string' || !caseId.test(scenario.id) ||
        ids.has(scenario.id) || !operations.has(scenario.operation)) throw Error('invalid_scenario');
    if (scenario.search != null && (typeof scenario.search !== 'object' || Array.isArray(scenario.search))) throw Error('invalid_scenario_body');
    if (scenario.resultIndex != null && (!previewOperations.has(scenario.operation) ||
        !Number.isSafeInteger(scenario.resultIndex) || scenario.resultIndex < 0)) throw Error('invalid_result_index');
    ids.add(scenario.id);
  }
  if (!Buffer.isBuffer(fingerprintKey) || fingerprintKey.length !== 32) throw Error('invalid_fingerprint_key');

  const base = 'http://127.0.0.1:' + port;
  async function request(route, body, {binary = false, keepSelection = false} = {}) {
    const started = performance.now();
    const timeout = AbortSignal.timeout(35000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let status = 0;
    try {
      requestSignal.throwIfAborted();
      const response = await fetchRequest(base + route, {
        method: 'POST', redirect: 'error', signal: requestSignal,
        headers: {Origin: plan.origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      status = response.status;
      const payload = binary && response.ok ? await response.arrayBuffer() : await response.json();
      requestSignal.throwIfAborted();
      const outcome = status !== 200 || (!binary && payload?.ok !== true)
        ? 'failed' : payload?.partial === true ? 'partial' : 'complete';
      return {
        wallMs: performance.now() - started, status, outcome, timings: responseTimings(response, payload),
        ...(keepSelection ? {payload} : {}),
      };
    } catch {
      const outcome = !requestSignal.aborted ? 'failed' : requestSignal.reason === timeout.reason ? 'timedOut' : 'cancelled';
      return {wallMs: performance.now() - started, status, outcome, timings: {}};
    }
  }

  const report = {schema: 2, machine: plan.machine, measuredAt: new Date().toISOString(), repetitions, warmups, scenarios: []};
  for (const scenario of plan.scenarios) {
    const {id, operation} = scenario;
    const fingerprint = scenarioFingerprint(fingerprintKey, {...plan, warmups}, scenario);
    const route = operations.get(operation);
    let body = scenario.search ?? {};
    if (previewOperations.has(operation)) {
      const selection = await request(operations.get('search'), body, {keepSelection: true});
      const selected = selection.outcome === 'complete' ? selection.payload?.results?.[scenario.resultIndex ?? 0] : null;
      if (!selected?.id) {
        report.scenarios.push({
          id, operation, fingerprint, selectionOutcome: selection.outcome === 'complete' ? 'noResult' : selection.outcome,
          selectionStatus: selection.status, attempts: 0, outcomes: classifySamples([]),
          warmupOutcomes: classifySamples([]), ...summarize([]), phases: {},
        });
        if (signal?.aborted) break;
        continue;
      }
      body = {id: selected.id};
    }
    const options = {binary: operation === 'binary'};
    const first = await request(route, body, options);
    const warmupSamples = [];
    for (let i = 0; i < warmups && !signal?.aborted; i++) warmupSamples.push(await request(route, body, options));
    const samples = [];
    for (let i = 0; i < repetitions && !signal?.aborted; i++) samples.push(await request(route, body, options));
    const complete = samples.filter(sample => sample.outcome === 'complete');
    const phases = {};
    for (const key of ['bridgeMs', 'operationMs', ...searchPhases]) {
      const values = complete.map(sample => sample.timings[key]).filter(isDuration);
      if (values.length) phases[key] = summarize(values);
    }
    report.scenarios.push({
      id, operation, fingerprint,
      firstRequestMs: first.wallMs, firstStatus: first.status, firstOutcome: first.outcome, firstTimings: first.timings,
      attempts: samples.length, outcomes: classifySamples(samples), warmupOutcomes: classifySamples(warmupSamples),
      ...summarize(complete.map(sample => sample.wallMs)), phases,
    });
    if (signal?.aborted) break;
  }
  report.cancelled = signal?.aborted === true;
  return report;
}

async function loadFingerprintKey(root) {
  // A distinct random per-machine secret lets existing baselines survive a
  // Bridge re-pair. Existing bytes are never overwritten or silently regenerated.
  const file = path.join(root, 'measurement-hmac.key');
  try {
    await fs.writeFile(file, randomBytes(32), {flag: 'wx', mode: 0o600});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return fs.readFile(file);
}

async function main() {
  const [planFile, outputFile, baselineFile] = process.argv.slice(2);
  if (!planFile || !outputFile) throw Error('usage');
  const root = bridgeDataRoot();
  const plan = JSON.parse(await fs.readFile(planFile, 'utf8'));
  const token = (await fs.readFile(path.join(root, 'bridge-token.txt'), 'utf8')).trim();
  const fingerprintKey = await loadFingerprintKey(root);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  let report;
  try {
    report = await measurePlan(plan, {token, fingerprintKey, signal: controller.signal});
  } finally {
    process.off('SIGINT', cancel);
  }
  if (baselineFile) {
    const baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
    try {
      report.comparison = compareReports(report, baseline);
    } catch (error) {
      // Only the fixed comparison reason is printed. Never print plan/file errors.
      if (!/^baseline_[a-z_]+$/.test(error.message)) throw error;
      report.comparisonError = error.message;
      console.error('Baseline comparison refused: ' + report.comparisonError);
    }
  }
  await fs.writeFile(outputFile, JSON.stringify(report, null, 2) + '\n', {encoding: 'utf8', flag: 'wx', mode: 0o600});
  console.log('Saved timings and counts for ' + report.scenarios.length + ' scenarios.');
  if (report.cancelled || report.scenarios.some(row => row.sampleCount !== report.repetitions || row.firstOutcome !== 'complete' ||
      row.warmupOutcomes.complete !== report.warmups) || report.comparisonError ||
      report.comparison?.some(row => row.reviewRequired)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Measurement failed. Check the plan, local pairing, output path and Bridge status. Use a new output filename.');
    process.exitCode = 1;
  });
}
