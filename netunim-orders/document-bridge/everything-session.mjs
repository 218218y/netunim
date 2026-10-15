// @ts-check
/** @typedef {{everythingInstance:string, everythingExecutable:string,searchTimeoutMs:number,allowedOrigins:string[]}} EverythingConfig
 * @typedef {{at:number,esPath:string,esVersion:string,everythingVersion:string,instance:string,startedByBridge:boolean,everythingExecutable?:string}} EverythingProbe
 * @typedef {{fresh?:boolean,autoStart?:boolean}} ProbeOptions
 * @typedef {{configuration:{load:()=>Promise<EverythingConfig>,save:(config:EverythingConfig)=>Promise<void>},
 * discovery:{es:()=>Promise<string>,executable:(config:EverythingConfig)=>Promise<string>},
 * process:{run:(file:string,args:string[],options:{timeout:number})=>Promise<{stdout:string}>,start:(file:string,args:string[])=>Promise<void>},
 * runtime:{now:()=>number,wait:(ms:number)=>Promise<void>},audit:{write:(message:string)=>Promise<void>}}} SessionPorts
 * @typedef {{probe:(options?:ProbeOptions)=>Promise<EverythingProbe>,invalidate:()=>void,dispose:()=>Promise<void>}} EverythingSession
 */
/** @param {unknown} error @param {string} key @returns {unknown} */
function errorField(error, key) {
  return error && typeof error === 'object'
    ? Reflect.get(error, key)
    : undefined;
}
/** @param {SessionPorts} ports @returns {EverythingSession} */
export function createEverythingSession({
  configuration,
  discovery,
  process: host,
  runtime,
  audit
}) {
  let disposed = false;
  /** @type {EverythingProbe|null} */ let cachedProbe = null;
  /** @type {Promise<EverythingProbe>|null} */ let everythingProbePromise = null;
  /** @type {Promise<EverythingProbe>|null} */ let everythingStartPromise = null;
  /** @type {Set<Promise<void>>} */ const pending = new Set();
  function assertActive() {
    if (disposed)
      throw Object.assign(new Error('Everything session is closing.'), {
        code: 'EVERYTHING_SESSION_DISPOSED'
      });
  }
  /** @template Value @param {Promise<Value>} task @returns {Promise<Value>} */
  function track(task) {
    const settled = task.then(
      () => {},
      () => {}
    );
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
    return task;
  }
  /** @param {string} file @param {string[]} args @param {{timeout:number}} options */
  function runEs(file, args, options) {
    assertActive();
    return track(
      Promise.resolve().then(() => {
        assertActive();
        return host.run(file, args, options);
      })
    );
  }
  /** @param {string} instance */
  function instanceArgs(instance) {
    return instance ? ['-instance', instance] : [];
  }
  /** @param {EverythingConfig} config */
  function instanceCandidates(config) {
    return [
      ...new Set(
        [config.everythingInstance, '', '1.5a'].filter(
          value => value !== undefined && value !== null
        )
      )
    ];
  }
  /** @param {EverythingConfig} config @param {string} esPath @returns {Promise<EverythingProbe>} */
  async function probeRunningInstances(config, esPath) {
    let esVersion = '';
    try {
      esVersion = (
        await runEs(esPath, ['-version'], { timeout: 3000 })
      ).stdout.trim();
    } catch {}
    assertActive();
    /** @param {string} instance @returns {Promise<EverythingProbe>} */
    const probeOne = async instance => {
      const { stdout } = await runEs(
        esPath,
        [
          '-ipc3',
          ...instanceArgs(instance),
          '-timeout',
          '3000',
          '-get-everything-version'
        ],
        { timeout: 4500 }
      );
      assertActive();
      return {
        at: runtime.now(),
        esPath,
        esVersion,
        everythingVersion: stdout.trim(),
        instance,
        startedByBridge: false
      };
    };
    const preferred = String(config.everythingInstance || '').trim();
    if (preferred) {
      try {
        return await probeOne(preferred);
      } catch {}
    }
    assertActive();
    const candidates = instanceCandidates(config).filter(
      instance => !preferred || instance !== preferred
    );
    try {
      return await Promise.any(candidates.map(instance => probeOne(instance)));
    } catch (aggregate) {
      assertActive();
      const values = errorField(aggregate, 'errors'),
        errors = Array.isArray(values) ? values : [];
      const onlyNotRunning =
        errors.length > 0 &&
        errors.every(error => errorField(error, 'exitCode') === 8);
      throw Object.assign(
        new Error(
          onlyNotRunning
            ? 'Everything אינו פועל כרגע.'
            : 'לא ניתן להתחבר ל-Everything המקומי.'
        ),
        {
          code: onlyNotRunning
            ? 'EVERYTHING_NOT_RUNNING'
            : 'EVERYTHING_UNAVAILABLE',
          cause: errors.at(-1) || aggregate
        }
      );
    }
  }
  /** @param {EverythingConfig} config @param {string} esPath @param {number} [timeoutMs] @returns {Promise<EverythingProbe>} */
  async function waitForEverything(config, esPath, timeoutMs = 15000) {
    const deadline = runtime.now() + timeoutMs,
      lastErrors = [];
    while (runtime.now() < deadline) {
      assertActive();
      try {
        return await probeRunningInstances(config, esPath);
      } catch (error) {
        assertActive();
        lastErrors.push(error);
        await runtime.wait(250);
      }
    }
    throw Object.assign(
      new Error('Everything הופעל ברקע אך לא היה מוכן לחיפוש בזמן.'),
      { code: 'EVERYTHING_START_TIMEOUT', cause: lastErrors.at(-1) }
    );
  }
  /** @param {EverythingConfig} config @param {string} esPath @returns {Promise<EverythingProbe>} */
  async function startEverythingBackground(config, esPath) {
    if (everythingStartPromise) return everythingStartPromise;
    everythingStartPromise = (async () => {
      const executable = await discovery.executable(config);
      assertActive();
      const instance =
        config.everythingInstance || (/1\.5a/i.test(executable) ? '1.5a' : '');
      const args = [...instanceArgs(instance), '-startup', '-first-instance'];
      await audit.write(
        `EVERYTHING_START exe=${executable} instance=${instance || '(default)'}`
      );
      assertActive();
      await host.start(executable, args);
      assertActive();
      const probe = await waitForEverything(
        { ...config, everythingInstance: instance },
        esPath,
        15000
      );
      assertActive();
      const latest = await configuration.load();
      assertActive();
      if (
        latest.everythingExecutable !== executable ||
        latest.everythingInstance !== probe.instance
      ) {
        latest.everythingExecutable = executable;
        latest.everythingInstance = probe.instance;
        await configuration.save(latest);
        assertActive();
      }
      return {
        ...probe,
        startedByBridge: true,
        everythingExecutable: executable
      };
    })();
    try {
      return await everythingStartPromise;
    } finally {
      everythingStartPromise = null;
    }
  }
  /** @param {ProbeOptions} [options] @returns {Promise<EverythingProbe>} */
  async function probeEverything({ fresh = false, autoStart = true } = {}) {
    assertActive();
    if (!fresh && cachedProbe && runtime.now() - cachedProbe.at < 30000)
      return cachedProbe;
    if (everythingProbePromise) return everythingProbePromise;
    const task = track(
      (async () => {
        const config = await configuration.load();
        assertActive();
        const esPath = await discovery.es();
        assertActive();
        let probe;
        try {
          probe = await probeRunningInstances(config, esPath);
        } catch (error) {
          assertActive();
          if (
            errorField(error, 'code') !== 'EVERYTHING_NOT_RUNNING' ||
            !autoStart
          )
            throw error;
          probe = await startEverythingBackground(config, esPath);
        }
        assertActive();
        cachedProbe = probe;
        if (config.everythingInstance !== probe.instance) {
          config.everythingInstance = probe.instance;
          await configuration.save(config);
          assertActive();
        }
        return cachedProbe;
      })()
    );
    everythingProbePromise = task;
    try {
      return await task;
    } finally {
      if (everythingProbePromise === task) everythingProbePromise = null;
    }
  }
  function invalidate() {
    cachedProbe = null;
  }
  async function dispose() {
    disposed = true;
    cachedProbe = null;
    await Promise.all([...pending]);
  }
  return { probe: probeEverything, invalidate, dispose };
}
