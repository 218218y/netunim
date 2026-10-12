import fs from 'node:fs/promises';
import path from 'node:path';
import {createFileLockOwner} from '../../netunim-orders/document-bridge/file-lock-owner.mjs';
import {createFileLockPlatform} from '../../netunim-orders/document-bridge/file-lock-platform.mjs';
const [root, label, waitMs] = process.argv.slice(2);
const released = new Promise(resolve => process.once('message', message => { if (message === 'release') resolve(); }));
const send = value => new Promise(resolve => process.send(value, resolve));
const locks = createFileLockOwner({...createFileLockPlatform({root}), clock: () => performance.now(), wait: ms => new Promise(resolve => setTimeout(resolve, ms))});
try {
  await locks.run(path.join(root, 'index.lock'), async () => {
    await fs.appendFile(path.join(root, 'effects.txt'), label + '\n');
    await send({kind: 'entered', label}); await released;
  }, {waitMs: Number(waitMs)});
  await send({kind: 'done', label});
} catch (error) { await send({kind: 'failed', code: error.code}); process.exitCode = 1; }
if (process.connected) process.disconnect();
