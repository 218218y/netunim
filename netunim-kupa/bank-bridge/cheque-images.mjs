import nativeFiles from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  HAPOALIM_BASE_URL,
  CHEQUE_IMAGE_RETENTION_DAYS,
  CHEQUE_IMAGE_MAX_BYTES,
} from './hapoalim-wire.mjs';
import { createFileTaskOwner, joinFileAttempts } from './file-task-owner.mjs';

export function createChequeImages({ directory, clock, reporter, files = nativeFiles }) {
  if (
    typeof directory !== 'string' ||
    !directory ||
    typeof clock?.date !== 'function' ||
    typeof clock?.now !== 'function' ||
    typeof reporter !== 'function'
  )
    throw new Error('cheque_image_ports_required');
  const fs = files,
    CHEQUE_IMAGE_CACHE_DIR = directory,
    jobs = createFileTaskOwner();
  async function withTemporaryFiles(paths, operation) {
    try {
      return await operation();
    } finally {
      await Promise.allSettled(paths.map((file) => fs.rm(file, { force: true })));
    }
  }
  function bankCalendarDay(value) {
    const digits = String(value ?? '')
      .replace(/\D/g, '')
      .slice(0, 8);
    if (!/^\d{8}$/.test(digits)) return null;
    const y = Number(digits.slice(0, 4)),
      m = Number(digits.slice(4, 6)),
      d = Number(digits.slice(6, 8)),
      time = Date.UTC(y, m - 1, d);
    return Number.isFinite(time) ? Math.floor(time / 86400000) : null;
  }

  function currentCalendarDay() {
    const now = clock.date();
    return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  }

  function chequeImageInRetention(eventDate) {
    const day = bankCalendarDay(eventDate),
      age = day === null ? NaN : currentCalendarDay() - day;
    return Number.isFinite(age) && age >= 0 && age < CHEQUE_IMAGE_RETENTION_DAYS;
  }

  function chequeImageRequest(relativeUrl) {
    const raw = String(relativeUrl || '').trim();
    if (!raw) return null;
    let url;
    try {
      url = new URL(raw, HAPOALIM_BASE_URL);
    } catch {
      return null;
    }
    if (
      url.origin !== new URL(HAPOALIM_BASE_URL).origin ||
      !url.pathname.startsWith('/ServerServices/current-account/cheques/')
    )
      return null;
    const side = url.searchParams.get('isFront');
    if (side !== 'true' && side !== 'false') return null;
    return {
      url: url.toString(),
      relative: `${url.pathname}${url.search}`,
      side: side === 'true' ? 'front' : 'back',
    };
  }

  function chequeImageKey(relative) {
    return createHash('sha256')
      .update(String(relative || ''), 'utf8')
      .digest('hex');
  }

  function chequeImageCachePaths(key) {
    return {
      data: path.join(CHEQUE_IMAGE_CACHE_DIR, `${key}.bin`),
      meta: path.join(CHEQUE_IMAGE_CACHE_DIR, `${key}.json`),
    };
  }

  function supportedImageType(buffer, declared = '') {
    let detected = '';
    if (buffer?.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
      detected = 'image/jpeg';
    else if (
      buffer?.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
      detected = 'image/png';
    else if (
      buffer?.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    )
      detected = 'image/webp';
    else if (
      buffer?.length >= 6 &&
      ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
    )
      detected = 'image/gif';
    else if (buffer?.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM')
      detected = 'image/bmp';
    if (!detected) return '';
    const type = String(declared || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    return !type || type === 'application/octet-stream' || type === detected ? detected : '';
  }

  async function readCachedChequeImage(key) {
    if (!/^[a-f0-9]{64}$/.test(String(key || ''))) return null;
    const files = chequeImageCachePaths(key);
    try {
      const [metaText, data] = await joinFileAttempts([
          fs.readFile(files.meta, 'utf8'),
          fs.readFile(files.data),
        ]),
        meta = JSON.parse(metaText),
        contentType = supportedImageType(data, meta?.contentType);
      if (
        meta?.key !== key ||
        !contentType ||
        !data.length ||
        data.length > CHEQUE_IMAGE_MAX_BYTES ||
        Number(meta?.size) !== data.length
      )
        return null;
      return {
        key,
        data,
        contentType,
        size: data.length,
        eventDate: String(meta?.eventDate || ''),
      };
    } catch {
      return null;
    }
  }

  async function writeCachedChequeImage(key, data, { contentType, eventDate }) {
    await fs.mkdir(CHEQUE_IMAGE_CACHE_DIR, { recursive: true, mode: 0o700 });
    const files = chequeImageCachePaths(key),
      stamp = `${process.pid}.${clock.now()}`,
      dataTemp = `${files.data}.${stamp}.tmp`,
      metaTemp = `${files.meta}.${stamp}.tmp`,
      meta = {
        schemaVersion: 1,
        key,
        contentType,
        size: data.length,
        eventDate: String(eventDate || ''),
        cachedAt: clock.date().toISOString(),
      };
    return withTemporaryFiles([dataTemp, metaTemp], async () => {
      await fs.writeFile(dataTemp, data, { mode: 0o600 });
      await fs.writeFile(metaTemp, JSON.stringify(meta), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(dataTemp, files.data);
      await fs.rename(metaTemp, files.meta);
      return { key, data, contentType, size: data.length, eventDate: meta.eventDate };
    });
  }

  async function refreshCachedChequeImageDate(cached, eventDate) {
    const oldDay = bankCalendarDay(cached?.eventDate),
      newDay = bankCalendarDay(eventDate);
    if (newDay === null || (oldDay !== null && newDay <= oldDay)) return cached;
    const files = chequeImageCachePaths(cached.key),
      stamp = `${process.pid}.${clock.now()}`,
      metaTemp = `${files.meta}.${stamp}.tmp`,
      meta = {
        schemaVersion: 1,
        key: cached.key,
        contentType: cached.contentType,
        size: cached.size,
        eventDate: String(eventDate || ''),
        cachedAt: clock.date().toISOString(),
      };
    return withTemporaryFiles([metaTemp], async () => {
      await fs.writeFile(metaTemp, JSON.stringify(meta), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(metaTemp, files.meta);
      return { ...cached, eventDate: meta.eventDate };
    });
  }

  async function fetchChequeImageIntoCache(page, relativeUrl, eventDate) {
    const request = chequeImageRequest(relativeUrl);
    if (!request || !chequeImageInRetention(eventDate)) return '';
    const key = chequeImageKey(request.relative),
      cached = await jobs.run(() => readCachedChequeImage(key));
    if (cached) {
      await jobs.run(() => refreshCachedChequeImageDate(cached, eventDate));
      return key;
    }
    const result = await page.evaluate(
      async ({ url, maxBytes }) => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: { Accept: 'image/*' },
          });
          if (!response.ok) return { ok: false, status: response.status };
          const headerSize = Number(response.headers.get('content-length') || 0);
          if (Number.isFinite(headerSize) && headerSize > maxBytes)
            return { ok: false, status: 413 };
          const blob = await response.blob();
          if (!blob.size || blob.size > maxBytes) return { ok: false, status: 413 };
          const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => reject(reader.error || new Error('image read failed'));
              reader.readAsDataURL(blob);
            }),
            comma = dataUrl.indexOf(',');
          return {
            ok: true,
            status: response.status,
            contentType: blob.type || response.headers.get('content-type') || '',
            size: blob.size,
            base64: comma >= 0 ? dataUrl.slice(comma + 1) : '',
          };
        } catch (error) {
          return { ok: false, status: 0, message: String(error?.message || error) };
        }
      },
      { url: request.url, maxBytes: CHEQUE_IMAGE_MAX_BYTES }
    );
    if (!result?.ok || !result.base64) return '';
    const data = Buffer.from(result.base64, 'base64');
    if (!data.length || data.length > CHEQUE_IMAGE_MAX_BYTES) return '';
    const contentType = supportedImageType(data, result.contentType);
    if (!contentType) return '';
    await jobs.run(() => writeCachedChequeImage(key, data, { contentType, eventDate }));
    return key;
  }

  function chequeRowIdentity(value) {
    const bank = String(value?.bankNumber ?? value?.bank ?? '').trim(),
      branch = String(value?.branchNumber ?? value?.branch ?? '').trim(),
      account = String(value?.accountNumber ?? value?.account ?? '').trim(),
      number = String(value?.checkNumber ?? value?.number ?? '').trim(),
      amount = Number(value?.amount);
    return bank && branch && account && number && Number.isFinite(amount)
      ? `${bank}|${branch}|${account}|${number}|${amount}`
      : '';
  }

  async function attachChequeImageKeys(page, transaction, payload, normalized) {
    if (
      !normalized ||
      !chequeImageInRetention(transaction?.eventDate) ||
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray(payload.list)
    )
      return normalized;
    const byIdentity = new Map();
    for (const row of payload.list.slice(0, 50)) {
      const identity = chequeRowIdentity(row);
      if (!identity) continue;
      let imageFrontKey = '',
        imageBackKey = '';
      try {
        imageFrontKey = await fetchChequeImageIntoCache(
          page,
          row?.imageFrontLink,
          transaction.eventDate
        );
      } catch (error) {
        reporter('Bank Bridge cheque front image cache failed:', error?.message || error);
      }
      try {
        imageBackKey = await fetchChequeImageIntoCache(
          page,
          row?.imageBackLink,
          transaction.eventDate
        );
      } catch (error) {
        reporter('Bank Bridge cheque back image cache failed:', error?.message || error);
      }
      if (imageFrontKey || imageBackKey) byIdentity.set(identity, { imageFrontKey, imageBackKey });
    }
    if (!byIdentity.size) return normalized;
    return {
      ...normalized,
      checkItems: (Array.isArray(normalized.checkItems) ? normalized.checkItems : []).map(
        (item) => ({ ...item, ...(byIdentity.get(chequeRowIdentity(item)) || {}) })
      ),
    };
  }

  async function cleanupChequeImageCache() {
    let names;
    try {
      names = await fs.readdir(CHEQUE_IMAGE_CACHE_DIR);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    const keys = new Set(
      names.map((name) => name.match(/^([a-f0-9]{64})\.(?:bin|json)$/)?.[1]).filter(Boolean)
    );
    for (const key of keys) {
      const cached = await readCachedChequeImage(key);
      if (cached && chequeImageInRetention(cached.eventDate)) continue;
      const files = chequeImageCachePaths(key);
      await joinFileAttempts([fs.rm(files.data, { force: true }), fs.rm(files.meta, { force: true })]);
    }
  }

  async function deleteChequeImageCache() {
    await fs.rm(CHEQUE_IMAGE_CACHE_DIR, { recursive: true, force: true });
  }
  return Object.freeze({
    read: (key) => jobs.run(() => readCachedChequeImage(key)),
    attach: attachChequeImageKeys,
    inRetention: chequeImageInRetention,
    cleanup: () => jobs.run(cleanupChequeImageCache),
    clear: () => jobs.run(deleteChequeImageCache),
    drain: jobs.drain,
  });
}
