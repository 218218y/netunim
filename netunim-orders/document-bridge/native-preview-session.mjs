// @ts-check

/**
 * @typedef {(chunk: string) => void} DataListener
 * @typedef {{setEncoding: (encoding: string) => unknown,
 * on: (event: 'data', listener: DataListener) => unknown,
 * removeListener: (event: 'data', listener: DataListener) => unknown}} PreviewOutput
 * @typedef {(error: Error) => void} ErrorListener
 * @typedef {(code: number | null, signal: string | null) => void} ExitListener
 * @typedef {{pid?: number, killed: boolean, exitCode: number | null,
 * stdin: {writable: boolean, write: (text: string, encoding: string,
 * callback: (error?: Error | null) => void) => unknown}, stdout: PreviewOutput, stderr: PreviewOutput,
 * on: { (event: 'error', listener: ErrorListener): unknown;
 * (event: 'exit' | 'close', listener: ExitListener): unknown; },
 * removeListener: { (event: 'error', listener: ErrorListener): unknown;
 * (event: 'exit' | 'close', listener: ExitListener): unknown; }}} PreviewChild
 * @typedef {{host: {prepare: () => Promise<void>, launch: () => PreviewChild,
 * terminate: (child: PreviewChild) => Promise<void>},
 * timers: {setTimeout: (callback: () => void, timeoutMs: number) => unknown,
 * clearTimeout: (handle: unknown) => void}, log: (message: string) => Promise<unknown>}} PreviewSessionPorts
 * @typedef {{resolve: (value: string) => void, reject: (error: unknown) => void, timer: unknown}} PendingCommand
 * @typedef {{child: PreviewChild, buffer: string, closed: boolean,
 * pending: Map<string, PendingCommand>, cleanup: Promise<void> | null, cleanupFailed: boolean,
 * detachOutput: () => void}} ProcessScope
 */

/** @param {string} message @param {string} code */
function previewError(message, code) { return Object.assign(new Error(message), {code}); }

/** @param {PreviewSessionPorts} ports */
export function createNativePreviewSession({host, timers, log}) {
  if ([host?.prepare, host?.launch, host?.terminate, timers?.setTimeout, timers?.clearTimeout, log].some(port => typeof port !== 'function')) {
    throw new Error('native_preview_session_ports_required');
  }
  /** @type {ProcessScope | null} */
  let active = null;
  /** @type {Promise<ProcessScope> | null} */
  let starting = null;
  /** @type {Promise<void> | null} */
  let stopping = null;
  /** @type {{scope: ProcessScope, error: unknown} | null} */
  let cleanupFailure = null;
  let disposed = false, sequence = 0;
  const stoppedError = () => previewError('Windows Preview Handler host is stopped.', 'NATIVE_PREVIEW_HOST_EXITED');
  /** @param {string} message */
  function diagnostic(message) { try { void log(message).catch(() => {}); } catch {} }
  /** @param {ProcessScope} scope @param {unknown} error */
  function rejectPending(scope, error) {
    for (const pending of scope.pending.values()) { timers.clearTimeout(pending.timer); pending.reject(error); }
    scope.pending.clear();
  }
  /** @param {ProcessScope} scope @param {unknown} error */
  function closeScope(scope, error) {
    scope.closed = true;
    scope.detachOutput();
    scope.buffer = '';
    rejectPending(scope, error);
  }
  /** @param {ProcessScope} scope */
  function retire(scope) {
    if (scope.cleanup) return scope.cleanup;
    closeScope(scope, stoppedError());
    const task = host.terminate(scope.child).then(() => {
      if (active === scope) active = null;
    }).catch(error => {
      // A failed termination is authority to stop, never to launch a replacement.
      scope.cleanupFailed = true;
      if (active === scope) cleanupFailure = {scope, error};
      throw error;
    });
    scope.cleanup = task;
    return task;
  }
  /** @param {PreviewChild} child */
  function bind(child) {
    /** @type {ProcessScope} */
    const scope = {child, buffer: '', closed: false, pending: new Map(), cleanup: null, cleanupFailed: false, detachOutput: () => {}};
    /** @type {DataListener} */
    const onData = chunk => {
      if (scope.closed) return;
      scope.buffer += String(chunk || '');
      while (true) {
        const index = scope.buffer.indexOf('\n');
        if (index < 0) break;
        const line = scope.buffer.slice(0, index).replace(/\r$/, '');
        scope.buffer = scope.buffer.slice(index + 1);
        const [id = '', status, ...rest] = line.split('\t'), pending = scope.pending.get(id);
        if (!pending) continue;
        scope.pending.delete(id);
        timers.clearTimeout(pending.timer);
        const message = rest.join('\t');
        if (status === 'OK') pending.resolve(message);
        else pending.reject(previewError(message || 'Windows Preview Handler failed.', 'NATIVE_PREVIEW_FAILED'));
      }
    };
    /** @type {DataListener} */
    const onStderr = chunk => { if (!scope.closed) diagnostic(`NATIVE_PREVIEW_STDERR ${JSON.stringify(String(chunk || '').trim())}`); };
    /** @type {ErrorListener} */
    const onError = error => {
      if (scope.closed) return;
      closeScope(scope, previewError(`Windows Preview Handler host failed: ${error.message}`, 'NATIVE_PREVIEW_HOST_FAILED'));
      void retire(scope).catch(() => diagnostic('NATIVE_PREVIEW_STOP_FAILED'));
    };
    /** @type {ExitListener} */
    const onExit = (code, signal) => {
      closeScope(scope, previewError(`Windows Preview Handler host exited (${code ?? signal ?? 'unknown'}).`, 'NATIVE_PREVIEW_HOST_EXITED'));
      if (active === scope) active = null;
      if (cleanupFailure?.scope === scope) cleanupFailure = null;
    };
    /** @type {ExitListener} */
    const onClose = (code, signal) => {
      onExit(code, signal);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      child.removeListener('close', onClose);
    };
    scope.detachOutput = () => { child.stdout.removeListener('data', onData); child.stderr.removeListener('data', onStderr); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData); child.stderr.on('data', onStderr);
    // Keep the owned error consumer until close, including error/exit ordering.
    child.on('error', onError); child.on('exit', onExit); child.on('close', onClose);
    return scope;
  }
  /** @param {ProcessScope} scope @param {string} command
   * @param {Array<string | number | null | undefined>} args @param {number} timeoutMs */
  function send(scope, command, args, timeoutMs) {
    if (scope.closed || !scope.child.stdin.writable) return Promise.reject(previewError('Windows Preview Handler host is not writable.', 'NATIVE_PREVIEW_HOST_FAILED'));
    const id = String(++sequence), fields = [id, command, ...args.map(value => String(value ?? '').replace(/[\r\n\t]/g, ' '))];
    /** @type {Promise<string>} */
    const result = new Promise((resolve, reject) => {
      /** @param {unknown} error */
      function failed(error) {
        const pending = scope.pending.get(id);
        if (!pending) return;
        scope.pending.delete(id); timers.clearTimeout(pending.timer); reject(error);
      }
      const timer = timers.setTimeout(() => failed(previewError('Windows Preview Handler did not respond in time.', 'NATIVE_PREVIEW_TIMEOUT')), timeoutMs);
      scope.pending.set(id, {resolve, reject, timer});
      try { scope.child.stdin.write(fields.join('\t') + '\n', 'utf8', error => { if (error) failed(error); }); }
      catch (error) { failed(error); }
    });
    return result;
  }
  async function ensure() {
    if (disposed || stopping) throw stoppedError();
    if (cleanupFailure) throw cleanupFailure.error;
    if (starting) return starting;
    if (active && !active.closed && !active.child.killed && active.child.exitCode === null) return active;
    // Starting is captured before the first asynchronous preparation boundary.
    const task = (async () => {
      if (active) await retire(active);
      await host.prepare();
      if (disposed || stopping) throw stoppedError();
      const scope = bind(host.launch()); active = scope;
      try {
        await send(scope, 'PING', [], 4000);
        if (disposed || stopping || scope.closed || active !== scope) throw stoppedError();
        return scope;
      } catch (error) { await retire(scope); throw error; }
    })();
    starting = task;
    try { return await task; } finally { if (starting === task) starting = null; }
  }
  /** @param {string} command @param {Array<string | number | null | undefined>} [args] @param {number} [timeoutMs] */
  async function command(command, args = [], timeoutMs = 6000) {
    const scope = await ensure();
    if (disposed || stopping || scope.closed || active !== scope) throw stoppedError();
    const response = await send(scope, String(command), args, timeoutMs);
    if (disposed || stopping || scope.closed || active !== scope) throw stoppedError();
    return response;
  }
  function stop() {
    if (stopping) return stopping;
    const task = (async () => {
      // Started commands are scoped preview work, not durable business commits.
      // Joining preparation prevents a host from appearing after disposal.
      if (starting) { try { await starting; } catch {} }
      const scope = active;
      if (!scope) { if (cleanupFailure) throw cleanupFailure.error; return; }
      rejectPending(scope, stoppedError());
      if (!scope.closed) { try { await send(scope, 'EXIT', [], 1500); } catch {} }
      // A prior failed cleanup may be retried only by explicit stop/dispose.
      if (scope.cleanupFailed) { scope.cleanup = null; scope.cleanupFailed = false; }
      await retire(scope);
      if (cleanupFailure?.scope === scope) cleanupFailure = null;
    })();
    stopping = task;
    return task.finally(() => { if (stopping === task) stopping = null; });
  }
  function dispose() { disposed = true; return stop(); }
  const isRunning = () => !!active && !active.closed && !active.child.killed && active.child.exitCode === null && !stopping && !disposed;
  return {command, isRunning, stop, dispose};
}
