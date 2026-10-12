import {createFileLockOwner} from '../../netunim-orders/document-bridge/file-lock-owner.mjs';
/** @type {import('../../netunim-orders/document-bridge/file-lock-owner.mjs').FileLockPorts} */
const ports = {files: {create: async () => true, observe: async () => ({kind: 'absent'}), writeOwner: async () => {}, removeOwner: async () => true, removeDirectory: async () => true},
  owners: {next: () => ({pid: 11, token: 'unique', startedAt: 'date'}), alive: async () => true}, clock: Date.now, wait: async () => {}};
const locks = createFileLockOwner(ports);
locks.run('index.lock', async () => ({committed: true})).then(result => result.committed);
// @ts-expect-error work settles asynchronously so release waits for started commits
locks.run('index.lock', () => true);
// @ts-expect-error liveness must be confirmed asynchronously as a boolean
createFileLockOwner({...ports, owners: {...ports.owners, alive: () => 'dead'}});
// @ts-expect-error wait budgets are numeric milliseconds
locks.run('index.lock', async () => true, {waitMs: '10000'});
// @ts-expect-error directory observation must discriminate missing/unknown/known ownership
createFileLockOwner({...ports, files: {...ports.files, observe: async () => true}});
// @ts-expect-error expiry cannot authorize live-owner takeover
locks.run('index.lock', async () => true, {staleMs: 1});
