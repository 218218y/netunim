// An app's last verified output survives compilation and publication failures.
import fs from 'node:fs/promises';
import path from 'node:path';

async function directory(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    await fs.mkdir(current).catch(error => {if (error.code !== 'EEXIST') throw error});
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Build directory must be a real directory: ${current}`);
  }
  return current;
}

async function move(from, to) {
  const deadline = Date.now() + 3000;
  for (;;) {
    try {await fs.rename(from, to); return}
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function exists(target) {
  try {
    const info = await fs.lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe output directory: ${target}`);
    return true;
  } catch (error) {if (error.code === 'ENOENT') return false; throw error}
}

async function removeOwned(parent, target) {
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Refusing unsafe build cleanup');
  const info = await fs.lstat(target).catch(error => {if (error.code === 'ENOENT') return null; throw error});
  if (info?.isSymbolicLink()) throw new Error('Refusing linked build cleanup');
  await fs.rm(target, {recursive: true, force: true});
}

export async function withBuildOutput(root, app, render) {
  if (!['orders', 'kupa'].includes(app)) throw new Error('Unknown application');
  const locks = await directory(root, '.work/build-locks');
  const staging = await directory(root, '.work/build-staging');
  const dist = await directory(root, 'dist');
  const privateRoot = await directory(root, '.work/production');
  const lock = path.join(locks, app);
  try {await fs.mkdir(lock)} catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Build already locked for ${app}; inspect ${lock} before retrying`);
    throw error;
  }
  let stage;
  let retainForRecovery = false;
  try {
    stage = await fs.mkdtemp(path.join(staging, app + '-'));
    const out = await directory(stage, 'site'), privateDir = await directory(stage, 'private');
    await render({out, privateDir}); // Includes full final-payload verification.
    const publications = [[out, path.join(dist, app)], [privateDir, path.join(privateRoot, app)]];
    const moved = [];
    try {
      for (let index = 0; index < publications.length; index++) {
        const [source, target] = publications[index], backup = path.join(stage, 'previous-' + index);
        const hadPrevious = await exists(target);
        if (hadPrevious) await move(target, backup);
        const record = {target, backup, hadPrevious, published: false};
        moved.push(record);
        await move(source, target);
        record.published = true;
      }
    } catch (error) {
      try {
        for (const record of moved.reverse()) {
          if (record.published) await removeOwned(root, record.target);
          if (record.hadPrevious) await move(record.backup, record.target);
        }
      } catch (recoveryError) {
        retainForRecovery = true;
        throw new AggregateError([error, recoveryError], `Build publication recovery requires inspection: ${stage}; lock retained: ${lock}`);
      }
      throw error;
    }
    return path.join(dist, app);
  } finally {
    if (!retainForRecovery) {
      if (stage) await removeOwned(staging, stage);
      await removeOwned(locks, lock);
    }
  }
}
