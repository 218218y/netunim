// @ts-check
/**
 * @typedef {Object} BrowserLocatorPorts
 * @property {{os:string,candidates:()=>readonly string[],access:(path:string)=>Promise<void>,where:(name:string)=>Promise<string>}} platform
 * @property {{read:()=>Promise<{browserPath?:unknown}>,write:(patch:{browserPath:string})=>Promise<void>}} metadata
 */
/** @param {BrowserLocatorPorts} ports */
export function createInstalledBrowserLocator({ platform, metadata }) {
  if (
    typeof platform?.candidates !== 'function' ||
    typeof platform?.access !== 'function' ||
    typeof platform?.where !== 'function' ||
    typeof metadata?.read !== 'function' ||
    typeof metadata?.write !== 'function'
  )
    throw new Error('browser_locator_ports_required');
  let cachedBrowserPath = '';
  const readMeta = metadata.read,
    writeMeta = metadata.write,
    browserCandidates = platform.candidates;
  /** @param {string} candidate */
  async function rememberBrowser(candidate) {
    cachedBrowserPath = candidate;
    await writeMeta({ browserPath: candidate });
    return candidate;
  }

  /** @returns {Promise<string>} */
  async function findInstalledBrowser() {
    if (cachedBrowserPath) return cachedBrowserPath;
    if (platform.os !== 'win32')
      throw Object.assign(new Error('Bank Bridge is intended for Windows'), {
        code: 'WINDOWS_REQUIRED',
      });
    const saved = String((await readMeta()).browserPath || '').trim();
    if (saved) {
      try {
        await platform.access(saved);
        cachedBrowserPath = saved;
        return saved;
      } catch {}
    }
    for (const candidate of browserCandidates()) {
      try {
        await platform.access(candidate);
        return rememberBrowser(candidate);
      } catch {}
    }
    for (const name of ['chrome.exe', 'msedge.exe']) {
      try {
        const output = await platform.where(name);
        const candidate = output
          .split(/\r?\n/)
          .map((x) => x.trim())
          .find(Boolean);
        if (candidate) return rememberBrowser(candidate);
      } catch {}
    }
    throw Object.assign(new Error('לא נמצא Google Chrome או Microsoft Edge מותקן במחשב'), {
      code: 'BROWSER_NOT_FOUND',
    });
  }
  return Object.freeze({ find: findInstalledBrowser });
}
