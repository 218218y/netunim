// @ts-check
import { createInstalledBrowserLocator } from '../../netunim-kupa/bank-bridge/browser-locator.mjs';
import {
  createFileTaskOwner,
  joinFileAttempts,
} from '../../netunim-kupa/bank-bridge/file-task-owner.mjs';

const platform = {
  os: 'win32',
  candidates: () => ['fixture-browser'],
  access: async () => {},
  where: async () => 'fixture-browser',
};
const metadata = { read: async () => ({ browserPath: 'fixture-browser' }), write: async () => {} };
const locator = createInstalledBrowserLocator({ platform, metadata });
/** @type {Promise<string>} */
const path = locator.find();
void path;
/** @type {Promise<boolean>} */
// @ts-expect-error Browser discovery returns a path, never a status boolean.
const status = locator.find();
void status;
// @ts-expect-error An OS discovery command must return its stdout as text.
createInstalledBrowserLocator({ platform: { ...platform, where: async () => 42 }, metadata });
// @ts-expect-error Candidate paths cannot contain numeric identifiers.
createInstalledBrowserLocator({ platform: { ...platform, candidates: () => [42] }, metadata });
// @ts-expect-error Remembering a browser is a completed metadata write, not a UI receipt.
createInstalledBrowserLocator({ platform, metadata: { ...metadata, write: async () => 'saved' } });

const files = createFileTaskOwner();
/** @type {Promise<number>} */
const receipt = files.run(async () => 42);
void receipt;
/** @type {Promise<boolean>} */
// @ts-expect-error The file owner preserves each command's result type.
const wrongReceipt = files.run(async () => 42);
void wrongReceipt;
// @ts-expect-error Queue entries must be commands, not already-created promises.
files.run(Promise.resolve(42));
/** @type {Promise<void>} */
const drained = files.drain();
void drained;
/** @type {Promise<number[]>} */
const joined = joinFileAttempts([Promise.resolve(42)]);
void joined;
/** @type {Promise<boolean[]>} */
// @ts-expect-error Joining sibling attempts preserves their result type.
const wrongJoin = joinFileAttempts([Promise.resolve(42)]);
void wrongJoin;
// @ts-expect-error Joining accepts asynchronous attempts, not precomputed status values.
joinFileAttempts([42]);
