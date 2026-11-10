import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [mode, root, startup] = process.argv.slice(2);
const installing = mode === 'Install';
const source = path.dirname(fileURLToPath(import.meta.url));
const active = path.join(root, 'app');
const backup = path.join(root, 'app-rollback');
const work = fs.mkdtempSync(path.join(root, 'setup-work-'));
const staged = path.join(work, 'app');
const log = path.join(root, 'bridge.log');
const launcher = 'NetunimKupaBankBridge.vbs';
const stagedLauncher = path.join(startup, launcher + '.' + randomUUID());
const savedLauncher = stagedLauncher + '.previous';
const rollback = 'rollback_bank_bridge.bat';
const setupFiles = ['setup-bank-bridge.mjs', 'setup_bank_bridge.ps1', 'install_node_runtime.ps1'];
const moves = [];
let listener, stopped = false, preserveWork = false;

function run(directory, script, args, quiet = false) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: directory, windowsHide: true, stdio: quiet ? 'pipe' : 'inherit',
    env: {
      ...process.env,
      CAMOUFOX_INSTALL_DIR: path.join(root, 'camoufox'),
      PUPPETEER_SKIP_DOWNLOAD: 'true',
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = quiet ? result.stderr?.toString().trim() : '';
    throw new Error(`${path.basename(script)} ${args.join(' ')} failed${detail ? ': ' + detail : ''}`);
  }
}

function stage() {
  fs.mkdirSync(staged);
  // An explicit manifest keeps ZIP tooling and development files out of app.
  for (const file of fs.readFileSync(path.join(source, 'runtime-files.txt'), 'utf8').trim().split(/\r?\n/)) {
    fs.copyFileSync(path.join(source, file), path.join(staged, file), fs.constants.COPYFILE_EXCL);
  }
  fs.writeFileSync(path.join(staged, 'installation-id.txt'), randomUUID().replaceAll('-', ''), { flag: 'wx' });
  fs.mkdirSync(path.join(work, 'setup'));
  for (const file of setupFiles) fs.copyFileSync(path.join(source, file), path.join(work, 'setup', file));
  fs.copyFileSync(path.join(source, rollback), path.join(work, rollback));
  fs.mkdirSync(startup, { recursive: true });
  fs.copyFileSync(path.join(source, 'launch_hidden.vbs'), stagedLauncher, fs.constants.COPYFILE_EXCL);

  console.log('Installing locked dependencies and checking browsers in the staged Bank Bridge...');
  run(staged, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  run(staged, 'provision-camoufox.mjs', []);
  run(staged, 'server.mjs', ['--doctor']);
}

function move(from, to) {
  // Each destination must be vacant. In particular, preserve a prior rollback
  // until the new listener has passed verification.
  if (fs.existsSync(to)) throw new Error(`Setup destination already exists: ${to}`);
  fs.renameSync(from, to);
  moves.push({ from, to });
}

function replace(from, to, saved) {
  if (fs.existsSync(to)) move(to, saved);
  move(from, to);
}

async function verifyRunning(legacyVersion) {
  if (legacyVersion === null) {
    run(active, 'server.mjs', ['--check-running'], true);
    return;
  }
  // Pre-marker installations still need a verified recovery. This path is
  // only used for a preserved runtime that never had an installation ID.
  const response = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(1200) });
  const health = await response.json();
  if (!response.ok || health.ok !== true || health.service !== 'netunim-kupa-bank-bridge' || health.version !== legacyVersion) {
    throw new Error('The preserved Bank Bridge version did not answer its health check.');
  }
}

async function start(allowLegacy) {
  const legacyVersion = !allowLegacy || fs.existsSync(path.join(active, 'installation-id.txt')) ? null :
    Number(fs.readFileSync(path.join(active, 'server.mjs'), 'utf8').match(/\bconst BRIDGE_VERSION\s*=\s*(\d+);/)?.[1]);
  if (Number.isNaN(legacyVersion)) throw new Error('The preserved Bank Bridge version could not be identified.');
  const fd = fs.openSync(log, 'a');
  let child;
  try {
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: active, windowsHide: true, detached: true, stdio: ['ignore', fd, fd],
    });
  } finally {
    fs.closeSync(fd);
  }
  const state = { done: false, ended: new Promise(resolve => {
    child.once('exit', resolve);
    child.once('error', resolve);
  }) };
  void state.ended.then(() => { state.done = true; });
  listener = state;
  child.unref();
  const deadline = Date.now() + 10000;
  let lastError;
  do {
    await delay(250);
    if (state.done) throw new Error(`Bank Bridge exited during startup. See ${log}`);
    try {
      await verifyRunning(legacyVersion);
      // Let the process-exit notification arrive after the synchronous CLI probe.
      await delay(100);
      if (!state.done) return;
    } catch (error) {
      lastError = error;
    }
  } while (Date.now() < deadline);
  throw new Error(`Bank Bridge health verification failed. See ${log}`, { cause: lastError });
}

function cleanup(target, recursive = false) {
  try {
    fs.rmSync(target, { force: true, recursive });
  } catch (error) {
    console.warn(`Setup cleanup failed for ${target}: ${error.message}`);
  }
}

const hadActive = fs.existsSync(path.join(active, 'server.mjs'));
try {
  if (fs.existsSync(active) && !hadActive) throw new Error(`The active runtime is incomplete: ${active}`);
  if (installing) stage();
  else if (!hadActive || !fs.existsSync(path.join(backup, 'server.mjs'))) {
    throw new Error('An active and a preserved Bank Bridge runtime are required for rollback.');
  }

  run(installing ? staged : active, 'server.mjs', ['--stop-existing']);
  stopped = true;
  if (installing) {
    if (hadActive) {
      if (fs.existsSync(backup)) move(backup, path.join(work, 'previous-rollback'));
      move(active, backup);
    }
    move(staged, active);
    replace(stagedLauncher, path.join(startup, launcher), savedLauncher);
    replace(path.join(work, rollback), path.join(root, rollback), path.join(work, 'previous-rollback.bat'));
    replace(path.join(work, 'setup'), path.join(root, 'setup'), path.join(work, 'previous-setup'));
  } else {
    const displaced = path.join(work, 'displaced');
    move(active, displaced);
    move(backup, active);
    move(displaced, backup);
  }
  await start(!installing);
  console.log(installing
    ? 'Bank Bridge installation verified. See README.txt beside the installer for pairing and recovery.'
    : 'Bank Bridge rollback verified. Run the helper again to return to the other preserved runtime.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  try {
    if (listener && !listener.done) {
      // A failed health check does not give permission to force-kill accepted
      // work, or to rename a runtime whose child may still be starting.
      run(active, 'server.mjs', ['--stop-existing']);
      await Promise.race([listener.ended, delay(1500)]);
      if (!listener.done) throw new Error('The candidate process has not exited.');
    }
    for (const { from, to } of moves.reverse()) fs.renameSync(to, from);
    if (stopped && hadActive) {
      await start(true);
      console.error('The previous Bank Bridge runtime was restored and verified.');
    }
  } catch (recoveryError) {
    preserveWork = true;
    console.error(`Automatic recovery could not be verified: ${recoveryError.message}`);
    console.error(`Recovery files were preserved at ${work}. Startup backup, if present: ${savedLauncher}`);
  }
} finally {
  if (!preserveWork) {
    cleanup(work, true);
    cleanup(stagedLauncher);
    cleanup(savedLauncher);
  }
}
