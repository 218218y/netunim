import {createFileLockOwner} from '../netunim-orders/document-bridge/file-lock-owner.mjs';
export function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
export function fixture() {
  const directories = new Map(), live = new Set([11]); let now = 0, token = 0;
  const ports = {
    files: {
      create: async path => { if (directories.has(path)) return false; directories.set(path, null); return true; },
      observe: async path => !directories.has(path) ? {kind: 'absent'} : directories.get(path) === null ? {kind: 'unknown'} : {kind: 'owner', owner: {...directories.get(path)}},
      writeOwner: async (path, owner) => { if (!directories.has(path) || directories.get(path)) throw new Error('owner already exists'); directories.set(path, {...owner}); },
      removeOwner: async path => { if (!directories.get(path)) return false; directories.set(path, null); return true; },
      removeDirectory: async path => { if (!directories.has(path) || directories.get(path) !== null) return false; directories.delete(path); return true; },
    },
    owners: {next: () => ({pid: 11, token: `scope-${++token}`, startedAt: `start-${token}`}), alive: async pid => live.has(pid)},
    clock: () => now, wait: async ms => { now += ms; },
  };
  return {ports, owner: createFileLockOwner(ports), directories, live};
}
