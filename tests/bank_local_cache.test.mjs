import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { imageFixture, PNG, imageRow, imageLink, normalizedImage } from './bank_file_fixture.mjs';

test('local cheque cache persists exact verified bytes, reuses them and only advances the retained event date', async (t) => {
  const f = await imageFixture(t),
    result = await f.api.attach(
      f.page,
      { eventDate: '20261013' },
      { list: [imageRow] },
      normalizedImage
    ),
    key = result.checkItems[0].imageFrontKey;
  assert.match(key, /^[a-f0-9]{64}$/);
  const cached = await f.api.read(key);
  assert.deepEqual(Buffer.from(cached.data), PNG);
  assert.equal(cached.contentType, 'image/png');
  await f.api.attach(f.page, { eventDate: '20261012' }, { list: [imageRow] }, normalizedImage);
  assert.equal((await f.api.read(key)).eventDate, '20261013');
  assert.equal(f.calls.filter((call) => call === 'download').length, 1);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(f.directory, key + '.json'), 'utf8')).schemaVersion,
    1
  );
});

test('image URL, signature, retention and row-identity gates never publish unsafe or unmatched images', async (t) => {
  const f = await imageFixture(t);
  assert.equal(f.api.inRetention('20260413'), false);
  assert.equal(f.api.inRetention('20261014'), false);
  const foreign = await f.api.attach(
    f.page,
    { eventDate: '20261013' },
    {
      list: [
        {
          ...imageRow,
          imageFrontLink:
            'https://foreign.example/ServerServices/current-account/cheques/a?isFront=true',
        },
      ],
    },
    normalizedImage
  );
  assert.equal(foreign.checkItems[0].imageFrontKey, undefined);
  assert.equal(f.calls.length, 0);
  const invalid = await imageFixture(t, {
    download: async () => ({ ok: true, contentType: 'text/html', base64: PNG.toString('base64') }),
  });
  assert.equal(
    (
      await invalid.api.attach(
        invalid.page,
        { eventDate: '20261013' },
        { list: [imageRow] },
        normalizedImage
      )
    ).checkItems[0].imageFrontKey,
    undefined
  );
});

test('malformed cache pairs fail closed and cleanup removes only managed final image pairs', async (t) => {
  const f = await imageFixture(t),
    key = 'a'.repeat(64);
  await fs.writeFile(path.join(f.directory, key + '.bin'), PNG);
  await fs.writeFile(
    path.join(f.directory, key + '.json'),
    JSON.stringify({ key, size: 999, contentType: 'image/png', eventDate: '20261013' })
  );
  await fs.writeFile(path.join(f.directory, 'operator-notes.txt'), 'retained');
  assert.equal(await f.api.read(key), null);
  assert.equal(await f.api.read('../outside'), null);
  await f.api.cleanup();
  assert.deepEqual(await fs.readdir(f.directory), ['operator-notes.txt']);
});

test('failed temporary metadata write leaves no unowned image bytes after cache housekeeping', async (t) => {
  const error = Object.assign(new Error('fixture disk failure'), { code: 'ENOSPC' });
  const fileSystem = {
    ...fs,
    writeFile: async (file, ...args) => {
      if (String(file).includes('.json.') && String(file).endsWith('.tmp')) throw error;
      return fs.writeFile(file, ...args);
    },
  };
  const f = await imageFixture(t, { fileSystem });
  const result = await f.api.attach(
    f.page,
    { eventDate: '20261013' },
    { list: [imageRow] },
    normalizedImage
  );
  assert.equal(result.checkItems[0].imageFrontKey, undefined);
  await f.api.cleanup();
  assert.deepEqual(
    await fs.readdir(f.directory),
    [],
    'a rejected cache publication must clean its owned temporary files'
  );
});

test('cache readers and drainage wait for both final files while metadata promotion is held', async (t) => {
  let release, entered;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    started = new Promise((resolve) => {
      entered = resolve;
    });
  const fileSystem = {
    ...fs,
    rename: async (source, target) => {
      if (String(target).endsWith('.json')) {
        entered();
        await gate;
      }
      return fs.rename(source, target);
    },
  };
  const f = await imageFixture(t, { fileSystem }),
    key = createHash('sha256').update(imageLink).digest('hex');
  const publishing = f.api.attach(
    f.page,
    { eventDate: '20261013' },
    { list: [imageRow] },
    normalizedImage
  );
  await started;
  let completed = false,
    drained = false;
  const reading = f.api.read(key).then((result) => {
    completed = true;
    return result;
  });
  const draining = f.api.drain().then(() => {
    drained = true;
  });
  try {
    await fs.access(path.join(f.directory, key + '.bin'));
    assert.equal(completed, false);
    assert.equal(drained, false);
  } finally {
    release();
  }
  assert.equal((await publishing).checkItems[0].imageFrontKey, key);
  assert.deepEqual((await reading).data, PNG);
  await draining;
  assert.deepEqual((await fs.readdir(f.directory)).sort(), [key + '.bin', key + '.json']);
});

test('failed date refresh removes its metadata attempt and retains the previous readable image', async (t) => {
  let fail = false;
  const failure = new Error('fixture metadata promotion failed');
  const fileSystem = {
    ...fs,
    rename: async (source, target) => {
      if (fail && String(target).endsWith('.json')) throw failure;
      return fs.rename(source, target);
    },
  };
  const f = await imageFixture(t, { fileSystem }),
    published = await f.api.attach(
      f.page,
      { eventDate: '20261012' },
      { list: [imageRow] },
      normalizedImage
    ),
    key = published.checkItems[0].imageFrontKey;
  fail = true;
  const failed = await f.api.attach(
    f.page,
    { eventDate: '20261013' },
    { list: [imageRow] },
    normalizedImage
  );
  assert.equal(failed.checkItems[0].imageFrontKey, undefined);
  assert.equal((await f.api.read(key)).eventDate, '20261012');
  assert.deepEqual((await fs.readdir(f.directory)).sort(), [key + '.bin', key + '.json']);
  assert.ok(
    f.calls.some(
      (call) => Array.isArray(call) && call[0] === 'report' && call[2] === failure.message
    )
  );
  fail = false;
  await f.api.attach(f.page, { eventDate: '20261013' }, { list: [imageRow] }, normalizedImage);
  assert.equal((await f.api.read(key)).eventDate, '20261013');
  assert.equal(
    f.calls.filter((call) => call === 'download').length,
    1,
    'a failed file job does not poison later jobs or force a new provider download'
  );
});

for (const action of ['read', 'cleanup'])
  test(
    'failed ' + action + ' joins its still-running sibling file attempt before drainage',
    async (t) => {
      let release, entered;
      const gate = new Promise((resolve) => {
          release = resolve;
        }),
        started = new Promise((resolve) => {
          entered = resolve;
        });
      const failure = new Error('fixture first file failed'),
        key = 'c'.repeat(64);
      const fileSystem = { ...fs };
      if (action === 'read')
        fileSystem.readFile = async (file, ...args) => {
          if (String(file).endsWith('.json')) throw failure;
          if (String(file).endsWith('.bin')) {
            entered();
            await gate;
          }
          return fs.readFile(file, ...args);
        };
      else
        fileSystem.rm = async (file, ...args) => {
          if (String(file).endsWith('.bin')) throw failure;
          if (String(file).endsWith('.json')) {
            entered();
            await gate;
          }
          return fs.rm(file, ...args);
        };
      const f = await imageFixture(t, { fileSystem });
      await fs.writeFile(path.join(f.directory, key + '.bin'), PNG);
      await fs.writeFile(
        path.join(f.directory, key + '.json'),
        JSON.stringify({ key, size: PNG.length, contentType: 'image/png', eventDate: '20250101' })
      );
      let completed = false,
        drained = false;
      const task = f.api[action === 'read' ? 'read' : 'cleanup'](key).then(
        (value) => {
          completed = true;
          return value;
        },
        (error) => {
          completed = true;
          return error;
        }
      );
      await started;
      const draining = f.api.drain().then(() => {
        drained = true;
      });
      try {
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(completed, false, 'one failure must not abandon the sibling file job');
        assert.equal(drained, false);
      } finally {
        release();
        await task;
        await draining;
      }
      assert.equal(await task, action === 'read' ? null : failure);
    }
  );
