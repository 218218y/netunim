// @ts-check
/** @typedef {{stdout:string,stderr?:string}} ProcessOutput
 * @typedef {{timeout?:number,signal?:AbortSignal|null}} EsOptions
 * @typedef {{commands:{execute:(file:string,args:string[],options:{kind:'es'|'command',timeout:number,signal:AbortSignal|null})=>Promise<ProcessOutput>,
 * launch:(file:string,args:string[])=>Promise<void>}}} ProcessPorts
 * @typedef {{es:(file:string,args:string[],options?:EsOptions)=>Promise<ProcessOutput>,
 * command:(file:string,args:string[],timeout?:number)=>Promise<ProcessOutput>,start:(file:string,args:string[])=>Promise<void>,dispose:()=>Promise<void>}} EverythingProcess
 */
/** @param {unknown} error @param {string} key @returns {unknown} */
function errorField(error, key) {
  return error && typeof error === 'object'
    ? Reflect.get(error, key)
    : undefined;
}
/** @param {ProcessPorts} ports @returns {EverythingProcess} */
export function createEverythingProcess({ commands }) {
  let disposed = false;
  /** @type {Set<Promise<void>>} */ const pending = new Set();
  /** @template Value @param {()=>Promise<Value>} work @returns {Promise<Value>} */
  function accept(work) {
    const task = Promise.resolve().then(() => {
        if (disposed)
          throw Object.assign(
            new Error('Everything process owner is closing.'),
            { code: 'EVERYTHING_PROCESS_DISPOSED' }
          );
        return work();
      }),
      settled = task.then(
        () => {},
        () => {}
      );
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
    return task;
  }
  /** @param {string} file @param {string[]} args @param {EsOptions} [options] @returns {Promise<ProcessOutput>} */
  async function runEs(file, args, { timeout = 18000, signal = null } = {}) {
    try {
      return await accept(() =>
        commands.execute(file, args, { kind: 'es', timeout, signal })
      );
    } catch (error) {
      if (
        errorField(error, 'code') === 'EVERYTHING_PROCESS_DISPOSED' ||
        errorField(error, 'name') === 'AbortError' ||
        String(errorField(error, 'code') || '') === 'ABORT_ERR'
      )
        throw error;
      // execFile reports timeout termination with code:null. Number(null) is
      // zero, which must never turn that failure into an ES_EXIT_0 diagnostic.
      if (errorField(error, 'code') == null && errorField(error, 'killed') === true && errorField(error, 'signal')) {
        throw Object.assign(new Error('Everything did not finish before the search deadline.'), {code:'ES_TIMEOUT'});
      }
      const code = Number(errorField(error, 'code')),
        stderr = errorField(error, 'stderr');
      throw Object.assign(
        new Error(
          String(
            stderr || errorField(error, 'message') || 'ES failed'
          ).trim() || 'ES failed'
        ),
        {
          code: `ES_EXIT_${Number.isFinite(code) ? code : 'ERROR'}`,
          exitCode: code,
          stderr: String(stderr || '')
        }
      );
    }
  }
  async function dispose() {
    disposed = true;
    await Promise.all([...pending]);
  }
  return {
    es: runEs,
    command: (file, args, timeout = 3000) =>
      accept(() =>
        commands.execute(file, args, { kind: 'command', timeout, signal: null })
      ),
    start: (file, args) => accept(() => commands.launch(file, args)),
    dispose
  };
}
