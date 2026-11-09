import {AsyncLocalStorage} from 'node:async_hooks';
import {execFile} from 'node:child_process';
import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

export const PAIRING_PROTOCOL = 1;
export const PAIRING_ADMIN_PATH = '/pairing/admin';
export const PAIRING_EXCHANGE_PATH = '/pairing/exchange';
const codePrefix = 'ntp1.';
const keyPrefix = 'ntk1.';
const adminPrefix = 'nta1.';
const lifetimeMs = 120000;
const overlapMs = 7 * 86400000;
const codeFormat = /^ntp1\.[A-Za-z0-9_-]{43}$/;
const keyFormat = /^ntk1\.[A-Za-z0-9_-]{43}$/;
const adminFormat = /^nta1\.[A-Za-z0-9_-]{43}$/;
const hashFormat = /^[0-9a-f]{64}$/;
const idFormat = /^[0-9a-f-]{36}$/;
const maxRecords = 32;
const emptyState = () => ({schema: 1, activatedAt: 0, legacyUntil: 0, records: []});
const failure = (code, status, message) => Object.assign(new Error(message), {code, status});
const rejected = () => failure('UNAUTHORIZED', 401, 'המפתח או קוד ההצמדה שגוי, בוטל או פג.');
const forbidden = () => failure('BRIDGE_CAPABILITY_REQUIRED', 403, 'יש לאשר מקומית הרשאה לפעולה זו במחבר.');
const invalid = () => failure('BRIDGE_PAIRING_INVALID', 400, 'פרטי ההצמדה אינם תקינים.');
const storageError = () => failure('BRIDGE_PAIRING_STORAGE', 503, 'לא ניתן לקרוא או לעדכן את הגדרות ההצמדה המקומיות.');
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = prefix => prefix + randomBytes(32).toString('base64url');

function matches(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validOrigin(origin) {
  if (typeof origin !== 'string' || origin.length > 256) return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
  } catch {
    return false;
  }
}

function decodeState(value, allowed) {
  if (!value || value.schema !== 1 || !Number.isSafeInteger(value.activatedAt) || value.activatedAt < 0 ||
      !Number.isSafeInteger(value.legacyUntil) || value.legacyUntil < 0 || !Array.isArray(value.records) ||
      value.records.length > maxRecords || (value.legacyUntil !== 0 &&
      (!value.activatedAt || value.legacyUntil !== value.activatedAt + overlapMs)) ||
      (!value.activatedAt && value.records.length)) throw storageError();
  const origins = new Set();
  const ids = new Set();
  for (const record of value.records) {
    if (!record || !validOrigin(record.origin) || origins.has(record.origin) ||
        typeof record.id !== 'string' || !idFormat.test(record.id) || ids.has(record.id) ||
        (record.hash !== null && (typeof record.hash !== 'string' || !hashFormat.test(record.hash))) ||
        !Array.isArray(record.permissions) || !record.permissions.length ||
        record.permissions.some(permission => !allowed.has(permission)) ||
        new Set(record.permissions).size !== record.permissions.length) throw storageError();
    origins.add(record.origin);
    ids.add(record.id);
  }
  return value;
}

function pairingDirectory(root) {
  return path.join(root, 'pairing-v1');
}

export function pairingAdminTokenPath(root) {
  return path.join(pairingDirectory(root), 'admin-token.txt');
}

async function prepareDirectory(root) {
  const directory = pairingDirectory(root);
  await fs.mkdir(directory, {mode: 0o700, recursive: true});
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw storageError();
  if (process.platform !== 'win32') {
    await fs.chmod(directory, 0o700);
    return;
  }
  // Windows ignores Unix mode bits. Seal inheritance before creating any key.
  const script = [
    "$ErrorActionPreference='Stop'",
    '$directory=$env:NETUNIM_PAIRING_DIRECTORY',
    '$owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
    '$system=[System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")',
    '$acl=[System.Security.AccessControl.DirectorySecurity]::new()',
    '$acl.SetAccessRuleProtection($true,$false)',
    'foreach($sid in @($owner,$system)){$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,"FullControl","ContainerInherit,ObjectInherit","None","Allow"))}',
    '[System.IO.Directory]::SetAccessControl($directory,$acl)',
  ].join('; ');
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 8000, env: {...process.env, NETUNIM_PAIRING_DIRECTORY: directory},
  });
}

export async function readPairingAdminToken(root) {
  const value = (await fs.readFile(pairingAdminTokenPath(root), 'utf8')).trim();
  if (!adminFormat.test(value)) throw storageError();
  return value;
}

async function initializeAdmin(root) {
  try {
    return await readPairingAdminToken(root);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = secret(adminPrefix);
  try {
    await fs.writeFile(pairingAdminTokenPath(root), token + '\n', {flag: 'wx', mode: 0o600});
    return token;
  } catch (error) {
    if (error.code === 'EEXIST') return readPairingAdminToken(root);
    throw storageError();
  }
}

async function writeAtomic(file, contents) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  let created = false;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  } catch {
    throw storageError();
  } finally {
    if (created) await fs.unlink(temporary).catch(() => {});
  }
}

// The listener is the sole writer. Control requests serialize disk commits, and
// ordinary requests read the latest committed snapshot without filesystem I/O.
export function createScopedPairing({root, permissions, wall = Date.now, tick = () => performance.now()}) {
  const registry = path.join(pairingDirectory(root), 'registry.json');
  const allowed = new Set(permissions);
  const pending = new Map();
  const requestAuthority = new AsyncLocalStorage();
  let state = emptyState();
  let adminToken;
  let loaded = false;
  let closed = false;
  let tail = Promise.resolve();
  let overlapStarted = 0;
  let latestWall = 0;
  let overlapEnded = false;

  async function initialize() {
    await prepareDirectory(root);
    try {
      state = decodeState(JSON.parse(await fs.readFile(registry, 'utf8')), allowed);
    } catch (error) {
      if (error.code !== 'ENOENT') throw storageError();
      // A missing registry after initialization must not restore legacy access.
      await fs.lstat(pairingAdminTokenPath(root)).then(
        () => { throw storageError(); },
        missing => { if (missing.code !== 'ENOENT') throw storageError(); },
      );
      await writeAtomic(registry, JSON.stringify(state) + '\n');
    }
    adminToken = await initializeAdmin(root);
    overlapStarted = tick();
    loaded = true;
  }

  function legacyAvailable() {
    if (!state.activatedAt) return true;
    const current = wall();
    if (current < latestWall || current < state.activatedAt || current >= state.legacyUntil ||
        tick() - overlapStarted >= overlapMs) overlapEnded = true;
    latestWall = Math.max(latestWall, current);
    return !overlapEnded;
  }

  function mode() {
    if (!state.activatedAt) return 'legacy';
    return legacyAvailable() ? 'transition' : 'scoped';
  }

  async function commit(next) {
    await writeAtomic(registry, JSON.stringify(next) + '\n');
    state = next;
  }

  function serialize(work) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }

  function assertAdmin({origin, bearer}) {
    if (!loaded || closed || origin !== undefined || !matches(adminToken, bearer)) throw rejected();
  }

  function snapshot() {
    return {
      ok: true, mode: mode(), legacyUntil: legacyAvailable() && state.legacyUntil ? state.legacyUntil : null,
      permissions: [...allowed], records: state.records.map(({id, origin, permissions: grants, hash}) =>
        ({id, origin, permissions: [...grants], active: hash !== null})),
    };
  }

  function prunePending() {
    const now = tick();
    for (const [origin, entry] of pending) if (entry.expires <= now) pending.delete(origin);
  }

  function admin(context, body, originAllowed, canActivate = true) {
    assertAdmin(context);
    return serialize(async () => {
      const action = body?.action;
      if (action === 'status') return snapshot();
      if (action === 'begin') {
        if (state.activatedAt || !canActivate) throw invalid();
        const now = wall();
        await commit({schema: 1, activatedAt: now, legacyUntil: now + overlapMs, records: []});
        overlapStarted = tick();
        return snapshot();
      }
      if (!state.activatedAt) throw failure('BRIDGE_PAIRING_INACTIVE', 409, 'יש להתחיל מעבר מקומי לפני הצמדה.');
      if (action === 'finish') {
        if (!state.records.some(record => record.hash !== null)) throw invalid();
        await commit({...state, legacyUntil: 0});
        return snapshot();
      }
      if (action === 'prepare-rollback') {
        if (state.legacyUntil !== 0) throw invalid();
        await writeAtomic(path.join(root, 'bridge-token.txt'), secret('') + '\n');
        return snapshot();
      }
      const origin = body?.origin;
      if (!validOrigin(origin)) throw invalid();
      const existing = state.records.find(record => record.origin === origin);
      if (action === 'revoke') {
        if (!existing && !pending.has(origin)) throw invalid();
        if (existing) {
          await commit({...state, records: state.records.map(record =>
            record === existing ? {...record, hash: null} : record)});
        }
        pending.delete(origin);
        return snapshot();
      }
      if (action !== 'issue' || !originAllowed(origin)) throw invalid();
      const grants = body.permissions;
      if (!Array.isArray(grants) || !grants.length || grants.length > allowed.size ||
          grants.some(permission => !allowed.has(permission)) || new Set(grants).size !== grants.length ||
          (!existing && state.records.length >= maxRecords)) throw invalid();
      prunePending();
      if (!pending.has(origin) && pending.size >= 3) {
        throw failure('BRIDGE_PAIRING_BUSY', 429, 'יש להשלים הצמדה ממתינה או להמתין לפקיעתה.');
      }
      const code = secret(codePrefix);
      pending.set(origin, {hash: digest(code), permissions: [...grants], expires: tick() + lifetimeMs, attempts: 0});
      return {ok: true, code, expiresInSeconds: lifetimeMs / 1000};
    });
  }

  function exchange(origin, code) {
    if (!loaded || closed || !state.activatedAt || !validOrigin(origin) || typeof code !== 'string' || !codeFormat.test(code)) {
      throw rejected();
    }
    prunePending();
    const entry = pending.get(origin);
    if (!entry || entry.claimed || entry.attempts >= 5) throw rejected();
    entry.attempts++;
    if (!matches(entry.hash, digest(code))) throw rejected();
    // Claim before waiting for durable I/O. A failed write consumes the code,
    // preserves the previous key, and requires another local approval.
    entry.claimed = true;
    return serialize(async () => {
      if (pending.get(origin) !== entry || entry.expires <= tick()) throw rejected();
      pending.delete(origin);
      const existing = state.records.find(record => record.origin === origin);
      if (!existing && state.records.length >= maxRecords) throw invalid();
      const token = secret(keyPrefix);
      const record = {origin, id: randomUUID(), hash: digest(token), permissions: entry.permissions};
      await commit({...state, records: [...state.records.filter(row => row.origin !== origin), record]});
      return {ok: true, token};
    });
  }

  // Authorize before reading the body. The captured authority travels through
  // queues and asynchronous operations without passing a bearer to domain code.
  async function capture({origin, bearer, originAllowed, readLegacy}) {
    if (!loaded) throw storageError();
    if (origin === undefined && matches(adminToken, bearer)) {
      return {principal: 'native', assert: () => {}};
    }
    if (typeof bearer === 'string' && keyFormat.test(bearer)) {
      const record = state.records.find(row => row.origin === origin);
      if (!record?.hash || !originAllowed(origin) || !matches(record.hash, digest(bearer))) throw rejected();
      return {
        principal: record.id,
        authorize(permission) {
          const required = Array.isArray(permission) ? permission : [permission];
          if (!required.length || !required.every(value => record.permissions.includes(value))) throw forbidden();
        },
        assert() {
          if (!state.records.includes(record)) throw rejected();
        },
      };
    }
    const assert = () => {
      if (!legacyAvailable() || state.records.some(record => record.origin === origin)) throw rejected();
    };
    assert();
    if (!matches(await readLegacy(), bearer)) throw rejected();
    assert();
    return {principal: 'legacy:' + (origin ?? 'native'), assert};
  }

  function assertCurrent() {
    requestAuthority.getStore()?.assert();
  }
  function principal() {
    return requestAuthority.getStore()?.principal;
  }

  const api = {
    protocol: PAIRING_PROTOCOL, initialize, mode, admin, assertAdmin, exchange, capture, assertCurrent, principal,
    respond(options) {
      if (options.req.method !== 'POST' ||
          (options.pathname !== PAIRING_ADMIN_PATH && options.pathname !== PAIRING_EXCHANGE_PATH)) return null;
      return respondToPairing({...options, pairing: api});
    },
    close() { closed = true; return tail; },
    run: (grant, callback) => requestAuthority.run(grant, callback),
  };
  return api;
}

async function respondToPairing({pairing, pathname, req, res, bearer, readBody, send, originAllowed, canActivate}) {
  const origin = req.headers.origin;
  try {
    const admin = pathname === PAIRING_ADMIN_PATH;
    if (admin) pairing.assertAdmin({origin, bearer});
    else if (!validOrigin(origin) || !originAllowed(origin)) throw rejected();
    if (String(req.headers['content-type']).split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw invalid();
    const body = await readBody(req);
    if (res.destroyed) return true;
    const value = admin ? await pairing.admin({origin, bearer}, body, originAllowed, canActivate) : await pairing.exchange(origin, body?.code);
    send(200, value);
  } catch (error) {
    const response = error.status ? error : invalid();
    if (!res.destroyed) send(response.status, {ok: false, code: response.code, message: response.message});
  }
  return true;
}
