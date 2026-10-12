import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function createFileLockPlatform({root}) {
  const absoluteRoot = path.resolve(root);
  function target(value) {
    const resolved = path.resolve(value), relative = path.relative(absoluteRoot, resolved);
    if (!relative || path.dirname(resolved) !== absoluteRoot || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Object.assign(new Error('File lock path escapes its application root'), {code: 'FILE_LOCK_PATH_UNSAFE'});
    return resolved;
  }
  async function observe(value) {
    const directory = target(value); let stat;
    try { stat = await fs.lstat(directory); } catch (error) { if (error.code === 'ENOENT') return {kind: 'absent'}; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error('File lock must be an owned directory'), {code: 'FILE_LOCK_PATH_UNSAFE'});
    const ownerPath = path.join(directory, 'owner.json');
    try { const ownerStat = await fs.lstat(ownerPath); if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) return {kind: 'unknown'}; }
    catch (error) { if (error.code === 'ENOENT') return {kind: 'unknown'}; throw error; }
    let text; try { text = await fs.readFile(ownerPath, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return {kind: 'unknown'}; throw error; }
    let raw; try { raw = JSON.parse(text); } catch { return {kind: 'unknown'}; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !['number', 'string'].includes(typeof raw.pid)) return {kind: 'unknown'};
    const pid = Number(raw.pid), token = raw.token ?? null, startedAt = raw.startedAt ?? null;
    if (!Number.isSafeInteger(pid) || pid < 1 || (token !== null && (typeof token !== 'string' || !token)) || (startedAt !== null && typeof startedAt !== 'string')) return {kind: 'unknown'};
    return {kind: 'owner', owner: {pid, token, startedAt}};
  }
  return {
    files: {
      async create(value) {
        const directory = target(value); await fs.mkdir(absoluteRoot, {recursive: true});
        try { await fs.mkdir(directory); return true; } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
      }, observe,
      writeOwner: (value, owner) => fs.writeFile(path.join(target(value), 'owner.json'), JSON.stringify(owner), {encoding: 'utf8', flag: 'wx', mode: 0o600}),
      async removeOwner(value) {
        try { await fs.unlink(path.join(target(value), 'owner.json')); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      },
      async removeDirectory(value) {
        try { await fs.rmdir(target(value)); return true; } catch (error) { if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) return false; throw error; }
      },
    },
    owners: {
      next: () => ({pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString()}),
      async alive(pid) {
        try { process.kill(pid, 0); return true; } catch (error) {
          if (error.code === 'EPERM') return true;
          if (error.code === 'ESRCH') return false;
          throw error;
        }
      },
    },
  };
}
