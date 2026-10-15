// @ts-check
/** @typedef {import('./everything-session.mjs').EverythingConfig} EverythingConfig
 * @typedef {{locations:{esCandidates:readonly string[],direct:(config:EverythingConfig)=>string[],registryKeys:readonly string[],known:readonly string[],windows:boolean},
 * files:{exists:(file:string)=>Promise<boolean>},commands:{where:(name:string)=>Promise<string>,registry:(key:string)=>Promise<string>},
 * paths:{executables:(location:string)=>string[]}}} DiscoveryPorts
 * @typedef {{es:()=>Promise<string>,executable:(config:EverythingConfig)=>Promise<string>,dispose:()=>Promise<void>}} EverythingDiscovery
 */
/** @param {DiscoveryPorts} ports @returns {EverythingDiscovery} */
export function createEverythingDiscovery({
  locations,
  files,
  commands,
  paths
}) {
  let cachedEsPath = '',
    disposed = false;
  /** @type {Set<Promise<void>>} */ const pending = new Set();
  function assertActive() {
    if (disposed)
      throw Object.assign(new Error('Everything discovery is closing.'), {
        code: 'EVERYTHING_DISCOVERY_DISPOSED'
      });
  }
  /** @template Value @param {()=>Promise<Value>} work @returns {Promise<Value>} */
  function accept(work) {
    const task = Promise.resolve().then(() => {
        assertActive();
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
  /** @returns {Promise<string>} */
  async function whereEs() {
    if (cachedEsPath) return cachedEsPath;
    for (const candidate of locations.esCandidates) {
      const exists = await files.exists(candidate);
      assertActive();
      if (exists) {
        cachedEsPath = candidate;
        return cachedEsPath;
      }
    }
    if (locations.windows)
      try {
        const stdout = await commands.where('es.exe');
        assertActive();
        const candidate = stdout
          .split(/\r?\n/)
          .map(x => x.trim())
          .find(Boolean);
        if (candidate) {
          cachedEsPath = candidate;
          return cachedEsPath;
        }
      } catch {
        assertActive();
      }
    throw Object.assign(
      new Error('es.exe לא נמצא. יש להריץ מחדש את מתקין Document Bridge.'),
      { code: 'ES_NOT_FOUND' }
    );
  }
  /** @param {EverythingConfig} config @returns {Promise<string>} */
  async function findEverythingExecutable(config) {
    for (const candidate of locations.direct(config)) {
      const exists = await files.exists(candidate);
      assertActive();
      if (exists) return candidate;
    }
    for (const key of locations.registryKeys) {
      const location = await commands.registry(key);
      assertActive();
      for (const candidate of paths.executables(location)) {
        const exists = await files.exists(candidate);
        assertActive();
        if (exists) return candidate;
      }
    }
    for (const candidate of locations.known) {
      const exists = await files.exists(candidate);
      assertActive();
      if (exists) return candidate;
    }
    if (locations.windows)
      for (const name of ['Everything.exe', 'Everything64.exe']) {
        try {
          const stdout = await commands.where(name);
          assertActive();
          for (const candidate of stdout
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(Boolean)) {
            const exists = await files.exists(candidate);
            assertActive();
            if (exists) return candidate;
          }
        } catch {
          assertActive();
        }
      }
    throw Object.assign(
      new Error(
        'Everything מותקן אך לא ניתן לאתר את Everything.exe. התקן את Everything 1.5 באמצעות המתקין הרשמי או הגדר NETUNIM_EVERYTHING_EXE_PATH.'
      ),
      { code: 'EVERYTHING_EXE_NOT_FOUND' }
    );
  }
  async function dispose() {
    disposed = true;
    cachedEsPath = '';
    await Promise.all([...pending]);
  }
  return {
    es: () => accept(whereEs),
    executable: config => accept(() => findEverythingExecutable(config)),
    dispose
  };
}
