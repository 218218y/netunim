// @ts-check

/** @typedef {{[key: string]: unknown}} MaintenanceData
 * @typedef {(message: unknown) => void} MessageListener
 * @typedef {(error: Error) => void} ErrorListener
 * @typedef {(code: number | null, signal: string | null) => void} CloseListener
 * @typedef {{pid?: number, connected: boolean,
 * on: {(event: 'message', listener: MessageListener): unknown; (event: 'error', listener: ErrorListener): unknown; (event: 'close', listener: CloseListener): unknown},
 * removeListener: {(event: 'message', listener: MessageListener): unknown; (event: 'error', listener: ErrorListener): unknown; (event: 'close', listener: CloseListener): unknown}}} MaintenanceChild
 * @typedef {{running: boolean, stopRequested: boolean, phase: string, progress: MaintenanceData | null,
 * result: MaintenanceData | null, error: string, startedAt: string, finishedAt: string}} MaintenanceRun
 * @typedef {{child: MaintenanceChild, run: MaintenanceRun, closed: Promise<void>, stopping: Promise<void> | null}} MaintenanceScope
 * @typedef {{host: {isHeld: () => Promise<boolean>, launch: () => MaintenanceChild, requestStop: (child: MaintenanceChild) => Promise<void>},
 * timers: {setTimeout: (callback: () => void, ms: number) => unknown, clearTimeout: (handle: unknown) => void},
 * now: () => string, log: (message: string) => Promise<unknown>}} MaintenancePorts
 */
/** @param {unknown} value @returns {value is MaintenanceData} */
const data = value => !!value && typeof value === 'object' && !Array.isArray(value);
const disposedError = () => Object.assign(new Error('PDF maintenance owner is shutting down.'), {code: 'PDF_MAINTENANCE_DISPOSED'});

/** @param {MaintenancePorts} ports @param {{drainTimeoutMs?: number}} [options] */
export function createMaintenanceProcessOwner({host, timers, now, log}, {drainTimeoutMs = 2000} = {}) {
  if ([host?.isHeld, host?.launch, host?.requestStop, timers?.setTimeout, timers?.clearTimeout, now, log].some(port => typeof port !== 'function') ||
      !Number.isFinite(drainTimeoutMs) || drainTimeoutMs <= 0) throw new Error('maintenance_process_ports_required');
  /** @type {MaintenanceScope | null} */ let active = null;
  /** @type {Promise<void> | null} */ let starting = null;
  /** @type {Promise<void> | null} */ let disposing = null;
  let disposed = false;
  /** @param {string} message */
  function diagnostic(message) { try { void log(message).catch(() => {}); } catch {} }
  /** @param {MaintenanceChild} child */
  function bind(child) {
    /** @type {() => void} */ let resolveClosed = () => {};
    /** @type {Promise<void>} */ const closed = new Promise(resolve => { resolveClosed = resolve; });
    /** @type {MaintenanceScope} */
    const scope = {child, closed, stopping: null, run: {running: true, stopRequested: false, phase: 'starting', progress: null,
      result: null, error: '', startedAt: now(), finishedAt: ''}};
    /** @type {MessageListener} */
    const onMessage = message => {
      if (active !== scope || !scope.run.running || !data(message)) return;
      if (message.type === 'pdf-maintenance-progress' && data(message.progress)) {
        scope.run.progress = message.progress;
        if (!scope.run.stopRequested) scope.run.phase = typeof message.progress.phase === 'string' ? message.progress.phase : 'scan';
      }
      if (message.type === 'pdf-maintenance-result' && data(message.result)) {
        scope.run.result = message.result; scope.run.phase = message.result.aborted ? 'stopped' : 'finished';
      }
    };
    /** @type {ErrorListener} */
    const onError = error => { if (scope.run.running) scope.run.error = String(error.message || error); };
    /** @type {CloseListener} */
    const onClose = (code, signal) => {
      if (!scope.run.running) return;
      scope.run.running = false; scope.run.finishedAt = now();
      if (!scope.run.error && (code !== 0 || !scope.run.result)) scope.run.error = code !== 0 ?
        `עדכון אינדקס PDF נכשל (${signal || code}).` : 'עובד אינדקס PDF הסתיים ללא אישור תוצאה. יש לבדוק את מצב האינדקס.';
      if (scope.run.error) scope.run.phase = 'failed';
      child.removeListener('message', onMessage); child.removeListener('error', onError); child.removeListener('close', onClose);
      resolveClosed();
    };
    child.on('message', onMessage); child.on('error', onError); child.on('close', onClose);
    return scope;
  }
  function view() {
    if (!active) return {manual: null, cancelable: false};
    const run = active.run;
    return {manual: {...run}, cancelable: run.running && !run.stopRequested && active.child.connected};
  }
  async function start() {
    if (disposed) throw disposedError();
    if (starting) return starting;
    if (active?.run.running) return;
    const task = (async () => {
      const held = await host.isHeld();
      if (disposed) throw disposedError();
      if (held) return;
      const scope = bind(host.launch()); active = scope;
      diagnostic(`PDF_FORM_INDEX_MANUAL_START pid=${scope.child.pid || 0}`);
    })();
    starting = task;
    try { await task; } finally { if (starting === task) starting = null; }
  }
  /** @param {MaintenanceScope} scope */
  async function stopScope(scope) {
    if (!scope.run.running || scope.run.stopRequested) return;
    if (scope.stopping) return scope.stopping;
    const task = Promise.resolve().then(async () => {
      if (!scope.run.running) return;
      await host.requestStop(scope.child);
      if (!scope.run.running || active !== scope) return;
      scope.run.stopRequested = true; scope.run.phase = 'stopping';
      diagnostic(`PDF_FORM_INDEX_MANUAL_STOP_REQUESTED pid=${scope.child.pid || 0}`);
    });
    scope.stopping = task;
    try { await task; } finally { if (scope.stopping === task) scope.stopping = null; }
  }
  async function stop() { if (active) await stopScope(active); }
  async function dispose() {
    disposed = true;
    if (disposing) return disposing;
    const task = (async () => {
      const work = (async () => {
        if (starting) try { await starting; } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'PDF_MAINTENANCE_DISPOSED') throw error; }
        const scope = active;
        if (scope?.run.running) { await stopScope(scope); await scope.closed; }
      })();
      /** @type {unknown} */ let timer;
      try { await Promise.race([work, new Promise((_, reject) => {
        timer = timers.setTimeout(() => reject(Object.assign(new Error('PDF maintenance has not drained; the worker was retained.'), {code: 'PDF_MAINTENANCE_DRAIN_TIMEOUT'})), drainTimeoutMs);
      })]); } finally { timers.clearTimeout(timer); }
    })();
    disposing = task;
    try { await task; } finally { if (disposing === task) disposing = null; }
  }
  return {start, stop, dispose, view};
}

/** @typedef {{subscribe: (listener: MessageListener) => () => void, requestStop: () => void, disconnect: () => void}} MaintenanceWorkerPorts */
/** @template T @param {MaintenanceWorkerPorts} ports @param {() => Promise<T>} work @returns {Promise<T>} */
export async function runMaintenanceWorker({subscribe, requestStop, disconnect}, work) {
  const unsubscribe = subscribe(message => { if (data(message) && message.type === 'stop-pdf-maintenance') requestStop(); });
  try { return await work(); } finally { try { unsubscribe(); } finally { disconnect(); } }
}
