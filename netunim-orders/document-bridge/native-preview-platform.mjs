import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';

// Concrete Windows effects stay outside the command/session policy. The PID
// helpers are the same bounded process-tree tools used by Bridge shutdown.
export function createNativePreviewHostPlatform({hostPath, applicationRoot, processes, log}) {
  if (!hostPath || !applicationRoot || [processes?.waitForExit, processes?.alive, processes?.forceStopTree, log].some(port => typeof port !== 'function')) {
    throw new Error('native_preview_platform_ports_required');
  }
  async function prepare() {
    if (process.platform !== 'win32') throw Object.assign(new Error('Windows Preview Handler זמין רק ב-Windows.'), {code: 'WINDOWS_REQUIRED'});
    let exists = false;
    try { exists = (await fs.stat(hostPath)).isFile(); } catch {}
    if (!exists) throw Object.assign(new Error('רכיב Windows Preview Handler לא הותקן. הרץ מחדש את מתקין Document Bridge.'), {code: 'NATIVE_PREVIEW_HOST_MISSING'});
  }
  const launch = () => spawn(hostPath, [], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: applicationRoot});
  async function terminate(child) {
    const pid = Number(child.pid) || 0;
    if (!pid) return;
    if (!(await processes.waitForExit(pid, 1200))) {
      try { child.kill(); } catch {}
      await processes.waitForExit(pid, 800);
    }
    if (await processes.alive(pid)) {
      await log(`NATIVE_PREVIEW_FORCE_STOP pid=${pid}`);
      await processes.forceStopTree(pid);
      await processes.waitForExit(pid, 1500);
    }
    if (await processes.alive(pid)) throw Object.assign(new Error('Windows Preview Handler host could not be terminated.'), {code: 'NATIVE_PREVIEW_STOP_FAILED'});
  }
  return {prepare, launch, terminate};
}
