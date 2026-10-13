import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createChequeImages } from '../netunim-kupa/bank-bridge/cheque-images.mjs';
import { createInstalledBrowserLocator } from '../netunim-kupa/bank-bridge/browser-locator.mjs';
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const imageLink = '/ServerServices/current-account/cheques/fixture?isFront=true';
export const imageRow = {
  bankNumber: '12',
  branchNumber: '345',
  accountNumber: '678901',
  number: '0007',
  amount: 7,
  imageFrontLink: imageLink,
};
export const normalizedImage = {
  checkItems: [
    {
      bankNumber: '12',
      branchNumber: '345',
      accountNumber: '678901',
      checkNumber: '0007',
      amount: 7,
    },
  ],
};
export async function imageFixture(
  t,
  {
    fileSystem = fs,
    download = async () => ({ ok: true, contentType: 'image/png', base64: PNG.toString('base64') }),
  } = {}
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim cheque cache '));
  t.after(async () => {
    const absolute = path.resolve(directory);
    if (
      !absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(absolute).startsWith('netunim cheque cache ')
    )
      throw new Error('unsafe fixture cleanup');
    await fs.rm(absolute, { recursive: true, force: true });
  });
  const calls = [],
    clock = {
      date: () => new Date('2026-10-13T12:00:00Z'),
      now: () => Date.parse('2026-10-13T12:00:00Z'),
    };
  const page = {
      evaluate: async () => {
        calls.push('download');
        return download();
      },
    },
    report = (...args) => calls.push(['report', ...args]);
  const api = createChequeImages({ directory, clock, reporter: report, files: fileSystem });
  return { api, directory, page, calls, report };
}
export function browserFixture({
  saved = '',
  visible = [],
  where = async () => {
    throw new Error('not found');
  },
  osName = 'win32',
} = {}) {
  const calls = [],
    platform = {
      os: osName,
      candidates: () => visible,
      access: async (value) => {
        calls.push(['access', value]);
        if (!visible.includes(value)) throw new Error('missing');
      },
      where: async (name) => {
        calls.push(['where', name]);
        return where(name);
      },
    };
  const metadata = {
    read: async () => {
      calls.push(['read']);
      return { browserPath: saved };
    },
    write: async (patch) => {
      calls.push(['write', patch]);
    },
  };
  const find = createInstalledBrowserLocator({ platform, metadata }).find;
  return { find, calls, platform, metadata };
}
